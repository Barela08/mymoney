import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { useExpense, sanitizeLogoUrl } from '../../context/ExpenseContext';
import { getPortalStorageKeys, usePwaInstall } from '../../context/PwaInstallContext';
import { useAuth } from '../../context/AuthContext';
import { isRunningStandalone } from '../../lib/pwaUtils';
import { AppPortalScope, getPortalBranding } from '../../lib/portalAuth';
import { getPortalIdentityFromSiteConfig } from '../../lib/siteConfigDefaults';

interface AppDownloadPopupProps {
  isAdminRoute: boolean;
  isMaintenanceBlocked: boolean;
  hasBottomMobileNav: boolean;
  portalScope?: AppPortalScope;
}

// Legacy session/cookie keys to clean up
const AUTH_SESSION_DISMISSED_KEY = 'my_money_popup_auth_dismissed';
const APP_SESSION_DISMISSED_KEY = 'my_money_popup_app_dismissed';
const AUTH_DISMISSED_AT_KEY = 'my_money_popup_auth_dismissed_at';
const APP_DISMISSED_AT_KEY = 'my_money_popup_app_dismissed_at';
const LEGACY_POPUP_STORAGE_KEY = 'my_money_app_popup_action';
const LEGACY_POPUP_COOKIE_NAME = 'mymoney_app_popup_dismissed';

export const INITIAL_INSTALL_POPUP_DELAY_MS = 60_000;
export const POPUP_REPROMPT_DELAY_MS = 60_000;

export function getInitialVisitWaitMs(): number {
  return INITIAL_INSTALL_POPUP_DELAY_MS;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, days: number, path: string = '/'): void {
  if (typeof document === 'undefined') return;
  const maxAge = Math.max(60, Math.floor(days * 24 * 60 * 60));
  const secureFlag =
    typeof window !== 'undefined' && window.location?.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; path=${path}; max-age=${maxAge}; SameSite=Lax${secureFlag}`;
}

export function getActiveUsageMs(scope: AppPortalScope = 'user'): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(getPortalStorageKeys(scope).activeMsKey);
    if (!raw) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function addActiveUsageMs(deltaMs: number, scope: AppPortalScope = 'user'): number {
  if (typeof window === 'undefined') return 0;
  const current = getActiveUsageMs(scope);
  const next = Math.min(INITIAL_INSTALL_POPUP_DELAY_MS, current + Math.max(0, Math.round(deltaMs)));
  try {
    localStorage.setItem(getPortalStorageKeys(scope).activeMsKey, String(next));
  } catch {}
  return next;
}

export function isPopupOpenPersisted(scope: AppPortalScope = 'user'): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(getPortalStorageKeys(scope).popupOpenKey) === 'true';
  } catch {
    return false;
  }
}

export function setPopupOpenPersisted(isOpen: boolean, scope: AppPortalScope = 'user'): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getPortalStorageKeys(scope).popupOpenKey;
    if (isOpen) {
      localStorage.setItem(key, 'true');
    } else {
      localStorage.removeItem(key);
    }
  } catch {}
}

export function getRemainingInitialWaitMs(scope: AppPortalScope = 'user'): number {
  if (typeof window === 'undefined') return INITIAL_INSTALL_POPUP_DELAY_MS;
  if (window.location?.hash === '#install' || window.location?.hash === '#app-install') return 0;
  if (isPopupOpenPersisted(scope)) return 0;
  return Math.max(0, INITIAL_INSTALL_POPUP_DELAY_MS - getActiveUsageMs(scope));
}

/**
 * Checks whether the user has ALREADY downloaded or installed the scoped app.
 * If yes, they must NEVER see that app's download popup again.
 */
export function isAppDownloadedOrInstalled(
  isPwaInstalled?: boolean,
  scope: AppPortalScope = 'user'
): boolean {
  if (typeof window === 'undefined') return false;
  if (isPwaInstalled || isRunningStandalone()) return true;

  const keys = getPortalStorageKeys(scope);
  if (readCookie(keys.downloadedCookieName) === 'downloaded') return true;

  try {
    const isDownloaded = localStorage.getItem(keys.downloadedConfirmedKey);
    if (isDownloaded === 'true' || isDownloaded === '1') return true;
  } catch {}

  return false;
}

/**
 * Permanently marks the scoped app as downloaded/installed.
 * Called ONLY when installation actually completes or external download starts — NEVER on Cancel/Close.
 */
export function markAppAsDownloaded(scope: AppPortalScope = 'user'): void {
  if (typeof window === 'undefined') return;
  const keys = getPortalStorageKeys(scope);
  writeCookie(keys.downloadedCookieName, 'downloaded', 365, keys.cookiePath);
  try {
    localStorage.setItem(keys.downloadedConfirmedKey, 'true');
    localStorage.removeItem(keys.popupOpenKey);
    localStorage.removeItem(keys.popupDismissedAtKey);
    localStorage.removeItem(keys.activeMsKey);
  } catch {}
}

/**
 * Temporarily hides the popup and schedules a 1-minute (60s) reappear cooldown in localStorage.
 */
export function dismissPopupForCurrentView(
  _isAuthView?: boolean,
  now: number = Date.now(),
  scope: AppPortalScope = 'user'
): void {
  if (typeof window === 'undefined') return;
  const keys = getPortalStorageKeys(scope);
  try {
    localStorage.setItem(keys.popupDismissedAtKey, String(now));
    localStorage.removeItem(keys.popupOpenKey);
  } catch {}
}

export function clearDismissalForView(_isAuthView?: boolean, scope: AppPortalScope = 'user'): void {
  if (typeof window === 'undefined') return;
  const keys = getPortalStorageKeys(scope);
  try {
    localStorage.removeItem(keys.popupDismissedAtKey);
    sessionStorage.removeItem(AUTH_SESSION_DISMISSED_KEY);
    sessionStorage.removeItem(AUTH_DISMISSED_AT_KEY);
    sessionStorage.removeItem(APP_SESSION_DISMISSED_KEY);
    sessionStorage.removeItem(APP_DISMISSED_AT_KEY);
  } catch {}
}

/**
 * Returns remaining milliseconds (0 if ready to display immediately) for the 1-minute re-appear rule.
 */
export function getPopupRemainingCooldownMs(
  _isAuthView?: boolean,
  now: number = Date.now(),
  scope: AppPortalScope = 'user'
): number {
  if (typeof window === 'undefined') return 0;
  if (window.location?.hash === '#install' || window.location?.hash === '#app-install') return 0;

  const keys = getPortalStorageKeys(scope);
  try {
    const rawAt = localStorage.getItem(keys.popupDismissedAtKey);
    if (!rawAt) return 0;
    const dismissedAt = parseInt(rawAt, 10);
    if (!Number.isFinite(dismissedAt)) {
      localStorage.removeItem(keys.popupDismissedAtKey);
      return 0;
    }
    const elapsed = now - dismissedAt;
    if (elapsed >= 0 && elapsed < POPUP_REPROMPT_DELAY_MS) {
      return POPUP_REPROMPT_DELAY_MS - elapsed;
    }
    clearDismissalForView(false, scope);
    return 0;
  } catch {
    return 0;
  }
}

export function isDismissedForView(
  isAuthView: boolean = false,
  now: number = Date.now(),
  scope: AppPortalScope = 'user'
): boolean {
  return getPopupRemainingCooldownMs(isAuthView, now, scope) > 0;
}

/**
 * Pure helper evaluating whether the automatic install popup should be suppressed right now.
 */
export function shouldSuppressInstallPopup(params: {
  isAdminRoute: boolean;
  isMaintenanceBlocked: boolean;
  isEnabled: boolean;
  isInstalled: boolean;
  isHidden: boolean;
  isModalOpen: boolean;
  isScannerActive: boolean;
  activeModalCount: number;
  autoPromptDisabled: boolean;
  forceShow?: boolean;
  allowDedicatedPortal?: boolean;
}): boolean {
  if ((params.isAdminRoute && !params.allowDedicatedPortal) || params.isMaintenanceBlocked || !params.isEnabled) {
    return true;
  }
  if (params.isInstalled) return true;
  if (params.isModalOpen || params.isScannerActive || params.activeModalCount > 0) return true;
  if (params.forceShow) return false;
  if (params.autoPromptDisabled || params.isHidden) return true;
  return false;
}

function cleanupLegacyDismissals(): void {
  if (typeof window === 'undefined') return;
  try {
    const legacyCookie = readCookie(LEGACY_POPUP_COOKIE_NAME);
    if (legacyCookie === 'dismissed') {
      document.cookie = `${LEGACY_POPUP_COOKIE_NAME}=; path=/; max-age=0;`;
    }
    const legacyStorage = localStorage.getItem(LEGACY_POPUP_STORAGE_KEY);
    if (legacyStorage) {
      const parsed = JSON.parse(legacyStorage);
      if (parsed?.action === 'dismissed') {
        localStorage.removeItem(LEGACY_POPUP_STORAGE_KEY);
      } else if (parsed?.action === 'downloaded') {
        markAppAsDownloaded('user');
      }
    }
    sessionStorage.removeItem(AUTH_SESSION_DISMISSED_KEY);
    sessionStorage.removeItem(AUTH_DISMISSED_AT_KEY);
    sessionStorage.removeItem(APP_SESSION_DISMISSED_KEY);
    sessionStorage.removeItem(APP_DISMISSED_AT_KEY);
  } catch {}
}

export function sanitizeDownloadHref(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '/#install';
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {}
  return '/#install';
}

export const AppDownloadPopup: React.FC<AppDownloadPopupProps> = ({
  isAdminRoute,
  isMaintenanceBlocked,
  hasBottomMobileNav,
  portalScope: portalScopeProp,
}) => {
  const { appPopupSettings, appBranding, siteConfig } = useExpense();
  const {
    portalScope: contextScope,
    triggerInstallPrompt,
    openInstallModal,
    isInstalled,
    canOfferInstall,
    isModalOpen,
    isScannerActive,
    activeModalCount,
    autoPromptDisabled,
    reopenInstallPopupSignal,
  } = usePwaInstall();
  const { user } = useAuth();

  const activeScope = portalScopeProp || contextScope || 'user';
  const scopeBranding = getPortalBranding(activeScope);
  const liveIdentity = getPortalIdentityFromSiteConfig(siteConfig, activeScope);
  const isDedicatedPortal = activeScope === 'myadmin' || activeScope === 'mystaff';
  const isAuthView = !user;

  const computeIsHidden = useCallback(() => {
    if (isAppDownloadedOrInstalled(isInstalled, activeScope)) return true;
    if (isDismissedForView(isAuthView, Date.now(), activeScope)) return true;
    if (isPopupOpenPersisted(activeScope)) return false;
    return getRemainingInitialWaitMs(activeScope) > 0;
  }, [isInstalled, isAuthView, activeScope]);

  const [isHidden, setIsHidden] = useState<boolean>(computeIsHidden);
  const [dismissTick, setDismissTick] = useState<number>(0);
  const [hasMountSettled, setHasMountSettled] = useState<boolean>(() => isPopupOpenPersisted(activeScope));
  const [forceVisible, setForceVisible] = useState<boolean>(false);
  const lastVisibleTickAtRef = useRef<number | null>(null);

  useEffect(() => {
    cleanupLegacyDismissals();
    setIsHidden(computeIsHidden());
    if (hasMountSettled) return;
    const timer = window.setTimeout(() => {
      setHasMountSettled(true);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [hasMountSettled, computeIsHidden]);

  useEffect(() => {
    const handleExternalDismiss = (ev: Event) => {
      const evScope = (ev as CustomEvent<{ scope?: AppPortalScope }>).detail?.scope;
      if (evScope && evScope !== activeScope) return;
      setForceVisible(false);
      setIsHidden(true);
      setDismissTick((t) => t + 1);
    };
    window.addEventListener('mymoney:pwa-popup-dismissed', handleExternalDismiss);
    return () => window.removeEventListener('mymoney:pwa-popup-dismissed', handleExternalDismiss);
  }, [activeScope]);

  useEffect(() => {
    if (reopenInstallPopupSignal > 0 && !isAppDownloadedOrInstalled(isInstalled, activeScope)) {
      clearDismissalForView(isAuthView, activeScope);
      setPopupOpenPersisted(true, activeScope);
      setForceVisible(true);
      setIsHidden(false);
    }
  }, [reopenInstallPopupSignal, isInstalled, isAuthView, activeScope]);

  useEffect(() => {
    if (isAppDownloadedOrInstalled(isInstalled, activeScope)) {
      setPopupOpenPersisted(false, activeScope);
      setForceVisible(false);
      setIsHidden(true);
      return;
    }

    if (autoPromptDisabled && !forceVisible) {
      setIsHidden(true);
      return;
    }

    const cooldownMs = getPopupRemainingCooldownMs(isAuthView, Date.now(), activeScope);
    if (forceVisible) {
      setPopupOpenPersisted(true, activeScope);
      setIsHidden(false);
      return;
    }

    if (cooldownMs > 0) {
      setPopupOpenPersisted(false, activeScope);
      setIsHidden(true);

      const intervalId = window.setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          return;
        }
        const remaining = getPopupRemainingCooldownMs(isAuthView, Date.now(), activeScope);
        if (remaining <= 0) {
          clearDismissalForView(isAuthView, activeScope);
          setPopupOpenPersisted(true, activeScope);
          setIsHidden(false);
          window.clearInterval(intervalId);
        }
      }, 1000);

      const handleVisibilityChange = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          const remaining = getPopupRemainingCooldownMs(isAuthView, Date.now(), activeScope);
          if (remaining <= 0) {
            clearDismissalForView(isAuthView, activeScope);
            setPopupOpenPersisted(true, activeScope);
            setIsHidden(false);
          }
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        window.clearInterval(intervalId);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    if (isPopupOpenPersisted(activeScope) || getRemainingInitialWaitMs(activeScope) <= 0) {
      setPopupOpenPersisted(true, activeScope);
      setIsHidden(false);
      return;
    }

    setIsHidden(true);
    lastVisibleTickAtRef.current =
      typeof document !== 'undefined' && document.visibilityState === 'hidden' ? null : Date.now();

    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        lastVisibleTickAtRef.current = null;
        return;
      }

      const now = Date.now();
      const delta =
        lastVisibleTickAtRef.current !== null ? Math.max(0, now - lastVisibleTickAtRef.current) : 1000;
      lastVisibleTickAtRef.current = now;

      const updatedTotal = addActiveUsageMs(delta, activeScope);
      if (updatedTotal >= INITIAL_INSTALL_POPUP_DELAY_MS) {
        setPopupOpenPersisted(true, activeScope);
        setIsHidden(false);
        window.clearInterval(intervalId);
      }
    }, 1000);

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        lastVisibleTickAtRef.current = Date.now();
      } else {
        if (lastVisibleTickAtRef.current !== null) {
          addActiveUsageMs(Date.now() - lastVisibleTickAtRef.current, activeScope);
        }
        lastVisibleTickAtRef.current = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isInstalled, isAuthView, dismissTick, autoPromptDisabled, forceVisible, activeScope]);

  const safeHref = isDedicatedPortal
    ? `${scopeBranding.startUrl}#install`
    : sanitizeDownloadHref(appPopupSettings?.downloadUrl);
  const isInternalInstallAction =
    isDedicatedPortal || safeHref === '/#install' || safeHref === '#install' || safeHref === '/#app-install';
  const isExternal = !isDedicatedPortal && /^https?:\/\//i.test(safeHref);
  const isEnabled =
    canOfferInstall &&
    siteConfig.pwa.showDownloadPopup !== false &&
    (isInternalInstallAction ? true : appPopupSettings?.enabled !== false);

  if (
    !hasMountSettled ||
    shouldSuppressInstallPopup({
      isAdminRoute,
      allowDedicatedPortal: isDedicatedPortal,
      isMaintenanceBlocked,
      isEnabled,
      isInstalled: isAppDownloadedOrInstalled(isInstalled, activeScope),
      isHidden,
      isModalOpen,
      isScannerActive,
      activeModalCount,
      autoPromptDisabled,
      forceShow: forceVisible,
    })
  ) {
    return null;
  }

  const handleDismiss = () => {
    setForceVisible(false);
    dismissPopupForCurrentView(isAuthView, Date.now(), activeScope);
    setIsHidden(true);
    setDismissTick((t) => t + 1);
  };

  const handleInstallClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isInternalInstallAction) {
      e.preventDefault();
      setForceVisible(false);
      try {
        const result = await triggerInstallPrompt();
        if (result.status === 'accepted' || result.status === 'already_installed') {
          markAppAsDownloaded(activeScope);
          setIsHidden(true);
        } else if (result.status === 'dismissed') {
          dismissPopupForCurrentView(isAuthView, Date.now(), activeScope);
          setIsHidden(true);
          setDismissTick((t) => t + 1);
        } else {
          openInstallModal();
        }
      } catch (err) {
        console.warn('Install prompt error:', err);
        openInstallModal();
      }
    } else {
      markAppAsDownloaded(activeScope);
      setIsHidden(true);
    }
  };

  const appTitle = isDedicatedPortal
    ? liveIdentity.appName || scopeBranding.appName
    : liveIdentity.appName || appBranding?.appName?.trim() || 'My Money Manager';
  const appLogo = isDedicatedPortal
    ? sanitizeLogoUrl(liveIdentity.logoUrl) || scopeBranding.fallbackIcon
    : sanitizeLogoUrl(liveIdentity.logoUrl || appBranding?.logoUrl);

  const displayTitle = isDedicatedPortal
    ? `Install ${appTitle}`
    : !appPopupSettings?.title?.trim() || appPopupSettings.title.trim() === 'Get the My Money Manager App'
    ? `Install ${appTitle}`
    : appPopupSettings.title.trim();

  const displayDesc = isDedicatedPortal
    ? liveIdentity.description || scopeBranding.subtitle
    : !appPopupSettings?.description?.trim() ||
      appPopupSettings.description.trim() ===
        'Install our fast, offline-ready app for instant expense tracking & UPI alerts.'
    ? liveIdentity.description || 'Install the app for a faster experience and easy access from your home screen.'
    : appPopupSettings.description.trim();

  const displayBtnLabel = isDedicatedPortal
    ? scopeBranding.installButtonLabel
    : !appPopupSettings?.buttonLabel?.trim() || appPopupSettings.buttonLabel.trim() === 'Download App'
    ? 'Install Now'
    : appPopupSettings.buttonLabel.trim();

  const isStaff = activeScope === 'mystaff';
  const accentLabelClass = isStaff
    ? 'text-indigo-600 dark:text-indigo-400'
    : 'text-emerald-600 dark:text-emerald-400';
  const accentBadgeBg = isStaff ? 'bg-indigo-600' : 'bg-emerald-600';
  const accentButtonClass = isStaff
    ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/25'
    : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/25';

  return (
    <aside
      aria-label={`Install ${appTitle}`}
      data-testid="pwa-auto-install-popup"
      className={`fixed right-3 sm:right-6 z-40 w-[calc(100vw-1.5rem)] max-w-sm transition-all ${
        hasBottomMobileNav
          ? 'bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] lg:bottom-6'
          : 'bottom-4 sm:bottom-6'
      }`}
    >
      <div className="rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-lg border border-slate-200 dark:border-slate-700/80 shadow-2xl shadow-slate-900/15 dark:shadow-black/50 p-4">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <img
              src={appLogo}
              alt={`${appTitle} by HackifyPro`}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = scopeBranding.fallbackIcon;
              }}
              className="w-12 h-12 rounded-xl object-cover border border-slate-700/40 shadow-sm bg-slate-950"
            />
            <span
              className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-lg ${accentBadgeBg} text-white flex items-center justify-center shadow`}
            >
              <Smartphone className="w-3 h-3" />
            </span>
          </div>

          <div className="flex-1 min-w-0 pr-5">
            <p className={`text-[10px] font-extrabold uppercase tracking-wider ${accentLabelClass}`}>
              {appTitle} · HackifyPro
            </p>
            <h4 className="text-sm font-black text-slate-900 dark:text-white leading-snug mt-0.5">
              {displayTitle}
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mt-1">
              {displayDesc}
            </p>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Close install popup"
            className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleDismiss}
            className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <a
            href={safeHref}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
            onClick={handleInstallClick}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl ${accentButtonClass} text-white text-xs font-bold shadow-md transition-colors cursor-pointer`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>{displayBtnLabel}</span>
          </a>
        </div>
      </div>
    </aside>
  );
};
