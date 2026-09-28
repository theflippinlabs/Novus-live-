import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../shared/types";
import { goalProgress, weekBounds } from "../server/analytics/goals";

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
