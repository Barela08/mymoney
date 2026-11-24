import React, { useState, useEffect } from 'react';
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

  const handleDismiss = () => {
    // Dismisses the install suggestion immediately without installing
    dismissBanner();
  };

  // Nielsen Heuristic: User Control & Freedom — Escape key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen) {
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  if (!isModalOpen) return null;

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
              src="/icon-192.png"
              alt="My Money Manager"
              className="w-12 h-12 rounded-2xl object-cover shadow-md border-2 border-emerald-500/40 shrink-0"
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Installable Web App · {compatibility.deviceLabel}
              </p>
              <h3
                id="pwa-install-modal-title"
                className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5"
              >
                Install My Money Manager
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Launch directly from your home screen or desktop with standalone view.
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
          <div className="p-2.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 text-center space-y-1">
            <Zap className="w-4 h-4 mx-auto text-emerald-600 dark:text-emerald-400" />
            <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">1-Tap Launch</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">App window mode</p>
          </div>
          <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 text-center space-y-1">
            <WifiOff className="w-4 h-4 mx-auto text-blue-600 dark:text-blue-400" />
            <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">Offline Shell</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">Fast repeat loads</p>
          </div>
          <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 text-center space-y-1">
            <Bell className="w-4 h-4 mx-auto text-amber-600 dark:text-amber-400" />
            <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">Push Alerts</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">Opt-in reminders</p>
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
                My Money Manager is already running as an installed app on this device.
              </p>
            </div>
          </div>
        ) : compatibility.platform === 'ios_safari' ? (
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
              <Smartphone className="w-4 h-4 text-emerald-600" />
              <span>Install on iPhone / iPad (Safari)</span>
            </div>
            <ol className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                  1
                </span>
                <span>
                  Tap the <strong>Share</strong> button (
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
                  Tap <strong>Add</strong>. Open the installed icon from your Home Screen (also required on iOS 16.4+ to enable Web Push notifications).
                </span>
              </li>
            </ol>
          </div>
        ) : compatibility.platform === 'macos_safari' ? (
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
              <Laptop className="w-4 h-4 text-emerald-600" />
              <span>Install on macOS (Safari)</span>
            </div>
            <ol className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                  1
                </span>
                <span>
                  In Safari&apos;s menu bar, click <strong>File &rarr; Add to Dock...</strong> (macOS Sonoma 14+ or newer), or click the Share icon in the address bar.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                  2
                </span>
                <span>
                  Confirm the name <strong>My Money Manager</strong> and click <strong>Add</strong>.
                </span>
              </li>
            </ol>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
              {compatibility.osLabel === 'Android' ? (
                <Smartphone className="w-4 h-4 text-emerald-600" />
              ) : (
                <Laptop className="w-4 h-4 text-emerald-600" />
              )}
              <span>Install in {compatibility.browserLabel} ({compatibility.osLabel})</span>
            </div>
            {isInstallable ? (
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Click <strong>Install App</strong> below to open your browser&apos;s native installation confirmation dialog.
              </p>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Open your browser menu (
                <MoreVertical className="w-3.5 h-3.5 inline mx-0.5 text-slate-500" />) or the install icon in the address bar and choose{' '}
                <strong>Install My Money Manager</strong> or <strong>Add to Home screen</strong>.
              </p>
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
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-semibold shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60"
                >
                  <Download className="w-4 h-4 stroke-[2.25]" />
                  <span>{isTriggering ? 'Opening Browser Prompt...' : 'Install App'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleDismiss}
                className="w-full py-2.5 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
              >
                {isInstallable ? 'Not Now (Dismiss)' : 'Dismiss'}
              </button>
            </div>
            <p className="text-[11px] text-center text-slate-400 dark:text-slate-500">
              Dismissing closes this prompt without installing. You can still install anytime from the header while available.
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
