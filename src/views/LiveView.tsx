import { useMemo, useState } from "react";
import type { DemoSpeed } from "../../shared/types";
import { api } from "../api";
import { runAlertAction } from "../actions";
import { AlertCard } from "../components/AlertCard";
import { ChatStream } from "../components/ChatStream";
import { Avatar, Logo, Segmented, SeverityBadge } from "../components/ui";
import { useLang, useT } from "../i18n";
import { navigate, openViewer, switchRoom, toast, useStore } from "../store";

const SPEEDS: { value: DemoSpeed; label: string }[] = [
  { value: 1, label: "1x" },
  { value: 5, label: "5x" },
  { value: 20, label: "20x" },
];

function DemoCard({ secondary }: { secondary: boolean }) {
  const t = useT();
  const [speed, setSpeed] = useState<DemoSpeed>(1);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      await api.startDemo(speed);
    } catch {
      toast("Could not start demo", "warn");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={secondary ? "card" : "hero"}>
      {secondary ? (
        <div className="card-title">{t("demoTitle")}</div>
      ) : (
        <>
          <div className="logo">
            <Logo size={64} />
          </div>
          <h2 className="chrome-text">NOVUS LIVE</h2>
        </>
      )}
      <p className={secondary ? "small muted" : undefined} style={secondary ? { marginTop: 0 } : undefined}>
        {t("startDemoHint")}
      </p>
      <div style={{ maxWidth: 320, margin: secondary ? "0 0 10px" : "0 auto 12px" }}>
        <div className="small muted" style={{ marginBottom: 6 }}>
          {t("speed")}
        </div>
        <Segmented label={t("speed")} value={speed} options={SPEEDS} onChange={setSpeed} gold={!secondary} />
      </div>
      <button className={secondary ? "btn block" : "btn gold lg block"} style={{ maxWidth: 360, margin: secondary ? undefined : "0 auto" }} onClick={start} disabled={busy}>
        ▶ {t("startDemo")}
      </button>
    </div>
  );
}

function WaitingForLive({ username }: { username: string }) {
  const t = useT();
  const tiktok = useStore((s) => s.tiktok);
  const failing = tiktok?.state === "ERROR";
  return (
    <div className="hero">
      <div className="logo">
        <Logo size={64} />
      </div>
      <div className={`waiting-pill ${failing ? "bad" : ""}`}>
        <span className="dot" />
        {failing ? t("tiktokRetrying") : t("waitingForLive")}
      </div>
      <h2 className="chrome-text" style={{ letterSpacing: "0.06em", textTransform: "none" }}>
        @{username}
      </h2>
      <p>{failing ? `${t("tiktokRetryingHint")}${tiktok?.error ? ` (${tiktok.error})` : ""}` : t("waitingForLiveHint")}</p>
      <button className="btn sm" onClick={() => navigate("settings")}>
        {t("tiktokIntegration")} →
      </button>
    </div>
  );
}

function FollowedAccounts() {
  const t = useT();
  const lang = useLang();
  const allRooms = useStore((s) => s.rooms);
  const rooms = useMemo(() => allRooms.filter((r) => r.kind === "tiktok"), [allRooms]);
  return (
    <div className="card">
      <div className="card-title">{lang === "fr" ? "Comptes TikTok suivis" : "Followed TikTok accounts"}</div>
      {rooms.length ? (
        <div className="chips">
          {rooms.map((r) => (
            <button key={r.id} className={`chip ${r.live ? "on" : ""}`} onClick={() => switchRoom(r.id)}>
              {r.live ? "● " : ""}@{r.username}
            </button>
          ))}
        </div>
      ) : (
        <p className="small muted" style={{ marginTop: 0 }}>
          {t("followAccountHint")}
        </p>
      )}
      <button className="btn sm" style={{ marginTop: 10 }} onClick={() => navigate("settings")}>
        {t("tiktokIntegration")} →
      </button>
    </div>
  );
}

function StartPanel() {
  const t = useT();
  const session = useStore((s) => s.session);
  const room = useStore((s) => s.room);
  const tiktok = useStore((s) => s.tiktok);
  const followed = room !== "main" && tiktok?.username ? tiktok.username : undefined;
  return (
    <div className="scroll">
      <div className="narrow stack">
        {followed ? <WaitingForLive username={followed} /> : <DemoCard secondary={false} />}
        {session?.status === "ended" ? (
          <button className="btn block" onClick={() => navigate("analytics")}>
            {t("report")} →
          </button>
        ) : null}
        {followed ? null : <FollowedAccounts />}
      </div>
    </div>
  );
}

function CriticalStrip() {
  const lang = useLang();
  const alerts = useStore((s) => s.alerts);
  const top = useMemo(() => alerts.find((a) => a.status === "open" && a.severity === "critical" && !(a.resolution?.status === "manual_required" && !a.resolution.confirmedAt)), [alerts]);
  const [busy, setBusy] = useState(false);
  if (!top) return null;
  const primary = top.recommendedAction === "report" || top.recommendedAction === "block" ? "block" : top.recommendedAction === "warn" ? "warn" : "mute";
  const run = async (action: "mute" | "block" | "warn" | "dismiss") => {
    setBusy(true);
    try {
      await runAlertAction(top, action, lang);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="critical-strip" role="alert">
      <div className="top">
        <SeverityBadge severity="critical" score={top.riskScore} />
        <button className="row" style={{ gap: 6, minWidth: 0 }} onClick={() => openViewer(top.viewer.id)}>
          <Avatar viewer={top.viewer} />
          <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{top.viewer.username}</b>
        </button>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => navigate("alerts")}>
          ⋯
        </button>
      </div>
      <div className="txt">“{top.text}”</div>
      <div className="small" style={{ color: "var(--text-2)", marginTop: 2 }}>
        {top.reasons.slice(0, 3).join(" · ")}
      </div>
      <div className="grid-3" style={{ marginTop: 8 }}>
        <button className="act" disabled={busy} onClick={() => run("dismiss")}>
          DISMISS
        </button>
        <button className="act danger" disabled={busy} onClick={() => run(primary === "mute" ? "warn" : "mute")}>
          {primary === "mute" ? "WARN" : "MUTE"}
        </button>
        <button className="act rec danger" disabled={busy} onClick={() => run(primary)}>
          {primary.toUpperCase()}
        </button>
      </div>
    </div>
  );
}

function SideQueue() {
  const t = useT();
  const alerts = useStore((s) => s.alerts);
  const open = useMemo(() => alerts.filter((a) => a.status === "open" || a.status === "watching").slice(0, 12), [alerts]);
  return (
    <aside className="live-side" aria-label={t("alerts")}>
      <div className="card-title">
        <span className="gold">◆</span> {t("alerts")} · {open.length}
      </div>
      {open.length === 0 ? <div className="empty">{t("noAlerts")}</div> : open.map((a) => <AlertCard key={a.id} alert={a} compact />)}
    </aside>
  );
}

export function LiveView() {
  const t = useT();
  const session = useStore((s) => s.session);
  const demo = useStore((s) => s.demo);
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  if (!session || session.status !== "live") return <StartPanel />;

  const end = async () => {
    if (!window.confirm(t("endLive") + "?")) return;
    await api.endSession();
    navigate("analytics");
  };

  return (
    <div className="live-layout">
      <div className="live-controls">
        {session.source === "demo" ? (
          <Segmented
            label={t("speed")}
            value={demo.speed}
            options={SPEEDS}
            gold
            onChange={(s) => {
              void api.setDemoSpeed(s);
            }}
          />
        ) : (
          <span className="small muted">{session.title}</span>
        )}
        <Segmented
          label="Filter"
          value={flaggedOnly ? "flagged" : "all"}
          options={[
            { value: "all", label: t("allMessages") },
            { value: "flagged", label: `⚑ ${t("flaggedOnly")}` },
          ]}
          onChange={(v) => setFlaggedOnly(v === "flagged")}
        />
        <span className="spacer" />
        <button className="end-btn" onClick={end} aria-label={t("endLive")} title={t("endLive")}>
          ■ END
        </button>
      </div>
      <div className="live-split">
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <CriticalStrip />
          <ChatStream flaggedOnly={flaggedOnly} />
        </div>
        <SideQueue />
      </div>
    </div>
  );
}
