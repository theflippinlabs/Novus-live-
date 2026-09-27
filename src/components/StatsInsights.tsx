import { useCallback } from "react";
import type { CopilotTurn, StatsInsights } from "../../shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { AskPanel } from "./AskPanel";
import { BarChart } from "./Charts";

// Stats page, "at a glance" part: score, comparison with past LIVEs, useful ratios, key
// moments, the recent trend, and a conversation with Novus about the numbers.

type Lang = "en" | "fr";
const TX = {
  en: {
    score: "LIVE score",
    scoreHint: "Indicative: audience participation, followers won, chat safety and support (gifts).",
    grade: (s: number) => (s >= 80 ? "Excellent LIVE" : s >= 60 ? "Good LIVE" : s >= 40 ? "Decent LIVE" : "Room to improve"),
    parts: { engagement: "Engagement", audience: "Audience", safety: "Safety", monetization: "Gifts" },
    vs: (n: number) => `Vs your ${n} previous LIVE${n > 1 ? "s" : ""}`,
    avg: "avg.",
    same: "same",
    metrics: { duration: "Duration (min)", messagesPerMin: "Messages / min", peakViewers: "Peak viewers", uniqueChatters: "Chatters", gifts: "Gifts", diamonds: "Diamonds", alertsPer1k: "Alerts / 1,000 msgs" },
    ratios: "Key ratios",
    r: {
      messagesPerMin: "messages / min",
      messagesPerChatter: "messages per chatter",
      participation: "of viewers chatted",
      followsPer100: "followers / 100 viewers",
      giftsPerHour: "gifts / hour",
      diamondsPerHour: "diamonds / hour",
      donorRate: "of viewers sent a gift",
      alertsPer1k: "alerts / 1,000 msgs",
      handledPct: "alerts handled",
      avgResponseSec: "s to react",
    },
    moments: "Key moments",
    m: {
      chat_peak: (v: number) => `Chat peak — ${v} messages in a minute`,
      audience_peak: (v: number) => `Audience peak — ${v.toLocaleString("en-GB")} viewers`,
      tense: (v: number) => `Most tense moment — ${v} alert${v > 1 ? "s" : ""}`,
      quiet: (v: number) => `Quietest moment — ${v} messages`,
    },
    trend: "Your last LIVEs · peak viewers",
    trendTip: (d: string, v: number, m: number) => `${d} · ${v.toLocaleString("en-GB")} viewers · ${m.toLocaleString("en-GB")} msgs`,
    ask: "Make the numbers talk",
    askHint: "Ask Novus anything about these stats — it answers from this LIVE's real numbers.",
    chips: ["Analyse this LIVE in 5 points", "What worked best?", "Compare with my previous LIVEs", "What was the best moment and why?", "How do I do better next LIVE?"],
  },
  fr: {
    score: "Score du LIVE",
    scoreHint: "Indicatif : participation du public, abonnés gagnés, sécurité du chat et soutiens (cadeaux).",
    grade: (s: number) => (s >= 80 ? "Excellent LIVE" : s >= 60 ? "Bon LIVE" : s >= 40 ? "LIVE correct" : "À améliorer"),
    parts: { engagement: "Engagement", audience: "Audience", safety: "Sécurité", monetization: "Cadeaux" },
    vs: (n: number) => `Comparé à tes ${n} LIVE précédent${n > 1 ? "s" : ""}`,
    avg: "moy.",
    same: "stable",
    metrics: { duration: "Durée (min)", messagesPerMin: "Messages / min", peakViewers: "Pic de spectateurs", uniqueChatters: "Participants au chat", gifts: "Cadeaux", diamonds: "Diamants", alertsPer1k: "Alertes / 1 000 msg" },
    ratios: "Ratios clés",
    r: {
      messagesPerMin: "messages / min",
      messagesPerChatter: "messages par participant",
      participation: "des spectateurs ont écrit",
      followsPer100: "abonnés / 100 spectateurs",
      giftsPerHour: "cadeaux / heure",
      diamondsPerHour: "diamants / heure",
      donorRate: "des spectateurs ont offert",
      alertsPer1k: "alertes / 1 000 msg",
      handledPct: "des alertes traitées",
      avgResponseSec: "s pour réagir",
    },
    moments: "Moments forts",
    m: {
      chat_peak: (v: number) => `Pic du chat — ${v} messages en une minute`,
      audience_peak: (v: number) => `Pic d'audience — ${v.toLocaleString("fr-FR")} spectateurs`,
      tense: (v: number) => `Moment le plus tendu — ${v} alerte${v > 1 ? "s" : ""}`,
      quiet: (v: number) => `Creux — ${v} messages`,
    },
    trend: "Tes derniers LIVE · pic de spectateurs",
    trendTip: (d: string, v: number, m: number) => `${d} · ${v.toLocaleString("fr-FR")} spectateurs · ${m.toLocaleString("fr-FR")} msg`,
    ask: "Fais parler les chiffres",
    askHint: "Pose n'importe quelle question sur ces stats — Novus répond avec les vrais chiffres de ce LIVE.",
    chips: ["Analyse ce LIVE en 5 points", "Qu'est-ce qui a le mieux marché ?", "Compare avec mes LIVE précédents", "Quel a été le meilleur moment et pourquoi ?", "Comment faire mieux au prochain LIVE ?"],
  },
};

const hm = (t: number) => new Date(t).toTimeString().slice(0, 5);

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter-row">
      <div className="meter-head">
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <div className="meter" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function fmtRatio(key: keyof StatsInsights["ratios"], v: number, lang: Lang): string {
  const n = (x: number, d = 0) => x.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: d });
  if (key === "participation" || key === "donorRate" || key === "handledPct") return `${n(v, 1)} %`;
  if (key === "diamondsPerHour") return n(v);
  return n(v, 1);
}

export function StatsInsightsPanel({ insights, sessionId }: { insights: StatsInsights; sessionId?: string }) {
  const lang = useLang();
  const tx = TX[lang];
  const s = insights.score;
  const locale = lang === "fr" ? "fr-FR" : "en-GB";
  const day = (t: number) => new Date(t).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const ask = useCallback((q: string, history: CopilotTurn[]) => api.askStats(q, history, sessionId, lang).then((r) => r.text), [sessionId, lang]);
  const ratioKeys = (Object.keys(tx.r) as (keyof StatsInsights["ratios"])[]).filter((k) => insights.ratios[k] !== null && k !== "durationMin");

  return (
    <>
      <div className="card score-card">
        <div className="card-title">
          <span className="gold">◆</span> {tx.score}
        </div>
        <div className="score-hero">
          <div className="score-num">
            {s.total}
            <span>/100</span>
          </div>
          <div className="score-grade">{tx.grade(s.total)}</div>
        </div>
        <div className="meters">
          {(["engagement", "audience", "safety", "monetization"] as const).map((k) => (
            <Meter key={k} label={tx.parts[k]} value={s[k]} />
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          {tx.scoreHint}
        </div>
      </div>

      {insights.comparison ? (
        <div className="card">
          <div className="card-title">{tx.vs(insights.comparison.lives)}</div>
          {insights.comparison.metrics.map((m) => {
            const flat = Math.abs(m.deltaPct) < 5;
            const good = m.higherIsBetter ? m.deltaPct > 0 : m.deltaPct < 0;
            return (
              <div key={m.key} className="cmp-row">
                <span className="cmp-label">{tx.metrics[m.key]}</span>
                <span className="cmp-val">
                  <b>{m.value.toLocaleString(locale)}</b>
                  <span className="small muted">
                    {" "}
                    · {tx.avg} {m.average.toLocaleString(locale)}
                  </span>
                </span>
                <span className={`delta ${flat ? "flat" : good ? "good" : "bad"}`}>{flat ? `= ${tx.same}` : `${m.deltaPct > 0 ? "▲ +" : "▼ "}${m.deltaPct} %`}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      <AskPanel title={tx.ask} hint={tx.askHint} chips={tx.chips} storageKey={`novus:stats:${sessionId ?? "none"}`} ask={ask} />

      <div className="card">
        <div className="card-title">{tx.ratios}</div>
        <div className="ratio-grid">
          {ratioKeys.map((k) => (
            <div key={k} className="ratio">
              <b>{fmtRatio(k, insights.ratios[k] as number, lang)}</b>
              <span>{tx.r[k as keyof typeof tx.r]}</span>
            </div>
          ))}
        </div>
      </div>

      {insights.moments.length ? (
        <div className="card">
          <div className="card-title">{tx.moments}</div>
          {insights.moments.map((m) => (
            <div key={`${m.kind}${m.t}`} className="moment">
              <span className="mono moment-t">{hm(m.t)}</span>
              <span className={`moment-dot ${m.kind}`} aria-hidden="true" />
              <span>{tx.m[m.kind](m.value)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {insights.trend.length >= 2 ? (
        <div className="card">
          <div className="card-title">{tx.trend}</div>
          <BarChart
            label={tx.trend}
            data={insights.trend.map((x) => ({ t: x.startedAt, v: x.peakViewers }))}
            color="#8a7657"
            highlight="#d9ae6a"
            axisLabel={day}
            format={(p) => {
              const x = insights.trend.find((e) => e.startedAt === p.t);
              return tx.trendTip(day(p.t), p.v, x?.messages ?? 0);
            }}
          />
        </div>
      ) : null}
    </>
  );
}
