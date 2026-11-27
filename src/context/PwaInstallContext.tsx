import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import {
  DEFAULT_DISMISS_COOLDOWN_MS,
  detectPlatformCompatibility,
  isInstallSuggestionSuppressed,
  isRunningStandalone,
  PlatformCompatibilityInfo,
} from '../lib/pwaUtils';
import { getStoredSessionToken } from '../lib/authApi';

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
  /** App is confirmed installed (standalone display mode or appinstalled event fired) */
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
  /** True when the user dismissed an install suggestion during this session or cooldown window */
  isBannerDismissed: boolean;
  /** Dismiss install prompt/suggestion without installing */
  dismissBanner: () => void;
  /** Reset dismissal state if user explicitly re-opens install UI */
  isScannerActive: boolean;
  setScannerActive: (active: boolean) => void;
  activeModalCount: number;
  setModalsSuppressed: (suppressed: boolean) => void;
  isBannerVisible: boolean;
  /** User preference to mute repeating 1-minute automatic install reminders */
  autoPromptDisabled: boolean;
  setAutoPromptDisabled: (disabled: boolean) => void;
  /** Incrementing signal used by Settings -> Reopen Install Popup */
  reopenInstallPopupSignal: number;
  reopenInstallPopup: () => void;
}

const PwaInstallContext = createContext<PwaInstallContextType | undefined>(undefined);

const DISMISSED_STORAGE_KEY = 'my_money_pwa_install_dismissed_at';
const SESSION_DISMISSED_KEY = 'my_money_pwa_install_session_dismissed';
const AUTO_PROMPT_DISABLED_KEY = 'mm_pwa_auto_prompt_disabled';

function readAutoPromptDisabled(): boolean {
  try {
    return localStorage.getItem(AUTO_PROMPT_DISABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

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

  const token = getStoredSessionToken();
  if (!token) return;

  fetch('/api/pwa/register-device', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
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
  const [isInstalled, setIsInstalled] = useState<boolean>(() => isRunningStandalone());
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isScannerActive, setIsScannerActive] = useState<boolean>(false);
  const [activeModalCount, setActiveModalCount] = useState<number>(0);
  const [autoPromptDisabled, setAutoPromptDisabledState] = useState<boolean>(() =>
    readAutoPromptDisabled()
  );
  const [reopenInstallPopupSignal, setReopenInstallPopupSignal] = useState<number>(0);

  const [sessionDismissed, setSessionDismissed] = useState<boolean>(() => readSessionDismissed());
  const [persistedDismissedAt, setPersistedDismissedAt] = useState<number | null>(() =>
    readPersistedDismissedAt()
  );

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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const persistConfirmedInstallFlag = () => {
      try {
        localStorage.setItem('my_money_app_downloaded_confirmed', 'true');
        const secureFlag = window.location?.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `mymoney_app_downloaded=downloaded; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax${secureFlag}`;
      } catch {}
    };

    const updateStandalone = () => {
      const standalone = isRunningStandalone();
      if (standalone) {
        setIsInstalled(true);
        setDeferredPrompt(null);
        setIsModalOpen(false);
        persistConfirmedInstallFlag();
      }
    };

    updateStandalone();

    // Check installed related apps on Chromium where supported
    const navWithRelated = navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<Array<{ platform: string; url?: string }>>;
    };
    if (typeof navWithRelated.getInstalledRelatedApps === 'function') {
      navWithRelated
        .getInstalledRelatedApps()
        .then((apps) => {
          if (Array.isArray(apps) && apps.length > 0) {
            setIsInstalled(true);
            setDeferredPrompt(null);
            persistConfirmedInstallFlag();
          }
        })
        .catch(() => {});
    }

    const standaloneMql = window.matchMedia?.('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsInstalled(true);
        setDeferredPrompt(null);
        setIsModalOpen(false);
        persistConfirmedInstallFlag();
      }
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (!isRunningStandalone()) {
        setDeferredPrompt(e as BeforeInstallPromptEvent);
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setIsModalOpen(false);
      persistConfirmedInstallFlag();
      syncDeviceRegistration(true);
    };

    // Register initial device and PWA installation state
    syncDeviceRegistration(isRunningStandalone());

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    standaloneMql?.addEventListener?.('change', handleDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      standaloneMql?.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, []);

  const isInstallable = Boolean(deferredPrompt) && !isInstalled;

  // Show the header Install App button ONLY when not installed AND either:
  // 1) Browser fired native `beforeinstallprompt` (Chrome/Edge Desktop & Android), OR
  // 2) Browser is Safari iOS/iPadOS or Safari macOS where manual Home Screen/Dock installation is supported.
  const canOfferInstall =
    !isInstalled &&
    (isInstallable ||
      compatibility.platform === 'ios_safari' ||
      compatibility.platform === 'macos_safari');

  const isBannerDismissed = useMemo(
    () =>
      isInstallSuggestionSuppressed({
        sessionDismissed,
        persistedDismissedAt,
        cooldownMs: DEFAULT_DISMISS_COOLDOWN_MS,
      }),
    [sessionDismissed, persistedDismissedAt]
  );

  const dismissBanner = useCallback(() => {
    const now = Date.now();
    setSessionDismissed(true);
    setPersistedDismissedAt(now);
    setIsModalOpen(false);
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

  const setAutoPromptDisabled = useCallback((disabled: boolean) => {
    setAutoPromptDisabledState(disabled);
    try {
      localStorage.setItem(AUTO_PROMPT_DISABLED_KEY, String(disabled));
    } catch {}
  }, []);

  const reopenInstallPopup = useCallback(() => {
    if (isInstalled) return;
    setAutoPromptDisabledState(false);
    setSessionDismissed(false);
    setPersistedDismissedAt(null);
    try {
      localStorage.setItem(AUTO_PROMPT_DISABLED_KEY, 'false');
      sessionStorage.removeItem(SESSION_DISMISSED_KEY);
      localStorage.removeItem(DISMISSED_STORAGE_KEY);
      sessionStorage.removeItem('my_money_popup_auth_dismissed');
      sessionStorage.removeItem('my_money_popup_auth_dismissed_at');
      sessionStorage.removeItem('my_money_popup_app_dismissed');
      sessionStorage.removeItem('my_money_popup_app_dismissed_at');
    } catch {}
    setReopenInstallPopupSignal((n) => n + 1);
  }, [isInstalled]);

  const triggerInstallPrompt = useCallback(async (): Promise<InstallPromptResult> => {
    if (isInstalled) {
      return { status: 'already_installed' };
    }

    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        // Per Chromium spec, each BeforeInstallPromptEvent can only be used once
        setDeferredPrompt(null);

        if (choice.outcome === 'accepted') {
          // Wait for `appinstalled` to confirm, while closing our modal immediately.
          // Note: We do NOT fake success if the user cancels.
          setIsModalOpen(false);
          return { status: 'accepted' };
        }

        // User dismissed/cancelled native prompt: do NOT mark installed; record dismissal
        dismissBanner();
        return { status: 'dismissed' };
      } catch (err) {
        console.warn('[PWA] Native install prompt notice:', err);
        setDeferredPrompt(null);
        setIsModalOpen(true);
        return { status: 'manual_guide' };
      }
    }

    // Native prompt unavailable (e.g., iOS Safari, macOS Safari, or manual guide requested)
    if (compatibility.supportsManualInstall) {
      setIsModalOpen(true);
      return { status: 'manual_guide' };
    }

    return { status: 'unavailable' };
  }, [isInstalled, deferredPrompt, dismissBanner, compatibility.supportsManualInstall]);

  // Promotional suggestion visibility (never shown if installed or dismissed)
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
        dismissBanner,
        isScannerActive,
        setScannerActive,
        activeModalCount,
        setModalsSuppressed,
        isBannerVisible,
        autoPromptDisabled,
        setAutoPromptDisabled,
        reopenInstallPopupSignal,
        reopenInstallPopup,
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
