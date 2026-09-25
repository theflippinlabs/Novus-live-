import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { LangToggle } from "./LangToggle";
import { compact, duration } from "../format";
import { navigate, serverNow, useStore } from "../store";
import { RoomBar } from "./RoomBar";

function Duration() {
  const session = useStore((s) => s.session);
  const [, tick] = useState(0);
  useEffect(() => {
    if (session?.status !== "live") return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [session?.status]);
  if (!session) return <>--:--</>;
  const end = session.endedAt ?? serverNow();
  return <>{duration(end - session.startedAt)}</>;
}

export function TopBar() {
  const t = useT();
  const session = useStore((s) => s.session);
  const stats = useStore((s) => s.stats);
  const ai = useStore((s) => s.ai);
  const connection = useStore((s) => s.connection);
  const live = session?.status === "live";
  const waiting = useStore((s) => s.room !== "main" && Boolean(s.tiktok?.username));
  const aiLabel = ai.state === "active" ? t("aiActive") : ai.state === "degraded" ? t("aiDegraded") : ai.state === "disabled" ? t("aiDisabled") : t("aiLocal");

  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand" aria-label="NOVUS LIVE">
          <span className="chrome-text">NOVUS</span>
          <span className="live-word">LIVE</span>
        </div>
        <span className={`status-pill ${live ? "on" : waiting ? "wait" : ""}`} aria-live="polite">
          <span className="dot" />
          {live ? t("statusLive") : waiting ? t("statusWaiting") : session?.status === "ended" ? t("statusEnded") : t("statusIdle")}
        </span>
        <span className="spacer" />
        <span className={`ai-chip ${ai.state}`} aria-label={aiLabel} title={ai.model ? `${ai.provider} · ${ai.model}${ai.lastError ? ` · ${ai.lastError}` : ""}` : t("aiLocalHint")}>
          <span className="dot" />
          <span className="ai-label">{aiLabel}</span>
          {ai.queued > 0 ? <span className="mono muted">·{ai.queued}</span> : null}
        </span>
        <LangToggle />
      </div>
      <RoomBar />
      <div className="metrics">
        <div className="metric">
          <div className="v">
            <Duration />
          </div>
          <div className="l">{t("durationShort")}</div>
        </div>
        <div className="metric">
          <div className="v">{compact(stats.messagesPerMinute)}</div>
          <div className="l">{t("msgMin")}</div>
        </div>
        <div className="metric">
          <div className="v">{compact(stats.viewerCount)}</div>
          <div className="l">{t("viewersShort")}</div>
        </div>
        <div className="metric optional">
          <div className="v">{compact(stats.activeChatters)}</div>
          <div className="l">{t("chatters")}</div>
        </div>
        <div className={`metric ${stats.criticalAlerts > 0 ? "alert-hot" : ""}`}>
          <button onClick={() => navigate("alerts")} aria-label={t("alertsAria").replace("{open}", String(stats.openAlerts)).replace("{critical}", String(stats.criticalAlerts))}>
            <div className="v">
              {stats.openAlerts}
              {stats.criticalAlerts > 0 ? <span className="small"> ▲{stats.criticalAlerts}</span> : null}
            </div>
            <div className="l">{t("alerts")}</div>
          </button>
        </div>
      </div>
      {connection === "reconnecting" ? <div className="conn-banner">{t("reconnecting")}</div> : null}
    </header>
  );
}
