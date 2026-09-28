import { TIER_KEYS, type GoalProgress, type HistoryEntry, type TierKey, type TierProgram, type TierProgress, type WeeklyGoals } from "../../shared/types";

/*
 * A streamer's weekly goals and where they stand: this week's LIVEs (Monday 00:00 to
 * Sunday 24:00 in the space's time zone), the running one included.
 */

/** Offset (ms) of `timeZone` from UTC at instant `t`. */
function offsetAt(t: number, timeZone: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}

/** Monday 00:00 of the week containing `now`, and the next Monday, in `timeZone`. */
export function weekBounds(now: number, timeZone: string): { start: number; end: number } {
  const local = new Date(now + offsetAt(now, timeZone));
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const mondayUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday);
  const nextUtc = mondayUtc + 7 * 86_400_000;
  // Local midnight → instant (twice, for a DST change inside the day).
  return { start: toInstant(mondayUtc, timeZone), end: toInstant(nextUtc, timeZone) };
}

/** Local wall-clock time (as a UTC number) → instant (twice, for a DST change inside the day). */
function toInstant(wall: number, timeZone: string): number {
  const first = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(first, timeZone);
}

/** The 1st of the month containing `now`, 00:00, and the 1st of the next month, in `timeZone`. */
export function monthBounds(now: number, timeZone: string): { start: number; end: number } {
  const local = new Date(now + offsetAt(now, timeZone));
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  return { start: toInstant(Date.UTC(y, m, 1), timeZone), end: toInstant(Date.UTC(y, m + 1, 1), timeZone) };
}

/** Minutes of LIVE per local day ("YYYY-MM-DD"), a LIVE across midnight split between its days. */
export function minutesPerDay(lives: { startedAt: number; durationMs: number }[], timeZone: string): Map<string, number> {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const days = new Map<string, number>();
  for (const l of lives) {
    const end = l.startedAt + l.durationMs;
    for (let t = l.startedAt; t < end; t += 60_000) {
      const key = fmt.format(new Date(t));
      days.set(key, (days.get(key) ?? 0) + Math.min(1, (end - t) / 60_000));
    }
  }
  return days;
}

/** A LIVE shorter than this does not count as one of the week's LIVEs. */
const MIN_LIVE_MS = 5 * 60_000;

/** Where the streamer stands against TikTok's reward tiers over the program's period. */
export function tierProgress(account: string, program: TierProgram, source: TierProgress["source"], entries: HistoryEntry[], now: number, timeZone: string): TierProgress {
  const { start, end } = program.period === "month" ? monthBounds(now, timeZone) : weekBounds(now, timeZone);
  const lives = entries.filter((e) => e.account?.toLowerCase() === account.toLowerCase() && e.source === "tiktok" && e.startedAt >= start && e.startedAt < end && (e.status === "live" || e.durationMs >= MIN_LIVE_MS));
  const perDay = minutesPerDay(lives, timeZone);
  const done: Record<TierKey, number> = {
    validDays: [...perDay.values()].filter((m) => m >= program.validDayMinutes).length,
    hours: Math.round((lives.reduce((s, e) => s + e.durationMs, 0) / 3_600_000) * 10) / 10,
    diamonds: lives.reduce((s, e) => s + e.diamonds, 0),
    follows: lives.reduce((s, e) => s + (e.follows ?? 0), 0),
  };
  const tiers = [...program.tiers]
    .sort((a, b) => a.percent - b.percent)
    .map((t) => {
      const missing: Partial<Record<TierKey, number>> = {};
      for (const k of TIER_KEYS) {
        const need = t[k];
        if (need !== undefined && done[k] < need) missing[k] = Math.round((need - done[k]) * 10) / 10;
      }
      return { ...t, reached: Object.keys(missing).length === 0, missing };
    });
  const reached = tiers.map((t, i) => (t.reached ? i : -1)).filter((i) => i >= 0);
  const current = reached.length ? reached[reached.length - 1] : null;
  const nextIdx = tiers.findIndex((t, i) => !t.reached && (current === null || i > current));
  return {
    period: program.period,
    periodStart: start,
    periodEnd: end,
    elapsed: Math.round(Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))),
    validDayMinutes: program.validDayMinutes,
    source,
    done,
    tiers,
    current,
    next: nextIdx >= 0 ? nextIdx : null,
  };
}

export function goalProgress(account: string, goals: WeeklyGoals, entries: HistoryEntry[], now: number, timeZone: string, tiers?: { program: TierProgram; source: TierProgress["source"] }): GoalProgress {
  const { start, end } = weekBounds(now, timeZone);
  const week = entries.filter((e) => e.account?.toLowerCase() === account.toLowerCase() && e.source === "tiktok" && e.startedAt >= start && e.startedAt < end && (e.status === "live" || e.durationMs >= MIN_LIVE_MS));
  const hours = week.reduce((s, e) => s + e.durationMs, 0) / 3_600_000;
  return {
    account,
    weekStart: start,
    weekEnd: end,
    weekElapsed: Math.round(Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))),
    goals,
    done: {
      diamonds: week.reduce((s, e) => s + e.diamonds, 0),
      hours: Math.round(hours * 10) / 10,
      lives: week.length,
      follows: week.reduce((s, e) => s + (e.follows ?? 0), 0),
      peakViewers: Math.max(0, ...week.map((e) => e.peakViewers)),
    },
    livesCounted: week.length,
    tiers: tiers ? tierProgress(account, tiers.program, tiers.source, entries, now, timeZone) : null,
  };
}
