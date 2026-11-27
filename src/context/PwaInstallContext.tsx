import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  ACTIVE_REMINDER_DELAY_MS,
  ActiveReminderState,
  detectPlatformCompatibility,
  getActiveElapsedMs,
  isRunningStandalone,
  PlatformCompatibilityInfo,
  transitionActiveReminderVisibility,
} from '../lib/pwaUtils';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export type InstallPromptResult =
  | { status: 'accepted' }
  | { status: 'dismissed' }
  | { status: 'manual_guide' }
  | { status: 'already_installed' }
  | { status: 'unavailable' };

interface PwaInstallContextType {
  /** Native beforeinstallprompt event has been captured and is ready to invoke */
  isInstallable: boolean;
  /** App is confirmed installed (standalone display mode, related app, or confirmed appinstalled) */
  isInstalled: boolean;
  /** Legacy convenience flag for iOS Safari */
  isIOS: boolean;
  /** Detailed browser/OS compatibility metadata */
  compatibility: PlatformCompatibilityInfo;
  /** True when the header Install App button should be displayed */
  canOfferInstall: boolean;
  /** Modal state for manual instructions or install confirmation */
  isModalOpen: boolean;
  openInstallModal: () => void;
  closeInstallModal: () => void;
  /** Triggers native browser install prompt when supported, otherwise opens platform-specific guide */
  triggerInstallPrompt: () => Promise<InstallPromptResult>;
  /** True when user explicitly dismissed/cancelled the install reminder in this visit */
  isBannerDismissed: boolean;
  /** True once 60s active page visibility has elapsed while app is not installed */
  isReminderReady: boolean;
  /** Dismiss install prompt/suggestion without marking installed */
  dismissBanner: () => void;
  /** Mark app as installed permanently while installed */
  markInstalledConfirmed: () => void;
  isScannerActive: boolean;
  setScannerActive: (active: boolean) => void;
  activeModalCount: number;
  setModalsSuppressed: (suppressed: boolean) => void;
  isBannerVisible: boolean;
}

const PwaInstallContext = createContext<PwaInstallContextType | undefined>(undefined);

const DISMISSED_STORAGE_KEY = 'my_money_pwa_install_dismissed_at';
const SESSION_DISMISSED_KEY = 'my_money_pwa_install_session_dismissed';
const INSTALLED_STORAGE_KEY = 'my_money_app_downloaded_confirmed';
const INSTALLED_COOKIE_NAME = 'mymoney_app_downloaded';

function readPersistedDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readSessionDismissed(): boolean {
  try {
    return sessionStorage.getItem(SESSION_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function readPersistedInstalledFlag(): boolean {
  if (typeof window === 'undefined') return false;
  if (isRunningStandalone()) return true;
  try {
    if (localStorage.getItem(INSTALLED_STORAGE_KEY) === 'true') return true;
  } catch {}
  try {
    if (typeof document !== 'undefined' && document.cookie.includes(`${INSTALLED_COOKIE_NAME}=downloaded`)) {
      return true;
    }
  } catch {}
  return false;
}

function persistConfirmedInstallFlag() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(INSTALLED_STORAGE_KEY, 'true');
    const secureFlag = window.location?.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${INSTALLED_COOKIE_NAME}=downloaded; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax${secureFlag}`;
  } catch {}
}

function clearConfirmedInstallFlag() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(INSTALLED_STORAGE_KEY);
    document.cookie = `${INSTALLED_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  } catch {}
}

/**
 * Registers device metadata and reliable PWA installation status with backend
 */
export function syncDeviceRegistration(isInstalledApp?: boolean) {
  if (typeof window === 'undefined') return;
  const standalone = isInstalledApp !== undefined ? isInstalledApp : isRunningStandalone();
  const compat = detectPlatformCompatibility(
    window.navigator.userAgent || '',
    window.navigator.maxTouchPoints || 0
  );

  const deviceType = /mobile|android|iphone/i.test(window.navigator.userAgent)
    ? 'mobile'
    : /ipad|tablet/i.test(window.navigator.userAgent)
    ? 'tablet'
    : 'desktop';

  const pushPermission =
    typeof Notification !== 'undefined'
      ? Notification.permission
      : 'unsupported';

  let userId: string | null = null;
  try {
    const rawUser = localStorage.getItem('my_money_auth_user');
    if (rawUser) {
      const u = JSON.parse(rawUser);
      userId = u?.id || u?.uid || null;
    }
  } catch {}

  if (!userId) return;

  fetch('/api/pwa/register-device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      deviceType,
      browser: compat.browserLabel,
      os: compat.osLabel,
      userAgent: window.navigator.userAgent,
      isInstalled: standalone,
      installationStatus: standalone ? 'installed_pwa' : 'browser',
      pushPermission,
      pushSubscriptionStatus: pushPermission === 'granted' ? 'active' : 'none',
    }),
  }).catch(() => {});
}

export const PwaInstallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => readPersistedInstalledFlag());
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isScannerActive, setIsScannerActive] = useState<boolean>(false);
  const [activeModalCount, setActiveModalCount] = useState<number>(0);

  const [sessionDismissed, setSessionDismissed] = useState<boolean>(() => readSessionDismissed());
  const [, setPersistedDismissedAt] = useState<number | null>(() => readPersistedDismissedAt());
  const [isReminderReady, setIsReminderReady] = useState<boolean>(false);

  const reminderTimerStateRef = useRef<ActiveReminderState>({
    accumulatedMs: 0,
    visibleSinceMs:
      typeof document !== 'undefined' && document.visibilityState === 'hidden' ? null : Date.now(),
  });

  const compatibility = useMemo<PlatformCompatibilityInfo>(() => {
    if (typeof window === 'undefined') {
      return detectPlatformCompatibility('');
    }
    return detectPlatformCompatibility(
      window.navigator.userAgent || '',
      window.navigator.maxTouchPoints || 0
    );
  }, []);

  const isIOS = compatibility.platform === 'ios_safari';

  const markInstalledConfirmed = useCallback(() => {
    setIsInstalled(true);
    setDeferredPrompt(null);
    setIsModalOpen(false);
    setIsReminderReady(false);
    persistConfirmedInstallFlag();
    syncDeviceRegistration(true);
  }, []);

  // 1. Detect installed/uninstalled transitions (standalone media query, related apps, beforeinstallprompt, appinstalled)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const standalone = isRunningStandalone();
    if (standalone) {
      markInstalledConfirmed();
    }

    const navWithRelated = navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<Array<{ platform: string; url?: string }>>;
    };
    if (typeof navWithRelated.getInstalledRelatedApps === 'function') {
      navWithRelated
        .getInstalledRelatedApps()
        .then((apps) => {
          if (Array.isArray(apps) && apps.length > 0) {
            markInstalledConfirmed();
          } else if (!isRunningStandalone()) {
            // If Chromium confirms no installed related app and we are not standalone,
            // allow uninstalled users to see install reminder if previously uninstalled.
            if (localStorage.getItem(INSTALLED_STORAGE_KEY) === 'true' && apps.length === 0) {
              clearConfirmedInstallFlag();
              setIsInstalled(false);
            }
          }
        })
        .catch(() => {});
    }

    const standaloneMql = window.matchMedia?.('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        markInstalledConfirmed();
      } else if (!isRunningStandalone()) {
        clearConfirmedInstallFlag();
        setIsInstalled(false);
      }
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (!isRunningStandalone()) {
        // Browser fired beforeinstallprompt -> app is confirmed NOT currently installed!
        // If previously installed & later uninstalled, allow reminder to appear again.
        clearConfirmedInstallFlag();
        setIsInstalled(false);
        setDeferredPrompt(e as BeforeInstallPromptEvent);
      }
    };

    const handleAppInstalled = () => {
      markInstalledConfirmed();
    };

    syncDeviceRegistration(standalone);

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    standaloneMql?.addEventListener?.('change', handleDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      standaloneMql?.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, [markInstalledConfirmed]);

  // 2. Active-page 60-second timer (pauses when tab is hidden, persists across internal navigation, never repeats once ready)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isInstalled || sessionDismissed) {
      setIsReminderReady(false);
      return;
    }

    let timerId: number | null = null;

    const scheduleRemainingCheck = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      const elapsed = getActiveElapsedMs(reminderTimerStateRef.current, Date.now());
      const remaining = Math.max(0, ACTIVE_REMINDER_DELAY_MS - elapsed);
      if (remaining <= 0) {
        setIsReminderReady(true);
        return;
      }
      timerId = window.setTimeout(() => {
        setIsReminderReady(true);
      }, remaining);
    };

    const handleVisibilityChange = () => {
      const visible = document.visibilityState !== 'hidden';
      reminderTimerStateRef.current = transitionActiveReminderVisibility(
        reminderTimerStateRef.current,
        visible,
        Date.now()
      );
      scheduleRemainingCheck();
    };

    // Start / resume immediately while visible
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      reminderTimerStateRef.current = transitionActiveReminderVisibility(
        reminderTimerStateRef.current,
        true,
        Date.now()
      );
    }
    scheduleRemainingCheck();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [isInstalled, sessionDismissed]);

  const isInstallable = Boolean(deferredPrompt) && !isInstalled;

  const canOfferInstall =
    !isInstalled &&
    (isInstallable ||
      compatibility.platform === 'ios_safari' ||
      compatibility.platform === 'macos_safari');

  // Dismissal is per-visit (`sessionStorage`) + records dismissal timestamp preference (`localStorage`)
  // separately from `isInstalled` so future visits re-prompt when still uninstalled.
  const isBannerDismissed = sessionDismissed;

  const dismissBanner = useCallback(() => {
    const now = Date.now();
    setSessionDismissed(true);
    setPersistedDismissedAt(now);
    setIsModalOpen(false);
    setIsReminderReady(false);
    try {
      sessionStorage.setItem(SESSION_DISMISSED_KEY, 'true');
      localStorage.setItem(DISMISSED_STORAGE_KEY, String(now));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const openInstallModal = useCallback(() => {
    if (isInstalled) return;
    setIsModalOpen(true);
  }, [isInstalled]);

  const closeInstallModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const setScannerActive = useCallback((active: boolean) => {
    setIsScannerActive(active);
  }, []);

  const setModalsSuppressed = useCallback((suppressed: boolean) => {
    setActiveModalCount((prev) => (suppressed ? prev + 1 : Math.max(0, prev - 1)));
  }, []);

  const triggerInstallPrompt = useCallback(async (): Promise<InstallPromptResult> => {
    if (isInstalled) {
      return { status: 'already_installed' };
    }

    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        setDeferredPrompt(null);

        if (choice.outcome === 'accepted') {
          setIsModalOpen(false);
          markInstalledConfirmed();
          return { status: 'accepted' };
        }

        // User cancelled native dialog: hide without marking installed
        dismissBanner();
        return { status: 'dismissed' };
      } catch (err) {
        console.warn('[PWA] Native install prompt notice:', err);
        setDeferredPrompt(null);
        setIsModalOpen(true);
        return { status: 'manual_guide' };
      }
    }

    setIsModalOpen(true);
    return { status: 'manual_guide' };
  }, [isInstalled, deferredPrompt, dismissBanner, markInstalledConfirmed]);

  const isBannerVisible =
    canOfferInstall && !isBannerDismissed && !isScannerActive && activeModalCount === 0;

  return (
    <PwaInstallContext.Provider
      value={{
        isInstallable,
        isInstalled,
        isIOS,
        compatibility,
        canOfferInstall,
        isModalOpen,
        openInstallModal,
        closeInstallModal,
        triggerInstallPrompt,
        isBannerDismissed,
        isReminderReady,
        dismissBanner,
        markInstalledConfirmed,
        isScannerActive,
        setScannerActive,
        activeModalCount,
        setModalsSuppressed,
        isBannerVisible,
      }}
    >
      {children}
    </PwaInstallContext.Provider>
  );
};

export const usePwaInstall = () => {
  const context = useContext(PwaInstallContext);
  if (!context) {
    throw new Error('usePwaInstall must be used within a PwaInstallProvider');
  }
  return context;
};
