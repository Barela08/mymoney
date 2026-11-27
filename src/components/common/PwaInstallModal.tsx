import React, { useState, useEffect, useCallback } from 'react';
import {
  Download,
  X,
  Smartphone,
  Share,
  CheckCircle2,
  Zap,
  WifiOff,
  Bell,
  Laptop,
  MoreVertical,
} from 'lucide-react';
import { usePwaInstall } from '../../context/PwaInstallContext';

export const PwaInstallModal: React.FC = () => {
  const {
    portalScope,
    portalBranding,
    isModalOpen,
    dismissBanner,
    triggerInstallPrompt,
    isInstallable,
    isInstalled,
    compatibility,
  } = usePwaInstall();

  const [isTriggering, setIsTriggering] = useState(false);

  const handleInstallClick = async () => {
    if (isTriggering) return;
    setIsTriggering(true);
    try {
      await triggerInstallPrompt();
    } finally {
      setIsTriggering(false);
    }
  };

  const handleDismiss = useCallback(() => {
    dismissBanner();
  }, [dismissBanner]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen) {
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, handleDismiss]);

  if (!isModalOpen) return null;

  const isStaff = portalScope === 'mystaff';
  const appName = portalBranding.appName;
  const appIcon = portalBranding.fallbackIcon;
  const accentText = isStaff
    ? 'text-indigo-600 dark:text-indigo-400'
    : 'text-emerald-600 dark:text-emerald-400';
  const accentBorder = isStaff ? 'border-indigo-500/40' : 'border-emerald-500/40';
  const accentBgSoft = isStaff
    ? 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-100 dark:border-indigo-900/40'
    : 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-900/40';
  const accentButton = isStaff
    ? 'bg-indigo-600 hover:bg-indigo-700'
    : 'bg-emerald-600 hover:bg-emerald-700';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-install-modal-title"
    >
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden p-6 sm:p-7 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src={appIcon}
              alt={appName}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = '/icon-192.png';
              }}
              className={`w-12 h-12 rounded-2xl object-cover shadow-md border-2 ${accentBorder} shrink-0`}
            />
            <div>
              <p className={`text-[11px] font-semibold uppercase tracking-wider ${accentText}`}>
                Dedicated {portalScope === 'myadmin' ? 'Admin' : portalScope === 'mystaff' ? 'Staff' : 'Web'} App · {compatibility.deviceLabel}
              </p>
              <h3
                id="pwa-install-modal-title"
                className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5"
              >
                Install {appName}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Launch {portalBranding.startUrl} directly as a standalone app from your Home Screen or Desktop.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Dismiss install prompt"
            title="Dismiss"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Highlights */}
        <div className="grid grid-cols-3 gap-2">
          <div className={`p-2.5 rounded-2xl border text-center space-y-1 ${accentBgSoft}`}>
            <Zap className={`w-4 h-4 mx-auto ${accentText}`} />
            <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">1-Tap Launch</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">{portalBranding.startUrl} window</p>
          </div>
          <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 text-center space-y-1">
            <WifiOff className="w-4 h-4 mx-auto text-blue-600 dark:text-blue-400" />
            <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">Offline Shell</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">Isolated cache</p>
          </div>
          <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 text-center space-y-1">
            <Bell className="w-4 h-4 mx-auto text-amber-600 dark:text-amber-400" />
            <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">Push Alerts</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">Role-scoped alerts</p>
          </div>
        </div>

        {/* Platform-specific installation steps */}
        {isInstalled ? (
          <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            <div>
              <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                App Already Installed
              </p>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                {appName} is already running as an installed standalone app on this device.
              </p>
            </div>
          </div>
        ) : compatibility.platform === 'ios_safari' ? (
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
              <Smartphone className={`w-4 h-4 ${accentText}`} />
              <span>Install {appName} on iPhone / iPad (Safari)</span>
            </div>
            <ol className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                  1
                </span>
                <span>
                  While viewing <strong>{portalBranding.startUrl}</strong>, tap <strong>Share</strong> (
                  <Share className="w-3.5 h-3.5 inline mx-0.5 text-blue-500" />) in Safari&apos;s toolbar.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                  2
                </span>
                <span>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                  3
                </span>
                <span>
                  Confirm <strong>{appName}</strong> and tap <strong>Add</strong>.
                </span>
              </li>
            </ol>
          </div>
        ) : compatibility.platform === 'macos_safari' ? (
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
              <Laptop className={`w-4 h-4 ${accentText}`} />
              <span>Install {appName} on macOS (Safari)</span>
            </div>
            <ol className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                  1
                </span>
                <span>
                  In Safari&apos;s menu bar, click <strong>File &rarr; Add to Dock...</strong> (macOS Sonoma 14+ or newer).
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                  2
                </span>
                <span>
                  Confirm <strong>{appName}</strong> and click <strong>Add</strong>.
                </span>
              </li>
            </ol>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
              {compatibility.osLabel === 'Android' ? (
                <Smartphone className={`w-4 h-4 ${accentText}`} />
              ) : (
                <Laptop className={`w-4 h-4 ${accentText}`} />
              )}
              <span>Install {appName} in {compatibility.browserLabel} ({compatibility.osLabel})</span>
            </div>
            {isInstallable ? (
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Click <strong>{portalBranding.installButtonLabel}</strong> below to install <strong>{appName}</strong> as its own standalone app opening directly at <code>{portalBranding.startUrl}</code>.
              </p>
            ) : (
              <ol className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                    1
                  </span>
                  <span>
                    Make sure you are on <strong>{portalBranding.startUrl}</strong> and open your browser menu (
                    <MoreVertical className="w-3.5 h-3.5 inline mx-0.5 text-slate-500" />) or click the{' '}
                    <strong>Install</strong> icon in the address bar.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                    2
                  </span>
                  <span>
                    Select <strong>Install {appName}</strong> or <strong>Add to Home screen</strong>.
                  </span>
                </li>
              </ol>
            )}
          </div>
        )}

        {/* Footer Actions */}
        {!isInstalled ? (
          <div className="space-y-2 pt-1">
            <div className="flex flex-col sm:flex-row items-center gap-2.5">
              {isInstallable && (
                <button
                  type="button"
                  onClick={handleInstallClick}
                  disabled={isTriggering}
                  className={`w-full py-2.5 px-4 ${accentButton} active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-semibold shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60`}
                >
                  <Download className="w-4 h-4 stroke-[2.25]" />
                  <span>{isTriggering ? 'Opening Browser Prompt...' : portalBranding.installButtonLabel}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleDismiss}
                className="w-full py-2.5 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
              >
                {isInstallable ? 'Not Now (Dismiss)' : 'Close Guide'}
              </button>
            </div>
            <p className="text-[11px] text-center text-slate-400 dark:text-slate-500">
              Closing this guide will remind you again in 1 minute while {appName} is not installed.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleDismiss}
            className="w-full py-2.5 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
};
