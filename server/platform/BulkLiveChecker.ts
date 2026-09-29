/*
 * One Euler request tells whether up to 50 followed accounts are LIVE
 * (POST /webcast/bulk_live_check, documented in Euler's SDK). Watchers ask it before
 * opening a connection: an account that is not LIVE costs nothing more, instead of one
 * or two Euler calls per account and per minute.
 *
 * It needs the platform's connected TikTok account (OAuth, scope webcast:bulk_live_check)
 * and each account's numeric id (GET /webcast/anchors/{unique_id}/user_id, once, cached).
 * Whenever it cannot answer (not connected, Euler refuses, unknown account), watchers fall
 * back to connecting as before — monitoring never depends on it.
 */

const API = "https://tiktok.eulerstream.com";
const BATCH = 50;
/** One shared check per minute at most (watchers poll every minute). */
const INTERVAL_MS = 55_000;
/** An answer older than this is not trusted (the watcher connects instead). */
const FRESH_MS = 150_000;
/** After a refusal (scope, plan…), stop asking for a while. */
const BACKOFF_MS = 10 * 60_000;
/** Numeric ids resolved per run (each is one request), to spread them out. */
const IDS_PER_RUN = 25;

type Fetch = typeof fetch;

export interface BulkLiveCheckerDeps {
  apiKey?: string;
  /** OAuth token of the platform's TikTok account, or null when it can't be used. */
  token: () => Promise<string | null>;
  /** Persisted numeric ids (username → id). */
  loadIds: () => Promise<Record<string, string>>;
  saveIds: (ids: Record<string, string>) => Promise<void>;
  /** Count Euler requests against the spaces that follow these accounts. */
  meter?: (usernames: string[], requests: number) => void;
  http?: Fetch;
  now?: () => number;
  log?: (m: string) => void;
}

export class BulkLiveChecker {
  private ids: Record<string, string> = {};
  private idsLoaded: Promise<void> | null = null;
  private unknown = new Set<string>();
  private status = new Map<string, { live: boolean; roomId: string | null; at: number }>();
  private watched = new Map<string, number>();
  private running: Promise<void> | null = null;
  private lastRun = 0;
  private pausedUntil = 0;
  private warned = false;
  requests = 0;

  constructor(private deps: BulkLiveCheckerDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * Is this account LIVE? true / false from a fresh bulk answer, or null when unknown
   * (the watcher then connects as before).
   */
  async isLive(username: string): Promise<boolean | null> {
    const u = username.replace(/^@/, "").toLowerCase();
    this.watched.set(u, this.now());
    if (!this.deps.apiKey || this.pausedUntil > this.now()) return null;
    await this.refresh();
    const s = this.status.get(u);
    return s && this.now() - s.at < FRESH_MS ? s.live : null;
  }

  /** Room id of the LIVE, when the last answer had one. */
  roomId(username: string): string | null {
    return this.status.get(username.toLowerCase())?.roomId ?? null;
  }

  private refresh(): Promise<void> {
    if (this.running) return this.running;
    if (this.now() - this.lastRun < INTERVAL_MS) return Promise.resolve();
    this.lastRun = this.now();
    this.running = this.run()
      .catch((e) => this.deps.log?.(`[live-check] ${e instanceof Error ? e.message : e}`))
      .finally(() => (this.running = null));
    return this.running;
  }

  private async run(): Promise<void> {
    const http = this.deps.http ?? fetch;
    const token = await this.deps.token();
    if (!token) {
      // Not connected yet (boot) or without the permission: ask again in a minute.
      this.pause("no connected TikTok account with the webcast:bulk_live_check permission", 60_000);
      return;
    }
    this.idsLoaded ??= this.deps.loadIds().then((m) => void (this.ids = { ...m })).catch(() => undefined);
    await this.idsLoaded;
    // Forget accounts no watcher asked about recently (unfollowed).
    for (const [u, at] of this.watched) if (this.now() - at > 10 * 60_000) this.watched.delete(u);
    const users = [...this.watched.keys()];

    // Numeric ids, once per account.
    const missing = users.filter((u) => !this.ids[u] && !this.unknown.has(u)).slice(0, IDS_PER_RUN);
    let resolved = 0;
    for (const u of missing) {
      const res = await http(`${API}/webcast/anchors/${encodeURIComponent(u)}/user_id?apiKey=${encodeURIComponent(this.deps.apiKey!)}`, {
        headers: { Accept: "application/json", "x-api-key": this.deps.apiKey! },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      this.requests++;
      this.deps.meter?.([u], 1);
      const body = res ? ((await res.json().catch(() => ({}))) as { numeric_user_id?: string }) : {};
      if (res?.ok && body.numeric_user_id && /^\d{3,25}$/.test(body.numeric_user_id)) {
        this.ids[u] = body.numeric_user_id;
        resolved++;
      } else if (res && res.status < 500 && res.status !== 429) this.unknown.add(u);
    }
    if (resolved) await this.deps.saveIds(this.ids).catch(() => undefined);

    const known = users.filter((u) => this.ids[u]);
    const byId = new Map(known.map((u) => [this.ids[u], u]));
    for (let i = 0; i < known.length; i += BATCH) {
      const chunk = known.slice(i, i + BATCH);
      const res = await http(`${API}/webcast/bulk_live_check?apiKey=${encodeURIComponent(this.deps.apiKey!)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": this.deps.apiKey!, "x-oauth-token": token },
        body: JSON.stringify({ user_numeric_ids: chunk.map((u) => this.ids[u]) }),
        signal: AbortSignal.timeout(20_000),
      });
      this.requests++;
      this.deps.meter?.(chunk, 1);
      const body = (await res.json().catch(() => ({}))) as { message?: string; response?: { data?: Record<string, { is_live?: boolean; room_id?: string | null }> } };
      if (!res.ok || !body.response?.data) {
        this.pause(`${res.status} ${body.message ?? "no data"}`.slice(0, 160));
        return;
      }
      const at = this.now();
      for (const [key, v] of Object.entries(body.response.data)) {
        const u = byId.get(key) ?? (chunk.includes(key.toLowerCase()) ? key.toLowerCase() : undefined);
        if (u && typeof v?.is_live === "boolean") this.status.set(u, { live: v.is_live, roomId: v.room_id ?? null, at });
      }
    }
    if (this.warned) this.deps.log?.("[live-check] bulk LIVE check working again");
    this.warned = false;
  }

  private pause(reason: string, ms = BACKOFF_MS): void {
    this.pausedUntil = this.now() + ms;
    if (!this.warned) this.deps.log?.(`[live-check] bulk LIVE check unavailable (${reason}) — accounts are checked one by one meanwhile`);
    this.warned = true;
  }
}
