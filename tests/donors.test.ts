import request from "supertest";
import { describe, expect, it } from "vitest";
import type { LiveGift, LiveSessionInfo } from "../shared/types";
import { buildDonors, donorRetention, donorsCsv } from "../server/analytics/donors";
import { createApp } from "../server/app";
import { RoomRegistry, type Room } from "../server/core/Rooms";
import { MemoryRepository } from "../server/persistence/MemoryRepository";
import type { GiftLedgerRow } from "../server/persistence/Repository";
import { RealtimeHub } from "../server/realtime/RealtimeHub";
import { createRuntime } from "./helpers";

const T0 = Date.parse("2026-09-20T20:00:00Z");
const row = (over: Partial<GiftLedgerRow>): GiftLedgerRow => ({ viewerId: "v1", username: "king", displayName: "King 👑", account: "roomA", sessionId: "s1", giftName: "Rose", gifts: 1, diamonds: 1, firstAt: T0, lastAt: T0, ...over });

describe("Donor directory", () => {
  it("aggregates each donor across rooms, LIVEs and gift types", () => {
    const dir = buildDonors([
      row({ giftName: "Rose", gifts: 30, diamonds: 30 }),
      row({ giftName: "Lion", gifts: 1, diamonds: 29_999, lastAt: T0 + 60_000 }),
      row({ sessionId: "s2", account: "roomB", giftName: "Rose", gifts: 10, diamonds: 10, firstAt: T0 - 86_400_000, lastAt: T0 - 86_000_000 }),
      row({ viewerId: "v2", username: "fan", displayName: undefined, giftName: "Heart", gifts: 5, diamonds: 25 }),
    ]);
    expect(dir.totals).toMatchObject({ donors: 2, diamonds: 30_064, gifts: 46, lives: 2 });
    expect(dir.accounts).toEqual(["roomA", "roomB"]);
    const king = dir.donors[0];
    expect(king.viewer.username).toBe("king");
    expect(king.diamonds).toBe(30_039);
    expect(king.lives).toBe(2);
    expect(king.avgDiamondsPerLive).toBe(15_020);
    expect(king.favoriteGift).toEqual({ name: "Rose", count: 40 });
    expect(king.byGift[0].name).toBe("Lion");
    expect(king.rooms.map((r) => [r.account, r.diamonds, r.lives])).toEqual([["roomA", 30_029, 1], ["roomB", 10, 1]]);
    expect(king.firstAt).toBe(T0 - 86_400_000);
    expect(king.lastAt).toBe(T0 + 60_000);
    expect(king.share).toBeCloseTo(99.9, 1);
    expect(buildDonors([]).totals.donors).toBe(0);
  });

  it("exports a spreadsheet-safe CSV in both languages", () => {
    const dir = buildDonors([row({ username: "king", displayName: "=HYPERLINK(\"x\")", gifts: 2, diamonds: 2 })]);
    const fr = donorsCsv(dir, "fr", "Europe/Paris");
    expect(fr.startsWith("﻿\"rang\";\"pseudo\"")).toBe(true);
    expect(fr).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(fr).toContain("\"Rose (x2)\";\"Rose x2 (2)\";\"roomA: 2\"");
    expect(donorsCsv(dir, "en", "UTC")).toContain("\"rank\",\"username\"");
  });
});

describe("Donor directory API", () => {
  it("records real LIVE gifts (not demo ones) and filters by room and period", async () => {
    const repo = new MemoryRepository();
    const { runtime, tiktok } = createRuntime({ repo });
    const main: Room = { id: "main", kind: "main", runtime, hub: new RealtimeHub(50), tiktok, dispose: async () => undefined };
    const app = createApp({ config: { production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 1000, ingestRateLimitPerMinute: 1000 }, rooms: new RoomRegistry(main) });

    const now = Date.now();
    const sessions: LiveSessionInfo[] = [
      { id: "a", platform: "tiktok", source: "tiktok", title: "A", status: "ended", startedAt: now - 3600_000, account: "rooma" },
      { id: "old", platform: "tiktok", source: "tiktok", title: "Old", status: "ended", startedAt: now - 40 * 86_400_000, account: "roomb" },
      { id: "d", platform: "tiktok", source: "demo", title: "Demo", status: "ended", startedAt: now },
    ];
    for (const s of sessions) await repo.saveSession(s);
    const gift = (sessionId: string, username: string, giftName: string, count: number, value: number, timestamp: number): LiveGift => ({ id: `${sessionId}-${username}-${timestamp}`, sessionId, platform: "tiktok", timestamp, type: "gift", viewer: { id: username, username }, giftName, count, value });
    await repo.writeBatch({
      events: [gift("a", "king", "Rose", 3, 1, now - 60_000), gift("a", "king", "Rose", 2, 1, now - 30_000), gift("a", "king", "Lion", 1, 29_999, now - 20_000), gift("old", "king", "Rose", 1, 1, now - 40 * 86_400_000), gift("d", "bot", "Galaxy", 1, 1000, now)],
      comments: [],
      alerts: [],
      actions: [],
      viewers: [],
      analyses: [],
    });

    const all = (await request(app).get("/api/donors").expect(200)).body;
    expect(all.totals.donors).toBe(1);
    expect(all.donors[0].diamonds).toBe(30_005);
    expect(all.donors[0].gifts).toBe(7);
    expect(all.donors[0].rooms).toHaveLength(2);
    expect(all.accounts).toEqual(["rooma", "roomb"]);

    const recent = (await request(app).get("/api/donors?days=30").expect(200)).body;
    expect(recent.donors[0].diamonds).toBe(30_004);
    const roomB = (await request(app).get("/api/donors?account=roomb").expect(200)).body;
    expect(roomB.totals.diamonds).toBe(1);

    const csv = await request(app).get("/api/donors.csv").expect(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).toContain("king");
  });
});

describe("donor retention", () => {
  const DAY = 24 * 3600 * 1000;
  const now = Date.UTC(2026, 9, 5);
  const at = (daysAgo: number, sessionId: string, diamonds: number, giftName = "Rose") =>
    row({ sessionId, giftName, gifts: 1, diamonds, firstAt: now - daysAgo * DAY, lastAt: now - daysAgo * DAY });

  it("tells active, cooling, lost and new donors apart from their real pace", () => {
    const steady = donorRetention([at(40, "a", 5), at(37, "b", 5), at(34, "c", 5), at(2, "d", 30, "Lion")], now);
    expect(steady.retention.status).toBe("active");
    expect(steady.retention.gapDays).toBe(3);
    expect(steady.retention.last30).toBe(30);
    expect(steady.retention.prev30).toBe(15);
    expect(steady.retention.bestLive).toBe(30);
    expect(steady.retention.topGift).toEqual({ name: "Lion", value: 30 });
    expect(steady.history.map((h) => h.sessionId)).toEqual(["a", "b", "c", "d"]);

    expect(donorRetention([at(30, "a", 5), at(27, "b", 5), at(24, "c", 5), at(12, "d", 5)], now).retention.status).toBe("cooling");
    expect(donorRetention([at(90, "a", 5), at(80, "b", 5)], now).retention.status).toBe("lost");
    expect(donorRetention([at(3, "a", 5)], now).retention.status).toBe("new");
  });

  it("counts every status in the directory totals", () => {
    const dir = buildDonors([row({ viewerId: "v1", firstAt: now - DAY, lastAt: now - DAY }), row({ viewerId: "v2", firstAt: now - 100 * DAY, lastAt: now - 100 * DAY })], now);
    expect(dir.totals.status).toEqual({ new: 1, active: 0, cooling: 0, lost: 1 });
  });
});
