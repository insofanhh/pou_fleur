const CACHE = "fleur-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add("/offline.html")),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
          ),
        ),
      self.clients.claim(),
    ]),
  ),
);
// Network only for app/API data: never cache private pages, checkout or mutations.
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate" && event.request.method === "GET")
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/offline.html")),
    );
});
self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const p = event.data.json();
    event.waitUntil(
      self.registration.showNotification(p.title || "Fleur", {
        body: p.body || "",
        icon: "/icons/icon-192.png",
        data: { url: p.url || "/inbox" },
      }),
    );
  } catch {}
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let url = new URL(
    event.notification.data?.url || "/inbox",
    self.location.origin,
  );
  if (url.origin !== self.location.origin)
    url = new URL("/inbox", self.location.origin);
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const client = clients[0];
        if (client) {
          await client.navigate(url.href);
          return client.focus();
        }
        return self.clients.openWindow(url.href);
      }),
  );
});
