import { describe, expect, it } from "vitest";
import type { AIProvider } from "../server/ai/AIProvider";
import { Translator, untranslatable } from "../server/ai/Translator";
import { chatCsv, chatTxt } from "../server/history/History";

function fakeAi(opts: { fail?: boolean } = {}) {
  const calls: string[][] = [];
  let allowed = true;
  const ai: AIProvider = {
    name: "fake",
    available: () => allowed,
    reviewBatch: async () => new Map(),
    translate: async (texts, target) => {
      calls.push(texts);
      if (opts.fail) throw new Error("down");
      return texts.map((t) => `[${target}] ${t}`);
    },
  };
  return { ai, calls, stop: () => (allowed = false) };
}

describe("Translator", () => {
  it("translates each distinct text once, skips texts with nothing to translate", async () => {
    const { ai, calls } = fakeAi();
    const tr = new Translator(ai);
    const out = await tr.translate(["hello", "😂😂", "@bob", "hello", "how are you"], "fr");
    expect(out).toEqual(["[fr] hello", "😂😂", "@bob", "[fr] hello", "[fr] how are you"]);
    expect(calls).toEqual([["hello", "how are you"]]);
    // Cached: no new call.
    expect(await tr.translate(["how are you"], "fr")).toEqual(["[fr] how are you"]);
    expect(calls).toHaveLength(1);
    expect(untranslatable("12 !!! 🎉 https://x.co/a")).toBe(true);
    expect(untranslatable("ok")).toBe(false);
  });

  it("leaves texts as they are when the AI fails or the allowance is used up, and tries again later", async () => {
    const down = fakeAi({ fail: true });
    const tr = new Translator(down.ai);
    expect(await tr.translate(["hello"], "fr")).toEqual(["hello"]);
    expect(await tr.translate(["hello"], "fr")).toEqual(["hello"]);
    expect(down.calls).toHaveLength(2);
    const quota = fakeAi();
    quota.stop();
    expect(await new Translator(quota.ai).translate(["hello"], "en")).toEqual(["hello"]);
    expect(quota.calls).toHaveLength(0);
  });

  it("exports put the translation next to each message", () => {
    const lines = [
      { t: 0, username: "ana", text: "hola", severity: "normal" as const, riskScore: 0, translation: "salut" },
      { t: 1000, username: "bob", text: "bonjour", severity: "normal" as const, riskScore: 0 },
    ];
    const txt = chatTxt({ sessionId: "s", title: "T", startedAt: 0, status: "ended" } as never, lines, "UTC", "fr");
    expect(txt).toContain("@ana: hola\r\n          > salut");
    expect(txt).toContain("@bob: bonjour");
    const csv = chatCsv(lines, "UTC", "fr");
    expect(csv.split("\r\n")[0]).toContain("traduction");
    expect(csv).toContain('"salut"');
  });
});
