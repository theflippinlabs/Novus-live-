import { useEffect, useMemo, useState } from "react";
import type { Sensitivity, Settings, ViewerListItem } from "../../shared/types";
import { api, ApiError } from "../api";
import { directModeration } from "../actions";
import { CommentsSwitch } from "../components/CommentsSwitch";
import { ModerationTabs } from "../components/ModerationTabs";
import { Avatar, Segmented, SeverityBadge } from "../components/ui";
import { ago } from "../format";
import { actionLabel, errorText, useLang, useT } from "../i18n";
import { useCan } from "../permissions";
import { getState, navigate, openSettings, openViewer, serverNow, setState, switchRoom, toast, useStore } from "../store";
import { nicknameOf } from "../viewerName";

/*
 * Moderation › Dashboard: everything a moderator acts on, on one screen.
 * The accounts that need attention, the alerts to handle now, quick controls (comments,
 * sensitivity, a banned word) and what was done (action log).
 */

async function save(patch: Partial<Settings>, ok: string) {
  try {
    setState({ settings: await api.saveSettings(patch) });
    toast(ok, "ok");
  } catch (e) {
    toast(errorText(e instanceof ApiError ? e.code : "save_failed", getState().settings.language), "warn");
  }
}

/** LIVE accounts with alerts first: tap to open that account's alerts. */
function Radar() {
  const lang = useLang();
  const fr = lang === "fr";
  const rooms = useStore((s) => s.rooms);
  const current = useStore((s) => s.room);
  const list = useMemo(
    () =>
      rooms
        .filter((r) => r.kind === "tiktok" && (r.live || r.detected || r.openAlerts > 0))
        .sort((a, b) => b.criticalAlerts - a.criticalAlerts || b.openAlerts - a.openAlerts || Number(b.live) - Number(a.live)),
    [rooms],
  );
  if (!rooms.some((r) => r.kind === "tiktok")) return null;
  return (
    <div className="card">
      <div className="card-title">
        <span className="gold">◎</span> {fr ? "Comptes à surveiller" : "Accounts to watch"}
      </div>
      {list.length ? (
        list.map((r) => (
          <button
            key={r.id}
            className="hub-row"
            onClick={() => {
              if (r.id !== current) switchRoom(r.id);
              navigate("alerts");
            }}
          >
            <span className={`status-tag ${r.live ? "bad" : r.detected ? "warn" : ""}`}>{r.live ? "● LIVE" : r.detected ? (fr ? "LIVE · non enreg." : "LIVE · not rec.") : fr ? "Terminé" : "Ended"}</span>
            <span className="grow">
              <b className="ell" style={{ display: "block" }}>
                @{r.username}
              </b>
              <span className="small muted">
                {r.viewerCount ? `${r.viewerCount} ${fr ? "spect." : "viewers"} · ` : ""}
                {r.openAlerts} {fr ? "alerte(s) ouverte(s)" : "open alert(s)"}
              </span>
            </span>
            {r.criticalAlerts ? <span className="mod-count hot">▲{r.criticalAlerts}</span> : r.openAlerts ? <span className="mod-count">{r.openAlerts}</span> : <span className="status-tag ok">✓</span>}
          </button>
        ))
      ) : (
        <div className="small muted">{fr ? "Aucun compte en LIVE ni alerte ouverte. Tout est calme." : "No account LIVE and no open alert. All quiet."}</div>
      )}
    </div>
  );
}

/** The most urgent open alerts of the account on screen. */
function Urgent() {
  const t = useT();
  const lang = useLang();
  const alerts = useStore((s) => s.alerts);
  const open = useMemo(() => alerts.filter((a) => a.status === "open").sort((a, b) => b.riskScore - a.riskScore), [alerts]);
  return (
    <div className="card">
      <div className="card-title">
        <span className="gold">◆</span> {lang === "fr" ? "À traiter maintenant" : "Handle now"} · {open.length}
      </div>
      {open.length ? (
        open.slice(0, 4).map((a) => (
          <button key={a.id} className="hub-row" onClick={() => openViewer(a.viewer.id)}>
            <SeverityBadge severity={a.severity} score={a.riskScore} compact />
            <span className="grow">
              <b className="ell" style={{ display: "block" }}>
                @{a.viewer.username}
              </b>
              <span className="small muted ell" style={{ display: "block" }}>
                “{a.text}”
              </span>
            </span>
            <span className="small gold" style={{ flex: "none" }}>{actionLabel(a.recommendedAction, lang)}</span>
          </button>
        ))
      ) : (
        <div className="small muted">{t("noAlerts")}</div>
      )}
      {open.length ? (
        <button className="btn block sm" style={{ marginTop: 8 }} onClick={() => navigate("alerts")}>
          {lang === "fr" ? `Traiter les ${open.length} alertes` : `Handle all ${open.length} alerts`} →
        </button>
      ) : null}
    </div>
  );
}

/** Controls a moderator changes during a LIVE, without digging into Settings. */
function QuickControls() {
  const t = useT();
  const lang = useLang();
  const fr = lang === "fr";
  const settings = useStore((s) => s.settings);
  const session = useStore((s) => s.session);
  const direct = useStore((s) => directModeration(s.chatSender, s.room));
  const canModerate = useCan("moderate");
  const canSettings = useCan("settings");
  const [word, setWord] = useState("");
  if (!canModerate && !canSettings) return null;
  const addWord = () => {
    const w = word.trim();
    if (!w) return;
    if (settings.bannedPhrases.some((p) => p.toLowerCase() === w.toLowerCase())) return setWord("");
    void save({ bannedPhrases: [...settings.bannedPhrases, w] }, fr ? `« ${w} » ajouté aux mots interdits` : `“${w}” added to banned words`);
    setWord("");
  };
  return (
    <div className="card">
      <div className="card-title">
        <span className="gold">⚙</span> {fr ? "Réglages rapides" : "Quick controls"}
      </div>
      {direct && canModerate && session?.status === "live" && session.source === "tiktok" ? (
        <div style={{ marginBottom: 12 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>
            {fr ? "Raid en cours ? Coupe les commentaires du LIVE." : "Raid going on? Turn the LIVE's comments off."}
          </div>
          <CommentsSwitch block />
        </div>
      ) : null}
      {canSettings ? (
        <>
          <div className="small muted" style={{ marginBottom: 6 }}>
            {fr ? "Sensibilité de l'IA" : "AI sensitivity"}
          </div>
          <Segmented<Sensitivity>
            label={fr ? "Sensibilité" : "Sensitivity"}
            value={settings.sensitivity}
            options={[
              { value: "low", label: t("sensLow") },
              { value: "balanced", label: t("sensBalanced") },
              { value: "strict", label: t("sensStrict") },
              ...(settings.sensitivity === "custom" ? [{ value: "custom" as Sensitivity, label: t("custom") }] : []),
            ]}
            onChange={(v) => v !== "custom" && void save({ sensitivity: v }, fr ? "Sensibilité enregistrée" : "Sensitivity saved")}
            gold
          />
          <div className="small muted" style={{ margin: "12px 0 6px" }}>
            {fr ? `Ajouter un mot interdit (${settings.bannedPhrases.length} déjà)` : `Add a banned word (${settings.bannedPhrases.length} already)`}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input className="input" style={{ flex: 1 }} value={word} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWord()} placeholder={t("bannedPlaceholder")} autoCapitalize="off" aria-label={fr ? "Mot interdit" : "Banned word"} />
            <button className="btn gold" onClick={addWord} disabled={!word.trim()}>
              +
            </button>
          </div>
          <div className="grid-2" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={() => openSettings("lists")}>
              {fr ? "Listes" : "Lists"} →
            </button>
            <button className="btn sm" onClick={() => openSettings("moderation")}>
              {fr ? "Règles" : "Rules"} →
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The riskiest viewers of the LIVE, refreshed while the screen is open. */
function ToWatch() {
  const lang = useLang();
  const fr = lang === "fr";
  const sessionId = useStore((s) => s.session?.id);
  const [list, setList] = useState<ViewerListItem[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .viewers({ sort: "risk", filter: "all" })
        .then((r) => alive && setList(r.viewers.filter((v) => v.maxRisk >= 25).slice(0, 5)))
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId]);
  return (
    <div className="card">
      <div className="card-title">
        <span className="gold">◉</span> {fr ? "Spectateurs à risque" : "Risky viewers"}
      </div>
      {list.length ? (
        list.map((v) => {
          const nick = nicknameOf(v.viewer);
          return (
            <button key={v.viewer.id} className="hub-row" onClick={() => openViewer(v.viewer.id)}>
              <Avatar viewer={v.viewer} />
              <span className="grow">
                <b className="ell" style={{ display: "block" }}>
                  {nick ?? `@${v.viewer.username}`}
                </b>
                <span className="small muted">
                  {v.messageCount} msg{v.warnings ? ` · ${v.warnings} ⚠` : ""}
                </span>
              </span>
              <SeverityBadge severity={v.maxRisk >= 75 ? "critical" : v.maxRisk >= 50 ? "warning" : "watch"} score={v.maxRisk} compact />
            </button>
          );
        })
      ) : (
        <div className="small muted">{fr ? "Aucun spectateur à risque pour l'instant." : "No risky viewer so far."}</div>
      )}
      <button className="btn block sm" style={{ marginTop: 8 }} onClick={() => navigate("viewers")}>
        {fr ? "Tous les spectateurs" : "All viewers"} →
      </button>
    </div>
  );
}

const STATUS: Record<string, { cls: string; en: string; fr: string }> = {
  executed: { cls: "ok", en: "Done in TikTok", fr: "Fait dans TikTok" },
  simulated: { cls: "", en: "Simulated", fr: "Simulé" },
  manual_required: { cls: "warn", en: "To do by hand", fr: "À faire à la main" },
  recorded: { cls: "", en: "Recorded", fr: "Noté" },
  failed: { cls: "bad", en: "Failed", fr: "Échec" },
};

/** What was done during this LIVE, newest first. */
function ActionLog() {
  const lang = useLang();
  const fr = lang === "fr";
  const actions = useStore((s) => s.lastActions);
  const now = serverNow();
  const list = useMemo(() => [...actions].reverse().slice(0, 15), [actions]);
  return (
    <div className="card">
      <div className="card-title">
        <span className="gold">☰</span> {fr ? "Journal des actions" : "Action log"} · {actions.length}
      </div>
      {list.length ? (
        list.map((a) => {
          const st = STATUS[a.status] ?? STATUS.recorded;
          return (
            <button key={a.id} className="hub-row" onClick={() => openViewer(a.viewer.id)}>
              <span className="grow">
                <b className="ell" style={{ display: "block" }}>
                  {actionLabel(a.action, lang)} · @{a.viewer.username}
                </b>
                <span className="small muted ell" style={{ display: "block" }}>
                  {ago(a.performedAt, now)} · {a.i18n?.[lang]?.message ?? a.message}
                </span>
              </span>
              <span className={`status-tag ${st.cls}`}>{st[lang]}</span>
            </button>
          );
        })
      ) : (
        <div className="small muted">{fr ? "Aucune action pendant ce LIVE pour l'instant." : "No action during this LIVE yet."}</div>
      )}
    </div>
  );
}

export function ModerationView() {
  const lang = useLang();
  const fr = lang === "fr";
  const stats = useStore((s) => s.stats);
  const actions = useStore((s) => s.lastActions.length);
  const live = useStore((s) => s.session?.status === "live");
  return (
    <div className="scroll">
      <div className="narrow stack">
        <ModerationTabs />
        <div className="hub-kpis">
          <button className={`hub-kpi ${stats.criticalAlerts ? "hot" : ""}`} onClick={() => navigate("alerts")}>
            <div className="v">{stats.criticalAlerts}</div>
            <div className="l">{fr ? "Critiques" : "Critical"}</div>
          </button>
          <button className="hub-kpi" onClick={() => navigate("alerts")}>
            <div className="v">{stats.openAlerts}</div>
            <div className="l">{fr ? "Ouvertes" : "Open"}</div>
          </button>
          <button className="hub-kpi" onClick={() => navigate("viewers")}>
            <div className="v">{stats.activeChatters}</div>
            <div className="l">{fr ? "Actifs" : "Chatters"}</div>
          </button>
          <div className="hub-kpi">
            <div className="v">{actions}</div>
            <div className="l">{fr ? "Actions" : "Actions"}</div>
          </div>
        </div>
        {!live ? <div className="small muted">{fr ? "Pas de LIVE en cours sur ce compte : les chiffres sont ceux du dernier LIVE." : "No LIVE on this account right now: figures are from the last LIVE."}</div> : null}
        <Radar />
        <Urgent />
        <QuickControls />
        <ToWatch />
        <ActionLog />
      </div>
    </div>
  );
}
