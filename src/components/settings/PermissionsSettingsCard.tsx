import React, { useState } from 'react';
import {
  Mic,
  Camera,
  Bell,
  Download,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  Shield,
  ChevronDown,
  ChevronUp,
  Laptop,
  Smartphone,
} from 'lucide-react';
import { usePermissionManager } from '../../context/PermissionContext';
import { usePwaInstall } from '../../context/PwaInstallContext';

export const PermissionsSettingsCard: React.FC = () => {
  const {
    checkAllPermissions,
    requestMicrophone,
    requestCamera,
    requestNotification,
    permissionsList,
  } = usePermissionManager();

  const {
    isInstalled,
    isInstallable,
    canOfferInstall,
    triggerInstallPrompt,
    openInstallModal,
    compatibility,
  } = usePwaInstall();

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const getStatusBadge = (status: HardwarePermissionStatus | NotificationPermissionStatus) => {
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
      case 'unavailable':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300/40">
            <HelpCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            Hardware Missing
          </span>
        );
      case 'restricted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300/40">
            <AlertCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            In Use / Restricted
          </span>
        );
      case 'requesting':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300/40 animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />
            Requesting...
          </span>
        );
      case 'prompt':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300/40">
            <HelpCircle className="w-3 h-3 text-slate-500" />
            Ask on Feature Use
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            Unsupported
          </span>
        );
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/20">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
              Smart Permissions & Hardware Status
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Permissions are requested just-in-time when you tap a feature. Never accessed secretly.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={checkAllPermissions}
          disabled={isChecking}
          className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title="Refresh permission status"
        >
          <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
        {permissionsList.map((perm) => {
          const isExpanded = expandedId === perm.id;
          const isDenied = perm.status === 'denied';
          const isGranted = perm.status === 'granted';

          return (
            <div key={perm.id} className="py-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
                    {perm.id === 'microphone' && <Mic className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                    {perm.id === 'camera' && <Camera className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                    {perm.id === 'notifications' && <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                        {perm.name}
                      </span>
                      {getStatusBadge(perm.status)}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      {perm.purpose}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                        Used by:
                      </span>
                      {perm.featuresUsedBy.map((f, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-600 dark:text-slate-300"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 sm:self-center shrink-0">
                  {perm.status === 'prompt' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (perm.id === 'microphone') void requestMicrophone();
                        else if (perm.id === 'camera') void requestCamera();
                        else if (perm.id === 'notifications') void requestNotification();
                      }}
                      className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white transition-all shadow-xs cursor-pointer"
                    >
                      {perm.id === 'notifications' ? 'Enable Alerts' : 'Allow Access'}
                    </button>
                  )}

                  {isGranted && (
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Active
                    </span>
                  )}

                  {isDenied && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(perm.id)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <span>How to Unblock</span>
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              </div>

              {/* Expandable Step-by-Step Instructions if Denied */}
              {isExpanded && isDenied && (
                <div className="mt-2 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs space-y-3 animate-in fade-in duration-150">
                  <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Laptop className="w-4 h-4 text-emerald-600" />
                    <span>How to enable in Desktop Browser (Chrome, Edge, Brave):</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-300 text-[11px] pl-1">
                    {perm.instructions.desktop.map((step, sIdx) => (
                      <li key={sIdx}>{step}</li>
                    ))}
                  </ol>

                  <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <Smartphone className="w-4 h-4 text-emerald-600" />
                    <span>On Mobile Devices:</span>
                  </div>
                  <div className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300 pl-1">
                    <p><strong>Android Chrome:</strong> {perm.instructions.android.join(' ')}</p>
                    <p><strong>iOS Safari:</strong> {perm.instructions.ios.join(' ')}</p>
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={checkAllPermissions}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>I Have Enabled It (Check Again)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* 4. PWA Installation Status */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
              <Download className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                  PWA Installation Status
                </span>
                {isInstalled ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300/40">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    Installed (Standalone Mode)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                    Web Browser Mode
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                {isInstalled
                  ? 'Running as an installed standalone desktop or mobile application.'
                  : 'Install on your device for fast offline launch and dedicated app window.'}
              </p>
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Features:
                </span>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                  Instant Launch
                </span>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                  Dedicated Window
                </span>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                  {compatibility.deviceLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="sm:self-center shrink-0">
            {!isInstalled && canOfferInstall && (
              <button
                type="button"
                onClick={isInstallable ? triggerInstallPrompt : openInstallModal}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 active:scale-95 text-white transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Install App</span>
              </button>
            )}
            {isInstalled && (
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Installed
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
