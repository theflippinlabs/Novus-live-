import type { HistoryEntry, Leaderboard, LeaderboardBadge, LeaderboardEntry } from "../../shared/types";

/*
 * Stats › Ranking: the followed streamers over a period, with one score that mixes what
 * matters to an agency. Each part is 0-100 relative to the best streamer of the group
 * (logarithmic where a few big LIVEs would crush everyone else), then weighted:
 *
 *   gifts (diamonds, per hour) 30 % · engagement (chat participation, pace) 25 %
 *   audience (average viewers, follower conversion) 20 % · activity (hours, LIVEs) 15 %
 *   safety (alerts per 1,000 messages, absolute) 10 %
 */

export const WEIGHTS = { monetization: 0.3, engagement: 0.25, audience: 0.2, activity: 0.15, safety: 0.1 } as const;
/** A LIVE shorter than this is ignored (tests, false starts). */
const MIN_LIVE_MS = 5 * 60_000;

const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const norm = (v: number, max: number) => (max > 0 ? (v / max) * 100 : 0);
const logNorm = (v: number, max: number) => (max > 0 ? (Math.log1p(v) / Math.log1p(max)) * 100 : 0);

export function buildLeaderboard(entries: HistoryEntry[], days: number | null, now = Date.now()): Leaderboard {
  const since = days ? now - days * 86_400_000 : 0;
  const lives = entries.filter((e) => e.account && e.source === "tiktok" && e.startedAt >= since && e.durationMs >= MIN_LIVE_MS);
  const byAccount = new Map<string, HistoryEntry[]>();
  for (const e of lives) byAccount.set(e.account!, [...(byAccount.get(e.account!) ?? []), e]);

  type Raw = Omit<LeaderboardEntry, "rank" | "score" | "parts" | "badges">;
  const raws: Raw[] = [...byAccount.entries()].map(([account, list]) => {
    const hours = list.reduce((s, e) => s + e.durationMs, 0) / 3_600_000;
    const messages = list.reduce((s, e) => s + e.messages, 0);
    const diamonds = list.reduce((s, e) => s + e.diamonds, 0);
    const alerts = list.reduce((s, e) => s + e.alerts, 0);
    const avgViewers = list.reduce((s, e) => s + (e.avgViewers ?? e.peakViewers), 0) / list.length;
    // Share of the audience that chatted, per LIVE, weighted by duration.
    const withAudience = list.filter((e) => (e.avgViewers ?? e.peakViewers) > 0);
    const weight = withAudience.reduce((s, e) => s + e.durationMs, 0);
    const engagementRate = weight ? withAudience.reduce((s, e) => s + Math.min(100, (e.uniqueChatters / (e.avgViewers || e.peakViewers)) * 100) * e.durationMs, 0) / weight : null;
    const seen = list.reduce((s, e) => s + (e.seenViewers ?? 0), 0);
    const follows = list.reduce((s, e) => s + (e.follows ?? 0), 0);
    const donors = list.reduce((s, e) => s + (e.donors ?? 0), 0);
    return {
      account,
      lives: list.length,
      hours: r1(hours),
      diamonds,
      diamondsPerHour: hours ? Math.round(diamonds / hours) : 0,
      avgViewers: Math.round(avgViewers),
      peakViewers: Math.max(...list.map((e) => e.peakViewers)),
      engagementRate: engagementRate === null ? null : r1(engagementRate),
      messagesPerMin: r1(messages / Math.max(1, hours * 60)),
      followConversion: seen >= 20 ? r1(Math.min(100, (follows / seen) * 100)) : null,
      donorConversion: seen >= 20 ? r1(Math.min(100, (donors / seen) * 100)) : null,
      alertsPer1k: messages ? r1((alerts / messages) * 1000) : 0,
      lastLiveAt: Math.max(...list.map((e) => e.startedAt)),
    };
  });

  const max = (f: (r: Raw) => number | null) => Math.max(0, ...raws.map((r) => f(r) ?? 0));
  const m = {
    diamonds: max((r) => r.diamonds),
    dph: max((r) => r.diamondsPerHour),
    eng: max((r) => r.engagementRate),
    mpm: max((r) => r.messagesPerMin),
    viewers: max((r) => r.avgViewers),
    follow: max((r) => r.followConversion),
    hours: max((r) => r.hours),
    lives: max((r) => r.lives),
  };
  const scored = raws.map((r) => {
    const parts = {
      monetization: clamp(logNorm(r.diamonds, m.diamonds) * 0.7 + norm(r.diamondsPerHour, m.dph) * 0.3),
      engagement: clamp(norm(r.engagementRate ?? 0, m.eng) * 0.6 + norm(r.messagesPerMin, m.mpm) * 0.4),
      // Without follower data, the audience part rests on the viewers alone.
      audience: clamp(r.followConversion === null || !m.follow ? logNorm(r.avgViewers, m.viewers) : logNorm(r.avgViewers, m.viewers) * 0.6 + norm(r.followConversion, m.follow) * 0.4),
      activity: clamp(norm(r.hours, m.hours) * 0.6 + norm(r.lives, m.lives) * 0.4),
      safety: clamp(100 - r.alertsPer1k * 2),
    };
    const score = clamp((Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((s, k) => s + parts[k] * WEIGHTS[k], 0));
    return { ...r, parts, score };
  });
  scored.sort((a, b) => b.score - a.score || b.diamonds - a.diamonds || b.hours - a.hours);

  // Badges go to the leader of each dimension (only with at least two streamers to compare).
  const leader = (f: (r: (typeof scored)[number]) => number, min = 0) => {
    if (scored.length < 2) return null;
    const best = [...scored].sort((a, b) => f(b) - f(a))[0];
    return f(best) > min ? best.account : null;
  };
  const badgeOf: [LeaderboardBadge, string | null][] = [
    ["top_diamonds", leader((r) => r.diamonds)],
    ["top_engagement", leader((r) => r.engagementRate ?? 0)],
    ["top_audience", leader((r) => r.avgViewers)],
    ["most_active", leader((r) => r.hours)],
    ["safest", leader((r) => (r.lives >= 2 ? 100 - r.alertsPer1k : 0))],
  ];

  return {
    days,
    lives: lives.length,
    generatedAt: now,
    entries: scored.map((r, i) => ({ ...r, rank: i + 1, badges: badgeOf.filter(([, a]) => a === r.account).map(([b]) => b) })),
  };
}
