import { useEffect, useMemo, useState } from "react";
import type { BillingCycle, Entitlements, PlanId } from "../../shared/plans";
import type { BillingMe, PublicPricing } from "../../shared/types";
import { ApiError } from "../api";
import { billingApi, euro, PLAN_NAMES, track } from "../billing";
import { LangToggle } from "../components/LangToggle";
import { BrandLogo } from "../components/ui";
import { errorText, useLang } from "../i18n";

type Lang = "en" | "fr";
type Paid = Exclude<PlanId, "enterprise">;
const CARDS: Paid[] = ["moderator_pro", "creator_pro", "agency", "agency_pro"];

// ---------------------------------------------------------------- copy

const COPY = {
  en: {
    login: "Log in",
    heroTitle: "Run smarter LIVE operations.",
    heroSub: "AI moderation, real-time intelligence and complete control of your TikTok LIVE activity.",
    monthly: "Monthly",
    yearly: "Yearly",
    twoFree: "2 months free",
    perMonth: "/month",
    perYear: "/year",
    billedYearly: (a: string) => `${a} billed annually`,
    approxMonth: (a: string) => `≈ ${a}/month`,
    mostPopular: "MOST POPULAR",
    bestValue: "BEST VALUE",
    foundingBadge: "FOUNDING OFFER",
    foundingLine: (a: string, m: number) => `${a}/month for your first ${m} months`,
    foundingThen: (a: string) => `Then ${a}/month. Cancel anytime.`,
    foundingLimited: (n: number) => `Limited to the first ${n} agencies.`,
    foundingLeft: (n: number) => (n === 1 ? "1 Founding Agency spot remaining" : `${n} Founding Agency spots remaining`),
    foundingMonthlyOnly: "Founding pricing applies to monthly billing.",
    foundingCta: "Claim founding price",
    standardAgency: "or start Agency at the standard price",
    foundingTitle: "Founding Agency",
    foundingPitch: "Join the first agencies shaping the future of LIVE management.",
    foundingPerks: ["Full Agency plan", "15 creators", "Free onboarding", "Founding Agency status"],
    creatorsIncluded: (n: number) => `${n} creators included`,
    perCreator: (a: string) => `≈ ${a} per creator/month`,
    underPerCreator: (a: string) => `< ${a} per creator/month`,
    trial: (d: number) => `${d}-day free trial`,
    noTrial: "Upgrade from Agency or start directly",
    rollingOut: "rolling out",
    seeAll: "See every feature",
    hideAll: "Show less",
    enterpriseTitle: "Enterprise",
    enterprisePrice: "Custom",
    enterpriseSub: "For large agencies, creator networks, MCNs and organizations with 50+ creators.",
    enterpriseFeatures: ["Custom creator, AI, monitoring and recording limits", "Custom storage and retention", "API access and white-label on request", "Dedicated onboarding and support", "SLA and advanced security requirements", "Custom integrations"],
    talk: "Talk to us",
    roiTitle: "One command center for your entire LIVE operation.",
    roiSub: "Centralized supervision, AI moderation, analytics, team controls, reporting and creator management — for up to 15 creators.",
    roiPoints: ["Centralized supervision of every creator's LIVE", "AI moderation and real-time alerts", "Team roles, permissions and creator assignment", "Reports, exports and 1-year history", "Evidence screenshots and LIVE recordings (rolling out)"],
    roiPrice: (a: string) => `${a}/month for up to 15 creators`,
    compareTitle: "Compare plans",
    faqTitle: "Questions",
    current: "Current plan",
    switchTo: "Switch to this plan",
    checkoutOff: "Online payment is being opened. Leave your details and we'll activate your plan.",
    // signup
    signTitle: (p: string) => `Start ${p}`,
    wsName: "Your name or agency name",
    email: "Email (for invoices)",
    continue: "Continue to secure payment",
    cardNote: (d: number) => (d ? `Card required. You won't be charged during the ${d}-day trial — cancel anytime before it ends.` : "Card required. Charged today, then every period. Cancel anytime."),
    codeTitle: "Your Novus Live access code",
    codeHint: "This code opens your workspace on any device. Save it now — it will not be shown again.",
    copy: "Copy",
    copied: "Copied",
    saved: "I saved my code — continue",
    cancel: "Cancel",
    leadTitle: "Talk to us",
    company: "Company / agency",
    creators: "Number of creators",
    message: "What do you need? (optional)",
    send: "Send",
    leadSent: "Thanks — we'll get back to you shortly.",
    successTitle: "Payment confirmed",
    successBody: "Your workspace is being activated. This takes a few seconds.",
    successReady: "Your workspace is active.",
    open: "Open Novus Live",
    canceledCheckout: "Checkout canceled — nothing was charged.",
  },
  fr: {
    login: "Se connecter",
    heroTitle: "Pilotez vos LIVE avec intelligence.",
    heroSub: "Modération IA, intelligence en temps réel et contrôle complet de votre activité TikTok LIVE.",
    monthly: "Mensuel",
    yearly: "Annuel",
    twoFree: "2 mois offerts",
    perMonth: "/mois",
    perYear: "/an",
    billedYearly: (a: string) => `${a} facturés à l'année`,
    approxMonth: (a: string) => `≈ ${a}/mois`,
    mostPopular: "LE PLUS CHOISI",
    bestValue: "MEILLEURE VALEUR",
    foundingBadge: "OFFRE FONDATEUR",
    foundingLine: (a: string, m: number) => `${a}/mois pendant vos ${m} premiers mois`,
    foundingThen: (a: string) => `Puis ${a}/mois. Résiliable à tout moment.`,
    foundingLimited: (n: number) => `Réservé aux ${n} premières agences.`,
    foundingLeft: (n: number) => (n === 1 ? "1 place Founding Agency restante" : `${n} places Founding Agency restantes`),
    foundingMonthlyOnly: "Le tarif fondateur s'applique à la facturation mensuelle.",
    foundingCta: "Obtenir le tarif fondateur",
    standardAgency: "ou démarrer Agency au tarif standard",
    foundingTitle: "Founding Agency",
    foundingPitch: "Rejoignez les premières agences qui façonnent l'avenir de la gestion des LIVE.",
    foundingPerks: ["Offre Agency complète", "15 créateurs", "Onboarding offert", "Statut Founding Agency"],
    creatorsIncluded: (n: number) => `${n} créateurs inclus`,
    perCreator: (a: string) => `≈ ${a} par créateur/mois`,
    underPerCreator: (a: string) => `< ${a} par créateur/mois`,
    trial: (d: number) => `Essai gratuit ${d} jours`,
    noTrial: "Depuis Agency ou directement",
    rollingOut: "déploiement en cours",
    seeAll: "Voir toutes les fonctionnalités",
    hideAll: "Réduire",
    enterpriseTitle: "Enterprise",
    enterprisePrice: "Sur mesure",
    enterpriseSub: "Pour les grandes agences, réseaux de créateurs, MCN et organisations de 50+ créateurs.",
    enterpriseFeatures: ["Limites sur mesure : créateurs, IA, monitoring, enregistrement", "Stockage et conservation sur mesure", "Accès API et marque blanche sur demande", "Onboarding et support dédiés", "SLA et exigences de sécurité avancées", "Intégrations sur mesure"],
    talk: "Parlons-en",
    roiTitle: "Un poste de commandement pour toute votre activité LIVE.",
    roiSub: "Supervision centralisée, modération IA, analytics, contrôle d'équipe, rapports et gestion des créateurs — jusqu'à 15 créateurs.",
    roiPoints: ["Supervision centralisée des LIVE de chaque créateur", "Modération IA et alertes en temps réel", "Rôles, autorisations et affectation des créateurs", "Rapports, exports et 1 an d'historique", "Captures de preuve et enregistrements des LIVE (déploiement en cours)"],
    roiPrice: (a: string) => `${a}/mois pour jusqu'à 15 créateurs`,
    compareTitle: "Comparer les offres",
    faqTitle: "Questions",
    current: "Offre actuelle",
    switchTo: "Passer à cette offre",
    checkoutOff: "Le paiement en ligne ouvre bientôt. Laissez vos coordonnées et nous activons votre offre.",
    signTitle: (p: string) => `Démarrer ${p}`,
    wsName: "Votre nom ou nom d'agence",
    email: "E-mail (pour les factures)",
    continue: "Continuer vers le paiement sécurisé",
    cardNote: (d: number) => (d ? `Carte requise. Rien n'est débité pendant l'essai de ${d} jours — résiliable avant la fin.` : "Carte requise. Débité aujourd'hui, puis à chaque période. Résiliable à tout moment."),
    codeTitle: "Votre code d'accès Novus Live",
    codeHint: "Ce code ouvre votre espace sur n'importe quel appareil. Enregistrez-le maintenant — il ne sera plus affiché.",
    copy: "Copier",
    copied: "Copié",
    saved: "J'ai enregistré mon code — continuer",
    cancel: "Annuler",
    leadTitle: "Parlons-en",
    company: "Société / agence",
    creators: "Nombre de créateurs",
    message: "Votre besoin (facultatif)",
    send: "Envoyer",
    leadSent: "Merci — nous revenons vers vous rapidement.",
    successTitle: "Paiement confirmé",
    successBody: "Votre espace est en cours d'activation. Cela prend quelques secondes.",
    successReady: "Votre espace est actif.",
    open: "Ouvrir Novus Live",
    canceledCheckout: "Paiement annulé — rien n'a été débité.",
  },
};

const PLAN_COPY: Record<Paid, { en: { tag: string; cta: string }; fr: { tag: string; cta: string } }> = {
  moderator_pro: {
    en: { tag: "For professional moderators managing multiple TikTok LIVE creators.", cta: "Start free trial" },
    fr: { tag: "Pour les modérateurs pros qui gèrent plusieurs créateurs TikTok LIVE.", cta: "Démarrer l'essai gratuit" },
  },
  creator_pro: {
    en: { tag: "For serious TikTok LIVE creators who want AI protection, intelligence and performance analytics.", cta: "Protect my LIVE" },
    fr: { tag: "Pour les créateurs TikTok LIVE sérieux qui veulent la protection IA, l'intelligence et les analytics.", cta: "Protéger mon LIVE" },
  },
  agency: {
    en: { tag: "For TikTok LIVE agencies managing teams of creators.", cta: "Start Agency trial" },
    fr: { tag: "Pour les agences TikTok LIVE qui gèrent des équipes de créateurs.", cta: "Démarrer l'essai Agency" },
  },
  agency_pro: {
    en: { tag: "For established agencies operating at scale.", cta: "Scale my agency" },
    fr: { tag: "Pour les agences établies qui opèrent à grande échelle.", cta: "Passer à l'échelle" },
  },
};

/** Card highlights (top ones shown, the rest on "see every feature"). `soon` = rolling out. */
function highlights(id: Paid, e: Entitlements, lang: Lang): { text: string; soon?: boolean }[] {
  const n = (v: number) => v.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB");
  const fr = lang === "fr";
  switch (id) {
    case "moderator_pro":
      return [
        { text: fr ? `Jusqu'à ${e.creator_limit} créateurs LIVE gérés` : `Up to ${e.creator_limit} managed LIVE creators` },
        { text: fr ? "Monitoring des LIVE en temps réel" : "Real-time LIVE monitoring" },
        { text: fr ? "Modération IA et alertes contextuelles" : "AI moderation and context-aware alerts" },
        { text: fr ? "Intelligence du chat" : "Chat intelligence" },
        { text: fr ? "Actions de modération et envoi dans le chat" : "Moderation and chat actions" },
        { text: fr ? "Analytics essentiels" : "Essential analytics" },
        { text: fr ? `Historique ${e.history_retention_days} jours` : `${e.history_retention_days}-day history` },
        { text: fr ? "Exports PDF / CSV" : "PDF / CSV exports" },
        { text: fr ? "Modes manuel + automatique" : "Manual + automatic modes" },
        { text: fr ? "1 utilisateur" : "1 user" },
      ];
    case "creator_pro":
      return [
        { text: fr ? "Votre compte créateur + 2 profils LIVE secondaires" : "Your creator account + 2 secondary LIVE profiles" },
        { text: fr ? "Assistant LIVE IA complet" : "Full AI LIVE assistant" },
        { text: fr ? "Modération IA avancée et alertes de risque" : "Advanced AI moderation and risk alerts" },
        { text: fr ? "Analytics avancés et insights de performance" : "Advanced analytics and performance insights" },
        { text: fr ? `Jusqu'à ${e.team_seat_limit} modérateurs dans l'équipe` : `Up to ${e.team_seat_limit} moderator seats` },
        { text: fr ? `Historique ${e.history_retention_days} jours` : `${e.history_retention_days}-day history` },
        { text: fr ? "Rapports PDF / CSV et conversation complète" : "PDF / CSV reports and full conversation" },
        { text: fr ? "Intelligence du chat" : "Chat intelligence" },
        { text: fr ? "Modes manuel + automatique" : "Manual + automatic modes" },
      ];
    case "agency":
      return [
        { text: fr ? `Jusqu'à ${e.creator_limit} créateurs gérés` : `Up to ${e.creator_limit} managed creators` },
        { text: fr ? "Poste de commandement multi-créateurs" : "Multi-creator command center" },
        { text: fr ? "Modération IA complète et alertes en temps réel" : "Full AI moderation and real-time alerts" },
        { text: fr ? `Équipe : ${e.team_seat_limit} membres, rôles et autorisations` : `Team: ${e.team_seat_limit} members, roles and permissions` },
        { text: fr ? "Affectation des créateurs aux membres" : "Creator assignment" },
        { text: fr ? "Rapports avancés, exports PDF / CSV" : "Advanced reports, PDF / CSV exports" },
        { text: fr ? "Historique centralisé 1 an" : "1-year centralized history" },
        { text: fr ? "Support prioritaire" : "Priority support" },
        { text: fr ? "Tableau de bord agence et comparaison des créateurs" : "Agency dashboard and creator comparison", soon: true },
        { text: fr ? "Captures de preuve automatiques" : "Automated evidence screenshots", soon: true },
        { text: fr ? `Enregistrement des LIVE, conservation ${e.video_retention_days} jours` : `LIVE recording, ${e.video_retention_days}-day retention`, soon: true },
      ];
    case "agency_pro":
      return [
        { text: fr ? `Jusqu'à ${e.creator_limit} créateurs gérés` : `Up to ${e.creator_limit} managed creators` },
        { text: fr ? "Tout Agency, en plus grand" : "Everything in Agency" },
        { text: fr ? `Jusqu'à ${e.team_seat_limit} membres d'équipe` : `Up to ${e.team_seat_limit} team members` },
        { text: fr ? `IA : ${n(e.ai_requests)} analyses/mois` : `AI: ${n(e.ai_requests)} reviews/month` },
        { text: fr ? `Monitoring : ${n(e.live_monitoring_hours)} h de LIVE/mois` : `Monitoring: ${n(e.live_monitoring_hours)} LIVE hours/month` },
        { text: fr ? "Contrôles et reporting d'agence avancés" : "Advanced organization controls and reporting" },
        { text: fr ? "Support Priority+" : "Priority+ support" },
        { text: fr ? `Conservation vidéo ${e.video_retention_days} jours` : `${e.video_retention_days}-day video retention`, soon: true },
      ];
  }
}

// ---------------------------------------------------------------- comparison

type Row = { label: { en: string; fr: string }; value: (e: Entitlements, id: Paid, lang: Lang) => string };
const yes = "✓";
const no = "—";
const num = (v: number, lang: Lang) => v.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB");
const soon = (lang: Lang) => (lang === "fr" ? "déploiement en cours" : "rolling out");

const COMPARE: { title: { en: string; fr: string }; rows: Row[] }[] = [
  {
    title: { en: "LIVE Intelligence", fr: "Intelligence LIVE" },
    rows: [
      { label: { en: "Managed creators", fr: "Créateurs gérés" }, value: (e, id, l) => (id === "creator_pro" ? (l === "fr" ? "1 + 2 profils" : "1 + 2 profiles") : String(e.creator_limit)) },
      { label: { en: "Real-time monitoring & chat intelligence", fr: "Monitoring temps réel et intelligence du chat" }, value: () => yes },
      { label: { en: "LIVE monitoring (fair use)", fr: "Monitoring LIVE (usage raisonnable)" }, value: (e, _id, l) => `${num(e.live_monitoring_hours, l)} h/${l === "fr" ? "mois" : "month"}` },
    ],
  },
  {
    title: { en: "AI Moderation", fr: "Modération IA" },
    rows: [
      { label: { en: "AI moderation & context-aware alerts", fr: "Modération IA et alertes contextuelles" }, value: () => yes },
      { label: { en: "AI reviews included", fr: "Analyses IA incluses" }, value: (e, _id, l) => `${num(e.ai_requests, l)}/${l === "fr" ? "mois" : "month"}` },
      { label: { en: "Beyond the allowance", fr: "Au-delà du quota" }, value: (_e, _id, l) => (l === "fr" ? "règles locales" : "local rules") },
    ],
  },
  {
    title: { en: "Analytics", fr: "Analytics" },
    rows: [
      { label: { en: "Essential analytics", fr: "Analytics essentiels" }, value: () => yes },
      { label: { en: "Advanced analytics & insights", fr: "Analytics avancés et insights" }, value: (e) => (e.advanced_analytics ? yes : no) },
      { label: { en: "Agency dashboard & creator comparison", fr: "Tableau de bord agence et comparaison" }, value: (e, _id, l) => (e.agency_dashboard ? soon(l) : no) },
    ],
  },
  {
    title: { en: "Team", fr: "Équipe" },
    rows: [
      { label: { en: "Users", fr: "Utilisateurs" }, value: (e, _id, l) => (e.team_seat_limit ? `1 + ${e.team_seat_limit} ${l === "fr" ? "membres" : "members"}` : "1") },
      { label: { en: "Roles, permissions & creator assignment", fr: "Rôles, autorisations et affectation" }, value: (e) => (e.team_roles ? yes : no) },
    ],
  },
  {
    title: { en: "History & Reports", fr: "Historique et rapports" },
    rows: [
      { label: { en: "History", fr: "Historique" }, value: (e, _id, l) => (e.history_retention_days >= 730 ? (l === "fr" ? "2 ans" : "2 years") : e.history_retention_days >= 365 ? (l === "fr" ? "1 an" : "1 year") : `${e.history_retention_days} ${l === "fr" ? "jours" : "days"}`) },
      { label: { en: "PDF, CSV & conversation exports", fr: "Exports PDF, CSV et conversation" }, value: (e, _id, l) => `${num(e.exports_limit, l)}/${l === "fr" ? "mois" : "month"}` },
    ],
  },
  {
    title: { en: "Evidence", fr: "Preuves" },
    rows: [{ label: { en: "Automated evidence screenshots", fr: "Captures de preuve automatiques" }, value: (e, _id, l) => (e.screenshots ? `${num(e.screenshot_limit, l)}/${l === "fr" ? "mois" : "month"} · ${soon(l)}` : no) }],
  },
  {
    title: { en: "Recording", fr: "Enregistrement" },
    rows: [
      { label: { en: "LIVE recording", fr: "Enregistrement des LIVE" }, value: (e, _id, l) => (e.recording ? `${num(e.recording_hours, l)} h/${l === "fr" ? "mois" : "month"} · ${soon(l)}` : no) },
      { label: { en: "Video retention", fr: "Conservation vidéo" }, value: (e, _id, l) => (e.recording ? `${e.video_retention_days} ${l === "fr" ? "jours" : "days"}` : no) },
    ],
  },
  {
    title: { en: "Agency Management", fr: "Gestion d'agence" },
    rows: [
      { label: { en: "Creator groups", fr: "Groupes de créateurs" }, value: () => yes },
      { label: { en: "Multi-creator command center", fr: "Poste de commandement multi-créateurs" }, value: (e) => (e.agency_dashboard ? yes : no) },
    ],
  },
  {
    title: { en: "Support", fr: "Support" },
    rows: [{ label: { en: "Support", fr: "Support" }, value: (_e, id, l) => (id === "agency_pro" ? "Priority+" : id === "agency" ? (l === "fr" ? "Prioritaire" : "Priority") : "Email") }],
  },
];

// ---------------------------------------------------------------- FAQ (reflects the real implementation)

const FAQ: Record<Lang, [string, string][]> = {
  en: [
    ["Can I cancel anytime?", "Yes. Open Settings › Subscription › Manage billing to cancel. You keep full access until the end of the period you already paid."],
    ["What happens after my trial?", "Moderator Pro and Creator Pro have a 7-day trial, Agency 14 days. When it ends, your card is charged and your plan continues — unless you cancel before. Trials include a usage allowance (AI reviews and monitored LIVE hours); reaching it pauses monitoring until you subscribe, without deleting anything."],
    ["Do I need a credit card for the trial?", "Yes, a card is required to start a trial. Nothing is charged until the trial ends. One trial per email address."],
    ["What counts as a managed creator?", "Each TikTok account your workspace follows and monitors. Your plan sets how many are monitored at the same time; extra saved accounts stay in your workspace, paused."],
    ["Can I change plans?", "Yes, anytime from Settings › Subscription. Upgrades apply immediately with a prorated charge. When you downgrade, your data is kept; if you follow more creators than the new plan allows, the extra ones are paused until you choose which to keep."],
    ["What happens if my agency grows?", "Agency Pro monitors up to 40 creators with 25 team members. Beyond that, Enterprise is built around your needs."],
    ["Are recordings included?", "LIVE recording and automated evidence screenshots are part of Agency and Agency Pro at no extra cost. They are being rolled out now and switch on for these plans as soon as they are available."],
    ["How long are recordings retained?", "30 days on Agency, 90 days on Agency Pro, custom on Enterprise."],
    ["What happens to recordings after retention expires?", "They are deleted automatically. Your LIVE history, reports and chat transcripts are not affected."],
    ["What happens if payment fails?", "Stripe retries the payment automatically and we warn you in the app. Your workspace keeps working for 14 days; after that it becomes read-only (history and exports stay available) until the payment method is updated. Nothing is deleted."],
    ["Is my data deleted if I cancel?", "No. Your workspace becomes read-only: your history stays accessible and exportable. Ask us if you want it deleted."],
    ["How does Founding Agency pricing work?", "The first 20 agencies subscribing to Agency with monthly billing pay €149/month for their first 12 months instead of €199. The number of remaining spots shown is counted from real subscriptions."],
    ["What happens after the first 12 months?", "Your subscription continues automatically at the standard Agency price of €199/month. No action needed — and you can cancel anytime."],
    ["Can large agencies get custom pricing?", "Yes. Enterprise covers 50+ creators with custom limits, retention, support and SLA. Use “Talk to us”."],
  ],
  fr: [
    ["Puis-je résilier à tout moment ?", "Oui. Ouvrez Réglages › Abonnement › Gérer la facturation pour résilier. Vous gardez l'accès complet jusqu'à la fin de la période déjà payée."],
    ["Que se passe-t-il après l'essai ?", "Moderator Pro et Creator Pro ont 7 jours d'essai, Agency 14 jours. À la fin, votre carte est débitée et l'offre continue — sauf si vous résiliez avant. L'essai inclut un quota d'usage (analyses IA et heures de LIVE surveillées) ; une fois atteint, le monitoring se met en pause jusqu'à l'abonnement, sans rien supprimer."],
    ["Faut-il une carte bancaire pour l'essai ?", "Oui, une carte est requise pour démarrer l'essai. Rien n'est débité avant la fin de l'essai. Un essai par adresse e-mail."],
    ["Qu'est-ce qu'un créateur géré ?", "Chaque compte TikTok que votre espace suit et surveille. Votre offre fixe combien sont surveillés en même temps ; les comptes enregistrés en plus restent dans votre espace, en pause."],
    ["Puis-je changer d'offre ?", "Oui, à tout moment depuis Réglages › Abonnement. Les montées en gamme s'appliquent tout de suite, au prorata. En cas de descente, vos données sont conservées ; si vous suivez plus de créateurs que la nouvelle offre ne le permet, les comptes en trop sont mis en pause jusqu'à ce que vous choisissiez lesquels garder."],
    ["Et si mon agence grandit ?", "Agency Pro surveille jusqu'à 40 créateurs avec 25 membres d'équipe. Au-delà, Enterprise est construit selon vos besoins."],
    ["Les enregistrements sont-ils inclus ?", "L'enregistrement des LIVE et les captures de preuve automatiques font partie d'Agency et d'Agency Pro sans surcoût. Ils sont en cours de déploiement et s'activent pour ces offres dès qu'ils sont disponibles."],
    ["Combien de temps sont conservés les enregistrements ?", "30 jours sur Agency, 90 jours sur Agency Pro, sur mesure en Enterprise."],
    ["Que deviennent les enregistrements après la durée de conservation ?", "Ils sont supprimés automatiquement. Votre historique de LIVE, vos rapports et vos conversations ne sont pas touchés."],
    ["Que se passe-t-il si un paiement échoue ?", "Stripe relance automatiquement le paiement et nous vous prévenons dans l'app. Votre espace continue de fonctionner 14 jours ; ensuite il passe en lecture seule (historique et exports restent disponibles) jusqu'à la mise à jour du moyen de paiement. Rien n'est supprimé."],
    ["Mes données sont-elles supprimées si je résilie ?", "Non. Votre espace passe en lecture seule : votre historique reste consultable et exportable. Demandez-nous si vous souhaitez sa suppression."],
    ["Comment fonctionne le tarif Founding Agency ?", "Les 20 premières agences qui souscrivent Agency en mensuel paient 149 €/mois pendant leurs 12 premiers mois au lieu de 199 €. Le nombre de places restantes affiché est calculé à partir des abonnements réels."],
    ["Et après les 12 premiers mois ?", "L'abonnement continue automatiquement au tarif Agency standard de 199 €/mois. Aucune action nécessaire — résiliable à tout moment."],
    ["Les grandes agences peuvent-elles avoir un tarif sur mesure ?", "Oui. Enterprise couvre 50+ créateurs avec limites, conservation, support et SLA sur mesure. Utilisez « Parlons-en »."],
  ],
};

// ---------------------------------------------------------------- page

type Flow = { kind: "signup"; plan: Paid; founding: boolean } | { kind: "lead" } | null;

export function PricingPage({ success }: { success?: boolean }) {
  const lang = useLang();
  const tx = COPY[lang];
  const [pricing, setPricing] = useState<PublicPricing | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>("month");
  const [me, setMe] = useState<BillingMe | null>(null);
  const [flow, setFlow] = useState<Flow>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    billingApi.plans().then(setPricing).catch(() => undefined);
    billingApi.me().then(setMe).catch(() => undefined);
    const params = new URLSearchParams(location.search);
    if (params.get("checkout") === "canceled") setNotice(COPY[lang].canceledCheckout);
    track("pricing_viewed", { source: params.get("from") ?? (document.referrer ? "referrer" : "direct") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const plan = (id: PlanId) => pricing?.plans.find((p) => p.id === id);
  const subscribed = me && !me.comped && ["active", "trialing", "past_due"].includes(me.status);

  const choose = async (id: Paid, founding = false) => {
    track(founding ? "founding_offer_selected" : "plan_selected", { plan: id, cycle });
    if (!pricing?.checkoutEnabled) return setFlow({ kind: "lead" });
    // Logged-in customers: change plan (prorated) or subscribe their existing workspace.
    if (me && !me.comped) {
      setBusy(id);
      try {
        if (subscribed) {
          await billingApi.changePlan(id, cycle);
          location.href = "/?view=billing";
        } else {
          location.href = (await billingApi.checkout({ plan: id, cycle, founding, source: "pricing" })).url;
        }
      } catch (e) {
        setNotice(errorText(e instanceof ApiError ? e.code : "internal_error", lang));
      } finally {
        setBusy(null);
      }
      return;
    }
    setFlow({ kind: "signup", plan: id, founding });
  };

  if (success) return <SuccessPage />;

  return (
    <div className="pricing">
      <header className="pricing-top">
        <a href="/" aria-label="Novus Live">
          <BrandLogo />
        </a>
        <span className="spacer" />
        <LangToggle />
        <a className="btn sm ghost" href="/">
          {tx.login}
        </a>
      </header>

      <section className="pricing-hero">
        <h1>{tx.heroTitle}</h1>
        <p>{tx.heroSub}</p>
        <div className="cycle-toggle" role="radiogroup" aria-label="Billing">
          {(["month", "year"] as const).map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={cycle === c}
              className={cycle === c ? "on" : ""}
              onClick={() => {
                setCycle(c);
                track("billing_cycle_changed", { cycle: c });
              }}
            >
              {c === "month" ? tx.monthly : tx.yearly}
              {c === "year" ? <span className="save">{tx.twoFree}</span> : null}
            </button>
          ))}
        </div>
        {notice ? <div className="pricing-notice">{notice}</div> : null}
      </section>

      {!pricing ? (
        <div className="pricing-loading">…</div>
      ) : (
        <>
          <section className="plan-grid">
            {CARDS.filter((id) => plan(id)?.available).map((id) => (
              <PlanCard key={id} id={id} pricing={pricing} cycle={cycle} lang={lang} current={me?.plan === id && !me.comped && Boolean(subscribed)} busy={busy === id} onChoose={choose} />
            ))}
          </section>

          <EnterpriseBand lang={lang} onTalk={() => setFlow({ kind: "lead" })} />
          <AgencyRoi lang={lang} pricing={pricing} onStart={() => choose("agency", pricing.founding.available && cycle === "month")} />
          <Compare lang={lang} pricing={pricing} />
          <Faq lang={lang} />
        </>
      )}

      <footer className="pricing-foot small muted">NOVUS LIVE · {lang === "fr" ? "Prix TTC en euros. Paiement sécurisé par Stripe." : "Prices in euros, tax included. Secure payment by Stripe."}</footer>

      {flow?.kind === "signup" && pricing ? <SignupSheet plan={flow.plan} founding={flow.founding} cycle={cycle} pricing={pricing} onClose={() => setFlow(null)} /> : null}
      {flow?.kind === "lead" ? <LeadSheet lang={lang} intro={pricing?.checkoutEnabled ? undefined : tx.checkoutOff} onClose={() => setFlow(null)} /> : null}
    </div>
  );
}

function PlanCard({ id, pricing, cycle, lang, current, busy, onChoose }: { id: Paid; pricing: PublicPricing; cycle: BillingCycle; lang: Lang; current: boolean; busy: boolean; onChoose: (id: Paid, founding?: boolean) => void }) {
  const tx = COPY[lang];
  const p = pricing.plans.find((x) => x.id === id)!;
  const [open, setOpen] = useState(false);
  const items = highlights(id, p.entitlements, lang);
  const shown = open ? items : items.slice(0, 6);
  const founding = id === "agency" && pricing.founding.available && cycle === "month";
  const amount = cycle === "month" ? p.monthly! : p.yearly!;
  const perMonth = cycle === "month" ? amount : amount / 12;
  const creators = p.entitlements.creator_limit;
  const isAgency = id === "agency" || id === "agency_pro";
  const copy = PLAN_COPY[id][lang];

  return (
    <article
      className={`plan-card ${id === "creator_pro" ? "popular" : ""} ${isAgency ? "agency" : ""} ${id === "agency" ? "featured" : ""}`}
      onMouseEnter={() => track("plan_viewed", { plan: id, cycle })}
    >
      <div className="plan-badges">
        {id === "creator_pro" ? <span className="plan-badge">{tx.mostPopular}</span> : null}
        {id === "agency" ? <span className="plan-badge gold">{tx.bestValue}</span> : null}
        {founding ? <span className="plan-badge founding">{tx.foundingBadge}</span> : null}
      </div>
      <h2 className="plan-name">{PLAN_NAMES[id]}</h2>
      <p className="plan-tag">{copy.tag}</p>

      <div className="plan-price">
        {founding ? (
          <>
            <div className="price-strike">
              {euro(p.monthly!, lang)}
              {tx.perMonth}
            </div>
            <div className="price-main">
              {euro(pricing.founding.monthly, lang)}
              <small>{tx.perMonth}</small>
            </div>
            <div className="price-note">{tx.foundingLine(euro(pricing.founding.monthly, lang), pricing.founding.months)}</div>
            <div className="price-note muted">{tx.foundingThen(euro(p.monthly!, lang))}</div>
          </>
        ) : (
          <>
            <div className="price-main">
              {euro(amount, lang)}
              <small>{cycle === "month" ? tx.perMonth : tx.perYear}</small>
            </div>
            {cycle === "year" ? <div className="price-note">{tx.billedYearly(euro(amount, lang))} · {tx.approxMonth(euro(perMonth, lang, 2))}</div> : null}
          </>
        )}
      </div>

      {isAgency ? (
        <div className="plan-anchor">
          <b>{tx.creatorsIncluded(creators)}</b>
          <span>
            {id === "agency_pro"
              ? tx.underPerCreator(euro(1000, lang))
              : tx.perCreator(euro((founding ? pricing.founding.monthly : perMonth) / creators, lang, 2))}
          </span>
        </div>
      ) : null}

      {founding ? (
        <div className="founding-box">
          <div>{tx.foundingLimited(pricing.founding.capacity)}</div>
          {pricing.founding.remaining !== null ? <b>{tx.foundingLeft(pricing.founding.remaining)}</b> : null}
        </div>
      ) : id === "agency" && pricing.founding.available && cycle === "year" ? (
        <div className="small muted">{tx.foundingMonthlyOnly}</div>
      ) : null}

      {current ? (
        <button className="btn block" disabled>
          {tx.current}
        </button>
      ) : (
        <button className={`btn block ${id === "agency" || id === "creator_pro" ? "gold" : ""}`} onClick={() => onChoose(id, founding)} disabled={busy}>
          {busy ? "…" : founding ? tx.foundingCta : copy.cta}
        </button>
      )}
      {founding && !current ? (
        <button className="link-btn" onClick={() => onChoose(id, false)}>
          {tx.standardAgency}
        </button>
      ) : null}
      <div className="plan-trial small muted">{p.trialDays ? tx.trial(p.trialDays) : tx.noTrial}</div>

      <ul className="plan-features">
        {shown.map((f) => (
          <li key={f.text}>
            <span className="tick">✓</span>
            <span>
              {f.text}
              {f.soon ? <em className="soon"> · {tx.rollingOut}</em> : null}
            </span>
          </li>
        ))}
      </ul>
      {items.length > 6 ? (
        <button className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? tx.hideAll : tx.seeAll}
        </button>
      ) : null}
    </article>
  );
}

function EnterpriseBand({ lang, onTalk }: { lang: Lang; onTalk: () => void }) {
  const tx = COPY[lang];
  return (
    <section className="enterprise">
      <div>
        <div className="plan-badge">{tx.enterpriseTitle.toUpperCase()}</div>
        <div className="price-main" style={{ marginTop: 8 }}>
          {tx.enterprisePrice}
        </div>
        <p className="plan-tag">{tx.enterpriseSub}</p>
      </div>
      <ul className="plan-features two-col">
        {tx.enterpriseFeatures.map((f) => (
          <li key={f}>
            <span className="tick">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button className="btn" onClick={onTalk}>
        {tx.talk}
      </button>
    </section>
  );
}

function AgencyRoi({ lang, pricing, onStart }: { lang: Lang; pricing: PublicPricing; onStart: () => void }) {
  const tx = COPY[lang];
  const agency = pricing.plans.find((p) => p.id === "agency")!;
  return (
    <section className="roi">
      <h2>{tx.roiTitle}</h2>
      <p>{tx.roiSub}</p>
      <ul className="plan-features two-col">
        {tx.roiPoints.map((f) => (
          <li key={f}>
            <span className="tick">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="roi-price">
        <b>{tx.roiPrice(euro(agency.monthly!, lang))}</b>
        <span>{tx.perCreator(euro(agency.monthly! / agency.entitlements.creator_limit, lang, 2))}</span>
      </div>
      <button className="btn gold" onClick={onStart}>
        {pricing.founding.available ? tx.foundingCta : PLAN_COPY.agency[lang].cta}
      </button>
    </section>
  );
}

function Compare({ lang, pricing }: { lang: Lang; pricing: PublicPricing }) {
  const tx = COPY[lang];
  const [pick, setPick] = useState<Paid>("agency");
  const ent = (id: Paid) => pricing.plans.find((p) => p.id === id)!.entitlements;
  return (
    <section className="compare">
      <h2>{tx.compareTitle}</h2>
      {/* Phones: one plan at a time. */}
      <div className="compare-mobile">
        <div className="cycle-toggle small-toggle" role="radiogroup">
          {CARDS.map((id) => (
            <button key={id} role="radio" aria-checked={pick === id} className={pick === id ? "on" : ""} onClick={() => setPick(id)}>
              {PLAN_NAMES[id]}
            </button>
          ))}
        </div>
        {COMPARE.map((g) => (
          <div key={g.title.en} className="compare-group">
            <h3>{g.title[lang]}</h3>
            {g.rows.map((r) => (
              <div key={r.label.en} className="compare-row">
                <span>{r.label[lang]}</span>
                <b>{r.value(ent(pick), pick, lang)}</b>
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Wider screens: the full table. */}
      <table className="compare-table">
        <thead>
          <tr>
            <th />
            {CARDS.map((id) => (
              <th key={id} className={id === "agency" ? "featured" : ""}>
                {PLAN_NAMES[id]}
              </th>
            ))}
          </tr>
        </thead>
        {COMPARE.map((g) => (
          <tbody key={g.title.en}>
            <tr className="group">
              <td colSpan={5}>{g.title[lang]}</td>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.label.en}>
                <td>{r.label[lang]}</td>
                {CARDS.map((id) => (
                  <td key={id} className={id === "agency" ? "featured" : ""}>
                    {r.value(ent(id), id, lang)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </section>
  );
}

function Faq({ lang }: { lang: Lang }) {
  const tx = COPY[lang];
  return (
    <section className="faq">
      <h2>{tx.faqTitle}</h2>
      {FAQ[lang].map(([q, a]) => (
        <details key={q}>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
    </section>
  );
}

function SignupSheet({ plan, founding, cycle, pricing, onClose }: { plan: Paid; founding: boolean; cycle: BillingCycle; pricing: PublicPricing; onClose: () => void }) {
  const lang = useLang();
  const tx = COPY[lang];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const trialDays = pricing.plans.find((p) => p.id === plan)?.trialDays ?? 0;
  const valid = name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await billingApi.signup({ name: name.trim(), email: email.trim(), plan, cycle, founding, source: "pricing" });
      setResult({ code: r.code, url: r.checkoutUrl });
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : "internal_error", lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={tx.signTitle(PLAN_NAMES[plan])}>
      <div className="sheet-card">
        {!result ? (
          <>
            <h3>{tx.signTitle(PLAN_NAMES[plan])}</h3>
            {founding ? <div className="plan-badge founding">{tx.foundingBadge}</div> : null}
            <label className="small muted">{tx.wsName}</label>
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
            <label className="small muted">{tx.email}</label>
            <input className="input" type="email" value={email} maxLength={120} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <p className="small muted">{tx.cardNote(trialDays)}</p>
            {error ? <div className="small" style={{ color: "var(--r-critical)" }}>{error}</div> : null}
            <div className="row">
              <button className="btn gold" onClick={submit} disabled={!valid || busy}>
                {busy ? "…" : tx.continue}
              </button>
              <button className="btn ghost" onClick={onClose} disabled={busy}>
                {tx.cancel}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>{tx.codeTitle}</h3>
            <p className="small muted">{tx.codeHint}</p>
            <div className="code-box">
              <div className="code">{result.code}</div>
              <button
                className="btn sm gold"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result.code);
                    setCopied(true);
                  } catch {
                    /* select by hand */
                  }
                }}
              >
                {copied ? tx.copied : tx.copy}
              </button>
            </div>
            <button className="btn gold block" onClick={() => (location.href = result.url)}>
              {tx.saved}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function LeadSheet({ lang, intro, onClose }: { lang: Lang; intro?: string; onClose: () => void }) {
  const tx = COPY[lang];
  const [f, setF] = useState({ name: "", email: "", company: "", creators: "50", message: "" });
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const valid = f.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) && f.company.trim();
  const send = async () => {
    setState("busy");
    try {
      await billingApi.lead({ name: f.name.trim(), email: f.email.trim(), company: f.company.trim(), creators: Number(f.creators) || 0, message: f.message.trim() || undefined });
      setState("sent");
    } catch {
      setState("error");
    }
  };
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={tx.leadTitle}>
      <div className="sheet-card">
        <h3>{tx.leadTitle}</h3>
        {state === "sent" ? (
          <>
            <p>{tx.leadSent}</p>
            <button className="btn block" onClick={onClose}>
              OK
            </button>
          </>
        ) : (
          <>
            {intro ? <p className="small muted">{intro}</p> : null}
            <input className="input" placeholder={tx.wsName} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <input className="input" type="email" placeholder={tx.email} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <input className="input" placeholder={tx.company} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
            <input className="input" inputMode="numeric" placeholder={tx.creators} value={f.creators} onChange={(e) => setF({ ...f, creators: e.target.value.replace(/\D/g, "") })} />
            <textarea className="input" rows={3} placeholder={tx.message} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
            {state === "error" ? <div className="small" style={{ color: "var(--r-critical)" }}>{errorText("internal_error", lang)}</div> : null}
            <div className="row">
              <button className="btn gold" onClick={send} disabled={!valid || state === "busy"}>
                {state === "busy" ? "…" : tx.send}
              </button>
              <button className="btn ghost" onClick={onClose}>
                {tx.cancel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** After Stripe Checkout: wait for the webhook to activate the workspace. */
function SuccessPage() {
  const lang = useLang();
  const tx = COPY[lang];
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      for (let i = 0; i < 30 && !stop; i++) {
        try {
          const me = await billingApi.me();
          if (["trialing", "active"].includes(me.status)) {
            setReady(true);
            return;
          }
        } catch {
          /* not logged in on this device */
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void poll();
    return () => {
      stop = true;
    };
  }, []);
  const body = useMemo(() => (ready ? tx.successReady : tx.successBody), [ready, tx]);
  return (
    <div className="pricing">
      <section className="pricing-hero">
        <BrandLogo />
        <h1>{tx.successTitle}</h1>
        <p>{body}</p>
        <a className="btn gold" href="/">
          {tx.open}
        </a>
      </section>
    </div>
  );
}
