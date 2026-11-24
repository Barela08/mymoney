import React, { useState, useEffect } from 'react';
import { Bell, Camera, Check, ShieldCheck, ArrowRight, X } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

const PERMISSIONS_STORAGE_KEY = 'my_money_startup_perms_handled_v1';

interface StartupPermissionsModalProps {
  isOpen?: boolean;
  onComplete?: () => void;
}

export const StartupPermissionsModal: React.FC<StartupPermissionsModalProps> = ({
  isOpen: forcedIsOpen,
  onComplete,
}) => {
  const toast = useToast();
  const [isVisible, setIsVisible] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [notifStatus, setNotifStatus] = useState<'default' | 'granted' | 'denied'>('default');
  const [cameraStatus, setCameraStatus] = useState<'default' | 'granted' | 'denied'>('default');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifStatus(Notification.permission);
    }

    // Never request notification permission automatically on first page load.
    // Only open when explicitly triggered via forcedIsOpen === true.
    setIsVisible(forcedIsOpen === true);
  }, [forcedIsOpen]);

  const handleGrantPermissions = async () => {
    setIsRequesting(true);

    // 1. Request Notification Permission
    let notifResult = notifStatus;
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        notifResult = permission;
        setNotifStatus(permission);
      } catch (err) {
        console.warn('Notification permission error:', err);
      }
    }

    // 2. Request Camera Permission for QR Scanning
    let camResult: 'default' | 'granted' | 'denied' = 'default';
    if (typeof window !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        // Immediately release tracks so camera light turns off
        stream.getTracks().forEach((track) => track.stop());
        camResult = 'granted';
        setCameraStatus('granted');
      } catch (err: any) {
        console.warn('Camera permission request error:', err);
        camResult = err.name === 'NotAllowedError' ? 'denied' : 'default';
        setCameraStatus(camResult);
      }
    }

    setIsRequesting(false);
    localStorage.setItem(PERMISSIONS_STORAGE_KEY, 'true');

    if (notifResult === 'granted' || camResult === 'granted') {
      toast.success(
        'Permissions Configured!',
        'Notification and Camera permissions have been set up successfully.'
      );
    }

    setIsVisible(false);
    if (onComplete) onComplete();
  };

  const handleSkip = () => {
    localStorage.setItem(PERMISSIONS_STORAGE_KEY, 'true');
    setIsVisible(false);
    if (onComplete) onComplete();
  };

  // Nielsen Heuristic: User Control & Freedom — Escape key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isVisible && !isRequesting) {
        handleSkip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, isRequesting]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-emerald-500/30 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-6 text-white text-left relative">
          <div className="flex items-center justify-between mb-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-white/20 border border-white/30 backdrop-blur-sm">
              App Permissions Setup
            </span>
            <button
              onClick={handleSkip}
              className="p-1 rounded-lg text-emerald-100 hover:text-white hover:bg-white/10 transition-colors"
              title="Close / Skip"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <h2 className="text-xl font-black tracking-tight leading-snug">
            अनुमतियाँ सक्रिय करें (Enable Permissions)
          </h2>
          <p className="text-xs text-emerald-100/90 mt-1">
            Stay updated with real-time alerts and enable instant QR code scanning.
          </p>
        </div>

        {/* Permission Cards */}
        <div className="p-6 space-y-4 text-left">
          {/* Card 1: Notifications */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
              <Bell className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Notification Alert (सूचनाएं)
                </h4>
                {notifStatus === 'granted' ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                    <Check className="w-3 h-3 stroke-[3]" /> Granted
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
                    Recommended
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                खर्च के अपडेट, लेन-देन रिमाइंडर और क्लाउड सिंक अलर्ट सीधे आपके डिवाइस पर प्राप्त करें।
              </p>
            </div>
          </div>

          {/* Card 2: Camera for QR Code */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-950 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0 mt-0.5">
              <Camera className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Camera for QR Scanner (कैमरा अनुमति)
                </h4>
                {cameraStatus === 'granted' ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                    <Check className="w-3 h-3 stroke-[3]" /> Granted
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                    For QR Scanner
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                साथी उपयोगकर्ताओं और रूममेट्स का QR कोड स्कैन करके आपस में हिसाब और उधार जोड़ने के लिए कैमरा अनुमति आवश्यक है।
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleSkip}
            className="w-full sm:w-auto text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 py-2 px-3 rounded-xl cursor-pointer order-2 sm:order-1"
          >
            बाद में करें (Skip for Now)
          </button>

          <button
            type="button"
            onClick={handleGrantPermissions}
            disabled={isRequesting}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-600/30 transition-all cursor-pointer disabled:opacity-50 order-1 sm:order-2"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>
              {isRequesting ? 'अनुमति ली जा रही है...' : 'अनुमतियाँ सक्रिय करें (Enable All)'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
