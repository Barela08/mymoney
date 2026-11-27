import { getStoredSessionToken } from './authApi';
import {
  detectPlatformCompatibility,
  isRunningStandalone,
  uint8ArrayToBase64Url,
} from './pwaUtils';

export interface AdminPushStatus {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  requiresHomeScreenInstall: boolean;
  reason?: string;
}

export interface AdminPushRegistrationResult {
  success: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  message: string;
}

function isAdminSubdomainHost(): boolean {
  if (typeof window === 'undefined') return false;
  return (window.location.hostname || '').toLowerCase().startsWith('admin.');
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function ensureAdminServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  const scope = isAdminSubdomainHost() ? '/' : '/admin';
  try {
    const existing = await navigator.serviceWorker.getRegistrations();
    const matched = existing.find((reg) => {
      const scriptUrl = reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '';
      return scriptUrl.includes('/admin-sw.js');
    });
    if (matched) {
      return matched;
    }

    const registration = await navigator.serviceWorker.register('/admin-sw.js', { scope });
    return registration;
  } catch (err) {
    console.warn('[AdminSW] Registration notice:', err);
    return null;
  }
}

export async function getAdminPushStatus(): Promise<AdminPushStatus> {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      permission: 'unsupported',
      subscribed: false,
      requiresHomeScreenInstall: false,
      reason: 'Browser environment unavailable.',
    };
  }

  const platform = detectPlatformCompatibility(
    window.navigator.userAgent || '',
    window.navigator.maxTouchPoints || 0
  );
  const standalone = isRunningStandalone();

  if (platform.requiresHomeScreenForPush && !standalone) {
    return {
      supported: false,
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
      subscribed: false,
      requiresHomeScreenInstall: true,
      reason: 'On iOS Safari, add My Money Manager Admin to your Home Screen first to receive mobile push notifications.',
    };
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    return {
      supported: false,
      permission: 'unsupported',
      subscribed: false,
      requiresHomeScreenInstall: false,
      reason: 'This browser does not support Web Push. Live in-app alerts remain active in the Admin Console.',
    };
  }

  let subscribed = false;
  try {
    const reg = await ensureAdminServiceWorker();
    if (reg) {
      const existingSub = await reg.pushManager.getSubscription();
      subscribed = Boolean(existingSub);
    }
  } catch {
    subscribed = false;
  }

  return {
    supported: true,
    permission: Notification.permission,
    subscribed,
    requiresHomeScreenInstall: false,
  };
}

/**
 * Silently ensures the browser subscription is registered on the server if permission is already 'granted'.
 * Never prompts for permission automatically.
 */
export async function syncAdminPushIfGranted(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted') return false;
  const res = await registerAdminWebPush({ interactive: false });
  return res.subscribed;
}

/**
 * Registers Web Push on `/admin-sw.js` with backend VAPID public key.
 * When `interactive: true`, only call from an explicit user click after explaining the benefit.
 */
export async function registerAdminWebPush(
  options: { interactive?: boolean } = {}
): Promise<AdminPushRegistrationResult> {
  const interactive = options.interactive ?? true;
  if (typeof window === 'undefined') {
    return {
      success: false,
      permission: 'unsupported',
      subscribed: false,
      message: 'Browser context required for push notifications.',
    };
  }

  const platform = detectPlatformCompatibility(
    window.navigator.userAgent || '',
    window.navigator.maxTouchPoints || 0
  );
  if (platform.requiresHomeScreenForPush && !isRunningStandalone()) {
    return {
      success: false,
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
      subscribed: false,
      message: 'Install My Money Manager Admin via Share -> Add to Home Screen first to enable iOS push alerts.',
    };
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    return {
      success: false,
      permission: 'unsupported',
      subscribed: false,
      message: 'Web Push is unsupported in this browser. Live in-app notifications are still enabled.',
    };
  }

  let permission: NotificationPermission = Notification.permission;
  if (permission === 'default') {
    if (!interactive) {
      return {
        success: false,
        permission,
        subscribed: false,
        message: 'Notification permission has not been requested yet.',
      };
    }
    permission = await Notification.requestPermission();
  }

  if (permission === 'denied') {
    return {
      success: false,
      permission: 'denied',
      subscribed: false,
      message:
        'Notifications are blocked in your browser settings. Enable notifications for this site to receive mobile lock-screen alerts; in-app alerts remain active.',
    };
  }

  if (permission !== 'granted') {
    return {
      success: false,
      permission,
      subscribed: false,
      message: 'Notification permission was dismissed. You can enable it anytime from the Admin Notification Console.',
    };
  }

  const reg = await ensureAdminServiceWorker();
  if (!reg) {
    return {
      success: false,
      permission,
      subscribed: false,
      message: 'Admin service worker could not be initialized.',
    };
  }

  await navigator.serviceWorker.ready;

  const token = getStoredSessionToken();
  const keyHeaders: Record<string, string> = { Accept: 'application/json' };
  if (token) keyHeaders['Authorization'] = `Bearer ${token}`;

  const keyRes = await fetch('/api/notifications/push/vapid-public-key', {
    method: 'GET',
    credentials: 'include',
    headers: keyHeaders,
  });
  if (!keyRes.ok) {
    return {
      success: false,
      permission,
      subscribed: false,
      message: 'Could not retrieve server push configuration.',
    };
  }
  const keyJson = await keyRes.json();
  const publicKey = (keyJson?.publicKey || '').trim();
  if (!publicKey) {
    return {
      success: false,
      permission,
      subscribed: false,
      message: 'VAPID public key is not configured on the backend.',
    };
  }

  let subscription = await reg.pushManager.getSubscription();
  if (subscription && subscription.options?.applicationServerKey) {
    try {
      const existingKey = uint8ArrayToBase64Url(
        new Uint8Array(subscription.options.applicationServerKey)
      );
      if (existingKey !== publicKey) {
        await subscription.unsubscribe();
        subscription = null;
      }
    } catch {
      // Keep existing subscription if key comparison unavailable
    }
  }

  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
    });
  }

  const subJson = subscription.toJSON();
  const deviceLabel = `Admin Console · ${platform.deviceLabel}`;

  const saveRes = await fetch('/api/notifications/push/subscribe', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: subJson.keys,
      deviceName: deviceLabel,
    }),
  });

  if (!saveRes.ok) {
    return {
      success: false,
      permission,
      subscribed: false,
      message: 'Push permission granted, but saving device subscription failed.',
    };
  }

  return {
    success: true,
    permission,
    subscribed: true,
    message: 'Mobile Web Push alerts enabled for My Money Manager Admin.',
  };
}

export async function unregisterAdminWebPush(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const reg = await ensureAdminServiceWorker();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return true;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    const token = getStoredSessionToken();
    await fetch('/api/notifications/push/unsubscribe', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ endpoint }),
    });
    return true;
  } catch {
    return false;
  }
}
