import type { CapacitorConfig } from "@capacitor/cli";

/*
 * NOVUS LIVE for iPhone / iPad (App Store). The native app opens the live NOVUS LIVE server, so
 * it is always up to date without a new App Store release; native parts: push notifications
 * (APNs), status bar, deep links from notifications.
 *
 * CAP_SERVER_URL: the server the app opens (default: the production server).
 * The bundle identifier can be overridden at build time (APP_BUNDLE_ID in the iOS workflow).
 */
const serverUrl = process.env.CAP_SERVER_URL ?? "https://novus-live-production.up.railway.app";

const config: CapacitorConfig = {
  appId: "com.novuslive.app",
  appName: "NOVUS LIVE",
  webDir: "dist/web",
  backgroundColor: "#070708",
  server: {
    url: serverUrl,
    cleartext: false,
    // Only the NOVUS LIVE server opens inside the app; anything else opens in Safari.
    allowNavigation: [new URL(serverUrl).host],
  },
  ios: {
    contentInset: "never",
    backgroundColor: "#070708",
    scheme: "NOVUS LIVE",
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
