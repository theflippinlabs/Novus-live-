import type { Permission, TeamRole } from "../shared/types";
import { api } from "./api";
import { getState, setState, useStore, visible } from "./store";

/** Load who is logged in (founder or team member). */
export async function loadMe(): Promise<void> {
  try {
    setState({ me: await api.me() });
    setState({ rooms: visible(getState().rooms) });
  } catch {
    /* offline: keep the last known */
  }
}

/** Whether the logged-in person may do this (the server checks it too). */
export function useCan(perm: Permission): boolean {
  return useStore((s) => !s.me || s.me.permissions.includes(perm));
}

export function useIsFounder(): boolean {
  return useStore((s) => !s.me || s.me.kind === "founder");
}

/** Streamers this person is limited to (null = all). */
export function useScope(): string[] | null {
  return useStore((s) => s.me?.accounts ?? null);
}

export const PERM_LABEL: Record<Permission, { en: string; fr: string; hintEn: string; hintFr: string }> = {
  moderate: { en: "Moderate", fr: "Modérer", hintEn: "Act on alerts and viewers (warn, mute…)", hintFr: "Agir sur les alertes et les spectateurs (avertir, mute…)" },
  send_chat: { en: "Send in chat", fr: "Envoyer dans le chat", hintEn: "Post suggested warnings with the connected TikTok account", hintFr: "Publier les avertissements avec le compte TikTok connecté" },
  manage_accounts: { en: "Manage streamers", fr: "Gérer les livers", hintEn: "Follow/unfollow, groups, auto/manual, recording", hintFr: "Suivre/retirer, groupes, auto/manuel, enregistrement" },
  settings: { en: "Moderation settings", fr: "Réglages de modération", hintEn: "Sensitivity, banned words, trusted users, AI", hintFr: "Sensibilité, mots interdits, utilisateurs de confiance, IA" },
  history: { en: "History & exports", fr: "Historique & exports", hintEn: "Past LIVEs, PDF reports, conversations", hintFr: "LIVE passés, rapports PDF, conversations" },
  team: { en: "Manage the team", fr: "Gérer l'équipe", hintEn: "Add members (never with more rights than their own)", hintFr: "Ajouter des membres (jamais avec plus de droits que les siens)" },
};

export const ROLE_LABEL: Record<TeamRole, { en: string; fr: string }> = {
  director: { en: "Director", fr: "Directeur" },
  manager: { en: "Manager", fr: "Manager" },
  moderator: { en: "Moderator", fr: "Modérateur" },
};
