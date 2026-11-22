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
    <div className="fixed bottom-20 lg:bottom-4 inset-x-3 sm:inset-x-auto sm:right-4 z-30 max-w-md bg-gradient-to-r from-emerald-600 to-teal-700 text-white p-3 sm:p-4 rounded-2xl sm:rounded-3xl shadow-2xl border border-emerald-400/30 backdrop-blur-md animate-fade-in flex items-center justify-between gap-2.5">
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        <img
          src="/logo.jpg"
          alt="My Money"
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-cover border-2 border-white/40 shadow-sm shrink-0"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-xs tracking-tight truncate">
              Install My Money App
            </span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-white/20 text-emerald-100 shrink-0">
              Free App
            </span>
          </div>
          <p className="text-[10.5px] sm:text-[11px] text-emerald-100/90 truncate">
            अपने फोन में ऐप डाउनलोड / इंस्टॉल करें
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={triggerInstallPrompt}
          className="py-1.5 px-3 bg-white text-emerald-800 hover:bg-emerald-50 active:scale-95 font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Install</span>
        </button>
        <button
          onClick={dismissBanner}
          className="hidden sm:inline-flex py-1.5 px-2.5 bg-white/15 hover:bg-white/25 active:scale-95 font-bold text-xs rounded-xl transition-all cursor-pointer whitespace-nowrap text-white"
        >
          <span>Cancel</span>
        </button>
        <button
          onClick={dismissBanner}
          className="p-1.5 text-white/70 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          aria-label="Close"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
