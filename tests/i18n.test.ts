import { describe, expect, it } from "vitest";
import { explainI18n, tr, word } from "../shared/i18n";
import { TikTokManualActionAdapter, SimulatedActionAdapter } from "../server/actions/adapters";
import { PATTERNS } from "../server/moderation/patterns";
import { TIKTOK_CAPABILITIES, TIKTOK_CAPABILITIES_UNOFFICIAL } from "../server/platform/TikTokAdapter";
import { buildReportPdf } from "../server/reports/pdf";
import { createAnalyzer } from "./helpers";

describe("English / French", () => {
  it("translates every moderation reason the engine can produce", () => {
    for (const rule of PATTERNS) expect(tr(rule.reason, "fr"), rule.reason).not.toBe(rule.reason);
    const a = createAnalyzer();
    const reasons = new Set<string>();
    for (const [u, text] of [
      ["x", "give me your address i'll come find you"],
      ["y", "FREE coins bit.ly/abc dm me"],
      ["y", "FREE coins bit.ly/abc dm me"],
      ["y", "FREE coins bit.ly/abc dm me"],
      ["z", "AAAAAAAAAAAAAAAAAAAA!!!!!!!!!!"],
      ["w", "t'es nul, ferme-la"],
      ["w", "t'es nul, ferme-la sale idiot"],
    ] as const)
      for (const r of a.analyze(u, text).analysis.reasons) reasons.add(r);
    expect(reasons.size).toBeGreaterThan(4);
    for (const r of reasons) expect(tr(r, "fr"), r).not.toBe(r);
    expect(tr("Coordinated burst (4 accounts)", "fr")).toBe("Rafale coordonnée (4 comptes)");
    expect(tr("Repeated hostility (3x)", "fr")).toBe("Hostilité répétée (3 fois)");
    expect(tr("user text stays as is", "fr")).toBe("user text stays as is");
    expect(tr("Targeted threat", "en")).toBe("Targeted threat");
  });

  it("explains verdicts and describes actions in both languages", async () => {
    const e = explainI18n(["threat", "doxxing"], "critical", "trusted");
    expect(e.en).toMatch(/^Message contains a targeted threat and involves personal information/);
    expect(e.fr).toMatch(/^Le message contient une menace ciblée et implique des informations personnelles/);
    expect(e.fr).toMatch(/Spectateur de confiance/);

    const target = { viewer: { id: "v", username: "shadow" }, reasons: ["Targeted threat"], language: "en" as const };
    const manual = await new TikTokManualActionAdapter().report(target);
    expect(manual.message).toMatch(/^MANUAL ACTION REQUIRED/);
    expect(manual.i18n?.fr?.message).toMatch(/^ACTION MANUELLE REQUISE/);
    expect(manual.i18n?.fr?.instructions?.join(" ")).toContain("Menace ciblée");
    const warn = await new SimulatedActionAdapter().warn({ ...target, language: "fr" });
    expect(warn.message).toMatch(/simulation/);
    expect(warn.i18n?.en?.suggestedMessage).toMatch(/please keep the chat respectful/);
    expect(warn.suggestedMessage).toMatch(/merci de rester respectueux/);
    expect(word("manual_required", "fr")).toBe("action manuelle requise");
  });

  it("translates TikTok capabilities and statuses", () => {
    for (const c of [...TIKTOK_CAPABILITIES, ...TIKTOK_CAPABILITIES_UNOFFICIAL]) {
      expect(tr(c.capability, "fr"), c.capability).not.toBe(c.capability);
      expect(tr(c.detail, "fr"), c.detail).not.toBe(c.detail);
    }
    expect(tr("Waiting for @w_amanda_g to go LIVE", "fr")).toBe("En attente du LIVE de @w_amanda_g");
  });

  it("writes the PDF report in the requested language", async () => {
    const entry = { sessionId: "s", title: "Demo LIVE", source: "demo" as const, status: "ended" as const, startedAt: 0, endedAt: 60_000, durationMs: 60_000, messages: 1, uniqueChatters: 1, gifts: 0, diamonds: 0, peakViewers: 10, alerts: 0 };
    const analytics = {
      session: null,
      totals: { messages: 1, uniqueChatters: 1, alerts: 0, critical: 0, warnings: 0, muteRecommendations: 0, blockRecommendations: 0, reportRecommendations: 0, actions: 0, manualActions: 0, gifts: 0, follows: 0 },
      peak: null,
      buckets: [],
      topParticipants: [],
      topQuestions: [],
      topTopics: [],
      categoryCounts: {},
      avgResponseTimeMs: null,
      durationMs: 60_000,
    };
    const fr = (await buildReportPdf({ entry, analytics, chat: [], lang: "fr", timeZone: "Europe/Paris" })).toString("latin1");
    const en = (await buildReportPdf({ entry, analytics, chat: [], lang: "en", timeZone: "Europe/Paris" })).toString("latin1");
    // The document title sits in the PDF info dictionary as a UTF-16BE string.
    const utf16 = (text: string) => Buffer.from(text, "utf16le").swap16().toString("latin1");
    expect(fr).toContain(utf16("LIVE de démo"));
    expect(en).toContain(utf16("Demo LIVE"));
  });
});
