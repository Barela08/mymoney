import React from 'react';
import { Download, X } from 'lucide-react';
import { usePwaInstall } from '../../context/PwaInstallContext';

export const PwaInstallBanner: React.FC = () => {
  const {
    isBannerVisible,
    dismissBanner,
    triggerInstallPrompt,
  } = usePwaInstall();

  // If already installed, dismissed by user, or scanner/modals are active, do not render
  if (!isBannerVisible) {
    return null;
  }

  return (
    <aside
      role="region"
      aria-label="Install App Banner"
      className="fixed z-40 transition-all duration-300 ease-out
        bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] left-3 right-3
        sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm
        bg-white/95 dark:bg-slate-900/95 backdrop-blur-md
        text-slate-900 dark:text-slate-100
        p-3 sm:p-3.5 rounded-2xl shadow-xl border border-slate-200/90 dark:border-slate-800
        animate-fade-in flex items-center justify-between gap-3"
    >
      {/* App Icon + Title & Subtitle */}
      <div className="flex items-center gap-3 min-w-0">
        <img
          src="/logo.jpg"
          alt="My Money Manager logo"
          className="w-10 h-10 rounded-xl object-cover border border-slate-200 dark:border-slate-800 shrink-0 shadow-xs"
        />
        <div className="min-w-0">
          <p className="font-bold text-xs sm:text-sm tracking-tight text-slate-900 dark:text-slate-100 leading-tight truncate">
            Install My Money Manager
          </p>
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug truncate">
            Quick access & a better experience
          </p>
        </div>
      </div>

      {/* Action Controls: [Install] and [✕] */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={triggerInstallPrompt}
          className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 font-bold text-xs rounded-xl text-white shadow-sm shadow-emerald-600/30 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          title="Install My Money Manager"
        >
          <Download className="w-3.5 h-3.5 stroke-[2]" />
          <span>Install</span>
        </button>
        <button
          type="button"
          onClick={dismissBanner}
          className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          aria-label="Close install prompt"
          title="Dismiss"
        >
          <X className="w-4 h-4 stroke-[2]" />
        </button>
      </div>
    </aside>
  );
};
