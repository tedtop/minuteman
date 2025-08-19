const CACHE_NAME = 'fuel-dispatch-v1';
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
        return response || fetch(event.request);
      }
      )
  );
});

// Push event - handle incoming push notifications
self.addEventListener('push', event => {
  console.log('Push event received:', event);

  let title = '✈️ Fuel Dispatch';
  let options = {
    body: 'New notification received',
    icon: '✈️',
    tag: 'fuel-dispatch',
    requireInteraction: false
  };

  // Parse push data if available
  if (event.data) {
    try {
      const pushData = event.data.json();
      title = pushData.title || title;
      options.body = pushData.body || options.body;
      options.icon = pushData.icon || options.icon;
      options.tag = pushData.tag || options.tag;
      options.data = pushData.data || {};
    } catch (error) {
      console.log('Error parsing push data:', error);
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event - handle user interaction
self.addEventListener('notificationclick', event => {
  console.log('Notification clicked:', event);

  event.notification.close();

  if (event.action === 'view') {
    // Open the app when user clicks "View Dispatch"
    event.waitUntil(
      clients.openWindow('/fuel_dispatch.html')
    );
  } else if (event.action === 'dismiss') {
    // Just close the notification
    return;
  } else {
    // Default action - open the app
    event.waitUntil(
      clients.openWindow('/fuel_dispatch.html')
    );
  }
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