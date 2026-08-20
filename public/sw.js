const CACHE_NAME = 'fuel-dispatch-b8f98801';
const urlsToCache = [
  '/fuel_dispatch.html',
  '/fuel_dispatch.css',
  '/common.css',
  '/manifest.json'
];

// Install event - cache resources
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log(`SW install: precaching app shell into "${CACHE_NAME}"`, urlsToCache);
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.log(`SW install: failed to precache "${CACHE_NAME}":`, error);
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        if (response) return response;
        return fetch(event.request).catch(() => {
          // Network unreachable (server down, offline, etc.) - respond with
          // a synthetic error instead of letting the fetch promise reject,
          // which would otherwise spam the console with unhandled rejections
          // for every in-flight request (e.g. the 30s dispatch poll).
          return new Response(JSON.stringify({ success: false, error: 'Network unreachable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        });
      })
  );
});

// Background sync for offline dispatch updates (future enhancement)
self.addEventListener('sync', event => {
  if (event.tag === 'dispatch-sync') {
    console.log('Background sync triggered');
    // Future: sync dispatch data when connection restored
  }
});

// Handle service worker updates
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log(`SW activate: purging stale cache "${cacheName}" (current is "${CACHE_NAME}")`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});