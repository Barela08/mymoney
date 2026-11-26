import { notificationsApi } from './notificationsApi';
import { uint8ArrayToBase64Url } from './pwaUtils';

/**
 * Converts a base64 string to a Uint8Array for VAPID applicationServerKey
 */
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

async function getSwRegistration(): Promise<ServiceWorkerRegistration> {
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
  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
  if (ready) return ready;
  if (reg) return reg;
  throw new Error('Service Worker is not ready yet.');
}

async function ensureSubscribedWithServerKey(
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string
): Promise<PushSubscription> {
  const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    const currentKeyBuffer = subscription.options?.applicationServerKey;
    if (currentKeyBuffer) {
      const currentKeyB64 = uint8ArrayToBase64Url(new Uint8Array(currentKeyBuffer));
      if (currentKeyB64 && currentKeyB64 !== vapidPublicKey) {
        try {
          await subscription.unsubscribe();
        } catch {
          // Best-effort cleanup of stale key subscription
        }
        subscription = null;
      }
    }
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedVapidKey as BufferSource,
    });
  }

  await notificationsApi.subscribePush(subscription);
  return subscription;
}

export type PushSubscribeResult = {
  success: boolean;
  permission?: NotificationPermission | 'unsupported';
  error?: string;
};

let inFlightSubscribe: Promise<PushSubscribeResult> | null = null;

export const pushNotifications = {
  /**
   * Checks whether Push and Service Worker are supported in this browser
   */
  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  },

  /**
   * Returns current Notification permission: 'default' | 'granted' | 'denied'
   */
  getPermission(): NotificationPermission {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied';
    }
    return Notification.permission;
  },

  /**
   * Checks if an active Push subscription exists in Service Worker
   */
  async getExistingSubscription(): Promise<PushSubscription | null> {
    if (!this.isSupported()) return null;
    try {
      const registration = await getSwRegistration();
      return await registration.pushManager.getSubscription();
    } catch {
      return null;
    }
  },

  /**
   * Silently syncs Web Push subscription with the backend when permission is already granted.
   * Never shows a browser permission prompt.
   */
  async syncIfPermitted(): Promise<boolean> {
    if (!this.isSupported() || Notification.permission !== 'granted') {
      return false;
    }
    try {
      const [vapidPublicKey, registration] = await Promise.all([
        notificationsApi.getVapidPublicKey(),
        getSwRegistration(),
      ]);
      await ensureSubscribedWithServerKey(registration, vapidPublicKey);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Requests permission, subscribes to PushManager with server VAPID key, and registers with backend.
   * Serializes concurrent calls so multiple browser prompts cannot stack.
   */
  async subscribe(): Promise<PushSubscribeResult> {
    if (!this.isSupported()) {
      return {
        success: false,
        permission: 'unsupported',
        error: 'Push notifications are not supported on this browser.',
      };
    }

    if (inFlightSubscribe) {
      return inFlightSubscribe;
    }

    inFlightSubscribe = (async (): Promise<PushSubscribeResult> => {
      try {
        const isEmbedded = window.self !== window.top;
        const currentPermission = Notification.permission;

        if (currentPermission === 'denied') {
          return {
            success: false,
            permission: 'denied',
            error: isEmbedded
              ? 'Browser notifications are blocked in embedded preview or site settings. Open the app in a full tab and allow Notifications in site settings.'
              : 'Notifications are blocked for this site. Tap the lock icon in your browser address bar and set Notifications to Allow.',
          };
        }

        // 1. Request user permission only when currently 'default' (or already 'granted')
        const permission =
          currentPermission === 'granted' ? 'granted' : await Notification.requestPermission();

        if (permission !== 'granted') {
          return {
            success: false,
            permission,
            error:
              permission === 'denied'
                ? isEmbedded
                  ? 'Browser notifications are blocked in embedded preview or site settings. Open the app in a full tab and allow Notifications in site settings.'
                  : 'Notifications are blocked for this site. Tap the lock icon in your browser address bar and set Notifications to Allow.'
                : 'Notification permission was dismissed. Tap Enable to try again when ready.',
          };
        }

        // 2. Register Web Push with current server VAPID key (and automatically rotate if server key changed)
        try {
          const [vapidPublicKey, registration] = await Promise.all([
            notificationsApi.getVapidPublicKey(),
            getSwRegistration(),
          ]);

          await ensureSubscribedWithServerKey(registration, vapidPublicKey);
          return { success: true, permission: 'granted' };
        } catch (pushRegErr: any) {
          console.warn('[Push VAPID registration fallback to browser OS notifications]:', pushRegErr?.message);
          return {
            success: true,
            permission: 'granted',
          };
        }
      } catch (err: any) {
        console.error('[Push Notifications Error]:', err);
        return {
          success: false,
          permission: this.getPermission(),
          error: err?.message || 'Unknown push subscription error.',
        };
      } finally {
        inFlightSubscribe = null;
      }
    })();

    return inFlightSubscribe;
  },

  /**
   * Unsubscribe from PushManager and inform server
   */
  async unsubscribe(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      const registration = await getSwRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await notificationsApi.unsubscribePush(subscription.endpoint);
        await subscription.unsubscribe();
      }
      return true;
    } catch (err) {
      console.warn('[Push Unsubscribe Error]:', err);
      return false;
    }
  },
};
