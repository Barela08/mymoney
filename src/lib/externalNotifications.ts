/**
 * My Money Manager — External OS/Browser Notification Dispatcher
 * Displays real system notifications outside the app shell and triggers notification sound.
 */

import { playNotificationSound, isCurrentTimeInQuietHoursIST } from './notificationSound';

export interface ExternalNotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  category?: string;
  type?: string;
  notificationId?: string;
  soundEnabled?: boolean;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  forceSound?: boolean;
}

function sanitizeUrl(raw?: string): string {
  if (!raw || !raw.trim()) return '/';
  const clean = raw.trim();
  const pathRoutes = new Set([
    '/ai-assistant',
    '/expense-calendar',
    '/smart-alerts',
    '/receipt-scanner',
    '/net-worth',
    '/safe-to-spend',
  ]);
  if (pathRoutes.has(clean)) return clean;
  if (clean.startsWith('/#')) return clean;
  if (clean.startsWith('/') && !clean.startsWith('//')) {
    const slug = clean.replace(/^\/+/, '');
    return slug ? `/#${slug}` : '/';
  }
  return `/#${clean.replace(/^#+/, '')}`;
}

async function resolveSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    let reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) {
      const isSecureContext =
        window.isSecureContext ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';
      if (isSecureContext) {
        reg = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
      }
    }

    const readyReg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500)),
    ]);

    return readyReg || reg || null;
  } catch {
    return null;
  }
}

/**
 * Triggers an external OS/Desktop/Mobile notification + audible sound chime.
 */
export async function showExternalNotification(payload: ExternalNotificationPayload): Promise<{
  soundPlayed: boolean;
  osNotificationShown: boolean;
}> {
  const inQuietHours =
    Boolean(payload.quietHoursEnabled) &&
    payload.category !== 'security' &&
    isCurrentTimeInQuietHoursIST(payload.quietHoursStart, payload.quietHoursEnd);

  const shouldPlaySound = payload.forceSound || (payload.soundEnabled !== false && !inQuietHours);

  // 1. Play audible sound chime when permitted & enabled
  const soundPlayed = shouldPlaySound
    ? await playNotificationSound(payload.category, payload.type, {
        soundEnabled: payload.soundEnabled,
        quietHoursEnabled: payload.quietHoursEnabled,
        quietHoursStart: payload.quietHoursStart,
        quietHoursEnd: payload.quietHoursEnd,
        force: payload.forceSound,
      })
    : false;

  // 2. Display native OS / browser notification bar alert outside the app
  let osNotificationShown = false;
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { soundPlayed, osNotificationShown };
  }

  if (Notification.permission !== 'granted') {
    return { soundPlayed, osNotificationShown };
  }

  const targetUrl = sanitizeUrl(payload.url);
  const tag = payload.tag || `mm-ext-${payload.notificationId || Date.now()}`;
  const isSilent = !shouldPlaySound;

  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    renotify: true,
    silent: isSilent,
    vibrate: isSilent ? undefined : [200, 80, 200],
    requireInteraction: payload.category === 'security' || payload.type === 'error',
    data: {
      url: targetUrl,
      category: payload.category || 'general',
      notificationId: payload.notificationId || null,
    },
  };

  // ServiceWorkerRegistration.showNotification is required on Android Chrome/mobile browsers
  if ('serviceWorker' in navigator) {
    try {
      const reg = await resolveSwRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(payload.title, options);
        osNotificationShown = true;
        return { soundPlayed, osNotificationShown };
      }

      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_EXTERNAL_NOTIFICATION',
          payload: {
            title: payload.title,
            body: payload.body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag,
            silent: isSilent,
            requireInteraction: options.requireInteraction,
            data: options.data,
          },
        });
        osNotificationShown = true;
        return { soundPlayed, osNotificationShown };
      }
    } catch {
      // Fall back to window Notification constructor below on desktop browsers
    }
  }

  try {
    const nativeNotif = new Notification(payload.title, options);
    nativeNotif.onclick = () => {
      try {
        window.focus();
        if (targetUrl.startsWith('/#')) {
          window.location.hash = targetUrl.slice(1);
        }
        nativeNotif.close();
      } catch {}
    };
    osNotificationShown = true;
  } catch {
    osNotificationShown = false;
  }

  return { soundPlayed, osNotificationShown };
}
