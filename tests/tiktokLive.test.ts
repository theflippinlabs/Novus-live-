import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveEvent } from "../shared/types";
import { TikTokAdapter } from "../server/platform/TikTokAdapter";
import { TikTokLiveWatcher, type LiveConnectionLike } from "../server/platform/TikTokLiveWatcher";
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
