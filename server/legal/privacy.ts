/*
 * Privacy policy (public page /privacy, linked from the App Store listing and the app).
 * It describes what NOVUS LIVE really processes; keep it in sync with the product.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function privacyPage(opts: { supportEmail?: string; updated: { fr: string; en: string }; lang: "fr" | "en" }): string {
  const fr = opts.lang === "fr";
  const mail = opts.supportEmail ? `<a href="mailto:${esc(opts.supportEmail)}">${esc(opts.supportEmail)}</a>` : null;
  const contact = mail ?? (fr ? "le support depuis l'application" : "support from within the app");
  const toggle = `<nav class="lang"><a href="?lang=fr" class="${fr ? "on" : ""}">FR</a><a href="?lang=en" class="${fr ? "" : "on"}">EN</a></nav>`;
  const body = fr
    ? `<h1>NOVUS LIVE — Politique de confidentialité</h1>
<p class="muted">Dernière mise à jour : ${esc(opts.updated.fr)}</p>
<p>NOVUS LIVE est un outil de modération et de statistiques pour les LIVE TikTok, utilisé par des créateurs, des modérateurs et des agences. Cette page explique quelles données l'application traite, pourquoi, et vos droits.</p>
<h2>1. Données de votre compte</h2>
<p>Nom de l'espace, nom et e-mail du responsable, noms des membres de l'équipe et leurs autorisations, codes d'accès (stockés uniquement sous forme hachée). Elles servent à vous connecter et à gérer l'équipe.</p>
<h2>2. Données des LIVE TikTok suivis</h2>
<p>Pour les comptes TikTok que vous choisissez de suivre, l'application reçoit les informations <b>publiques</b> de leurs LIVE : commentaires, pseudos et photos de profil des spectateurs, cadeaux, abonnements, nombre de spectateurs, et les événements de sécurité envoyés par TikTok. Elles servent à la modération (détection de messages dangereux), aux alertes, à l'historique et aux statistiques. Elles sont conservées selon la durée d'historique de votre formule, puis supprimées.</p>
<h2>3. Vidéos des LIVE (option)</h2>
<p>Si l'option Vidéo est activée pour un compte (avec le consentement du créateur), la vidéo du LIVE est enregistrée et stockée pendant la durée prévue par l'option (30 jours par défaut), sauf si vous choisissez de la garder. Des sous-titres peuvent être produits à votre demande.</p>
<h2>4. Intelligence artificielle</h2>
<p>Pour analyser les commentaires, répondre au copilote, traduire et sous-titrer, des extraits de texte (et, pour les sous-titres, le son de la vidéo) sont envoyés à nos prestataires d'IA : Anthropic (Claude), OpenAI (secours) et ElevenLabs (transcription). Ces données ne servent pas à faire de la publicité.</p>
<h2>5. Notifications</h2>
<p>Si vous activez les notifications, nous conservons l'identifiant technique de votre appareil (jeton Apple ou du navigateur) pour vous envoyer les alertes que vous avez choisies. Vous pouvez les couper à tout moment dans Réglages › Notifications.</p>
<h2>6. Paiement</h2>
<p>Les abonnements sont gérés par Stripe sur notre site. Nous ne voyons ni ne stockons votre numéro de carte. L'application iPhone ne propose aucun achat.</p>
<h2>7. Prestataires</h2>
<p>Hébergement et base de données : Railway, Supabase. Connexion aux LIVE TikTok : Euler Stream. E-mails : Resend. Paiement : Stripe. IA : Anthropic, OpenAI, ElevenLabs. Ils traitent les données uniquement pour fournir le service ; certains peuvent être situés hors de l'Union européenne, avec les garanties prévues par le RGPD.</p>
<h2>8. Ce que nous ne faisons pas</h2>
<p>Pas de publicité, pas de revente de données, pas de suivi publicitaire entre applications. NOVUS LIVE n'identifie jamais qui a signalé un LIVE : TikTok ne le communique pas.</p>
<h2>9. Vos droits</h2>
<p>Vous pouvez demander l'accès, la correction, l'export ou la suppression de vos données et de votre espace, ou vous opposer à un traitement, en écrivant à ${contact}. Vous pouvez aussi saisir la CNIL.</p>`
    : `<h1>NOVUS LIVE — Privacy policy</h1>
<p class="muted">Last updated: ${esc(opts.updated.en)}</p>
<p>NOVUS LIVE is a moderation and analytics tool for TikTok LIVE, used by creators, moderators and agencies. This page explains what data the app processes, why, and your rights.</p>
<h2>1. Your account data</h2>
<p>Workspace name, owner name and e-mail, team members' names and permissions, access codes (stored only as hashes). They are used to sign you in and manage your team.</p>
<h2>2. Data from the TikTok LIVEs you follow</h2>
<p>For the TikTok accounts you choose to follow, the app receives the <b>public</b> information of their LIVEs: comments, viewers' usernames and profile pictures, gifts, follows, viewer counts, and safety events sent by TikTok. They are used for moderation (detecting harmful messages), alerts, history and statistics. They are kept for your plan's history period, then deleted.</p>
<h2>3. LIVE videos (option)</h2>
<p>When the Video option is on for an account (with the creator's consent), the LIVE video is recorded and stored for the option's period (30 days by default), unless you choose to keep it. Subtitles can be produced on request.</p>
<h2>4. Artificial intelligence</h2>
<p>To analyse comments, answer the copilot, translate and subtitle, excerpts of text (and, for subtitles, the video's audio) are sent to our AI providers: Anthropic (Claude), OpenAI (backup) and ElevenLabs (transcription). This data is not used for advertising.</p>
<h2>5. Notifications</h2>
<p>If you turn notifications on, we keep your device's technical identifier (Apple or browser token) to send you the alerts you chose. You can turn them off at any time in Settings › Notifications.</p>
<h2>6. Payment</h2>
<p>Subscriptions are handled by Stripe on our website. We never see or store your card number. The iPhone app offers no purchase.</p>
<h2>7. Service providers</h2>
<p>Hosting and database: Railway, Supabase. TikTok LIVE connection: Euler Stream. E-mail: Resend. Payment: Stripe. AI: Anthropic, OpenAI, ElevenLabs. They process data only to provide the service; some may be located outside the European Union, with the safeguards required by the GDPR.</p>
<h2>8. What we don't do</h2>
<p>No advertising, no sale of data, no cross-app advertising tracking. NOVUS LIVE never identifies who reported a LIVE: TikTok does not disclose it.</p>
<h2>9. Your rights</h2>
<p>You can ask to access, correct, export or delete your data and your workspace, or object to a processing, by writing to ${contact}. You can also complain to your data protection authority (CNIL in France).</p>`;
  return `<!doctype html>
<html lang="${opts.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fr ? "NOVUS LIVE — Confidentialité" : "NOVUS LIVE — Privacy"}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #070708; color: #e9e4da; font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 18px 64px; }
  h1 { color: #e6c07f; letter-spacing: .06em; font-size: 22px; }
  h2 { color: #e6c07f; font-size: 17px; margin-top: 28px; }
  a { color: #e6c07f; }
  .muted { color: #9a9488; font-size: 14px; }
  .lang { display: flex; justify-content: flex-end; gap: 6px; }
  .lang a { padding: 6px 14px; border: 1px solid #3a352d; border-radius: 99px; text-decoration: none; font-weight: 700; color: #9a9488; }
  .lang a.on { background: #e6c07f; color: #070708; border-color: #e6c07f; }
</style>
</head>
<body><main>
${toggle}
${body}
</main></body></html>`;
}
