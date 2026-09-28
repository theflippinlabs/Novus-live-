import { describe, expect, it } from "vitest";
import { EulerActionAdapter } from "../server/actions/EulerActionAdapter";
import { EulerChatSender } from "../server/chat/EulerChat";

const cfg = { apiKey: "key", clientId: "client", clientSecret: "secret" };
const viewer = { id: "tt:7123456789012345678", username: "troll" };

/** Fake Euler: records calls and answers with `reply`. */
function euler(tokens: object | null, reply: (url: URL, init: RequestInit) => { status: number; body: unknown } = () => ({ status: 200, body: { code: 200, response: { data: { status_code: 0, data: {} } } } })) {
  const calls: { method: string; url: URL; headers: Record<string, string> }[] = [];
  const http = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ method: init.method ?? "GET", url, headers: init.headers as Record<string, string> });
    const r = reply(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const repo = { loadSecret: async () => tokens, saveSecret: async () => undefined };
  return { chat: new EulerChatSender(cfg, repo, http), calls };
}
const connected = { accessToken: "tok", connectedAt: 1, username: "mod_account", scopes: ["webcast:chat", "webcast:mute", "webcast:ban", "webcast:comments"] };

describe("TikTok moderation through Euler", () => {
  it("asks only for the permissions Novus uses", () => {
    const { chat } = euler(null);
    const url = new URL(chat.authorizeUrl("https://novus.test/api/chat-sender/callback").url);
    expect(url.searchParams.get("scope")).toBe("webcast:chat webcast:mute webcast:ban webcast:comments");
  });

  it("mutes and removes viewers with Euler's documented routes, as the connected account", async () => {
    const { chat, calls } = euler(connected);
    const adapter = new EulerActionAdapter({ chat: () => chat, roomId: () => "7690000000000000001" });
    const muted = await adapter.mute({ viewer, language: "fr", muteSeconds: 60 });
    expect(muted.status).toBe("executed");
    expect(muted.message).toBe("@troll mis en sourdine dans TikTok (1 min).");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url.pathname).toBe("/webcast/rooms/7690000000000000001/moderation/mutes");
    expect(calls[0].url.searchParams.get("user_id")).toBe("7123456789012345678");
    expect(calls[0].url.searchParams.get("duration")).toBe("60");
    expect(calls[0].headers["x-oauth-token"]).toBe("tok");

    const removed = await adapter.block({ viewer, language: "en" });
    expect(removed.status).toBe("executed");
    expect(calls[1].method).toBe("PUT");
    expect(calls[1].url.pathname).toBe("/webcast/rooms/7690000000000000001/moderation/bans");
    expect(calls[1].url.searchParams.get("tiktok_user_id")).toBe("7123456789012345678");

    await chat.setComments("7690000000000000001", false);
    expect(calls[2].method).toBe("POST");
    expect(calls[2].url.pathname).toBe("/webcast/rooms/7690000000000000001/moderation/toggle_comments");
    expect(calls[2].url.searchParams.get("enabled")).toBe("false");
  });

  it("never fakes success: a refusal gives the manual steps with TikTok's reason", async () => {
    const { chat } = euler(connected, () => ({ status: 200, body: { code: 200, response: { data: { status_code: 4003061, data: { prompts: "No permission" } } } } }));
    const adapter = new EulerActionAdapter({ chat: () => chat, roomId: () => "7690000000000000001" });
    const r = await adapter.mute({ viewer, language: "fr" });
    expect(r.status).toBe("manual_required");
    expect(r.message).toMatch(/^TikTok a refusé — ton compte connecté est-il modérateur de ce LIVE \?/);
    expect(r.message).toContain("No permission");
    expect(r.message).toContain("ACTION MANUELLE REQUISE");
    expect(r.instructions?.length).toBeGreaterThan(2);
  });

  it("falls back to manual steps without calling Euler when moderation can't run", async () => {
    // Connected before moderation existed (chat only): reconnect needed.
    const old = euler({ accessToken: "tok", connectedAt: 1 });
    expect((await old.chat.status()).moderation).toBe(false);
    const a1 = new EulerActionAdapter({ chat: () => old.chat, roomId: () => "1" });
    expect((await a1.block({ viewer, language: "en" })).status).toBe("manual_required");
    expect(old.calls).toHaveLength(0);
    // No LIVE room, or a viewer without TikTok's numeric id.
    const ok = euler(connected);
    expect((await new EulerActionAdapter({ chat: () => ok.chat, roomId: () => undefined }).mute({ viewer, language: "en" })).status).toBe("manual_required");
    expect((await new EulerActionAdapter({ chat: () => ok.chat, roomId: () => "1" }).mute({ viewer: { id: "tt:troll", username: "troll" }, language: "en" })).status).toBe("manual_required");
    expect(ok.calls).toHaveLength(0);
    // Warnings and reports stay manual.
    expect((await new EulerActionAdapter({ chat: () => ok.chat, roomId: () => "1" }).report({ viewer, language: "en" })).status).toBe("manual_required");
  });
});
