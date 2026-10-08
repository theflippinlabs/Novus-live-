// NOVUS LIVE service worker: app-shell caching for installability and fast start, and push
// notifications (with the red badge on the home-screen icon).
// API calls and the realtime stream are never cached.
const CACHE = "novus-live-v4";
const SHELL = ["/", "/manifest.webmanifest", "/icons/logo-mark.png", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    // Network first so deploys are picked up; fall back to the cached shell offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

// ---------------------------------------------------------------- push notifications

async function refreshBadge() {
  const shown = await self.registration.getNotifications();
  if (!self.navigator.setAppBadge) return;
  if (shown.length) await self.navigator.setAppBadge(shown.length);
  else await self.navigator.clearAppBadge?.();
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "NOVUS LIVE", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "NOVUS LIVE";
  event.waitUntil(
    self.registration
      .showNotification(title, {
        body: data.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: data.tag || undefined,
        renotify: Boolean(data.tag),
        data: { url: data.url || "/" },
      })
      .then(refreshBadge),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) {
        await win.focus();
        win.postMessage({ type: "novus:open", url });
      } else await self.clients.openWindow(url);
      await refreshBadge();
    })(),
  );
});

// The app is on screen: its notifications are read.
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "novus:seen") return;
  event.waitUntil(
    (async () => {
      for (const n of await self.registration.getNotifications()) n.close();
      await self.navigator.clearAppBadge?.();
    })(),
  );
});
