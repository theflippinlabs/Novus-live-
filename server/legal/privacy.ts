/*
 * Privacy policy (public page /privacy, linked from the App Store listing and the app).
 * It describes what NOVUS LIVE really processes; keep it in sync with the product.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function privacyPage(opts: { supportEmail?: string; updated: string }): string {
  const contact = opts.supportEmail ? `<a href="mailto:${esc(opts.supportEmail)}">${esc(opts.supportEmail)}</a>` : "le formulaire « Code perdu » de l'application / the in-app support";
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NOVUS LIVE — Confidentialité / Privacy</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #070708; color: #e9e4da; font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 18px 64px; }
  h1 { color: #e6c07f; letter-spacing: .08em; font-size: 22px; }
  h2 { color: #e6c07f; font-size: 17px; margin-top: 28px; }
  a { color: #e6c07f; }
  .muted { color: #9a9488; font-size: 14px; }
  hr { border: 0; border-top: 1px solid #2a2722; margin: 40px 0; }
</style>
</head>
<body><main>
<h1>NOVUS LIVE — Politique de confidentialité</h1>
<p class="muted">Dernière mise à jour : ${esc(opts.updated)}</p>

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
<p>Si vous activez les notifications, nous conservons l'identifiant technique de votre appareil (jeton Apple/navigateur) pour vous envoyer les alertes que vous avez choisies. Vous pouvez les couper à tout moment dans Réglages › Notifications.</p>

<h2>6. Paiement</h2>
<p>Les abonnements sont gérés par Stripe sur notre site. Nous ne voyons ni ne stockons votre numéro de carte. L'application iPhone ne propose aucun achat.</p>

<h2>7. Prestataires</h2>
<p>Hébergement et base de données : Railway, Supabase. Connexion aux LIVE TikTok : Euler Stream. E-mails : Resend. Paiement : Stripe. IA : Anthropic, OpenAI, ElevenLabs. Ils traitent les données uniquement pour fournir le service ; certains peuvent être situés hors de l'Union européenne, avec les garanties prévues par le RGPD.</p>

<h2>8. Ce que nous ne faisons pas</h2>
<p>Pas de publicité, pas de revente de données, pas de suivi publicitaire entre applications. NOVUS LIVE n'identifie jamais qui a signalé un LIVE : TikTok ne le communique pas.</p>

<h2>9. Vos droits</h2>
<p>Vous pouvez demander l'accès, la correction, l'export ou la suppression de vos données et de votre espace, ou vous opposer à un traitement, en écrivant à ${contact}. Vous pouvez aussi saisir la CNIL.</p>

<hr>

<h1>NOVUS LIVE — Privacy policy</h1>
<p class="muted">Last updated: ${esc(opts.updated)}</p>
<p>NOVUS LIVE is a moderation and analytics tool for TikTok LIVE used by creators, moderators and agencies.</p>
<h2>What we process</h2>
<p><b>Account data</b> (workspace name, owner name and e-mail, team members and permissions, hashed access codes). <b>Public LIVE data</b> of the TikTok accounts you choose to follow (comments, viewer usernames and avatars, gifts, follows, viewer counts, safety events sent by TikTok), kept for your plan's history period. <b>LIVE videos</b> only when the Video option is on for an account (with the creator's consent), kept 30 days by default. <b>Device tokens</b> for the notifications you turn on.</p>
<h2>Why and with whom</h2>
<p>To moderate, alert, keep history and statistics. Text (and audio for subtitles) is sent to our AI providers Anthropic, OpenAI and ElevenLabs. Hosting: Railway, Supabase; TikTok connection: Euler Stream; e-mail: Resend; payments: Stripe on our website (the iPhone app sells nothing). No advertising, no sale of data, no cross-app tracking. NOVUS LIVE never identifies who reported a LIVE.</p>
<h2>Your rights</h2>
<p>Access, correction, export or deletion of your data and workspace: contact ${contact}.</p>
</main></body></html>`;
}
