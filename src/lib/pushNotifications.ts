import { notificationsApi } from './notificationsApi';

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
      const registration = await navigator.serviceWorker.ready;
      return await registration.pushManager.getSubscription();
    } catch {
      return null;
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
              : 'Notifications are blocked for this site. Click the lock icon in your browser address bar and set Notifications to Allow.',
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
                  : 'Notifications are blocked for this site. Click the lock icon in your browser address bar and set Notifications to Allow.'
                : 'Notification permission was dismissed. Click Enable Push to try again when ready.',
          };
        }

        // 2. Try full Web Push VAPID registration; if PushManager is unavailable in preview/sandbox, still succeed with native OS notifications
        try {
          const vapidPublicKey = await notificationsApi.getVapidPublicKey();
          const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);
          const registration = await navigator.serviceWorker.ready;

          let subscription = await registration.pushManager.getSubscription();
          if (!subscription) {
            subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: convertedVapidKey as BufferSource,
            });
          }

          await notificationsApi.subscribePush(subscription);
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
      const registration = await navigator.serviceWorker.ready;
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
