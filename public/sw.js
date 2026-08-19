const CACHE_NAME = 'fuel-dispatch-v4';
const urlsToCache = [
  '/fuel_dispatch.html',
  '/common.css',
  '/manifest.json'
];

// Install event - cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.log('Cache add failed:', error);
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
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});