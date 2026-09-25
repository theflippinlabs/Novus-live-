import { randomBytes } from "node:crypto";
import type { ChatSenderStatus } from "../../shared/types";
import type { Repository } from "../persistence/Repository";

/*
 * "Send in chat": posts a moderator-approved message into a TikTok LIVE chat through
 * Euler Stream's OAuth + chat API, as the moderator's own TikTok account.
 *
 * ⚠️ Unofficial (Euler Stream is a third party, not TikTok). Sending requires an Euler
 * plan that includes chat sending; without it Euler answers 401/403 and Novus says so —
 * it never pretends a message was posted. Nothing is ever sent automatically: every
 * message is one explicit tap by the moderator.
 *
 * Tokens stay on the server (Supabase `server_secrets`, service role only) and are never
 * sent to the browser.
 */

const API = "https://tiktok.eulerstream.com";
const DEFAULT_AUTHORIZE_URL = "https://www.eulerstream.com/oauth/authorize";
const SECRET_ID = "euler_chat_oauth";
const STATE_TTL_MS = 10 * 60_000;
export const CHAT_MAX_LENGTH = 150;

export interface EulerChatConfig {
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  /** Authorize page (the URL from Euler's "URL Builder" works as-is; state/redirect are replaced). */
  authorizeUrl?: string;
}

interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** ms epoch */
  expiresAt?: number;
  refreshExpiresAt?: number;
  username?: string;
  nickname?: string;
  connectedAt: number;
}

export class ChatSendError extends Error {
  constructor(
    public code: "chat_not_configured" | "chat_not_connected" | "chat_plan_required" | "chat_session_expired" | "chat_failed" | "chat_not_live",
    public status: number,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

type Fetch = typeof fetch;

export class EulerChatSender {
  private tokens: StoredTokens | null = null;
  private loaded: Promise<void> | null = null;
  private states = new Map<string, { redirectUri: string; expires: number }>();
  private lastError: string | undefined;

  constructor(
    private cfg: EulerChatConfig,
    private repo: Pick<Repository, "loadSecret" | "saveSecret">,
    private http: Fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  get configured(): boolean {
    return Boolean(this.cfg.apiKey && this.cfg.clientId && this.cfg.clientSecret);
  }

  private load(): Promise<void> {
    this.loaded ??= this.repo
      .loadSecret(SECRET_ID)
      .then((v) => {
        const t = v as StoredTokens | null;
        this.tokens = t && typeof t.accessToken === "string" ? t : null;
      })
      .catch((e) => {
        this.loaded = null;
        console.error(`[chat] could not load the TikTok sender session: ${e instanceof Error ? e.message : e}`);
      });
    return this.loaded;
  }

  async status(): Promise<ChatSenderStatus> {
    await this.load();
    return {
      configured: this.configured,
      connected: Boolean(this.tokens),
      username: this.tokens?.username,
      nickname: this.tokens?.nickname,
      connectedAt: this.tokens?.connectedAt,
      lastError: this.lastError,
    };
  }

  /** Start the OAuth flow: returns the Euler authorize URL and the one-time state. */
  authorizeUrl(redirectUri: string): { url: string; state: string } {
    if (!this.configured) throw new ChatSendError("chat_not_configured", 503);
    const now = this.now();
    for (const [k, v] of this.states) if (v.expires < now) this.states.delete(k);
    const state = randomBytes(24).toString("base64url");
    this.states.set(state, { redirectUri, expires: now + STATE_TTL_MS });
    const url = new URL(this.cfg.authorizeUrl || DEFAULT_AUTHORIZE_URL);
    url.searchParams.set("client_id", this.cfg.clientId!);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    if (!url.searchParams.get("scope")) url.searchParams.set("scope", "webcast:chat");
    url.searchParams.set("state", state);
    return { url: url.toString(), state };
  }

  /** OAuth callback: validates the one-time state, exchanges the code and stores the tokens. */
  async complete(code: string, state: string): Promise<ChatSenderStatus> {
    const pending = this.states.get(state);
    this.states.delete(state);
    if (!pending || pending.expires < this.now()) throw new ChatSendError("chat_session_expired", 400, "OAuth state missing or expired");
    const tokens = await this.exchange({ grant_type: "authorization_code", code, redirect_uri: pending.redirectUri });
    const info = await this.userInfo(tokens.accessToken).catch(() => null);
    this.tokens = { ...tokens, username: info?.uniqueId, nickname: info?.nickName, connectedAt: this.now() };
    this.lastError = undefined;
    await this.repo.saveSecret(SECRET_ID, this.tokens);
    return this.status();
  }

  async disconnect(): Promise<void> {
    await this.load();
    const token = this.tokens?.accessToken;
    this.tokens = null;
    this.lastError = undefined;
    await this.repo.saveSecret(SECRET_ID, null);
    if (token && this.configured) {
      // Best effort: revoke at Euler too.
      await this.http(`${API}/tiktok/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, token }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    }
  }

  /** Post `content` in the LIVE chat of `roomId` as the connected moderator account. */
  async send(roomId: string, content: string): Promise<void> {
    if (!this.configured) throw new ChatSendError("chat_not_configured", 503);
    await this.load();
    if (!this.tokens) throw new ChatSendError("chat_not_connected", 409);
    if (!roomId) throw new ChatSendError("chat_not_live", 409);
    const text = content.replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LENGTH);
    if (!text) throw new ChatSendError("chat_failed", 400, "empty message");
    const token = await this.freshToken();
    const res = await this.http(`${API}/webcast/rooms/${encodeURIComponent(roomId)}/chat?apiKey=${encodeURIComponent(this.cfg.apiKey!)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": this.cfg.apiKey!, "x-oauth-token": token },
      body: JSON.stringify({ content: text }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string; code?: number };
    if (res.ok) {
      this.lastError = undefined;
      return;
    }
    const detail = `${res.status} ${body.message ?? ""}`.trim().slice(0, 200);
    this.lastError = detail;
    console.warn(`[chat] Euler refused the message: ${detail}`);
    if (res.status === 401 || res.status === 403) throw new ChatSendError("chat_plan_required", 402, detail);
    throw new ChatSendError("chat_failed", 502, detail);
  }

  private async freshToken(): Promise<string> {
    const t = this.tokens!;
    if (!t.expiresAt || t.expiresAt - this.now() > 60_000) return t.accessToken;
    if (!t.refreshToken || (t.refreshExpiresAt && t.refreshExpiresAt < this.now())) {
      this.lastError = "TikTok session expired";
      throw new ChatSendError("chat_session_expired", 409);
    }
    try {
      const next = await this.exchange({ grant_type: "refresh_token", refresh_token: t.refreshToken });
      this.tokens = { ...t, ...next };
      await this.repo.saveSecret(SECRET_ID, this.tokens);
      return this.tokens.accessToken;
    } catch (e) {
      this.lastError = "TikTok session expired";
      throw e instanceof ChatSendError ? new ChatSendError("chat_session_expired", 409, e.message) : e;
    }
  }

  private async exchange(grant: Record<string, string>): Promise<Omit<StoredTokens, "connectedAt">> {
    const res = await this.http(`${API}/tiktok/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, ...grant }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      data?: { access_token?: string; refresh_token?: string; expires_in?: number; refresh_expires_in?: number };
    };
    const d = body.data;
    if (!res.ok || !d?.access_token) {
      const detail = `${res.status} ${body.message ?? ""}`.trim().slice(0, 200);
      this.lastError = detail;
      throw new ChatSendError("chat_failed", 502, `token exchange failed: ${detail}`);
    }
    const now = this.now();
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token,
      expiresAt: d.expires_in ? now + d.expires_in * 1000 : undefined,
      refreshExpiresAt: d.refresh_expires_in ? now + d.refresh_expires_in * 1000 : undefined,
    };
  }

  private async userInfo(token: string): Promise<{ uniqueId?: string; nickName?: string } | null> {
    const res = await this.http(`${API}/tiktok/oauth/userinfo`, {
      headers: { Accept: "application/json", "x-oauth-token": token, ...(this.cfg.apiKey ? { "x-api-key": this.cfg.apiKey } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { user?: { uniqueId?: string; nickName?: string } };
    return body.user ?? null;
  }
}
