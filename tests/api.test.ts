import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { RealtimeHub } from "../server/realtime/RealtimeHub";
import { createRuntime } from "./helpers";

const INGEST = "test-ingest-token-0123456789abcdef";

function makeApp(overrides: { accessToken?: string; ingestToken?: string; apiRateLimitPerMinute?: number } = {}) {
  const { runtime, tiktok } = createRuntime({ connector: Boolean(overrides.ingestToken ?? INGEST) });
  const hub = new RealtimeHub(50);
  const app = createApp({
    config: {
      accessToken: overrides.accessToken,
      ingestToken: "ingestToken" in overrides ? overrides.ingestToken : INGEST,
      production: false,
      webDir: "does-not-exist",
      trustProxy: false,
      apiRateLimitPerMinute: overrides.apiRateLimitPerMinute ?? 1000,
      ingestRateLimitPerMinute: 1000,
    },
    runtime,
    hub,
    tiktok,
  });
  return { app, runtime, tiktok };
}

describe("HTTP API", () => {
  it("serves state and never leaks secrets", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/api/state").expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(INGEST);
    expect(body).not.toMatch(/sk-ant|service_role|ANTHROPIC_API_KEY/);
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("validates inputs", async () => {
    const { app } = makeApp();
    await request(app).post("/api/demo/start").send({ speed: 3 }).expect(400);
    await request(app).put("/api/settings").send({ sensitivity: "extreme" }).expect(400);
    await request(app).put("/api/settings").send({ customThresholds: { watch: 60, warning: 50, critical: 90 } }).expect(400);
    await request(app).put("/api/settings").send({ unknownField: true }).expect(400);
    await request(app).post("/api/alerts/nope/action").send({ action: "nuke" }).expect(400);
    await request(app).post("/api/integrations/tiktok/connect").send({ username: "bad name!" }).expect(400);
    // Non-JSON mutations are rejected (CSRF hardening).
    await request(app).post("/api/demo/start").set("Content-Type", "text/plain").send("x").expect(415);
    const ok = await request(app).put("/api/settings").send({ sensitivity: "strict", trustedUsers: ["@OldFriend"] }).expect(200);
    expect(ok.body.sensitivity).toBe("strict");
    expect(ok.body.trustedUsers).toEqual(["oldfriend"]);
  });

  it("protects the connector ingestion endpoint with a bearer token", async () => {
    const { app } = makeApp();
    const events = { events: [{ type: "comment", viewer: { id: "u1", username: "someone" }, text: "hello" }] };
    await request(app).post("/api/ingest/events").send(events).expect(401);
    await request(app).post("/api/ingest/events").set("Authorization", "Bearer wrong-token-wrong-token-xx").send(events).expect(401);
    await request(app).post("/api/ingest/events").set("Authorization", `Bearer ${INGEST}`).send({ events: [{ type: "comment", text: "" }] }).expect(400);
    const res = await request(app).post("/api/ingest/events").set("Authorization", `Bearer ${INGEST}`).send(events).expect(200);
    expect(res.body.accepted).toBe(1);
  });

  it("disables ingestion entirely when no INGEST_TOKEN is configured", async () => {
    const { app } = makeApp({ ingestToken: undefined });
    await request(app).post("/api/ingest/events").set("Authorization", "Bearer anything").send({ events: [] }).expect(503);
  });

  it("drives the TikTok integration states from connector events", async () => {
    const { app, runtime } = makeApp();
    let st = await request(app).get("/api/integrations/tiktok").expect(200);
    expect(st.body.state).toBe("CONNECTOR_AVAILABLE");
    await request(app).post("/api/integrations/tiktok/connect").send({ username: "@novarys" }).expect(200);
    const auth = { Authorization: `Bearer ${INGEST}` };
    await request(app).post("/api/ingest/heartbeat").set(auth).send({}).expect(200);
    st = await request(app).get("/api/integrations/tiktok");
    expect(st.body.state).toBe("CONNECTED");
    await request(app)
      .post("/api/ingest/events")
      .set(auth)
      .send({ events: [{ type: "stream_status", status: "started", title: "Launch night" }, { type: "comment", viewer: { id: "t1", username: "shadow" }, text: "give me your address i'll come find you" }] })
      .expect(200);
    st = await request(app).get("/api/integrations/tiktok");
    expect(st.body.state).toBe("LIVE_DETECTED");
    expect(runtime.session?.title).toBe("Launch night");
    const alerts = await request(app).get("/api/alerts").expect(200);
    expect(alerts.body.alerts[0].severity).toBe("critical");
    // Actions on a TikTok session are manual — Novus does not pretend it muted anyone.
    const act = await request(app).post(`/api/alerts/${alerts.body.alerts[0].id}/action`).send({ action: "block" }).expect(200);
    expect(act.body.record.status).toBe("manual_required");
    await request(app).post("/api/ingest/events").set(auth).send({ events: [{ type: "stream_status", status: "ended" }] }).expect(200);
    st = await request(app).get("/api/integrations/tiktok");
    expect(st.body.state).toBe("LIVE_ENDED");
    expect(runtime.session?.status).toBe("ended");
    await request(app).post("/api/ingest/events").set(auth).send({ events: "nope" }).expect(400);
    st = await request(app).get("/api/integrations/tiktok");
    expect(st.body.state).toBe("ERROR");
  });

  it("requires the access key when APP_ACCESS_TOKEN is set", async () => {
    const { app } = makeApp({ accessToken: "super-secret-access-key" });
    await request(app).get("/api/state").expect(401);
    const status = await request(app).get("/api/auth/status").expect(200);
    expect(status.body).toEqual({ required: true, authenticated: false });
    await request(app).post("/api/auth/login").send({ key: "wrong" }).expect(401);
    const login = await request(app).post("/api/auth/login").send({ key: "super-secret-access-key" }).expect(200);
    const cookie = login.headers["set-cookie"][0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).not.toContain("super-secret-access-key");
    await request(app).get("/api/state").set("Cookie", cookie.split(";")[0]).expect(200);
  });

  it("rate-limits the API", async () => {
    const { app } = makeApp({ apiRateLimitPerMinute: 10 });
    for (let i = 0; i < 10; i++) await request(app).get("/api/health").expect(200);
    const res = await request(app).get("/api/health").expect(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("runs the full moderator flow over HTTP", async () => {
    const { app, runtime } = makeApp();
    await request(app).post("/api/demo/start").send({ speed: 1 }).expect(200);
    const s = runtime.session!;
    runtime.ingest({ type: "comment", id: "x1", sessionId: s.id, platform: "mock", timestamp: Date.now(), viewer: { id: "v:shadow", username: "shadow" }, text: "give me your address i'll come find you" });
    const viewer = await request(app).get("/api/viewers/v:shadow").expect(200);
    expect(viewer.body.profile.messageCount).toBe(1);
    await request(app).post("/api/viewers/v:shadow/flag").send({ flag: "watchlist" }).expect(200);
    const list = await request(app).get("/api/viewers?filter=watchlist").expect(200);
    expect(list.body.viewers.map((v: { viewer: { username: string } }) => v.viewer.username)).toEqual(["shadow"]);
    const alerts = await request(app).get("/api/alerts");
    const act = await request(app).post(`/api/alerts/${alerts.body.alerts[0].id}/action`).send({ action: "mute" }).expect(200);
    expect(act.body.record.status).toBe("simulated");
    await request(app).get("/api/assistant/pulse").expect(200);
    const cu = await request(app).post("/api/assistant/catchup").send({}).expect(200);
    expect(cu.body.headline).toBeTruthy();
    const end = await request(app).post("/api/session/end").send({}).expect(200);
    expect(end.body.report.markdown).toContain("NOVUS LIVE");
    await request(app).get("/api/analytics").expect(200);
    await request(app).get("/api/does-not-exist").expect(404);
  });
});
