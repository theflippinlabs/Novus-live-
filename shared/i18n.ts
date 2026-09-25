import type { Category, Severity, ViewerFlag } from "./types";

/*
 * Server-side text is produced once, in English (the canonical form stored in the
 * database), and translated where it is displayed. This keeps history, alerts and
 * exports readable in either language, whatever language was active when they were
 * created. Unknown strings (user content, AI text) pass through unchanged.
 */

export type Lang = "en" | "fr";
export interface Localized {
  en: string;
  fr: string;
}

/** Exact English → French pairs for fixed server strings. */
const FR: Record<string, string> = {
  // Session titles
  "Demo LIVE": "LIVE de démo",
  "TikTok LIVE": "LIVE TikTok",
  "External LIVE": "LIVE externe",
  // Moderation reasons (patterns.ts)
  "Claims official identity": "Se fait passer pour un compte officiel",
  "Death threat": "Menace de mort",
  "Exposes identity": "Révèle une identité",
  "Free-reward scam": "Arnaque aux récompenses gratuites",
  "Giveaway bait": "Faux concours",
  "Hateful / dehumanizing": "Haineux / déshumanisant",
  "Hostile dismissal": "Rejet hostile",
  "Insult (FR)": "Insulte (FR)",
  Insult: "Insulte",
  "Investment scam": "Arnaque à l'investissement",
  "Location threat": "Menace de localisation",
  "Off-platform lure": "Incitation à quitter TikTok",
  "Requests personal info (FR)": "Demande d'infos perso (FR)",
  "Requests personal info": "Demande d'infos perso",
  "Self-harm encouragement": "Incitation à l'automutilation",
  "Self-promotion": "Autopromotion",
  "Selling in chat": "Vente dans le chat",
  "Moves viewers to DMs": "Attire vers les messages privés",
  "Sexual harassment": "Harcèlement sexuel",
  "Sexualized remark": "Remarque sexualisée",
  "Shares a phone number": "Partage un numéro de téléphone",
  "Shares an address": "Partage une adresse",
  "Shares an email": "Partage un e-mail",
  "Targeted harassment": "Harcèlement ciblé",
  "Targeted threat (FR)": "Menace ciblée (FR)",
  "Targeted threat": "Menace ciblée",
  // Moderation reasons (heuristics.ts / runtime)
  "Threat with personal info": "Menace avec infos perso",
  "Directed at someone": "Visant une personne",
  "Shortened link": "Lien raccourci",
  "Contains link": "Contient un lien",
  "Scam with link": "Arnaque avec lien",
  "Look-alike of streamer account": "Imite le compte du streamer",
  "Asks for gifts/money": "Demande des cadeaux / de l'argent",
  "Official-sounding username": "Pseudo à l'air officiel",
  "Excessive caps": "Majuscules excessives",
  "Emoji flood": "Flood d'emojis",
  "Character flood": "Flood de caractères",
  "Repeated promotion": "Promotion répétée",
  "Copy-paste message": "Message copié-collé",
  "Raid language": "Vocabulaire de raid",
  "Escalating over time": "Escalade dans le temps",
  "Re-offending after warning": "Récidive après avertissement",
  "Context: likely harmless": "Contexte : sans doute inoffensif",
  "Context reviewed by AI": "Contexte vérifié par l'IA",
  // Assistant: important messages & sentiment
  "First-time viewer": "Première visite",
  "Mentions the streamer": "Mentionne le streamer",
  "Thoughtful supportive message": "Message de soutien réfléchi",
  "Big gift": "Gros cadeau",
  "Very positive": "Très positive",
  Positive: "Positive",
  Hostile: "Hostile",
  Tense: "Tendue",
  Neutral: "Neutre",
  "Sudden negative shift": "Bascule négative soudaine",
  "Mood lifting fast": "L'ambiance remonte vite",
  // Trending topic labels
  "Release date": "Date de sortie",
  "New application": "Nouvelle application",
  Pricing: "Prix",
  "Beta access": "Accès bêta",
  Features: "Fonctionnalités",
  // TikTok capabilities
  "Normalized event model (comments, viewers, gifts, follows, joins)": "Modèle d'événements unifié (commentaires, spectateurs, cadeaux, abonnements, arrivées)",
  "LiveEvent types + validation; TikTok data enters only through this model.": "Types LiveEvent + validation ; les données TikTok n'entrent que par ce modèle.",
  "Authorized connector ingestion (POST /api/ingest/events)": "Réception d'un connecteur autorisé (POST /api/ingest/events)",
  "Token-protected, rate-limited, validated. Any approved TikTok LIVE source can push events here.": "Protégé par jeton, limité en débit, validé. Toute source TikTok LIVE approuvée peut envoyer des événements ici.",
  "Connection/live state tracking": "Suivi de la connexion et du LIVE",
  "NOT CONNECTED → CONNECTOR AVAILABLE → CONNECTED → LIVE DETECTED → LIVE ENDED / ERROR.": "NON CONNECTÉ → CONNECTEUR DISPONIBLE → CONNECTÉ → LIVE DÉTECTÉ → LIVE TERMINÉ / ERREUR.",
  "Reading LIVE comments directly from TikTok": "Lecture des commentaires du LIVE directement depuis TikTok",
  "No public documented TikTok API used. Requires approved TikTok access implemented as a TikTokEventSource.": "Aucune API TikTok publique documentée utilisée. Nécessite un accès TikTok approuvé, implémenté comme TikTokEventSource.",
  "Warn a viewer": "Avertir un spectateur",
  "Novus prepares the exact message; the moderator posts it in TikTok.": "Novus prépare le message exact ; le modérateur le publie dans TikTok.",
  "Mute a viewer": "Mettre un spectateur en sourdine",
  "Moderator mutes in the TikTok app; Novus gives exact steps and logs the resolution.": "Le modérateur met en sourdine dans l'app TikTok ; Novus donne les étapes exactes et enregistre la résolution.",
  "Block / remove a viewer": "Bloquer / retirer un spectateur",
  "Moderator blocks in the TikTok app; Novus gives exact steps and logs the resolution.": "Le modérateur bloque dans l'app TikTok ; Novus donne les étapes exactes et enregistre la résolution.",
  "Report a viewer": "Signaler un spectateur",
  "Moderator reports in the TikTok app; Novus suggests the category.": "Le modérateur signale dans l'app TikTok ; Novus suggère la catégorie.",
  "Automated platform actions": "Actions automatiques sur la plateforme",
  "Would require an authorized TikTok moderation API. Plug in via ModerationActionAdapter.": "Nécessiterait une API de modération TikTok autorisée. À brancher via ModerationActionAdapter.",
  "Reading LIVE comments, gifts, joins, follows, viewer count": "Lecture des commentaires, cadeaux, arrivées, abonnements et du nombre de spectateurs",
  "Via the UNOFFICIAL tiktok-live-connector library (read-only, no login). Not authorized by TikTok: it can break at any time and may conflict with TikTok's Terms.":
    "Via la bibliothèque NON OFFICIELLE tiktok-live-connector (lecture seule, sans connexion). Non autorisée par TikTok : elle peut cesser de fonctionner à tout moment et peut contrevenir aux conditions de TikTok.",
  // TikTok connection errors
  "Connector sent invalid events": "Le connecteur a envoyé des événements invalides",
  "Connector heartbeat lost": "Signal du connecteur perdu",
  "TikTok source failed": "La source TikTok a échoué",
  "Failed to retrieve Room ID from all sources.": "Impossible de trouver le LIVE (identifiant de salle introuvable).",
  "Error while connecting": "Erreur de connexion",
};

/** Parameterized strings: English pattern → French builder. */
const FR_PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^Banned phrase “(.+)”$/, (p) => `Expression interdite « ${p} »`],
  [/^Flooding (\d+) msgs\/10s$/, (n) => `Flood : ${n} messages en 10 s`],
  [/^Repeated (\d+)x$/, (n) => `Répété ${n} fois`],
  [/^Coordinated burst \((\d+) accounts\)$/, (n) => `Rafale coordonnée (${n} comptes)`],
  [/^Pile-on \((\d+) hostile accounts\)$/, (n) => `Acharnement (${n} comptes hostiles)`],
  [/^Repeated hostility \((\d+)x\)$/, (n) => `Hostilité répétée (${n} fois)`],
  [/^sent (\d+)× (.+)$/, (n, g) => `a envoyé ${n}× ${g}`],
  [/^Waiting for @(.+) to go LIVE$/, (u) => `En attente du LIVE de @${u}`],
  [/^Checking that @(.+) is really LIVE…$/, (u) => `Vérification que @${u} est vraiment en LIVE…`],
  [/^@(.+) is LIVE — recording is manual$/, (u) => `@${u} est en LIVE — enregistrement manuel`],
  [/^TikTok connector unavailable: (.+)$/, (e) => `Connecteur TikTok indisponible : ${e}`],
];

/** Words for alert/action states and severities, as shown to people. */
const WORDS: Record<string, Localized> = {
  open: { en: "open", fr: "ouverte" },
  watching: { en: "watching", fr: "surveillée" },
  resolved: { en: "resolved", fr: "résolue" },
  dismissed: { en: "dismissed", fr: "ignorée" },
  normal: { en: "normal", fr: "normal" },
  watch: { en: "watch", fr: "surveiller" },
  warning: { en: "warning", fr: "avertissement" },
  critical: { en: "critical", fr: "critique" },
  none: { en: "none", fr: "aucune" },
  warn: { en: "warn", fr: "avertir" },
  mute: { en: "mute", fr: "sourdine" },
  block: { en: "block", fr: "bloquer" },
  report: { en: "report", fr: "signaler" },
  dismiss: { en: "dismiss", fr: "ignorer" },
  executed: { en: "executed", fr: "exécutée" },
  simulated: { en: "simulated", fr: "simulée" },
  manual_required: { en: "manual action required", fr: "action manuelle requise" },
  recorded: { en: "recorded", fr: "enregistrée" },
  failed: { en: "failed", fr: "échec" },
};

/** Translate a state/severity/action keyword (e.g. "manual_required", "critical"). */
export function word(key: string, lang: Lang): string {
  return WORDS[key]?.[lang] ?? key.replace(/_/g, " ");
}

/** Translate a fixed server string (reason, label, status) for display. */
export function tr(text: string, lang: Lang): string {
  if (lang === "en" || !text) return text;
  const exact = FR[text];
  if (exact) return exact;
  for (const [re, build] of FR_PATTERNS) {
    const m = re.exec(text);
    if (m) return build(...m.slice(1));
  }
  return text;
}

// ---------------------------------------------------------------- heuristic explanations

const PHRASES: Record<Category, Localized> = {
  threat: { en: "contains a targeted threat", fr: "contient une menace ciblée" },
  doxxing: { en: "involves personal information (address, phone, identity)", fr: "implique des informations personnelles (adresse, téléphone, identité)" },
  sexual_harassment: { en: "is sexual harassment", fr: "relève du harcèlement sexuel" },
  hate: { en: "uses hateful or dehumanizing language", fr: "emploie un langage haineux ou déshumanisant" },
  harassment: { en: "is hostility aimed at a person", fr: "est une hostilité visant une personne" },
  insult: { en: "contains an insult", fr: "contient une insulte" },
  scam: { en: "looks like a scam", fr: "ressemble à une arnaque" },
  suspicious_link: { en: "includes a suspicious link", fr: "contient un lien suspect" },
  impersonation: { en: "may be impersonating the streamer or staff", fr: "usurpe peut-être l'identité du streamer ou de l'équipe" },
  spam: { en: "is spam / self-promotion", fr: "est du spam / de l'autopromotion" },
  flooding: { en: "is flooding the chat", fr: "inonde le chat" },
  repetition: { en: "repeats the same message", fr: "répète le même message" },
  coordinated_attack: { en: "is part of a coordinated burst across accounts", fr: "fait partie d'une rafale coordonnée entre plusieurs comptes" },
  escalation: { en: "shows hostility escalating over time", fr: "montre une hostilité qui s'intensifie" },
  banned_phrase: { en: "uses a banned phrase", fr: "utilise une expression interdite" },
};

// Priority order for the sentence: most serious first.
const PHRASE_ORDER: Category[] = [
  "threat",
  "doxxing",
  "sexual_harassment",
  "hate",
  "scam",
  "impersonation",
  "harassment",
  "coordinated_attack",
  "escalation",
  "insult",
  "banned_phrase",
  "suspicious_link",
  "flooding",
  "repetition",
  "spam",
];

/** One-sentence explanation of a stage-1 verdict, in both languages. */
export function explainI18n(categories: Category[], severity: Severity, flag: ViewerFlag | null): Localized {
  const build = (lang: Lang): string => {
    if (categories.length === 0) return lang === "fr" ? "Aucun signal de risque détecté." : "No risk signals detected.";
    const parts = PHRASE_ORDER.filter((c) => categories.includes(c))
      .slice(0, 3)
      .map((c) => PHRASES[c][lang]);
    const and = lang === "fr" ? "et" : "and";
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} ${and} ${parts[parts.length - 1]}` : parts[0];
    const lead = lang === "fr" ? (severity === "normal" ? "Signal mineur : le message" : "Le message") : severity === "normal" ? "Minor signal: message" : "Message";
    let out = `${lead} ${list}.`;
    if (flag === "trusted") out += lang === "fr" ? " Spectateur de confiance : des preuves plus fortes étaient nécessaires." : " Viewer is trusted, so stronger evidence was required.";
    if (flag === "watchlist") out += lang === "fr" ? " Spectateur sous surveillance." : " Viewer is on the watchlist.";
    return out;
  };
  return { en: build("en"), fr: build("fr") };
}

/** Pick the right language of a text that may carry both. */
export function pick(text: string, i18n: Partial<Localized> | undefined, lang: Lang): string {
  return i18n?.[lang] || text;
}
