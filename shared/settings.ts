import { CATEGORIES, type Category, type Sensitivity, type Settings, type Thresholds } from "./types";

export const PRESET_THRESHOLDS: Record<Exclude<Sensitivity, "custom">, Thresholds> = {
  low: { watch: 35, warning: 60, critical: 85 },
  balanced: { watch: 25, warning: 50, critical: 75 },
  strict: { watch: 15, warning: 38, critical: 65 },
};

export function thresholdsFor(settings: Pick<Settings, "sensitivity" | "customThresholds">): Thresholds {
  return settings.sensitivity === "custom" ? settings.customThresholds : PRESET_THRESHOLDS[settings.sensitivity];
}

export function defaultSettings(): Settings {
  return {
    sensitivity: "balanced",
    customThresholds: { ...PRESET_THRESHOLDS.balanced },
    categories: Object.fromEntries(CATEGORIES.map((c) => [c, true])) as Record<Category, boolean>,
    bannedPhrases: [],
    trustedUsers: [],
    watchlist: [],
    language: "en",
    streamerName: "novarys",
    aiEnabled: true,
    tiktokUsername: "",
    tiktokProfiles: [],
  };
}

export const CATEGORY_LABELS: Record<Category, { en: string; fr: string }> = {
  spam: { en: "Spam", fr: "Spam" },
  flooding: { en: "Flooding", fr: "Flood" },
  repetition: { en: "Repeated messages", fr: "Messages répétés" },
  insult: { en: "Insult", fr: "Insulte" },
  harassment: { en: "Targeted harassment", fr: "Harcèlement ciblé" },
  threat: { en: "Threat", fr: "Menace" },
  hate: { en: "Hate / abusive", fr: "Haine / abus" },
  sexual_harassment: { en: "Sexual harassment", fr: "Harcèlement sexuel" },
  scam: { en: "Scam", fr: "Arnaque" },
  suspicious_link: { en: "Suspicious link", fr: "Lien suspect" },
  impersonation: { en: "Impersonation", fr: "Usurpation" },
  doxxing: { en: "Personal info / doxxing", fr: "Infos perso / doxxing" },
  coordinated_attack: { en: "Coordinated attack", fr: "Attaque coordonnée" },
  escalation: { en: "Escalation", fr: "Escalade" },
  banned_phrase: { en: "Banned phrase", fr: "Expression interdite" },
};
