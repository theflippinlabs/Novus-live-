import { useEffect, useMemo, useState } from "react";
import type { DonorDirectory, DonorSummary } from "../../shared/types";
import { api, fetchExport, saveFile } from "../api";
import { Avatar, Sheet } from "../components/ui";
import { useLang } from "../i18n";
import { toast } from "../store";
import { nicknameOf } from "../viewerName";

// Donor directory: who gives, how much, in which rooms, and their favourite gift.

type Lang = "en" | "fr";
const TX = {
  en: {
    periods: { 7: "7 days", 30: "30 days", 0: "All" } as Record<number, string>,
    allRooms: "All streamers",
    search: "Search a donor…",
    donors: "Donors",
    diamonds: "Diamonds",
    gifts: "Gifts",
    lives: "LIVEs",
    none: "No gifts in this period yet.",
    export: "Export to Excel (CSV)",
    preparing: "Preparing…",
    ready: "Ready — tap to save",
    total: "Total given",
    perLive: "Average per LIVE",
    share: "Share of all diamonds",
    favorite: "Favourite gift",
    rooms: "Rooms where they give",
    byGift: "Gifts by type",
    first: "First gift:",
    last: "Last gift:",
    livesN: (n: number) => `${n} LIVE${n > 1 ? "s" : ""}`,
    more: (n: number) => `Show ${n} more`,
    unknownRoom: "Other LIVE",
    podium: "Top donors",
    awards: "Awards",
    award: { loyal: "Most loyal", basket: "Biggest per LIVE", rooms: "Most rooms" },
    awardVal: { loyal: (n: number) => `${n} LIVEs`, basket: (v: string) => `${v} per LIVE`, rooms: (n: number) => `${n} rooms` },
  },
  fr: {
    periods: { 7: "7 jours", 30: "30 jours", 0: "Tout" } as Record<number, string>,
    allRooms: "Tous les livers",
    search: "Chercher un donateur…",
    donors: "Donateurs",
    diamonds: "Diamants",
    gifts: "Cadeaux",
    lives: "LIVE",
    none: "Pas encore de cadeau sur cette période.",
    export: "Exporter vers Excel (CSV)",
    preparing: "Préparation…",
    ready: "Prêt — touche pour enregistrer",
    total: "Total donné",
    perLive: "Moyenne par LIVE",
    share: "Part de tous les diamants",
    favorite: "Cadeau préféré",
    rooms: "Rooms où il donne",
    byGift: "Cadeaux par type",
    first: "Premier don :",
    last: "Dernier don :",
    livesN: (n: number) => `${n} LIVE`,
    more: (n: number) => `Voir ${n} de plus`,
    unknownRoom: "Autre LIVE",
    podium: "Top donateurs",
    awards: "Distinctions",
    award: { loyal: "Le plus fidèle", basket: "Plus gros par LIVE", rooms: "Le plus de rooms" },
    awardVal: { loyal: (n: number) => `${n} LIVE`, basket: (v: string) => `${v} par LIVE`, rooms: (n: number) => `${n} rooms` },
  },
};

const Diamond = () => <span className="gold">◆</span>;
const PLACE = ["first", "second", "third"] as const;
const initials = (d: DonorSummary) => (nicknameOf(d.viewer) ?? d.viewer.username).replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "?";

/** The three biggest donors of the period, on a podium (winner in the middle). */
function DonorPodium({ donors, lang, onOpen }: { donors: DonorSummary[]; lang: Lang; onOpen: (d: DonorSummary) => void }) {
  const tx = TX[lang];
  const n = (v: number) => v.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB");
  const top = donors.slice(0, 3);
  const order = [top[1], top[0], top[2]];
  // Awards: the leader of other ways to be a great donor (among the top 50).
  const pool = donors.slice(0, 50);
  const best = (f: (d: DonorSummary) => number, min: number) => {
    const d = [...pool].sort((a, b) => f(b) - f(a))[0];
    return d && f(d) >= min ? d : null;
  };
  const loyal = best((d) => d.lives, 2);
  const basket = best((d) => d.avgDiamondsPerLive, 1);
  const multi = best((d) => d.rooms.length, 2);
  const awards = [
    loyal ? { key: "loyal", d: loyal, v: tx.awardVal.loyal(loyal.lives) } : null,
    basket ? { key: "basket", d: basket, v: tx.awardVal.basket(n(basket.avgDiamondsPerLive)) } : null,
    multi ? { key: "rooms", d: multi, v: tx.awardVal.rooms(multi.rooms.length) } : null,
  ].filter((a): a is { key: "loyal" | "basket" | "rooms"; d: DonorSummary; v: string } => Boolean(a));

  return (
    <div className="card podium-card" style={{ marginTop: 12 }}>
      <div className="card-title">
        <span className="gold">♛</span> {tx.podium}
      </div>
      <div className="podium" role="list" aria-label={tx.podium}>
        {order.map((d, i) => {
          if (!d) return <div key={`empty${i}`} className="podium-col empty" aria-hidden="true" />;
          const rank = top.indexOf(d) + 1;
          const nick = nicknameOf(d.viewer);
          return (
            <button key={d.viewer.id} className={`podium-col ${PLACE[rank - 1]} podium-btn`} role="listitem" onClick={() => onOpen(d)} aria-label={`${rank}. ${nick ?? `@${d.viewer.username}`} — ${n(d.diamonds)}`}>
              {rank === 1 ? <div className="podium-crown" aria-hidden="true">♛</div> : null}
              <div className="podium-avatar">{d.viewer.avatarUrl ? <img src={d.viewer.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials(d)}</div>
              <div className="podium-name">{nick ?? `@${d.viewer.username}`}</div>
              <div className="podium-score money">
                {n(d.diamonds)}
                <span> ◆</span>
              </div>
              <div className="podium-sub">
                {tx.livesN(d.lives)}
                {d.favoriteGift ? ` · ${d.favoriteGift.name}` : ""}
              </div>
              <div className="podium-step">
                <span>{rank}</span>
              </div>
            </button>
          );
        })}
      </div>
      {awards.length ? (
        <>
          <div className="card-title" style={{ marginTop: 16 }}>
            {tx.awards}
          </div>
          <div className="award-list">
            {awards.map((a) => (
              <button key={a.key} className="award" onClick={() => onOpen(a.d)}>
                <span className="lb-badge">{tx.award[a.key]}</span>
                <b className="ellipsis">{nicknameOf(a.d.viewer) ?? `@${a.d.viewer.username}`}</b>
                <span className="small muted">{a.v}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function DonorSheet({ d, onClose, lang }: { d: DonorSummary; onClose: () => void; lang: Lang }) {
  const tx = TX[lang];
  const locale = lang === "fr" ? "fr-FR" : "en-GB";
  const n = (v: number) => v.toLocaleString(locale);
  const date = (t: number) => new Date(t).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const nick = nicknameOf(d.viewer);
  const maxRoom = Math.max(1, ...d.rooms.map((r) => r.diamonds));
  const maxGift = Math.max(1, ...d.byGift.map((g) => g.diamonds));
  return (
    <Sheet onClose={onClose} label={`@${d.viewer.username}`}>
      <div className="row" style={{ gap: 12, paddingRight: 44 }}>
        <Avatar viewer={d.viewer} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div className="alert-user" style={{ fontSize: 19 }}>
            {nick ?? `@${d.viewer.username}`}
          </div>
          {nick ? <div className="viewer-handle">@{d.viewer.username}</div> : null}
        </div>
      </div>
      <div className="ratio-grid" style={{ marginTop: 14 }}>
        <div className="ratio">
          <b>
            {n(d.diamonds)} <Diamond />
          </b>
          <span>
            {tx.total} · {n(d.gifts)} {tx.gifts.toLowerCase()}
          </span>
        </div>
        <div className="ratio">
          <b>
            {n(d.avgDiamondsPerLive)} <Diamond />
          </b>
          <span>
            {tx.perLive} · {tx.livesN(d.lives)}
          </span>
        </div>
        <div className="ratio">
          <b>{d.share.toLocaleString(locale)} %</b>
          <span>{tx.share}</span>
        </div>
        <div className="ratio">
          <b className="ellipsis">{d.favoriteGift?.name ?? "—"}</b>
          <span>
            {tx.favorite}
            {d.favoriteGift ? ` · ×${n(d.favoriteGift.count)}` : ""}
          </span>
        </div>
      </div>

      <div className="card-title" style={{ marginTop: 16 }}>
        {tx.rooms}
      </div>
      {d.rooms.map((r) => (
        <div key={r.account ?? "?"} className="usage-row">
          <div className="usage-head">
            <span>{r.account ? `@${r.account}` : tx.unknownRoom}</span>
            <span>
              {n(r.diamonds)} <Diamond /> · {tx.livesN(r.lives)}
            </span>
          </div>
          <div className="usage-bar">
            <span style={{ width: `${(r.diamonds / maxRoom) * 100}%` }} />
          </div>
        </div>
      ))}

      <div className="card-title" style={{ marginTop: 16 }}>
        {tx.byGift}
      </div>
      {d.byGift.slice(0, 12).map((g) => (
        <div key={g.name} className="usage-row">
          <div className="usage-head">
            <span>
              {g.name} ×{n(g.count)}
            </span>
            <span>
              {n(g.diamonds)} <Diamond />
            </span>
          </div>
          <div className="usage-bar">
            <span style={{ width: `${(g.diamonds / maxGift) * 100}%` }} />
          </div>
        </div>
      ))}

      <div className="small muted" style={{ marginTop: 12 }}>
        {tx.first} {date(d.firstAt)} · {tx.last} {date(d.lastAt)}
      </div>
    </Sheet>
  );
}

export function DonorsView() {
  const lang = useLang();
  const tx = TX[lang];
  const locale = lang === "fr" ? "fr-FR" : "en-GB";
  const n = (v: number) => v.toLocaleString(locale);
  const [days, setDays] = useState(0);
  const [account, setAccount] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<DonorDirectory | null>(null);
  const [open, setOpen] = useState<DonorSummary | null>(null);
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<File | null>(null);
  const [rooms, setRooms] = useState<string[]>([]);

  useEffect(() => {
    setData(null);
    api
      .donors(days, account)
      .then((d) => {
        setData(d);
        // Keep the room list of the whole period, even when one room is selected.
        if (!account) setRooms(d.accounts);
      })
      .catch(() => setData({ totals: { donors: 0, diamonds: 0, gifts: 0, lives: 0 }, donors: [], accounts: [] }));
  }, [days, account]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^@/, "");
    if (!data) return [];
    return s ? data.donors.filter((d) => d.viewer.username.toLowerCase().includes(s) || (d.viewer.displayName ?? "").toLowerCase().includes(s)) : data.donors;
  }, [data, q]);

  const exportCsv = async () => {
    setBusy(true);
    setReady(null);
    try {
      const file = await fetchExport(`/donors.csv?days=${days}${account ? `&account=${encodeURIComponent(account)}` : ""}&lang=${lang}`, "novus-live-donateurs.csv");
      try {
        await saveFile(file);
      } catch {
        setReady(file);
      }
    } catch {
      toast(lang === "fr" ? "Export impossible" : "Export failed", "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row wrap" style={{ gap: 8 }}>
        {[7, 30, 0].map((d) => (
          <button key={d} className={`chip ${days === d ? "on" : ""}`} onClick={() => setDays(d)} style={{ minHeight: 36 }}>
            {tx.periods[d]}
          </button>
        ))}
        <span className="spacer" />
        <select className="input donor-room" value={account} onChange={(e) => setAccount(e.target.value)} aria-label={tx.allRooms}>
          <option value="">{tx.allRooms}</option>
          {rooms.map((a) => (
            <option key={a} value={a}>
              @{a}
            </option>
          ))}
        </select>
      </div>

      {data ? (
        <div className="copilot-stats" style={{ marginTop: 12 }}>
          <div>
            <b>{n(data.totals.donors)}</b>
            <span>{tx.donors}</span>
          </div>
          <div>
            <b>
              {n(data.totals.diamonds)} <Diamond />
            </b>
            <span>{tx.diamonds}</span>
          </div>
          <div>
            <b>{n(data.totals.lives)}</b>
            <span>{tx.lives}</span>
          </div>
        </div>
      ) : null}

      {data && data.donors.length && !q ? <DonorPodium donors={data.donors} lang={lang} onOpen={setOpen} /> : null}

      <input className="input" type="search" style={{ marginTop: 12 }} placeholder={tx.search} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx.search} autoCapitalize="off" autoCorrect="off" />

      <div className="card" style={{ marginTop: 12, padding: "2px 12px" }}>
        {!data ? <div className="empty">…</div> : list.length === 0 ? <div className="empty">{tx.none}</div> : null}
        {list.slice(0, limit).map((d) => {
          const rank = data ? data.donors.indexOf(d) + 1 : 0;
          const nick = nicknameOf(d.viewer);
          return (
            <button key={d.viewer.id} className="list-row donor-row" style={{ width: "100%", textAlign: "left" }} onClick={() => setOpen(d)}>
              <span className="rank-n">{rank}</span>
              <Avatar viewer={d.viewer} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b className="ellipsis">{nick ?? `@${d.viewer.username}`}</b>
                <div className="small muted ellipsis">
                  {nick ? `@${d.viewer.username} · ` : ""}
                  {d.rooms
                    .slice(0, 3)
                    .map((r) => (r.account ? `@${r.account}` : tx.unknownRoom))
                    .join(" · ")}
                  {d.rooms.length > 3 ? ` +${d.rooms.length - 3}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                <b>
                  {n(d.diamonds)} <Diamond />
                </b>
                <div className="small muted">
                  {n(d.gifts)} · {tx.livesN(d.lives)}
                </div>
              </div>
            </button>
          );
        })}
        {list.length > limit ? (
          <button className="btn block" style={{ margin: "10px 0" }} onClick={() => setLimit((l) => l + 50)}>
            {tx.more(Math.min(50, list.length - limit))}
          </button>
        ) : null}
      </div>

      {data && data.donors.length ? (
        <>
          <button className="btn block" style={{ marginTop: 12 }} onClick={exportCsv} disabled={busy}>
            {busy ? tx.preparing : `⤓ ${tx.export}`}
          </button>
          {ready ? (
            <button className="btn gold block" style={{ marginTop: 8 }} onClick={() => void saveFile(ready).then(() => setReady(null))}>
              {tx.ready} · {ready.name}
            </button>
          ) : null}
        </>
      ) : null}

      {open ? <DonorSheet d={open} onClose={() => setOpen(null)} lang={lang} /> : null}
    </>
  );
}
