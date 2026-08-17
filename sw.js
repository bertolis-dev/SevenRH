// Service worker minimal — sert uniquement à rendre Nexus installable comme application (PWA),
// condition technique attendue par Chrome/Edge/Android pour proposer l'installation (voir
// renderLandingScreen dans app.js). Volontairement SANS cache : chaque requête part directement au
// réseau, pour ne pas réintroduire le problème de version obsolète qu'on vient de corriger avec le
// cache-busting (voir index.html, ?v=...) — un cache ici servirait une ancienne version d'app.js/data.js.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  // Uniquement les GET same-origin passent par ce handler (juste pour satisfaire "il existe un
  // handler fetch", condition d'installabilité PWA sur certains navigateurs) — tout le reste ne
  // doit JAMAIS être intercepté. En particulier un POST cross-origin avec un corps réel (FormData
  // contenant un fichier choisi sur l'appareil, voir submitCandidature) rejoué via
  // event.respondWith(fetch(event.request)) peut arriver corrompu côté serveur sur mobile (observé
  // : "Corps de requête invalide" sur Chrome Android, reproductible même en navigation privée,
  // donc pas un problème de cache) — pour un gain nul puisque ce service worker ne met rien en cache.
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(fetch(event.request));
});
