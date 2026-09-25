import { useCallback, useEffect, useState } from "react";
import type { AnalyticsSummary, Category, HistoryEntry } from "../../shared/types";
import { api, fetchExport, saveFile } from "../api";
import { BarChart, LineChart } from "../components/Charts";
import { Avatar, Segmented } from "../components/ui";
import { categoryLabel, severityLabel, tr, useLang, useT } from "../i18n";
import { duration, hm } from "../format";
import { openViewer, toast, useStore } from "../store";

const TX = {
  en: {
    thisLive: "This LIVE",
    history: "History",
    audience: "Audience",
    peakViewers: "Peak viewers",
    avgViewers: "Avg. viewers",
    joins: "Joins",
    follows: "Follows",
    seen: "Seen viewers",
    seenHint: "TikTok only reports viewers who chat, gift, follow, or part of the joins — silent viewers are counted in the viewer number but not listed.",
    gifts: "Gifts",
    diamonds: "Diamonds",
    donors: "Donors",
    topDonors: "Top donors",
    byType: "By gift",
    viewersChart: "Viewers",
    export: "Export",
    pdf: "PDF report",
    csv: "Messages (CSV)",
    preparing: "Preparing…",
    ready: "Ready — tap to save",
    noHistory: "No LIVE recorded yet. Every LIVE Novus follows (and every demo) is saved here automatically.",
    showDemos: "Show demos",
    back: "History",
    live: "LIVE",
    ended: "Ended",
    interrupted: "Interrupted",
    interruptedHint: "The server restarted during this LIVE: statistics are those of the last save (at most one minute before).",
    msgs: "msgs",
    noSession: "No LIVE running in this room — past LIVEs are in History.",
  },
  fr: {
    thisLive: "Ce LIVE",
    history: "Historique",
    audience: "Audience",
    peakViewers: "Pic spectateurs",
    avgViewers: "Moy. spectateurs",
    joins: "Arrivées",
    follows: "Abonnés",
    seen: "Spectateurs vus",
    seenHint: "TikTok ne signale que ceux qui écrivent, offrent, suivent, ou une partie des arrivées — les spectateurs silencieux comptent dans le nombre de spectateurs mais ne sont pas listés.",
    gifts: "Cadeaux",
    diamonds: "Diamants",
    donors: "Donateurs",
    topDonors: "Meilleurs donateurs",
    byType: "Par cadeau",
    viewersChart: "Spectateurs",
    export: "Exporter",
    pdf: "Rapport PDF",
    csv: "Messages (CSV)",
    preparing: "Préparation…",
    ready: "Prêt — touche pour enregistrer",
    noHistory: "Aucun LIVE enregistré pour l'instant. Chaque LIVE suivi par Novus (et chaque démo) est sauvegardé ici automatiquement.",
    showDemos: "Afficher les démos",
    back: "Historique",
    live: "EN LIVE",
    ended: "Terminé",
    interrupted: "Interrompu",
    interruptedHint: "Le serveur a redémarré pendant ce LIVE : les statistiques sont celles de la dernière sauvegarde (au plus une minute avant).",
    msgs: "msgs",
    noSession: "Pas de LIVE en cours dans cet espace — les LIVE passés sont dans Historique.",
  },
};

/** "2 h 05" / "12 min 30" — reads as a length, not a clock time. */
function longDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min ${String(s % 60).padStart(2, "0")}`;
}

function Kpi({ v, l }: { v: string | number; l: string }) {
  return (
    <div className="stat">
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}

/** PDF / CSV export. Keeps the file when the phone asks for a fresh tap before sharing. */
function ExportCard({ sessionId }: { sessionId: string }) {
  const lang = useLang();
  const tx = TX[lang];
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const [ready, setReady] = useState<File | null>(null);

  const run = async (kind: "pdf" | "csv") => {
    setBusy(kind);
    setReady(null);
    try {
      const path = `/history/${encodeURIComponent(sessionId)}/${kind === "pdf" ? "report.pdf" : "messages.csv"}?lang=${lang}`;
      const file = await fetchExport(path, `novus-live.${kind}`);
      try {
        await saveFile(file);
      } catch {
        setReady(file);
      }
    } catch {
      toast(lang === "fr" ? "Export impossible" : "Export failed", "warn");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <span className="gold">◆</span> {tx.export}
      </div>
      <div className="grid-2">
        <button className="btn gold" onClick={() => run("pdf")} disabled={busy !== null}>
          {busy === "pdf" ? tx.preparing : `⤓ ${tx.pdf}`}
        </button>
        <button className="btn" onClick={() => run("csv")} disabled={busy !== null}>
          {busy === "csv" ? tx.preparing : `⤓ ${tx.csv}`}
        </button>
      </div>
      {ready ? (
        <button className="btn block" style={{ marginTop: 10 }} onClick={() => void saveFile(ready).then(() => setReady(null))}>
          {tx.ready} · {ready.name}
        </button>
      ) : null}
    </div>
  );
}

/** Full statistics of one LIVE (running or from history). */
function AnalyticsBody({ d, sessionId, interactive }: { d: AnalyticsSummary; sessionId?: string; interactive: boolean }) {
  const t = useT();
  const lang = useLang();
  const tx = TX[lang];
  const [mode, setMode] = useState<"chart" | "table">("chart");
  const cats = Object.entries(d.categoryCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [Category, number][];
  const catMax = Math.max(1, ...cats.map(([, n]) => n));
  const n = (v: number) => v.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB");
  const hasViewers = d.buckets.some((b) => (b.viewers ?? 0) > 0);

  return (
    <>
      <div className="card">
        <div className="card-title">
          <span className="gold">◆</span> {d.session ? tr(d.session.title, lang) : "—"}
          <span className="spacer" />
          <span className="mono">{duration(d.durationMs)}</span>
        </div>
        <div className="stat-grid">
          <Kpi v={n(d.totals.messages)} l={t("totalMessages")} />
          <Kpi v={n(d.totals.uniqueChatters)} l={t("uniqueChatters")} />
          <Kpi v={d.peak ? `${d.peak.messages}` : "—"} l={`${t("peak")}${d.peak ? ` ${hm(d.peak.t)}` : ""}`} />
          <Kpi v={d.totals.alerts} l={t("alerts")} />
          <Kpi v={d.totals.critical} l={severityLabel("critical", lang)} />
          <Kpi v={d.totals.warnings} l={severityLabel("warning", lang)} />
          <Kpi v={d.totals.muteRecommendations} l={t("muteRecs")} />
          <Kpi v={d.totals.blockRecommendations + d.totals.reportRecommendations} l={t("blockRecs")} />
          <Kpi v={d.avgResponseTimeMs !== null ? `${(d.avgResponseTimeMs / 1000).toFixed(1)}s` : "—"} l={t("responseTime")} />
        </div>
      </div>

      {d.audience ? (
        <div className="card">
          <div className="card-title">{tx.audience}</div>
          <div className="stat-grid">
            <Kpi v={n(d.audience.peakViewers)} l={`${tx.peakViewers}${d.audience.peakAt ? ` ${hm(d.audience.peakAt)}` : ""}`} />
            <Kpi v={d.audience.avgViewers !== null ? n(d.audience.avgViewers) : "—"} l={tx.avgViewers} />
            <Kpi v={n(d.audience.seenViewers)} l={tx.seen} />
            <Kpi v={n(d.audience.joins)} l={tx.joins} />
            <Kpi v={n(d.audience.follows)} l={tx.follows} />
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            {tx.seenHint}
          </div>
        </div>
      ) : null}

      {d.gifts ? (
        <div className="card">
          <div className="card-title">{tx.gifts}</div>
          <div className="stat-grid">
            <Kpi v={n(d.gifts.total)} l={tx.gifts} />
            <Kpi v={n(d.gifts.diamonds)} l={tx.diamonds} />
            <Kpi v={n(d.gifts.senders)} l={tx.donors} />
          </div>
          {d.gifts.top.length ? (
            <>
              <div className="small muted" style={{ margin: "12px 0 4px" }}>
                {tx.topDonors}
              </div>
              {d.gifts.top.map((g, i) => (
                <div key={g.viewer.id} className="rank">
                  <span className="n">{i + 1}</span>
                  <span className="t">@{g.viewer.username}</span>
                  <span className="c">
                    {g.gifts} · {n(g.diamonds)} 💎
                  </span>
                </div>
              ))}
            </>
          ) : null}
          {d.gifts.byName.length ? (
            <>
              <div className="small muted" style={{ margin: "12px 0 4px" }}>
                {tx.byType}
              </div>
              <div className="chips">
                {d.gifts.byName.map((g) => (
                  <span key={g.name} className="chip">
                    {g.name} ×{g.count}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="row">
        <span className="spacer" />
        <Segmented
          label={t("displayLabel")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "chart", label: t("chart") },
            { value: "table", label: t("table") },
          ]}
        />
      </div>

      {mode === "chart" ? (
        <>
          <div className="card">
            <div className="card-title">{t("msgPerMinute")}</div>
            <BarChart label={t("msgPerMinute")} data={d.buckets.map((b) => ({ t: b.t, v: b.messages }))} format={(p) => `${hm(p.t)} · ${p.v} ${t("msgShort")}`} />
          </div>
          {hasViewers ? (
            <div className="card">
              <div className="card-title">{tx.viewersChart}</div>
              <LineChart label={tx.viewersChart} data={d.buckets.map((b) => ({ t: b.t, v: b.viewers ?? 0 }))} format={(p) => `${hm(p.t)} · ${p.v}`} />
            </div>
          ) : null}
          <div className="card">
            <div className="card-title">{t("toxicityTrend")}</div>
            <LineChart label={t("toxicityTrend")} data={d.buckets.map((b) => ({ t: b.t, v: b.toxicity }))} color="#f58a34" format={(p) => `${hm(p.t)} · ${p.v}%`} />
          </div>
        </>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("colMinute")}</th>
                {hasViewers ? <th>{tx.viewersChart}</th> : null}
                <th>{t("colMessages")}</th>
                <th>{t("alerts")}</th>
                <th>{t("colToxic")}</th>
                <th>{t("colAvgRisk")}</th>
              </tr>
            </thead>
            <tbody>
              {d.buckets.map((b) => (
                <tr key={b.t}>
                  <td>{hm(b.t)}</td>
                  {hasViewers ? <td>{b.viewers ?? 0}</td> : null}
                  <td>{b.messages}</td>
                  <td>{b.alerts}</td>
                  <td>{b.toxicity}</td>
                  <td>{b.avgRisk}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cats.length ? (
        <div className="card">
          <div className="card-title">{t("categories")}</div>
          {cats.map(([c, v]) => (
            <div key={c} className="bar-row">
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{categoryLabel(c, lang)}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(v / catMax) * 100}%` }} />
              </div>
              <span className="mono small" style={{ textAlign: "right" }}>
                {v}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="card">
        <div className="card-title">{t("topParticipants")}</div>
        {d.topParticipants.length === 0 ? <div className="muted">—</div> : null}
        {d.topParticipants.map((p) =>
          interactive ? (
            <button key={p.viewer.id} className="list-row" style={{ width: "100%", textAlign: "left" }} onClick={() => openViewer(p.viewer.id)}>
              <Avatar viewer={p.viewer} />
              <span style={{ flex: 1 }}>@{p.viewer.username}</span>
              <span className="mono small">{p.messages}</span>
            </button>
          ) : (
            <div key={p.viewer.id} className="list-row">
              <Avatar viewer={p.viewer} />
              <span style={{ flex: 1 }}>@{p.viewer.username}</span>
              <span className="mono small">{p.messages}</span>
            </div>
          ),
        )}
      </div>

      <div className="card">
        <div className="card-title">{t("topQuestions")}</div>
        {d.topQuestions.length === 0 ? <div className="muted">—</div> : null}
        {d.topQuestions.map((q, i) => (
          <div key={q.id} className="rank">
            <span className="n">{i + 1}</span>
            <span className="t">{q.question}</span>
            <span className="c">×{q.count}</span>
          </div>
        ))}
      </div>

      {d.topTopics.length ? (
        <div className="card">
          <div className="card-title">{t("topTopics")}</div>
          <div className="chips">
            {d.topTopics.map((tp) => (
              <span key={tp.topic} className="chip">
                {tp.topic} · {tp.count}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {sessionId ? <ExportCard sessionId={sessionId} /> : null}
    </>
  );
}

function CurrentLive() {
  const lang = useLang();
  const session = useStore((s) => s.session);
  const room = useStore((s) => s.room);
  const [data, setData] = useState<AnalyticsSummary | null>(null);

  const load = useCallback(() => {
    api
      .analytics()
      .then(setData)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load, session?.id, session?.status, room]);

  if (!data) return <div className="empty">…</div>;
  if (!data.session) return <div className="empty">{TX[lang].noSession}</div>;
  return <AnalyticsBody d={data} sessionId={data.session.id} interactive />;
}

function StatusBadge({ e }: { e: HistoryEntry }) {
  const tx = TX[useLang()];
  const cls = e.status === "live" ? "bad" : e.status === "interrupted" ? "gold" : "good";
  return <span className={`state-badge ${cls}`} style={{ fontSize: 10 }}>{tx[e.status]}</span>;
}

function HistoryList({ onOpen }: { onOpen: (id: string) => void }) {
  const lang = useLang();
  const tx = TX[lang];
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [demos, setDemos] = useState(false);
  const locale = lang === "fr" ? "fr-FR" : "en-GB";
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const n = (v: number) => v.toLocaleString(locale);

  useEffect(() => {
    const load = () =>
      api
        .history()
        .then((r) => setEntries(r.entries))
        .catch(() => setEntries((e) => e ?? []));
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  if (!entries) return <div className="empty">…</div>;
  const shown = entries.filter((e) => demos || e.source !== "demo");
  return (
    <>
      <label className="row small muted" style={{ gap: 8, justifyContent: "flex-end" }}>
        <input type="checkbox" checked={demos} onChange={(e) => setDemos(e.target.checked)} /> {tx.showDemos}
      </label>
      {shown.length === 0 ? <div className="card muted">{tx.noHistory}</div> : null}
      {shown.map((e) => (
        <button key={e.sessionId} className="card history-row" onClick={() => onOpen(e.sessionId)}>
          <div className="row" style={{ gap: 8 }}>
            <b style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tr(e.title, lang)}</b>
            <StatusBadge e={e} />
          </div>
          <div className="small muted" style={{ marginTop: 2 }}>
            {fmt.format(e.startedAt)} · {longDuration(e.durationMs)}
          </div>
          <div className="history-stats">
            <span>👥 {n(e.peakViewers)}</span>
            <span>💬 {n(e.messages)}</span>
            <span>🎁 {n(e.gifts)}</span>
            <span>💎 {n(e.diamonds)}</span>
            <span>⚠ {n(e.alerts)}</span>
          </div>
        </button>
      ))}
    </>
  );
}

function HistoryDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const tx = TX[useLang()];
  const [detail, setDetail] = useState<{ entry: HistoryEntry; analytics: AnalyticsSummary } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api
      .historyDetail(id)
      .then(setDetail)
      .catch(() => setError(true));
  }, [id]);
  return (
    <>
      <button className="btn sm" onClick={onBack} style={{ alignSelf: "flex-start" }}>
        ← {tx.back}
      </button>
      {error ? <div className="card muted">—</div> : null}
      {!detail && !error ? <div className="empty">…</div> : null}
      {detail ? (
        <>
          {detail.entry.status === "interrupted" ? <div className="card small muted">{tx.interruptedHint}</div> : null}
          <AnalyticsBody d={detail.analytics} sessionId={detail.entry.sessionId} interactive={false} />
        </>
      ) : null}
    </>
  );
}

export function AnalyticsView() {
  const t = useT();
  const tx = TX[useLang()];
  const [tab, setTab] = useState<"current" | "history">("current");
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="scroll">
      <div className="narrow stack">
        <Segmented
          label={t("analytics")}
          value={tab}
          onChange={(v) => {
            setTab(v);
            setOpenId(null);
          }}
          options={[
            { value: "current", label: tx.thisLive },
            { value: "history", label: tx.history },
          ]}
          gold
        />
        {tab === "current" ? <CurrentLive /> : openId ? <HistoryDetail id={openId} onBack={() => setOpenId(null)} /> : <HistoryList onOpen={setOpenId} />}
      </div>
    </div>
  );
}
