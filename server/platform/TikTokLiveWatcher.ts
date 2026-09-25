import type { LiveEvent } from "../../shared/types";
import { mapChat, mapFollow, mapGift, mapJoin, mapViewerCount } from "./tiktokMapping";

/*
 * Follows one TikTok account and streams its LIVE chat into Novus.
 *
 * ⚠️ Uses the UNOFFICIAL community library `tiktok-live-connector` (reverse-engineered,
 * not authorized by TikTok, may break or conflict with TikTok's Terms). It is enabled
 * because the owner explicitly chose it. It is READ-ONLY: it never logs in, never
 * sends messages and never performs moderation actions. (The separate, opt-in
 * "Send in chat" button uses the room id it found — see server/chat/EulerChat.ts.)
 */

type Draft = Omit<LiveEvent, "sessionId" | "platform">;

export interface LiveConnectionLike {
  connect(): Promise<unknown>;
  disconnect(): unknown;
  on(event: string, handler: (data: unknown) => void): unknown;
  /** TikTok room id of the LIVE, once connected. */
  readonly roomId?: string;
}

export type ConnectionFactory = (username: string) => Promise<LiveConnectionLike>;

export interface WatcherSink {
  /** Push normalized events for the TikTok session. */
  push(events: Draft[]): Promise<void>;
  /** Connector reached TikTok but the account is not live. */
  waiting(detail: string): void;
  /** Something went wrong (network, signing, rate limit…). */
  error(message: string): void;
  /** Heartbeat: the connector is alive. */
  alive(): void;
}

/*
 * Every room connects through this one queue. The Euler fallback below flips the library's
 * process-wide RoomIdRouteConfig, so two rooms connecting at once must never overlap
 * (an overlap once left TikTok's own lookups disabled for every account).
 */
let connectQueue: Promise<unknown> = Promise.resolve();
const CONNECT_SLOT_MS = 30_000;

export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = connectQueue.then(fn, fn);
  // Hold the slot until this attempt settles, but never longer than CONNECT_SLOT_MS.
  connectQueue = Promise.race([run.catch(() => undefined), new Promise((r) => setTimeout(r, CONNECT_SLOT_MS).unref?.())]);
  return run;
}

interface RoomIdConfig {
  skipFetchRoomInfoFromHtmlRoute: boolean;
  skipFetchRoomInfoFromApiLiveRoute: boolean;
}

// TikTok often serves cloud servers a cached profile page that still points at the
// previous (ended) room, so the library reports "offline" during a real LIVE.
// Before believing it, ask Euler Stream for the current room id and retry once.
export async function connectWithFallback(
  conn: { connect(roomId?: string): Promise<unknown>; fetchRoomId(): Promise<string>; roomId: string },
  cfg: RoomIdConfig,
  username: string,
  log?: (m: string) => void,
): Promise<unknown> {
  // Always start from TikTok's own lookups enabled.
  cfg.skipFetchRoomInfoFromHtmlRoute = false;
  cfg.skipFetchRoomInfoFromApiLiveRoute = false;
  try {
    return await conn.connect();
  } catch (err) {
    if (!isOffline(err)) throw err;
    const stale = conn.roomId;
    let fresh: string | undefined;
    try {
      cfg.skipFetchRoomInfoFromHtmlRoute = true;
      cfg.skipFetchRoomInfoFromApiLiveRoute = true;
      fresh = await conn.fetchRoomId();
    } catch (e) {
      log?.(`[tiktok] @${username}: offline per TikTok (room ${stale || "none"}); Euler lookup failed: ${describeError(e)}`);
      throw err;
    } finally {
      cfg.skipFetchRoomInfoFromHtmlRoute = false;
      cfg.skipFetchRoomInfoFromApiLiveRoute = false;
    }
    if (!fresh || fresh === stale) throw err;
    log?.(`[tiktok] @${username}: TikTok page had stale room ${stale}; retrying with room ${fresh}`);
    return conn.connect(fresh);
  }
}

export function defaultConnectionFactory(signApiKey?: string, log?: (m: string) => void): ConnectionFactory {
  return async (username) => {
    const mod = await import("tiktok-live-connector");
    const conn = new mod.TikTokLiveConnection(username, {
      ...(signApiKey ? { signApiKey } : {}),
      processInitialData: false,
      enableExtendedGiftInfo: false,
    });
    return {
      on: (event, handler) => conn.on(event as never, handler as never),
      disconnect: () => conn.disconnect(),
      connect: () => serialized(() => connectWithFallback(conn, mod.RoomIdRouteConfig, username, log)),
      get roomId() {
        return conn.roomId || undefined;
      },
    };
  };
}

/** The library emits `{ info, exception }` objects as well as plain Errors. */
export const describeError = (e: unknown): string => {
  const o = e as { name?: string; message?: string; info?: string; exception?: unknown };
  if (o && typeof o === "object" && "exception" in o) return `${o.info ?? "error"}: ${describeError(o.exception)}`;
  if (e instanceof Error) {
    const nested = (e as { config?: { requestErrs?: unknown[] } }).config?.requestErrs;
    const extra = Array.isArray(nested) && nested.length ? ` [${nested.map((n) => (n instanceof Error ? n.message : String(n)).slice(0, 120)).join(" | ")}]` : "";
    return `${e.name}: ${e.message}${extra}`.slice(0, 400);
  }
  try {
    return JSON.stringify(e).slice(0, 200);
  } catch {
    return String(e);
  }
};

const isOffline = (err: unknown): boolean => {
  const e = err as { name?: string; message?: string; constructor?: { name?: string } };
  const text = `${e?.name ?? ""} ${e?.constructor?.name ?? ""} ${e?.message ?? ""}`.toLowerCase();
  return text.includes("offline") || text.includes("not live") || text.includes("isn't online") || text.includes("not online");
};

export interface WatcherOptions {
  pollMs: number;
  errorBackoffMs: number;
  log?: (m: string) => void;
  /**
   * A connection only counts as a LIVE once the room shows real activity (viewer count, chat,
   * gifts…) after this delay — the burst replayed right at connect time does not count.
   */
  confirmAfterMs?: number;
  /** No activity within this window after connecting: not a LIVE (TikTok pointed at a dead room). */
  confirmWindowMs?: number;
  /** A running LIVE that sends nothing for this long is over (TikTok did not send "stream end"). */
  silenceMs?: number;
}

const DEFAULTS = { confirmAfterMs: 5_000, confirmWindowMs: 90_000, silenceMs: 4 * 60_000 };

export class TikTokLiveWatcher {
  private username: string | null = null;
  private conn: LiveConnectionLike | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setInterval> | null = null;
  private live = false;
  private loggedOffline = false;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private lastActivity = 0;
  private opts: WatcherOptions & typeof DEFAULTS;

  constructor(
    private factory: ConnectionFactory,
    private sink: WatcherSink,
    opts: WatcherOptions = { pollMs: 60_000, errorBackoffMs: 180_000 },
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  get watching(): string | null {
    return this.username;
  }

  /** True only once the LIVE is confirmed by real room activity. */
  get isLive(): boolean {
    return this.live;
  }

  /** Room id of the LIVE being followed (undefined when not live). */
  get roomId(): string | undefined {
    return this.live ? this.conn?.roomId : undefined;
  }

  watch(username: string): void {
    this.stop();
    this.username = username.replace(/^@/, "").trim();
    void this.attempt(this.generation);
  }

  stop(): void {
    this.generation += 1;
    this.clearTimers();
    this.dropConnection();
    if (this.live) {
      this.live = false;
      this.enqueue([endMarker()]);
    }
    this.username = null;
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    this.timer = this.confirmTimer = this.silenceTimer = null;
  }

  private dropConnection(): void {
    const conn = this.conn;
    this.conn = null;
    if (conn) {
      try {
        void Promise.resolve(conn.disconnect()).catch(() => undefined);
      } catch {
        /* already closed */
      }
    }
  }

  private schedule(gen: number, ms: number): void {
    if (gen !== this.generation) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.attempt(gen), ms);
  }

  /** Serialize pushes so session start/end and events stay in order. */
  private enqueue(events: Draft[]): void {
    this.queue = this.queue.then(() => this.sink.push(events)).catch((e) => this.opts.log?.(`[tiktok] push failed: ${e instanceof Error ? e.message : e}`));
  }

  private async attempt(gen: number): Promise<void> {
    const username = this.username;
    if (!username || gen !== this.generation) return;
    let conn: LiveConnectionLike;
    try {
      conn = await this.factory(username);
    } catch (e) {
      this.sink.error(`TikTok connector unavailable: ${e instanceof Error ? e.message : String(e)}`);
      this.schedule(gen, this.opts.errorBackoffMs);
      return;
    }
    if (gen !== this.generation) return;

    // Events wait here until the LIVE is confirmed, then open the session together.
    let pending: Draft[] = [];
    let connectedAt = 0;
    const confirm = () => {
      if (this.live || this.conn !== conn || gen !== this.generation) return;
      if (this.confirmTimer) clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
      this.live = true;
      this.loggedOffline = false;
      this.lastActivity = Date.now();
      this.sink.alive();
      this.opts.log?.(`[tiktok] @${username} is LIVE (activity confirmed ${Math.round((Date.now() - connectedAt) / 1000)}s after connecting)`);
      this.enqueue([{ id: `tt:start:${Date.now()}`, timestamp: Date.now(), type: "stream_status", status: "started", title: `@${username} LIVE` } as Draft, ...pending]);
      pending = [];
      this.silenceTimer = setInterval(() => {
        if (this.live && this.conn === conn && Date.now() - this.lastActivity > this.opts.silenceMs) {
          this.opts.log?.(`[tiktok] @${username}: no activity for ${Math.round(this.opts.silenceMs / 60_000)} min — closing the LIVE`);
          ended();
        }
      }, Math.min(30_000, this.opts.silenceMs / 4));
    };

    const on = (event: string, map: (raw: never) => Draft | null) =>
      conn.on(event, (raw) => {
        // Only this attempt's connection counts: stragglers after the LIVE ended
        // (a last viewer count, a late comment) must not open a new, empty session.
        if (gen !== this.generation || this.conn !== conn) return;
        const ev = map(raw as never);
        if (!ev) return;
        if (this.live) {
          this.lastActivity = Date.now();
          this.enqueue([ev]);
          return;
        }
        if (pending.length < 500) pending.push(ev);
        if (Date.now() - connectedAt >= this.opts.confirmAfterMs) confirm();
      });
    on("chat", mapChat);
    on("gift", mapGift);
    on("member", mapJoin);
    on("follow", mapFollow);
    on("roomUser", mapViewerCount);
    // Likes are not stored but prove the room is alive.
    conn.on("like", () => {
      if (gen !== this.generation || this.conn !== conn) return;
      if (this.live) this.lastActivity = Date.now();
      else if (Date.now() - connectedAt >= this.opts.confirmAfterMs) confirm();
    });
    const ended = () => {
      if (gen !== this.generation || this.conn !== conn) return;
      const wasLive = this.live;
      this.live = false;
      this.clearTimers();
      this.dropConnection();
      if (wasLive) {
        this.enqueue([endMarker()]);
        this.opts.log?.(`[tiktok] @${username} LIVE ended / disconnected — watching for the next one`);
      }
      this.schedule(gen, this.opts.pollMs);
    };
    conn.on("streamEnd", ended);
    conn.on("disconnected", ended);
    conn.on("error", (e) => {
      if (this.live) this.opts.log?.(`[tiktok] connection error: ${describeError(e)}`);
    });

    try {
      await conn.connect();
    } catch (e) {
      if (gen !== this.generation) return;
      if (isOffline(e)) {
        if (!this.loggedOffline) this.opts.log?.(`[tiktok] @${username} not live (${describeError(e)}) — checking every ${Math.round(this.opts.pollMs / 1000)}s`);
        this.loggedOffline = true;
        this.sink.waiting(`Waiting for @${username} to go LIVE`);
        this.schedule(gen, this.opts.pollMs);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        this.loggedOffline = false;
        this.opts.log?.(`[tiktok] connect failed: ${describeError(e)}`);
        this.sink.error(msg.slice(0, 200));
        this.schedule(gen, this.opts.errorBackoffMs);
      }
      return;
    }
    if (gen !== this.generation) {
      void Promise.resolve(conn.disconnect()).catch(() => undefined);
      return;
    }
    this.conn = conn;
    connectedAt = Date.now();
    this.sink.waiting(`Checking that @${username} is really LIVE…`);
    this.confirmTimer = setTimeout(() => {
      if (this.live || this.conn !== conn || gen !== this.generation) return;
      // TikTok pointed at a room that shows no activity: not a LIVE. Look again later.
      this.opts.log?.(`[tiktok] @${username}: connected but the room shows no activity — not counted as a LIVE`);
      this.dropConnection();
      this.sink.waiting(`Waiting for @${username} to go LIVE`);
      this.schedule(gen, this.opts.pollMs);
    }, this.opts.confirmWindowMs);
  }
}

const endMarker = (): Draft => ({ id: `tt:end:${Date.now()}`, timestamp: Date.now(), type: "stream_status", status: "ended" }) as Draft;
