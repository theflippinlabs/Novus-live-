import { useState } from "react";
import { api, ApiError } from "../api";
import { errorText, useLang } from "../i18n";
import { toast } from "../store";

/** Turn the LIVE's comments off during a raid, and back on (as the connected moderator account). */
export function CommentsSwitch({ block }: { block?: boolean }) {
  const lang = useLang();
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const fr = lang === "fr";
  const toggle = async () => {
    const next = !off;
    if (next && !window.confirm(fr ? "Couper les commentaires du LIVE pour tout le monde ?" : "Turn the LIVE's comments off for everyone?")) return;
    setBusy(true);
    try {
      await api.setComments(!next);
      setOff(next);
      toast(next ? (fr ? "Commentaires coupés dans TikTok" : "Comments turned off in TikTok") : fr ? "Commentaires rouverts" : "Comments back on", "ok");
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "internal_error", lang), "warn");
    } finally {
      setBusy(false);
    }
  };
  const label = off ? (fr ? "Rouvrir le chat" : "Reopen chat") : fr ? "Couper le chat" : "Turn chat off";
  return (
    <button className={`btn ${block ? "block" : "sm"} ${off ? "gold" : block ? "" : "ghost"}`} onClick={() => void toggle()} disabled={busy} title={label} aria-pressed={off}>
      {busy ? "…" : `${off ? "▶" : "⏸"} ${label}`}
    </button>
  );
}
