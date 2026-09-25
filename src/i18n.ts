import { pick, tr, word } from "../shared/i18n";
import { CATEGORY_LABELS } from "../shared/settings";
import type { ActionCopy, ActionRecord, ActionType, Category, Severity, TikTokIntegrationState } from "../shared/types";
import { api } from "./api";
import { getState, setState, useStore } from "./store";

export { pick, tr, word };

const en = {
  live: "Live",
  alerts: "Alerts",
  viewers: "Viewers",
  assistant: "Assistant",
  analytics: "Analytics",
  settings: "Settings",
  statusLive: "LIVE",
  statusIdle: "OFFLINE",
  waitingForLive: "WAITING FOR YOUR LIVE",
  waitingForLiveHint: "Nothing to do here: start your LIVE in the TikTok app. Novus checks every minute and joins automatically — comments and alerts will appear on this screen.",
  tiktokRetrying: "TIKTOK UNREACHABLE — RETRYING",
  tiktokRetryingHint: "Novus could not reach TikTok and retries automatically every few minutes.",
  followAccountHint: "Enter your TikTok account in Settings › TikTok Integration so Novus joins your LIVE automatically.",
  demoTitle: "Simulation (demo)",
  statusWaiting: "WAITING",
  statusEnded: "ENDED",
  msgMin: "msg/min",
  viewersShort: "viewers",
  chatters: "active",
  aiActive: "AI active",
  aiLocal: "Local AI",
  aiDisabled: "AI off",
  aiDegraded: "AI degraded",
  startDemo: "START DEMO LIVE",
  startDemoHint: "Realistic chat traffic with spam, harassment, scams, doxxing and a coordinated raid — no TikTok credentials needed.",
  speed: "Traffic speed",
  endLive: "End LIVE",
  noSession: "No LIVE running",
  waitingConnector: "Waiting for an authorized TikTok connector — see Settings › TikTok Integration.",
  flaggedOnly: "Flagged",
  allMessages: "All",
  newMessages: "new messages",
  jumpLatest: "Jump to latest",
  emptyChat: "Chat messages will stream here.",
  open: "Open",
  watching: "Watching",
  resolved: "Resolved",
  dismissed: "Dismissed",
  all: "All",
  recommended: "Recommended",
  risk: "Risk",
  reasons: "Reasons",
  noAlerts: "No alerts. Novus is watching the chat.",
  manualRequired: "MANUAL ACTION REQUIRED",
  doneInTikTok: "Done in TikTok",
  copyMessage: "Copy message",
  copied: "Copied",
  sendInChat: "Send in chat",
  sentInChat: "Sent in chat",
  simulated: "Simulated on demo platform",
  confirmed: "Confirmed",
  accounts: "accounts",
  more: "more",
  firstSeen: "First seen",
  messages: "Messages",
  warnings: "Warnings",
  prevAlerts: "Alerts",
  riskTrend: "Risk trend",
  recentComments: "Recent comments",
  modHistory: "Moderation history",
  categoriesDetected: "Categories detected",
  assessment: "Current Novus assessment",
  trusted: "Trusted",
  watchlist: "Watchlist",
  ignored: "Ignored",
  none: "None",
  searchViewers: "Search @username",
  sortRisk: "Risk",
  sortMessages: "Messages",
  sortRecent: "Recent",
  flagged: "Flagged",
  noViewers: "No viewers yet.",
  catchUp: "CATCH ME UP",
  catchUpHint: "Everything important since you last checked",
  chatPulse: "CHAT PULSE",
  trending: "Trending",
  topUnanswered: "Top unanswered question",
  questions: "Questions",
  requests: "Repeated requests",
  sentiment: "Sentiment",
  important: "Important messages",
  spikes: "Activity spikes",
  needAttention: "viewers require moderator attention",
  markAnswered: "Answered",
  reopen: "Reopen",
  activity: "activity",
  totalMessages: "Total messages",
  uniqueChatters: "Unique chatters",
  peak: "Peak activity",
  muteRecs: "Mute recs",
  blockRecs: "Block recs",
  responseTime: "Avg response",
  msgPerMinute: "Messages per minute",
  toxicityTrend: "Toxicity trend (% flagged)",
  topParticipants: "Top participants",
  topQuestions: "Top questions",
  topTopics: "Top topics",
  categories: "Detected categories",
  report: "Post-LIVE report",
  sensitivity: "Moderation sensitivity",
  custom: "Custom",
  thresholds: "Custom thresholds",
  detection: "Detection categories",
  bannedPhrases: "Banned phrases",
  trustedUsers: "Trusted users",
  add: "Add",
  language: "Language",
  streamer: "Streamer handle",
  aiAnalysis: "Contextual AI (stage 2)",
  tiktokIntegration: "TikTok Integration",
  install: "Install on iPhone",
  installHint: "In Safari: Share → Add to Home Screen. Novus opens full-screen next to TikTok.",
  save: "Save",
  saved: "Saved",
  logout: "Log out",
  connect: "Connect",
  disconnect: "Disconnect",
  capabilities: "Capabilities",
  reconnecting: "Reconnecting…",
  loginTitle: "Access key",
  loginHint: "Enter your Novus Live access code (founder or team member).",
  noAccount: "No account yet? See plans and start a free trial →",
  login: "Unlock",
  duration: "Duration",
  durationShort: "Time",
  table: "Table",
  chart: "Chart",
  actions: "Actions",
  aiLocalHint: "Deterministic local moderation",
  aiLocalTitle: "Local deterministic moderation",
  aiLocalHint2: "No ANTHROPIC_API_KEY on the server — stage 1 heuristics handle everything.",
  aiReviewHint: "Only suspicious or ambiguous messages are sent for contextual review. Reviewed: {n}.",
  alertFilter: "Alert filter",
  alertsAria: "{open} open alerts, {critical} critical",
  bannedPlaceholder: "e.g. spoiler",
  catchUpFailed: "Catch-up failed",
  chatLabel: "Live chat",
  colAvgRisk: "Avg risk",
  colMessages: "Msgs",
  colMinute: "Min",
  colToxic: "Toxic %",
  demoStartFailed: "Could not start the demo",
  displayLabel: "Display",
  ecosystem: "Part of the Novarys / Pulse Engine ecosystem",
  endShort: "END",
  filterLabel: "Filter",
  fullDetails: "Full details:",
  integrationStates: "Integration states",
  invalidKey: "Invalid key",
  languageHint: "Chat languages are detected automatically (EN, FR, ES, DE, PT, IT, AR, RU, JA, KO, ZH…). The switch at the top of the screen changes the language too.",
  lastError: "Last error:",
  lastEvent: "last event {ago} ago",
  mainNav: "Main",
  manual: "manual",
  maxRisk: "Max risk",
  msgShort: "msg",
  remove: "Remove",
  sensBalanced: "Balanced",
  sensLow: "Low",
  sensStrict: "Strict",
  sortLabel: "Sort",
  stageAi: "AI",
  stageLocal: "Local",
  streamerHint: "Used to spot look-alike impersonation accounts and to detect the host answering questions.",
  thresholdOf: "Threshold",
  tooManyAttempts: "Too many attempts — wait a minute.",
  viewerLabel: "Viewer",
  viewerNotFound: "Viewer not found in this LIVE.",
  viewerStatus: "Viewer status",
  handlePlaceholder: "@username",
};

type Dict = typeof en;
export type TKey = keyof Dict;

const fr: Dict = {
  live: "Live",
  alerts: "Alertes",
  viewers: "Public",
  assistant: "Assistant",
  analytics: "Stats",
  settings: "Réglages",
  statusLive: "EN DIRECT",
  statusIdle: "HORS LIGNE",
  waitingForLive: "EN ATTENTE DE TON LIVE",
  waitingForLiveHint: "Rien à faire ici : lance ton LIVE dans l'app TikTok. Novus vérifie chaque minute et le rejoint tout seul — les commentaires et alertes apparaîtront sur cet écran.",
  tiktokRetrying: "TIKTOK INJOIGNABLE — NOUVEL ESSAI",
  tiktokRetryingHint: "Novus n'a pas pu joindre TikTok et réessaie automatiquement toutes les quelques minutes.",
  followAccountHint: "Saisis ton compte TikTok dans Réglages › Intégration TikTok pour que Novus rejoigne ton LIVE automatiquement.",
  demoTitle: "Simulation (démo)",
  statusWaiting: "EN ATTENTE",
  statusEnded: "TERMINÉ",
  msgMin: "msg/min",
  viewersShort: "public",
  chatters: "actifs",
  aiActive: "IA active",
  aiLocal: "IA locale",
  aiDisabled: "IA coupée",
  aiDegraded: "IA dégradée",
  startDemo: "LANCER LE LIVE DÉMO",
  startDemoHint: "Trafic de chat réaliste avec spam, harcèlement, arnaques, doxxing et raid coordonné — sans identifiants TikTok.",
  speed: "Vitesse du trafic",
  endLive: "Terminer le LIVE",
  noSession: "Aucun LIVE en cours",
  waitingConnector: "En attente d'un connecteur TikTok autorisé — voir Réglages › Intégration TikTok.",
  flaggedOnly: "Signalés",
  allMessages: "Tous",
  newMessages: "nouveaux messages",
  jumpLatest: "Aller au plus récent",
  emptyChat: "Les messages du chat s'afficheront ici.",
  open: "Ouvertes",
  watching: "Surveillées",
  resolved: "Résolues",
  dismissed: "Ignorées",
  all: "Toutes",
  recommended: "Recommandé",
  risk: "Risque",
  reasons: "Raisons",
  noAlerts: "Aucune alerte. Novus surveille le chat.",
  manualRequired: "ACTION MANUELLE REQUISE",
  doneInTikTok: "Fait dans TikTok",
  copyMessage: "Copier le message",
  copied: "Copié",
  sendInChat: "Envoyer dans le chat",
  sentInChat: "Envoyé dans le chat",
  simulated: "Simulé sur la plateforme démo",
  confirmed: "Confirmé",
  accounts: "comptes",
  more: "de plus",
  firstSeen: "Vu pour la 1re fois",
  messages: "Messages",
  warnings: "Avertissements",
  prevAlerts: "Alertes",
  riskTrend: "Tendance du risque",
  recentComments: "Commentaires récents",
  modHistory: "Historique de modération",
  categoriesDetected: "Catégories détectées",
  assessment: "Évaluation Novus actuelle",
  trusted: "De confiance",
  watchlist: "Surveillé",
  ignored: "Ignoré",
  none: "Aucun",
  searchViewers: "Rechercher @pseudo",
  sortRisk: "Risque",
  sortMessages: "Messages",
  sortRecent: "Récents",
  flagged: "Signalés",
  noViewers: "Aucun spectateur pour l'instant.",
  catchUp: "RÉSUME-MOI",
  catchUpHint: "Tout ce qui compte depuis ta dernière vérification",
  chatPulse: "POULS DU CHAT",
  trending: "Tendances",
  topUnanswered: "Question principale sans réponse",
  questions: "Questions",
  requests: "Demandes répétées",
  sentiment: "Sentiment",
  important: "Messages importants",
  spikes: "Pics d'activité",
  needAttention: "spectateurs nécessitent l'attention d'un modérateur",
  markAnswered: "Répondu",
  reopen: "Rouvrir",
  activity: "activité",
  totalMessages: "Messages au total",
  uniqueChatters: "Participants uniques",
  peak: "Pic d'activité",
  muteRecs: "Sourdines conseillées",
  blockRecs: "Blocages conseillés",
  responseTime: "Temps de réaction",
  msgPerMinute: "Messages par minute",
  toxicityTrend: "Tendance de toxicité (% signalés)",
  topParticipants: "Participants les plus actifs",
  topQuestions: "Questions les plus posées",
  topTopics: "Sujets principaux",
  categories: "Catégories détectées",
  report: "Rapport post-LIVE",
  sensitivity: "Sensibilité de modération",
  custom: "Perso",
  thresholds: "Seuils personnalisés",
  detection: "Catégories de détection",
  bannedPhrases: "Expressions interdites",
  trustedUsers: "Utilisateurs de confiance",
  add: "Ajouter",
  language: "Langue",
  streamer: "Pseudo du streamer",
  aiAnalysis: "IA contextuelle (étape 2)",
  tiktokIntegration: "Intégration TikTok",
  install: "Installer sur iPhone",
  installHint: "Dans Safari : Partager → Sur l'écran d'accueil. Novus s'ouvre en plein écran à côté de TikTok.",
  save: "Enregistrer",
  saved: "Enregistré",
  logout: "Déconnexion",
  connect: "Connecter",
  disconnect: "Déconnecter",
  capabilities: "Capacités",
  reconnecting: "Reconnexion…",
  loginTitle: "Clé d'accès",
  loginHint: "Saisis ton code d'accès Novus Live (fondateur ou membre de l'équipe).",
  noAccount: "Pas encore de compte ? Voir les offres et l'essai gratuit →",
  login: "Déverrouiller",
  duration: "Durée",
  durationShort: "Durée",
  table: "Tableau",
  chart: "Graphique",
  actions: "Actions",
  aiLocalHint: "Modération locale déterministe",
  aiLocalTitle: "Modération locale déterministe",
  aiLocalHint2: "Pas de ANTHROPIC_API_KEY sur le serveur — les règles locales (étape 1) gèrent tout.",
  aiReviewHint: "Seuls les messages suspects ou ambigus sont envoyés pour une analyse du contexte. Analysés : {n}.",
  alertFilter: "Filtre des alertes",
  alertsAria: "{open} alertes ouvertes, {critical} critiques",
  bannedPlaceholder: "ex. spoiler",
  catchUpFailed: "Le résumé a échoué",
  chatLabel: "Chat du LIVE",
  colAvgRisk: "Risque moy.",
  colMessages: "Msgs",
  colMinute: "Min",
  colToxic: "Toxique %",
  demoStartFailed: "Impossible de lancer la démo",
  displayLabel: "Affichage",
  ecosystem: "Fait partie de l'écosystème Novarys / Pulse Engine",
  endShort: "FIN",
  filterLabel: "Filtre",
  fullDetails: "Tous les détails :",
  integrationStates: "États de l'intégration",
  invalidKey: "Clé invalide",
  languageHint: "Les langues du chat sont détectées automatiquement (EN, FR, ES, DE, PT, IT, AR, RU, JA, KO, ZH…). Le bouton en haut de l'écran change aussi la langue.",
  lastError: "Dernière erreur :",
  lastEvent: "dernier événement il y a {ago}",
  mainNav: "Navigation principale",
  manual: "manuelle",
  maxRisk: "Risque max",
  msgShort: "msg",
  remove: "Retirer",
  sensBalanced: "Équilibré",
  sensLow: "Souple",
  sensStrict: "Strict",
  sortLabel: "Tri",
  stageAi: "IA",
  stageLocal: "Local",
  streamerHint: "Sert à repérer les comptes qui imitent le streamer et à détecter quand l'hôte répond aux questions.",
  thresholdOf: "Seuil",
  tooManyAttempts: "Trop de tentatives — patiente une minute.",
  viewerLabel: "Spectateur",
  viewerNotFound: "Spectateur introuvable dans ce LIVE.",
  viewerStatus: "Statut du spectateur",
  handlePlaceholder: "@pseudo",
};

const DICTS = { en, fr };

export function useT() {
  const lang = useStore((s) => s.settings.language);
  const d = DICTS[lang] ?? en;
  return (key: TKey) => d[key];
}

export function useLang(): "en" | "fr" {
  return useStore((s) => s.settings.language);
}

export function categoryLabel(c: Category, lang: "en" | "fr"): string {
  return CATEGORY_LABELS[c]?.[lang] ?? c;
}

const ACTION_LABELS: Record<ActionType, { en: string; fr: string }> = {
  watch: { en: "WATCH", fr: "SURVEILLER" },
  warn: { en: "WARN", fr: "AVERTIR" },
  mute: { en: "MUTE", fr: "SOURDINE" },
  block: { en: "BLOCK", fr: "BLOQUER" },
  report: { en: "REPORT", fr: "SIGNALER" },
  dismiss: { en: "DISMISS", fr: "IGNORER" },
};

/** Button label of a moderation action ("MUTE" / "SOURDINE"). */
export function actionLabel(a: ActionType | "none", lang: "en" | "fr"): string {
  return a === "none" ? "—" : ACTION_LABELS[a][lang];
}

const SEVERITY_LABELS: Record<Severity, { en: string; fr: string }> = {
  normal: { en: "OK", fr: "OK" },
  watch: { en: "WATCH", fr: "À SURVEILLER" },
  warning: { en: "WARNING", fr: "AVERTISSEMENT" },
  critical: { en: "CRITICAL", fr: "CRITIQUE" },
};

export function severityLabel(s: Severity, lang: "en" | "fr"): string {
  return SEVERITY_LABELS[s][lang];
}

/** Message / steps / suggested text of an action record in the display language. */
export function actionCopy(r: ActionRecord, lang: "en" | "fr"): ActionCopy {
  const c = r.i18n?.[lang];
  return c ?? { message: r.message, instructions: r.instructions, suggestedMessage: r.suggestedMessage };
}

/** Language stored on this device (used before the server settings are loaded, e.g. on the login screen). */
export function deviceLang(): "en" | "fr" | null {
  try {
    const v = localStorage.getItem("novus:lang");
    return v === "fr" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

export function rememberLang(lang: "en" | "fr"): void {
  try {
    localStorage.setItem("novus:lang", lang);
  } catch {
    /* private mode */
  }
}

const STATE_LABELS: Record<TikTokIntegrationState, { en: string; fr: string }> = {
  NOT_CONNECTED: { en: "NOT CONNECTED", fr: "NON CONNECTÉ" },
  CONNECTOR_AVAILABLE: { en: "CONNECTOR AVAILABLE", fr: "CONNECTEUR DISPONIBLE" },
  CONNECTED: { en: "CONNECTED", fr: "CONNECTÉ" },
  LIVE_DETECTED: { en: "LIVE DETECTED", fr: "LIVE DÉTECTÉ" },
  LIVE_ENDED: { en: "LIVE ENDED", fr: "LIVE TERMINÉ" },
  ERROR: { en: "ERROR", fr: "ERREUR" },
};


export function tiktokStateLabel(s: TikTokIntegrationState, lang: "en" | "fr"): string {
  return STATE_LABELS[s][lang];
}

const ERRORS: Record<string, { en: string; fr: string }> = {
  invalid_input: { en: "Invalid value — please check what you entered.", fr: "Valeur invalide — vérifie ta saisie." },
  unauthorized: { en: "Session expired — please log in again.", fr: "Session expirée — reconnecte-toi." },
  rate_limited: { en: "Too many requests — wait a moment.", fr: "Trop de requêtes — patiente un instant." },
  not_found: { en: "Not found.", fr: "Introuvable." },
  room_not_found: { en: "This account is no longer followed.", fr: "Ce compte n'est plus suivi." },
  session_not_found: { en: "This LIVE was not found.", fr: "Ce LIVE est introuvable." },
  alert_not_found: { en: "This alert no longer exists.", fr: "Cette alerte n'existe plus." },
  viewer_not_found: { en: "Viewer not found in this LIVE.", fr: "Spectateur introuvable dans ce LIVE." },
  demo_main_room_only: { en: "The demo only runs in the Demo space.", fr: "La démo ne fonctionne que dans l'espace Démo." },
  save_failed: { en: "Save failed.", fr: "Échec de l'enregistrement." },
  internal_error: { en: "Server error — try again.", fr: "Erreur du serveur — réessaie." },
  plan_limit_creators: { en: "Your plan's creator limit is reached.", fr: "La limite de créateurs de votre offre est atteinte." },
  plan_limit_seats: { en: "Your plan's team seats are all used.", fr: "Toutes les places d'équipe de votre offre sont utilisées." },
  plan_limit_exports: { en: "This month's export allowance is used.", fr: "Le quota d'exports du mois est atteint." },
  history_retention: { en: "This LIVE is older than your plan's history window.", fr: "Ce LIVE est plus ancien que l'historique de votre offre." },
  workspace_restricted: { en: "Your workspace is read-only — reactivate your subscription.", fr: "Votre espace est en lecture seule — réactivez votre abonnement." },
  founding_sold_out: { en: "The Founding Agency offer is no longer available.", fr: "L'offre Founding Agency n'est plus disponible." },
  billing_not_configured: { en: "Online payment is not open yet.", fr: "Le paiement en ligne n'est pas encore ouvert." },
  plan_unavailable: { en: "This plan is not available.", fr: "Cette offre n'est pas disponible." },
  already_subscribed: { en: "You already have a subscription — change plan instead.", fr: "Vous avez déjà un abonnement — changez plutôt d'offre." },
  no_subscription: { en: "No active subscription to change.", fr: "Aucun abonnement actif à modifier." },
  no_billing_account: { en: "No billing account yet.", fr: "Pas encore de compte de facturation." },
  price_not_configured: { en: "This price is not configured yet.", fr: "Ce tarif n'est pas encore configuré." },
  checkout_failed: { en: "Payment page unavailable — try again.", fr: "Page de paiement indisponible — réessayez." },
  forbidden: { en: "You don't have permission for this — ask the founder.", fr: "Tu n'as pas l'autorisation pour ça — demande au fondateur." },
  member_not_found: { en: "This team member no longer exists.", fr: "Ce membre de l'équipe n'existe plus." },
  team_full: { en: "The team is full (100 members).", fr: "L'équipe est complète (100 membres)." },
  team_requires_access_code: { en: "Teams need access codes to be enabled on the server.", fr: "L'équipe nécessite des codes d'accès activés sur le serveur." },
  not_live: { en: "This account is not LIVE right now.", fr: "Ce compte n'est pas en LIVE en ce moment." },
  not_a_followed_account: { en: "Only followed TikTok accounts can be recorded.", fr: "Seuls les comptes TikTok suivis peuvent être enregistrés." },
  manual_action_not_found: { en: "This action is no longer pending.", fr: "Cette action n'est plus en attente." },
  chat_not_configured: {
    en: "Sending in chat is not set up on the server yet.",
    fr: "L'envoi dans le chat n'est pas encore configuré sur le serveur.",
  },
  chat_not_connected: {
    en: "Connect your TikTok account in Settings to send in chat.",
    fr: "Connecte ton compte TikTok dans les Réglages pour envoyer dans le chat.",
  },
  chat_not_live: { en: "This account is not LIVE — nothing was sent.", fr: "Ce compte n'est pas en LIVE — rien n'a été envoyé." },
  chat_plan_required: {
    en: "Euler Stream refused: sending chat messages needs a paid Euler plan. Nothing was sent.",
    fr: "Euler Stream a refusé : l'envoi de messages demande un abonnement Euler payant. Rien n'a été envoyé.",
  },
  chat_session_expired: {
    en: "Your TikTok connection expired — reconnect it in Settings. Nothing was sent.",
    fr: "Ta connexion TikTok a expiré — reconnecte-la dans les Réglages. Rien n'a été envoyé.",
  },
  chat_failed: { en: "TikTok did not accept the message. Nothing was sent.", fr: "TikTok n'a pas accepté le message. Rien n'a été envoyé." },
};

/** Human message for an API error code. */
export function errorText(code: string, lang: "en" | "fr"): string {
  return ERRORS[code]?.[lang] ?? (lang === "fr" ? "Une erreur est survenue." : "Something went wrong.");
}

/** Switch the whole app (and exports) between English and French. */
export async function setLanguage(lang: "en" | "fr"): Promise<void> {
  rememberLang(lang);
  const prev = getState().settings;
  if (prev.language === lang) return;
  setState({ settings: { ...prev, language: lang } });
  try {
    setState({ settings: await api.saveSettings({ language: lang }) });
  } catch {
    /* not logged in yet (login screen) or offline: the device choice still applies */
  }
}

