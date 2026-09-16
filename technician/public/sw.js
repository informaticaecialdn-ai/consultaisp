// Não armazenar respostas da API, fotos ou sessão em cache compartilhado do dispositivo.
const CACHE = "technician-offline-v1";
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE).then(cache => cache.add("/offline.html"))); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", event => {
  if (event.request.mode === "navigate") event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
});
