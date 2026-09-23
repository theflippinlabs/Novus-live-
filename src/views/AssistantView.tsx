import { useCallback, useEffect, useState } from "react";
import type { CatchUp, ChatPulse } from "../../shared/types";
import { api } from "../api";
import { LineChart } from "../components/Charts";
import { useT } from "../i18n";
import { ago, compact, hm } from "../format";
import { navigate, openViewer, serverNow, toast, useStore } from "../store";

const LAST_CHECK_KEY = "novus:lastCheck";

function readLastCheck(): number | undefined {
  try {
    const v = Number(localStorage.getItem(LAST_CHECK_KEY));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function writeLastCheck(t: number) {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(t));
  } catch {
    /* private mode */
  }
}

function CatchUpCard() {
  const t = useT();
  const [result, setResult] = useState<CatchUp | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const since = readLastCheck();
      const r = await api.catchUp(since);
      setResult(r);
      writeLastCheck(r.until);
    } catch {
      toast("Catch-up failed", "warn");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card catchup-card">
      <button className="btn gold lg block" onClick={run} disabled={busy}>
        {busy ? "…" : `⟲ ${t("catchUp")}`}
      </button>
      <div className="small muted" style={{ textAlign: "center", marginTop: 6 }}>
        {t("catchUpHint")}
        {readLastCheck() ? ` · ${hm(readLastCheck()!)}` : ""}
      </div>
      {result ? (
        <div style={{ marginTop: 14 }} aria-live="polite">
          <h3>{result.headline}</h3>
          {result.narrative ? <p style={{ marginTop: 0, color: "var(--text-2)", fontSize: 14 }}>{result.narrative}</p> : null}
          {result.sections.map((s) => (
            <div key={s.title}>
              <div className="card-title" style={{ margin: "10px 0 2px" }}>
                {s.title}
              </div>
              <ul>
                {s.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
          <div className="small muted">
            {hm(result.since)} → {hm(result.until)} · {result.source === "ai" ? "AI" : "Local"}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AssistantView() {
  const t = useT();
  const sessionId = useStore((s) => s.session?.id);
  const [pulse, setPulse] = useState<ChatPulse | null>(null);

  const load = useCallback(() => {
    api
      .pulse()
      .then(setPulse)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load, sessionId]);

  const answer = async (id: string, answered: boolean) => {
    await api.markAnswered(id, answered);
    load();
  };

  const now = serverNow();
  const p = pulse;

  return (
    <div className="scroll">
      <div className="narrow stack">
        <CatchUpCard />

        {p ? (
          <>
            <div className="card">
              <div className="card-title">
                <span className="gold">◆</span> {t("chatPulse")}
              </div>
              <div className="grid-3">
                <div>
                  <div className="hero-num">{compact(p.messagesTotal)}</div>
                  <div className="small muted">{t("messages")}</div>
                </div>
                <div>
                  <div className="hero-num">{compact(p.activeViewers)}</div>
                  <div className="small muted">{t("chatters")}</div>
                </div>
                <div>
                  <div className={`hero-num ${p.activityChangePct > 0 ? "delta-up" : p.activityChangePct < 0 ? "delta-down" : ""}`}>
                    {p.activityChangePct > 0 ? "+" : ""}
                    {p.activityChangePct}%
                  </div>
                  <div className="small muted">{t("activity")}</div>
                </div>
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>
                {p.messagesPerMinute} {t("msgMin")} · {compact(p.viewerCount)} {t("viewersShort")}
              </div>
              {p.viewersNeedingAttention > 0 ? (
                <button className="btn block" style={{ marginTop: 10, borderColor: "rgba(229,38,62,.5)" }} onClick={() => navigate("alerts")}>
                  <b style={{ color: "#ff8b98" }}>{p.viewersNeedingAttention}</b>&nbsp;{t("needAttention")}
                </button>
              ) : null}
            </div>

            <div className="card">
              <div className="card-title">{t("topUnanswered")}</div>
              {p.topUnanswered ? (
                <>
                  <div className="quote">“{p.topUnanswered.question}”</div>
                  <div className="row small muted" style={{ marginTop: 6 }}>
                    ×{p.topUnanswered.count} · {p.topUnanswered.askers.slice(0, 3).map((a) => `@${a}`).join(", ")}
                    <span className="spacer" />
                    <button className="btn sm" onClick={() => answer(p.topUnanswered!.id, true)}>
                      ✓ {t("markAnswered")}
                    </button>
                  </div>
                </>
              ) : (
                <div className="muted">—</div>
              )}
            </div>

            <div className="card">
              <div className="card-title">{t("trending")}</div>
              {p.trending.length === 0 ? <div className="muted">—</div> : null}
              {p.trending.map((tr, i) => (
                <div key={tr.topic} className="rank">
                  <span className="n">{i + 1}</span>
                  <span className="t">{tr.topic}</span>
                  <span className="c">
                    {tr.count}
                    {tr.growth > 0 ? <span className="delta-up"> +{tr.growth}%</span> : null}
                  </span>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-title">{t("questions")}</div>
              {p.topQuestions.length === 0 ? <div className="muted">—</div> : null}
              {p.topQuestions.map((q) => (
                <div key={q.id} className="list-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, textDecoration: q.answered ? "line-through" : undefined, color: q.answered ? "var(--text-3)" : undefined }}>{q.question}</div>
                    <div className="small muted">
                      ×{q.count} · {ago(q.lastAskedAt, now)}
                    </div>
                  </div>
                  <button className="btn sm" onClick={() => answer(q.id, !q.answered)}>
                    {q.answered ? t("reopen") : `✓ ${t("markAnswered")}`}
                  </button>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-title">
                {t("sentiment")}
                <span className="spacer" />
                <span style={{ color: p.sentiment.current < -0.08 ? "var(--r-warning)" : "var(--text)" }}>{p.sentiment.label}</span>
              </div>
              {p.sentiment.shift ? (
                <div className="small" style={{ color: "var(--gold)", marginBottom: 6 }}>
                  ⚡ {p.sentiment.shift} ({p.sentiment.change > 0 ? "+" : ""}
                  {p.sentiment.change})
                </div>
              ) : null}
              <LineChart
                label={t("sentiment")}
                data={p.sentimentSeries.map((s) => ({ t: s.t, v: s.value }))}
                min={-1}
                max={1}
                zeroLine
                height={110}
                format={(pt) => `${hm(pt.t)} · ${pt.v.toFixed(2)}`}
              />
            </div>

            {p.repeatedRequests.length ? (
              <div className="card">
                <div className="card-title">{t("requests")}</div>
                {p.repeatedRequests.map((r) => (
                  <div key={r.id} className="rank">
                    <span className="t">“{r.question}”</span>
                    <span className="c">×{r.count}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="card">
              <div className="card-title">{t("important")}</div>
              {p.importantMessages.length === 0 ? <div className="muted">—</div> : null}
              {p.importantMessages.map((m) => (
                <button key={m.commentId} className="list-row" style={{ width: "100%", textAlign: "left", alignItems: "flex-start" }} onClick={() => openViewer(m.viewer.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="small" style={{ color: "var(--gold)" }}>
                      {m.reason} · @{m.viewer.username}
                    </div>
                    <div style={{ fontSize: 14 }}>{m.text}</div>
                  </div>
                  <span className="small muted">{ago(m.t, now)}</span>
                </button>
              ))}
            </div>

            {p.spikes.length ? (
              <div className="card">
                <div className="card-title">{t("spikes")}</div>
                {p.spikes.map((s) => (
                  <div key={s.t} className="rank">
                    <span className="t mono">{hm(s.t)}</span>
                    <span className="c">{s.messages} msg</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty">…</div>
        )}
      </div>
    </div>
  );
}
