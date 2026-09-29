import { describe, expect, it, vi } from "vitest";
import { BulkLiveChecker } from "../server/platform/BulkLiveChecker";
import { TikTokLiveWatcher, type LiveConnectionLike } from "../server/platform/TikTokLiveWatcher";

type Call = { method: string; url: URL; body?: { user_numeric_ids: string[] }; headers: Record<string, string> };

function euler(live: Set<string>, opts: { refuse?: boolean } = {}) {
  const calls: Call[] = [];
  const http = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method ?? "GET", url, body, headers: init.headers as Record<string, string> });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    const m = /\/webcast\/anchors\/([^/]+)\/user_id$/.exec(url.pathname);
    if (m) return json(200, { code: 200, numeric_user_id: `9${[...m[1]].map((c) => c.charCodeAt(0)).join("")}` });
    if (url.pathname === "/webcast/bulk_live_check") {
      if (opts.refuse) return json(401, { message: "Missing scope webcast:bulk_live_check" });
      const data = Object.fromEntries(body.user_numeric_ids.map((id: string) => [id, { is_live: live.has(id), room_id: live.has(id) ? `r${id}` : null }]));
      return json(200, { code: 200, response: { data } });
    }
    return json(404, {});
  }) as typeof fetch;
  return { http, calls };
}

const idOf = (u: string) => `9${[...u].map((c) => c.charCodeAt(0)).join("")}`;

describe("Bulk LIVE check", () => {
  it("checks up to 50 accounts per Euler request, resolving numeric ids once", async () => {
    let now = 1_000_000;
    const users = Array.from({ length: 60 }, (_, i) => `liver${i}`);
    const { http, calls } = euler(new Set([idOf("liver3"), idOf("liver55")]));
    let saved: Record<string, string> = {};
    const metered: number[] = [];
    const checker = new BulkLiveChecker({ apiKey: "k", token: async () => "tok", loadIds: async () => saved, saveIds: async (ids) => void (saved = ids), meter: (_u, n) => metered.push(n), http, now: () => now });
    // Every watcher asks at the same time: one shared run.
    for (const u of users) void checker.isLive(u);
    await checker.isLive("liver0");
    // 25 ids per run, so the first answers cover those accounts only.
    now += 60_000;
    await checker.isLive("liver0");
    now += 60_000;
    const answers = await Promise.all(users.map((u) => checker.isLive(u)));
    expect(answers[3]).toBe(true);
    expect(answers[55]).toBe(true);
    expect(answers.filter((a) => a === false)).toHaveLength(58);
    const bulk = calls.filter((c) => c.url.pathname === "/webcast/bulk_live_check");
    expect(Math.max(...bulk.map((c) => c.body!.user_numeric_ids.length))).toBeLessThanOrEqual(50);
    expect(bulk[0].headers["x-oauth-token"]).toBe("tok");
    // Each account's numeric id is asked once, then kept.
    const idCalls = calls.filter((c) => c.url.pathname.endsWith("/user_id"));
    expect(idCalls).toHaveLength(60);
    expect(Object.keys(saved)).toHaveLength(60);
    // Steady state: 60 accounts → 2 requests a minute (instead of 60-120).
    const before = calls.length;
    now += 60_000;
    await Promise.all(users.map((u) => checker.isLive(u)));
    expect(calls.length - before).toBe(2);
    expect(metered.length).toBeGreaterThan(0);
  });

  it("answers 'unknown' (so watchers connect as before) when it can't check", async () => {
    const refused = euler(new Set(), { refuse: true });
    const checker = new BulkLiveChecker({ apiKey: "k", token: async () => "tok", loadIds: async () => ({ lilou: "123456" }), saveIds: async () => undefined, http: refused.http });
    expect(await checker.isLive("lilou")).toBeNull();
    const noToken = new BulkLiveChecker({ apiKey: "k", token: async () => null, loadIds: async () => ({}), saveIds: async () => undefined, http: euler(new Set()).http });
    expect(await noToken.isLive("lilou")).toBeNull();
    const noKey = new BulkLiveChecker({ token: async () => "tok", loadIds: async () => ({}), saveIds: async () => undefined });
    expect(await noKey.isLive("lilou")).toBeNull();
  });

  it("lets the watcher skip connecting while the account is not LIVE", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    let live: boolean | null = false;
    const conn: LiveConnectionLike = { on: () => undefined, disconnect: () => undefined, connect: async () => Promise.reject(Object.assign(new Error("The requested user isn't online :("), { name: "UserOfflineError" })) };
    const watcher = new TikTokLiveWatcher(
      async () => {
        attempts++;
        return conn;
      },
      { push: async () => undefined, waiting: () => undefined, error: () => undefined, alive: () => undefined },
      { pollMs: 60_000, errorBackoffMs: 180_000, liveGate: async () => live },
    );
    watcher.watch("lilou");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(attempts).toBe(0);
    // The bulk check can't tell: connect as before.
    live = null;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toBe(1);
    // LIVE: connect.
    live = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toBe(2);
    watcher.stop();
    vi.useRealTimers();
  });
});
