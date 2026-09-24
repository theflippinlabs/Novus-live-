import type { LiveEvent } from "../../shared/types";
import { mapChat, mapFollow, mapGift, mapJoin, mapViewerCount } from "./tiktokMapping";

/*
 * Follows one TikTok account and streams its LIVE chat into Novus.
 *
 * ⚠️ Uses the UNOFFICIAL community library `tiktok-live-connector` (reverse-engineered,
 * not authorized by TikTok, may break or conflict with TikTok's Terms). It is enabled
 * because the owner explicitly chose it. It is READ-ONLY: it never logs in, never
 * sends messages and never performs moderation actions — those stay manual.
 */

type Draft = Omit<LiveEvent, "sessionId" | "platform">;

export interface LiveConnectionLike {
  connect(): Promise<unknown>;
  disconnect(): unknown;
  on(event: string, handler: (data: unknown) => void): unknown;
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
      // TikTok often serves cloud servers a cached profile page that still points at the
      // previous (ended) room, so the library reports "offline" during a real LIVE.
      // Before believing it, ask Euler Stream for the current room id and retry once.
      connect: async () => {
        try {
          return await conn.connect();
        } catch (err) {
          if (!isOffline(err)) throw err;
          const stale = conn.roomId;
          const cfg = mod.RoomIdRouteConfig;
          const saved = { html: cfg.skipFetchRoomInfoFromHtmlRoute, api: cfg.skipFetchRoomInfoFromApiLiveRoute };
          let fresh: string | undefined;
          try {
            cfg.skipFetchRoomInfoFromHtmlRoute = true;
            cfg.skipFetchRoomInfoFromApiLiveRoute = true;
            fresh = await conn.fetchRoomId();
          } catch (e) {
            log?.(`[tiktok] @${username}: offline per TikTok (room ${stale}); Euler lookup failed: ${describeError(e)}`);
            throw err;
          } finally {
            cfg.skipFetchRoomInfoFromHtmlRoute = saved.html;
            cfg.skipFetchRoomInfoFromApiLiveRoute = saved.api;
          }
          if (!fresh || fresh === stale) throw err;
          log?.(`[tiktok] @${username}: TikTok page had stale room ${stale}; retrying with room ${fresh}`);
          return conn.connect(fresh);
        }
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

export class TikTokLiveWatcher {
  private username: string | null = null;
  private conn: LiveConnectionLike | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private live = false;
  private loggedOffline = false;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private factory: ConnectionFactory,
    private sink: WatcherSink,
    private opts: { pollMs: number; errorBackoffMs: number; log?: (m: string) => void } = { pollMs: 60_000, errorBackoffMs: 180_000 },
  ) {}

  get watching(): string | null {
    return this.username;
  }

  get isLive(): boolean {
    return this.live;
  }

  watch(username: string): void {
    this.stop();
    this.username = username.replace(/^@/, "").trim();
    void this.attempt(this.generation);
  }

  stop(): void {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const conn = this.conn;
    this.conn = null;
    if (conn) {
      try {
        void Promise.resolve(conn.disconnect()).catch(() => undefined);
      } catch {
        /* already closed */
      }
    }
    if (this.live) {
      this.live = false;
      this.enqueue([{ id: `tt:end:${Date.now()}`, timestamp: Date.now(), type: "stream_status", status: "ended" } as Draft]);
    }
    this.username = null;
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

    const on = (event: string, map: (raw: never) => Draft | null) =>
      conn.on(event, (raw) => {
        if (gen !== this.generation) return;
        const ev = map(raw as never);
        if (ev) this.enqueue([ev]);
      });
    on("chat", mapChat);
    on("gift", mapGift);
    on("member", mapJoin);
    on("follow", mapFollow);
    on("roomUser", mapViewerCount);
    const ended = () => {
      if (gen !== this.generation || !this.live) return;
      this.live = false;
      this.conn = null;
      this.enqueue([{ id: `tt:end:${Date.now()}`, timestamp: Date.now(), type: "stream_status", status: "ended" } as Draft]);
      this.opts.log?.(`[tiktok] @${username} LIVE ended / disconnected — watching for the next one`);
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
    this.live = true;
    this.loggedOffline = false;
    this.sink.alive();
    this.opts.log?.(`[tiktok] connected to @${username}'s LIVE`);
    this.enqueue([{ id: `tt:start:${Date.now()}`, timestamp: Date.now(), type: "stream_status", status: "started", title: `@${username} LIVE` } as Draft]);
  }
}
