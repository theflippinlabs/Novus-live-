import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, type Space } from "../server/app";
import { EulerChatSender } from "../server/chat/EulerChat";
import { RoomRegistry, tiktokRoomId, type Room } from "../server/core/Rooms";
import { MemoryRepository } from "../server/persistence/MemoryRepository";
import { TikTokAdapter } from "../server/platform/TikTokAdapter";
import { RealtimeHub } from "../server/realtime/RealtimeHub";
import { createRuntime } from "./helpers";

const FOUNDER = "founder-access-key-123";

async function setup() {
  const repo = new MemoryRepository();
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
  const space: Space = { id: "owner", rooms, chat: new EulerChatSender({}, repo) };
  const app = createApp({
    config: { accessToken: FOUNDER, production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 10_000, ingestRateLimitPerMinute: 1000, sessionSecret: "test-secret" },
    spaces: [space],
  });
  const login = async (key: string) => (await request(app).post("/api/auth/login").send({ key }).expect(200)).headers["set-cookie"][0].split(";")[0];
  const founder = await login(FOUNDER);
  await request(app).put("/api/settings").set("Cookie", founder).send({ tiktokProfiles: ["w_amanda_g", "odwnzcte", "myiort"] }).expect(200);
  return { app, login, founder, rooms };
}

describe("Agency team", () => {
  it("the founder adds members with their own code, role and permissions", async () => {
    const { app, login, founder } = await setup();
    expect((await request(app).get("/api/auth/me").set("Cookie", founder).expect(200)).body).toMatchObject({ kind: "founder", teamEnabled: true, accounts: null });

    const created = await request(app)
      .post("/api/team")
      .set("Cookie", founder)
      .send({ name: "Sarah", role: "moderator", permissions: ["moderate"], accounts: ["w_amanda_g"] })
      .expect(200);
    expect(created.body.code).toMatch(/^team-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    const list = await request(app).get("/api/team").set("Cookie", founder).expect(200);
    expect(list.body.members).toHaveLength(1);
    // The code is never stored or listed in clear.
    expect(JSON.stringify(list.body)).not.toContain(created.body.code);

    const sarah = await login(created.body.code);
    const me = await request(app).get("/api/auth/me").set("Cookie", sarah).expect(200);
    expect(me.body).toMatchObject({ kind: "member", permissions: ["moderate"], accounts: ["w_amanda_g"], member: { name: "Sarah", role: "moderator" } });

    // Only her streamer is visible.
    const rooms = await request(app).get("/api/rooms").set("Cookie", sarah).expect(200);
    expect(rooms.body.rooms.map((r: { id: string }) => r.id)).toEqual(["main", "tt:w_amanda_g"]);
    await request(app).get("/api/state").set("Cookie", sarah).set("X-Novus-Room", "tt:odwnzcte").expect(404);
    await request(app).get("/api/state").set("Cookie", sarah).set("X-Novus-Room", "tt:w_amanda_g").expect(200);

    // No permission, no action.
    await request(app).put("/api/settings").set("Cookie", sarah).send({ sensitivity: "strict" }).expect(403);
    await request(app).put("/api/settings").set("Cookie", sarah).send({ tiktokProfiles: [] }).expect(403);
    await request(app).get("/api/history").set("Cookie", sarah).set("X-Novus-Room", "tt:w_amanda_g").expect(403);
    await request(app).get("/api/team").set("Cookie", sarah).expect(403);
    await request(app).post("/api/chat-sender/connect").set("Cookie", sarah).send({}).expect(403);
    await request(app).post("/api/integrations/tiktok/connect").set("Cookie", sarah).send({ username: "someone" }).expect(403);
    // The language is free to change.
    await request(app).put("/api/settings").set("Cookie", sarah).send({ language: "fr" }).expect(200);
  });

  it("a director can delegate, but never more than they have", async () => {
    const { app, login, founder } = await setup();
    const dir = await request(app)
      .post("/api/team")
      .set("Cookie", founder)
      .send({ name: "Karim", role: "director", permissions: ["moderate", "history", "team"], accounts: ["w_amanda_g", "odwnzcte"] })
      .expect(200);
    const karim = await login(dir.body.code);

    // Within his own rights: OK.
    const mgr = await request(app)
      .post("/api/team")
      .set("Cookie", karim)
      .send({ name: "Lea", role: "manager", permissions: ["moderate", "history"], accounts: ["odwnzcte"] })
      .expect(200);
    // More permissions or other streamers: refused.
    await request(app).post("/api/team").set("Cookie", karim).send({ name: "X", role: "manager", permissions: ["settings"], accounts: ["odwnzcte"] }).expect(403);
    await request(app).post("/api/team").set("Cookie", karim).send({ name: "X", role: "manager", permissions: ["moderate"], accounts: ["myiort"] }).expect(403);
    await request(app).post("/api/team").set("Cookie", karim).send({ name: "X", role: "manager", permissions: ["moderate"], accounts: null }).expect(403);
    // He cannot change himself.
    await request(app).patch(`/api/team/${dir.body.member.id}`).set("Cookie", karim).send({ permissions: ["moderate", "history", "team", "settings"] }).expect(403);

    // Lea works on her streamer with history.
    const lea = await login(mgr.body.code);
    await request(app).get("/api/history").set("Cookie", lea).set("X-Novus-Room", "tt:odwnzcte").expect(200);

    // Karim removes Lea: her session stops working.
    await request(app).delete(`/api/team/${mgr.body.member.id}`).set("Cookie", karim).send({}).expect(200);
    await request(app).get("/api/state").set("Cookie", lea).expect(401);
  });

  it("disabling a member or regenerating the code logs them out", async () => {
    const { app, login, founder } = await setup();
    const m = await request(app).post("/api/team").set("Cookie", founder).send({ name: "Tom", role: "manager", permissions: ["moderate"], accounts: null }).expect(200);
    const tom = await login(m.body.code);
    await request(app).get("/api/state").set("Cookie", tom).expect(200);

    const fresh = await request(app).post(`/api/team/${m.body.member.id}/code`).set("Cookie", founder).send({}).expect(200);
    await request(app).get("/api/state").set("Cookie", tom).expect(401);
    await request(app).post("/api/auth/login").send({ key: m.body.code }).expect(401);
    const tom2 = await login(fresh.body.code);

    await request(app).patch(`/api/team/${m.body.member.id}`).set("Cookie", founder).send({ disabled: true }).expect(200);
    await request(app).get("/api/state").set("Cookie", tom2).expect(401);
    await request(app).post("/api/auth/login").send({ key: fresh.body.code }).expect(401);
  });

  it("a forged member cookie is refused", async () => {
    const { app, founder } = await setup();
    const m = await request(app).post("/api/team").set("Cookie", founder).send({ name: "Eve", role: "moderator", permissions: ["moderate"], accounts: null }).expect(200);
    await request(app).get("/api/state").set("Cookie", `novus_auth=m.owner.${m.body.member.id}.forged-signature`).expect(401);
  });
});
