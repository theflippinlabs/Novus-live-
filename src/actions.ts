import type { ActionType, ModerationAlert } from "../shared/types";
import { api } from "./api";
import { toast, upsertAlert } from "./store";

export async function runAlertAction(alert: ModerationAlert, action: ActionType, lang: "en" | "fr") {
  const res = await api.alertAction(alert.id, action);
  upsertAlert(res.alert);
  const r = res.record;
  if (r.status === "manual_required") toast(lang === "fr" ? "Action manuelle requise dans TikTok" : "Manual action required in TikTok", "warn");
  else if (r.status === "simulated") toast(`${action.toUpperCase()} · ${lang === "fr" ? "simulé (démo)" : "simulated (demo)"}`, "ok");
  else if (r.status === "failed") toast(r.message, "warn");
  else toast(r.message, "ok");
  return res;
}
