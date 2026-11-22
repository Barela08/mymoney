const CACHE_NAME = 'my-money-pwa-v1.0.0';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo.jpg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
];

// Install: Cache critical app shell and activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-caching warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up stale caches & take immediate control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Smart network-first strategy for dynamic data, cache fallback for offline
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Bypass Service Worker for Supabase cloud database & auth requests (always live)
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.includes('/auth/v1') ||
    url.pathname.includes('/rest/v1') ||
    url.pathname.includes('/realtime') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // 2. Navigation requests: Network-first, fallback to /index.html (Offline SPA support)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html') || caches.match('/');
      })
    );
    return;
  }

  // 3. Static assets & media: Stale-while-revalidate or Network-first
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// Push Notifications: Handle Web Push events received from server
self.addEventListener('push', (event) => {
  let data = {
    title: 'My Money Manager',
    body: 'You have a new notification.',
    icon: '/logo.jpg',
    badge: '/icon-192.png',
    tag: 'my-money-alert',
    data: { url: '/' },
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch {
      data.body = event.data.text() || data.body;
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/logo.jpg',
    badge: data.badge || '/icon-192.png',
    image: data.image,
    tag: data.tag || `notif-${Date.now()}`,
    vibrate: [150, 50, 150],
    data: data.data || { url: '/' },
    actions: data.actions || [],
    requireInteraction: !!data.requireInteraction,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Push Notification Click: Deep link to application URL or focus existing tab
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a tab is already open, focus and navigate it
      for (const client of windowClients) {
        if ('focus' in client) {
          if (client.url && client.navigate) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      // If no tab is open, open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

