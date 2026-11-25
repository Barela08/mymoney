import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  notificationsApi,
  UserNotification,
  NotificationPreferences,
} from '../lib/notificationsApi';
import { pushNotifications } from '../lib/pushNotifications';
import { useAuth } from './AuthContext';

interface NotificationContextType {
  notifications: UserNotification[];
  unreadCount: number;
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
  updatePreferences: (prefs: Partial<NotificationPreferences>) => Promise<void>;
  enablePush: () => Promise<{ success: boolean; error?: string }>;
  disablePush: () => Promise<boolean>;
  sendTestPush: () => Promise<boolean>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [isPushSupported, setIsPushSupported] = useState<boolean>(false);
  const [isPushSubscribed, setIsPushSubscribed] = useState<boolean>(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default');

  // Check push support on mount
  useEffect(() => {
    const supported = pushNotifications.isSupported();
    setIsPushSupported(supported);
    if (supported) {
      setPushPermission(pushNotifications.getPermission());
      pushNotifications.getExistingSubscription().then((sub) => {
        setIsPushSubscribed(!!sub);
      });
    }
  }, []);

  // Fetch notifications
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
        setNotifications(res.notifications || []);
        setUnreadCount(res.unreadCount || 0);
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

  useEffect(() => {
    if (user) {
      refreshNotifications();
      loadPreferences();

      // Poll periodically (every 45 seconds) for background updates
      const interval = setInterval(refreshNotifications, 45000);
      return () => clearInterval(interval);
    }
  }, [user, refreshNotifications, loadPreferences]);

  const markAsRead = async (id: string) => {
    try {
      // Optimistic update
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

  const updatePreferences = async (newPrefs: Partial<NotificationPreferences>) => {
    try {
      const updated = await notificationsApi.updatePreferences(newPrefs);
      setPreferences(updated);
    } catch (e) {
      console.error('[NotificationContext] Update preferences failed:', e);
      throw e;
    }
  };

  const enablePush = async () => {
    // Check if already subscribed
    if (isPushSubscribed) {
      return { success: true };
    }

    // Check current permission state before requesting
    const currentPermission = pushNotifications.getPermission();
    if (currentPermission === 'denied') {
      // Permission already denied - don't show repeated errors, return a specific error
      return {
        success: false,
        error:
          'Notification permission was denied. Please allow notifications in browser site settings.',
      };
    }

    const res = await pushNotifications.subscribe();
    if (res.success) {
      setIsPushSubscribed(true);
      setPushPermission('granted');
      if (preferences) {
        await updatePreferences({ push_enabled: true });
      }
    }
    return res;
  };


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

  const sendTestPush = async () => {
    const ok = await notificationsApi.sendTestPush();
    if (ok) {
      setTimeout(refreshNotifications, 1000);
    }
    return ok;
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
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
        updatePreferences,
        enablePush,
        disablePush,
        sendTestPush,
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
