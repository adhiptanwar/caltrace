// Minimal service worker for web push notifications.
// Intentionally does NOT cache the app shell (no offline behavior).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Trace", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Trace";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "trace-reminder",
    data: { url: data.url || "/app", reload: data.reload === true },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const baseUrl = data.url || "/app";
  const url = data.reload
    ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}updated=${Date.now()}`
    : baseUrl;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            return client
              .navigate(url)
              .then((navigatedClient) => (navigatedClient || client).focus());
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
  );
});
