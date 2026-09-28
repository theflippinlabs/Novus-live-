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
/** Moderation through Euler's documented REST API (mute, kick, comments on/off). */
export const MODERATION_SCOPES = ["webcast:mute", "webcast:ban", "webcast:comments"] as const;
/** Only what Novus uses: sending a message, and the three moderation actions. */
const SCOPES = ["webcast:chat", ...MODERATION_SCOPES];
/** TikTok's mute lengths (seconds; -1 = until unmuted). */
export const MUTE_DURATIONS = [5, 30, 60, 300, -1] as const;
export type MuteDuration = (typeof MUTE_DURATIONS)[number];

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
  /** Scopes asked for when this account was connected (older connections: chat only). */
  scopes?: string[];
}

export class ChatSendError extends Error {
  constructor(
    public code:
      | "chat_not_configured"
      | "chat_not_connected"
      | "chat_plan_required"
      | "chat_session_expired"
      | "chat_failed"
      | "chat_not_live"
      /** The connected account was connected before moderation was added: reconnect it. */
      | "mod_reconnect"
      /** TikTok refused: the connected account is not a moderator of this LIVE (or the viewer can't be acted on). */
      | "mod_refused",
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
      moderation: this.canModerateNow(),
    };
  }

  /** Connected with the moderation scopes (mute, kick, comments). */
  private canModerateNow(): boolean {
    const granted = this.tokens?.scopes ?? [];
    return this.configured && Boolean(this.tokens) && MODERATION_SCOPES.every((s) => granted.includes(s));
  }

  async canModerate(): Promise<boolean> {
    await this.load();
    return this.canModerateNow();
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
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("state", state);
    return { url: url.toString(), state };
  }

  /** Whether this sender started the OAuth flow carrying `state` (and it has not expired). */
  hasState(state: string): boolean {
    const pending = this.states.get(state);
    return Boolean(pending && pending.expires >= this.now());
  }

  /** OAuth callback: validates the one-time state, exchanges the code and stores the tokens. */
  async complete(code: string, state: string): Promise<ChatSenderStatus> {
    const pending = this.states.get(state);
    this.states.delete(state);
    if (!pending || pending.expires < this.now()) throw new ChatSendError("chat_session_expired", 400, "OAuth state missing or expired");
    const tokens = await this.exchange({ grant_type: "authorization_code", code, redirect_uri: pending.redirectUri });
    const info = await this.userInfo(tokens.accessToken).catch(() => null);
    this.tokens = { ...tokens, username: info?.uniqueId, nickname: info?.nickName, connectedAt: this.now(), scopes: [...SCOPES] };
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
    // Euler Stream's own plan (not the NOVUS subscription): never a 402, which means "NOVUS plan limit".
    if (res.status === 401 || res.status === 403) throw new ChatSendError("chat_plan_required", 403, detail);
    throw new ChatSendError("chat_failed", 502, detail);
  }

  // ---------------------------------------------------------------- moderation (connected account must moderate the LIVE)

  /** Mute a viewer in the LIVE of `roomId` (TikTok user id, seconds or -1 = until unmuted). */
  mute(roomId: string, userId: string, duration: MuteDuration): Promise<void> {
    return this.moderate("PUT", roomId, "mutes", { user_id: userId, duration: String(duration) });
  }

  unmute(roomId: string, userId: string): Promise<void> {
    return this.moderate("DELETE", roomId, "mutes", { user_id: userId });
  }

  /** Remove a viewer from the LIVE (TikTok "kick"; they can be let back in with `unkick`). */
  kick(roomId: string, userId: string): Promise<void> {
    return this.moderate("PUT", roomId, "bans", { tiktok_user_id: userId });
  }

  unkick(roomId: string, userId: string): Promise<void> {
    return this.moderate("DELETE", roomId, "bans", { tiktok_user_id: userId });
  }

  /** Turn the LIVE's comments off (raid) or back on. */
  setComments(roomId: string, enabled: boolean): Promise<void> {
    return this.moderate("POST", roomId, "toggle_comments", { enabled: String(enabled) });
  }

  private async moderate(method: "PUT" | "DELETE" | "POST", roomId: string, what: string, query: Record<string, string>): Promise<void> {
    if (!this.configured) throw new ChatSendError("chat_not_configured", 503);
    await this.load();
    if (!this.tokens) throw new ChatSendError("chat_not_connected", 409);
    if (!this.canModerateNow()) throw new ChatSendError("mod_reconnect", 409);
    if (!roomId) throw new ChatSendError("chat_not_live", 409);
    const token = await this.freshToken();
    const q = new URLSearchParams({ ...query, apiKey: this.cfg.apiKey! });
    const res = await this.http(`${API}/webcast/rooms/${encodeURIComponent(roomId)}/moderation/${what}?${q}`, {
      method,
      headers: { Accept: "application/json", "x-api-key": this.cfg.apiKey!, "x-oauth-token": token },
      signal: AbortSignal.timeout(15_000),
    });
    // Euler wraps TikTok's own answer: { code, message, response: { data: { status_code, data } } }.
    const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string; response?: { data?: { status_code?: number; data?: { message?: string; prompts?: string } } } };
    const tiktokStatus = body.response?.data?.status_code;
    if (res.ok && (tiktokStatus === undefined || tiktokStatus === 0)) {
      this.lastError = undefined;
      return;
    }
    const detail = `${res.status} ${body.message ?? body.response?.data?.data?.prompts ?? body.response?.data?.data?.message ?? ""}${tiktokStatus ? ` (TikTok ${tiktokStatus})` : ""}`.trim().slice(0, 200);
    this.lastError = detail;
    console.warn(`[moderation] ${what} refused: ${detail}`);
    if (res.status === 401 && /scope/i.test(body.message ?? "")) throw new ChatSendError("mod_reconnect", 409, detail);
    // Refused by TikTok or Euler (not a moderator of this LIVE, Euler plan, viewer protected…): the exact reason is kept.
    if (res.ok || res.status === 401 || res.status === 403) throw new ChatSendError("mod_refused", 403, detail);
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
