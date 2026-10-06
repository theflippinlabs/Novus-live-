import { useEffect, useState } from "react";
import type {
  LiveSafetyEvent,
  SafetyEventType,
  SafetySeverity,
} from "../../shared/types";
import { reporterLabel, safetyFacts } from "../../shared/safety";
import { api, ApiError } from "../api";
import { errorText, useLang } from "../i18n";
import { setState, toast, useStore } from "../store";
import { useCan } from "../permissions";
import { Sheet } from "./ui";

/*
 * LIVE safety: the warnings, restrictions and moderation events TikTok sent during a LIVE,
 * with what was happening just before. Only what TikTok sent is shown; the reporter only when
 * TikTok explicitly discloses it (it never does today).
 */

type Lang = "en" | "fr";

const SEV: Record<SafetySeverity, { cls: string; en: string; fr: string }> = {
  info: { cls: "", en: "INFO", fr: "INFO" },
  warning: { cls: "warn", en: "WARNING", fr: "ATTENTION" },
  high: { cls: "bad", en: "HIGH", fr: "ÉLEVÉ" },
  critical: { cls: "bad crit", en: "CRITICAL", fr: "CRITIQUE" },
};

const TYPE: Record<SafetyEventType, { en: string; fr: string }> = {
  warning: { en: "Warning", fr: "Avertissement" },
  restriction: { en: "Restriction", fr: "Restriction" },
  moderation: { en: "Moderation", fr: "Modération" },
  interruption: { en: "Interruption", fr: "Interruption" },
  content_action: { en: "Content action", fr: "Action sur le contenu" },
  visibility_action: {
    en: "Visibility action",
    fr: "Action sur la visibilité",
  },
  report: { en: "Report", fr: "Signalement" },
  unknown: { en: "Other", fr: "Autre" },
};

const icon = (e: LiveSafetyEvent) =>
  e.severity === "critical" ? "🔴" : e.severity === "info" ? "ℹ" : "⚠";
const time = (t: number, lang: Lang) =>
  new Date(t).toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export function SeverityTag({ s, lang }: { s: SafetySeverity; lang: Lang }) {
  return <span className={`status-tag ${SEV[s].cls}`}>{SEV[s][lang]}</span>;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="safety-row">
      <span className="small muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function SafetyItem({
  ev,
  sessionId,
  lang,
  open,
  onToggle,
  onUpdate,
}: {
  ev: LiveSafetyEvent;
  sessionId?: string;
  lang: Lang;
  open: boolean;
  onToggle: () => void;
  onUpdate: (e: LiveSafetyEvent) => void;
}) {
  const fr = lang === "fr";
  const [busy, setBusy] = useState(false);
  const canModerate = useCan("moderate");
  const ctx = ev.context;
  const facts = safetyFacts(ctx, lang);
  const analyze = async () => {
    setBusy(true);
    try {
      onUpdate((await api.analyzeSafety(ev.id, sessionId, lang)).event);
    } catch (e) {
      toast(
        errorText(e instanceof ApiError ? e.code : "ai_failed", lang),
        "warn",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`safety-item ${ev.severity}`}>
      <button className="safety-head" onClick={onToggle} aria-expanded={open}>
        <span className="mono small muted">{time(ev.timestamp, lang)}</span>
        <span className="safety-title">
          {icon(ev)} {ev.title}
        </span>
        <SeverityTag s={ev.severity} lang={lang} />
      </button>
      {open ? (
        <div className="safety-body">
          <Row label={fr ? "Événement" : "Event"}>
            {TYPE[ev.eventType][lang]}
          </Row>
          <Row label={fr ? "Heure" : "Time"}>{time(ev.timestamp, lang)}</Row>
          <Row label={fr ? "Gravité" : "Severity"}>
            <SeverityTag s={ev.severity} lang={lang} />
          </Row>
          <Row label={fr ? "Source" : "Source"}>
            {ev.source} ·{" "}
            {ev.captured === "imported"
              ? fr
                ? "Importé / fourni par une source externe"
                : "Imported / externally supplied"
              : fr
                ? "Capturé par NOVUS LIVE"
                : "Captured by NOVUS LIVE"}
          </Row>
          {ev.description ? (
            <Row label={fr ? "Détail TikTok" : "TikTok detail"}>
              {ev.description}
            </Row>
          ) : null}
          {ev.target?.username || ev.target?.id ? (
            <Row label={fr ? "Cible" : "Target"}>
              {ev.target.username ? `@${ev.target.username}` : ev.target.id}
            </Row>
          ) : null}
          <Row label={fr ? "Auteur du signalement" : "Reporter"}>
            {reporterLabel(ev, lang)}
          </Row>

          <div className="card-title" style={{ marginTop: 12, fontSize: 12 }}>
            {fr
              ? `Contexte — ${Math.round((ctx?.windowSec ?? 180) / 60)} min avant`
              : `Context — ${Math.round((ctx?.windowSec ?? 180) / 60)} min before`}
          </div>
          {facts.length ? (
            <ul className="safety-facts">
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : (
            <div className="small muted">
              {fr
                ? "Pas de données captées avant cet événement."
                : "No data captured before this event."}
            </div>
          )}
          {ctx?.flagged.length ? (
            <>
              <div className="small muted" style={{ marginTop: 8 }}>
                {fr ? "Commentaires les plus risqués" : "Riskiest comments"}
              </div>
              {ctx.flagged.map((c) => (
                <div
                  key={`${c.t}-${c.username}`}
                  className="small safety-quote"
                >
                  <b>@{c.username}</b> · {c.riskScore} — “{c.text}”
                </div>
              ))}
            </>
          ) : null}
          {ctx?.actions.length ? (
            <>
              <div className="small muted" style={{ marginTop: 8 }}>
                {fr ? "Actions de modération" : "Moderation actions"}
              </div>
              {ctx.actions.map((a) => (
                <div key={`${a.t}-${a.username}-${a.action}`} className="small">
                  {time(a.t, lang)} · {a.action} @{a.username} · {a.status}
                </div>
              ))}
            </>
          ) : null}
          {ctx?.activeUsers.length ? (
            <div className="small muted" style={{ marginTop: 8 }}>
              {fr
                ? "Comptes actifs dans le chat (contexte seulement, aucun lien avec un signalement) : "
                : "Active in the chat (context only, no link to any report): "}
              {ctx.activeUsers.map((u) => `@${u}`).join(", ")}
            </div>
          ) : null}

          <div className="card-title" style={{ marginTop: 12, fontSize: 12 }}>
            ✦ {fr ? "Analyse NOVUS" : "NOVUS analysis"}
          </div>
          {ev.analysis ? (
            <div className="safety-analysis small">{ev.analysis.text}</div>
          ) : canModerate ? (
            <button
              className="btn sm"
              onClick={() => void analyze()}
              disabled={busy}
            >
              {busy ? "…" : fr ? "Analyser le contexte" : "Analyse the context"}
            </button>
          ) : (
            <div className="small muted">
              {fr ? "Pas encore d'analyse." : "No analysis yet."}
            </div>
          )}
          <div className="small muted" style={{ marginTop: 6 }}>
            {fr
              ? "Une corrélation n'est pas une preuve : rien ici n'établit la cause de l'événement."
              : "Correlation is not proof: nothing here establishes the cause of the event."}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Timeline of a LIVE's safety events; `sessionId` for a past LIVE, else the current one (live). */
export function SafetySheet({
  sessionId,
  focus,
  onClose,
}: {
  sessionId?: string;
  focus?: string | null;
  onClose: () => void;
}) {
  const lang = useLang();
  const fr = lang === "fr";
  const live = useStore((s) => s.safety);
  const [past, setPast] = useState<LiveSafetyEvent[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(focus ?? null);
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    api
      .safety(sessionId)
      .then((r) => alive && setPast(r.events))
      .catch(() => alive && setPast([]));
    return () => {
      alive = false;
    };
  }, [sessionId]);
  const events = sessionId ? past : live;
  const update = (e: LiveSafetyEvent) => {
    if (sessionId)
      setPast((list) => (list ?? []).map((x) => (x.id === e.id ? e : x)));
    else setState({ safety: live.map((x) => (x.id === e.id ? e : x)) });
  };
  return (
    <Sheet onClose={onClose} label={fr ? "Sécurité du LIVE" : "LIVE safety"}>
      <div className="card-title">
        🛡 {fr ? "Sécurité du LIVE" : "LIVE safety"}
      </div>
      <div className="small muted" style={{ marginTop: -4, marginBottom: 10 }}>
        {fr
          ? "Avertissements, restrictions et actions envoyés par TikTok pendant le LIVE."
          : "Warnings, restrictions and actions TikTok sent during the LIVE."}
      </div>
      {!events ? <div className="empty">…</div> : null}
      {events && !events.length ? (
        <div className="empty">
          {fr
            ? "Aucun événement de sécurité détecté."
            : "No safety events detected."}
        </div>
      ) : null}
      {events
        ?.slice()
        .reverse()
        .map((ev) => (
          <SafetyItem
            key={ev.id}
            ev={ev}
            sessionId={sessionId}
            lang={lang}
            open={openId === ev.id}
            onToggle={() => setOpenId((o) => (o === ev.id ? null : ev.id))}
            onUpdate={update}
          />
        ))}
    </Sheet>
  );
}

/** Small header metric: number of safety events of the current LIVE; opens the timeline. */
export function SafetyMetric() {
  const lang = useLang();
  const events = useStore((s) => s.safety);
  const serious = events.some(
    (e) => e.severity === "high" || e.severity === "critical",
  );
  return (
    <div className={`metric ${serious ? "alert-hot" : ""}`}>
      <button
        onClick={() => setState({ safetyOpen: null })}
        aria-label={
          lang === "fr"
            ? `Événements de sécurité : ${events.length}`
            : `Safety events: ${events.length}`
        }
      >
        <div className="v">{events.length}</div>
        <div className="l">{lang === "fr" ? "Sécurité" : "Safety"}</div>
      </button>
    </div>
  );
}

/** Non-blocking notice for a new HIGH or CRITICAL event, and the live timeline sheet. */
export function SafetyLayer() {
  const lang = useLang();
  const fr = lang === "fr";
  const bannerId = useStore((s) => s.safetyBanner);
  const open = useStore((s) => s.safetyOpen);
  const ev = useStore((s) => s.safety.find((e) => e.id === s.safetyBanner));
  return (
    <>
      {bannerId && ev ? (
        <div
          className={`safety-banner ${ev.severity}`}
          role="status"
          aria-live="polite"
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>
              {icon(ev)}{" "}
              {fr
                ? "Événement de sécurité TikTok détecté"
                : "TikTok safety event detected"}
            </b>
            <div className="small ellipsis">
              {time(ev.timestamp, lang)} · {ev.title}
            </div>
          </div>
          <button
            className="btn sm gold"
            onClick={() => setState({ safetyOpen: ev.id, safetyBanner: null })}
          >
            {fr ? "Voir le contexte" : "View context"}
          </button>
          <button
            className="btn sm ghost"
            onClick={() => setState({ safetyBanner: null })}
            aria-label={fr ? "Fermer" : "Close"}
          >
            ✕
          </button>
        </div>
      ) : null}
      {open !== false ? (
        <SafetySheet
          focus={open}
          onClose={() => setState({ safetyOpen: false })}
        />
      ) : null}
    </>
  );
}
