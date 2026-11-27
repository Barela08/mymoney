import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  detectPlatformCompatibility,
  isRunningStandalone,
  type PlatformCompatibilityInfo,
} from '../lib/pwaUtils';
import { getStoredSessionToken } from '../lib/authApi';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

const ADMIN_PWA_INSTALLED_KEY = 'mm_admin_pwa_installed_v1';
const ADMIN_PWA_DISMISSED_AT_KEY = 'mm_admin_pwa_dismissed_at_v1';
const REMINDER_DELAY_MS = 60 * 1000; // 60 seconds initial & re-prompt delay

interface AdminPwaInstallContextValue {
  isInstalled: boolean;
  isStandalone: boolean;
  canUseNativePrompt: boolean;
  canOfferInstall: boolean;
  platformInfo: PlatformCompatibilityInfo;
  isReminderVisible: boolean;
  isInstallModalOpen: boolean;
  triggerInstallPrompt: () => Promise<{ outcome: 'accepted' | 'dismissed' | 'manual_guide' | 'unavailable' }>;
  dismissReminder: () => void;
  openInstallModal: () => void;
  closeInstallModal: () => void;
}

const AdminPwaInstallContext = createContext<AdminPwaInstallContextValue | null>(null);

async function syncAdminDeviceStatus(isInstalled: boolean): Promise<void> {
  const token = getStoredSessionToken();
  if (!token || typeof window === 'undefined') return;
  try {
    const info = detectPlatformCompatibility(
      window.navigator.userAgent || '',
      window.navigator.maxTouchPoints || 0
    );
    await fetch('/api/pwa/register-device', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        deviceType: /mobile|android|iphone|ipad/i.test(window.navigator.userAgent || '')
          ? 'mobile'
          : 'desktop',
        browser: info.browserLabel,
        os: info.osLabel,
        userAgent: `${window.navigator.userAgent || ''} [MyMoneyAdminApp]`,
        isInstalled,
        installationStatus: isInstalled ? 'installed' : 'browser',
        pushPermission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
      }),
    });
  } catch {
    // Non-blocking sync
  }
}

export const AdminPwaInstallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(() => isRunningStandalone());
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (isRunningStandalone()) return true;
    try {
      return localStorage.getItem(ADMIN_PWA_INSTALLED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [isReminderVisible, setIsReminderVisible] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);

  const reminderTimerRef = useRef<number | null>(null);

  const platformInfo = useMemo(() => {
    if (typeof window === 'undefined') {
      return detectPlatformCompatibility('');
    }
    return detectPlatformCompatibility(
      window.navigator.userAgent || '',
      window.navigator.maxTouchPoints || 0
    );
  }, []);

  const clearReminderTimer = useCallback(() => {
    if (reminderTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(reminderTimerRef.current);
      reminderTimerRef.current = null;
    }
  }, []);

  const scheduleNextReminder = useCallback(() => {
    clearReminderTimer();
    if (typeof window === 'undefined') return;
    reminderTimerRef.current = window.setTimeout(() => {
      const standaloneNow = isRunningStandalone();
      let persistedInstalled = false;
      try {
        persistedInstalled = localStorage.getItem(ADMIN_PWA_INSTALLED_KEY) === 'true';
      } catch {}
      if (!standaloneNow && !persistedInstalled) {
        setIsReminderVisible(true);
      }
    }, REMINDER_DELAY_MS);
  }, [clearReminderTimer]);

  // Listen to standalone mode, beforeinstallprompt, appinstalled, and getInstalledRelatedApps
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const markInstalled = () => {
      clearReminderTimer();
      setIsInstalled(true);
      setIsReminderVisible(false);
      setIsInstallModalOpen(false);
      setDeferredPrompt(null);
      try {
        localStorage.setItem(ADMIN_PWA_INSTALLED_KEY, 'true');
      } catch {}
      void syncAdminDeviceStatus(true);
    };

    const standaloneNow = isRunningStandalone();
    setIsStandalone(standaloneNow);
    if (standaloneNow) {
      markInstalled();
      return;
    }

    // Check installed related apps on Chromium where supported
    const navWithRelated = window.navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<Array<{ id?: string; url?: string; platform?: string }>>;
    };
    if (typeof navWithRelated.getInstalledRelatedApps === 'function') {
      navWithRelated
        .getInstalledRelatedApps()
        .then((apps) => {
          const hasAdminRelated = Array.isArray(apps) && apps.some(
            (a) =>
              (a.id && a.id.includes('admin')) ||
              (a.url && (a.url.includes('admin-manifest') || a.url.includes('admin.')))
          );
          if (hasAdminRelated) {
            markInstalled();
          }
        })
        .catch(() => {});
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      markInstalled();
    };

    const displayModeMq = window.matchMedia?.('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches);
      if (e.matches) {
        markInstalled();
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    displayModeMq?.addEventListener?.('change', handleDisplayModeChange);

    // Schedule initial 60-second reminder if Admin App is not yet installed
    scheduleNextReminder();

    return () => {
      clearReminderTimer();
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      displayModeMq?.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, [clearReminderTimer, scheduleNextReminder]);

  const dismissReminder = useCallback(() => {
    setIsReminderVisible(false);
    try {
      localStorage.setItem(ADMIN_PWA_DISMISSED_AT_KEY, String(Date.now()));
    } catch {}
    // Re-show after 60 seconds while Admin App remains uninstalled
    if (!isInstalled && !isStandalone) {
      scheduleNextReminder();
    }
  }, [isInstalled, isStandalone, scheduleNextReminder]);

  const openInstallModal = useCallback(() => {
    setIsInstallModalOpen(true);
  }, []);

  const closeInstallModal = useCallback(() => {
    setIsInstallModalOpen(false);
  }, []);

  const triggerInstallPrompt = useCallback(async (): Promise<{
    outcome: 'accepted' | 'dismissed' | 'manual_guide' | 'unavailable';
  }> => {
    if (isInstalled || isStandalone) {
      return { outcome: 'accepted' };
    }

    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        setDeferredPrompt(null);
        if (choice.outcome === 'accepted') {
          clearReminderTimer();
          setIsInstalled(true);
          setIsReminderVisible(false);
          setIsInstallModalOpen(false);
          try {
            localStorage.setItem(ADMIN_PWA_INSTALLED_KEY, 'true');
          } catch {}
          void syncAdminDeviceStatus(true);
          return { outcome: 'accepted' };
        }
        // Admin dismissed native prompt -> re-remind in 60s
        setIsReminderVisible(false);
        scheduleNextReminder();
        return { outcome: 'dismissed' };
      } catch {
        setIsInstallModalOpen(true);
        return { outcome: 'manual_guide' };
      }
    }

    // No native beforeinstallprompt yet (iOS Safari or Desktop instructions)
    setIsInstallModalOpen(true);
    return {
      outcome: platformInfo.supportsManualInstall ? 'manual_guide' : 'unavailable',
    };
  }, [
    clearReminderTimer,
    deferredPrompt,
    isInstalled,
    isStandalone,
    platformInfo.supportsManualInstall,
    scheduleNextReminder,
  ]);

  const value = useMemo<AdminPwaInstallContextValue>(
    () => ({
      isInstalled: isInstalled || isStandalone,
      isStandalone,
      canUseNativePrompt: Boolean(deferredPrompt),
      canOfferInstall: !isInstalled && !isStandalone,
      platformInfo,
      isReminderVisible: isReminderVisible && !isInstalled && !isStandalone,
      isInstallModalOpen,
      triggerInstallPrompt,
      dismissReminder,
      openInstallModal,
      closeInstallModal,
    }),
    [
      isInstalled,
      isStandalone,
      deferredPrompt,
      platformInfo,
      isReminderVisible,
      isInstallModalOpen,
      triggerInstallPrompt,
      dismissReminder,
      openInstallModal,
      closeInstallModal,
    ]
  );

  return (
    <AdminPwaInstallContext.Provider value={value}>
      {children}
    </AdminPwaInstallContext.Provider>
  );
};

export function useAdminPwaInstall(): AdminPwaInstallContextValue {
  const ctx = useContext(AdminPwaInstallContext);
  if (!ctx) {
    throw new Error('useAdminPwaInstall must be used within AdminPwaInstallProvider');
  }
  return ctx;
}
