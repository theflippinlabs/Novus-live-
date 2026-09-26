import { api } from "./api";
import { getState, openSettings, setState, toast } from "./store";

/** Refresh the "Send in chat" connection status (Settings, alert cards). */
export async function refreshChatSender(): Promise<void> {
  try {
    setState({ chatSender: await api.chatSender() });
  } catch {
    /* offline or logged out: keep the last known status */
  }
}

/** After the OAuth round trip the server sends the app back to `/?chat=<result>`. */
export function handleChatSenderReturn(): void {
  const params = new URLSearchParams(window.location.search);
  const result = params.get("chat");
  if (!result) return;
  params.delete("chat");
  const qs = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
  const fr = getState().settings.language === "fr";
  const text: Record<string, [string, string]> = {
    connected: ["TikTok account connected — you can send warnings in chat.", "Compte TikTok connecté — tu peux envoyer les avertissements dans le chat."],
    denied: ["TikTok connection cancelled.", "Connexion TikTok annulée."],
    expired: ["The connection took too long — try again.", "La connexion a pris trop de temps — réessaie."],
    failed: ["TikTok connection failed — try again.", "Échec de la connexion TikTok — réessaie."],
  };
  const [en, frText] = text[result] ?? text.failed;
  toast(fr ? frText : en, result === "connected" ? "ok" : "warn");
  openSettings("tiktok");
}
