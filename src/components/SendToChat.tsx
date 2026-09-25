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
    title: "Send in chat",
    connectedAs: (u: string) => `Connected as @${u}`,
    connected: "TikTok account connected",
    connect: "Connect my TikTok account",
    disconnect: "Disconnect",
    confirmDisconnect: "Disconnect your TikTok account from Novus?",
    notConfigured: "Not set up on the server yet (Euler Stream OAuth client missing).",
    how: "Connect the TikTok account you moderate with. A \"Send in chat\" button then appears next to each suggested warning: one tap posts it in the LIVE chat under your name. Nothing is ever sent automatically.",
    risk: "Uses Euler Stream, an unofficial third party (not TikTok). Sending needs a paid Euler plan and can be limited by TikTok. Mute, block and report stay manual.",
    lastError: "Last refusal:",
  },
  fr: {
    title: "Envoyer dans le chat",
    connectedAs: (u: string) => `Connecté en tant que @${u}`,
    connected: "Compte TikTok connecté",
    connect: "Connecter mon compte TikTok",
    disconnect: "Déconnecter",
    confirmDisconnect: "Déconnecter ton compte TikTok de Novus ?",
    notConfigured: "Pas encore configuré sur le serveur (client OAuth Euler Stream manquant).",
    how: "Connecte le compte TikTok avec lequel tu modères. Un bouton « Envoyer dans le chat » apparaît alors à côté de chaque avertissement suggéré : un toucher le publie dans le chat du LIVE à ton nom. Rien n'est jamais envoyé automatiquement.",
    risk: "Passe par Euler Stream, un service tiers non officiel (pas TikTok). L'envoi demande un abonnement Euler payant et peut être limité par TikTok. Mute, blocage et signalement restent manuels.",
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
            {sender.lastError ? (
              <div className="small" style={{ color: "var(--gold)" }}>
                {tx.lastError} {sender.lastError}
              </div>
            ) : null}
          </div>
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
        {tx.risk}
      </div>
    </>
  );
}
