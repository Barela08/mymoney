import React, { useState, useEffect } from 'react';
import {
  UserCog,
  Download,
  CheckCircle2,
  ShieldCheck,
  Bell,
  Info,
  Smartphone,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useExpense } from '../../context/ExpenseContext';
import { usePwaInstall } from '../../context/PwaInstallContext';
import { staffClient } from '../../lib/staffApi';
import { sanitizePublicUrl } from '../../lib/siteConfigDefaults';

export const StaffSettingsTab: React.FC = () => {
  const { user, portalPermissions } = useAuth();
  const { siteConfig, configSyncStatus } = useExpense();
  const {
    isInstalled,
    canOfferInstall,
    triggerInstallPrompt,
    openInstallModal,
    portalBranding,
    compatibility,
  } = usePwaInstall();

  const [staffProfile, setStaffProfile] = useState<any>(null);
  const [unreadAlerts, setUnreadAlerts] = useState<number>(0);

  const staffBrand = siteConfig.branding.staff_app;

  useEffect(() => {
    let active = true;
    staffClient
      .getProfile()
      .then((res) => {
        if (active && res?.success) setStaffProfile(res);
      })
      .catch(() => {});
    staffClient
      .getNotifications()
      .then((res) => {
        if (active && res?.success) setUnreadAlerts(res.unreadCount || 0);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Staff Profile Summary */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <img
            src={sanitizePublicUrl(staffBrand.logoUrl, '/staff-logo.png')}
            alt={staffBrand.appName}
            className="w-12 h-12 rounded-2xl object-cover border border-indigo-500/40 bg-indigo-950 shrink-0"
          />
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <UserCog className="w-4 h-4 text-indigo-500" />
              <span>{staffProfile?.staff?.display_name || user?.displayName || 'Staff Member'}</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {staffProfile?.staff?.email || user?.email} · Portal Role:{' '}
              <strong className="uppercase text-indigo-600 dark:text-indigo-400">
                {staffProfile?.portalRole || user?.role_slug || 'staff'}
              </strong>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
            <p className="text-[11px] font-bold uppercase text-slate-400">Portal Scope</p>
            <p className="font-mono font-bold mt-1 text-indigo-600 dark:text-indigo-400">/mystaff</p>
          </div>
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
            <p className="text-[11px] font-bold uppercase text-slate-400">Unread Staff Alerts</p>
            <p className="font-bold mt-1 flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-indigo-500" />
              <span>{unreadAlerts} isolated staff alerts</span>
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
            <p className="text-[11px] font-bold uppercase text-slate-400">Live Branding Sync</p>
            <p className="font-bold mt-1 capitalize text-emerald-600 dark:text-emerald-400">
              {configSyncStatus} (v{siteConfig.version})
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-indigo-500" />
            <span>Granted RBAC Permissions ({portalPermissions.length})</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {portalPermissions.map((perm) => (
              <span
                key={perm}
                className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-[11px] font-mono text-indigo-700 dark:text-indigo-300"
              >
                {perm}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Isolated Staff App PWA Installation Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-black text-slate-900 dark:text-white">
                {staffBrand.appName} Standalone App ({compatibility.deviceLabel})
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Installs independently with its own manifest (`{portalBranding.manifestUrl}`), `/mystaff` launch URL, and isolated service worker scope.
              </p>
            </div>
          </div>

          {isInstalled ? (
            <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
              <span>Installed Standalone</span>
            </span>
          ) : canOfferInstall ? (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => triggerInstallPrompt()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Install Staff App</span>
              </button>
              <button
                type="button"
                onClick={openInstallModal}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
              >
                Manual Guide
              </button>
            </div>
          ) : (
            <span className="text-xs font-semibold text-amber-600">
              Install disabled by Admin
            </span>
          )}
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex items-start gap-2.5 text-[11px] text-slate-600 dark:text-slate-300">
          <Info className="w-4 h-4 shrink-0 text-indigo-500 mt-0.5" />
          <span>
            OS launcher note: Android, iOS, and desktop operating systems cache already-installed home-screen icons. If an Admin updates the Staff App icon or name after you installed it, browser tabs and manifests refresh live, while launcher shortcuts may require reinstalling the shortcut.
          </span>
        </div>
      </div>
    </div>
  );
};

export default StaffSettingsTab;
