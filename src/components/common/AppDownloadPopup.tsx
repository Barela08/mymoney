import React, { useState, useEffect } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { useExpense, sanitizeLogoUrl } from '../../context/ExpenseContext';
import { usePwaInstall } from '../../context/PwaInstallContext';
import { isRunningStandalone } from '../../lib/pwaUtils';

interface AppDownloadPopupProps {
  isAdminRoute: boolean;
  isMaintenanceBlocked: boolean;
  hasBottomMobileNav: boolean;
}

const POPUP_STORAGE_KEY = 'my_money_app_popup_action';
const POPUP_COOKIE_NAME = 'mymoney_app_popup_dismissed';
const DISMISS_DAYS = 7;
const DOWNLOADED_DAYS = 30;

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

function isPopupSuppressedByUser(): boolean {
  if (typeof window === 'undefined') return true;
  if (isRunningStandalone()) return true;

  const cookieVal = readCookie(POPUP_COOKIE_NAME);
  if (cookieVal === 'dismissed' || cookieVal === 'downloaded') {
    return true;
  }

  try {
    const raw = localStorage.getItem(POPUP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.expiresAt && Number(parsed.expiresAt) > Date.now()) {
        return true;
      }
      localStorage.removeItem(POPUP_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }

  return false;
}

function persistUserPopupPreference(action: 'dismissed' | 'downloaded'): void {
  const days = action === 'downloaded' ? DOWNLOADED_DAYS : DISMISS_DAYS;
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
  writeCookie(POPUP_COOKIE_NAME, action, days);
  try {
    localStorage.setItem(
      POPUP_STORAGE_KEY,
      JSON.stringify({ action, timestamp: Date.now(), expiresAt })
    );
  } catch {
    // ignore storage errors
  }
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
  const { triggerInstallPrompt } = usePwaInstall();

  const [isHidden, setIsHidden] = useState<boolean>(() => isPopupSuppressedByUser());

  useEffect(() => {
    setIsHidden(isPopupSuppressedByUser());
  }, []);

  if (isAdminRoute || isMaintenanceBlocked || !appPopupSettings?.enabled || isHidden) {
    return null;
  }

  const safeHref = sanitizeDownloadHref(appPopupSettings.downloadUrl);
  const isInternalInstallAction = safeHref === '/#install' || safeHref === '#install';
  const isExternal = /^https?:\/\//i.test(safeHref);

  const handleDismiss = () => {
    persistUserPopupPreference('dismissed');
    setIsHidden(true);
  };

  const handleDownloadClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    persistUserPopupPreference('downloaded');
    setIsHidden(true);

    if (isInternalInstallAction) {
      e.preventDefault();
      triggerInstallPrompt().catch(() => {});
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
              {appPopupSettings.title || 'Get the My Money Manager App'}
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mt-1">
              {appPopupSettings.description ||
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
            <span>{appPopupSettings.buttonLabel || 'Download App'}</span>
          </a>
        </div>
      </div>
    </aside>
  );
};
