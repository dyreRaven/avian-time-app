// public/service-worker.js

const CACHE_NAME = 'avian-kiosk-cache-v1';

// List of assets we want to cache for offline
const OFFLINE_ASSETS = [
  '/',           // main app (optional)
  '/index.html', // main app shell (optional)
  '/app.js',     // main app script (optional)
  '/styles.css',
  '/kiosk',
  '/kiosk.html',
  '/kiosk.js',
  '/manifest.json'
  // Add icon paths here later if you have them, e.g. '/icons/avian-192.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(OFFLINE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // Don’t try to cache API calls
  if (request.url.includes('/api/')) {
    return; // let the browser handle it normally
  }

  // For navigation requests (user entering /kiosk, refreshing, etc),
  // serve kiosk shell from cache when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        // If network fails, show cached kiosk as fallback
        return caches.match('/kiosk.html');
      })
    );
    return;
  }

  // For static assets (scripts, CSS, etc): cache-first strategy
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        const cloned = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, cloned);
        });
        return response;
      });
    })
  );
});
