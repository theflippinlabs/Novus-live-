import { api } from "./api";

/*
 * Web push on this device. iPhone: only in the app added to the home screen (iOS 16.4+),
 * and the permission must be asked from a tap.
 */

export interface PushPrefs {
  live: boolean;
  alerts: boolean;
  summary: boolean;
}

export type PushSupport = "ok" | "unsupported" | "install" | "denied";

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  if (isIOS() && !standalone()) return "install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ok";
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? navigator.serviceWorker.register("/sw.js");
}

function keyBytes(base64url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** This device's subscription, if notifications are on. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  return (await registration()).pushManager.getSubscription();
}

/** Ask the permission (must run from a tap) and register this device. */
export async function enablePush(prefs: PushPrefs): Promise<PushPrefs> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "push_denied" : "push_dismissed");
  const { publicKey } = await api.pushConfig();
  if (!publicKey) throw new Error("push_unavailable");
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  return (await api.pushSubscribe({ endpoint: json.endpoint, keys: json.keys }, prefs)).prefs;
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

/** The app is on screen: clear the icon badge and the notifications already shown. */
export function markNotificationsSeen(): void {
  try {
    (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.().catch(() => undefined);
    navigator.serviceWorker?.controller?.postMessage({ type: "novus:seen" });
  } catch {
    /* not supported */
  }
}
