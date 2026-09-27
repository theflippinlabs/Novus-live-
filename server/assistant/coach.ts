import { tr } from "../../shared/i18n";
import type { ChatPulse, CoachTip, LiveStats, ModerationAlert } from "../../shared/types";

/*
 * "What should I do now?" — deterministic tips from the LIVE's own data (no AI, no cost),
 * most urgent first. Tip ids stay the same while the situation lasts, so the app can
 * hide one the streamer dismissed until something changes.
 */

export interface CoachInput {
  pulse: ChatPulse;
  openAlerts: ModerationAlert[];
  stats: LiveStats;
  live: boolean;
  language: "en" | "fr";
}

const T = {
  en: {
    critical: (n: number) => (n === 1 ? "1 critical alert to handle" : `${n} critical alerts to handle`),
    open: (n: number) => `${n} alerts waiting for the team`,
    latest: (u: string, text: string) => `Latest: @${u} — “${text}”`,
    question: "Answer the question that keeps coming back",
    asked: (q: string, n: number) => `“${q}” — asked ${n} times`,
    moodTitle: "The mood is turning negative",
    moodDetail: "The chat is getting tense. Reset the tone calmly, or change the subject.",
    slowTitle: (p: number) => `The chat is slowing down (${p}%)`,
    slowDetail: "Ask your viewers a question or launch a challenge to bring the chat back.",
    spikeTitle: (p: number) => `The chat is taking off (+${p}%)`,
    spikeDetail: "Ride the wave: welcome the newcomers and tease your next big moment.",
    thanksTitle: (u: string) => `Thank @${u}`,
    thanksDetail: (g: number, d: number) => `${g} gift${g === 1 ? "" : "s"}${d ? ` · ${d.toLocaleString("en-GB")} diamonds` : ""} — your top supporter.`,
    topicTitle: (t: string) => `The chat is talking about “${t}”`,
    topicDetail: "Bounce off it to keep the conversation going.",
    calmTitle: "Everything is under control",
    calmDetail: "No open incident, no pending question. Enjoy your LIVE.",
    idleTitle: "Waiting for the LIVE",
    idleDetail: "As soon as the LIVE starts, Novus tells you here what needs you.",
  },
  fr: {
    critical: (n: number) => (n === 1 ? "1 alerte critique à traiter" : `${n} alertes critiques à traiter`),
    open: (n: number) => `${n} alertes en attente pour l'équipe`,
    latest: (u: string, text: string) => `Dernière : @${u} — « ${text} »`,
    question: "Réponds à la question qui revient",
    asked: (q: string, n: number) => `« ${q} » — posée ${n} fois`,
    moodTitle: "L'ambiance se dégrade",
    moodDetail: "Le chat devient tendu. Recadre calmement, ou change de sujet.",
    slowTitle: (p: number) => `Le chat ralentit (${p} %)`,
    slowDetail: "Pose une question à ton public ou lance un défi pour relancer le chat.",
    spikeTitle: (p: number) => `Le chat s'emballe (+${p} %)`,
    spikeDetail: "Profite de la vague : accueille les nouveaux et annonce ton prochain moment fort.",
    thanksTitle: (u: string) => `Remercie @${u}`,
    thanksDetail: (g: number, d: number) => `${g} cadeau${g === 1 ? "" : "x"}${d ? ` · ${d.toLocaleString("fr-FR")} diamants` : ""} — ton plus grand soutien.`,
    topicTitle: (t: string) => `Le chat parle de « ${t} »`,
    topicDetail: "Rebondis dessus pour garder la conversation vivante.",
    calmTitle: "Tout est sous contrôle",
    calmDetail: "Aucun incident ouvert, aucune question en attente. Profite de ton LIVE.",
    idleTitle: "En attente du LIVE",
    idleDetail: "Dès que le LIVE démarre, Novus t'indique ici ce qui a besoin de toi.",
  },
};

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildCoach({ pulse, openAlerts, stats, live, language }: CoachInput): CoachTip[] {
  const tx = T[language];
  const tips: CoachTip[] = [];
  if (!live && pulse.messagesTotal === 0) return [{ id: "idle", kind: "idle", priority: 3, title: tx.idleTitle, detail: tx.idleDetail }];

  const byRecent = [...openAlerts].sort((a, b) => b.updatedAt - a.updatedAt);
  const critical = byRecent.filter((a) => a.severity === "critical");
  if (critical.length) {
    const a = critical[0];
    tips.push({ id: `alerts:critical:${critical.length}`, kind: "alerts", priority: 1, title: tx.critical(critical.length), detail: tx.latest(a.viewer.username, clip(a.text, 70)), viewer: a.viewer });
  } else if (byRecent.length >= 3) {
    const a = byRecent[0];
    tips.push({ id: `alerts:open:${byRecent.length}`, kind: "alerts", priority: 2, title: tx.open(byRecent.length), detail: tx.latest(a.viewer.username, clip(a.text, 70)), viewer: a.viewer });
  }

  const q = pulse.topUnanswered;
  if (q && q.count >= 2) {
    tips.push({ id: `question:${q.id}`, kind: "question", priority: q.count >= 5 ? 1 : 2, title: tx.question, detail: tx.asked(clip(q.question), q.count), questionId: q.id, question: q.question });
  }

  const mood = pulse.sentiment;
  if (mood.current < -0.2 || mood.change <= -0.25) tips.push({ id: "mood", kind: "mood", priority: 2, title: tx.moodTitle, detail: tx.moodDetail });

  // Activity: only meaningful once the chat has some volume.
  if (stats.messagesTotal >= 30) {
    if (pulse.activityChangePct <= -35) tips.push({ id: "activity:slow", kind: "activity", priority: 3, title: tx.slowTitle(pulse.activityChangePct), detail: tx.slowDetail });
    else if (pulse.activityChangePct >= 60) tips.push({ id: "activity:spike", kind: "spike", priority: 3, title: tx.spikeTitle(pulse.activityChangePct), detail: tx.spikeDetail });
  }

  const top = pulse.supporters[0];
  if (top && top.gifts > 0) {
    tips.push({ id: `supporter:${top.viewer.id}:${top.gifts}`, kind: "supporter", priority: 3, title: tx.thanksTitle(top.viewer.username), detail: tx.thanksDetail(top.gifts, top.diamonds), viewer: top.viewer });
  }

  const topic = pulse.trending[0];
  if (topic && topic.count >= 5) tips.push({ id: `topic:${topic.topic}`, kind: "topic", priority: 3, title: tx.topicTitle(tr(topic.topic, language)), detail: tx.topicDetail });

  if (!tips.some((t) => t.priority <= 2)) tips.push({ id: "calm", kind: "calm", priority: 3, title: tx.calmTitle, detail: tx.calmDetail });
  return tips.sort((a, b) => a.priority - b.priority).slice(0, 6);
}
