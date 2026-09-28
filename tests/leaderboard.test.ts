import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../shared/types";
import { buildLeaderboard } from "../server/analytics/leaderboard";

const NOW = Date.parse("2026-09-28T12:00:00Z");
let n = 0;
const live = (account: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  sessionId: `s${++n}`,
  title: "LIVE",
  account,
  source: "tiktok",
  status: "ended",
  startedAt: NOW - 86_400_000,
  durationMs: 2 * 3_600_000,
  messages: 2400,
  uniqueChatters: 80,
  gifts: 50,
  diamonds: 5000,
  peakViewers: 300,
  avgViewers: 200,
  seenViewers: 400,
  follows: 20,
  donors: 16,
  alerts: 4,
  ...over,
});

describe("Streamer ranking", () => {
  it("ranks the followed streamers with one score mixing gifts, engagement, audience, activity and safety", () => {
    const board = buildLeaderboard(
      [
        live("king", { diamonds: 90_000, avgViewers: 900, peakViewers: 1200 }),
        live("king", { diamonds: 60_000, avgViewers: 800 }),
        live("lea", { uniqueChatters: 150, diamonds: 8000 }),
        live("mo", { alerts: 60, diamonds: 1000, avgViewers: 60, uniqueChatters: 10, durationMs: 30 * 60_000 }),
        // Ignored: demos, too short, too old.
        live("demo", { source: "demo" }),
        live("short", { durationMs: 2 * 60_000 }),
        live("old", { startedAt: NOW - 60 * 86_400_000 }),
      ],
      30,
      NOW,
    );
    expect(board.entries.map((e) => e.account)).toEqual(["king", "lea", "mo"]);
    expect(board.lives).toBe(4);
    const [king, lea, mo] = board.entries;
    expect(king.rank).toBe(1);
    expect(king.lives).toBe(2);
    expect(king.hours).toBe(4);
    expect(king.diamonds).toBe(150_000);
    expect(king.diamondsPerHour).toBe(37_500);
    expect(king.parts.monetization).toBe(100);
    expect(king.badges).toEqual(expect.arrayContaining(["top_diamonds", "top_audience", "most_active"]));
    // Léa gets more of her audience talking.
    expect(lea.engagementRate).toBe(75);
    expect(lea.badges).toContain("top_engagement");
    expect(lea.parts.engagement).toBeGreaterThan(king.parts.engagement);
    // Many alerts pull the safety part down.
    expect(mo.alertsPer1k).toBe(25);
    expect(mo.parts.safety).toBe(50);
    expect(mo.score).toBeLessThan(lea.score);
    for (const e of board.entries) expect(e.score).toBeGreaterThanOrEqual(0);
    expect(buildLeaderboard([], 7, NOW).entries).toEqual([]);
    // "All time" keeps the old LIVE.
    expect(buildLeaderboard([live("old", { startedAt: NOW - 60 * 86_400_000 })], null, NOW).entries[0].account).toBe("old");
  });
});
