import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp, type Space } from "../server/app";
import { EulerChatSender } from "../server/chat/EulerChat";
import { RoomRegistry, tiktokRoomId, type Room } from "../server/core/Rooms";
import { accessKeys } from "../server/http/security";
import { MemoryRepository } from "../server/persistence/MemoryRepository";
import { TikTokAdapter } from "../server/platform/TikTokAdapter";
import { RealtimeHub } from "../server/realtime/RealtimeHub";
import { createRuntime } from "./helpers";

const OWNER_KEY = "owner-access-key-123";
const BETA_KEY = "beta-y3fb-8quv-zmvx";
const dir = mkdtempSync(join(tmpdir(), "novus-spaces-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function space(base: MemoryRepository, tenant: string): Promise<Space> {
  const repo = base.scoped(tenant);
  const { runtime, tiktok } = createRuntime({ repo });
  await runtime.init();
  const main: Room = { id: "main", kind: "main", runtime, hub: new RealtimeHub(50), tiktok, dispose: async () => undefined };
  const rooms = new RoomRegistry(main, async (username) => {
    const r = createRuntime({ repo, account: username });
    await r.runtime.init();
    const tt = new TikTokAdapter(false);
    await tt.connect(username);
    return { id: tiktokRoomId(username), kind: "tiktok", username, runtime: r.runtime, hub: new RealtimeHub(50), tiktok: tt, dispose: async () => undefined };
  });
  return { id: tenant, rooms, chat: new EulerChatSender({}, repo) };
}

describe("Separate spaces per access key", () => {
  it("names a space from 'name:key' and keeps the owner first", () => {
    expect(accessKeys(OWNER_KEY, [`Beta:${BETA_KEY}`, "bare-key-without-name"], "owner")).toEqual([
      { key: OWNER_KEY, tenant: "owner" },
      { key: BETA_KEY, tenant: "beta" },
      { key: "bare-key-without-name", tenant: expect.stringMatching(/^k[0-9a-f]{10}$/) },
    ]);
  });

  it("gives each person their own followed accounts, settings and history", async () => {
    const base = new MemoryRepository(dir);
    const spaces = [await space(base, "owner"), await space(base, "beta")];
    const app = createApp({
      config: { accessToken: OWNER_KEY, accessTokens: [`beta:${BETA_KEY}`], production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 1000, ingestRateLimitPerMinute: 1000 },
      spaces,
    });
    const login = async (key: string) => (await request(app).post("/api/auth/login").send({ key }).expect(200)).headers["set-cookie"][0].split(";")[0];
    const owner = await login(OWNER_KEY);
    const beta = await login(BETA_KEY);

    // Followed accounts and settings are per space.
    await request(app).post("/api/integrations/tiktok/connect").set("Cookie", owner).send({ username: "w_amanda_g" }).expect(200);
    await request(app).put("/api/settings").set("Cookie", owner).send({ sensitivity: "strict" }).expect(200);
    await request(app).post("/api/integrations/tiktok/connect").set("Cookie", beta).send({ username: "someone_else" }).expect(200);
    const ownerSettings = (await request(app).get("/api/settings").set("Cookie", owner).expect(200)).body;
    const betaSettings = (await request(app).get("/api/settings").set("Cookie", beta).expect(200)).body;
    expect(ownerSettings.tiktokProfiles).toEqual(["w_amanda_g"]);
    expect(ownerSettings.sensitivity).toBe("strict");
    expect(betaSettings.tiktokProfiles).toEqual(["someone_else"]);
    expect(betaSettings.sensitivity).not.toBe("strict");
    const betaRooms = (await request(app).get("/api/rooms").set("Cookie", beta).expect(200)).body.rooms.map((r: { id: string }) => r.id);
    expect(betaRooms).toEqual(["main", "tt:someone_else"]);
    // A room of another space is not reachable.
    await request(app).get("/api/state").set("Cookie", beta).set("X-Novus-Room", "tt:w_amanda_g").expect(404);

    // LIVE history is per space, and another space's LIVE cannot be opened by id.
    const ownerRuntime = spaces[0].rooms.main.runtime;
    await ownerRuntime.ingestExternal(
      [{ type: "stream_status", status: "started", title: "Owner LIVE" }, { type: "comment", id: "c1", timestamp: Date.now(), viewer: { id: "v1", username: "fan" }, text: "hello" }] as never,
      "tiktok",
    );
    await ownerRuntime.endSession();
    const sessionId = ownerRuntime.session!.id;
    const ownerHistory = (await request(app).get("/api/history").set("Cookie", owner).expect(200)).body.entries;
    const betaHistory = (await request(app).get("/api/history").set("Cookie", beta).expect(200)).body.entries;
    expect(ownerHistory.map((e: { sessionId: string }) => e.sessionId)).toContain(sessionId);
    expect(betaHistory).toHaveLength(0);
    await request(app).get(`/api/history/${sessionId}`).set("Cookie", beta).expect(404);
    await request(app).get(`/api/history/${sessionId}/messages.csv`).set("Cookie", beta).expect(404);
    await request(app).get(`/api/history/${sessionId}`).set("Cookie", owner).expect(200);

    // Settings survive a restart, still separated (one file per space).
    const reloaded = new MemoryRepository(dir);
    await reloaded.init();
    const betaRepo = reloaded.scoped("beta");
    await betaRepo.init();
    expect((await reloaded.loadSettings())?.tiktokProfiles).toEqual(["w_amanda_g"]);
    expect((await betaRepo.loadSettings())?.tiktokProfiles).toEqual(["someone_else"]);
    await ownerRuntime.shutdown();
  });

  it("keeps each space's 'Send in chat' connection separate", async () => {
    const base = new MemoryRepository();
    await base.saveSecret("euler_chat_oauth", { accessToken: "owner-token", connectedAt: 1 });
    const owner = new EulerChatSender({ apiKey: "k", clientId: "c", clientSecret: "s" }, base);
    const beta = new EulerChatSender({ apiKey: "k", clientId: "c", clientSecret: "s" }, base.scoped("beta"));
    expect((await owner.status()).connected).toBe(true);
    expect((await beta.status()).connected).toBe(false);
  });
});
