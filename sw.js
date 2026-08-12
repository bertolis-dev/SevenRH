// Service worker minimal — sert uniquement à rendre Nexus installable comme application (PWA),
// condition technique attendue par Chrome/Edge/Android pour proposer l'installation (voir
// telecharger.html). Volontairement SANS cache : chaque requête part directement au réseau, pour ne
// pas réintroduire le problème de version obsolète qu'on vient de corriger avec le cache-busting
// (voir index.html, ?v=...) — un cache ici servirait une ancienne version d'app.js/data.js.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
