import React, { useState } from 'react';
import {
  Download,
  X,
  Share,
  PlusSquare,
  Monitor,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { useAdminPwaInstall } from '../../context/AdminPwaInstallContext';

export const AdminInstallPopup: React.FC = () => {
  const {
    isInstalled,
    canUseNativePrompt,
    platformInfo,
    isReminderVisible,
    isInstallModalOpen,
    triggerInstallPrompt,
    dismissReminder,
    closeInstallModal,
    openInstallModal,
  } = useAdminPwaInstall();

  const [isInstalling, setIsInstalling] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    setIsInstalling(true);
    try {
      await triggerInstallPrompt();
    } finally {
      setIsInstalling(false);
    }
  };

  const isIOS = platformInfo.platform === 'ios_safari';

  return (
    <>
      {/* 60-second Reminder Banner */}
      {isReminderVisible && !isInstallModalOpen && (
        <div
          role="dialog"
          aria-label="Install My Money Manager Admin"
          className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[390px] z-[60] rounded-2xl bg-slate-900 text-white border border-emerald-500/40 shadow-2xl shadow-slate-950/60 p-4 animate-in slide-in-from-bottom-4 duration-200"
        >
          <div className="flex items-start gap-3">
            <img
              src="/admin-logo.png"
              alt="My Money Manager Admin"
              className="w-11 h-11 rounded-xl object-cover shrink-0 ring-2 ring-emerald-500/40"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-extrabold tracking-tight text-white">
                  Install My Money Manager Admin
                </p>
                <button
                  type="button"
                  onClick={dismissReminder}
                  aria-label="Remind me later"
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                Install the standalone Admin Console on your device for instant Web Push alerts, dedicated app icon, and quick triage.
              </p>

              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleInstallClick}
                  disabled={isInstalling}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/25 transition-all cursor-pointer disabled:opacity-60"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isInstalling ? 'Preparing...' : canUseNativePrompt ? 'Install Admin App' : 'Install Instructions'}</span>
                </button>
                <button
                  type="button"
                  onClick={openInstallModal}
                  className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Guide
                </button>
                <button
                  type="button"
                  onClick={dismissReminder}
                  className="px-2.5 py-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Later
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Platform Install Instructions Modal */}
      {isInstallModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install Admin Application"
          className="fixed inset-0 z-[70] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="p-5 bg-slate-950 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <img
                  src="/admin-logo.png"
                  alt="My Money Manager Admin"
                  className="w-11 h-11 rounded-xl object-cover ring-2 ring-emerald-500/40"
                />
                <div>
                  <h3 className="text-sm font-extrabold">My Money Manager Admin</h3>
                  <p className="text-[11px] text-emerald-400 font-semibold">
                    Standalone Console Installation · HackifyPro
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeInstallModal}
                aria-label="Close install instructions"
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 p-3.5 flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Separate App Identity</p>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    Installs independently from the consumer My Money Manager app and launches directly into the Admin Console.
                  </p>
                </div>
              </div>

              {canUseNativePrompt && (
                <button
                  type="button"
                  onClick={handleInstallClick}
                  disabled={isInstalling}
                  className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{isInstalling ? 'Opening Installer...' : 'Install Now (Native Browser Prompt)'}</span>
                </button>
              )}

              {isIOS ? (
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                    <Smartphone className="w-4 h-4 text-emerald-600" />
                    <span>iPhone / iPad Safari Steps (Required for iOS Web Push)</span>
                  </div>
                  <ol className="space-y-2 text-xs text-slate-600 dark:text-slate-300 list-decimal list-inside">
                    <li className="flex items-start gap-2">
                      <span className="font-bold text-emerald-600">1.</span>
                      <span>
                        Tap the <strong className="inline-flex items-center gap-1"><Share className="w-3.5 h-3.5" /> Share</strong> icon in Safari&apos;s toolbar.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-bold text-emerald-600">2.</span>
                      <span>
                        Scroll down and choose <strong className="inline-flex items-center gap-1"><PlusSquare className="w-3.5 h-3.5" /> Add to Home Screen</strong>.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-bold text-emerald-600">3.</span>
                      <span>
                        Tap <strong>Add</strong>, then open <strong>MM Admin</strong> from your Home Screen to enable mobile push notifications.
                      </span>
                    </li>
                  </ol>
                </div>
              ) : (
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                    {platformInfo.osLabel === 'Android' ? (
                      <Smartphone className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Monitor className="w-4 h-4 text-emerald-600" />
                    )}
                    <span>
                      {platformInfo.browserLabel} on {platformInfo.osLabel} Installation
                    </span>
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>
                        Click the <strong>Install Admin App</strong> button above when available, or look for the install icon in your browser&apos;s address bar / menu (<strong>⋮ → Install My Money Manager Admin</strong>).
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>
                        Detected platform: <strong>{platformInfo.deviceLabel}</strong>.
                      </span>
                    </li>
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    closeInstallModal();
                    dismissReminder();
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
                >
                  Remind Me in 1 Minute
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
