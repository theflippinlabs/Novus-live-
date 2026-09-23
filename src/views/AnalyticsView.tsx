import { useCallback, useEffect, useState } from "react";
import type { AnalyticsSummary, Category } from "../../shared/types";
import { api } from "../api";
import { BarChart, LineChart } from "../components/Charts";
import { Avatar, Segmented } from "../components/ui";
import { categoryLabel, useLang, useT } from "../i18n";
import { duration, hm } from "../format";
import { openViewer, useStore } from "../store";

function Kpi({ v, l }: { v: string | number; l: string }) {
  return (
    <div className="stat">
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}

export function AnalyticsView() {
  const t = useT();
  const lang = useLang();
  const session = useStore((s) => s.session);
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [mode, setMode] = useState<"chart" | "table">("chart");
  const [report, setReport] = useState<string | null>(null);

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
  }, [load, session?.id, session?.status]);

  const download = async () => {
    const r = await api.report();
    const blob = new Blob([r.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `novus-live-report-${r.sessionId}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const view = async () => {
    if (report) return setReport(null);
    const r = await api.report();
    setReport(r.markdown);
  };

  if (!data) return <div className="empty">…</div>;
  const d = data;
  const cats = Object.entries(d.categoryCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [Category, number][];
  const catMax = Math.max(1, ...cats.map(([, n]) => n));

  return (
    <div className="scroll">
      <div className="narrow stack">
        <div className="card">
          <div className="card-title">
            <span className="gold">◆</span> {d.session ? d.session.title : "—"}
            <span className="spacer" />
            <span className="mono">{duration(d.durationMs)}</span>
          </div>
          <div className="stat-grid">
            <Kpi v={d.totals.messages.toLocaleString()} l={t("totalMessages")} />
            <Kpi v={d.totals.uniqueChatters} l={t("uniqueChatters")} />
            <Kpi v={d.peak ? `${d.peak.messages}` : "—"} l={`${t("peak")}${d.peak ? ` ${hm(d.peak.t)}` : ""}`} />
            <Kpi v={d.totals.alerts} l={t("alerts")} />
            <Kpi v={d.totals.critical} l="Critical" />
            <Kpi v={d.totals.warnings} l="Warning" />
            <Kpi v={d.totals.muteRecommendations} l={t("muteRecs")} />
            <Kpi v={d.totals.blockRecommendations + d.totals.reportRecommendations} l={t("blockRecs")} />
            <Kpi v={d.avgResponseTimeMs !== null ? `${(d.avgResponseTimeMs / 1000).toFixed(1)}s` : "—"} l={t("responseTime")} />
          </div>
        </div>

        <div className="row">
          <span className="spacer" />
          <Segmented
            label="Display"
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
              <BarChart label={t("msgPerMinute")} data={d.buckets.map((b) => ({ t: b.t, v: b.messages }))} format={(p) => `${hm(p.t)} · ${p.v} msg`} />
            </div>
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
                  <th>Min</th>
                  <th>Msgs</th>
                  <th>Alerts</th>
                  <th>Toxic %</th>
                  <th>Avg risk</th>
                </tr>
              </thead>
              <tbody>
                {d.buckets.map((b) => (
                  <tr key={b.t}>
                    <td>{hm(b.t)}</td>
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
            {cats.map(([c, n]) => (
              <div key={c} className="bar-row">
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{categoryLabel(c, lang)}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(n / catMax) * 100}%` }} />
                </div>
                <span className="mono small" style={{ textAlign: "right" }}>
                  {n}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="card">
          <div className="card-title">{t("topParticipants")}</div>
          {d.topParticipants.map((p) => (
            <button key={p.viewer.id} className="list-row" style={{ width: "100%", textAlign: "left" }} onClick={() => openViewer(p.viewer.id)}>
              <Avatar viewer={p.viewer} />
              <span style={{ flex: 1 }}>@{p.viewer.username}</span>
              <span className="mono small">{p.messages}</span>
            </button>
          ))}
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

        <div className="card">
          <div className="card-title">
            <span className="gold">◆</span> {t("report")}
          </div>
          <div className="grid-2">
            <button className="btn" onClick={view}>
              {t("viewReport")}
            </button>
            <button className="btn gold" onClick={download}>
              {t("downloadReport")}
            </button>
          </div>
          {report ? (
            <pre className="report-pre" style={{ marginTop: 12 }}>
              {report}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}
