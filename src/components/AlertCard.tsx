import { memo, useState } from "react";
import type { ActionType, ModerationAlert, RecommendedAction } from "../../shared/types";
import { api } from "../api";
import { actionCopy, actionLabel, categoryLabel, pick, severityLabel, tr, useLang, useT, word } from "../i18n";
import { ago } from "../format";
import { runAlertAction } from "../actions";
import { openViewer, serverNow, toast, upsertAlert } from "../store";
import { Avatar, SeverityBadge } from "./ui";

const ACTIONS: ActionType[] = ["watch", "warn", "mute", "block", "report", "dismiss"];
const DANGER: ActionType[] = ["mute", "block", "report"];

function recommendedSet(rec: RecommendedAction): ActionType[] {
  switch (rec) {
    case "report":
      return ["block", "report"];
    case "block":
      return ["mute", "block"];
    case "mute":
      return ["mute"];
    case "warn":
      return ["warn"];
    case "watch":
      return ["watch"];
    default:
      return [];
  }
}

export const AlertCard = memo(function AlertCard({ alert, compact }: { alert: ModerationAlert; compact?: boolean }) {
  const t = useT();
  const lang = useLang();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const rec = recommendedSet(alert.recommendedAction);
  const closed = alert.status === "resolved" || alert.status === "dismissed";
  const res = alert.resolution;
  const pendingManual = res?.status === "manual_required" && !res.confirmedAt;
  const copyOfRes = res ? actionCopy(res, lang) : null;

  const act = async (action: ActionType) => {
    setBusy(action);
    try {
      await runAlertAction(alert, action, lang);
    } catch {
      toast(lang === "fr" ? "Échec de l'action" : "Action failed", "warn");
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    if (!res) return;
    setBusy("confirm");
    try {
      await api.confirmAction(res.id);
      upsertAlert({ ...alert, status: "resolved", resolution: { ...res, confirmedAt: Date.now() } });
      toast(t("confirmed"), "ok");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast(text);
    }
  };

  return (
    <article
      className={`alert-card ${alert.severity} ${closed ? "closed" : ""}`}
      aria-label={lang === "fr" ? `Alerte ${severityLabel(alert.severity, lang).toLowerCase()} pour @${alert.viewer.username}` : `${alert.severity} alert for @${alert.viewer.username}`}
    >
      <div className="alert-head">
        <SeverityBadge severity={alert.severity} />
        <button className="row" style={{ gap: 8, minWidth: 0 }} onClick={() => openViewer(alert.viewer.id)}>
          <Avatar viewer={alert.viewer} />
          <span className="alert-user" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            @{alert.viewer.username}
          </span>
        </button>
        <div className="alert-score">
          {alert.riskScore}
          <small>{t("risk").toUpperCase()}</small>
        </div>
      </div>

      <div className="alert-text">“{alert.text}”</div>

      <div className="alert-meta">
        <div className="chips">
          {alert.reasons.slice(0, compact ? 3 : 6).map((r) => (
            <span key={r} className="reason">
              {tr(r, lang)}
            </span>
          ))}
          {alert.occurrences > 1 ? <span className="reason">×{alert.occurrences}</span> : null}
          {alert.stage === "ai" ? <span className="reason" style={{ color: "var(--gold)" }}>{lang === "fr" ? "IA" : "AI"}</span> : null}
        </div>
        {alert.accounts?.length ? (
          <div className="chips" style={{ marginTop: 6 }}>
            <span className="small muted">
              +{alert.accounts.length} {t("accounts")}:
            </span>
            {alert.accounts.slice(0, 6).map((v) => (
              <button key={v.id} className="chip" onClick={() => openViewer(v.id)}>
                @{v.username}
              </button>
            ))}
            {alert.accounts.length > 6 ? <span className="small muted">+{alert.accounts.length - 6}</span> : null}
          </div>
        ) : null}
        {!compact ? <div className="expl">{pick(alert.explanation, alert.explanationI18n, lang)}</div> : null}
        <div className="alert-rec">
          {t("recommended").toUpperCase()}
          <b>{rec.length ? rec.map((a) => actionLabel(a, lang)).join(" / ") : "—"}</b>
        </div>
        <div className="alert-sub">
          {alert.categories.slice(0, 3).map((c) => categoryLabel(c, lang)).join(" · ")} · {ago(alert.createdAt, serverNow())} · {Math.round(alert.confidence * 100)}%
        </div>
      </div>

      {pendingManual && res && copyOfRes ? (
        <div className="manual" role="status">
          <h4>{t("manualRequired")}</h4>
          <div className="small">{copyOfRes.message}</div>
          {copyOfRes.instructions?.length ? (
            <ol>
              {copyOfRes.instructions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          ) : null}
          {copyOfRes.suggestedMessage ? (
            <>
              <div className="suggested">{copyOfRes.suggestedMessage}</div>
              <button className="btn sm" onClick={() => copy(copyOfRes.suggestedMessage!)}>
                {copied ? t("copied") : t("copyMessage")}
              </button>{" "}
            </>
          ) : null}
          <button className="btn gold sm" onClick={confirm} disabled={busy !== null}>
            ✓ {t("doneInTikTok")}
          </button>
        </div>
      ) : null}

      {closed && res ? (
        <div className="resolution">
          {actionLabel(res.action, lang)} · {res.status === "simulated" ? t("simulated") : word(res.status, lang)}
          {res.confirmedAt ? ` · ${t("confirmed")}` : ""} — {copyOfRes?.message}
        </div>
      ) : null}

      {!closed && !pendingManual ? (
        <div className="action-grid">
          {ACTIONS.map((a) => (
            <button
              key={a}
              className={`act ${rec.includes(a) ? "rec" : ""} ${DANGER.includes(a) ? "danger" : ""}`}
              onClick={() => act(a)}
              disabled={busy !== null || (a === "watch" && alert.status === "watching")}
              aria-label={`${actionLabel(a, lang)} @${alert.viewer.username}`}
            >
              {busy === a ? "…" : actionLabel(a, lang)}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
});
