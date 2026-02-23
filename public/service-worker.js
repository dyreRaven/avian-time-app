// public/service-worker.js

const CACHE_NAME = 'avian-kiosk-cache-v102';

// List of assets we want to cache for offline
const OFFLINE_ASSETS = [
  '/',           // main app (optional)
  '/index.html', // main app shell (optional)
  '/js/app.js',
  '/js/app.js?v=reviewfix27',
  '/js/payroll.js?v=reviewfix25',
  '/styles.css',
  '/kiosk',
  '/kiosk.html',
  '/kiosk.js',
  '/kiosk-tablet.css',
  '/kiosk-phone.css',
  '/kiosk-admin.js',
  '/kiosk-admin.js?v=20260130y',
  '/kiosk-admin.js?v=20260223a',
  '/kiosk-admin.js?v=20260223b',
  '/kiosk-admin.js?v=20260223c',
  '/kiosk-admin.js?v=20260223d',
  '/kiosk-admin.js?v=20260223e',
  '/kiosk-admin.js?v=20260223f',
  '/kiosk-admin.js?v=20260223g',
  '/kiosk-admin.js?v=20260223h',
  '/kiosk-admin.css',
  '/kiosk-admin.css?v=20260130z',
  '/kiosk-admin.css?v=20260223a',
  '/kiosk-admin.css?v=20260223b',
  '/kiosk-admin.css?v=20260223c',
  '/kiosk-admin.css?v=20260223d',
  '/kiosk-admin.css?v=20260223e',
  '/kiosk-admin.css?v=20260223f',
  '/kiosk-admin.css?v=20260223g',
  '/kiosk-admin.css?v=20260223h',
  '/js/bcrypt.min.js',
  '/js/offline-store.js',
  '/js/notifications.js',
  '/manifest.json',
  '/images/logo.png',
  '/images/wsplash2.jpg',
  '/icons/avian-192.png',
  '/icons/avian-512.png'
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

function isKioskRoute(pathname) {
  return (
    pathname === '/kiosk' ||
    pathname === '/kiosk.html' ||
    pathname.startsWith('/kiosk/')
  );
}

function isKioskAdminRoute(pathname) {
  return (
    pathname === '/kiosk-admin' ||
    pathname === '/kiosk-admin.html' ||
    pathname.startsWith('/kiosk-admin')
  );
}

self.addEventListener('fetch', event => {
  const { request } = event;

  // Don’t try to cache API calls
  if (request.url.includes('/api/')) {
    return; // let the browser handle it normally
  }

  if (request.method !== 'GET') {
    return;
  }

  // For navigation requests, use cache-first for kiosk routes (offline-first),
  // and network-first for admin/auth routes to prevent stale shells.
  if (request.mode === 'navigate') {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const kioskRoute = isKioskRoute(pathname) || isKioskAdminRoute(pathname);

    if (kioskRoute) {
      event.respondWith(
        caches.match(request).then(cached => {
          const fetchPromise = fetch(request)
            .then(response => {
              if (response && response.ok) {
                const cloned = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, cloned));
              }
              return response;
            })
            .catch(() => cached || caches.match('/kiosk.html'));
          return cached || fetchPromise;
        })
      );
      return;
    }

    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, cloned));
          }
          return response;
        })
        .catch(() => caches.match(request) || caches.match('/index.html'))
    );
    return;
  }

  // Stale-while-revalidate for static assets
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request)
        .then(response => {
          if (response && response.ok) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, cloned));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

self.addEventListener('push', event => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (err) {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'Avian';
  const options = {
    body: payload.body || '',
    data: { url: payload.url || '/' },
    icon: '/icons/avian-192.png',
    badge: '/icons/avian-192.png'
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';
  const target = new URL(targetUrl, self.location.origin);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        try {
          const current = new URL(client.url);
          if (current.origin === target.origin && current.pathname === target.pathname && 'focus' in client) {
            return client.focus();
          }
        } catch {
          // ignore malformed URLs
        }
        if (client.url === target.href && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(target.href);
      }
      return null;
    })
  );
});
