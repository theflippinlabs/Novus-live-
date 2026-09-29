import { useState } from "react";
import type { ActionRecord } from "../../shared/types";
import { api, ApiError } from "../api";
import { errorText, useLang, useT } from "../i18n";
import { refreshChatSender } from "../chatSender";
import { useCan } from "../permissions";
import { setState, toast, useStore } from "../store";

/**
 * One-tap "Send in chat" for a suggested warning. Shown only in a followed account's
 * room, during its LIVE, once the moderator connected their TikTok account. Nothing is
 * ever posted without this tap, and a refusal is reported — never shown as sent.
 */
export function SendToChatButton({ record, text, onSent }: { record: ActionRecord; text: string; onSent?: (r: ActionRecord) => void }) {
  const t = useT();
  const lang = useLang();
  const sender = useStore((s) => s.chatSender);
  const room = useStore((s) => s.room);
  const live = useStore((s) => s.session?.status === "live");
  const allowed = useCan("send_chat");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(Boolean(record.sentToChatAt));

  if (!allowed || !sender?.connected || !room.startsWith("tt:") || !live) return null;
  if (sent)
    return (
      <span className="small" style={{ color: "var(--gold)" }}>
        ✓ {t("sentInChat")}
        {"  "}
      </span>
    );

  const send = async () => {
    setBusy(true);
    try {
      const { record: next } = await api.sendToChat(record.id, text);
      setSent(true);
      toast(t("sentInChat"), "ok");
      if (next) onSent?.(next);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "internal_error";
      toast(errorText(code, lang), "warn");
      if (code === "chat_session_expired" || code === "chat_not_connected") void refreshChatSender();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn gold sm" onClick={send} disabled={busy} title={sender.username ? `@${sender.username}` : undefined}>
        {busy ? "…" : `➤ ${t("sendInChat")}`}
      </button>{" "}
    </>
  );
}


const CARD = {
  en: {
    title: "TikTok moderator account",
    connectedAs: (u: string) => `Connected as @${u}`,
    connected: "TikTok account connected",
    connect: "Connect my TikTok account",
    disconnect: "Disconnect",
    confirmDisconnect: "Disconnect your TikTok account from Novus?",
    notConfigured: "Not set up on the server yet (Euler Stream OAuth client missing).",
    how: "Connect the TikTok account you moderate with. A \"Send in chat\" button then appears next to each suggested warning: one tap posts it in the LIVE chat under your name. Nothing is ever sent automatically.",
    risk: "Uses Euler Stream, an unofficial third party (not TikTok). Needs a paid Euler plan and can be limited by TikTok. Reports stay manual.",
    modOn: "Moderation from Novus: on — Mute and Block act directly in the LIVE.",
    modOff: "Moderation from Novus: reconnect this account to allow Mute, Block and turning comments off.",
    reconnect: "Reconnect",
    bulkOff: "Bulk LIVE check: reconnect this account to check 50 streamers per request (divides the Euler quota used by about 50).",
    bulkOn: "Bulk LIVE check: on — followed accounts are checked 50 at a time.",
    modHow: "For Mute / Block / comments to work, this account must be a moderator of each streamer's LIVE (the streamer adds it once in TikTok: LIVE settings › Moderators). Otherwise TikTok refuses and Novus shows the manual steps.",
    lastError: "Last refusal:",
  },
  fr: {
    title: "Compte TikTok modérateur",
    connectedAs: (u: string) => `Connecté en tant que @${u}`,
    connected: "Compte TikTok connecté",
    connect: "Connecter mon compte TikTok",
    disconnect: "Déconnecter",
    confirmDisconnect: "Déconnecter ton compte TikTok de Novus ?",
    notConfigured: "Pas encore configuré sur le serveur (client OAuth Euler Stream manquant).",
    how: "Connecte le compte TikTok avec lequel tu modères. Un bouton « Envoyer dans le chat » apparaît alors à côté de chaque avertissement suggéré : un toucher le publie dans le chat du LIVE à ton nom. Rien n'est jamais envoyé automatiquement.",
    risk: "Passe par Euler Stream, un service tiers non officiel (pas TikTok). Demande un abonnement Euler payant et peut être limité par TikTok. Les signalements restent manuels.",
    modOn: "Modération depuis Novus : activée — Sourdine et Bloquer agissent directement dans le LIVE.",
    modOff: "Modération depuis Novus : reconnecte ce compte pour autoriser la sourdine, le blocage et la coupure des commentaires.",
    reconnect: "Reconnecter",
    bulkOff: "Vérification groupée des LIVE : reconnecte ce compte pour vérifier 50 livers par requête (divise environ par 50 le quota Euler consommé).",
    bulkOn: "Vérification groupée des LIVE : activée — les comptes suivis sont vérifiés 50 par 50.",
    modHow: "Pour que Sourdine / Bloquer / commentaires marchent, ce compte doit être modérateur du LIVE de chaque liver (le liver l'ajoute une fois dans TikTok : réglages du LIVE › Modérateurs). Sinon TikTok refuse et Novus affiche les étapes manuelles.",
    lastError: "Dernier refus :",
  },
};

/** Settings › TikTok: connect the moderator's TikTok account for "Send in chat". */
export function ChatSenderCard() {
  const lang = useLang();
  const tx = CARD[lang];
  const sender = useStore((s) => s.chatSender);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await api.chatSenderConnect();
      window.location.href = url;
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "internal_error", lang), "warn");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(tx.confirmDisconnect)) return;
    setBusy(true);
    try {
      setState({ chatSender: await api.chatSenderDisconnect() });
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "internal_error", lang), "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card-title" style={{ marginTop: 14 }}>
        {tx.title}
      </div>
      {!sender ? (
        <div className="small muted">…</div>
      ) : !sender.configured ? (
        <div className="small muted">{tx.notConfigured}</div>
      ) : sender.connected ? (
        <div className="list-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{sender.username ? tx.connectedAs(sender.username) : tx.connected}</div>
            <div className="small" style={{ color: sender.moderation ? "var(--ok)" : "var(--gold)", marginTop: 2 }}>
              {sender.moderation ? tx.modOn : tx.modOff}
            </div>
            {sender.bulkLiveCheck !== undefined ? (
              <div className="small" style={{ color: sender.bulkLiveCheck ? "var(--ok)" : "var(--gold)", marginTop: 2 }}>
                {sender.bulkLiveCheck ? tx.bulkOn : tx.bulkOff}
              </div>
            ) : null}
            {sender.lastError ? (
              <div className="small" style={{ color: "var(--gold)" }}>
                {tx.lastError} {sender.lastError}
              </div>
            ) : null}
          </div>
          {!sender.moderation || sender.bulkLiveCheck === false ? (
            <button className="btn sm gold" onClick={connect} disabled={busy}>
              {tx.reconnect}
            </button>
          ) : null}
          <button className="btn sm ghost" onClick={disconnect} disabled={busy}>
            {tx.disconnect}
          </button>
        </div>
      ) : (
        <button className="btn gold" onClick={connect} disabled={busy}>
          {busy ? "…" : tx.connect}
        </button>
      )}
      <div className="small muted" style={{ marginTop: 6 }}>
        {tx.how}
        <br />
        {tx.modHow}
        <br />
        {tx.risk}
      </div>
    </>
  );
}
