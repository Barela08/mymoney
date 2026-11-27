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
const AUTH_SESSION_DISMISSED_KEY = 'my_money_popup_auth_dismissed';
const APP_SESSION_DISMISSED_KEY = 'my_money_popup_app_dismissed';
const AUTH_DISMISSED_AT_KEY = 'my_money_popup_auth_dismissed_at';
const APP_DISMISSED_AT_KEY = 'my_money_popup_app_dismissed_at';

export const POPUP_REPROMPT_DELAY_MS = 60_000;

export function getInitialVisitWaitMs(): number {
  return 0;
}

// Legacy keys to clean up so users are not blocked by old 7-day cookie
const LEGACY_POPUP_STORAGE_KEY = 'my_money_app_popup_action';
const LEGACY_POPUP_COOKIE_NAME = 'mymoney_app_popup_dismissed';

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

/**
 * Checks whether the user has ALREADY downloaded or installed the app.
 * If yes, they must NEVER see the download popup again.
 */
export function isAppDownloadedOrInstalled(isPwaInstalled?: boolean): boolean {
  if (typeof window === 'undefined') return false;
  if (isPwaInstalled || isRunningStandalone()) return true;

  // Check persistent downloaded cookie & localStorage flag
  if (readCookie(DOWNLOADED_COOKIE_NAME) === 'downloaded') return true;

  try {
    const isDownloaded = localStorage.getItem(DOWNLOADED_STORAGE_KEY);
    if (isDownloaded === 'true' || isDownloaded === '1') return true;
  } catch {}

  return false;
}

/**
 * Permanently marks the app as downloaded/installed.
 */
export function markAppAsDownloaded(): void {
  if (typeof window === 'undefined') return;
  writeCookie(DOWNLOADED_COOKIE_NAME, 'downloaded', 365);
  try {
    localStorage.setItem(DOWNLOADED_STORAGE_KEY, 'true');
  } catch {}
}

/**
 * Temporarily dismisses the popup for the current view and starts a 1-minute cooldown:
 * - If cancelled on login/auth view, dismisses ONLY for the auth view.
 * - Reappears automatically after POPUP_REPROMPT_DELAY_MS (60 seconds) of visible browser usage if not installed.
 */
export function dismissPopupForCurrentView(isAuthView: boolean, now: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    if (isAuthView) {
      sessionStorage.setItem(AUTH_SESSION_DISMISSED_KEY, 'true');
      sessionStorage.setItem(AUTH_DISMISSED_AT_KEY, String(now));
    } else {
      sessionStorage.setItem(APP_SESSION_DISMISSED_KEY, 'true');
      sessionStorage.setItem(APP_DISMISSED_AT_KEY, String(now));
    }
  } catch {}
}

export function clearDismissalForView(isAuthView: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (isAuthView) {
      sessionStorage.removeItem(AUTH_SESSION_DISMISSED_KEY);
      sessionStorage.removeItem(AUTH_DISMISSED_AT_KEY);
    } else {
      sessionStorage.removeItem(APP_SESSION_DISMISSED_KEY);
      sessionStorage.removeItem(APP_DISMISSED_AT_KEY);
    }
  } catch {}
}

/**
 * Returns remaining milliseconds (0 if ready to display immediately) for the 1-minute re-appear rule.
 */
export function getPopupRemainingCooldownMs(isAuthView: boolean, now: number = Date.now()): number {
  if (typeof window === 'undefined') return 0;
  if (window.location?.hash === '#install' || window.location?.hash === '#app-install') return 0;

  const flagKey = isAuthView ? AUTH_SESSION_DISMISSED_KEY : APP_SESSION_DISMISSED_KEY;
  const atKey = isAuthView ? AUTH_DISMISSED_AT_KEY : APP_DISMISSED_AT_KEY;

  try {
    const isMarked = sessionStorage.getItem(flagKey) === 'true';
    if (!isMarked) {
      sessionStorage.removeItem(atKey);
      return 0;
    }

    const rawAt = sessionStorage.getItem(atKey);
    if (rawAt) {
      const dismissedAt = parseInt(rawAt, 10);
      if (Number.isFinite(dismissedAt)) {
        const elapsed = now - dismissedAt;
        if (elapsed >= 0 && elapsed < POPUP_REPROMPT_DELAY_MS) {
          return POPUP_REPROMPT_DELAY_MS - elapsed;
        }
        clearDismissalForView(isAuthView);
        return 0;
      }
    }

    return POPUP_REPROMPT_DELAY_MS;
  } catch {
    return 0;
  }
}

/**
 * Checks if dismissed for the given view within the active 1-minute cooldown window.
 */
export function isDismissedForView(isAuthView: boolean, now: number = Date.now()): boolean {
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
    if (isAppDownloadedOrInstalled(isInstalled)) {
      return true;
    }
    if (isDismissedForView(isAuthView)) {
      return true;
    }
    return false;
  }, [isInstalled, isAuthView]);

  const [isHidden, setIsHidden] = useState<boolean>(computeIsHidden);
  const [dismissTick, setDismissTick] = useState<number>(0);
  const [hasMountSettled, setHasMountSettled] = useState<boolean>(false);
  const [forceVisible, setForceVisible] = useState<boolean>(false);
  const remainingVisibleMsRef = useRef<number>(0);

  // Clean up legacy 7-day dismissals on mount + brief 600ms settle so initial render doesn't flicker
  useEffect(() => {
    cleanupLegacyDismissals();
    const timer = window.setTimeout(() => {
      setHasMountSettled(true);
    }, 600);
    return () => window.clearTimeout(timer);
  }, []);

  // Reopen immediately whenever user triggers "Reopen Install Popup" from Settings
  useEffect(() => {
    if (reopenInstallPopupSignal > 0 && !isAppDownloadedOrInstalled(isInstalled)) {
      clearDismissalForView(isAuthView);
      remainingVisibleMsRef.current = 0;
      setForceVisible(true);
      setIsHidden(false);
    }
  }, [reopenInstallPopupSignal, isInstalled, isAuthView]);

  // Lifecycle effect:
  // 1. If installed/downloaded: permanently stop showing.
  // 2. If user dismissed (Cancel): wait 1 minute (60s) of active/visible tab time, pausing when tab is hidden.
  // 3. On initial visit when not dismissed: show as soon as mount settles.
  useEffect(() => {
    if (isAppDownloadedOrInstalled(isInstalled)) {
      remainingVisibleMsRef.current = 0;
      setForceVisible(false);
      setIsHidden(true);
      return;
    }

    if (autoPromptDisabled && !forceVisible) {
      setIsHidden(true);
      return;
    }

    const cooldownMs = getPopupRemainingCooldownMs(isAuthView);
    if (cooldownMs <= 0 || forceVisible) {
      remainingVisibleMsRef.current = 0;
      setIsHidden(false);
      return;
    }

    setIsHidden(true);
    remainingVisibleMsRef.current = cooldownMs;

    let lastVisibleTickAt =
      typeof document !== 'undefined' && document.visibilityState === 'hidden' ? null : Date.now();

    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        lastVisibleTickAt = null;
        return;
      }

      const now = Date.now();
      const delta = lastVisibleTickAt !== null ? Math.max(0, now - lastVisibleTickAt) : 1000;
      lastVisibleTickAt = now;
      remainingVisibleMsRef.current = Math.max(0, remainingVisibleMsRef.current - delta);

      if (remainingVisibleMsRef.current <= 0) {
        clearDismissalForView(isAuthView);
        setIsHidden(false);
        window.clearInterval(intervalId);
      }
    }, 1000);

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        lastVisibleTickAt = Date.now();
      } else {
        lastVisibleTickAt = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isInstalled, isAuthView, dismissTick, autoPromptDisabled, forceVisible]);

  const isEnabled = appPopupSettings?.enabled !== false;

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

  const safeHref = sanitizeDownloadHref(appPopupSettings?.downloadUrl);
  const isInternalInstallAction =
    safeHref === '/#install' || safeHref === '#install' || safeHref === '/#app-install';
  const isExternal = /^https?:\/\//i.test(safeHref);

  const handleDismiss = () => {
    setForceVisible(false);
    dismissPopupForCurrentView(isAuthView);
    remainingVisibleMsRef.current = POPUP_REPROMPT_DELAY_MS;
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
          remainingVisibleMsRef.current = POPUP_REPROMPT_DELAY_MS;
          setIsHidden(true);
          setDismissTick((t) => t + 1);
        } else {
          // Native beforeinstallprompt unavailable (e.g. iOS Safari or manual browser): open guide modal
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
