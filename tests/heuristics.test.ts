import { describe, expect, it } from "vitest";
import { defaultSettings } from "../shared/settings";
import { effectiveThresholds, recommendFor, severityFor } from "../server/moderation/heuristics";
import { createAnalyzer } from "./helpers";

describe("risk scoring", () => {
  it("keeps ordinary chat at normal risk", () => {
    const a = createAnalyzer();
    for (const text of ["love this stream ❤️", "When does the new app launch?", "salut tout le monde 👋", "this boss fight is killing me lol", "gg"]) {
      const r = a.analyze(`fan_${text.length}`, text);
      expect(r.analysis.severity, text).toBe("normal");
      expect(r.analysis.recommendedAction).toBe("none");
    }
  });

  it("returns the structured analysis contract", () => {
    const r = createAnalyzer().analyze("x", "give me your address i'll come find you");
    expect(r.analysis).toMatchObject({
      riskScore: expect.any(Number),
      severity: expect.stringMatching(/normal|watch|warning|critical/),
      categories: expect.any(Array),
      explanation: expect.any(String),
      recommendedAction: expect.stringMatching(/none|watch|warn|mute|block|report/),
      confidence: expect.any(Number),
    });
    expect(r.analysis.riskScore).toBeGreaterThanOrEqual(0);
    expect(r.analysis.riskScore).toBeLessThanOrEqual(100);
    expect(r.analysis.confidence).toBeGreaterThan(0);
    expect(r.analysis.confidence).toBeLessThanOrEqual(1);
  });

  it("scores a targeted threat with a personal-info request as critical and recommends reporting", () => {
    const r = createAnalyzer().analyze("shadow", "give me your address i'll come find you");
    expect(r.analysis.severity).toBe("critical");
    expect(r.analysis.riskScore).toBeGreaterThanOrEqual(90);
    expect(r.analysis.categories).toEqual(expect.arrayContaining(["threat", "doxxing"]));
    expect(r.analysis.recommendedAction).toBe("report");
  });

  it("detects French threats and doxxing", () => {
    const a = createAnalyzer();
    expect(a.analyze("troll", "je sais où tu habites").analysis.categories).toContain("threat");
    const dox = a.analyze("leak", "son adresse: 42 rue de la Paix, appelle le 06 12 34 56 78");
    expect(dox.analysis.categories).toContain("doxxing");
    expect(dox.analysis.severity).toBe("critical");
  });

  it("flags scams with shortened links", () => {
    const r = createAnalyzer().analyze("diamond_drop", "FREE 10k coins 💎 claim at bit.ly/free-coinz dm me to claim");
    expect(r.analysis.categories).toEqual(expect.arrayContaining(["scam", "suspicious_link"]));
    expect(["warning", "critical"]).toContain(r.analysis.severity);
    expect(r.analysis.recommendedAction).toBe("block");
  });

  it("flags look-alike impersonation of the streamer", () => {
    const r = createAnalyzer().analyze("novarys_officiall", "This is my backup account, send gifts here 🎁");
    expect(r.analysis.categories).toContain("impersonation");
    expect(SEVERE_OR_WARNING).toContain(r.analysis.severity);
  });

  it("does not flag the streamer's own account as impersonation", () => {
    const r = createAnalyzer().analyze("novarys", "Release date is next Friday! Discord link is in my bio");
    expect(r.analysis.categories).not.toContain("impersonation");
    expect(r.analysis.severity).toBe("normal");
  });

  it("treats friendly banter as lower risk than a directed insult (context, not keywords)", () => {
    const banter = createAnalyzer().analyze("pal", "lol you're such a clown for that transition 😂");
    const insult = createAnalyzer().analyze("hater", "you're such a pathetic clown");
    expect(banter.analysis.riskScore).toBeLessThan(insult.analysis.riskScore);
    expect(banter.analysis.severity).toBe("normal");
    // Ambiguous banter is exactly what stage 2 should look at.
    expect(insult.analysis.categories).toContain("insult");
  });

  it("ignores insult words that are not aimed at anyone", () => {
    const r = createAnalyzer().analyze("gamer", "that boss was so stupid hard");
    expect(r.analysis.categories).not.toContain("insult");
  });

  it("applies custom banned phrases and category toggles", () => {
    const s = defaultSettings();
    s.bannedPhrases = ["spoiler alert"];
    expect(createAnalyzer(s).analyze("u", "SPOILER ALERT the hero dies").analysis.categories).toContain("banned_phrase");
    s.categories.banned_phrase = false;
    expect(createAnalyzer(s).analyze("u", "spoiler alert the hero dies").analysis.categories).not.toContain("banned_phrase");
  });

  it("maps severities and recommended actions consistently", () => {
    const t = { watch: 25, warning: 50, critical: 75 };
    expect(severityFor(10, t)).toBe("normal");
    expect(severityFor(25, t)).toBe("watch");
    expect(severityFor(74, t)).toBe("warning");
    expect(severityFor(75, t)).toBe("critical");
    expect(recommendFor("warning", ["insult"], 55, 0)).toBe("warn");
    expect(recommendFor("warning", ["insult"], 55, 1)).toBe("mute");
    expect(recommendFor("critical", ["threat", "doxxing"], 95, 0)).toBe("report");
  });
});

const SEVERE_OR_WARNING = ["warning", "critical"];

describe("repetition detection", () => {
  it("escalates repeated identical messages from one viewer", () => {
    const a = createAnalyzer();
    const first = a.analyze("bot", "follow me for free followers check my profile");
    const second = a.analyze("bot", "follow me for free followers check my profile");
    const fourth = (a.analyze("bot", "follow me for free followers 🔥 check my profile"), a.analyze("bot", "FOLLOW ME FOR FREE FOLLOWERS CHECK MY PROFILE"));
    expect(first.analysis.categories).not.toContain("repetition");
    expect(second.analysis.categories).toContain("repetition");
    expect(fourth.analysis.reasons.some((r) => /Repeated 4x/.test(r))).toBe(true);
    expect(fourth.analysis.riskScore).toBeGreaterThan(first.analysis.riskScore);
  });

  it("catches near-duplicates (case, emoji and leetspeak variations)", () => {
    const a = createAnalyzer();
    a.analyze("spammy", "check my profile for free stuff");
    const r = a.analyze("spammy", "CHECK MY PR0FILE for free stuff!!!");
    expect(r.analysis.categories).toContain("repetition");
  });

  it("detects flooding (many messages in a few seconds)", () => {
    const a = createAnalyzer();
    let r = a.analyze("flood", "a", { at: 2_000_000 });
    for (let i = 1; i <= 6; i++) r = a.analyze("flood", `message number ${i} here`, { at: 2_000_000 + i * 800 });
    expect(r.analysis.categories).toContain("flooding");
  });
});

describe("spam burst / coordinated attack", () => {
  it("groups the same hostile message from many accounts into a coordinated burst", () => {
    const a = createAnalyzer();
    const results = [1, 2, 3, 4, 5, 6].map((i) => a.analyze(`raider_${i}`, "L STREAM 💀💀 raid time", { at: 3_000_000 + i * 400 }));
    expect(results[0].analysis.categories).not.toContain("coordinated_attack");
    expect(results[2].analysis.categories).toContain("coordinated_attack");
    expect(results[5].analysis.reasons.some((r) => r.startsWith("Coordinated burst (6"))).toBe(true);
    expect(SEVERE_OR_WARNING).toContain(results[5].analysis.severity);
  });

  it("does NOT treat many viewers asking the same friendly question as an attack", () => {
    const a = createAnalyzer();
    const results = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => a.analyze(`fan_${i}`, "When does the new app launch?", { at: 4_000_000 + i * 300 }));
    for (const r of results) {
      expect(r.analysis.categories).not.toContain("coordinated_attack");
      expect(r.analysis.severity).toBe("normal");
    }
  });
});

describe("contextual escalation", () => {
  it("raises risk as one viewer's hostility builds up over time", () => {
    const a = createAnalyzer();
    const m1 = a.analyze("vex", "you're so annoying honestly");
    a.advance(10_000);
    const m2 = a.analyze("vex", "nobody likes you, just quit");
    a.advance(10_000);
    const m3 = a.analyze("vex", "shut up you pathetic clown");
    expect(m2.analysis.categories).toContain("escalation");
    expect(m3.analysis.riskScore).toBeGreaterThan(m1.analysis.riskScore);
    expect(m3.analysis.reasons.some((r) => r.startsWith("Repeated hostility"))).toBe(true);
  });

  it("the same insult is scored higher after a warning", () => {
    const fresh = createAnalyzer().analyze("u1", "you are an idiot");
    const a = createAnalyzer();
    a.analyze("u2", "you are an idiot");
    a.store.addWarning("v:u2", "u2");
    a.advance(20_000);
    const after = a.analyze("u2", "you are an idiot");
    expect(after.analysis.riskScore).toBeGreaterThan(fresh.analysis.riskScore);
    expect(after.analysis.reasons).toContain("Re-offending after warning");
  });
});

describe("trusted user thresholds", () => {
  it("trusted viewers need stronger evidence before alerting", () => {
    const text = "shut up you idiot";
    const normal = createAnalyzer().analyze("regular", text);
    const trusted = createAnalyzer().analyze("oldfriend", text, { flag: "trusted" });
    expect(trusted.analysis.riskScore).toBeLessThan(normal.analysis.riskScore);
    expect(["normal", "watch"]).toContain(trusted.analysis.severity);
    expect(normal.analysis.severity).not.toBe("normal");
  });

  it("trusted viewers still trigger on serious threats", () => {
    const r = createAnalyzer().analyze("oldfriend", "give me your address i'll come find you", { flag: "trusted" });
    expect(SEVERE_OR_WARNING).toContain(r.analysis.severity);
  });

  it("watchlisted viewers get lower thresholds", () => {
    const s = defaultSettings();
    const t = effectiveThresholds(s, "watchlist");
    const base = effectiveThresholds(s, null);
    expect(t.warning).toBeLessThan(base.warning);
    const r = createAnalyzer().analyze("sus", "you are kinda dumb", { flag: "watchlist" });
    const plain = createAnalyzer().analyze("ok", "you are kinda dumb");
    expect(r.analysis.riskScore).toBeGreaterThan(plain.analysis.riskScore);
  });

  it("honours sensitivity presets", () => {
    const text = "shut up you idiot";
    const low = defaultSettings();
    low.sensitivity = "low";
    const strict = defaultSettings();
    strict.sensitivity = "strict";
    const sevLow = createAnalyzer(low).analyze("a", text).analysis.severity;
    const sevStrict = createAnalyzer(strict).analyze("a", text).analysis.severity;
    const rank = { normal: 0, watch: 1, warning: 2, critical: 3 };
    expect(rank[sevStrict]).toBeGreaterThan(rank[sevLow]);
  });
});

describe("strict mode on real LIVE chat", () => {
  it("catches veiled / misspelled insults and sends weak signals to the AI", async () => {
    const { defaultSettings } = await import("../shared/settings");
    const strict = { ...defaultSettings(), sensitivity: "strict" as const };
    const a = createAnalyzer(strict);
    const dig = a.analyze("junito2332", "Listen it's not ur fault people r dum enough to give u $$$ for just sitting there");
    expect(dig.analysis.categories).toContain("insult");
    expect(dig.analysis.severity === "normal" ? dig.ambiguous : true).toBe(true);
    // Rude body question: below thresholds but reviewed by the AI in strict mode.
    const q = a.analyze("moussitv", "HEIGHT AND WEIGHT?");
    expect(q.ambiguous).toBe(true);
    // Ordinary chat is not sent.
    expect(a.analyze("espi.cozi", "What's for dinner").ambiguous).toBe(false);
    // Balanced mode keeps the AI budget for clearer cases.
    const b = createAnalyzer();
    expect(b.analyze("moussitv", "HEIGHT AND WEIGHT?").ambiguous).toBe(false);
  });
});
