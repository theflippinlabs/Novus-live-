import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../shared/types";
import { goalProgress, minutesPerDay, monthBounds, tierProgress, weekBounds } from "../server/analytics/goals";

describe("Weekly goals", () => {
  it("runs from Monday 00:00 to the next Monday in the space's time zone (DST included)", () => {
    // Wednesday 1 October 2026, 15:00 in Paris (UTC+2).
    const w = weekBounds(Date.parse("2026-10-01T13:00:00Z"), "Europe/Paris");
    expect(new Date(w.start).toISOString()).toBe("2026-09-27T22:00:00.000Z"); // Mon 28 Sept 00:00 Paris
    expect(new Date(w.end).toISOString()).toBe("2026-10-04T22:00:00.000Z");
    // The week of the switch to winter time (Sunday 25 October 2026).
    const dst = weekBounds(Date.parse("2026-10-24T10:00:00Z"), "Europe/Paris");
    expect(new Date(dst.start).toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(new Date(dst.end).toISOString()).toBe("2026-10-25T23:00:00.000Z"); // Mon 26 Oct 00:00, now UTC+1
    // Sunday late evening still belongs to the same week.
    expect(weekBounds(Date.parse("2026-10-04T21:30:00Z"), "Europe/Paris").start).toBe(w.start);
  });

  it("adds up this week's LIVEs of the streamer, the running one included", () => {
    const now = Date.parse("2026-10-01T13:00:00Z");
    const e = (over: Partial<HistoryEntry>): HistoryEntry => ({ sessionId: Math.random().toString(), title: "LIVE", account: "lilou", source: "tiktok", status: "ended", startedAt: Date.parse("2026-09-29T18:00:00Z"), durationMs: 2 * 3_600_000, messages: 100, uniqueChatters: 10, gifts: 5, diamonds: 1000, peakViewers: 150, alerts: 0, follows: 12, ...over });
    const p = goalProgress(
      "lilou",
      { diamonds: 10_000, hours: 10, lives: 5 },
      [
        e({}),
        e({ status: "live", startedAt: Date.parse("2026-10-01T12:00:00Z"), durationMs: 3_600_000, diamonds: 500, peakViewers: 420, follows: 3 }),
        e({ startedAt: Date.parse("2026-09-27T20:00:00Z") }), // last week (Sunday)
        e({ durationMs: 2 * 60_000 }), // too short
        e({ account: "other" }),
        e({ source: "demo" }),
      ],
      now,
      "Europe/Paris",
    );
    expect(p.done).toEqual({ diamonds: 1500, hours: 3, lives: 2, follows: 15, peakViewers: 420 });
    expect(p.weekElapsed).toBe(braces(now, p));
    expect(p.goals.diamonds).toBe(10_000);
  });
});

function braces(now: number, p: { weekStart: number; weekEnd: number }) {
  return Math.round(((now - p.weekStart) / (p.weekEnd - p.weekStart)) * 100);
}

describe("TikTok reward tiers", () => {
  const e = (start: string, minutes: number, diamonds = 1000, over: Partial<HistoryEntry> = {}): HistoryEntry => ({ sessionId: start, title: "LIVE", account: "lilou", source: "tiktok", status: "ended", startedAt: Date.parse(start), durationMs: minutes * 60_000, messages: 0, uniqueChatters: 0, gifts: 0, diamonds, peakViewers: 0, alerts: 0, ...over });

  it("counts valid days per local day, splitting a LIVE across midnight", () => {
    // 23:30 → 01:00 Paris (UTC+2): 30 min on the 1st, 60 min on the 2nd.
    const days = minutesPerDay([e("2026-09-30T21:30:00Z", 90)], "Europe/Paris");
    expect(Math.round(days.get("2026-09-30")!)).toBe(30);
    expect(Math.round(days.get("2026-10-01")!)).toBe(60);
    const m = monthBounds(Date.parse("2026-10-15T10:00:00Z"), "Europe/Paris");
    expect(new Date(m.start).toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(new Date(m.end).toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });

  it("finds the tier reached and what is missing for the next one", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const program = {
      period: "month" as const,
      validDayMinutes: 60,
      tiers: [
        { percent: 10, validDays: 7, hours: 15, diamonds: 50_000 },
        { percent: 5, validDays: 3, hours: 5 },
        { percent: 15, validDays: 12, hours: 30, diamonds: 150_000 },
      ],
    };
    const lives = [
      e("2026-10-01T18:00:00Z", 120, 20_000),
      e("2026-10-03T18:00:00Z", 90, 10_000),
      e("2026-10-05T18:00:00Z", 45, 5_000), // not a valid day (45 min)
      e("2026-10-08T18:00:00Z", 180, 30_000),
      e("2026-10-10T18:00:00Z", 60, 1_000),
      e("2026-09-29T18:00:00Z", 300, 90_000), // previous month
    ];
    const p = tierProgress("lilou", program, "all", lives, now, "Europe/Paris");
    expect(p.done).toEqual({ validDays: 4, hours: 8.3, diamonds: 66_000, follows: 0 });
    expect(p.tiers.map((t) => t.percent)).toEqual([5, 10, 15]);
    expect(p.current).toBe(0);
    expect(p.next).toBe(1);
    expect(p.tiers[1].missing).toEqual({ validDays: 3, hours: 6.7 });
    expect(p.tiers[2].missing).toEqual({ validDays: 8, hours: 21.7, diamonds: 84_000 });
    // Nothing reached yet: no current tier, the first one is next.
    const none = tierProgress("lilou", program, "account", [], now, "Europe/Paris");
    expect(none.current).toBeNull();
    expect(none.next).toBe(0);
    // Exposed with the weekly goals.
    expect(goalProgress("lilou", {}, lives, now, "Europe/Paris", { program, source: "all" }).tiers?.current).toBe(0);
    expect(goalProgress("lilou", {}, lives, now, "Europe/Paris").tiers).toBeNull();
  });
});

