import { describe, expect, it, vi } from "vitest";
import type { LiveComment, LiveEvent } from "../shared/types";
import { DEMO_CYCLE_SECONDS, DEMO_SCRIPT, DemoTrafficGenerator } from "../server/platform/demoTraffic";
import { createRuntime } from "./helpers";

const comments = (events: LiveEvent[]) => events.filter((e): e is LiveComment => e.type === "comment");

function runDemo(seconds: number, speed = 1, seed = 1) {
  const g = new DemoTrafficGenerator({ seed, speed });
  const out: LiveEvent[] = [];
  for (let i = 0; i < seconds * 10; i++) out.push(...g.advance(100 / speed, "s1", 1_000_000 + i * 100));
  return out;
}

describe("mock LIVE generation", () => {
  it("is deterministic for a given seed", () => {
    const a = runDemo(30).map((e) => (e.type === "comment" ? e.text : e.type));
    const b = runDemo(30).map((e) => (e.type === "comment" ? e.text : e.type));
    expect(a).toEqual(b);
  });

  it("produces every normalized event type", () => {
    const types = new Set(runDemo(DEMO_CYCLE_SECONDS).map((e) => e.type));
    for (const t of ["comment", "viewer_count", "gift", "follow", "join"]) expect(types.has(t as LiveEvent["type"])).toBe(true);
  });

  it("includes the full incident script: spam, insults, harassment, scams, doxxing, raid, impersonation", () => {
    const texts = comments(runDemo(DEMO_CYCLE_SECONDS + 1)).map((c) => `${c.viewer.username}: ${c.text}`);
    for (const item of DEMO_SCRIPT.filter((s) => s.kind === "comment")) {
      expect(texts.some((t) => t.includes(item.text!))).toBe(true);
    }
    expect(texts.filter((t) => t.startsWith("raid_crew_")).length).toBe(8);
    expect(texts.some((t) => /\?/.test(t))).toBe(true);
    expect(texts.some((t) => /\p{Extended_Pictographic}/u.test(t))).toBe(true);
  });

  it("scales traffic with speed (1x / 5x / 20x)", () => {
    const perRealSecond = (speed: number) => comments(new DemoTrafficGenerator({ seed: 3, speed }).advance(10_000, "s", 1)).length / 10;
    const r1 = perRealSecond(1);
    const r5 = perRealSecond(5);
    const r20 = perRealSecond(20);
    expect(r5).toBeGreaterThan(r1 * 3);
    expect(r20).toBeGreaterThan(r5 * 3);
  });

  it("starts fresh offenders on each cycle", () => {
    const names = comments(runDemo(DEMO_CYCLE_SECONDS * 2 + 1)).map((c) => c.viewer.username);
    expect(names).toContain("shadow_vex");
    expect(names).toContain("shadow_vex2");
  });

  it("MockLiveAdapter streams events into the pipeline and Novus detects the incidents", async () => {
    vi.useFakeTimers();
    const { runtime, mock } = createRuntime();
    await runtime.startDemo(20);
    expect(mock.isRunning()).toBe(true);
    // 12 real seconds at 20x ≈ 240 demo seconds: a full incident cycle.
    await vi.advanceTimersByTimeAsync(12_000);
    const stats = runtime.stats();
    expect(stats.messagesTotal).toBeGreaterThan(200);
    const users = runtime.sortedAlerts().map((a) => a.viewer.username);
    for (const offender of ["shadow_vex", "diamond_drop_official", "leak_master", "thirsty_42", "crypto_mentor_x"]) {
      expect(users).toContain(offender);
    }
    expect(runtime.sortedAlerts()[0].severity).toBe("critical");
    // Normal chatters stay out of the queue.
    expect(users.filter((u) => /^[a-z]+_[a-z]+\d*$/.test(u) && !/^(shadow|leak|thirsty|grumpy|promo|diamond|crypto|raid|banter|le_troll|novarys)/.test(u))).toHaveLength(0);
    await runtime.endSession();
    expect(mock.isRunning()).toBe(false);
    vi.useRealTimers();
  });
});
