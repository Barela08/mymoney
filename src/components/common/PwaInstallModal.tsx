import React from 'react';
import {
  Download,
  X,
  Smartphone,
  Share,
  PlusSquare,
  CheckCircle2,
  Sparkles,
  Zap,
  WifiOff,
  Bell,
  Laptop,
} from 'lucide-react';
import { usePwaInstall } from '../../context/PwaInstallContext';

export const PwaInstallModal: React.FC = () => {
  const {
    isModalOpen,
    closeInstallModal,
    triggerInstallPrompt,
    isIOS,
    isInstallable,
    isInstalled,
  } = usePwaInstall();

  if (!isModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden p-6 sm:p-7 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/logo.jpg"
              alt="My Money App Logo"
              className="w-13 h-13 rounded-2xl object-cover shadow-md border-2 border-emerald-500/40"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  Official Web App
                </span>
                <span className="text-[11px] text-slate-400">PWA 2.0</span>
              </div>
              <h3 className="text-lg font-black text-slate-900 dark:text-slate-100 mt-0.5">
                Install My Money App
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                सीधे अपने मोबाइल या लैपटॉप में ऐप डाउनलोड करें
              </p>
            </div>
          </div>

          <button
            onClick={closeInstallModal}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Key Features Pill Highlights */}
        <div className="grid grid-cols-3 gap-2 py-1">
          <div className="p-2.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 text-center space-y-1">
            <Zap className="w-4 h-4 mx-auto text-emerald-600 dark:text-emerald-400" />
            <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">1-Tap Open</p>
            <p className="text-[9.5px] text-slate-400">Home screen icon</p>
          </div>
          <div className="p-2.5 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 text-center space-y-1">
            <WifiOff className="w-4 h-4 mx-auto text-blue-600 dark:text-blue-400" />
            <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">Offline Mode</p>
            <p className="text-[9.5px] text-slate-400">Works without net</p>
          </div>
          <div className="p-2.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/40 text-center space-y-1">
            <Sparkles className="w-4 h-4 mx-auto text-amber-600 dark:text-amber-400" />
            <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">Zero Storage</p>
            <p className="text-[9.5px] text-slate-400">Lightweight & fast</p>
          </div>
        </div>

        {/* Step-by-Step Instructions based on OS */}
        {isInstalled ? (
          <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            <div>
              <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                App Already Installed!
              </p>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                You are currently using or have installed My Money on your home screen.
              </p>
            </div>
          </div>
        ) : isIOS ? (
          /* iOS Safari Guide */
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
              <Smartphone className="w-4 h-4 text-emerald-500" />
              <span>iPhone / iPad (Safari) में इंस्टॉल करने का तरीका:</span>
            </div>
            <ol className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <li className="flex items-center gap-2.5">
                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0">
                  1
                </span>
                <span>
                  सफारी ब्राउज़र में नीचे दिए गए <strong>Share बटन (</strong>
                  <Share className="w-3.5 h-3.5 inline mx-0.5 text-blue-500" />
                  <strong>)</strong> पर टैप करें।
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0">
                  2
                </span>
                <span>
                  नीचे स्क्रॉल करें और <strong>'Add to Home Screen (होम स्क्रीन पर जोड़ें)'</strong> पर क्लिक करें।
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0">
                  3
                </span>
                <span>
                  ऊपर दाएँ कोने में <strong>'Add'</strong> दबाएं। ऐप तुरंत आपके फोन में आ जाएगा!
                </span>
              </li>
            </ol>
          </div>
        ) : (
          /* Android & Desktop Guide */
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-200">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-500" />
                <span>Android & Computer Installation:</span>
              </div>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              नीचे दिए गए <strong>"Install App Now"</strong> बटन पर क्लिक करें, या अपने ब्राउज़र के तीन डॉट्स (⋮) मेन्यू में जाकर <strong>"Install app"</strong> या <strong>"Add to Home screen"</strong> चुनें।
            </p>
          </div>
        )}

        {/* Action Button */}
        {!isInstalled && (
          <div className="pt-2 flex flex-col sm:flex-row items-center gap-2.5">
            {!isIOS && (
              <button
                onClick={triggerInstallPrompt}
                className="w-full py-3 px-5 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-2xl text-xs sm:text-sm font-bold shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Download className="w-4 h-4 stroke-[2.5]" />
                <span>Install App Now (अभी ऐप इंस्टॉल करें)</span>
              </button>
            )}
            <button
              onClick={closeInstallModal}
              className={`w-full py-2.5 px-4 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-colors cursor-pointer ${
                isIOS ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100' : ''
              }`}
            >
              {isIOS ? 'समझ गया (Got It)' : 'Maybe Later (बाद में)'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
