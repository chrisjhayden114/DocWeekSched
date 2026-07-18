/* EventPilot service worker — cache agenda / My Agenda / session / maps once visited. */
const CACHE = "eventpilot-shell-v1";
const PRECACHE = ["/", "/dashboard", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => undefined)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

function shouldCachePath(pathname) {
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard?")) return true;
  if (pathname.startsWith("/session/")) return true;
  if (pathname === "/manifest.webmanifest") return true;
  if (pathname.startsWith("/icons/")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isNav = req.mode === "navigate";
  const cacheable = isNav || shouldCachePath(url.pathname);

  if (!cacheable) return;

  event.respondWith(
    (async () => {
      try {
        const network = await fetch(req);
        if (network && network.ok) {
          const copy = network.clone();
          const cache = await caches.open(CACHE);
          if (isNav) {
            // Cache dashboard + session navigations (includes Maps tab query on dashboard).
            if (url.pathname === "/dashboard" || url.pathname.startsWith("/session/")) {
              await cache.put(req, copy);
            }
          } else if (shouldCachePath(url.pathname)) {
            await cache.put(req, copy);
          }
        }
        return network;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (isNav) {
          const dash = await caches.match("/dashboard");
          if (dash) return dash;
        }
        return new Response("Offline — open Agenda, a session, or Maps once while online.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let title = "EventPilot";
  let body = "";
  let url = "/dashboard?tab=Notifications";
  try {
    const data = event.data ? event.data.json() : {};
    title = data.title || title;
    body = data.body || "";
    if (data.url) url = data.url;
  } catch {
    body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});
