// bump isso a cada deploy relevante: força limpar cache velho do celular
const CACHE_VERSION = "v2";
const CACHE_NAME = `saudometro-${CACHE_VERSION}`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// network-first: sempre tenta buscar a versão mais nova do app antes de usar cache
// (sem isso, o navegador do celular guardava index.html/app.js em cache e só
// atualizava reinstalando o app)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw e;
      }
    })()
  );
});

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
