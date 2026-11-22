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
   * Requests permission, subscribes to PushManager with server VAPID key, and registers with backend
   */
  async subscribe(): Promise<{ success: boolean; error?: string }> {
    if (!this.isSupported()) {
      return { success: false, error: 'Push notifications are not supported on this browser.' };
    }

    try {
      // 1. Request user permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        return {
          success: false,
          error:
            permission === 'denied'
              ? 'Notification permission was denied. Please allow notifications in browser site settings.'
              : 'Notification permission dismissed.',
        };
      }

      // 2. Fetch server public VAPID key
      const vapidPublicKey = await notificationsApi.getVapidPublicKey();
      const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

      // 3. Wait for service worker ready
      const registration = await navigator.serviceWorker.ready;

      // 4. Check for existing subscription or create new
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedVapidKey as BufferSource,
        });
      }

      // 5. Register with backend
      const ok = await notificationsApi.subscribePush(subscription);
      if (!ok) {
        return { success: false, error: 'Failed to register subscription with server.' };
      }

      return { success: true };
    } catch (err: any) {
      console.error('[Push Notifications Error]:', err);
      return { success: false, error: err.message || 'Unknown push subscription error.' };
    }
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
