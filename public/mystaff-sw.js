const STAFF_CACHE_NAME = 'mm-mystaff-pwa-v1.0.0';

const STAFF_PRECACHE_ASSETS = [
  '/mystaff',
  '/mystaff.html',
  '/mystaff-offline.html',
  '/mystaff-manifest.json',
  '/staff-logo.png',
  '/staff-favicon.png',
  '/staff-icon-192.png',
  '/staff-icon-512.png',
  '/staff-icon-512-maskable.png',
  '/staff-apple-touch-icon.png',
  '/staff-badge-96.png',
  '/staff-notification-icon.png',
];

function shouldBypassStaffCache(request, url) {
  if (request.method !== 'GET') return true;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;

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

  if (
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/@vite/') ||
    url.pathname.startsWith('/@react-refresh') ||
    url.pathname.startsWith('/@id/') ||
    url.pathname.startsWith('/@fs/') ||
    url.searchParams.has('v') ||
    url.searchParams.has('t') ||
    url.searchParams.has('import')
  ) {
    return true;
  }

  if (request.headers && request.headers.has('authorization')) {
    return true;
  }

  return false;
}

function sanitizeStaffDeepLink(rawUrl) {
  const fallback = '/mystaff';
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return fallback;
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('//')) return fallback;

  try {
    const parsed = new URL(trimmed, self.location.origin);
    if (parsed.origin !== self.location.origin) {
      return fallback;
    }
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (path.startsWith('/mystaff')) return path;
    return fallback;
  } catch {
    return fallback;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STAFF_CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          STAFF_PRECACHE_ASSETS.map((asset) =>
            cache.add(asset).catch(() => {})
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key.startsWith('mm-mystaff-pwa-') && key !== STAFF_CACHE_NAME) {
              return caches.delete(key);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  if (shouldBypassStaffCache(event.request, url)) {
    return;
  }

  const isStaffNavigation =
    event.request.mode === 'navigate' &&
    (url.pathname === '/mystaff' || url.pathname.startsWith('/mystaff/'));

  if (isStaffNavigation) {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cachedStaffHtml = await caches.match('/mystaff.html');
        if (cachedStaffHtml) return cachedStaffHtml;
        const cachedStaffRoute = await caches.match('/mystaff');
        if (cachedStaffRoute) return cachedStaffRoute;
        const cachedOffline = await caches.match('/mystaff-offline.html');
        if (cachedOffline) return cachedOffline;
        return new Response('Offline — reconnect to use My Money Manager Staff.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  const isStaffStaticAsset =
    url.pathname.startsWith('/staff-') ||
    url.pathname.startsWith('/mystaff') ||
    /\.(?:js|css|png|jpg|jpeg|svg|webp|ico|woff|woff2|json)$/i.test(url.pathname);

  if (!isStaffStaticAsset) {
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
              const clone = networkResponse.clone();
              caches.open(STAFF_CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    })
  );
});

self.addEventListener('push', (event) => {
  const uniqueTag = `mm-staff-push-${Date.now()}`;
  const defaults = {
    title: 'My Money Manager Staff',
    body: 'New support or operations alert needs review.',
    icon: '/staff-notification-icon.png',
    badge: '/staff-badge-96.png',
    tag: uniqueTag,
    category: 'support',
    timestamp: Date.now(),
    data: { url: '/mystaff' },
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
          tag: typeof parsed.tag === 'string' && parsed.tag.trim() ? parsed.tag.trim().slice(0, 120) : uniqueTag,
          category: typeof parsed.category === 'string' ? parsed.category : defaults.category,
          timestamp: typeof parsed.timestamp === 'number' && Number.isFinite(parsed.timestamp) ? parsed.timestamp : Date.now(),
          silent: Boolean(parsed.silent),
          data: {
            ...(parsed.data && typeof parsed.data === 'object' ? parsed.data : {}),
            url: sanitizeStaffDeepLink(parsed.data?.url || parsed.url || '/mystaff'),
          },
        };
      }
    } catch {}
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      timestamp: payload.timestamp,
      renotify: true,
      silent: Boolean(payload.silent),
      vibrate: payload.silent ? undefined : [180, 70, 180],
      data: payload.data,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = sanitizeStaffDeepLink(event.notification.data?.url || '/mystaff');
  const fullTargetUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windowClients) => {
      for (const client of windowClients) {
        try {
          const clientUrl = new URL(client.url);
          if (
            clientUrl.origin === self.location.origin &&
            clientUrl.pathname.startsWith('/mystaff') &&
            'focus' in client
          ) {
            await client.focus();
            if (typeof client.postMessage === 'function') {
              client.postMessage({
                type: 'STAFF_NOTIFICATION_NAVIGATE',
                url: targetUrl,
              });
            }
            return client;
          }
        } catch {}
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(fullTargetUrl);
      }
      return undefined;
    })
  );
});
