import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AnalyticsSummary, HistoryEntry } from "../shared/types";
import { deriveInsights } from "../server/analytics/insights";
import { createApp } from "../server/app";
import { RoomRegistry, type Room } from "../server/core/Rooms";
import { RealtimeHub } from "../server/realtime/RealtimeHub";
import { comment, createRuntime, FakeAIProvider } from "./helpers";

const T0 = Date.parse("2026-09-20T20:00:00Z");
function summary(over: Partial<AnalyticsSummary> = {}): AnalyticsSummary {
  const buckets = Array.from({ length: 60 }, (_, i) => ({ t: T0 + i * 60_000, viewers: 200, messages: i === 30 ? 120 : i === 45 ? 4 : 40, alerts: i === 20 ? 3 : 0, toxicity: 0, avgRisk: 0, sentiment: 0 }));
  return {
    session: { id: "s-now", platform: "tiktok", source: "tiktok", title: "LIVE", status: "ended", startedAt: T0, endedAt: T0 + 3_600_000, account: "odwnzcte" },
    totals: { messages: 2400, uniqueChatters: 60, alerts: 6, critical: 1, warnings: 3, muteRecommendations: 1, blockRecommendations: 0, reportRecommendations: 0, actions: 3, manualActions: 0, gifts: 30, follows: 12 },
    peak: { t: T0 + 30 * 60_000, messages: 120 },
    buckets,
    topParticipants: [],
    topQuestions: [],
    topTopics: [],
    categoryCounts: {},
    avgResponseTimeMs: 4200,
    durationMs: 3_600_000,
    audience: { peakViewers: 300, peakAt: T0 + 31 * 60_000, avgViewers: 200, joins: 400, follows: 12, seenViewers: 240 },
    gifts: { total: 30, diamonds: 1500, senders: 12, top: [], byName: [] },
    ...over,
  } as AnalyticsSummary;
}
const past = (i: number, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  sessionId: `p${i}`,
  title: "LIVE",
  account: "odwnzcte",
  source: "tiktok",
  status: "ended",
  startedAt: T0 - (i + 1) * 86_400_000,
  durationMs: 3_600_000,
  messages: 1200,
  uniqueChatters: 40,
  gifts: 20,
  diamonds: 1000,
  peakViewers: 200,
  alerts: 6,
  ...over,
});

describe("Stats insights", () => {
  it("derives ratios, moments and a bounded score", () => {
    const i = deriveInsights(summary());
    expect(i.ratios).toMatchObject({ durationMin: 60, messagesPerMin: 40, messagesPerChatter: 40, participation: 30, followsPer100: 5, giftsPerHour: 30, diamondsPerHour: 1500, donorRate: 5, alertsPer1k: 2.5, handledPct: 50, avgResponseSec: 4.2 });
    expect(i.score.engagement).toBe(100);
    expect(i.score.audience).toBe(100);
    expect(i.score.total).toBeGreaterThan(0);
    expect(i.score.total).toBeLessThanOrEqual(100);
    expect(i.moments.map((m) => m.kind)).toEqual(["tense", "chat_peak", "audience_peak", "quiet"]);
    expect(i.comparison).toBeNull();
    expect(i.trend).toHaveLength(1);
  });

  it("compares with the account's previous real LIVEs only", () => {
    const i = deriveInsights(summary(), [past(0), past(1), past(2, { source: "demo", messages: 99999 }), past(3, { sessionId: "s-now" }), past(4, { durationMs: 10_000 })]);
    expect(i.comparison?.lives).toBe(2);
    const by = Object.fromEntries(i.comparison!.metrics.map((m) => [m.key, m]));
    expect(by.messagesPerMin).toMatchObject({ value: 40, average: 20, deltaPct: 100, higherIsBetter: true });
    expect(by.peakViewers.deltaPct).toBe(50);
    expect(by.alertsPer1k).toMatchObject({ value: 2.5, average: 5, deltaPct: -50, higherIsBetter: false });
    expect(i.trend.map((x) => x.current)).toEqual([false, false, true]);
  });

  it("answers questions about the numbers with the LIVE's stats as context", async () => {
    const contexts: string[] = [];
    class StatsAI extends FakeAIProvider {
      async copilot(req: { context: string; instruction: string }) {
        contexts.push(req.context);
        return `Réponse à : ${req.instruction}`;
      }
    }
    const ai = new StatsAI(() => ({ riskScore: 0, severity: "normal", categories: [], explanation: "", recommendedAction: "none", confidence: 1 }) as never);
    const { runtime, tiktok } = createRuntime({ ai });
    const main: Room = { id: "main", kind: "main", runtime, hub: new RealtimeHub(50), tiktok, dispose: async () => undefined };
    const app = createApp({ config: { production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 1000, ingestRateLimitPerMinute: 1000 }, rooms: new RoomRegistry(main) });
    const s = await runtime.startSession("demo", "mock", "test");
    for (let k = 0; k < 5; k++) runtime.ingest(comment(s.id, `fan${k}`, "trop bien ce live"));

    const insights = (await request(app).get("/api/analytics/insights").expect(200)).body;
    expect(insights.ratios.durationMin).toBeGreaterThanOrEqual(1);
    const res = await request(app).post("/api/analytics/ask").send({ question: "Analyse ce LIVE en 5 points", lang: "fr" }).expect(200);
    expect(res.body.text).toBe("Réponse à : Analyse ce LIVE en 5 points");
    const ctx = JSON.parse(contexts[0]);
    expect(ctx.kind).toBe("LIVE statistics");
    expect(ctx.totals.messages).toBe(5);
    expect(ctx.insights.score.total).toBeTypeOf("number");
    await request(app).post("/api/analytics/ask").send({ question: "x", sessionId: "unknown" }).expect(404);
  });
});

describe("Stats insights on a short LIVE", () => {
  it("does not extrapolate per-hour rates from a few minutes", () => {
    const i = deriveInsights(summary({ durationMs: 120_000 }));
    expect(i.ratios.giftsPerHour).toBeNull();
    expect(i.ratios.diamondsPerHour).toBeNull();
  });
});

describe("Conversion KPIs", () => {
  it("builds the funnel and conversion rates from the LIVE's audience", () => {
    const i = deriveInsights(summary());
    expect(i.funnel).toEqual({ seen: 240, chatters: 60, followers: 12, donors: 12 });
    expect(i.conversions.viewerToChatter).toBe(25);
    expect(i.conversions.viewerToFollower).toBe(5);
    expect(i.conversions.viewerToDonor).toBe(5);
    expect(i.conversions.chatterToDonor).toBe(20);
    expect(i.conversions.avgBasket).toBe(125);
    expect(i.conversions.diamondsPerViewer).toBe(6.3);
    expect(i.conversions.retention).toBe(66.7);
    expect(i.conversions.joinsPerHour).toBe(400);
    expect(i.conversions.followsPerHour).toBe(12);
    // No audience data: no funnel, never invented numbers.
    const bare = deriveInsights(summary({ audience: undefined, gifts: undefined }));
    expect(bare.funnel).toBeNull();
    expect(bare.conversions.viewerToChatter).toBeNull();
    expect(bare.conversions.avgBasket).toBeNull();
  });
});

