const ADMIN_CACHE_NAME = 'mm-myadmin-pwa-v1.0.0';

const ADMIN_PRECACHE_ASSETS = [
  '/myadmin',
  '/myadmin.html',
  '/admin-offline.html',
  '/myadmin-manifest.json',
  '/admin-logo.png',
  '/admin-favicon.png',
  '/admin-icon-192.png',
  '/admin-icon-512.png',
  '/admin-icon-512-maskable.png',
  '/admin-apple-touch-icon.png',
  '/admin-badge-96.png',
  '/admin-notification-icon.png',
];

function isAdminSubdomainHost() {
  try {
    return (self.location.hostname || '').toLowerCase().startsWith('admin.');
  } catch {
    return false;
  }
}

function getAdminHomeUrl() {
  return isAdminSubdomainHost() ? '/' : '/myadmin';
}

function shouldBypassAdminCache(request, url) {
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

function sanitizeAdminDeepLink(rawUrl) {
  const fallback = getAdminHomeUrl();
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return fallback;
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('//')) return fallback;

  let path = trimmed;
  try {
    const parsed = new URL(trimmed, self.location.origin);
    if (parsed.origin !== self.location.origin) {
      return fallback;
    }
    path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }

  if (!isAdminSubdomainHost()) {
    if (path === '/' || path.startsWith('/#') || path.startsWith('/?')) {
      return `/myadmin${path.slice(1)}`;
    }
    if (path.startsWith('/admin')) {
      return path.replace(/^\/admin/, '/myadmin');
    }
    if (!path.startsWith('/myadmin')) {
      return fallback;
    }
  }
  return path || fallback;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(ADMIN_CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          ADMIN_PRECACHE_ASSETS.map((asset) =>
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
            if ((key.startsWith('mm-admin-pwa-') || key.startsWith('mm-myadmin-pwa-')) && key !== ADMIN_CACHE_NAME) {
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

  if (shouldBypassAdminCache(event.request, url)) {
    return;
  }

  const isAdminNavigation =
    event.request.mode === 'navigate' &&
    (isAdminSubdomainHost() ||
      url.pathname === '/myadmin' ||
      url.pathname.startsWith('/myadmin/') ||
      url.pathname === '/admin' ||
      url.pathname.startsWith('/admin/'));

  if (isAdminNavigation) {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cachedAdminHtml = await caches.match('/myadmin.html');
        if (cachedAdminHtml) return cachedAdminHtml;
        const cachedAdminRoute = await caches.match('/myadmin');
        if (cachedAdminRoute) return cachedAdminRoute;
        const cachedOffline = await caches.match('/admin-offline.html');
        if (cachedOffline) return cachedOffline;
        return new Response('Offline — reconnect to use My Money Manager Admin.', {
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

  const isAdminStaticAsset =
    url.pathname.startsWith('/admin-') ||
    url.pathname.startsWith('/myadmin') ||
    /\.(?:js|css|png|jpg|jpeg|svg|webp|ico|woff|woff2|json)$/i.test(url.pathname);

  if (!isAdminStaticAsset) {
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
              caches.open(ADMIN_CACHE_NAME).then((cache) => cache.put(event.request, clone));
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
  const uniqueTag = `mm-admin-push-${Date.now()}`;
  const defaults = {
    title: 'My Money Manager Admin',
    body: 'New administrative alert requires your attention.',
    icon: '/admin-notification-icon.png',
    badge: '/admin-badge-96.png',
    tag: uniqueTag,
    category: 'security_alert',
    priority: 'normal',
    timestamp: Date.now(),
    data: { url: getAdminHomeUrl() },
  };

  let payload = { ...defaults };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = {
          ...defaults,
          title:
            typeof parsed.title === 'string' && parsed.title.trim()
              ? parsed.title.trim().slice(0, 140)
              : defaults.title,
          body:
            typeof parsed.body === 'string' && parsed.body.trim()
              ? parsed.body.trim().slice(0, 320)
              : defaults.body,
          icon:
            typeof parsed.icon === 'string' && parsed.icon.startsWith('/')
              ? parsed.icon
              : defaults.icon,
          badge:
            typeof parsed.badge === 'string' && parsed.badge.startsWith('/')
              ? parsed.badge
              : defaults.badge,
          tag:
            typeof parsed.tag === 'string' && parsed.tag.trim()
              ? parsed.tag.trim().slice(0, 120)
              : uniqueTag,
          category: typeof parsed.category === 'string' ? parsed.category : defaults.category,
          priority: typeof parsed.priority === 'string' ? parsed.priority : defaults.priority,
          timestamp:
            typeof parsed.timestamp === 'number' && Number.isFinite(parsed.timestamp)
              ? parsed.timestamp
              : Date.now(),
          requireInteraction:
            Boolean(parsed.requireInteraction) ||
            parsed.priority === 'urgent' ||
            parsed.priority === 'high',
          silent: Boolean(parsed.silent),
          actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 2) : [],
          data: {
            ...(parsed.data && typeof parsed.data === 'object' ? parsed.data : {}),
            url: sanitizeAdminDeepLink(parsed.data?.url || parsed.url || getAdminHomeUrl()),
            category: parsed.data?.category || parsed.category || 'security_alert',
            notificationId: parsed.data?.notificationId || parsed.notificationId || null,
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
      } catch {}
    }
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: payload.icon,
        badge: payload.badge,
        tag: payload.tag,
        timestamp: payload.timestamp,
        renotify: true,
        silent: Boolean(payload.silent),
        vibrate: payload.silent ? undefined : [220, 90, 220],
        data: payload.data,
        actions: payload.actions || [],
        requireInteraction: Boolean(payload.requireInteraction),
      }),
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => {
          for (const client of clients) {
            try {
              const clientUrl = new URL(client.url);
              const isClientAdmin =
                clientUrl.origin === self.location.origin &&
                (clientUrl.hostname.startsWith('admin.') ||
                  clientUrl.pathname.startsWith('/myadmin') ||
                  clientUrl.pathname.startsWith('/admin'));
              if (isClientAdmin && typeof client.postMessage === 'function') {
                client.postMessage({
                  type: 'ADMIN_PUSH_RECEIVED',
                  payload,
                });
              }
            } catch {}
          }
        })
        .catch(() => {}),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawTarget =
    (event.action && event.notification.data && event.notification.data.actionUrls?.[event.action]) ||
    (event.notification.data && event.notification.data.url) ||
    getAdminHomeUrl();

  const targetUrl = sanitizeAdminDeepLink(rawTarget);
  const fullTargetUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windowClients) => {
      for (const client of windowClients) {
        try {
          const clientUrl = new URL(client.url);
          const isClientAdmin =
            clientUrl.origin === self.location.origin &&
            (clientUrl.hostname.startsWith('admin.') ||
              clientUrl.pathname.startsWith('/myadmin') ||
              clientUrl.pathname.startsWith('/admin'));

          if (isClientAdmin && 'focus' in client) {
            await client.focus();
            if (typeof client.postMessage === 'function') {
              client.postMessage({
                type: 'ADMIN_NOTIFICATION_NAVIGATE',
                url: targetUrl,
                category: event.notification.data?.category || 'security_alert',
                notificationId: event.notification.data?.notificationId || null,
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
