import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import {
  DEFAULT_DISMISS_COOLDOWN_MS,
  detectPlatformCompatibility,
  isInstallSuggestionSuppressed,
  isRunningStandalone,
  PlatformCompatibilityInfo,
} from '../lib/pwaUtils';
import { getStoredSessionToken } from '../lib/authApi';
import {
  AppPortalScope,
  getCurrentPortalScope,
  getPortalBranding,
  PortalBrandingInfo,
} from '../lib/portalAuth';
import { useExpense } from './ExpenseContext';
import { getPortalIdentityFromSiteConfig } from '../lib/siteConfigDefaults';

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
  /** Active application scope ('user' | 'myadmin' | 'mystaff') */
  portalScope: AppPortalScope;
  /** Portal-specific branding for manifests, icons, titles, and accent color */
  portalBranding: PortalBrandingInfo;
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

export function getPortalStorageKeys(scope: AppPortalScope) {
  if (scope === 'myadmin') {
    return {
      dismissedAtKey: 'mm_myadmin_pwa_install_dismissed_at',
      popupDismissedAtKey: 'mm_myadmin_pwa_dismissed_at',
      popupOpenKey: 'mm_myadmin_pwa_popup_open',
      activeMsKey: 'mm_myadmin_pwa_active_ms',
      sessionDismissedKey: 'mm_myadmin_pwa_install_session_dismissed',
      autoPromptDisabledKey: 'mm_myadmin_pwa_auto_prompt_disabled',
      downloadedConfirmedKey: 'mm_myadmin_app_downloaded_confirmed',
      downloadedCookieName: 'mymoney_myadmin_app_downloaded',
      cookiePath: '/myadmin',
    };
  }
  if (scope === 'mystaff') {
    return {
      dismissedAtKey: 'mm_mystaff_pwa_install_dismissed_at',
      popupDismissedAtKey: 'mm_mystaff_pwa_dismissed_at',
      popupOpenKey: 'mm_mystaff_pwa_popup_open',
      activeMsKey: 'mm_mystaff_pwa_active_ms',
      sessionDismissedKey: 'mm_mystaff_pwa_install_session_dismissed',
      autoPromptDisabledKey: 'mm_mystaff_pwa_auto_prompt_disabled',
      downloadedConfirmedKey: 'mm_mystaff_app_downloaded_confirmed',
      downloadedCookieName: 'mymoney_mystaff_app_downloaded',
      cookiePath: '/mystaff',
    };
  }
  return {
    dismissedAtKey: 'my_money_pwa_install_dismissed_at',
    popupDismissedAtKey: 'my_money_pwa_dismissed_at',
    popupOpenKey: 'my_money_pwa_popup_open',
    activeMsKey: 'my_money_pwa_active_ms',
    sessionDismissedKey: 'my_money_pwa_install_session_dismissed',
    autoPromptDisabledKey: 'mm_pwa_auto_prompt_disabled',
    downloadedConfirmedKey: 'my_money_app_downloaded_confirmed',
    downloadedCookieName: 'mymoney_app_downloaded',
    cookiePath: '/',
  };
}

function readAutoPromptDisabled(scope: AppPortalScope): boolean {
  try {
    return localStorage.getItem(getPortalStorageKeys(scope).autoPromptDisabledKey) === 'true';
  } catch {
    return false;
  }
}

function readPersistedDismissedAt(scope: AppPortalScope): number | null {
  try {
    const raw = localStorage.getItem(getPortalStorageKeys(scope).dismissedAtKey);
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readSessionDismissed(scope: AppPortalScope): boolean {
  try {
    return sessionStorage.getItem(getPortalStorageKeys(scope).sessionDismissedKey) === 'true';
  } catch {
    return false;
  }
}

/**
 * Registers device metadata and reliable PWA installation status with backend
 */
export function syncDeviceRegistration(isInstalledApp?: boolean, portalOverride?: AppPortalScope) {
  if (typeof window === 'undefined') return;
  const standalone = isInstalledApp !== undefined ? isInstalledApp : isRunningStandalone();
  const scope = portalOverride || getCurrentPortalScope();
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
      portalScope: scope,
      isInstalled: standalone,
      installationStatus: standalone ? 'installed_pwa' : 'browser',
      pushPermission,
      pushSubscriptionStatus: pushPermission === 'granted' ? 'active' : 'none',
    }),
  }).catch(() => {});
}

export const PwaInstallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { siteConfig } = useExpense();
  const [portalScope, setPortalScope] = useState<AppPortalScope>(() => getCurrentPortalScope());
  const portalBranding = useMemo(() => {
    const base = getPortalBranding(portalScope);
    const live = getPortalIdentityFromSiteConfig(siteConfig, portalScope);
    return {
      ...base,
      appName: live.appName || base.appName,
      shortName: live.shortName || base.shortName,
      tagline: live.tagline || base.tagline,
      subtitle: live.tagline || base.subtitle,
      logoUrl: live.logoUrl || base.logoUrl,
      manifestUrl: `/api/pwa/manifest/${portalScope}?v=${siteConfig.version || 1}`,
      fallbackIcon: live.pwaIconUrl || live.logoUrl || base.fallbackIcon,
    };
  }, [portalScope, siteConfig]);
  const storageKeys = useMemo(() => getPortalStorageKeys(portalScope), [portalScope]);

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => isRunningStandalone());
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isScannerActive, setIsScannerActive] = useState<boolean>(false);
  const [activeModalCount, setActiveModalCount] = useState<number>(0);
  const [autoPromptDisabled, setAutoPromptDisabledState] = useState<boolean>(() =>
    readAutoPromptDisabled(getCurrentPortalScope())
  );
  const [reopenInstallPopupSignal, setReopenInstallPopupSignal] = useState<number>(0);

  const [sessionDismissed, setSessionDismissed] = useState<boolean>(() =>
    readSessionDismissed(getCurrentPortalScope())
  );
  const [persistedDismissedAt, setPersistedDismissedAt] = useState<number | null>(() =>
    readPersistedDismissedAt(getCurrentPortalScope())
  );

  // Track SPA location changes so scoped storage/branding updates smoothly
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncScope = () => {
      const next = getCurrentPortalScope();
      setPortalScope((prev) => {
        if (prev !== next) {
          setAutoPromptDisabledState(readAutoPromptDisabled(next));
          setSessionDismissed(readSessionDismissed(next));
          setPersistedDismissedAt(readPersistedDismissedAt(next));
        }
        return next;
      });
    };
    window.addEventListener('popstate', syncScope);
    window.addEventListener('hashchange', syncScope);
    window.addEventListener('mymoney:portal-change', syncScope);
    return () => {
      window.removeEventListener('popstate', syncScope);
      window.removeEventListener('hashchange', syncScope);
      window.removeEventListener('mymoney:portal-change', syncScope);
    };
  }, []);

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
        localStorage.setItem(storageKeys.downloadedConfirmedKey, 'true');
        localStorage.removeItem(storageKeys.popupOpenKey);
        localStorage.removeItem(storageKeys.popupDismissedAtKey);
        const secureFlag = window.location?.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `${storageKeys.downloadedCookieName}=downloaded; path=${storageKeys.cookiePath}; max-age=${365 * 24 * 60 * 60}; SameSite=Lax${secureFlag}`;
      } catch {}
    };

    const updateStandalone = () => {
      const standalone = isRunningStandalone();
      if (standalone) {
        setIsInstalled(true);
        setDeferredPrompt(null);
        setIsModalOpen(false);
        persistConfirmedInstallFlag();
      } else {
        setIsInstalled(false);
      }
    };

    updateStandalone();

    const navWithRelated = navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<Array<{ platform: string; url?: string }>>;
    };
    if (typeof navWithRelated.getInstalledRelatedApps === 'function') {
      navWithRelated
        .getInstalledRelatedApps()
        .then((apps) => {
          if (Array.isArray(apps) && apps.length > 0 && portalScope === 'user') {
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
      syncDeviceRegistration(true, portalScope);
    };

    syncDeviceRegistration(isRunningStandalone(), portalScope);

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    standaloneMql?.addEventListener?.('change', handleDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      standaloneMql?.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, [portalScope, storageKeys]);

  const isInstallable = Boolean(deferredPrompt) && !isInstalled;

  const pwaEnabledForScope =
    portalScope === 'myadmin'
      ? siteConfig.pwa.adminAppInstallEnabled !== false
      : portalScope === 'mystaff'
      ? siteConfig.pwa.staffAppInstallEnabled !== false
      : siteConfig.pwa.userAppInstallEnabled !== false;

  const canOfferInstall =
    pwaEnabledForScope &&
    !isInstalled &&
    (portalScope !== 'user' ||
      isInstallable ||
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
      sessionStorage.setItem(storageKeys.sessionDismissedKey, 'true');
      localStorage.setItem(storageKeys.dismissedAtKey, String(now));
      localStorage.setItem(storageKeys.popupDismissedAtKey, String(now));
      localStorage.removeItem(storageKeys.popupOpenKey);
      window.dispatchEvent(
        new CustomEvent('mymoney:pwa-popup-dismissed', { detail: { scope: portalScope } })
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [storageKeys, portalScope]);

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

  const setAutoPromptDisabled = useCallback(
    (disabled: boolean) => {
      setAutoPromptDisabledState(disabled);
      try {
        localStorage.setItem(storageKeys.autoPromptDisabledKey, String(disabled));
      } catch {}
    },
    [storageKeys]
  );

  const reopenInstallPopup = useCallback(() => {
    if (isInstalled) return;
    setAutoPromptDisabledState(false);
    setSessionDismissed(false);
    setPersistedDismissedAt(null);
    try {
      localStorage.setItem(storageKeys.autoPromptDisabledKey, 'false');
      sessionStorage.removeItem(storageKeys.sessionDismissedKey);
      localStorage.removeItem(storageKeys.dismissedAtKey);
      localStorage.removeItem(storageKeys.popupDismissedAtKey);
      localStorage.setItem(storageKeys.popupOpenKey, 'true');
      sessionStorage.removeItem('my_money_popup_auth_dismissed');
      sessionStorage.removeItem('my_money_popup_auth_dismissed_at');
      sessionStorage.removeItem('my_money_popup_app_dismissed');
      sessionStorage.removeItem('my_money_popup_app_dismissed_at');
    } catch {}
    setReopenInstallPopupSignal((n) => n + 1);
  }, [isInstalled, storageKeys]);

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
          return { status: 'accepted' };
        }

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
  }, [isInstalled, deferredPrompt, dismissBanner]);

  const isBannerVisible =
    canOfferInstall && !isBannerDismissed && !isScannerActive && activeModalCount === 0;

  return (
    <PwaInstallContext.Provider
      value={{
        portalScope,
        portalBranding,
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
