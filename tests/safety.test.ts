import { describe, expect, it } from "vitest";
import type { LiveEvent, LiveSafetyEvent } from "../shared/types";
import { reporterLabel, safetyFacts } from "../shared/safety";
import type { AIProvider, CopilotRequest } from "../server/ai/AIProvider";
import { MemoryRepository } from "../server/persistence/MemoryRepository";
import { safetyCounts, tiktokSafetyAdapter } from "../server/platform/safetyEvents";
import { comment, createRuntime } from "./helpers";

const map = (event: string, raw: unknown) => tiktokSafetyAdapter.map(event, raw);

describe("TikTok safety adapter", () => {
  it("maps only what TikTok actually sends, and never a reporter", () => {
    const warning = map("perception", { common: { msgId: "77" }, showViolationWarning: true, dialog: { title: { defaultPattern: "Your LIVE may violate our Community Guidelines" }, subTitle: { defaultPattern: "Please follow the rules" } } });
    expect(warning).toMatchObject({ id: "tt:safety:77", eventType: "warning", severity: "high", source: "tiktok:perception", reporterDisclosed: false, captured: "novus" });
    expect(warning?.reporter).toBeUndefined();
    expect(warning?.description).toContain("Please follow the rules");

    const limited = map("perception", { common: { msgId: "78" }, punishInfo: { punishTypeId: 70, showReason: "Content not suitable", violationUidStr: "123" } });
    expect(limited).toMatchObject({ eventType: "visibility_action", severity: "critical", target: { id: "tt:123" } });

    expect(map("controlMessage", { common: { msgId: "1" }, action: 4 })).toMatchObject({ eventType: "restriction", severity: "critical", title: "LIVE suspended by TikTok" });
    expect(map("controlMessage", { common: { msgId: "2" }, action: 1 })).toMatchObject({ eventType: "interruption", severity: "warning" });
    // A normal end is not a safety event.
    expect(map("controlMessage", { common: { msgId: "3" }, action: 3 })).toBeNull();
    expect(map("imDelete", { common: { msgId: "4" }, deleteMsgIds: ["a", "b"], deleteUserIds: ["9"] })).toMatchObject({ eventType: "content_action", severity: "info", title: "2 comments removed in TikTok" });
    expect(map("roomVerify", { common: { msgId: "5" }, content: "Verify", closeRoom: true })).toMatchObject({ severity: "critical", eventType: "restriction" });
    // Empty or unrelated messages are ignored.
    expect(map("perception", { common: { msgId: "6" } })).toBeNull();
    expect(map("chat", { content: "hello" })).toBeNull();
  });

  it("gives a resent message without an id the same id", () => {
    const a = map("roomVerify", { content: "Verify your LIVE", action: 1 });
    const b = map("roomVerify", { content: "Verify your LIVE", action: 1 });
    expect(a?.id).toBe(b?.id);
  });

  it("only shows a reporter TikTok explicitly disclosed", () => {
    expect(reporterLabel({ reporterDisclosed: false }, "fr")).toBe("Non communiqué par TikTok");
    expect(reporterLabel({ reporterDisclosed: false, reporter: { username: "x" } }, "en")).toBe("Not disclosed by TikTok");
    expect(reporterLabel({ reporterDisclosed: true, reporter: { username: "x" } }, "en")).toBe("@x");
  });
});

describe("Safety events in a LIVE", () => {
  const safety = (over: Partial<LiveSafetyEvent> = {}): LiveEvent => ({ ...(map("perception", { common: { msgId: "w1" }, showViolationWarning: true, dialog: { title: { defaultPattern: "TikTok warning" } } }) as LiveSafetyEvent), sessionId: "", platform: "tiktok", ...over });

  it("stores each event once, with the context of the minutes before, and counts it", async () => {
    const repo = new MemoryRepository();
    const { runtime } = createRuntime({ repo, account: "streamer" });
    await runtime.ingestExternal([{ id: "s", type: "stream_status", status: "started", timestamp: Date.now(), sessionId: "", platform: "tiktok" }], "tiktok");
    const sid = runtime.session!.id;
    const now = Date.now();
    await runtime.ingestExternal(
      [
        { id: "v1", type: "viewer_count", count: 218, timestamp: now - 120_000, sessionId: "", platform: "tiktok" },
        comment(sid, "alice", "hello", now - 100_000),
        comment(sid, "bob", "you are an idiot loser", now - 90_000),
        { id: "j1", type: "join", viewer: { id: "v:c", username: "carol" }, timestamp: now - 60_000, sessionId: "", platform: "tiktok" },
        { id: "v2", type: "viewer_count", count: 341, timestamp: now - 5_000, sessionId: "", platform: "tiktok" },
      ],
      "tiktok",
    );
    // The provider claims nothing about a reporter: one that is not explicitly disclosed is dropped.
    await runtime.ingestExternal([safety({ timestamp: now, reporter: { username: "guess" } })], "tiktok");
    // Resent (same id) and the same notice under a new id seconds later: counted once.
    await runtime.ingestExternal([safety({ timestamp: now }), safety({ id: "tt:safety:w2", timestamp: now + 2000 })], "tiktok");

    const events = runtime.safetyEvents();
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.reporter).toBeUndefined();
    expect(ev.reporterDisclosed).toBe(false);
    expect(ev.context).toMatchObject({ comments: 2, joins: 1, viewers: { start: 218, end: 341 } });
    expect(ev.context!.activeUsers).toEqual(expect.arrayContaining(["alice", "bob"]));
    expect(safetyFacts(ev.context, "en").join(" ")).toContain("Viewers: from 218 to 341");
    expect(runtime.snapshot().safety).toHaveLength(1);
    expect(runtime.report().safety).toEqual({ total: 1, warnings: 1, restrictions: 0, critical: 0 });

    await runtime.flushPersist();
    const stored = await repo.getSafetyEvents([sid]);
    expect(stored).toHaveLength(1);
    expect(stored[0].context?.comments).toBe(2);
  });

  it("asks the AI once, with hedged wording rules and no reporter, and keeps the answer", async () => {
    const seen: CopilotRequest[] = [];
    const ai: AIProvider = {
      name: "fake",
      available: () => true,
      reviewBatch: async () => new Map(),
      copilot: async (req) => {
        seen.push(req);
        return "Possible contextual trigger: elevated chat toxicity.\nConfidence: Medium";
      },
    };
    const { runtime } = createRuntime({ ai, account: "streamer" });
    await runtime.ingestExternal([{ id: "s", type: "stream_status", status: "started", timestamp: Date.now(), sessionId: "", platform: "tiktok" }], "tiktok");
    await runtime.ingestExternal([safety({ timestamp: Date.now() })], "tiktok");
    // A HIGH event gets one automatic reading.
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(1);
    expect(seen[0].instruction).toMatch(/never state a cause as fact/i);
    expect(seen[0].instruction).toMatch(/never name, guess or hint at who reported/i);
    expect(JSON.parse(seen[0].context).event.reporter).toBe("not disclosed by TikTok");
    expect(runtime.safetyEvents()[0].analysis?.text).toContain("Confidence: Medium");
  });

  it("counts warnings, restrictions and critical events", () => {
    expect(
      safetyCounts([
        { eventType: "warning", severity: "high" },
        { eventType: "restriction", severity: "critical" },
        { eventType: "visibility_action", severity: "critical" },
        { eventType: "content_action", severity: "info" },
      ]),
    ).toEqual({ total: 4, warnings: 1, restrictions: 2, critical: 2 });
  });
});

describe("Safety API", () => {
  it("serves the current LIVE's events and a past LIVE's stored ones with its count", async () => {
    const { createApp } = await import("../server/app");
    const { RoomRegistry } = await import("../server/core/Rooms");
    const { RealtimeHub } = await import("../server/realtime/RealtimeHub");
    const request = (await import("supertest")).default;
    const repo = new MemoryRepository();
    const { runtime, tiktok } = createRuntime({ repo });
    const main = { id: "main", kind: "main" as const, runtime, hub: new RealtimeHub(50), tiktok, dispose: async () => undefined };
    const app = createApp({ config: { production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 1000, ingestRateLimitPerMinute: 1000 }, rooms: new RoomRegistry(main) });

    expect((await request(app).get("/api/safety").expect(200)).body.events).toEqual([]);

    await runtime.ingestExternal([{ id: "s", type: "stream_status", status: "started", timestamp: Date.now(), sessionId: "", platform: "tiktok" }], "tiktok");
    const ev = { ...(map("controlMessage", { common: { msgId: "x1" }, action: 4 }) as LiveSafetyEvent), sessionId: "", platform: "tiktok" as const };
    await runtime.ingestExternal([comment("", "alice", "hi"), ev], "tiktok");
    const live = (await request(app).get("/api/safety").expect(200)).body.events;
    expect(live).toHaveLength(1);
    expect(live[0].severity).toBe("critical");

    const sid = runtime.session!.id;
    await runtime.endSession();
    const past = (await request(app).get(`/api/history/${sid}/safety`).expect(200)).body.events;
    expect(past).toHaveLength(1);
    const entry = (await request(app).get(`/api/history/${sid}`).expect(200)).body.entry;
    expect(entry.safety).toEqual({ total: 1, warnings: 0, restrictions: 1, critical: 1 });
    // No AI configured: the analysis is refused, nothing is made up.
    await request(app).post(`/api/safety/${encodeURIComponent(ev.id)}/analysis`).send({ sessionId: sid }).expect(503);
  });
});
