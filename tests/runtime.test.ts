import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIVerdict } from "../server/ai/AIProvider";
import { comment, createRuntime, FakeAIProvider } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

describe("alert creation", () => {
  it("creates alerts for risky messages and puts critical ones on top", async () => {
    const { runtime } = createRuntime();
    const s = await runtime.startSession("demo", "mock", "test");
    const t = Date.now();
    runtime.ingest(comment(s.id, "grumpy", "you're kinda dumb and annoying", t));
    runtime.ingest(comment(s.id, "fan", "love this stream ❤️", t + 100));
    runtime.ingest(comment(s.id, "scammer", "FREE 10k coins 💎 claim at bit.ly/free-coinz dm me to claim", t + 200));
    runtime.ingest(comment(s.id, "shadow", "give me your address i'll come find you", t + 300));

    const alerts = runtime.sortedAlerts();
    expect(alerts.map((a) => a.viewer.username)).not.toContain("fan");
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].viewer.username).toBe("shadow");
    expect(alerts[0].recommendedAction).toBe("report");
    expect(runtime.stats().criticalAlerts).toBeGreaterThanOrEqual(1);
    expect(runtime.stats().messagesTotal).toBe(4);
  });

  it("merges repeat offences from the same viewer into one alert and escalates it", async () => {
    const { runtime } = createRuntime();
    const s = await runtime.startSession("demo", "mock", "test");
    const t = Date.now();
    runtime.ingest(comment(s.id, "vex", "nobody likes you, just quit", t));
    runtime.ingest(comment(s.id, "vex", "shut up you pathetic clown", t + 10_000));
    runtime.ingest(comment(s.id, "vex", "give me your address i'll come find you", t + 20_000));
    const mine = runtime.sortedAlerts().filter((a) => a.viewer.username === "vex");
    expect(mine).toHaveLength(1);
    expect(mine[0].occurrences).toBe(3);
    expect(mine[0].severity).toBe("critical");
    expect(mine[0].text).toContain("address");
    expect(mine[0].reasons.some((r) => r.startsWith("Repeated hostility"))).toBe(true);
    // Only one "Repeated hostility (Nx)" chip survives the merge.
    expect(mine[0].reasons.filter((r) => r.startsWith("Repeated hostility"))).toHaveLength(1);
  });

  it("groups a coordinated raid into a single alert listing all accounts", async () => {
    const { runtime } = createRuntime();
    const s = await runtime.startSession("demo", "mock", "test");
    const t = Date.now();
    for (let i = 1; i <= 8; i++) runtime.ingest(comment(s.id, `raid_${i}`, "L STREAM 💀💀 raid time", t + i * 300));
    const raid = runtime.sortedAlerts().filter((a) => a.categories.includes("coordinated_attack"));
    expect(raid).toHaveLength(1);
    expect((raid[0].accounts?.length ?? 0) + 1).toBeGreaterThanOrEqual(7);
  });

  it("never alerts on ignored viewers, but still analyzes them", async () => {
    const { runtime } = createRuntime();
    const s = await runtime.startSession("demo", "mock", "test");
    runtime.ingest(comment(s.id, "bot", "hello", Date.now()));
    await runtime.setViewerFlag("v:bot", "ignored");
    const c = runtime.ingest(comment(s.id, "bot", "give me your address i'll come find you", Date.now() + 10));
    expect(c?.analysis.severity).toBe("critical");
    expect(runtime.sortedAlerts()).toHaveLength(0);
  });

  it("builds viewer intelligence profiles", async () => {
    const { runtime } = createRuntime();
    const s = await runtime.startSession("demo", "mock", "test");
    const t = Date.now();
    runtime.ingest(comment(s.id, "vex", "hello everyone", t));
    runtime.ingest(comment(s.id, "vex", "nobody likes you, just quit", t + 5000));
    const p = runtime.viewerProfile("v:vex")!;
    expect(p.messageCount).toBe(2);
    expect(p.recentComments[0].text).toContain("nobody");
    expect(p.riskTrend).toHaveLength(2);
    expect(p.categories.harassment).toBe(1);
    expect(p.alertIds.length).toBe(1);
    expect(p.assessment?.severity).not.toBe("normal");
  });
});

describe("moderation action state", () => {
  it("demo platform: actions are SIMULATED (never faked as real) and resolve the alert", async () => {
    const { runtime } = createRuntime();
    const s = await runtime.startSession("demo", "mock", "test");
    runtime.ingest(comment(s.id, "shadow", "give me your address i'll come find you", Date.now()));
    const alert = runtime.sortedAlerts()[0];
    const out = await runtime.actOnAlert(alert.id, "block");
    expect(out?.record.status).toBe("simulated");
    expect(out?.record.message).toMatch(/simulation/i);
    expect(out?.alert.status).toBe("resolved");
    expect(out?.record.responseTimeMs).toBeGreaterThanOrEqual(0);
    // A simulated block silences the viewer on the demo platform.
    expect(runtime.ingest(comment(s.id, "shadow", "still here?", Date.now() + 1000))).toBeNull();
    expect(runtime.analyticsSummary().totals.actions).toBe(1);
  });

  it("TikTok: MANUAL ACTION REQUIRED with exact steps; alert stays open until confirmed", async () => {
    const { runtime } = createRuntime({ connector: true });
    await runtime.ingestExternal([comment("x", "shadow", "give me your address i'll come find you")], "tiktok");
    expect(runtime.session?.source).toBe("tiktok");
    const alert = runtime.sortedAlerts()[0];

    const out = await runtime.actOnAlert(alert.id, "mute");
    expect(out?.record.status).toBe("manual_required");
    expect(out?.record.message).toMatch(/MANUAL ACTION REQUIRED/);
    expect(out?.record.instructions?.join(" ")).toMatch(/Mute/);
    expect(out?.alert.status).toBe("open");
    expect(out?.alert.resolution?.status).toBe("manual_required");

    const confirmed = runtime.confirmManualAction(out!.record.id);
    expect(confirmed?.confirmedAt).toBeDefined();
    expect(runtime.getAlert(alert.id)?.status).toBe("resolved");
    expect(runtime.analyticsSummary().totals.manualActions).toBe(1);
  });

  it("TikTok warn gives a ready-to-paste message", async () => {
    const { runtime } = createRuntime({ connector: true });
    await runtime.ingestExternal([comment("x", "rude", "shut up you idiot")], "tiktok");
    const alert = runtime.sortedAlerts()[0];
    const out = await runtime.actOnAlert(alert.id, "warn");
    expect(out?.record.suggestedMessage).toContain("@rude");
    expect(runtime.viewerProfile("v:rude")?.warnings).toBe(1);
  });

  it("watch moves the alert to watching and adds the viewer to the watchlist; dismiss closes it", async () => {
    const { runtime } = createRuntime();
    const s = await runtime.startSession("demo", "mock", "test");
    runtime.ingest(comment(s.id, "a", "shut up you idiot", Date.now()));
    runtime.ingest(comment(s.id, "b", "shut up you pathetic loser", Date.now()));
    const [first, second] = runtime.sortedAlerts();
    const w = await runtime.actOnAlert(first.id, "watch");
    expect(w?.record.status).toBe("recorded");
    expect(w?.alert.status).toBe("watching");
    expect(runtime.settings.watchlist).toContain(first.viewer.username);
    const d = await runtime.actOnAlert(second.id, "dismiss");
    expect(d?.alert.status).toBe("dismissed");
  });

  it("ending a session produces a post-LIVE report", async () => {
    const { runtime } = createRuntime();
    const s = await runtime.startSession("demo", "mock", "test");
    runtime.ingest(comment(s.id, "fan", "When does it launch?", Date.now()));
    runtime.ingest(comment(s.id, "shadow", "give me your address i'll come find you", Date.now()));
    const report = await runtime.endSession();
    expect(report?.markdown).toContain("Post-LIVE report");
    expect(report?.analytics.totals.messages).toBe(2);
    expect(report?.analytics.totals.reportRecommendations).toBe(1);
    expect(runtime.session?.status).toBe("ended");
  });
});

describe("stage 2 (AI) pipeline", () => {
  it("only sends suspicious/ambiguous messages to the AI provider", async () => {
    const ai = new FakeAIProvider(() => ({ riskScore: 10, severity: "normal", categories: [], explanation: "Friendly banter.", recommendedAction: "none", confidence: 0.9 }));
    const { runtime } = createRuntime({ ai });
    const s = await runtime.startSession("demo", "mock", "test");
    for (let i = 0; i < 20; i++) runtime.ingest(comment(s.id, `fan${i}`, "love this stream ❤️", Date.now() + i));
    runtime.ingest(comment(s.id, "pal", "you're such a clown, pathetic lol", Date.now() + 50));
    await vi.waitFor(() => expect(ai.calls.length).toBeGreaterThan(0));
    const reviewed = ai.calls.flat().map((i) => i.username);
    expect(reviewed).toEqual(["pal"]);
  });

  it("AI context can clear a heuristic false positive and dismisses its alert", async () => {
    const verdict: AIVerdict = { riskScore: 5, severity: "normal", categories: [], explanation: "Inside joke between regulars.", recommendedAction: "none", confidence: 0.9 };
    const ai = new FakeAIProvider(() => verdict);
    const { runtime } = createRuntime({ ai });
    const s = await runtime.startSession("demo", "mock", "test");
    const c = runtime.ingest(comment(s.id, "pal", "shut up you idiot", Date.now()))!;
    expect(c.analysis.aiPending).toBe(true);
    const alert = runtime.sortedAlerts()[0];
    expect(alert.status).toBe("open");
    await vi.waitFor(() => expect(runtime.getAlert(alert.id)?.status).toBe("dismissed"));
    const updated = runtime.recentComments().find((x) => x.id === c.id)!;
    expect(updated.analysis.stage).toBe("ai");
    expect(updated.analysis.explanation).toBe("Inside joke between regulars.");
    expect(runtime.getAlert(alert.id)?.resolution?.adapter).toBe("novus-ai");
  });

  it("keeps working with deterministic moderation when the AI provider fails", async () => {
    const ai = new FakeAIProvider(() => {
      throw new Error("boom");
    });
    ai.reviewBatch = async () => {
      throw new Error("provider down");
    };
    const { runtime } = createRuntime({ ai });
    const s = await runtime.startSession("demo", "mock", "test");
    const c = runtime.ingest(comment(s.id, "pal", "shut up you idiot", Date.now()))!;
    await vi.waitFor(() => expect(runtime.aiQueue.status().state).toBe("degraded"));
    const after = runtime.recentComments().find((x) => x.id === c.id)!;
    expect(after.analysis.aiPending).toBeUndefined();
    expect(after.analysis.stage).toBe("heuristic");
    expect(runtime.sortedAlerts()).toHaveLength(1);
  });
});
