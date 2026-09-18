self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: "Saudômetro", body: event.data?.text() || "" }; }

  const title = data.title || "Saudômetro";
  const options = {
    body: data.body || "",
    icon: "icons/icon.png",
    badge: "icons/icon.png",
    data: { url: data.url || "./" },
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
      for (const client of list) {
        if (client.url.includes(self.registration.scope)) {
          // já tá aberto: navega pra tela certa em vez de só trazer pra frente
          if ("navigate" in client) {
            try { await client.navigate(url); } catch (e) { /* alguns navegadores recusam, segue pro focus */ }
          }
          if ("focus" in client) return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
