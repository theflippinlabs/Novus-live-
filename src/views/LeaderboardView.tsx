import { useEffect, useState } from "react";
import type { Leaderboard, LeaderboardBadge, LeaderboardEntry } from "../../shared/types";
import { api } from "../api";
import { useLang } from "../i18n";

// Stats › Ranking: a podium of the followed streamers and the full ranking, with one score
// (0-100) mixing gifts, engagement, audience, activity and chat safety over the period.

type Lang = "en" | "fr";
const TX = {
  en: {
    periods: { 7: "7 days", 30: "30 days", 90: "90 days", 0: "All" } as Record<number, string>,
    title: "Streamer ranking",
    none: "No LIVE of 5 minutes or more over this period yet.",
    score: "score",
    lives: (n: number) => `${n} LIVE${n > 1 ? "s" : ""}`,
    hours: "h",
    diamonds: "diamonds",
    viewers: "avg viewers",
    engagement: "engagement",
    ranking: "Full ranking",
    parts: { monetization: "Gifts", engagement: "Engagement", audience: "Audience", activity: "Activity", safety: "Safety" },
    kpi: {
      diamondsPerHour: "diamonds / hour",
      peakViewers: "peak viewers",
      messagesPerMin: "messages / min",
      followConversion: "viewers → followers",
      donorConversion: "viewers → donors",
      alertsPer1k: "alerts / 1,000 msgs",
      lastLive: "last LIVE",
    },
    badges: { top_diamonds: "◆ Top gifts", top_engagement: "Top engagement", top_audience: "Top audience", most_active: "Most active", safest: "Safest chat" } as Record<LeaderboardBadge, string>,
    how: "How is the score calculated?",
    howText:
      "Each part is out of 100, compared with the best of your streamers over the period: Gifts 30 % (diamonds and diamonds per hour), Engagement 25 % (share of the audience that chats, messages per minute), Audience 20 % (average viewers, follower conversion), Activity 15 % (hours and number of LIVEs), Safety 10 % (alerts per 1,000 messages). LIVEs under 5 minutes are ignored.",
    basedOn: (n: number) => `Based on ${n} LIVE${n > 1 ? "s" : ""}.`,
  },
  fr: {
    periods: { 7: "7 jours", 30: "30 jours", 90: "90 jours", 0: "Tout" } as Record<number, string>,
    title: "Classement des livers",
    none: "Pas encore de LIVE de 5 minutes ou plus sur cette période.",
    score: "note",
    lives: (n: number) => `${n} LIVE`,
    hours: "h",
    diamonds: "diamants",
    viewers: "spect. moyens",
    engagement: "engagement",
    ranking: "Classement complet",
    parts: { monetization: "Cadeaux", engagement: "Engagement", audience: "Audience", activity: "Activité", safety: "Sécurité" },
    kpi: {
      diamondsPerHour: "diamants / heure",
      peakViewers: "pic de spectateurs",
      messagesPerMin: "messages / min",
      followConversion: "spectateurs → abonnés",
      donorConversion: "spectateurs → donateurs",
      alertsPer1k: "alertes / 1 000 msg",
      lastLive: "dernier LIVE",
    },
    badges: { top_diamonds: "◆ Top cadeaux", top_engagement: "Top engagement", top_audience: "Top audience", most_active: "Le plus actif", safest: "Chat le plus sain" } as Record<LeaderboardBadge, string>,
    how: "Comment la note est calculée ?",
    howText:
      "Chaque partie est sur 100, comparée au meilleur de tes livers sur la période : Cadeaux 30 % (diamants et diamants par heure), Engagement 25 % (part du public qui écrit, messages par minute), Audience 20 % (spectateurs moyens, conversion en abonnés), Activité 15 % (heures et nombre de LIVE), Sécurité 10 % (alertes pour 1 000 messages). Les LIVE de moins de 5 minutes ne comptent pas.",
    basedOn: (n: number) => `Calculé sur ${n} LIVE.`,
  },
};

const initials = (h: string) => h.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
const PLACE = ["first", "second", "third"] as const;

function Podium({ top, lang }: { top: LeaderboardEntry[]; lang: Lang }) {
  const tx = TX[lang];
  const n = (v: number) => v.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB");
  // Second, first, third — the winner in the middle.
  const order = [top[1], top[0], top[2]];
  return (
    <div className="podium" role="list" aria-label={tx.title}>
      {order.map((e, i) => {
        if (!e) return <div key={`empty${i}`} className="podium-col empty" aria-hidden="true" />;
        const place = PLACE[e.rank - 1];
        return (
          <div key={e.account} className={`podium-col ${place}`} role="listitem" aria-label={`${e.rank}. @${e.account} — ${e.score}/100`}>
            {e.rank === 1 ? <div className="podium-crown" aria-hidden="true">♛</div> : null}
            <div className="podium-avatar">{initials(e.account)}</div>
            <div className="podium-name">@{e.account}</div>
            <div className="podium-score">
              {e.score}
              <span>/100</span>
            </div>
            <div className="podium-sub">
              ◆ {n(e.diamonds)} · {e.hours.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 1 })} {tx.hours}
            </div>
            <div className="podium-step">
              <span>{e.rank}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PartBar({ label, v }: { label: string; v: number }) {
  return (
    <div className="meter-row">
      <div className="meter-head">
        <span>{label}</span>
        <b>{v}</b>
      </div>
      <div className="meter">
        <span style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function Row({ e, lang }: { e: LeaderboardEntry; lang: Lang }) {
  const tx = TX[lang];
  const [open, setOpen] = useState(false);
  const locale = lang === "fr" ? "fr-FR" : "en-GB";
  const n = (v: number, d = 0) => v.toLocaleString(locale, { maximumFractionDigits: d });
  const pct = (v: number | null) => (v === null ? "—" : `${n(v, 1)} %`);
  return (
    <div className={`rank-row ${open ? "open" : ""}`}>
      <button className="rank-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`rank-badge r${Math.min(e.rank, 4)}`}>{e.rank}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b className="ellipsis" style={{ display: "block" }}>@{e.account}</b>
          <span className="small muted">
            ◆ {n(e.diamonds)} · {n(e.hours, 1)} {tx.hours} · {tx.lives(e.lives)}
            {e.engagementRate !== null ? ` · ${n(e.engagementRate, 1)} % ${tx.engagement}` : ""}
          </span>
        </span>
        <span className="rank-score">
          <b>{e.score}</b>
          <span className="rank-score-bar">
            <span style={{ width: `${e.score}%` }} />
          </span>
        </span>
      </button>
      {e.badges.length ? (
        <div className="row wrap" style={{ gap: 6, padding: "0 0 8px 44px" }}>
          {e.badges.map((b) => (
            <span key={b} className="lb-badge">
              {tx.badges[b]}
            </span>
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="rank-detail">
          {(Object.keys(tx.parts) as (keyof LeaderboardEntry["parts"])[]).map((k) => (
            <PartBar key={k} label={tx.parts[k]} v={e.parts[k]} />
          ))}
          <div className="ratio-grid" style={{ marginTop: 10 }}>
            <div className="ratio">
              <b>{n(e.diamondsPerHour)}</b>
              <span>{tx.kpi.diamondsPerHour}</span>
            </div>
            <div className="ratio">
              <b>{n(e.avgViewers)}</b>
              <span>{tx.viewers}</span>
            </div>
            <div className="ratio">
              <b>{n(e.peakViewers)}</b>
              <span>{tx.kpi.peakViewers}</span>
            </div>
            <div className="ratio">
              <b>{n(e.messagesPerMin, 1)}</b>
              <span>{tx.kpi.messagesPerMin}</span>
            </div>
            <div className="ratio">
              <b>{pct(e.followConversion)}</b>
              <span>{tx.kpi.followConversion}</span>
            </div>
            <div className="ratio">
              <b>{pct(e.donorConversion)}</b>
              <span>{tx.kpi.donorConversion}</span>
            </div>
            <div className="ratio">
              <b>{n(e.alertsPer1k, 1)}</b>
              <span>{tx.kpi.alertsPer1k}</span>
            </div>
            <div className="ratio">
              <b>{new Date(e.lastLiveAt).toLocaleDateString(locale, { day: "numeric", month: "short" })}</b>
              <span>{tx.kpi.lastLive}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function LeaderboardView() {
  const lang = useLang();
  const tx = TX[lang];
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Leaderboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    api
      .leaderboard(days)
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [days]);

  return (
    <>
      <div className="row wrap" style={{ gap: 8 }}>
        {[7, 30, 90, 0].map((d) => (
          <button key={d} className={`chip ${days === d ? "on" : ""}`} onClick={() => setDays(d)} style={{ minHeight: 36 }}>
            {tx.periods[d]}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="card empty">{failed ? "—" : "…"}</div>
      ) : data.entries.length === 0 ? (
        <div className="card empty">{tx.none}</div>
      ) : (
        <>
          <div className="card podium-card">
            <div className="card-title">
              <span className="gold">♛</span> {tx.title}
            </div>
            <Podium top={data.entries.slice(0, 3)} lang={lang} />
          </div>

          <div className="card" style={{ padding: "4px 12px" }}>
            <div className="card-title" style={{ padding: "10px 0 4px" }}>
              {tx.ranking}
            </div>
            {data.entries.map((e) => (
              <Row key={e.account} e={e} lang={lang} />
            ))}
          </div>

          <details className="card lb-how">
            <summary>{tx.how}</summary>
            <p className="small muted">{tx.howText}</p>
            <p className="small muted">{tx.basedOn(data.lives)}</p>
          </details>
        </>
      )}
    </>
  );
}
