import React, { useState, useEffect, useCallback } from 'react';
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
 * - Reappears automatically after POPUP_REPROMPT_DELAY_MS (60 seconds) if not installed.
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
  if (window.location?.hash === '#install') return 0;

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
  const { triggerInstallPrompt, openInstallModal, isInstalled } = usePwaInstall();
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

  // On mount: clean up legacy 7-day dismissals
  useEffect(() => {
    cleanupLegacyDismissals();
  }, []);

  // Re-evaluate visibility and schedule exact 1-minute re-appear if user cancelled without installing.
  // While visible and not installed, never auto-hide on its own.
  useEffect(() => {
    if (isAppDownloadedOrInstalled(isInstalled)) {
      setIsHidden(true);
      return;
    }

    const remainingMs = getPopupRemainingCooldownMs(isAuthView);
    if (remainingMs <= 0) {
      setIsHidden(false);
      return;
    }

    setIsHidden(true);
    const timer = window.setTimeout(() => {
      clearDismissalForView(isAuthView);
      setIsHidden(false);
    }, remainingMs);

    return () => window.clearTimeout(timer);
  }, [isInstalled, isAuthView, dismissTick]);

  // Popup is visible by default unless explicitly disabled by admin, suppressed after cancel cooldown, or already installed
  const isEnabled = appPopupSettings?.enabled !== false;

  if (isAdminRoute || isMaintenanceBlocked || !isEnabled || isHidden) {
    return null;
  }

  const safeHref = sanitizeDownloadHref(appPopupSettings?.downloadUrl);
  const isInternalInstallAction = safeHref === '/#install' || safeHref === '#install';
  const isExternal = /^https?:\/\//i.test(safeHref);

  const handleDismiss = () => {
    dismissPopupForCurrentView(isAuthView);
    setIsHidden(true);
    setDismissTick((t) => t + 1);
  };

  const handleDownloadClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isInternalInstallAction) {
      e.preventDefault();
      try {
        const result = await triggerInstallPrompt();
        if (result.status === 'accepted' || result.status === 'already_installed') {
          markAppAsDownloaded();
          setIsHidden(true);
        } else if (result.status === 'dismissed') {
          // User cancelled native install dialog without downloading: hide and re-show in 1 minute
          dismissPopupForCurrentView(isAuthView);
          setIsHidden(true);
          setDismissTick((t) => t + 1);
        } else {
          // Manual guide / native prompt unavailable yet: open install instructions modal
          // without marking as downloaded and without permanently hiding the popup
          openInstallModal();
        }
      } catch (err) {
        console.warn('Install prompt error:', err);
        openInstallModal();
      }
    } else {
      // External store or APK download link
      markAppAsDownloaded();
      setIsHidden(true);
    }
  };

  const appTitle = appBranding?.appName?.trim() || 'My Money Manager';
  const appLogo = sanitizeLogoUrl(appBranding?.logoUrl);

  return (
    <aside
      aria-label="Download App"
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
                (e.currentTarget as HTMLImageElement).src = '/logo.jpg';
              }}
              className="w-12 h-12 rounded-xl object-cover border border-emerald-500/30 shadow-sm bg-white"
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
              {appPopupSettings?.title || 'Get the My Money Manager App'}
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mt-1">
              {appPopupSettings?.description ||
                'Install our fast, offline-ready app for instant expense tracking & UPI alerts.'}
            </p>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Close app download popup"
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
            onClick={handleDownloadClick}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/25 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{appPopupSettings?.buttonLabel || 'Download App'}</span>
          </a>
        </div>
      </div>
    </aside>
  );
};
