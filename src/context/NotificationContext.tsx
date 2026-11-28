import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  notificationsApi,
  UserNotification,
  NotificationPreferences,
} from '../lib/notificationsApi';
import { pushNotifications, type PushSubscribeResult } from '../lib/pushNotifications';
import { initNotificationAudioUnlock, playNotificationSound } from '../lib/notificationSound';
import { showExternalNotification } from '../lib/externalNotifications';
import { subscribeToSupabaseUserNotificationsRealtime } from '../lib/supabase';
import { dispatchUdharUpdated } from '../lib/udharDeletionApi';
import { useAuth } from './AuthContext';

interface NotificationContextType {
  notifications: UserNotification[];
  unreadCount: number;
  smartAlertsUnreadCount: number;
  totalUnreadCount: number;
  setSmartAlertsUnreadCount: (count: number) => void;
  isLoading: boolean;
  preferences: NotificationPreferences | null;
  isPushSupported: boolean;
  isPushSubscribed: boolean;
  pushPermission: NotificationPermission;
  refreshNotifications: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  respondToConnectionNotification: (id: string, action: 'accept' | 'reject') => Promise<{ success: boolean; message?: string; status?: string }>;
  updatePreferences: (prefs: Partial<NotificationPreferences>) => Promise<void>;
  enablePush: () => Promise<PushSubscribeResult>;
  disablePush: () => Promise<boolean>;
  sendTestPush: () => Promise<boolean>;
  testSoundAndExternalAlert: () => Promise<{ soundPlayed: boolean; osNotificationShown: boolean }>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [smartAlertsUnreadCount, setSmartAlertsUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [isPushSupported, setIsPushSupported] = useState<boolean>(false);
  const [isPushSubscribed, setIsPushSubscribed] = useState<boolean>(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default');
  const pushRequestInFlightRef = useRef<boolean>(false);

  // Track seen notifications per user so reloads never replay historical alerts
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const initialSeedDoneRef = useRef<boolean>(false);
  const lastUserIdRef = useRef<string | null>(null);
  const preferencesRef = useRef<NotificationPreferences | null>(null);
  const recentPushAtRef = useRef<number>(0);
  const recentPushIdsRef = useRef<Set<string>>(new Set());
  const syncedPushUserRef = useRef<string | null>(null);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  // Unlock browser audio on first gesture + listen for browser notification permission changes
  useEffect(() => {
    initNotificationAudioUnlock();

    const supported = pushNotifications.isSupported();
    setIsPushSupported(supported);
    if (!supported) return;

    const syncPermState = () => {
      const perm = pushNotifications.getPermission();
      setPushPermission(perm);
      pushNotifications.getExistingSubscription().then((sub) => {
        setIsPushSubscribed(!!sub || perm === 'granted');
      });
    };

    syncPermState();

    let permStatusObj: PermissionStatus | null = null;
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then((status) => {
          permStatusObj = status;
          status.onchange = syncPermState;
        })
        .catch(() => {});
    }

    return () => {
      if (permStatusObj) {
        permStatusObj.onchange = null;
      }
    };
  }, []);

  // Automatically keep Web Push subscription synced with current server VAPID key when permission is granted
  useEffect(() => {
    if (!user?.id || !isPushSupported) return;
    if (pushNotifications.getPermission() !== 'granted') return;
    if (syncedPushUserRef.current === user.id) return;

    syncedPushUserRef.current = user.id;
    pushNotifications
      .syncIfPermitted()
      .then((ok) => {
        setPushPermission('granted');
        if (ok) setIsPushSubscribed(true);
      })
      .catch(() => {});
  }, [user?.id, isPushSupported]);

  // Reset seen tracker when user changes
  useEffect(() => {
    const uid = user?.id || null;
    if (lastUserIdRef.current !== uid) {
      seenNotificationIdsRef.current = new Set();
      recentPushIdsRef.current = new Set();
      initialSeedDoneRef.current = false;
      syncedPushUserRef.current = null;
      lastUserIdRef.current = uid;
    }
  }, [user]);

  // Fetch notifications & trigger external OS alert + chime for newly arrived unread items
  const refreshNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      setIsLoading(true);
      const res = await notificationsApi.getNotifications({ limit: 30 });
      if (res.success) {
        const list = res.notifications || [];
        setNotifications(list);
        setUnreadCount(res.unreadCount || 0);

        if (!initialSeedDoneRef.current) {
          for (const n of list) {
            seenNotificationIdsRef.current.add(n.id);
          }
          initialSeedDoneRef.current = true;
        } else {
          const freshUnread = list.filter((n) => !n.is_read && !seenNotificationIdsRef.current.has(n.id));
          for (const n of list) {
            seenNotificationIdsRef.current.add(n.id);
          }

          if (freshUnread.length > 0) {
            const prefs = preferencesRef.current;
            const soundEnabled = prefs?.sound_enabled !== false;

            for (const notif of freshUnread.slice(0, 3)) {
              const alreadyShownViaPush =
                recentPushIdsRef.current.has(notif.id) ||
                Date.now() - recentPushAtRef.current < 2000;
              if (!alreadyShownViaPush) {
                void showExternalNotification({
                  title: notif.title,
                  body: notif.message,
                  url: notif.deep_link || 'notifications',
                  tag: `mm-notif-${notif.id}`,
                  category: notif.category,
                  type: notif.type,
                  notificationId: notif.id,
                  soundEnabled,
                  quietHoursEnabled: prefs?.quiet_hours_enabled,
                  quietHoursStart: prefs?.quiet_hours_start,
                  quietHoursEnd: prefs?.quiet_hours_end,
                  privacyHideAmounts: prefs?.privacy_hide_amounts ?? true,
                });
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[NotificationContext] Refresh failed:', e);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Load preferences
  const loadPreferences = useCallback(async () => {
    if (!user) return;
    try {
      const prefs = await notificationsApi.getPreferences();
      setPreferences(prefs);
    } catch (e) {
      console.warn('[NotificationContext] Load preferences error:', e);
    }
  }, [user]);

  // Service Worker message listener (PLAY SOUND on PUSH_RECEIVED + refresh + deep-link navigation)
  useEffect(() => {
    if (!user || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const handleSwMessage = (event: MessageEvent) => {
      const data = event?.data;
      if (!data) return;

      if (data.type === 'PUSH_RECEIVED') {
        recentPushAtRef.current = Date.now();
        const payload = data.payload || {};
        const pushedNotifId = payload?.data?.notificationId || payload?.notificationId;
        if (typeof pushedNotifId === 'string' && pushedNotifId) {
          recentPushIdsRef.current.add(pushedNotifId);
        }
        const prefs = preferencesRef.current;
        void playNotificationSound(payload.category, payload.type, {
          soundEnabled: prefs?.sound_enabled !== false,
          quietHoursEnabled: prefs?.quiet_hours_enabled,
          quietHoursStart: prefs?.quiet_hours_start,
          quietHoursEnd: prefs?.quiet_hours_end,
        });
        void refreshNotifications();
      } else if (data.type === 'NOTIFICATION_NAVIGATE' && typeof data.url === 'string') {
        const cleanUrl = data.url.trim();
        if (cleanUrl.startsWith('/#')) {
          window.location.hash = cleanUrl.slice(1);
        } else if (cleanUrl.startsWith('#')) {
          window.location.hash = cleanUrl;
        }
        void refreshNotifications();
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, [user, refreshNotifications]);

  // Immediate refresh events, tab focus sync, and 15s polling
  useEffect(() => {
    if (!user) return;

    refreshNotifications();
    loadPreferences();

    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void refreshNotifications();
      }
    }, 30000);
    const onRefreshEvent = () => {
      setTimeout(() => {
        void refreshNotifications();
      }, 450);
    };
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshNotifications();
      }
    };

    window.addEventListener('mymoney:notifications-refresh', onRefreshEvent);
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    const unsubRealtime = user?.id
      ? subscribeToSupabaseUserNotificationsRealtime(user.id, () => {
          void refreshNotifications();
        })
      : () => {};

    return () => {
      clearInterval(interval);
      window.removeEventListener('mymoney:notifications-refresh', onRefreshEvent);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      unsubRealtime();
    };
  }, [user, refreshNotifications, loadPreferences]);

  const markAsRead = async (id: string) => {
    try {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      await notificationsApi.markAsRead(id);
    } catch {
      refreshNotifications();
    }
  };

  const markAllAsRead = async () => {
    try {
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      await notificationsApi.markAllAsRead();
    } catch {
      refreshNotifications();
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      const target = notifications.find((n) => n.id === id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (target && !target.is_read) {
        setUnreadCount((c) => Math.max(0, c - 1));
      }
      await notificationsApi.deleteNotification(id);
    } catch {
      refreshNotifications();
    }
  };

  const clearAll = async () => {
    try {
      setNotifications([]);
      setUnreadCount(0);
      await notificationsApi.clearAll();
    } catch {
      refreshNotifications();
    }
  };

  const respondToConnectionNotification = async (id: string, action: 'accept' | 'reject') => {
    const resolvedStatus = action === 'accept' ? 'accepted' : 'rejected';
    try {
      const res = await notificationsApi.respondToConnectionNotification(id, action);
      setNotifications((prev) =>
        prev.map((n) => {
          if (n.id !== id) return n;
          if (!n.is_read) {
            setUnreadCount((c) => Math.max(0, c - 1));
          }
          return {
            ...n,
            is_read: true,
            metadata: {
              ...(n.metadata || {}),
              requestStatus: resolvedStatus,
              resolvedAt: new Date().toISOString(),
            },
          };
        })
      );
      dispatchUdharUpdated();
      void refreshNotifications();
      return { success: true, message: res.message, status: res.status || resolvedStatus };
    } catch (err: any) {
      void refreshNotifications();
      throw err;
    }
  };

  const updatePreferences = async (newPrefs: Partial<NotificationPreferences>) => {
    try {
      const updated = await notificationsApi.updatePreferences(newPrefs);
      setPreferences(updated);
    } catch (e) {
      console.error('[NotificationContext] Update preferences failed:', e);
      throw e;
    }
  };

  const enablePush = useCallback(async (): Promise<PushSubscribeResult> => {
    if (!pushNotifications.isSupported()) {
      return {
        success: false,
        permission: 'unsupported',
        error: 'Push notifications are not supported on this browser.',
      };
    }

    if (isPushSubscribed && pushNotifications.getPermission() === 'granted') {
      setPushPermission('granted');
      return { success: true, permission: 'granted' };
    }

    if (pushRequestInFlightRef.current) {
      return {
        success: false,
        permission: pushNotifications.getPermission(),
        error: 'Notification permission request is already open.',
      };
    }

    const currentPermission = pushNotifications.getPermission();
    setPushPermission(currentPermission);

    if (currentPermission === 'denied') {
      return {
        success: false,
        permission: 'denied',
        error:
          'Notification permission is blocked in your browser. Allow notifications in site settings and click Enable Notifications to retry.',
      };
    }

    pushRequestInFlightRef.current = true;
    try {
      const res = await pushNotifications.subscribe();
      const updatedPerm = pushNotifications.getPermission();
      setPushPermission(updatedPerm);

      if (res.success || updatedPerm === 'granted') {
        setIsPushSubscribed(true);
        setPushPermission('granted');
        if (preferences) {
          await updatePreferences({ push_enabled: true, sound_enabled: true }).catch(() => {});
        }
        // Immediately show confirmation in device/mobile notification bar with audible chime
        void showExternalNotification({
          title: 'My Money Manager · Mobile Alerts Enabled',
          body: 'You will now receive instant alerts in your device notification bar with sound.',
          url: 'notifications',
          tag: `mm-enabled-${Date.now()}`,
          category: 'general',
          type: 'success',
          soundEnabled: true,
          forceSound: true,
        });
      } else {
        setIsPushSubscribed(false);
      }
      return { ...res, permission: res.permission || updatedPerm };
    } finally {
      pushRequestInFlightRef.current = false;
    }
  }, [isPushSubscribed, preferences]);

  const disablePush = async () => {
    const ok = await pushNotifications.unsubscribe();
    if (ok) {
      setIsPushSubscribed(false);
      if (preferences) {
        await updatePreferences({ push_enabled: false });
      }
    }
    return ok;
  };

  const testSoundAndExternalAlert = useCallback(async () => {
    const prefs = preferencesRef.current;
    return showExternalNotification({
      title: 'My Money Manager · Alert Active',
      body: 'External notifications with sound are working! You will receive alerts outside the app too.',
      url: 'notifications',
      tag: `mm-sound-test-${Date.now()}`,
      category: 'general',
      type: 'success',
      soundEnabled: prefs?.sound_enabled !== false,
      forceSound: true,
    });
  }, []);

  const sendTestPush = async () => {
    const extRes = await testSoundAndExternalAlert();
    const ok = await notificationsApi.sendTestPush().catch(() => false);
    if (ok) {
      setTimeout(refreshNotifications, 900);
    }
    return ok || extRes.osNotificationShown || extRes.soundPlayed;
  };

  const totalUnreadCount = unreadCount + smartAlertsUnreadCount;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        smartAlertsUnreadCount,
        totalUnreadCount,
        setSmartAlertsUnreadCount,
        isLoading,
        preferences,
        isPushSupported,
        isPushSubscribed,
        pushPermission,
        refreshNotifications,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        clearAll,
        respondToConnectionNotification,
        updatePreferences,
        enablePush,
        disablePush,
        sendTestPush,
        testSoundAndExternalAlert,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
