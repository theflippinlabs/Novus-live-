import type { DonorDirectory, DonorRetention, DonorStatus, DonorSummary } from "../../shared/types";
import type { GiftLedgerRow } from "../persistence/Repository";

/*
 * Donor directory: every viewer who sent gifts, across the space's LIVEs — total diamonds,
 * the rooms (followed accounts) they give in, how many LIVEs, the average per LIVE and
 * their favourite gift — and, to keep them giving, where each one stands (active, giving later
 * than usual, lost, new), their LIVE-by-LIVE history and trend.
 */

const DAY = 24 * 3600 * 1000;

/** Retention figures of one donor from their ledger rows (no guess: only what they sent). */
export function donorRetention(list: GiftLedgerRow[], now: number): { retention: DonorRetention; history: DonorSummary["history"] } {
  const bySession = new Map<string, { sessionId: string; account: string | null; at: number; diamonds: number; gifts: number }>();
  let topGift: DonorRetention["topGift"] = null;
  let last30 = 0;
  let prev30 = 0;
  for (const r of list) {
    const s = bySession.get(r.sessionId) ?? { sessionId: r.sessionId, account: r.account, at: r.firstAt, diamonds: 0, gifts: 0 };
    s.at = Math.min(s.at, r.firstAt);
    s.diamonds += r.diamonds;
    s.gifts += r.gifts;
    bySession.set(r.sessionId, s);
    const unit = r.gifts ? Math.round(r.diamonds / r.gifts) : 0;
    if (unit > 0 && (!topGift || unit > topGift.value)) topGift = { name: r.giftName, value: unit };
    const age = now - r.lastAt;
    if (age <= 30 * DAY) last30 += r.diamonds;
    else if (age <= 60 * DAY) prev30 += r.diamonds;
  }
  const lives = [...bySession.values()].sort((a, b) => a.at - b.at);
  const first = lives[0]?.at ?? now;
  const last = Math.max(...list.map((r) => r.lastAt));
  // Usual gap: the median of the days between two LIVEs where they gave (same day counts as 0).
  const gaps = lives.slice(1).map((l, i) => (l.at - lives[i].at) / DAY).sort((a, b) => a - b);
  const gapDays = gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)] * 10) / 10 : null;
  const daysSinceLast = Math.max(0, Math.floor((now - last) / DAY));
  const usual = gapDays ?? 7;
  const status: DonorStatus =
    daysSinceLast > Math.max(30, usual * 3) ? "lost" : daysSinceLast > Math.max(7, usual * 1.5) ? "cooling" : now - first <= 14 * DAY ? "new" : "active";
  return {
    retention: { status, daysSinceLast, gapDays, last30, prev30, bestLive: Math.max(0, ...lives.map((l) => l.diamonds)), topGift },
    history: lives.slice(-20),
  };
}

export function buildDonors(rows: GiftLedgerRow[], now = Date.now()): DonorDirectory {
  const byViewer = new Map<string, GiftLedgerRow[]>();
  for (const r of rows) {
    const list = byViewer.get(r.viewerId) ?? [];
    list.push(r);
    byViewer.set(r.viewerId, list);
  }
  const totalDiamonds = rows.reduce((s, r) => s + r.diamonds, 0);
  const donors: DonorSummary[] = [...byViewer.values()].map((list) => {
    const latest = list.reduce((a, b) => (b.lastAt > a.lastAt ? b : a));
    const diamonds = list.reduce((s, r) => s + r.diamonds, 0);
    const gifts = list.reduce((s, r) => s + r.gifts, 0);
    const lives = new Set(list.map((r) => r.sessionId)).size;

    const rooms = new Map<string, { account: string | null; diamonds: number; gifts: number; sessions: Set<string> }>();
    const byGift = new Map<string, { name: string; count: number; diamonds: number }>();
    for (const r of list) {
      const key = r.account ?? "";
      const room = rooms.get(key) ?? { account: r.account, diamonds: 0, gifts: 0, sessions: new Set<string>() };
      room.diamonds += r.diamonds;
      room.gifts += r.gifts;
      room.sessions.add(r.sessionId);
      rooms.set(key, room);
      const g = byGift.get(r.giftName) ?? { name: r.giftName, count: 0, diamonds: 0 };
      g.count += r.gifts;
      g.diamonds += r.diamonds;
      byGift.set(r.giftName, g);
    }
    const gifts_ = [...byGift.values()].sort((a, b) => b.diamonds - a.diamonds || b.count - a.count);
    // Favourite = the gift sent most often.
    const fav = [...byGift.values()].sort((a, b) => b.count - a.count || b.diamonds - a.diamonds)[0];
    return {
      viewer: { id: latest.viewerId, username: latest.username, displayName: latest.displayName, avatarUrl: latest.avatarUrl },
      diamonds,
      gifts,
      lives,
      avgDiamondsPerLive: lives ? Math.round(diamonds / lives) : 0,
      share: totalDiamonds ? Math.round((diamonds / totalDiamonds) * 1000) / 10 : 0,
      rooms: [...rooms.values()].sort((a, b) => b.diamonds - a.diamonds).map((r) => ({ account: r.account, diamonds: r.diamonds, gifts: r.gifts, lives: r.sessions.size })),
      byGift: gifts_,
      favoriteGift: fav ? { name: fav.name, count: fav.count } : null,
      firstAt: Math.min(...list.map((r) => r.firstAt)),
      lastAt: Math.max(...list.map((r) => r.lastAt)),
      ...donorRetention(list, now),
    };
  });
  donors.sort((a, b) => b.diamonds - a.diamonds || b.gifts - a.gifts);
  const status: Record<DonorStatus, number> = { new: 0, active: 0, cooling: 0, lost: 0 };
  for (const d of donors) status[d.retention.status] += 1;
  return {
    totals: { donors: donors.length, diamonds: totalDiamonds, gifts: rows.reduce((s, r) => s + r.gifts, 0), lives: new Set(rows.map((r) => r.sessionId)).size, status },
    donors,
    accounts: [...new Set(rows.map((r) => r.account).filter((a): a is string => Boolean(a)))].sort(),
  };
}

/** Donor directory as CSV (Excel-friendly: BOM, quoted fields, ";" in French). */
export function donorsCsv(dir: DonorDirectory, lang: "en" | "fr", timeZone: string): string {
  const q = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
  const sep = lang === "fr" ? ";" : ",";
  const date = new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { timeZone, dateStyle: "short" });
  const header =
    lang === "fr"
      ? ["rang", "pseudo", "nom", "diamants", "cadeaux", "live", "moyenne par live", "part (%)", "cadeau préféré", "tous les cadeaux", "rooms", "premier don", "dernier don", "statut", "jours depuis le dernier don", "diamants 30 j", "diamants 30 j précédents"]
      : ["rank", "username", "name", "diamonds", "gifts", "lives", "average per live", "share (%)", "favourite gift", "all gifts", "rooms", "first gift", "last gift", "status", "days since last gift", "diamonds last 30 d", "diamonds previous 30 d"];
  const STATUS = lang === "fr" ? { new: "nouveau", active: "actif", cooling: "à relancer", lost: "perdu" } : { new: "new", active: "active", cooling: "to win back", lost: "lost" };
  const rows = dir.donors.map((d, i) =>
    [
      String(i + 1),
      d.viewer.username,
      d.viewer.displayName ?? "",
      String(d.diamonds),
      String(d.gifts),
      String(d.lives),
      String(d.avgDiamondsPerLive),
      String(d.share).replace(".", lang === "fr" ? "," : "."),
      d.favoriteGift ? `${d.favoriteGift.name} (x${d.favoriteGift.count})` : "",
      d.byGift.map((g) => `${g.name} x${g.count} (${g.diamonds})`).join(" | "),
      d.rooms.map((r) => `${r.account ?? "?"}: ${r.diamonds}`).join(" | "),
      date.format(d.firstAt),
      date.format(d.lastAt),
      STATUS[d.retention.status],
      String(d.retention.daysSinceLast),
      String(d.retention.last30),
      String(d.retention.prev30),
    ]
      .map(q)
      .join(sep),
  );
  return `\uFEFF${[header.map(q).join(sep), ...rows].join("\r\n")}\r\n`;
}
