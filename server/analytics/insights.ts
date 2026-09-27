import type { AnalyticsSummary, HistoryEntry, StatsInsights } from "../../shared/types";

/*
 * Stats page: ratios, key moments, a comparison with the account's previous LIVEs and an
 * indicative score — all derived from the LIVE's own summary (no AI, no extra storage).
 */

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const r1 = (v: number) => Math.round(v * 10) / 10;

export function deriveInsights(d: AnalyticsSummary, history: HistoryEntry[] = []): StatsInsights {
  const t = d.totals;
  const minutes = Math.max(1, d.durationMs / 60_000);
  const hours = minutes / 60;
  const audienceBase = d.audience ? (d.audience.avgViewers ?? 0) || d.audience.peakViewers : 0;
  const seen = d.audience?.seenViewers ?? 0;
  const follows = d.audience?.follows ?? t.follows;
  const gifts = d.gifts?.total ?? t.gifts;
  const diamonds = d.gifts?.diamonds ?? 0;
  const senders = d.gifts?.senders ?? 0;
  const alertsPer1k = t.messages ? (t.alerts / t.messages) * 1000 : 0;

  const ratios: StatsInsights["ratios"] = {
    durationMin: Math.round(minutes),
    messagesPerMin: r1(t.messages / minutes),
    messagesPerChatter: t.uniqueChatters ? r1(t.messages / t.uniqueChatters) : null,
    participation: audienceBase > 0 ? r1(Math.min(100, (t.uniqueChatters / audienceBase) * 100)) : null,
    followsPer100: seen > 0 ? r1((follows / seen) * 100) : null,
    giftsPerHour: minutes >= 10 ? r1(gifts / hours) : null,
    diamondsPerHour: minutes >= 10 ? Math.round(diamonds / hours) : null,
    donorRate: seen > 0 ? r1((senders / seen) * 100) : null,
    alertsPer1k: r1(alertsPer1k),
    handledPct: t.alerts ? clamp((t.actions / t.alerts) * 100) : null,
    avgResponseSec: d.avgResponseTimeMs !== null ? r1(d.avgResponseTimeMs / 1000) : null,
  };

  // Indicative score: how lively, how well the audience converts, how safe, how generous.
  const engagement = clamp(ratios.participation !== null ? (ratios.participation / 30) * 100 : Math.min(100, ratios.messagesPerMin * 4));
  const audience = clamp(ratios.followsPer100 !== null ? (ratios.followsPer100 / 5) * 100 : 50);
  const safety = clamp(100 - alertsPer1k * 2 - t.critical * 5);
  const monetization = clamp(ratios.donorRate !== null ? (ratios.donorRate / 20) * 100 : gifts ? 50 : 0);
  const total = clamp(engagement * 0.35 + audience * 0.2 + safety * 0.3 + monetization * 0.15);

  // Key moments, from the per-minute buckets.
  const moments: StatsInsights["moments"] = [];
  if (d.peak) moments.push({ kind: "chat_peak", t: d.peak.t, value: d.peak.messages });
  if (d.audience?.peakAt && d.audience.peakViewers) moments.push({ kind: "audience_peak", t: d.audience.peakAt, value: d.audience.peakViewers });
  const busy = d.buckets.filter((b) => b.messages >= 5);
  const tense = busy.filter((b) => b.alerts > 0).sort((a, b) => b.alerts - a.alerts || b.toxicity - a.toxicity)[0];
  if (tense) moments.push({ kind: "tense", t: tense.t, value: tense.alerts });
  // Quietest minute after the first five (the LIVE starting is always calm).
  const after = d.buckets.slice(5, -1);
  if (after.length >= 5) {
    const quiet = [...after].sort((a, b) => a.messages - b.messages)[0];
    if (d.peak && quiet.messages < d.peak.messages * 0.3) moments.push({ kind: "quiet", t: quiet.t, value: quiet.messages });
  }
  moments.sort((a, b) => a.t - b.t);

  // Same account's previous real LIVEs.
  const sid = d.session?.id;
  const previous = history.filter((h) => h.sessionId !== sid && h.source !== "demo" && h.status !== "live" && h.durationMs >= 60_000).slice(0, 10);
  let comparison: StatsInsights["comparison"] = null;
  if (previous.length) {
    const avg = (f: (h: HistoryEntry) => number) => previous.reduce((s, h) => s + f(h), 0) / previous.length;
    const metric = (key: NonNullable<StatsInsights["comparison"]>["metrics"][number]["key"], value: number, average: number, higherIsBetter = true) => ({
      key,
      value: r1(value),
      average: r1(average),
      deltaPct: average > 0 ? Math.round(((value - average) / average) * 100) : 0,
      higherIsBetter,
    });
    comparison = {
      lives: previous.length,
      metrics: [
        metric("duration", minutes, avg((h) => h.durationMs / 60_000)),
        metric("messagesPerMin", t.messages / minutes, avg((h) => h.messages / Math.max(1, h.durationMs / 60_000))),
        metric("peakViewers", d.audience?.peakViewers ?? 0, avg((h) => h.peakViewers)),
        metric("uniqueChatters", t.uniqueChatters, avg((h) => h.uniqueChatters)),
        metric("gifts", gifts, avg((h) => h.gifts)),
        metric("diamonds", diamonds, avg((h) => h.diamonds)),
        metric("alertsPer1k", alertsPer1k, avg((h) => (h.messages ? (h.alerts / h.messages) * 1000 : 0)), false),
      ],
    };
  }

  const trendSource = [
    ...(sid ? [{ sessionId: sid, startedAt: d.session!.startedAt, peakViewers: d.audience?.peakViewers ?? 0, messages: t.messages, diamonds, alerts: t.alerts, current: true }] : []),
    ...previous.map((h) => ({ sessionId: h.sessionId, startedAt: h.startedAt, peakViewers: h.peakViewers, messages: h.messages, diamonds: h.diamonds, alerts: h.alerts, current: false })),
  ];
  const trend = trendSource.sort((a, b) => a.startedAt - b.startedAt).slice(-10);

  return { score: { total, engagement, audience, safety, monetization }, ratios, moments, comparison, trend };
}
