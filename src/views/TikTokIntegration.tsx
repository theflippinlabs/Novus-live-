import { useEffect, useState } from "react";
import type { TikTokIntegrationState } from "../../shared/types";
import { api, ApiError } from "../api";
import { useLang, useT } from "../i18n";
import { ago } from "../format";
import { setState, toast, useStore } from "../store";

const STATES: TikTokIntegrationState[] = ["NOT_CONNECTED", "CONNECTOR_AVAILABLE", "CONNECTED", "LIVE_DETECTED", "LIVE_ENDED", "ERROR"];

const EXPLAIN: Record<TikTokIntegrationState, string> = {
  NOT_CONNECTED: "No authorized connector is configured on the server (INGEST_TOKEN not set). Demo mode works without it.",
  CONNECTOR_AVAILABLE: "The ingestion endpoint is enabled. Waiting for an authorized TikTok LIVE connector to send events.",
  CONNECTED: "A connector is sending heartbeats/events. No LIVE activity detected yet.",
  LIVE_DETECTED: "LIVE events are flowing into Novus in real time.",
  LIVE_ENDED: "The connector reported that the LIVE ended. A post-LIVE report was generated.",
  ERROR: "The connector sent invalid data or failed. Check the connector logs.",
};

const EXPLAIN_LIVE: Record<"en" | "fr", Record<TikTokIntegrationState, string>> = {
  en: {
    NOT_CONNECTED: "Enter the TikTok account to follow and tap Connect.",
    CONNECTOR_AVAILABLE: "Connector ready — checking whether the account is LIVE…",
    CONNECTED: "Connected to TikTok. Novus checks every minute and joins the LIVE automatically as soon as it starts.",
    LIVE_DETECTED: "LIVE detected — comments, gifts and viewers are streaming into Novus.",
    LIVE_ENDED: "The LIVE ended and its report was generated. Novus keeps watching for the next one.",
    ERROR: "The TikTok connector hit an error. Novus retries automatically every few minutes.",
  },
  fr: {
    NOT_CONNECTED: "Saisis le compte TikTok à suivre puis touche Connecter.",
    CONNECTOR_AVAILABLE: "Connecteur prêt — vérification du LIVE en cours…",
    CONNECTED: "Connecté à TikTok. Novus vérifie chaque minute et rejoint le LIVE automatiquement dès qu'il commence.",
    LIVE_DETECTED: "LIVE détecté — les commentaires, cadeaux et viewers arrivent dans Novus.",
    LIVE_ENDED: "Le LIVE est terminé et son rapport a été généré. Novus attend le prochain.",
    ERROR: "Le connecteur TikTok a rencontré une erreur. Novus réessaie automatiquement toutes les quelques minutes.",
  },
};

export function TikTokIntegration() {
  const t = useT();
  const lang = useLang();
  const status = useStore((s) => s.tiktok);
  const [username, setUsername] = useState(status?.username ?? "");

  useEffect(() => {
    api
      .tiktok()
      .then((s) => setState({ tiktok: s }))
      .catch(() => undefined);
  }, []);

  if (!status) return <div className="card muted">…</div>;

  const connect = async () => {
    try {
      const s = await api.tiktokConnect(username);
      setState({ tiktok: s });
      toast(`@${s.username}`, "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.code : "Error", "warn");
    }
  };
  const disconnect = async () => {
    const s = await api.tiktokDisconnect();
    setState({ tiktok: s });
    setUsername("");
  };

  const tone = status.state === "LIVE_DETECTED" || status.state === "CONNECTED" ? "good" : status.state === "ERROR" ? "bad" : status.state === "CONNECTOR_AVAILABLE" ? "gold" : "";

  return (
    <div className="card">
      <div className="row wrap">
        <span className={`state-badge ${tone}`}>{status.state.replace(/_/g, " ")}</span>
        {status.lastEventAt ? <span className="small muted">last event {ago(status.lastEventAt, Date.now())} ago</span> : null}
      </div>
      <p className="small" style={{ color: "var(--text-2)" }}>
        {status.source === "unofficial_live_connector" ? EXPLAIN_LIVE[lang][status.state] : EXPLAIN[status.state]}
        {status.detail ? <><br /><b style={{ color: "var(--gold)" }}>{status.detail}</b></> : null}
        {status.error ? ` (${status.error})` : ""}
      </p>
      {status.source === "unofficial_live_connector" ? (
        <p className="small muted" style={{ marginTop: 0 }}>
          {lang === "fr"
            ? "Source : connecteur non officiel (lecture seule, sans connexion à ton compte). Non autorisé par TikTok : il peut cesser de fonctionner à tout moment."
            : "Source: unofficial connector (read-only, never logs in). Not authorized by TikTok: it can stop working at any time."}
        </p>
      ) : null}
      <div className="chips" aria-label="Integration states">
        {STATES.map((s) => (
          <span key={s} className={`chip ${s === status.state ? "on" : ""}`} style={{ fontSize: 10.5 }}>
            {s.replace(/_/g, " ")}
          </span>
        ))}
      </div>

      <div className="card-title" style={{ marginTop: 14 }}>
        TikTok account
      </div>
      <div className="row">
        <input className="input" placeholder="@yourhandle" value={username} onChange={(e) => setUsername(e.target.value)} aria-label="TikTok username" autoCapitalize="off" autoCorrect="off" />
        {status.username ? (
          <button className="btn" onClick={disconnect}>
            {t("disconnect")}
          </button>
        ) : (
          <button className="btn gold" onClick={connect} disabled={username.trim().length < 2}>
            {t("connect")}
          </button>
        )}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        {status.source === "unofficial_live_connector"
          ? lang === "fr"
            ? "Novus ne demande jamais ton mot de passe TikTok. Il suit le LIVE public de ce compte ; mute, blocage et signalement restent manuels dans TikTok."
            : "Novus never asks for your TikTok password. It follows this account's public LIVE; mute, block and report stay manual in TikTok."
          : "Novus never asks for your TikTok password and never calls undocumented TikTok endpoints. The account name tells an authorized connector which LIVE to follow."}
      </div>

      <div className="card-title" style={{ marginTop: 14 }}>
        {t("capabilities")}
      </div>
      {status.capabilities.map((c) => (
        <div key={c.capability} className="list-row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.capability}</div>
            <div className="small muted">{c.detail}</div>
          </div>
          <span className={`cap-status ${c.status}`}>{c.status.replace(/_/g, " ").toUpperCase()}</span>
        </div>
      ))}
      <div className="small muted" style={{ marginTop: 8 }}>
        Full details: docs/TIKTOK_INTEGRATION.md
      </div>
    </div>
  );
}
