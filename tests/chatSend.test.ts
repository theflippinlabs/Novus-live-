import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { EulerChatSender } from "../server/chat/EulerChat";
import { RoomRegistry, type Room } from "../server/core/Rooms";
import { MemoryRepository } from "../server/persistence/MemoryRepository";
import { RealtimeHub } from "../server/realtime/RealtimeHub";
import { TikTokAdapter } from "../server/platform/TikTokAdapter";
import { createRuntime } from "./helpers";

const CFG = { apiKey: "euler_test_key", clientId: "client-1", clientSecret: "secret-1" };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

/** Fake Euler Stream API. `chatStatus` decides how the chat endpoint answers. */
function fakeEuler(opts: { chatStatus?: number; expiresIn?: number } = {}) {
  const calls: Call[] = [];
  let tokenN = 0;
  const http = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const call: Call = { url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/tiktok/oauth/token")) {
      tokenN += 1;
      return json(200, { code: 200, data: { access_token: `at-${tokenN}`, refresh_token: `rt-${tokenN}`, expires_in: opts.expiresIn ?? 3600, refresh_expires_in: 86400 } });
    }
    if (url.endsWith("/tiktok/oauth/userinfo")) return json(200, { code: 200, user: { uniqueId: "mod_account", nickName: "Mod" } });
    if (url.includes("/webcast/rooms/")) return json(opts.chatStatus ?? 200, { code: opts.chatStatus ?? 200, message: opts.chatStatus === 403 ? "Premium feature" : "ok" });
    return json(404, {});
  }) as typeof fetch;
  return { http, calls };
}

async function connected(opts: Parameters<typeof fakeEuler>[0] = {}, clock = { t: 1_000_000 }) {
  const repo = new MemoryRepository();
  const euler = fakeEuler(opts);
  const sender = new EulerChatSender(CFG, repo, euler.http, () => clock.t);
  const { state } = sender.authorizeUrl("https://novus.example/api/chat-sender/callback");
  await sender.complete("the-code", state);
  return { repo, sender, ...euler, clock };
}

describe("Send in chat (Euler OAuth)", () => {
  it("builds the authorize URL and connects with a one-time state", async () => {
    const repo = new MemoryRepository();
    const { http, calls } = fakeEuler();
    const sender = new EulerChatSender({ ...CFG, authorizeUrl: "https://www.eulerstream.com/oauth/authorize?scope=webcast:chat&state=old" }, repo, http);
    const { url, state } = sender.authorizeUrl("https://novus.example/api/chat-sender/callback");
    const u = new URL(url);
    expect(u.searchParams.get("client_id")).toBe("client-1");
    expect(u.searchParams.get("redirect_uri")).toBe("https://novus.example/api/chat-sender/callback");
    expect(u.searchParams.get("state")).toBe(state);
    expect(u.searchParams.get("scope")).toBe("webcast:chat");
    expect(url).not.toContain("secret-1");

    await expect(sender.complete("code", "forged-state")).rejects.toMatchObject({ code: "chat_session_expired" });
    const status = await sender.complete("the-code", state);
    expect(status).toMatchObject({ configured: true, connected: true, username: "mod_account" });
    // The state is single-use.
    await expect(sender.complete("the-code", state)).rejects.toMatchObject({ code: "chat_session_expired" });

    const exchange = calls.find((c) => c.url.endsWith("/tiktok/oauth/token"))!;
    expect(exchange.body).toMatchObject({ client_id: "client-1", client_secret: "secret-1", grant_type: "authorization_code", code: "the-code", redirect_uri: "https://novus.example/api/chat-sender/callback" });
    // Tokens are stored server-side and never part of the status sent to the browser.
    expect(await repo.loadSecret("euler_chat_oauth")).toMatchObject({ accessToken: "at-1", refreshToken: "rt-1" });
    expect(JSON.stringify(status)).not.toContain("at-1");
  });

  it("posts the message to the LIVE room with the moderator's token", async () => {
    const { sender, calls } = await connected();
    await sender.send("7412345", "  @troll please keep the chat respectful.  ");
    const chat = calls.find((c) => c.url.includes("/webcast/rooms/"))!;
    expect(chat.url).toContain("https://tiktok.eulerstream.com/webcast/rooms/7412345/chat");
    expect(chat.method).toBe("POST");
    expect(chat.headers["x-api-key"]).toBe("euler_test_key");
    expect(chat.headers["x-oauth-token"]).toBe("at-1");
    expect(chat.body).toEqual({ content: "@troll please keep the chat respectful." });
  });

  it("reports a refusal honestly instead of faking success", async () => {
    const { sender } = await connected({ chatStatus: 403 });
    await expect(sender.send("7412345", "hello")).rejects.toMatchObject({ code: "chat_plan_required" });
    expect((await sender.status()).lastError).toContain("403");
  });

  it("refreshes an expired access token before sending", async () => {
    const clock = { t: 1_000_000 };
    const { sender, calls } = await connected({ expiresIn: 120 }, clock);
    clock.t += 5 * 60_000;
    await sender.send("7412345", "hello");
    const refresh = calls.filter((c) => c.url.endsWith("/tiktok/oauth/token"))[1];
    expect(refresh.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt-1" });
    expect(calls.find((c) => c.url.includes("/webcast/rooms/"))!.headers["x-oauth-token"]).toBe("at-2");
  });

  it("is off until the server is configured, and disconnect forgets the tokens", async () => {
    const off = new EulerChatSender({ apiKey: "k" }, new MemoryRepository());
    expect(off.configured).toBe(false);
    expect(() => off.authorizeUrl("https://x/cb")).toThrow();
    await expect(off.send("1", "hi")).rejects.toMatchObject({ code: "chat_not_configured" });

    const { sender, repo } = await connected();
    await sender.disconnect();
    expect(await repo.loadSecret("euler_chat_oauth")).toBeNull();
    await expect(sender.send("1", "hi")).rejects.toMatchObject({ code: "chat_not_connected" });
  });

  it("HTTP: sends a suggested warning of a followed account's LIVE and resolves the alert", async () => {
    const { sender, calls } = await connected();
    const { runtime } = createRuntime({ account: "amanda_g" });
    await runtime.init();
    let liveRoomId: string | undefined = "7400000000000000001";
    const tt = new TikTokAdapter(false);
    const room: Room = { id: "tt:amanda_g", kind: "tiktok", username: "amanda_g", runtime, hub: new RealtimeHub(50), tiktok: tt, liveRoomId: () => liveRoomId, dispose: async () => undefined };
    const main = createRuntime({ repo: runtime.repository });
    const mainRoom: Room = { id: "main", kind: "main", runtime: main.runtime, hub: new RealtimeHub(50), tiktok: main.tiktok, dispose: async () => undefined };
    const rooms = new RoomRegistry(mainRoom, async () => room);
    await rooms.updateSettings({ tiktokProfiles: ["amanda_g"] });
    const app = createApp({
      config: { production: false, webDir: "does-not-exist", trustProxy: false, apiRateLimitPerMinute: 1000, ingestRateLimitPerMinute: 1000 },
      rooms,
      chat: sender,
    });

    await runtime.ingestExternal(
      [
        { type: "stream_status", status: "started", title: "@amanda_g LIVE" },
        { type: "comment", id: "c1", timestamp: Date.now(), viewer: { id: "t1", username: "troll" }, text: "give me your address i'll come find you" },
      ] as never,
      "tiktok",
    );
    const alert = runtime.sortedAlerts()[0];
    expect(alert).toBeTruthy();
    const act = await request(app).post(`/api/alerts/${alert.id}/action`).set("X-Novus-Room", room.id).send({ action: "warn" }).expect(200);
    expect(act.body.record.status).toBe("manual_required");
    const text = act.body.record.i18n.fr.suggestedMessage as string;

    // Status never exposes a token.
    const status = await request(app).get("/api/chat-sender").expect(200);
    expect(status.body).toMatchObject({ configured: true, connected: true, username: "mod_account" });
    expect(JSON.stringify(status.body)).not.toMatch(/at-1|rt-1|secret-1/);

    await request(app).post(`/api/actions/${act.body.record.id}/send-chat`).set("X-Novus-Room", room.id).send({ text: "x".repeat(151) }).expect(400);
    const sent = await request(app).post(`/api/actions/${act.body.record.id}/send-chat`).set("X-Novus-Room", room.id).send({ text }).expect(200);
    expect(sent.body.record.sentToChatAt).toBeGreaterThan(0);
    expect(sent.body.record.confirmedAt).toBeGreaterThan(0);
    expect(runtime.sortedAlerts().find((a) => a.id === alert.id)?.status).toBe("resolved");
    expect(calls.filter((c) => c.url.includes("/webcast/rooms/7400000000000000001/chat"))).toHaveLength(1);

    // Not LIVE: nothing is sent.
    liveRoomId = undefined;
    const act2 = await request(app).post(`/api/viewers/t1/action`).set("X-Novus-Room", room.id).send({ action: "warn" }).expect(200);
    const notLive = await request(app).post(`/api/actions/${act2.body.record.id}/send-chat`).set("X-Novus-Room", room.id).send({ text }).expect(409);
    expect(notLive.body.error).toBe("chat_not_live");
  });

  it("HTTP: the OAuth callback is public but only accepts a state the app created", async () => {
    const repo = new MemoryRepository();
    const { http } = fakeEuler();
    const sender = new EulerChatSender(CFG, repo, http);
    const { runtime, tiktok } = createRuntime();
    const rooms = new RoomRegistry({ id: "main", kind: "main", runtime, hub: new RealtimeHub(50), tiktok, dispose: async () => undefined });
    const app = createApp({
      config: { accessToken: "a-long-access-token-123", production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 1000, ingestRateLimitPerMinute: 1000, publicUrl: "https://novus.example" },
      rooms,
      chat: sender,
    });
    // Starting the flow needs the app login.
    await request(app).post("/api/chat-sender/connect").send({}).expect(401);
    const forged = await request(app).get("/api/chat-sender/callback?code=abc&state=forged").expect(303);
    expect(forged.headers.location).toBe("/?chat=expired");
    expect((await sender.status()).connected).toBe(false);

    const login = await request(app).post("/api/auth/login").send({ key: "a-long-access-token-123" }).expect(200);
    const cookie = login.headers["set-cookie"];
    const start = await request(app).post("/api/chat-sender/connect").set("Cookie", cookie).send({}).expect(200);
    const url = new URL(start.body.url);
    expect(url.searchParams.get("redirect_uri")).toBe("https://novus.example/api/chat-sender/callback");
    const ok = await request(app).get(`/api/chat-sender/callback?code=abc&state=${url.searchParams.get("state")}`).expect(303);
    expect(ok.headers.location).toBe("/?chat=connected");
    expect((await sender.status()).connected).toBe(true);
    const denied = await request(app).get("/api/chat-sender/callback?error=access_denied").expect(303);
    expect(denied.headers.location).toBe("/?chat=denied");
  });
});
