import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveEvent } from "../shared/types";
import { TikTokAdapter } from "../server/platform/TikTokAdapter";
import { connectWithFallback, serialized, TikTokLiveWatcher, type LiveConnectionLike } from "../server/platform/TikTokLiveWatcher";
import { mapChat, mapGift, mapViewerCount } from "../server/platform/tiktokMapping";
import { createRuntime } from "./helpers";

afterEach(() => vi.useRealTimers());

class FakeConnection implements LiveConnectionLike {
  handlers = new Map<string, ((d: unknown) => void)[]>();
  constructor(private behaviour: "live" | "offline" | "error") {}
  on(event: string, handler: (d: unknown) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  emit(event: string, data: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(data);
  }
  async connect() {
    if (this.behaviour === "offline") {
      const e = new Error("The requested user isn't online :(");
      e.name = "UserOfflineError";
      throw e;
    }
    if (this.behaviour === "error") throw new Error("Sign server rate limited");
    return { roomId: "1" };
  }
  disconnect() {}
}

const chat = (uniqueId: string, comment: string) => ({ user: { uniqueId, userId: `id-${uniqueId}`, nickname: uniqueId.toUpperCase() }, comment, common: { msgId: `${uniqueId}-${comment.length}-${Math.random()}` } });

describe("TikTok payload mapping", () => {
  it("maps chat, gifts (streak-aware) and viewer counts", () => {
    const c = mapChat(chat("fan_1", "hello!")) as Extract<LiveEvent, { type: "comment" }>;
    expect(c.type).toBe("comment");
    expect(c.viewer).toMatchObject({ id: "tt:id-fan_1", username: "fan_1", displayName: "FAN_1" });
    expect(c.text).toBe("hello!");
    expect(mapChat({ user: {}, comment: "x" })).toBeNull();

    const streaming = { user: { uniqueId: "g" }, giftDetails: { giftType: 1, giftName: "Rose", diamondCount: 1 }, repeatCount: 3, repeatEnd: false };
    expect(mapGift(streaming)).toBeNull();
    const done = mapGift({ ...streaming, repeatEnd: true }) as Extract<LiveEvent, { type: "gift" }>;
    expect(done).toMatchObject({ type: "gift", giftName: "Rose", count: 3, value: 1 });

    expect(mapViewerCount({ viewerCount: 412 })).toMatchObject({ type: "viewer_count", count: 412 });
  });

  it("reads the v3 protobuf shapes emitted by tiktok-live-connector 2.x", () => {
    const user = { id: "7301", displayId: "night_owl", nickname: "Night Owl", avatarThumb: { urlList: ["https://p16.example/a.jpg"] } };
    const c = mapChat({ common: { msgId: "m1" }, user, content: "salut tout le monde" }) as Extract<LiveEvent, { type: "comment" }>;
    expect(c).toMatchObject({ type: "comment", id: "tt:m1", text: "salut tout le monde" });
    expect(c.viewer).toMatchObject({ id: "tt:7301", username: "night_owl", displayName: "Night Owl", avatarUrl: "https://p16.example/a.jpg" });

    const streak = { user, gift: { id: "5655", name: "Rose", type: 1, diamondCount: 1 }, repeatCount: 7, repeatEnd: 0 };
    expect(mapGift(streak)).toBeNull();
    expect(mapGift({ ...streak, repeatEnd: 1 })).toMatchObject({ type: "gift", giftName: "Rose", count: 7, value: 1 });

    expect(mapViewerCount({ total: "321", totalUser: "5400" })).toMatchObject({ type: "viewer_count", count: 321 });
  });
});

describe("TikTok live watcher", () => {
  it("waits while the account is offline, then streams the LIVE into a TikTok session", async () => {
    vi.useFakeTimers();
    const { runtime } = createRuntime();
    const tiktok = new TikTokAdapter(false);
    tiktok.unofficialLiveConnector = true;
    await tiktok.connect("w_amanda_g");
    let mode: "offline" | "live" = "offline";
    let current: FakeConnection | null = null;
    const watcher = new TikTokLiveWatcher(
      async () => (current = new FakeConnection(mode)),
      {
        push: async (events) => {
          const live = runtime.session?.status === "live" && runtime.session.source === "tiktok";
          const batch = (events as unknown as LiveEvent[]).filter((e) => !(live && e.type === "stream_status" && e.status === "started"));
          for (const e of batch) tiktok.noteEvent({ ...e, sessionId: "x", platform: "tiktok" } as LiveEvent);
          if (batch.length) await runtime.ingestExternal(batch, "tiktok");
        },
        waiting: (d) => tiktok.noteWaiting(d),
        error: (m) => tiktok.fail(m),
        alive: () => tiktok.noteHeartbeat(),
      },
      { pollMs: 60_000, errorBackoffMs: 180_000 },
    );

    watcher.watch("@w_amanda_g");
    await vi.advanceTimersByTimeAsync(10);
    expect(tiktok.state()).toBe("CONNECTED");
    expect(tiktok.status().detail).toMatch(/Waiting for @w_amanda_g/);
    expect(runtime.session).toBeNull();

    mode = "live";
    await vi.advanceTimersByTimeAsync(60_000);
    // Connected, but not a LIVE until the room shows activity.
    expect(watcher.isLive).toBe(false);
    expect(runtime.session).toBeNull();
    await vi.advanceTimersByTimeAsync(6_000);
    current!.emit("roomUser", { viewerCount: 12 });
    await vi.advanceTimersByTimeAsync(10);
    expect(watcher.isLive).toBe(true);
    expect(runtime.session?.source).toBe("tiktok");
    expect(runtime.session?.title).toBe("@w_amanda_g LIVE");
    expect(tiktok.state()).toBe("LIVE_DETECTED");

    current!.emit("chat", chat("fan_1", "love this live ❤️"));
    current!.emit("chat", chat("shadow", "give me your address i'll come find you"));
    current!.emit("roomUser", { viewerCount: 321 });
    await vi.advanceTimersByTimeAsync(10);
    expect(runtime.stats().messagesTotal).toBe(2);
    expect(runtime.stats().viewerCount).toBe(321);
    const top = runtime.sortedAlerts()[0];
    expect(top.viewer.username).toBe("shadow");
    expect(top.severity).toBe("critical");
    // Actions on a real TikTok LIVE stay manual.
    const out = await runtime.actOnAlert(top.id, "block");
    expect(out?.record.status).toBe("manual_required");

    const sessionId = runtime.session!.id;
    current!.emit("streamEnd", {});
    await vi.advanceTimersByTimeAsync(10);
    expect(runtime.session?.id).toBe(sessionId);
    expect(runtime.session?.status).toBe("ended");
    expect(tiktok.state()).toBe("LIVE_ENDED");
    watcher.stop();
  });

  const sinkFor = (runtime: ReturnType<typeof createRuntime>["runtime"]) => ({
    push: async (events: unknown[]) => {
      const live = runtime.session?.status === "live";
      const batch = (events as LiveEvent[]).filter((e) => !(live && e.type === "stream_status" && e.status === "started"));
      if (batch.length) await runtime.ingestExternal(batch, "tiktok");
    },
    waiting: () => undefined,
    error: () => undefined,
    alive: () => undefined,
  });

  it("does not count a room that shows no activity as a LIVE (even with a burst replayed at connect)", async () => {
    vi.useFakeTimers();
    const { runtime } = createRuntime({ account: "jordan.pause6" });
    let current: FakeConnection | null = null;
    let attempts = 0;
    const watcher = new TikTokLiveWatcher(
      async () => {
        attempts++;
        return (current = new FakeConnection("live"));
      },
      sinkFor(runtime),
      { pollMs: 60_000, errorBackoffMs: 180_000 },
    );
    watcher.watch("jordan.pause6");
    await vi.advanceTimersByTimeAsync(10);
    // Old messages replayed right at connect time do not prove the LIVE is running.
    current!.emit("chat", chat("old_fan", "message from the previous LIVE"));
    await vi.advanceTimersByTimeAsync(89_000);
    expect(watcher.isLive).toBe(false);
    expect(runtime.session).toBeNull();
    // After the confirmation window it gives up and polls again later.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toBe(2);
    expect(runtime.session).toBeNull();
    watcher.stop();
  });

  it("closes a LIVE that goes silent without TikTok sending 'stream end'", async () => {
    vi.useFakeTimers();
    const { runtime } = createRuntime({ account: "someone" });
    let current: FakeConnection | null = null;
    const watcher = new TikTokLiveWatcher(async () => (current = new FakeConnection("live")), sinkFor(runtime), { pollMs: 60_000, errorBackoffMs: 180_000 });
    watcher.watch("someone");
    await vi.advanceTimersByTimeAsync(6_000);
    current!.emit("roomUser", { viewerCount: 40 });
    await vi.advanceTimersByTimeAsync(10);
    expect(runtime.session?.status).toBe("live");
    // Activity keeps it open…
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    current!.emit("like", {});
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(runtime.session?.status).toBe("live");
    // …silence closes it.
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(watcher.isLive).toBe(false);
    expect(runtime.session?.status).toBe("ended");
    watcher.stop();
  });

  it("reports connector errors and backs off", async () => {
    vi.useFakeTimers();
    const tiktok = new TikTokAdapter(false);
    let attempts = 0;
    const watcher = new TikTokLiveWatcher(
      async () => {
        attempts++;
        return new FakeConnection("error");
      },
      { push: async () => undefined, waiting: () => undefined, error: (m) => tiktok.fail(m), alive: () => undefined },
      { pollMs: 60_000, errorBackoffMs: 180_000 },
    );
    watcher.watch("someone");
    await vi.advanceTimersByTimeAsync(10);
    expect(tiktok.state()).toBe("ERROR");
    expect(tiktok.status().error).toMatch(/rate limited/);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempts).toBe(2);
    watcher.stop();
  });
});

describe("TikTok connect fallback", () => {
  const offline = () => Object.assign(new Error("The requested user isn't online :("), { name: "UserOfflineError" });

  it("retries with Euler's room id and always leaves TikTok's own lookups enabled", async () => {
    const cfg = { skipFetchRoomInfoFromHtmlRoute: true, skipFetchRoomInfoFromApiLiveRoute: true };
    const seen: (string | undefined)[] = [];
    const conn = {
      roomId: "old",
      async connect(roomId?: string) {
        seen.push(roomId);
        if (!roomId) throw offline();
        return { roomId };
      },
      async fetchRoomId() {
        expect(cfg.skipFetchRoomInfoFromHtmlRoute).toBe(true);
        return "fresh";
      },
    };
    await connectWithFallback(conn, cfg, "someone");
    expect(seen).toEqual([undefined, "fresh"]);
    expect(cfg).toEqual({ skipFetchRoomInfoFromHtmlRoute: false, skipFetchRoomInfoFromApiLiveRoute: false });

    // Euler refusing still restores the config and reports the account as offline.
    const conn2 = { ...conn, fetchRoomId: async () => Promise.reject(new Error("lack of permission")) };
    await expect(connectWithFallback(conn2, cfg, "someone")).rejects.toThrow(/isn't online/);
    expect(cfg).toEqual({ skipFetchRoomInfoFromHtmlRoute: false, skipFetchRoomInfoFromApiLiveRoute: false });
  });

  it("never runs two connection attempts at the same time", async () => {
    let running = 0;
    let maxRunning = 0;
    const attempt = () =>
      serialized(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      });
    await Promise.all([attempt(), attempt(), attempt()]);
    expect(maxRunning).toBe(1);
  });
});
