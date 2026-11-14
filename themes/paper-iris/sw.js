// Amble has no offline service worker. Browsers that installed one from an earlier version of this site
// fetch this file when they check it for updates: this version clears that worker's caches, unregisters
// it and reloads open pages, so they load the current site from the network.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      for (const page of await self.clients.matchAll({ type: 'window' })) page.navigate(page.url);
    })(),
  );
});
