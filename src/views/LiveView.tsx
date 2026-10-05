import { useMemo, useState } from "react";
import type { DemoSpeed } from "../../shared/types";
import { api, ApiError } from "../api";
import { directModeration, runAlertAction } from "../actions";
import { AlertCard } from "../components/AlertCard";
import { ChatStream } from "../components/ChatStream";
import { WatchLive } from "../components/WatchLive";
import { setChatTranslation, useChatTranslation, type ChatLang } from "../chatTranslate";
import { WeeklyGoalsCard } from "../components/WeeklyGoals";
import { Avatar, BrandLogo, Segmented, SeverityBadge, Sheet } from "../components/ui";
import { CommentsSwitch } from "../components/CommentsSwitch";
import { actionLabel, errorText, tr, useLang, useT } from "../i18n";
import { navigate, openSettings, openViewer, switchRoom, toast, useStore } from "../store";
import { useCan } from "../permissions";

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
      toast(t("demoStartFailed"), "warn");
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
          <BrandLogo />
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

/** The account is LIVE on TikTok but not recorded (manual mode, or recording stopped by hand). */
function LiveNotRecorded({ username, mode }: { username: string; mode?: "auto" | "manual" }) {
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  const canManage = useCan("manage_accounts");
  const fr = lang === "fr";
  const start = async () => {
    setBusy(true);
    try {
      await api.setRecording("start");
      toast(fr ? "Enregistrement démarré" : "Recording started", "ok");
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "internal_error", lang), "warn");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="hero">
      <BrandLogo />
      <div className="waiting-pill live">
        <span className="dot" />
        {fr ? "EN LIVE · NON ENREGISTRÉ" : "LIVE · NOT RECORDED"}
      </div>
      <h2 className="chrome-text" style={{ letterSpacing: "0.06em", textTransform: "none" }}>
        @{username}
      </h2>
      <p>
        {mode === "manual"
          ? fr
            ? "Ce compte est en mode manuel : Novus a détecté le LIVE mais n'enregistre rien tant que tu ne l'as pas lancé."
            : "This account is in manual mode: Novus detected the LIVE but records nothing until you start it."
          : fr
            ? "L'enregistrement de ce LIVE a été arrêté. Tu peux le relancer."
            : "Recording of this LIVE was stopped. You can start it again."}
      </p>
      {canManage ? (
        <button className="btn gold" onClick={start} disabled={busy}>
          {busy ? "…" : fr ? "● Démarrer l'enregistrement" : "● Start recording"}
        </button>
      ) : null}
    </div>
  );
}

function WaitingForLive({ username }: { username: string }) {
  const t = useT();
  const lang = useLang();
  const tiktok = useStore((s) => s.tiktok);
  const failing = tiktok?.state === "ERROR";
  return (
    <div className="hero">
      <BrandLogo />
      <div className={`waiting-pill ${failing ? "bad" : ""}`}>
        <span className="dot" />
        {failing ? t("tiktokRetrying") : t("waitingForLive")}
      </div>
      <h2 className="chrome-text" style={{ letterSpacing: "0.06em", textTransform: "none" }}>
        @{username}
      </h2>
      <p>{failing ? `${t("tiktokRetryingHint")}${tiktok?.error ? ` (${tr(tiktok.error, lang)})` : ""}` : t("waitingForLiveHint")}</p>
      <button className="btn sm" onClick={() => openSettings("tiktok")}>
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
            <button key={r.id} className={`chip ${r.live || r.detected ? "on" : ""}`} onClick={() => switchRoom(r.id)}>
              {r.live || r.detected ? "● " : ""}@{r.username}
            </button>
          ))}
        </div>
      ) : (
        <p className="small muted" style={{ marginTop: 0 }}>
          {t("followAccountHint")}
        </p>
      )}
      <button className="btn sm" style={{ marginTop: 10 }} onClick={() => openSettings("tiktok")}>
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
  const summary = useStore((s) => s.rooms.find((r) => r.id === s.room));
  const followed = room !== "main" && tiktok?.username ? tiktok.username : undefined;
  return (
    <div className="scroll">
      <div className="narrow stack">
        {followed ? (
          summary?.detected ? (
            <LiveNotRecorded username={followed} mode={summary.mode} />
          ) : (
            <WaitingForLive username={followed} />
          )
        ) : (
          <DemoCard secondary={false} />
        )}
        {followed ? <WeeklyGoalsCard defaultOpen /> : null}
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
  const canModerate = useCan("moderate");
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
        {top.reasons.slice(0, 3).map((r) => tr(r, lang)).join(" · ")}
      </div>
      <div className="grid-3" style={{ marginTop: 8, display: canModerate ? undefined : "none" }}>
        <button className="act" disabled={busy} onClick={() => run("dismiss")}>
          {actionLabel("dismiss", lang)}
        </button>
        <button className="act danger" disabled={busy} onClick={() => run(primary === "mute" ? "warn" : "mute")}>
          {actionLabel(primary === "mute" ? "warn" : "mute", lang)}
        </button>
        <button className="act rec danger" disabled={busy} onClick={() => run(primary)}>
          {actionLabel(primary, lang)}
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
  const lang = useLang();
  const session = useStore((s) => s.session);
  const demo = useStore((s) => s.demo);
  const room = useStore((s) => s.room);
  const canManage = useCan("manage_accounts");
  const canModerate = useCan("moderate");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [watching, setWatching] = useState(false);
  const [more, setMore] = useState(false);
  const { target: translation, unavailable: translateDown } = useChatTranslation();
  const direct = useStore((s) => directModeration(s.chatSender, s.room));

  if (!session || session.status !== "live") return <StartPanel />;

  // On a followed account the LIVE goes on on TikTok: this only stops recording it.
  const followedRoom = session.source === "tiktok" && room !== "main";
  const endLabel = followedRoom ? (lang === "fr" ? "Arrêter l'enregistrement" : "Stop recording") : t("endLive");
  const end = async () => {
    if (!window.confirm(`${endLabel} ?`)) return;
    if (followedRoom) await api.setRecording("stop");
    else await api.endSession();
    navigate("analytics");
  };

  const fr = lang === "fr";
  const canEnd = followedRoom ? canManage : canModerate;
  return (
    <div className="live-layout">
      {session.source === "tiktok" ? <div className="live-title small muted">{tr(session.title, lang)}</div> : null}
      <div className="live-split">
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          {watching && session.source === "tiktok" ? <WatchLive onClose={() => setWatching(false)} /> : null}
          <WeeklyGoalsCard />
          <CriticalStrip />
          <ChatStream flaggedOnly={flaggedOnly} />
        </div>
        <SideQueue />
      </div>
      <nav className="live-toolbar" aria-label={fr ? "Outils du LIVE" : "LIVE tools"}>
        {session.source === "tiktok" ? (
          <button className={watching ? "on" : ""} onClick={() => setWatching((w) => !w)} aria-pressed={watching}>
            <span className="ico">📺</span>
            {fr ? (watching ? "Masquer" : "Vidéo") : watching ? "Hide" : "Video"}
          </button>
        ) : (
          <button onClick={() => setMore(true)}>
            <span className="ico">⏩</span>
            {fr ? "Vitesse" : "Speed"} {demo.speed}x
          </button>
        )}
        <button className={translation !== "off" ? "on" : ""} onClick={() => setChatTranslation(NEXT_LANG[translation])} aria-label={fr ? "Traduire le chat" : "Translate the chat"}>
          <span className="ico">⇄</span>
          {translation === "off" ? (fr ? "Traduire" : "Translate") : `→ ${translation.toUpperCase()}${translateDown ? " ⚠" : ""}`}
        </button>
        <button className={flaggedOnly ? "on" : ""} onClick={() => setFlaggedOnly((f) => !f)} aria-pressed={flaggedOnly}>
          <span className="ico">⚑</span>
          {fr ? "Signalés" : "Flagged"}
        </button>
        <button onClick={() => setMore(true)} aria-haspopup="dialog">
          <span className="ico">⋯</span>
          {fr ? "Plus" : "More"}
        </button>
      </nav>
      {more ? (
        <Sheet onClose={() => setMore(false)} label={fr ? "Outils du LIVE" : "LIVE tools"}>
          <div className="card-title">{fr ? "Outils du LIVE" : "LIVE tools"}</div>
          <div className="small muted">{tr(session.title, lang)}</div>
          <div className="sheet-section">
            <div className="small muted">{fr ? "Traduction du chat" : "Chat translation"}</div>
            <TranslateSwitch />
          </div>
          <div className="sheet-section">
            <div className="small muted">{fr ? "Messages affichés" : "Messages shown"}</div>
            <Segmented
              label={t("filterLabel")}
              value={flaggedOnly ? "flagged" : "all"}
              options={[
                { value: "all", label: t("allMessages") },
                { value: "flagged", label: `⚑ ${t("flaggedOnly")}` },
              ]}
              onChange={(v) => setFlaggedOnly(v === "flagged")}
            />
          </div>
          {session.source === "demo" ? (
            <div className="sheet-section">
              <div className="small muted">{t("speed")}</div>
              <Segmented
                label={t("speed")}
                value={demo.speed}
                options={SPEEDS}
                gold
                onChange={(s) => {
                  void api.setDemoSpeed(s);
                }}
              />
            </div>
          ) : null}
          {direct && canModerate && session.source === "tiktok" ? (
            <div className="sheet-section">
              <div className="small muted">{fr ? "Raid" : "Raid"}</div>
              <CommentsSwitch block />
            </div>
          ) : null}
          <div className="sheet-section">
            <div className="small muted">{fr ? "Objectifs et rapport" : "Goals and report"}</div>
            <div className="grid-2">
              <button className="btn" onClick={() => { setMore(false); navigate("analytics"); }}>
                📊 {fr ? "Stats du LIVE" : "LIVE stats"}
              </button>
              <button className="btn" onClick={() => { setMore(false); navigate("moderation"); }}>
                🛡 {fr ? "Modération" : "Moderation"}
              </button>
            </div>
          </div>
          {canEnd ? (
            <div className="sheet-section">
              <button className="end-btn" style={{ width: "100%", minHeight: 46 }} onClick={() => { setMore(false); void end(); }} aria-label={endLabel}>
                ■ {endLabel}
              </button>
            </div>
          ) : null}
        </Sheet>
      ) : null}
    </div>
  );
}

const NEXT_LANG: Record<ChatLang, ChatLang> = { off: "fr", fr: "en", en: "off" };

/** Live translation of the chat: off, into French, or into English. */
function TranslateSwitch() {
  const lang = useLang();
  const { target, unavailable } = useChatTranslation();
  const label = lang === "fr" ? "Traduire le chat" : "Translate the chat";
  return (
    <span className="row" style={{ gap: 6 }} title={unavailable ? (lang === "fr" ? "Traduction indisponible : IA non configurée ou quota IA du mois atteint." : "Translation unavailable: AI not configured or this month's AI allowance used up.") : label}>
      <Segmented<ChatLang>
        label={label}
        value={target}
        options={[
          { value: "off", label: "⇄" },
          { value: "fr", label: "FR" },
          { value: "en", label: "EN" },
        ]}
        onChange={setChatTranslation}
      />
      {unavailable && target !== "off" ? <span className="small muted">{lang === "fr" ? "indispo." : "n/a"}</span> : null}
    </span>
  );
}
