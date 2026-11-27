import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { useExpense, sanitizeLogoUrl } from '../../context/ExpenseContext';
import { usePwaInstall } from '../../context/PwaInstallContext';
import { useAuth } from '../../context/AuthContext';
import { isRunningStandalone } from '../../lib/pwaUtils';

interface AppDownloadPopupProps {
  isAdminRoute: boolean;
  isMaintenanceBlocked: boolean;
  hasBottomMobileNav: boolean;
}

const DOWNLOADED_STORAGE_KEY = 'my_money_app_downloaded_confirmed';
const DOWNLOADED_COOKIE_NAME = 'mymoney_app_downloaded';
const ACTIVE_USAGE_MS_KEY = 'my_money_pwa_active_ms';
const POPUP_OPEN_KEY = 'my_money_pwa_popup_open';
const DISMISSED_AT_KEY = 'my_money_pwa_dismissed_at';

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

function writeCookie(name: string, value: string, days: number): void {
  if (typeof document === 'undefined') return;
  const maxAge = Math.max(60, Math.floor(days * 24 * 60 * 60));
  const secureFlag =
    typeof window !== 'undefined' && window.location?.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax${secureFlag}`;
}

export function getActiveUsageMs(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(ACTIVE_USAGE_MS_KEY);
    if (!raw) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function addActiveUsageMs(deltaMs: number): number {
  if (typeof window === 'undefined') return 0;
  const current = getActiveUsageMs();
  const next = Math.min(INITIAL_INSTALL_POPUP_DELAY_MS, current + Math.max(0, Math.round(deltaMs)));
  try {
    localStorage.setItem(ACTIVE_USAGE_MS_KEY, String(next));
  } catch {}
  return next;
}

export function isPopupOpenPersisted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(POPUP_OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setPopupOpenPersisted(isOpen: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (isOpen) {
      localStorage.setItem(POPUP_OPEN_KEY, 'true');
    } else {
      localStorage.removeItem(POPUP_OPEN_KEY);
    }
  } catch {}
}

export function getRemainingInitialWaitMs(): number {
  if (typeof window === 'undefined') return INITIAL_INSTALL_POPUP_DELAY_MS;
  if (window.location?.hash === '#install' || window.location?.hash === '#app-install') return 0;
  if (isPopupOpenPersisted()) return 0;
  return Math.max(0, INITIAL_INSTALL_POPUP_DELAY_MS - getActiveUsageMs());
}

/**
 * Checks whether the user has ALREADY downloaded or installed the app.
 * If yes, they must NEVER see the download popup again.
 */
export function isAppDownloadedOrInstalled(isPwaInstalled?: boolean): boolean {
  if (typeof window === 'undefined') return false;
  if (isPwaInstalled || isRunningStandalone()) return true;

  if (readCookie(DOWNLOADED_COOKIE_NAME) === 'downloaded') return true;

  try {
    const isDownloaded = localStorage.getItem(DOWNLOADED_STORAGE_KEY);
    if (isDownloaded === 'true' || isDownloaded === '1') return true;
  } catch {}

  return false;
}

/**
 * Permanently marks the app as downloaded/installed.
 * Called ONLY when installation actually completes or external download starts — NEVER on Cancel/Close.
 */
export function markAppAsDownloaded(): void {
  if (typeof window === 'undefined') return;
  writeCookie(DOWNLOADED_COOKIE_NAME, 'downloaded', 365);
  try {
    localStorage.setItem(DOWNLOADED_STORAGE_KEY, 'true');
    localStorage.removeItem(POPUP_OPEN_KEY);
    localStorage.removeItem(DISMISSED_AT_KEY);
    localStorage.removeItem(ACTIVE_USAGE_MS_KEY);
  } catch {}
}

/**
 * Temporarily hides the popup and schedules a 1-minute (60s) reappear cooldown in localStorage.
 * Persists across refreshes, route changes, login transitions, and browser restarts.
 */
export function dismissPopupForCurrentView(_isAuthView?: boolean, now: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DISMISSED_AT_KEY, String(now));
    localStorage.removeItem(POPUP_OPEN_KEY);
  } catch {}
}

export function clearDismissalForView(_isAuthView?: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(DISMISSED_AT_KEY);
    sessionStorage.removeItem(AUTH_SESSION_DISMISSED_KEY);
    sessionStorage.removeItem(AUTH_DISMISSED_AT_KEY);
    sessionStorage.removeItem(APP_SESSION_DISMISSED_KEY);
    sessionStorage.removeItem(APP_DISMISSED_AT_KEY);
  } catch {}
}

/**
 * Returns remaining milliseconds (0 if ready to display immediately) for the 1-minute re-appear rule.
 */
export function getPopupRemainingCooldownMs(_isAuthView?: boolean, now: number = Date.now()): number {
  if (typeof window === 'undefined') return 0;
  if (window.location?.hash === '#install' || window.location?.hash === '#app-install') return 0;

  try {
    const rawAt = localStorage.getItem(DISMISSED_AT_KEY);
    if (!rawAt) return 0;
    const dismissedAt = parseInt(rawAt, 10);
    if (!Number.isFinite(dismissedAt)) {
      localStorage.removeItem(DISMISSED_AT_KEY);
      return 0;
    }
    const elapsed = now - dismissedAt;
    if (elapsed >= 0 && elapsed < POPUP_REPROMPT_DELAY_MS) {
      return POPUP_REPROMPT_DELAY_MS - elapsed;
    }
    clearDismissalForView();
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Checks if dismissed within the active 1-minute cooldown window.
 */
export function isDismissedForView(isAuthView: boolean = false, now: number = Date.now()): boolean {
  return getPopupRemainingCooldownMs(isAuthView, now) > 0;
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
}): boolean {
  if (params.isAdminRoute || params.isMaintenanceBlocked || !params.isEnabled) return true;
  if (params.isInstalled) return true;
  if (params.isModalOpen || params.isScannerActive || params.activeModalCount > 0) return true;
  if (params.forceShow) return false;
  if (params.autoPromptDisabled || params.isHidden) return true;
  return false;
}

/**
 * Cleans up legacy 7-day dismiss cookies so users aren't locked out.
 */
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
        markAppAsDownloaded();
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
  } catch {
    // invalid URL falls back to built-in install handler
  }
  return '/#install';
}

export const AppDownloadPopup: React.FC<AppDownloadPopupProps> = ({
  isAdminRoute,
  isMaintenanceBlocked,
  hasBottomMobileNav,
}) => {
  const { appPopupSettings, appBranding } = useExpense();
  const {
    triggerInstallPrompt,
    openInstallModal,
    isInstalled,
    isModalOpen,
    isScannerActive,
    activeModalCount,
    autoPromptDisabled,
    reopenInstallPopupSignal,
  } = usePwaInstall();
  const { user } = useAuth();

  const isAuthView = !user;

  const computeIsHidden = useCallback(() => {
    if (isAppDownloadedOrInstalled(isInstalled)) return true;
    if (isDismissedForView(isAuthView)) return true;
    if (isPopupOpenPersisted()) return false;
    return getRemainingInitialWaitMs() > 0;
  }, [isInstalled, isAuthView]);

  const [isHidden, setIsHidden] = useState<boolean>(computeIsHidden);
  const [dismissTick, setDismissTick] = useState<number>(0);
  const [hasMountSettled, setHasMountSettled] = useState<boolean>(() => isPopupOpenPersisted());
  const [forceVisible, setForceVisible] = useState<boolean>(false);
  const lastVisibleTickAtRef = useRef<number | null>(null);

  useEffect(() => {
    cleanupLegacyDismissals();
    if (hasMountSettled) return;
    const timer = window.setTimeout(() => {
      setHasMountSettled(true);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [hasMountSettled]);

  // Listen to modal dismissals from PwaInstallContext so AppDownloadPopup enters 1-min cooldown cleanly
  useEffect(() => {
    const handleExternalDismiss = () => {
      setForceVisible(false);
      setIsHidden(true);
      setDismissTick((t) => t + 1);
    };
    window.addEventListener('mymoney:pwa-popup-dismissed', handleExternalDismiss);
    return () => window.removeEventListener('mymoney:pwa-popup-dismissed', handleExternalDismiss);
  }, []);

  // Reopen immediately whenever user triggers "Reopen Install Popup" from Settings
  useEffect(() => {
    if (reopenInstallPopupSignal > 0 && !isAppDownloadedOrInstalled(isInstalled)) {
      clearDismissalForView(isAuthView);
      setPopupOpenPersisted(true);
      setForceVisible(true);
      setIsHidden(false);
    }
  }, [reopenInstallPopupSignal, isInstalled, isAuthView]);

  // Lifecycle effect:
  // 1. If installed/downloaded: permanently stop showing.
  // 2. If already opened previously & not dismissed: stay open across refreshes, routes, login transitions, & restarts.
  // 3. If user clicked Cancel/Close: hide and wait 1 minute (60s), persisting across refreshes/restarts, then reopen.
  // 4. On initial visit when not opened yet: accumulate 60s of active/visible page time in localStorage, then open.
  useEffect(() => {
    if (isAppDownloadedOrInstalled(isInstalled)) {
      setPopupOpenPersisted(false);
      setForceVisible(false);
      setIsHidden(true);
      return;
    }

    if (autoPromptDisabled && !forceVisible) {
      setIsHidden(true);
      return;
    }

    const cooldownMs = getPopupRemainingCooldownMs(isAuthView);
    if (forceVisible) {
      setPopupOpenPersisted(true);
      setIsHidden(false);
      return;
    }

    // In cooldown after Cancel/Close
    if (cooldownMs > 0) {
      setPopupOpenPersisted(false);
      setIsHidden(true);

      const intervalId = window.setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          return;
        }
        const remaining = getPopupRemainingCooldownMs(isAuthView, Date.now());
        if (remaining <= 0) {
          clearDismissalForView(isAuthView);
          setPopupOpenPersisted(true);
          setIsHidden(false);
          window.clearInterval(intervalId);
        }
      }, 1000);

      const handleVisibilityChange = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          const remaining = getPopupRemainingCooldownMs(isAuthView, Date.now());
          if (remaining <= 0) {
            clearDismissalForView(isAuthView);
            setPopupOpenPersisted(true);
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

    // Check if already ready to display (persisted open OR 60s active usage completed)
    if (isPopupOpenPersisted() || getRemainingInitialWaitMs() <= 0) {
      setPopupOpenPersisted(true);
      setIsHidden(false);
      return;
    }

    // Initial 60s active visible page time tracker
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

      const updatedTotal = addActiveUsageMs(delta);
      if (updatedTotal >= INITIAL_INSTALL_POPUP_DELAY_MS) {
        setPopupOpenPersisted(true);
        setIsHidden(false);
        window.clearInterval(intervalId);
      }
    }, 1000);

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        lastVisibleTickAtRef.current = Date.now();
      } else {
        if (lastVisibleTickAtRef.current !== null) {
          addActiveUsageMs(Date.now() - lastVisibleTickAtRef.current);
        }
        lastVisibleTickAtRef.current = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isInstalled, isAuthView, dismissTick, autoPromptDisabled, forceVisible]);

  const safeHref = sanitizeDownloadHref(appPopupSettings?.downloadUrl);
  const isInternalInstallAction =
    safeHref === '/#install' || safeHref === '#install' || safeHref === '/#app-install';
  const isExternal = /^https?:\/\//i.test(safeHref);
  // Built-in PWA install prompt stays active even if optional site banner toggle is false
  const isEnabled = isInternalInstallAction ? true : appPopupSettings?.enabled !== false;

  if (
    !hasMountSettled ||
    shouldSuppressInstallPopup({
      isAdminRoute,
      isMaintenanceBlocked,
      isEnabled,
      isInstalled: isAppDownloadedOrInstalled(isInstalled),
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
    dismissPopupForCurrentView(isAuthView);
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
          markAppAsDownloaded();
          setIsHidden(true);
        } else if (result.status === 'dismissed') {
          // User declined browser install prompt: do NOT mark installed; reappear after 1 min
          dismissPopupForCurrentView(isAuthView);
          setIsHidden(true);
          setDismissTick((t) => t + 1);
        } else {
          // Native beforeinstallprompt unavailable (iOS Safari, macOS Safari, or other browser): open guide modal
          openInstallModal();
        }
      } catch (err) {
        console.warn('Install prompt error:', err);
        openInstallModal();
      }
    } else {
      markAppAsDownloaded();
      setIsHidden(true);
    }
  };

  const appTitle = appBranding?.appName?.trim() || 'My Money Manager';
  const appLogo = sanitizeLogoUrl(appBranding?.logoUrl);

  const rawPopupTitle = appPopupSettings?.title?.trim();
  const displayTitle =
    !rawPopupTitle || rawPopupTitle === 'Get the My Money Manager App'
      ? 'Install My Money Manager'
      : rawPopupTitle;

  const rawPopupDesc = appPopupSettings?.description?.trim();
  const displayDesc =
    !rawPopupDesc ||
    rawPopupDesc === 'Install our fast, offline-ready app for instant expense tracking & UPI alerts.'
      ? 'Install the app for a faster experience and easy access from your home screen.'
      : rawPopupDesc;

  const rawBtnLabel = appPopupSettings?.buttonLabel?.trim();
  const displayBtnLabel = !rawBtnLabel || rawBtnLabel === 'Download App' ? 'Install Now' : rawBtnLabel;

  return (
    <aside
      aria-label="Install My Money Manager"
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
                (e.currentTarget as HTMLImageElement).src = '/icon-192.png';
              }}
              className="w-12 h-12 rounded-xl object-cover border border-emerald-500/30 shadow-sm bg-black"
            />
            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow">
              <Smartphone className="w-3 h-3" />
            </span>
          </div>

          <div className="flex-1 min-w-0 pr-5">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
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
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/25 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{displayBtnLabel}</span>
          </a>
        </div>
      </div>
    </aside>
  );
};
