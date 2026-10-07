/*
 * The App Store app (Capacitor) opens this same web app in a native shell. Here: knowing we're
 * in it, and its native parts — status bar, notifications (APNs) and opening their links.
 * Purchases are never offered in the native app (App Store rules): subscriptions are managed
 * on the website.
 */

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

export function isNativeApp(): boolean {
  try {
    return Boolean((window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

const ENDPOINT_KEY = "novus:apns-endpoint";

export function nativeEndpoint(): string | null {
  try {
    return localStorage.getItem(ENDPOINT_KEY);
  } catch {
    return null;
  }
}

export function setNativeEndpoint(endpoint: string | null): void {
  try {
    if (endpoint) localStorage.setItem(ENDPOINT_KEY, endpoint);
    else localStorage.removeItem(ENDPOINT_KEY);
  } catch {
    /* ignore */
  }
}

/** Ask the permission and get this iPhone's APNs device token. */
export async function nativePushToken(): Promise<string> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") throw new Error(perm.receive === "denied" ? "push_denied" : "push_dismissed");
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("push_failed")), 15_000);
    void PushNotifications.addListener("registration", (t) => {
      clearTimeout(timer);
      resolve(t.value);
    });
    void PushNotifications.addListener("registrationError", () => {
      clearTimeout(timer);
      reject(new Error("push_failed"));
    });
    void PushNotifications.register();
  });
}

/** Native setup on start: dark status bar, notification taps open their screen. */
export async function initNative(open: (url: string) => void, refresh: (token: string) => void): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
  } catch {
    /* plugin missing in an old build */
  }
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
      const url = (a.notification.data as { url?: unknown } | undefined)?.url;
      if (typeof url === "string" && url.startsWith("/")) open(url);
    });
    // Device tokens can change (restore, reinstall): keep the server's copy current.
    if (nativeEndpoint()) {
      await PushNotifications.addListener("registration", (t) => refresh(t.value));
      const perm = await PushNotifications.checkPermissions();
      if (perm.receive === "granted") await PushNotifications.register();
    }
  } catch {
    /* notifications unavailable */
  }
}
