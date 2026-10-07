# NOVUS LIVE sur l'App Store — mode d'emploi

L'app iPhone/iPad ouvre le vrai NOVUS LIVE (toujours à jour, sans nouvelle version à publier),
avec en plus les notifications natives. Aucun achat dans l'app (règle Apple) : les abonnements
se prennent sur le site.

## Une seule fois (≈ 15 min)

1. **Créer l'app** — [App Store Connect](https://appstoreconnect.apple.com) › Apps › **+** › Nouvelle app
   - Plateforme : iOS · Nom : NOVUS LIVE · Langue : Français
   - Identifiant de lot (Bundle ID) : `com.novuslive.app` (le créer s'il est proposé)
   - SKU : `novuslive`
2. **Clé App Store Connect** (pour que GitHub envoie l'app) — App Store Connect › Utilisateurs et accès ›
   Intégrations › Clés › **+** (accès : Admin). Télécharger le fichier `AuthKey_XXXX.p8` (une seule fois possible).
3. **GitHub** — dépôt › Settings › Secrets and variables › Actions › **New repository secret**, 4 fois :
   - `APPLE_TEAM_ID` — developer.apple.com › Compte › Membership (10 caractères)
   - `ASC_KEY_ID` — l'ID de la clé (colonne « ID de clé »)
   - `ASC_ISSUER_ID` — « ID de l'émetteur » en haut de la page des clés
   - `ASC_KEY_P8` — ouvrir le fichier `.p8` avec Bloc-notes/TextEdit, tout copier-coller
4. **Notifications iPhone** — developer.apple.com › Certificates, IDs & Profiles › Keys › **+** ›
   cocher *Apple Push Notifications service (APNs)* › télécharger le `.p8`. Puis dans **Railway › Variables** :
   `APNS_KEY_ID` (ID de cette clé), `APNS_TEAM_ID` (même Team ID), `APNS_KEY` (contenu du `.p8`).

Ne jamais coller ces clés dans un chat ou un e-mail.

## Envoyer une version sur TestFlight

GitHub › Actions › **iOS → TestFlight** › Run workflow (version : `1.0`). Environ 15 min de compilation,
puis 10–30 min de traitement chez Apple : la version apparaît dans App Store Connect › TestFlight.

## Fiche App Store

- Captures : dossier `ios/appstore/` (iPhone 6,9" et iPad 13").
- Confidentialité : `https://novus-live-production.up.railway.app/privacy`
- Catégorie : Productivité (ou Réseaux sociaux) · Âge : 17+ (contenus de chat non filtrés affichés).
- **Compte de démonstration pour Apple** (obligatoire) : un code d'accès à un espace de test, à mettre
  dans « Informations de vérification de l'app ».
