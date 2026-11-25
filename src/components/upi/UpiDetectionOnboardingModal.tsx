import React, { useState, useEffect } from 'react';
import {
  BellRing,
  ShieldCheck,
  Smartphone,
  Settings,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Lock,
  RefreshCw,
  X,
} from 'lucide-react';
import { useUpiDetection } from '../../context/UpiDetectionContext';
import { getPlatformCapabilitySummary } from '../../lib/upiNativeBridge';

export const UpiDetectionOnboardingModal: React.FC = () => {
  const {
    isOnboardingOpen,
    closeOnboarding,
    platform,
    permissionStatus,
    refreshPermissionStatus,
    openNotificationSettings,
    toggleDetectionEnabled,
  } = useUpiDetection();

  const [step, setStep] = useState<'welcome' | 'permission' | 'verify'>('welcome');
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (isOnboardingOpen) {
      setStep('welcome');
      setSettingsFeedback(null);
      refreshPermissionStatus();
    }
  }, [isOnboardingOpen, refreshPermissionStatus]);

  if (!isOnboardingOpen) return null;

  const capability = getPlatformCapabilitySummary(platform);
  const isAndroidNative = platform === 'android_native_bridge';

  const handleOpenSettings = () => {
    const result = openNotificationSettings();
    if (result.opened) {
      setSettingsFeedback(
        'Android Notification Access Settings opened. Enable "My Money Manager", then return here and tap Verify Permission Status.'
      );
      setStep('verify');
    } else {
      setSettingsFeedback(
        result.reason || 'Android Notification Access Settings are unavailable in this browser session.'
      );
    }
  };

  const handleVerifyStatus = async () => {
    const status = refreshPermissionStatus();
    if (status === 'granted' || status === 'disabled') {
      await toggleDetectionEnabled(true);
      setSettingsFeedback('Notification Access verified and enabled.');
    } else {
      setSettingsFeedback(
        'Notification Access is not granted yet. You can enable it in Android Settings or continue with manual expense tracking.'
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upi-onboarding-title"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <BellRing className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="upi-onboarding-title"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                Automatic Expense Detection Setup
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                My Money Manager by HackifyPro
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => closeOnboarding(true)}
            aria-label="Skip setup"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="px-6 pt-4 flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          <span className={step === 'welcome' ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''}>
            1. Overview
          </span>
          <span>/</span>
          <span className={step === 'permission' ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''}>
            2. Notification Access
          </span>
          <span>/</span>
          <span className={step === 'verify' ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''}>
            3. Verification
          </span>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {step === 'welcome' && (
            <>
              <div className="space-y-1.5">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Categorize UPI payments in one tap
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  When you complete an outgoing payment on Google Pay, PhonePe, Paytm, or BHIM,
                  My Money Manager automatically extracts the amount, merchant, and reference ID
                  so you only pick a category and tap Save.
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 text-xs">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <p className="text-slate-700 dark:text-slate-300">
                    <strong className="text-slate-900 dark:text-slate-100">Payment notifications only:</strong>{' '}
                    Personal chats, OTPs, UPI PINs, failed transfers, and incoming credits are ignored.
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <p className="text-slate-700 dark:text-slate-300">
                    <strong className="text-slate-900 dark:text-slate-100">Full user control:</strong>{' '}
                    You can enable, pause, choose specific payment apps, or disable detection anytime in Settings.
                  </p>
                </div>
              </div>

              {!isAndroidNative && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                  <Smartphone className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">{capability.title}</p>
                    <p className="mt-0.5 text-amber-800 dark:text-amber-300/90">
                      {capability.description}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 'permission' && (
            <>
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Why Android Notification Access is needed
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  Android protects payment notifications from third-party apps. Granting Notification
                  Access allows My Money Manager to read outgoing UPI payment confirmations locally
                  on your device without asking for bank logins or SMS access.
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs text-slate-700 dark:text-slate-300">
                <p className="font-semibold text-slate-900 dark:text-slate-100">How to enable:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Tap <strong>Open Android Notification Settings</strong> below.</li>
                  <li>Locate <strong>My Money Manager</strong> in the list and toggle access on.</li>
                  <li>Return to this screen so we can verify actual permission status.</li>
                </ol>
              </div>

              {settingsFeedback && (
                <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
                  {settingsFeedback}
                </p>
              )}
            </>
          )}

          {step === 'verify' && (
            <>
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Verify Notification Access Status
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  We verify your real system permission state instead of assuming access was granted.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950/60">
                <div className="flex items-center gap-2.5">
                  {permissionStatus === 'granted' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : permissionStatus === 'not_supported' ? (
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                  )}
                  <div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Current Status:{' '}
                      <span className="capitalize">{permissionStatus.replace('_', ' ')}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {permissionStatus === 'granted'
                        ? 'Automatic UPI expense detection is active.'
                        : 'Manual expense tracking remains fully available.'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleVerifyStatus}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Verify</span>
                </button>
              </div>

              {settingsFeedback && (
                <p className="text-xs text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/70 rounded-lg px-3 py-2">
                  {settingsFeedback}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/60 dark:bg-slate-950/40">
          <button
            type="button"
            onClick={() => closeOnboarding(true)}
            className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
          >
            Continue with Manual Tracking
          </button>

          {step === 'welcome' && (
            <button
              type="button"
              onClick={() => setStep(isAndroidNative ? 'permission' : 'verify')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
            >
              <span>{isAndroidNative ? 'Continue Setup' : 'Check Platform Status'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {step === 'permission' && (
            <button
              type="button"
              onClick={handleOpenSettings}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Open Android Notification Settings</span>
            </button>
          )}

          {step === 'verify' && (
            <button
              type="button"
              onClick={() => closeOnboarding(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
            >
              <span>Done</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
