import { describe, expect, it } from "vitest";
import type { AIProvider } from "../server/ai/AIProvider";
import { FallbackAIProvider, OpenAIProvider } from "../server/ai/OpenAIProvider";

function fake(name: string, fail?: () => Error) {
  const calls: string[] = [];
  const p: AIProvider = {
    name,
    model: `${name}-model`,
    available: () => true,
    reviewBatch: async () => {
      calls.push("review");
      if (fail) throw fail();
      return new Map();
    },
    copilot: async (req) => {
      calls.push("copilot");
      if (fail) throw fail();
      return `${name}: ${req.instruction}`;
    },
    translate: async (texts) => {
      calls.push("translate");
      if (fail) throw fail();
      return texts.map((t) => `${name}:${t}`);
    },
  };
  return { p, calls };
}
const req = { mode: "chat" as const, instruction: "hi", history: [], context: "{}", language: "fr" as const, streamerName: "s" };

describe("Back-up AI", () => {
  it("answers with OpenAI when Claude has no credit left, then skips Claude for 5 minutes", async () => {
    let now = 0;
    const claude = fake("anthropic", () => new Error('400 {"type":"error","error":{"message":"Your credit balance is too low to access the Anthropic API."}}'));
    const openai = fake("openai");
    const logs: string[] = [];
    const ai = new FallbackAIProvider(claude.p, openai.p, (m) => logs.push(m), () => now);
    expect(await ai.copilot!(req)).toBe("openai: hi");
    expect(logs[0]).toContain("openai takes over");
    expect(ai.name).toBe("openai");
    expect(await ai.translate!(["a"], "fr")).toEqual(["openai:a"]);
    expect(claude.calls).toEqual(["copilot"]);
    // 5 minutes later, Claude is tried again.
    now = 5 * 60_000 + 1;
    await ai.copilot!(req);
    expect(claude.calls).toEqual(["copilot", "copilot"]);
  });

  it("keeps Claude's answer, and does not hide a one-off error behind the back-up", async () => {
    const claude = fake("anthropic");
    const openai = fake("openai");
    expect(await new FallbackAIProvider(claude.p, openai.p).copilot!(req)).toBe("anthropic: hi");
    expect(openai.calls).toEqual([]);
    const odd = fake("anthropic", () => new Error("AI copilot refused"));
    await expect(new FallbackAIProvider(odd.p, openai.p).copilot!(req)).rejects.toThrow("refused");
    expect(openai.calls).toEqual([]);
  });
});

describe("OpenAI provider", () => {
  it("calls Chat Completions with the key server-side and checks the answer's shape", async () => {
    const sent: { url: string; auth: string; body: Record<string, unknown> }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      sent.push({ url, auth: (init.headers as Record<string, string>).Authorization, body });
      const content = body.response_format ? JSON.stringify({ translations: [{ i: 0, text: "salut" }] }) : "Pose une question au chat.";
      return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 30 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAIProvider({ apiKey: "sk-test", model: "gpt-5-mini", http });
    const metered: { inputTokens: number; outputTokens: number }[] = [];
    expect(await p.translate(["hello"], "fr", (u) => metered.push(u))).toEqual(["salut"]);
    expect(await p.copilot(req)).toBe("Pose une question au chat.");
    expect(sent[0]).toMatchObject({ url: "https://api.openai.com/v1/chat/completions", auth: "Bearer sk-test" });
    expect(sent[0].body).toMatchObject({ model: "gpt-5-mini", reasoning_effort: "low", response_format: { type: "json_object" } });
    expect(sent[0].body.max_completion_tokens).toBeGreaterThan(0);
    expect(sent[1].body.response_format).toBeUndefined();
    expect(metered[0]).toEqual({ inputTokens: 120, outputTokens: 30 });

    const refused = new OpenAIProvider({ apiKey: "k", model: "gpt-5-mini", http: (async () => new Response(JSON.stringify({ error: { message: "You exceeded your current quota" } }), { status: 429 })) as unknown as typeof fetch });
    await expect(refused.copilot(req)).rejects.toThrow("openai 429");
  });
});
