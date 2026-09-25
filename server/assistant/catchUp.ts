import { tr, word } from "../../shared/i18n";
import { CATEGORY_LABELS } from "../../shared/settings";
import type {
  ActionRecord,
  CatchUp,
  CatchUpSection,
  ChatPulse,
  ImportantMessage,
  MinuteBucket,
  ModerationAlert,
  QuestionCluster,
  TopicTrend,
} from "../../shared/types";

export interface CatchUpInput {
  since: number;
  until: number;
  buckets: MinuteBucket[];
  alerts: ModerationAlert[];
  actions: ActionRecord[];
  questions: QuestionCluster[];
  trending: TopicTrend[];
  sentiment: ChatPulse["sentiment"];
  important: ImportantMessage[];
  newViewers: number;
  language: "en" | "fr";
}

const T = {
  en: {
    nothing: "All quiet — nothing important since your last check.",
    incidents: "Incidents",
    unresolved: "Unresolved alerts",
    questions: "Questions",
    trends: "Trends",
    conversation: "Important conversation",
    actions: "Moderation actions",
    msgs: (n: number) => `${n} new message${n === 1 ? "" : "s"}`,
    critical: (n: number) => `${n} critical incident${n === 1 ? "" : "s"}`,
    open: (n: number) => `${n} alert${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you`,
    newViewers: (n: number) => `${n} new chatter${n === 1 ? "" : "s"}`,
    unanswered: "unanswered",
    answered: "answered",
    mood: "Chat mood",
    pending: "manual step pending in TikTok",
  },
  fr: {
    nothing: "Tout est calme — rien d'important depuis ta dernière vérification.",
    incidents: "Incidents",
    unresolved: "Alertes non résolues",
    questions: "Questions",
    trends: "Tendances",
    conversation: "Conversation importante",
    actions: "Actions de modération",
    msgs: (n: number) => `${n} nouveau${n > 1 ? "x" : ""} message${n > 1 ? "s" : ""}`,
    critical: (n: number) => `${n} incident${n > 1 ? "s" : ""} critique${n > 1 ? "s" : ""}`,
    open: (n: number) => `${n} alerte${n > 1 ? "s" : ""} à traiter`,
    newViewers: (n: number) => `${n} nouveau${n > 1 ? "x" : ""} participant${n > 1 ? "s" : ""}`,
    unanswered: "sans réponse",
    answered: "répondu",
    mood: "Ambiance du chat",
    pending: "étape manuelle en attente dans TikTok",
  },
};

const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildCatchUp(input: CatchUpInput): CatchUp {
  const t = T[input.language];
  const { since, until } = input;
  const messages = input.buckets.filter((b) => b.t + 60_000 > since).reduce((a, b) => a + b.messages, 0);
  const newAlerts = input.alerts.filter((a) => a.createdAt >= since || a.updatedAt >= since);
  const critical = newAlerts.filter((a) => a.severity === "critical");
  const unresolved = input.alerts.filter((a) => a.status === "open");
  const actions = input.actions.filter((a) => a.performedAt >= since && a.adapter !== "novus-ai");
  const lang = (c: string) => CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS]?.[input.language] ?? c;

  const sections: CatchUpSection[] = [];

  if (newAlerts.length) {
    sections.push({
      title: t.incidents,
      items: newAlerts
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, 5)
        .map((a) => `${word(a.severity, input.language).toUpperCase()} · @${a.viewer.username} (${a.riskScore}) — ${a.categories.slice(0, 2).map(lang).join(", ")}: “${clip(a.text)}”${a.occurrences > 1 ? ` ×${a.occurrences}` : ""}`),
    });
  }
  if (unresolved.length) {
    sections.push({
      title: t.unresolved,
      items: unresolved.slice(0, 5).map((a) => {
        const pending = a.resolution?.status === "manual_required" && !a.resolution.confirmedAt;
        return `@${a.viewer.username} — ${word(a.recommendedAction, input.language).toUpperCase()}${pending ? ` (${t.pending})` : ""}`;
      }),
    });
  }
  if (input.questions.length) {
    sections.push({
      title: t.questions,
      items: input.questions.slice(0, 4).map((q) => `“${clip(q.question, 60)}” ×${q.count} — ${q.answered ? t.answered : t.unanswered}`),
    });
  }
  const trendItems = input.trending.slice(0, 3).map((topic) => `${tr(topic.topic, input.language)} (${topic.count}${topic.growth > 0 ? `, +${topic.growth}%` : ""})`);
  trendItems.push(`${t.mood}: ${tr(input.sentiment.label, input.language)}${input.sentiment.shift ? ` — ${tr(input.sentiment.shift, input.language)}` : ""}`);
  sections.push({ title: t.trends, items: trendItems });
  if (input.important.length) {
    sections.push({ title: t.conversation, items: input.important.map((m) => `@${m.viewer.username}: “${clip(tr(m.text, input.language))}” — ${tr(m.reason, input.language)}`) });
  }
  if (actions.length) {
    sections.push({
      title: t.actions,
      items: actions.slice(-6).map((a) => `${word(a.action, input.language).toUpperCase()} @${a.viewer.username} — ${word(a.status, input.language)}${a.confirmedAt ? " ✓" : ""}`),
    });
  }

  const headlineParts = [t.msgs(messages)];
  if (critical.length) headlineParts.unshift(t.critical(critical.length));
  if (unresolved.length) headlineParts.push(t.open(unresolved.length));
  if (input.newViewers) headlineParts.push(t.newViewers(input.newViewers));
  const quiet = messages === 0 && newAlerts.length === 0 && actions.length === 0;

  return {
    since,
    until,
    headline: quiet ? t.nothing : `${headlineParts.join(" · ")}.`,
    sections: quiet ? [] : sections,
    source: "local",
  };
}
