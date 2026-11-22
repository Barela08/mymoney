import React from 'react';
import { Download, X, Smartphone, Sparkles } from 'lucide-react';
import { usePwaInstall } from '../../context/PwaInstallContext';

export const PwaInstallBanner: React.FC = () => {
  const {
    isInstalled,
    isBannerDismissed,
    dismissBanner,
    triggerInstallPrompt,
  } = usePwaInstall();

  // If already installed or dismissed by user, do not render
  if (isInstalled || isBannerDismissed) {
    return null;
  }

  return (
    <div className="lg:hidden fixed top-16 right-3 sm:right-6 z-40 max-w-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-3 sm:p-3.5 rounded-2xl shadow-lg border border-slate-200/80 dark:border-slate-800 animate-fade-in flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <img
          src="/logo.jpg"
          alt="My Money"
          className="w-9 h-9 rounded-xl object-cover border border-slate-200/80 dark:border-slate-800 shrink-0"
        />
        <div className="min-w-0">
          <p className="font-semibold text-xs tracking-tight text-slate-900 dark:text-slate-100">
            Install My Money App
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Fast access & offline sync
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={triggerInstallPrompt}
          className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] font-medium text-xs rounded-xl text-white transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5 stroke-[1.75]" />
          <span>Install</span>
        </button>
        <button
          onClick={dismissBanner}
          className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
          aria-label="Dismiss banner"
          title="Dismiss"
        >
          <X className="w-4 h-4 stroke-[1.75]" />
        </button>
      </div>
    </div>
  );
};
