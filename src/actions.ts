import type { ActionType, ModerationAlert } from "../shared/types";
import { api, type MuteSeconds } from "./api";
import { actionCopy, actionLabel } from "./i18n";
import { toast, upsertAlert } from "./store";

export async function runAlertAction(alert: ModerationAlert, action: ActionType, lang: "en" | "fr", muteSeconds?: MuteSeconds) {
  const res = await api.alertAction(alert.id, action, undefined, muteSeconds);
  upsertAlert(res.alert);
  const r = res.record;
  if (r.status === "manual_required") toast(lang === "fr" ? "Action manuelle requise dans TikTok" : "Manual action required in TikTok", "warn");
  else if (r.status === "simulated") toast(`${actionLabel(action, lang)} · ${lang === "fr" ? "simulé (démo)" : "simulated (demo)"}`, "ok");
  else if (r.status === "failed") toast(actionCopy(r, lang).message, "warn");
  else toast(actionCopy(r, lang).message, "ok");
  return res;
}

/** Mute lengths offered when Novus mutes directly in TikTok. */
export const MUTE_CHOICES: { s: MuteSeconds; en: string; fr: string }[] = [
  { s: 30, en: "30 s", fr: "30 s" },
  { s: 60, en: "1 min", fr: "1 min" },
  { s: 300, en: "5 min", fr: "5 min" },
  { s: -1, en: "Until unmuted", fr: "Jusqu'à nouvel ordre" },
];

/** Mute and Block run from Novus: the moderator account is connected with moderation, on a followed account's room. */
export const directModeration = (sender: { moderation?: boolean } | null | undefined, room: string) => Boolean(sender?.moderation) && room.startsWith("tt:");
