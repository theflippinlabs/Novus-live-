import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AIReviewItem, AIVerdict, CopilotRequest } from "../server/ai/AIProvider";
import { createApp } from "../server/app";
import { RoomRegistry, type Room } from "../server/core/Rooms";
import { RealtimeHub } from "../server/realtime/RealtimeHub";
import { comment, createRuntime, FakeAIProvider } from "./helpers";

class CopilotAI extends FakeAIProvider {
  requests: CopilotRequest[] = [];
  constructor() {
    super((i: AIReviewItem) => ({ id: i.id, riskScore: 10, severity: "normal", categories: [], explanation: "ok", recommendedAction: "none", confidence: 0.9 }) as AIVerdict);
  }
  async copilot(req: CopilotRequest) {
    this.requests.push(req);
    return req.mode === "draft" ? "“Merci pour ta question, on en parle tout de suite !”" : "Tout va bien : 3 questions en attente.";
  }
}

function makeApp(ai = new CopilotAI()) {
  const { runtime, tiktok } = createRuntime({ ai });
  const main: Room = { id: "main", kind: "main", runtime, hub: new RealtimeHub(50), tiktok, dispose: async () => undefined };
  const app = createApp({
    config: { production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 1000, ingestRateLimitPerMinute: 1000 },
    rooms: new RoomRegistry(main),
  });
  return { app, runtime, ai };
}

describe("LIVE copilot", () => {
  it("coaches with what needs the streamer now, most urgent first", async () => {
    const { runtime } = createRuntime();
    expect(runtime.coach("fr")[0].kind).toBe("idle");

    const s = await runtime.startSession("demo", "mock", "test");
    const t = Date.now() - 30_000;
    ["Quand sort l'application ?", "c'est quand la sortie de l'appli ??", "when does the app launch?"].forEach((q, i) => runtime.ingest(comment(s.id, `fan${i}`, q, t + i * 500)));
    runtime.ingest({ type: "gift", id: "g1", sessionId: s.id, platform: "mock", timestamp: t + 2000, viewer: { id: "v:bigfan", username: "bigfan", displayName: "Big Fan ✨" }, giftName: "Rose", count: 5, value: 1 });
    runtime.ingest(comment(s.id, "shadow", "give me your address i'll come find you", t + 3000));

    const tips = runtime.coach("fr");
    expect(tips[0]).toMatchObject({ kind: "alerts", priority: 1 });
    expect(tips[0].title).toContain("critique");
    const q = tips.find((x) => x.kind === "question")!;
    expect(q.questionId).toBeTruthy();
    expect(q.detail).toContain("fois");
    const sup = tips.find((x) => x.kind === "supporter")!;
    expect(sup.viewer?.username).toBe("bigfan");
    expect(runtime.pulse().supporters[0]).toMatchObject({ gifts: 5, diamonds: 5 });
    expect(runtime.coach("en").find((x) => x.kind === "supporter")?.title).toBe("Thank @bigfan");
  });

  it("answers from a fresh LIVE snapshot and keeps the conversation", async () => {
    const { app, runtime, ai } = makeApp();
    const s = await runtime.startSession("demo", "mock", "test");
    runtime.ingest(comment(s.id, "fan1", "on veut un giveaway !!"));
    const res = await request(app)
      .post("/api/assistant/ask")
      .send({ question: "Que demande le chat ?", history: [{ role: "user", text: "Salut" }, { role: "assistant", text: "Bonjour !" }], lang: "fr" })
      .expect(200);
    expect(res.body.text).toContain("questions");
    const req = ai.requests[0];
    expect(req).toMatchObject({ mode: "chat", instruction: "Que demande le chat ?", language: "fr" });
    expect(req.history).toHaveLength(2);
    const ctx = JSON.parse(req.context);
    expect(ctx.recentChat.join("\n")).toContain("giveaway");
    expect(ctx.audience.messagesTotal).toBe(1);

    await request(app).post("/api/assistant/ask").send({ question: "" }).expect(400);
  });

  it("drafts a chat reply to a real question, never an unknown one", async () => {
    const { app, runtime } = makeApp();
    const s = await runtime.startSession("demo", "mock", "test");
    const t = Date.now() - 10_000;
    ["Quand sort l'application ?", "c'est quand la sortie de l'appli ??"].forEach((q, i) => runtime.ingest(comment(s.id, `f${i}`, q, t + i * 500)));
    const id = runtime.pulse().topQuestions[0].id;
    const res = await request(app).post("/api/assistant/draft").send({ kind: "question", questionId: id, lang: "fr" }).expect(200);
    expect(res.body.text).toBe("Merci pour ta question, on en parle tout de suite !");
    await request(app).post("/api/assistant/draft").send({ kind: "question", questionId: "nope" }).expect(404);
    await request(app).post("/api/assistant/draft").send({ kind: "thanks", viewerId: "v:nobody" }).expect(404);
  });

  it("says clearly when the AI is not available", async () => {
    const { runtime, tiktok } = createRuntime();
    const main: Room = { id: "main", kind: "main", runtime, hub: new RealtimeHub(50), tiktok, dispose: async () => undefined };
    const app = createApp({ config: { production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 1000, ingestRateLimitPerMinute: 1000 }, rooms: new RoomRegistry(main) });
    await request(app).post("/api/assistant/ask").send({ question: "Résume" }).expect(503, { error: "ai_unavailable" });
    const tips = (await request(app).get("/api/assistant/coach?lang=fr").expect(200)).body.tips;
    expect(tips[0].kind).toBe("idle");
  });

  it("sends a copilot message only during a TikTok LIVE", async () => {
    const { app } = makeApp();
    await request(app).post("/api/assistant/send-chat").send({ text: "Merci à tous !" }).expect(409, { error: "chat_not_live" });
    await request(app).post("/api/assistant/send-chat").send({ text: "" }).expect(400);
  });
});
