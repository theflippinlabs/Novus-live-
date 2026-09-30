import { useEffect } from "react";
import type { CapabilityInfo, ChatSenderStatus, TikTokIntegrationState } from "../../shared/types";
import { api } from "../api";
import { refreshChatSender } from "../chatSender";
import { ChatSenderCard } from "../components/SendToChat";
import { TikTokProfiles } from "../components/TikTokProfiles";
import { useIsFounder } from "../permissions";
import { tiktokStateLabel, tr, useLang, useT } from "../i18n";
import { ago } from "../format";
import { setState, useStore } from "../store";

const STATES: TikTokIntegrationState[] = ["NOT_CONNECTED", "CONNECTOR_AVAILABLE", "CONNECTED", "LIVE_DETECTED", "LIVE_ENDED", "ERROR"];

const EXPLAIN: Record<"en" | "fr", Record<TikTokIntegrationState, string>> = {
  en: {
    NOT_CONNECTED: "No authorized connector is configured on the server (INGEST_TOKEN not set). Demo mode works without it.",
    CONNECTOR_AVAILABLE: "The ingestion endpoint is enabled. Waiting for an authorized TikTok LIVE connector to send events.",
    CONNECTED: "A connector is sending heartbeats/events. No LIVE activity detected yet.",
    LIVE_DETECTED: "LIVE events are flowing into Novus in real time.",
    LIVE_ENDED: "The connector reported that the LIVE ended. A post-LIVE report was generated.",
    ERROR: "The connector sent invalid data or failed. Check the connector logs.",
  },
  fr: {
    NOT_CONNECTED: "Aucun connecteur autorisé n'est configuré sur le serveur (INGEST_TOKEN absent). Le mode démo fonctionne sans.",
    CONNECTOR_AVAILABLE: "Le point de réception est actif. En attente d'un connecteur TikTok LIVE autorisé qui envoie des événements.",
    CONNECTED: "Un connecteur envoie des signaux/événements. Aucune activité de LIVE détectée pour l'instant.",
    LIVE_DETECTED: "Les événements du LIVE arrivent dans Novus en temps réel.",
    LIVE_ENDED: "Le connecteur a signalé la fin du LIVE. Un rapport post-LIVE a été généré.",
    ERROR: "Le connecteur a envoyé des données invalides ou a échoué. Vérifie les journaux du connecteur.",
  },
};

const CAP_STATUS: Record<string, { en: string; fr: string }> = {
  implemented: { en: "IMPLEMENTED", fr: "EN PLACE" },
  requires_authorized_connector: { en: "NEEDS AUTHORIZED CONNECTOR", fr: "CONNECTEUR AUTORISÉ REQUIS" },
  manual_only: { en: "MANUAL ONLY", fr: "MANUEL UNIQUEMENT" },
  not_available: { en: "NOT AVAILABLE", fr: "INDISPONIBLE" },
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

/** With the moderator account connected (Euler), warn / mute / block run from Novus. */
function withModeratorAccount(caps: CapabilityInfo[], chat: ChatSenderStatus | null | undefined, lang: "en" | "fr"): CapabilityInfo[] {
  if (!chat?.connected) return caps;
  const fr = lang === "fr";
  return caps.map((c) => {
    if (c.capability === "Warn a viewer")
      return { ...c, status: "implemented", detail: fr ? "Un appui envoie l'avertissement dans le chat du LIVE depuis ton compte modérateur. Rien n'est envoyé automatiquement." : "One tap posts the warning in the LIVE chat from your moderator account. Nothing is sent automatically." };
    if (chat.moderation && (c.capability === "Mute a viewer" || c.capability === "Block / remove a viewer"))
      return { ...c, status: "implemented", detail: fr ? "Le bouton agit directement dans le LIVE si ton compte est modérateur de ce LIVE ; sinon TikTok refuse et Novus affiche les étapes manuelles." : "The button acts directly in the LIVE when your account is a moderator of that LIVE; otherwise TikTok refuses and Novus shows the manual steps." };
    return c;
  });
}

export function TikTokIntegration() {
  const t = useT();
  const lang = useLang();
  const status = useStore((s) => s.tiktok);
  const founder = useIsFounder();
  const chat = useStore((s) => s.chatSender);

  useEffect(() => {
    api
      .tiktok()
      .then((s) => setState({ tiktok: s }))
      .catch(() => undefined);
    void refreshChatSender();
  }, []);

  if (!status) return <div className="card muted">…</div>;

  const tone = status.state === "LIVE_DETECTED" || status.state === "CONNECTED" ? "good" : status.state === "ERROR" ? "bad" : status.state === "CONNECTOR_AVAILABLE" ? "gold" : "";

  return (
    <div className="card">
      <div className="row wrap">
        <span className={`state-badge ${tone}`}>{tiktokStateLabel(status.state, lang)}</span>
        {status.lastEventAt ? <span className="small muted">{t("lastEvent").replace("{ago}", ago(status.lastEventAt, Date.now()))}</span> : null}
      </div>
      <p className="small" style={{ color: "var(--text-2)" }}>
        {status.source === "unofficial_live_connector" ? EXPLAIN_LIVE[lang][status.state] : EXPLAIN[lang][status.state]}
        {status.detail ? <><br /><b style={{ color: "var(--gold)" }}>{tr(status.detail, lang)}</b></> : null}
        {status.error ? ` (${tr(status.error, lang)})` : ""}
      </p>
      {status.source === "unofficial_live_connector" ? (
        <p className="small muted" style={{ marginTop: 0 }}>
          {lang === "fr"
            ? "Source : connecteur non officiel (lecture seule, sans connexion à ton compte). Non autorisé par TikTok : il peut cesser de fonctionner à tout moment."
            : "Source: unofficial connector (read-only, never logs in). Not authorized by TikTok: it can stop working at any time."}
        </p>
      ) : null}
      <div className="chips" aria-label={t("integrationStates")}>
        {STATES.map((s) => (
          <span key={s} className={`chip ${s === status.state ? "on" : ""}`} style={{ fontSize: 10.5 }}>
            {tiktokStateLabel(s, lang)}
          </span>
        ))}
      </div>

      <TikTokProfiles />
      {founder ? <ChatSenderCard /> : null}
      <div className="small muted" style={{ marginTop: 6 }}>
        {status.source === "unofficial_live_connector" && chat?.connected && chat.moderation
          ? lang === "fr"
            ? "Novus ne demande jamais ton mot de passe TikTok. Avertir, mettre en sourdine et bloquer passent par ton compte modérateur connecté ; le signalement reste manuel dans TikTok."
            : "Novus never asks for your TikTok password. Warn, mute and block go through your connected moderator account; reporting stays manual in TikTok."
          : status.source === "unofficial_live_connector"
          ? lang === "fr"
            ? "Novus ne demande jamais ton mot de passe TikTok. Il suit le LIVE public de ce compte ; mute, blocage et signalement restent manuels dans TikTok."
            : "Novus never asks for your TikTok password. It follows this account's public LIVE; mute, block and report stay manual in TikTok."
          : lang === "fr"
            ? "Novus ne demande jamais ton mot de passe TikTok et n'appelle aucun point d'accès TikTok non documenté. Le nom du compte indique à un connecteur autorisé quel LIVE suivre."
            : "Novus never asks for your TikTok password and never calls undocumented TikTok endpoints. The account name tells an authorized connector which LIVE to follow."}
      </div>

      <div className="card-title" style={{ marginTop: 14 }}>
        {t("capabilities")}
      </div>
      {withModeratorAccount(status.capabilities, chat, lang).map((c) => (
        <div key={c.capability} className="list-row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{tr(c.capability, lang)}</div>
            <div className="small muted">{tr(c.detail, lang)}</div>
          </div>
          <span className={`cap-status ${c.status}`}>{CAP_STATUS[c.status]?.[lang] ?? c.status.replace(/_/g, " ").toUpperCase()}</span>
        </div>
      ))}
      <div className="small muted" style={{ marginTop: 8 }}>
        {t("fullDetails")} docs/TIKTOK_INTEGRATION.md
      </div>
    </div>
  );
}
