import { describe, expect, it } from "vitest";
import { detectLanguage } from "../server/moderation/language";
import { comment, createRuntime } from "./helpers";

describe("streamer assistant", () => {
  it("clusters repeated questions across phrasing and languages, and tracks answers", async () => {
    const { runtime } = createRuntime();
    const s = await runtime.startSession("demo", "mock", "test");
    const t = Date.now() - 20_000;
    ["When does the new app launch?", "when is the release date??", "what's the release date for the application?", "Quand sort l'application ?"].forEach((q, i) =>
      runtime.ingest(comment(s.id, `fan${i}`, q, t + i * 1000)),
    );
    runtime.ingest(comment(s.id, "fan9", "How much will the app cost?", t + 5000));
    let pulse = runtime.pulse();
    expect(pulse.topQuestions[0].count).toBeGreaterThanOrEqual(3);
    expect(pulse.topUnanswered?.id).toBe(pulse.topQuestions[0].id);

    // The host answering in chat marks it as answered.
    runtime.ingest(comment(s.id, "novarys", "Release date is next Friday!", t + 6000));
    pulse = runtime.pulse();
    const release = pulse.topQuestions.find((q) => /release|launch|sort/i.test(q.question))!;
    expect(release.answered).toBe(true);
    expect(pulse.topUnanswered?.question).toMatch(/cost/);
  });

  it("reports trends, sentiment and moderator attention", async () => {
    const { runtime } = createRuntime();
    const s = await runtime.startSession("demo", "mock", "test");
    const t = Date.now() - 20_000;
    for (let i = 0; i < 6; i++) runtime.ingest(comment(s.id, `d${i}`, "is there a Discord server?", t + i * 100));
    for (let i = 0; i < 5; i++) runtime.ingest(comment(s.id, `p${i}`, "love this, amazing work 🔥", t + 1000 + i * 100));
    runtime.ingest(comment(s.id, "shadow", "give me your address i'll come find you", t + 2000));
    const pulse = runtime.pulse();
    expect(pulse.trending[0].topic).toBe("Discord");
    expect(pulse.sentiment.current).toBeGreaterThan(0);
    expect(pulse.viewersNeedingAttention).toBe(1);
  });

  it("CATCH ME UP summarizes incidents, unresolved alerts, questions and actions since a time", async () => {
    const { runtime } = createRuntime();
    const s = await runtime.startSession("demo", "mock", "test");
    const t = Date.now() - 20_000;
    runtime.ingest(comment(s.id, "fan", "When does the app launch?", t));
    runtime.ingest(comment(s.id, "shadow", "give me your address i'll come find you", t + 10));
    runtime.ingest(comment(s.id, "rude", "shut up you idiot", t + 20));
    const rude = runtime.sortedAlerts().find((a) => a.viewer.username === "rude")!;
    await runtime.actOnAlert(rude.id, "warn");
    const cu = await runtime.catchUp(t - 1000);
    expect(cu.headline).toMatch(/critical incident/);
    const titles = cu.sections.map((x) => x.title);
    expect(titles).toEqual(expect.arrayContaining(["Incidents", "Unresolved alerts", "Questions", "Trends", "Moderation actions"]));
    expect(cu.sections.find((x) => x.title === "Incidents")!.items[0]).toContain("@shadow");
    expect(cu.source).toBe("local");

    const later = await runtime.catchUp(Date.now() + 60_000);
    expect(later.headline).toMatch(/quiet|nothing/i);
  });

  it("detects chat languages", () => {
    expect(detectLanguage("salut tout le monde, c'est trop bien")).toBe("fr");
    expect(detectLanguage("when is the release date for the app")).toBe("en");
    expect(detectLanguage("hola, gracias por el directo")).toBe("es");
    expect(detectLanguage("привет всем")).toBe("ru");
  });
});
