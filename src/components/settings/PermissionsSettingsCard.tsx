import React, { useState, useEffect, useCallback } from 'react';
import {
  Mic,
  Camera,
  Bell,
  Download,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  ExternalLink,
  Shield,
} from 'lucide-react';
import { usePwaInstall } from '../../context/PwaInstallContext';
import { useToast } from '../../context/ToastContext';

type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export const PermissionsSettingsCard: React.FC = () => {
  const toast = useToast();
  const { isInstalled, isInstallable, canOfferInstall, triggerInstallPrompt, openInstallModal } =
    usePwaInstall();

  const [micStatus, setMicStatus] = useState<PermissionState>('prompt');
  const [cameraStatus, setCameraStatus] = useState<PermissionState>('prompt');
  const [notifStatus, setNotifStatus] = useState<PermissionState>('prompt');
  const [isChecking, setIsChecking] = useState<boolean>(true);

  const checkPermissions = useCallback(async () => {
    setIsChecking(true);

    // 1. Notifications
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const state = Notification.permission;
      setNotifStatus(state === 'default' ? 'prompt' : state);
    } else {
      setNotifStatus('unsupported');
    }

    // 2. Microphone & Camera via Permissions API where available
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      try {
        const micPermission = await navigator.permissions.query({ name: 'microphone' as any });
        setMicStatus(micPermission.state as PermissionState);
        micPermission.onchange = () => setMicStatus(micPermission.state as PermissionState);
      } catch {
        // Fallback: mediaDevices available but permissions.query not implemented
        setMicStatus(typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'prompt' : 'unsupported');
      }

      try {
        const camPermission = await navigator.permissions.query({ name: 'camera' as any });
        setCameraStatus(camPermission.state as PermissionState);
        camPermission.onchange = () => setCameraStatus(camPermission.state as PermissionState);
      } catch {
        setCameraStatus(typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'prompt' : 'unsupported');
      }
    } else {
      const hasMedia = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
      setMicStatus(hasMedia ? 'prompt' : 'unsupported');
      setCameraStatus(hasMedia ? 'prompt' : 'unsupported');
    }

    setIsChecking(false);
  }, []);

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  const requestMicPermission = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Unsupported', 'Microphone is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicStatus('granted');
      toast.success('Microphone Allowed', 'Voice input is ready to use.');
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicStatus('denied');
        toast.error('Microphone Denied', 'Please enable microphone access in your browser settings.');
      } else {
        toast.error('Microphone Error', err.message || 'Could not access microphone.');
      }
    }
  };

  const requestCameraPermission = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Unsupported', 'Camera is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      setCameraStatus('granted');
      toast.success('Camera Allowed', 'QR Code scanner is ready to use.');
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraStatus('denied');
        toast.error('Camera Denied', 'Please enable camera access in your browser settings.');
      } else {
        toast.error('Camera Error', err.message || 'Could not access camera.');
      }
    }
  };

  const requestNotifPermission = async () => {
    if (!('Notification' in window)) {
      toast.error('Unsupported', 'Notifications are not supported in this browser.');
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setNotifStatus(perm === 'default' ? 'prompt' : perm);
      if (perm === 'granted') {
        toast.success('Notifications Enabled', 'You will receive budget and bill alerts.');
      } else if (perm === 'denied') {
        toast.error('Notifications Denied', 'Notifications were blocked in browser settings.');
      }
    } catch {
      toast.error('Notification Error', 'Could not request notification permission.');
    }
  };

  const getBadge = (status: PermissionState) => {
    switch (status) {
      case 'granted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300/40">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            Allowed
          </span>
        );
      case 'denied':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300/40">
            <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
            Blocked
          </span>
        );
      case 'prompt':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300/40">
            <HelpCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            Ask on Use
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Unsupported
          </span>
        );
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/20">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
              Device Permissions & Status
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Hardware access permissions required for voice input, QR scanning, and alerts.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={checkPermissions}
          disabled={isChecking}
          className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title="Refresh permission status"
        >
          <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
        {/* 1. Microphone */}
        <div className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Microphone
                </span>
                {getBadge(micStatus)}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Used for voice transaction drafting, search dictation, and AI Money Assistant.
              </p>
            </div>
          </div>

          <div className="sm:self-center shrink-0">
            {micStatus === 'prompt' && (
              <button
                type="button"
                onClick={requestMicPermission}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
              >
                Allow Mic
              </button>
            )}
            {micStatus === 'denied' && (
              <span className="text-[11px] text-rose-600 dark:text-rose-400">
                Unlock via browser 🔒 icon
              </span>
            )}
          </div>
        </div>

        {/* 2. Camera */}
        <div className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Camera
                </span>
                {getBadge(cameraStatus)}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Used for live QR code scanning, Udhar contact pairing, and receipt OCR.
              </p>
            </div>
          </div>

          <div className="sm:self-center shrink-0">
            {cameraStatus === 'prompt' && (
              <button
                type="button"
                onClick={requestCameraPermission}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
              >
                Allow Camera
              </button>
            )}
            {cameraStatus === 'denied' && (
              <span className="text-[11px] text-rose-600 dark:text-rose-400">
                Unlock via browser 🔒 icon
              </span>
            )}
          </div>
        </div>

        {/* 3. Notifications */}
        <div className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Push Notifications
                </span>
                {getBadge(notifStatus)}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Used for recurring bill reminders, budget limits, and high-spending alerts.
              </p>
            </div>
          </div>

          <div className="sm:self-center shrink-0">
            {notifStatus === 'prompt' && (
              <button
                type="button"
                onClick={requestNotifPermission}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
              >
                Allow Alerts
              </button>
            )}
          </div>
        </div>

        {/* 4. PWA Installation Status */}
        <div className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">
                  PWA Installation Status
                </span>
                {isInstalled ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300/40">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    Installed (Standalone)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                    Web Browser Mode
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isInstalled
                  ? 'Running as an installed standalone desktop or mobile application.'
                  : 'Install My Money Manager on your device for fast offline launch and dedicated app window.'}
              </p>
            </div>
          </div>

          <div className="sm:self-center shrink-0">
            {!isInstalled && canOfferInstall && (
              <button
                type="button"
                onClick={isInstallable ? triggerInstallPrompt : openInstallModal}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
              >
                Install App
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
