// bump isso a cada deploy relevante: força limpar cache velho do celular
const CACHE_VERSION = "v129";
const CACHE_NAME = `saudometro-${CACHE_VERSION}`;

// o "casco" do app: guardado no aparelho pra o app abrir mesmo sem internet
// (os dados em si vêm do banco, então sem internet o app mostra o aviso de conexão em vez de tela em branco).
// O teste tests/arquivos.test.mjs garante que esta lista está completa e sem arquivo faltando.
const SHELL = [
  "./", "index.html", "manifest.json", "privacidade.html", "termos.html", "excluir-conta.html", "creditos.html", "icons/icon.png", "icons/icon-maskable.png",
  "img/capa-app.webp", "img/tema/namorados.webp", "img/tema/natal.webp", "img/tema/anonovo.webp", "img/tema/halloween.webp", "img/capi/thug.webp", "img/capi/brava.webp", "img/capi/confusa.webp", "img/capi/apaixonada.webp", "img/capi/dormindo.webp", "img/capi/gamer.webp", "img/capi/laptop.webp", "img/capi/leitura.webp", "img/capi/pipoca.webp", "img/capi/fitness.webp", "img/capi/mochila.webp", "img/capi/cafe.webp", "img/capi/festa.webp", "img/capi/oi.webp", "img/capi/envergonhada.webp",
  "css/fonts.css", "css/styles.css",
  "fonts/baloo2-latin-ext.woff2", "fonts/baloo2-latin.woff2", "fonts/nunito-latin-ext.woff2", "fonts/nunito-latin.woff2", "fonts/bricolage-latin.woff2", "fonts/dmsans-latin.woff2",
  "js/app.js", "js/promos.js", "js/saudade.js", "js/vitrine.js", "js/bookCards.js", "js/books.js", "js/captcha.js", "js/challenges.js", "js/changelog.js", "js/cycle.js", "js/db.js", "js/errors.js", "js/friends.js", "js/friendsPerks.js", "js/gameRooms.js", "js/icons.js", "js/install.js", "js/moods.js",
  "js/nudges.js", "js/people.js", "js/perks.js", "js/photo.js", "js/plans.js", "js/push.js", "js/questions.js", "js/supabaseClient.js",
  "js/theme.js", "js/util.js", "js/vendor/supabase.js",
  "js/games/starBattle.js", "js/games/starBattleLevels.js", "js/games/cardGame.js", "js/games/stopGame.js", "js/games/capisurpresa.js", "js/games/capmart.js",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .catch(() => {}) // sem rede na instalação: o cache vai enchendo conforme o app é usado
  );
});

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
// atualizava reinstalando o app). Sem internet, usa o que está guardado.
// Fontes não mudam: cache primeiro (abre mais rápido).
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      if (url.pathname.includes("/fonts/")) {
        const hit = await caches.match(req);
        if (hit) return hit;
      }
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        if (fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cached = (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));
        if (cached) return cached;
        if (req.mode === "navigate") {
          const shell = await caches.match("index.html");
          if (shell) return shell;
        }
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
