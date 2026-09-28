import type { GoalProgress, HistoryEntry, WeeklyGoals } from "../../shared/types";

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
  const toInstant = (wall: number) => {
    const first = wall - offsetAt(wall, timeZone);
    return wall - offsetAt(first, timeZone);
  };
  return { start: toInstant(mondayUtc), end: toInstant(nextUtc) };
}

/** A LIVE shorter than this does not count as one of the week's LIVEs. */
const MIN_LIVE_MS = 5 * 60_000;

export function goalProgress(account: string, goals: WeeklyGoals, entries: HistoryEntry[], now: number, timeZone: string): GoalProgress {
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
  };
}
