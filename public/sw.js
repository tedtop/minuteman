// The service worker has been removed - both pages require a live
// connection to QT/Supabase to show anything useful, so there was never
// a real offline mode to support, only a recurring source of stale-shell
// bugs (old CSS/HTML served cache-first). This file now just cleans up
// after itself for anyone who still has the old one installed: clear its
// caches, unregister, and reload any open tabs so they load straight
// from the network from here on. Once existing installs have cycled
// through this, the file (and the now-dead registration code that used
// to point at it) can be deleted entirely.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => client.navigate(client.url));
    })()
  );
});
