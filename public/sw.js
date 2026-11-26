const CACHE_NAME = 'my-money-pwa-v2.0.0';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/logo.jpg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
];

// Install: Cache critical app shell and activate cleanly
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_ASSETS.map((asset) =>
            cache.add(asset).catch(() => {
              // Keep installing even if an optional asset fails
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

// Activate: Clean up stale cache versions and claim open clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Determine whether a request carries private/financial data that must NEVER be cached.
 */
function shouldBypassCache(request, url) {
  if (request.method !== 'GET') return true;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;

  // Never cache backend API responses, auth endpoints, or Supabase traffic
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/api' ||
    url.hostname.includes('supabase.co') ||
    url.pathname.includes('/auth/v1') ||
    url.pathname.includes('/rest/v1') ||
    url.pathname.includes('/realtime')
  ) {
    return true;
  }

  // Never cache requests with Authorization headers
  if (request.headers && request.headers.has('authorization')) {
    return true;
  }

  return false;
}

/**
 * Validate notification deep link to strictly same-origin relative URLs.
 */
function sanitizeDeepLink(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '/';
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('/')) {
    // Disallow protocol-relative URLs like //evil.com
    if (trimmed.startsWith('//')) return '/';
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed, self.location.origin);
    if (parsed.origin === self.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
    }
  } catch {
    // Fallback below
  }
  return '/';
}

// Fetch: Network-first for navigation, safe cache-first/SWR for static assets only, never cache private APIs
self.addEventListener('fetch', (event) => {
  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  if (shouldBypassCache(event.request, url)) {
    return;
  }

  // Navigation requests: Network-first, fallback to cached SPA shell, then offline.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cachedIndex = await caches.match('/index.html');
        if (cachedIndex) return cachedIndex;
        const cachedRoot = await caches.match('/');
        if (cachedRoot) return cachedRoot;
        const cachedOffline = await caches.match('/offline.html');
        if (cachedOffline) return cachedOffline;
        return new Response('Offline — please reconnect to use My Money Manager.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })
    );
    return;
  }

  // Only cache same-origin static assets (JS, CSS, images, fonts, manifest)
  if (url.origin !== self.location.origin) {
    return;
  }

  const isStaticAsset =
    /\.(?:js|css|png|jpg|jpeg|svg|webp|ico|woff|woff2|json)$/i.test(url.pathname) ||
    url.pathname === '/manifest.json';

  if (!isStaticAsset) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            const cacheControl = (networkResponse.headers.get('cache-control') || '').toLowerCase();
            if (!cacheControl.includes('no-store') && !cacheControl.includes('private')) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache);
              });
            }
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    })
  );
});

// Push Notifications: Safely parse Web Push payload and display native OS notification
self.addEventListener('push', (event) => {
  const defaults = {
    title: 'My Money Manager',
    body: 'You have a new financial update.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'my-money-alert',
    category: 'general',
    timestamp: Date.now(),
    data: { url: '/' },
  };

  let payload = { ...defaults };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = {
          ...defaults,
          title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim().slice(0, 140) : defaults.title,
          body: typeof parsed.body === 'string' && parsed.body.trim() ? parsed.body.trim().slice(0, 320) : defaults.body,
          icon: typeof parsed.icon === 'string' && parsed.icon.startsWith('/') ? parsed.icon : defaults.icon,
          badge: typeof parsed.badge === 'string' && parsed.badge.startsWith('/') ? parsed.badge : defaults.badge,
          tag: typeof parsed.tag === 'string' && parsed.tag.trim() ? parsed.tag.trim().slice(0, 120) : defaults.tag,
          category: typeof parsed.category === 'string' ? parsed.category : defaults.category,
          timestamp: typeof parsed.timestamp === 'number' && Number.isFinite(parsed.timestamp) ? parsed.timestamp : Date.now(),
          requireInteraction: Boolean(parsed.requireInteraction),
          silent: Boolean(parsed.silent),
          actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 2) : [],
          data: {
            ...(parsed.data && typeof parsed.data === 'object' ? parsed.data : {}),
            url: sanitizeDeepLink(parsed.data?.url || parsed.url || '/'),
            category: parsed.data?.category || parsed.category || 'general',
            timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
          },
        };
      }
    } catch {
      try {
        const textBody = event.data.text();
        if (textBody && textBody.trim()) {
          payload.body = textBody.trim().slice(0, 320);
        }
      } catch {
        // Keep safe defaults
      }
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    tag: payload.tag,
    timestamp: payload.timestamp,
    renotify: true,
    silent: Boolean(payload.silent),
    vibrate: payload.silent ? undefined : [200, 80, 200],
    data: payload.data,
    actions: payload.actions || [],
    requireInteraction: Boolean(payload.requireInteraction),
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, options),
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((windowClients) => {
          for (const client of windowClients) {
            try {
              if (new URL(client.url).origin === self.location.origin && typeof client.postMessage === 'function') {
                client.postMessage({
                  type: 'PUSH_RECEIVED',
                  payload,
                });
              }
            } catch {
              // ignore individual client postMessage errors
            }
          }
        })
        .catch(() => {}),
    ])
  );
});

// Handle external notification display requests forwarded from open app tabs
self.addEventListener('message', (event) => {
  const data = event?.data;
  if (!data || data.type !== 'SHOW_EXTERNAL_NOTIFICATION' || !data.payload) return;

  const p = data.payload;
  const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 140) : 'My Money Manager';
  const body = typeof p.body === 'string' && p.body.trim() ? p.body.trim().slice(0, 320) : 'You have a new notification.';
  const isSilent = Boolean(p.silent);
  const safeUrl = sanitizeDeepLink(p.data?.url || p.url || '/');

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: typeof p.tag === 'string' && p.tag.trim() ? p.tag.trim().slice(0, 120) : `mm-ext-${Date.now()}`,
      renotify: true,
      silent: isSilent,
      vibrate: isSilent ? undefined : [200, 80, 200],
      requireInteraction: Boolean(p.requireInteraction),
      data: {
        ...(p.data && typeof p.data === 'object' ? p.data : {}),
        url: safeUrl,
      },
    })
  );
});

// Push Notification Click: Focus existing window & navigate cleanly, or open a new window if none open
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawTarget =
    (event.action && event.notification.data && event.notification.data.actionUrls?.[event.action]) ||
    (event.notification.data && event.notification.data.url) ||
    '/';
  const targetUrl = sanitizeDeepLink(rawTarget);
  const fullTargetUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windowClients) => {
      // Prefer an already-open same-origin window
      for (const client of windowClients) {
        try {
          const clientOrigin = new URL(client.url).origin;
          if (clientOrigin === self.location.origin && 'focus' in client) {
            await client.focus();
            // Send SPA deep-link navigation message first to preserve auth/state smoothly
            if (typeof client.postMessage === 'function') {
              client.postMessage({
                type: 'NOTIFICATION_NAVIGATE',
                url: targetUrl,
                category: event.notification.data?.category || 'general',
                notificationId: event.notification.data?.notificationId || null,
              });
            }
            // If path differs and client supports navigate, update URL cleanly if needed
            if (targetUrl.startsWith('/#') && 'navigate' in client) {
              try {
                await client.navigate(fullTargetUrl);
              } catch {
                // postMessage already handled SPA navigation
              }
            }
            return client;
          }
        } catch {
          // Continue checking other clients
        }
      }

      // Open a new window only when no app window is currently open
      if (self.clients.openWindow) {
        return self.clients.openWindow(fullTargetUrl);
      }
      return undefined;
    })
  );
});
