import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { RoomRegistry, type Room } from "../server/core/Rooms";
import { MemoryRepository } from "../server/persistence/MemoryRepository";
import { AlertThrottle, PushService } from "../server/push/Push";
import { criticalAlertMessage, liveStartedMessage } from "../server/push/messages";
import { RealtimeHub } from "../server/realtime/RealtimeHub";
import { comment, createRuntime } from "./helpers";

const APPLE = "https://web.push.apple.com/QGuQyavXutnMZ-abc";
const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

function service(repo = new MemoryRepository()) {
  const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
  const dead = new Set<string>();
  const push = new PushService({
    serverRepo: repo.scoped("owner"),
    spaceRepo: (t) => repo.scoped(t),
    subject: "https://novus.test",
    send: async (sub, payload) => {
      if (dead.has(sub.endpoint)) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    },
  });
  return { push, sent, dead, repo };
}

describe("Push notifications", () => {
  it("keeps one VAPID key pair and sends only what each device wants", async () => {
    const { push, sent, dead, repo } = service();
    await push.init();
    const again = service(repo).push;
    await again.init();
    expect(again.publicKey).toBe(push.publicKey);

    await push.subscribe("s1", { kind: "founder" }, { endpoint: `${APPLE}1`, keys: KEYS });
    await push.subscribe("s1", { kind: "founder" }, { endpoint: `${APPLE}2`, keys: KEYS }, { live: true, alerts: false, summary: true });
    await push.subscribe("s2", { kind: "founder" }, { endpoint: `${APPLE}3`, keys: KEYS });

    expect(await push.notify("s1", liveStartedMessage("odwnzcte", "fr"))).toBe(2);
    expect(sent[0].payload).toMatchObject({ title: "🔴 @odwnzcte est en LIVE", url: "/?view=live&room=tt%3Aodwnzcte" });
    sent.length = 0;
    const alert = { viewer: { id: "v", username: "troll" }, text: "je sais où tu habites" } as never;
    expect(await push.notify("s1", criticalAlertMessage("odwnzcte", alert, 3, "fr"))).toBe(1);
    expect(sent[0].payload.body).toBe("@troll : « je sais où tu habites » · +2 autres");

    // A device that uninstalled the app is forgotten.
    dead.add(`${APPLE}1`);
    await push.notify("s1", liveStartedMessage("x", "en"));
    expect(await push.find("s1", `${APPLE}1`)).toBeUndefined();
    expect(await push.find("s1", `${APPLE}2`)).toBeTruthy();
  });

  it("groups bursts of critical alerts per streamer", () => {
    let t = 0;
    const th = new AlertThrottle(180_000, () => t);
    expect(th.take("a")).toBe(1);
    t = 10_000;
    expect(th.take("a")).toBeNull();
    expect(th.take("b")).toBe(1);
    t = 60_000;
    expect(th.take("a")).toBeNull();
    t = 200_000;
    expect(th.take("a")).toBe(3);
  });

  it("the runtime reports LIVE start, end and each new critical alert once", async () => {
    const seen: string[] = [];
    const { runtime } = createRuntime();
    (runtime as unknown as { deps: { events: unknown } }).deps.events = {
      liveStarted: () => seen.push("start"),
      liveEnded: () => seen.push("end"),
      criticalAlert: (a: { viewer: { username: string } }) => seen.push(`alert:${a.viewer.username}`),
    };
    const s = await runtime.startSession("tiktok", "tiktok", "LIVE");
    runtime.ingest(comment(s.id, "shadow", "give me your address i'll come find you"));
    runtime.ingest(comment(s.id, "shadow", "i know where you live, i'll come find you"));
    runtime.ingest(comment(s.id, "fan", "love the stream"));
    await runtime.endSession();
    expect(seen).toEqual(["start", "alert:shadow", "end"]);
  });

  it("registers devices only for real push services, and lets the owner test them", async () => {
    const { push, sent } = service();
    await push.init();
    const { runtime, tiktok } = createRuntime();
    const main: Room = { id: "main", kind: "main", runtime, hub: new RealtimeHub(50), tiktok, dispose: async () => undefined };
    const app = createApp({ config: { production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 1000, ingestRateLimitPerMinute: 1000 }, rooms: new RoomRegistry(main), push });

    expect((await request(app).get("/api/push/config").expect(200)).body.publicKey).toBe(push.publicKey);
    await request(app).post("/api/push/subscribe").send({ subscription: { endpoint: "https://evil.example/hook", keys: KEYS } }).expect(400);
    await request(app).post("/api/push/subscribe").send({ subscription: { endpoint: "http://web.push.apple.com/x", keys: KEYS } }).expect(400);
    const sub = await request(app).post("/api/push/subscribe").send({ subscription: { endpoint: APPLE, keys: KEYS } }).expect(200);
    expect(sub.body.prefs).toEqual({ live: true, alerts: true, summary: true });
    await request(app).put("/api/push/prefs").send({ endpoint: APPLE, prefs: { live: false, alerts: true, summary: false } }).expect(200);
    expect((await request(app).post("/api/push/status").send({ endpoint: APPLE }).expect(200)).body).toEqual({ subscribed: true, prefs: { live: false, alerts: true, summary: false } });
    await request(app).post("/api/push/test").send({ endpoint: APPLE }).expect(200);
    expect(sent.at(-1)?.payload.tag).toBe("test");
    await request(app).post("/api/push/unsubscribe").send({ endpoint: APPLE }).expect(200);
    await request(app).post("/api/push/test").send({ endpoint: APPLE }).expect(502);
  });
});
