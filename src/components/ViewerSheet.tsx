import { useCallback, useEffect, useState } from "react";
import type { ActionRecord, ActionType, Category, ModerationAlert, ViewerFlag, ViewerProfile } from "../../shared/types";
import { api } from "../api";
import { categoryLabel, useLang, useT } from "../i18n";
import { clock, hm } from "../format";
import { openViewer, toast, useStore } from "../store";
import { Sparkline } from "./Charts";
import { Avatar, Segmented, SeverityBadge, Sheet } from "./ui";

const ACTIONS: ActionType[] = ["watch", "warn", "mute", "block", "report"];

export function ViewerSheet() {
  const id = useStore((s) => s.selectedViewerId);
  if (!id) return null;
  return <ViewerSheetInner id={id} key={id} />;
}

function ViewerSheetInner({ id }: { id: string }) {
  const t = useT();
  const lang = useLang();
  const [profile, setProfile] = useState<ViewerProfile | null>(null);
  const [alerts, setAlerts] = useState<ModerationAlert[]>([]);
  const [missing, setMissing] = useState(false);
  const [lastManual, setLastManual] = useState<ActionRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => openViewer(null), []);

  const load = useCallback(async () => {
    try {
      const r = await api.viewer(id);
      setProfile(r.profile);
      setAlerts(r.alerts);
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const setFlag = async (flag: ViewerFlag | "none") => {
    const r = await api.setFlag(id, flag === "none" ? null : flag);
    setProfile(r.profile);
    toast(`@${r.profile.viewer.username} → ${flag === "none" ? t("none") : t(flag)}`, "ok");
  };

  const act = async (action: ActionType) => {
    setBusy(true);
    try {
      const r = await api.viewerAction(id, action);
      setProfile(r.profile);
      if (r.record.status === "manual_required") setLastManual(r.record);
      else toast(`${action.toUpperCase()} · ${r.record.status === "simulated" ? t("simulated") : r.record.message}`, "ok");
    } finally {
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <Sheet onClose={close} label="Viewer">
        <div className="empty">Viewer not found in this LIVE.</div>
      </Sheet>
    );
  }
  if (!profile) {
    return (
      <Sheet onClose={close} label="Viewer">
        <div className="empty">…</div>
      </Sheet>
    );
  }

  const p = profile;
  const a = p.assessment;
  const cats = Object.entries(p.categories).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0)) as [Category, number][];

  return (
    <Sheet onClose={close} label={`Viewer @${p.viewer.username}`}>
      <div className="row" style={{ paddingRight: 44 }}>
        <Avatar viewer={p.viewer} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div className="alert-user" style={{ fontSize: 19 }}>
            @{p.viewer.username}
          </div>
          <div className="small muted">
            {t("firstSeen")} {hm(p.firstSeen)}
            {p.language ? ` · ${p.language.toUpperCase()}` : ""}
            {p.gifts ? ` · 🎁 ${p.gifts}` : ""}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Segmented
          label="Viewer status"
          gold
          value={p.flag ?? "none"}
          onChange={setFlag}
          options={[
            { value: "none", label: t("none") },
            { value: "trusted", label: t("trusted") },
            { value: "watchlist", label: t("watchlist") },
            { value: "ignored", label: t("ignored") },
          ]}
        />
      </div>

      <div className="stat-grid" style={{ marginTop: 12 }}>
        <div className="stat">
          <div className="v">{p.messageCount}</div>
          <div className="l">{t("messages")}</div>
        </div>
        <div className="stat">
          <div className="v">{p.messagesPerMinute}</div>
          <div className="l">{t("msgMin")}</div>
        </div>
        <div className="stat">
          <div className="v">{p.warnings}</div>
          <div className="l">{t("warnings")}</div>
        </div>
        <div className="stat">
          <div className="v">{p.alertIds.length}</div>
          <div className="l">{t("prevAlerts")}</div>
        </div>
        <div className="stat">
          <div className="v">{p.maxRisk}</div>
          <div className="l">Max {t("risk")}</div>
        </div>
        <div className="stat">
          <div className="v">{p.actions.length}</div>
          <div className="l">Actions</div>
        </div>
      </div>

      {a ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-title">
            <span className="gold">◆</span> {t("assessment")}
            <span className="spacer" />
            <SeverityBadge severity={a.severity} score={a.riskScore} />
          </div>
          <div style={{ fontSize: 14 }}>{a.explanation}</div>
          <div className="alert-rec">
            {t("recommended").toUpperCase()} <b>{a.recommendedAction.toUpperCase()}</b>
            <span className="spacer" />
            <span className="mono small">
              {a.stage === "ai" ? "AI" : "Local"} · {Math.round(a.confidence * 100)}%
            </span>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title">{t("riskTrend")}</div>
        <Sparkline values={p.riskTrend.map((r) => r.score)} width={300} height={44} color={p.maxRisk >= 75 ? "#e5263e" : p.maxRisk >= 50 ? "#f58a34" : "#d9d9e0"} />
        {cats.length ? (
          <>
            <div className="card-title" style={{ marginTop: 12 }}>
              {t("categoriesDetected")}
            </div>
            <div className="chips">
              {cats.map(([c, n]) => (
                <span key={c} className="chip">
                  {categoryLabel(c, lang)} ×{n}
                </span>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {lastManual ? (
        <div className="manual" style={{ margin: "12px 0 0" }}>
          <h4>{t("manualRequired")}</h4>
          <div className="small">{lastManual.message}</div>
          <ol>
            {lastManual.instructions?.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {lastManual.suggestedMessage ? <div className="suggested">{lastManual.suggestedMessage}</div> : null}
          <button
            className="btn gold sm"
            onClick={async () => {
              await api.confirmAction(lastManual.id);
              setLastManual(null);
              toast(t("confirmed"), "ok");
              void load();
            }}
          >
            ✓ {t("doneInTikTok")}
          </button>
        </div>
      ) : null}

      <div className="action-grid" style={{ padding: "12px 0 0", gridTemplateColumns: "repeat(5, 1fr)" }}>
        {ACTIONS.map((x) => (
          <button key={x} className={`act ${x === a?.recommendedAction ? "rec" : ""} ${["mute", "block", "report"].includes(x) ? "danger" : ""}`} disabled={busy} onClick={() => act(x)} style={{ fontSize: 11.5 }}>
            {x.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="section-title">{t("recentComments")}</div>
      <div className="card" style={{ padding: "4px 12px" }}>
        {p.recentComments.map((c) => (
          <div key={c.id} className="list-row" style={{ alignItems: "flex-start" }}>
            <span className="mono small muted" style={{ paddingTop: 2 }}>
              {clock(c.t)}
            </span>
            <span style={{ flex: 1, fontSize: 14, wordBreak: "break-word" }}>{c.text}</span>
            {c.severity !== "normal" ? <SeverityBadge severity={c.severity} score={c.riskScore} compact /> : null}
          </div>
        ))}
      </div>

      {alerts.length ? (
        <>
          <div className="section-title">{t("prevAlerts")}</div>
          <div className="card" style={{ padding: "4px 12px" }}>
            {alerts.map((al) => (
              <div key={al.id} className="list-row">
                <SeverityBadge severity={al.severity} score={al.riskScore} compact />
                <span style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>“{al.text}”</span>
                <span className="small muted">{al.status}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="section-title">{t("modHistory")}</div>
      <div className="card" style={{ padding: "4px 12px" }}>
        {p.actions.length === 0 ? <div className="small muted" style={{ padding: "10px 0" }}>—</div> : null}
        {p.actions.map((r) => (
          <div key={r.id} className="list-row">
            <span className="mono small muted">{clock(r.performedAt)}</span>
            <b style={{ fontSize: 13 }}>{r.action.toUpperCase()}</b>
            <span className="small" style={{ flex: 1, color: r.status === "manual_required" && !r.confirmedAt ? "var(--gold)" : "var(--text-2)" }}>
              {r.status === "manual_required" ? (r.confirmedAt ? `manual · ${t("confirmed")}` : t("manualRequired")) : r.status}
            </span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
