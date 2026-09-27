import type { DonorDirectory, DonorSummary } from "../../shared/types";
import type { GiftLedgerRow } from "../persistence/Repository";

/*
 * Donor directory: every viewer who sent gifts, across the space's LIVEs — total diamonds,
 * the rooms (followed accounts) they give in, how many LIVEs, the average per LIVE and
 * their favourite gift.
 */
export function buildDonors(rows: GiftLedgerRow[]): DonorDirectory {
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
    };
  });
  donors.sort((a, b) => b.diamonds - a.diamonds || b.gifts - a.gifts);
  return {
    totals: { donors: donors.length, diamonds: totalDiamonds, gifts: rows.reduce((s, r) => s + r.gifts, 0), lives: new Set(rows.map((r) => r.sessionId)).size },
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
      ? ["rang", "pseudo", "nom", "diamants", "cadeaux", "live", "moyenne par live", "part (%)", "cadeau préféré", "rooms", "premier don", "dernier don"]
      : ["rank", "username", "name", "diamonds", "gifts", "lives", "average per live", "share (%)", "favourite gift", "rooms", "first gift", "last gift"];
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
      d.rooms.map((r) => `${r.account ?? "?"}: ${r.diamonds}`).join(" | "),
      date.format(d.firstAt),
      date.format(d.lastAt),
    ]
      .map(q)
      .join(sep),
  );
  return `\uFEFF${[header.map(q).join(sep), ...rows].join("\r\n")}\r\n`;
}
