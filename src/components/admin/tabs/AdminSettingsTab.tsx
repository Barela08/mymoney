import React, { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  Save,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Wrench,
  Globe,
  Sliders,
  Bell,
  Moon,
  Smartphone,
  Check,
} from 'lucide-react';
import { useExpense } from '../../../context/ExpenseContext';
import { useToast } from '../../../context/ToastContext';
import { adminClient } from '../../../lib/adminApi';
import { MaintenanceSettings, AppBrandingSettings } from '../../../types';
import { MaintenanceScreen } from '../../maintenance/MaintenanceScreen';
import { SUPPORT_CONTACT } from '../../../config/contact';

export const AdminSettingsTab: React.FC = () => {
  const toast = useToast();
  const {
    maintenanceSettings,
    updateMaintenanceSettings,
    appBranding,
    updateAppBranding,
  } = useExpense();

  // Maintenance form
  const [maintForm, setMaintForm] = useState<MaintenanceSettings>(maintenanceSettings);
  const [showMaintPreview, setShowMaintPreview] = useState(false);
  const [isSavingMaint, setIsSavingMaint] = useState(false);

  // General App Settings form
  const [appName, setAppName] = useState('My Money Manager');
  const [supportEmail, setSupportEmail] = useState<string>(SUPPORT_CONTACT.email);
  const [supportPhone, setSupportPhone] = useState<string>(SUPPORT_CONTACT.displayPhone);
  const [defaultCurrency, setDefaultCurrency] = useState('INR (₹)');
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [requireEmailVerification, setRequireEmailVerification] = useState(true);

  // Branding Form
  const [brandTitle, setBrandTitle] = useState(appBranding?.brandTitle || 'My Money Manager');
  const [companyName, setCompanyName] = useState(appBranding?.companyName || SUPPORT_CONTACT.companyName);
  const [footerText, setFooterText] = useState(appBranding?.footerText || '© 2026 My Money Manager by HackifyPro. All rights reserved.');
  const [isSavingBrand, setIsSavingBrand] = useState(false);

  // Admin Notification Preferences Form (PART 5)
  const [alertNewUser, setAlertNewUser] = useState(true);
  const [alertAppInstall, setAlertAppInstall] = useState(true);
  const [alertSupportTicket, setAlertSupportTicket] = useState(true);
  const [alertCriticalSecurity, setAlertCriticalSecurity] = useState(true);
  const [alertPushFailure, setAlertPushFailure] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState('22:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('07:00');
  const [deliveryChannel, setDeliveryChannel] = useState<'push_and_inapp' | 'push_only' | 'email_only' | 'inapp_only'>('push_and_inapp');
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [isSendingTestPush, setIsSendingTestPush] = useState(false);

  useEffect(() => {
    adminClient
      .getAdminNotificationPreferences()
      .then((res: any) => {
        if (res.success && res.preferences) {
          const p = res.preferences;
          if (p.alert_new_user_registration !== undefined) setAlertNewUser(p.alert_new_user_registration);
          if (p.alert_app_installation !== undefined) setAlertAppInstall(p.alert_app_installation);
          if (p.alert_support_ticket !== undefined) setAlertSupportTicket(p.alert_support_ticket);
          if (p.alert_critical_security !== undefined) setAlertCriticalSecurity(p.alert_critical_security);
          if (p.alert_push_failure !== undefined) setAlertPushFailure(p.alert_push_failure);
          if (p.quiet_hours_enabled !== undefined) setQuietHoursEnabled(p.quiet_hours_enabled);
          if (p.quiet_hours_start) setQuietHoursStart(p.quiet_hours_start);
          if (p.quiet_hours_end) setQuietHoursEnd(p.quiet_hours_end);
          if (p.delivery_channel) setDeliveryChannel(p.delivery_channel);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveNotificationPreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPrefs(true);
    try {
      const res = await adminClient.saveAdminNotificationPreferences({
        alert_new_user_registration: alertNewUser,
        alert_app_installation: alertAppInstall,
        alert_support_ticket: alertSupportTicket,
        alert_critical_security: alertCriticalSecurity,
        alert_push_failure: alertPushFailure,
        quiet_hours_enabled: quietHoursEnabled,
        quiet_hours_start: quietHoursStart,
        quiet_hours_end: quietHoursEnd,
        delivery_channel: deliveryChannel,
      });
      if (res.success) {
        toast.success('Admin Preferences Saved', 'Notification routing and alert rules updated.');
      }
    } catch (err: any) {
      toast.error('Save Failed', err.message);
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const handleTestAdminAlert = async () => {
    setIsSendingTestPush(true);
    try {
      const res = await adminClient.sendTestNotification({
        title: 'Admin Verification Alert',
        message: 'This confirms your administrative push notification channel is active and functional.',
        deep_link: 'admin',
      });
      if (res.success) {
        toast.success('Test Push Dispatched', res.message);
      } else {
        toast.warning('Push Warning', res.message);
      }
    } catch (err: any) {
      toast.error('Test Push Error', err.message);
    } finally {
      setIsSendingTestPush(false);
    }
  };

  useEffect(() => {
    setMaintForm(maintenanceSettings);
  }, [maintenanceSettings]);

  const handleSaveMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingMaint(true);
    try {
      await updateMaintenanceSettings(maintForm);
      toast.success(
        maintForm.isEnabled ? 'Maintenance Mode ON' : 'Maintenance Mode OFF',
        maintForm.isEnabled
          ? 'Normal users are now blocked by maintenance splash.'
          : 'Normal user access is restored.'
      );
    } catch (err: any) {
      toast.error('Save Error', err.message);
    } finally {
      setIsSavingMaint(false);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingBrand(true);
    try {
      await updateAppBranding({
        brandTitle,
        companyName,
        footerText,
        showBrandingBadge: true,
      });
      toast.success('Branding Updated', 'Application brand details saved.');
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setIsSavingBrand(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Maintenance Mode Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Maintenance Mode Configuration
              </h3>
              <p className="text-xs text-slate-400">
                When active, non-admin visitors are intercepted with a customized status splash
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowMaintPreview(true)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
          >
            Preview Splash
          </button>
        </div>

        <form onSubmit={handleSaveMaintenance} className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl">
            <input
              type="checkbox"
              id="maintEnabled"
              checked={maintForm.isEnabled}
              onChange={(e) => setMaintForm({ ...maintForm, isEnabled: e.target.checked })}
              className="rounded text-amber-600 w-4 h-4"
            />
            <label htmlFor="maintEnabled" className="text-xs font-bold cursor-pointer">
              Enable Maintenance Lockout (Admins retain bypass access)
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Splash Title</label>
              <input
                type="text"
                value={maintForm.title}
                onChange={(e) => setMaintForm({ ...maintForm, title: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Expected Restoration Window</label>
              <input
                type="text"
                value={maintForm.expectedRestoration}
                onChange={(e) => setMaintForm({ ...maintForm, expectedRestoration: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">User Notice Message</label>
            <textarea
              rows={2}
              value={maintForm.message}
              onChange={(e) => setMaintForm({ ...maintForm, message: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 leading-relaxed"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSavingMaint}
            className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-md shadow-amber-600/20 cursor-pointer disabled:opacity-50"
          >
            {isSavingMaint ? 'Saving...' : 'Save & Enforce Maintenance Mode'}
          </button>
        </form>
      </div>

      {/* General App & Security Settings */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <Globe className="w-4 h-4 text-emerald-600" />
          <span>General Application & Registration Settings</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">Application Name</label>
            <input
              type="text"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">Support Email Address</label>
            <input
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">Support Helpline Phone</label>
            <input
              type="text"
              value={supportPhone}
              onChange={(e) => setSupportPhone(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
            />
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={allowRegistration}
              onChange={(e) => setAllowRegistration(e.target.checked)}
              className="rounded text-emerald-600"
            />
            <span>Public Registration Open (Allow new signups)</span>
          </label>

          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={requireEmailVerification}
              onChange={(e) => setRequireEmailVerification(e.target.checked)}
              className="rounded text-emerald-600"
            />
            <span>Enforce Strict Email Verification for Accounts</span>
          </label>
        </div>
      </div>

      {/* Branding Configuration */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <Sliders className="w-4 h-4 text-emerald-600" />
          <span>Platform Branding & Footer Disclosures</span>
        </h3>

        <form onSubmit={handleSaveBranding} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Brand Title</label>
              <input
                type="text"
                value={brandTitle}
                onChange={(e) => setBrandTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Operating Organization</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">Statutory Footer Copyright</label>
            <input
              type="text"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            />
          </div>

          <button
            type="submit"
            disabled={isSavingBrand}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 cursor-pointer"
          >
            {isSavingBrand ? 'Saving...' : 'Save Branding Configuration'}
          </button>
        </form>
      </div>

      {/* Admin Notification Preferences & Two-Way Routing (PART 5) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Admin Notification Preferences & Two-Way Alert Routing
              </h3>
              <p className="text-xs text-slate-400">
                Configure real-time event triggers sent from users to the administration center
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestAdminAlert}
            disabled={isSendingTestPush}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 text-xs font-bold transition-colors cursor-pointer self-start sm:self-auto disabled:opacity-50"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>{isSendingTestPush ? 'Testing...' : 'Test Admin Push Alert'}</span>
          </button>
        </div>

        <form onSubmit={handleSaveNotificationPreferences} className="space-y-4 text-xs">
          {/* User-to-Admin Event Toggles */}
          <div>
            <p className="font-bold text-slate-700 dark:text-slate-300 mb-2">
              Event Trigger Subscriptions (User-to-Admin)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 cursor-pointer">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200">New User Registrations</p>
                  <p className="text-[11px] text-slate-400">Alert admin when new accounts are registered</p>
                </div>
                <input
                  type="checkbox"
                  checked={alertNewUser}
                  onChange={(e) => setAlertNewUser(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 cursor-pointer">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200">PWA App Installations</p>
                  <p className="text-[11px] text-slate-400">Alert admin upon confirmed device installations</p>
                </div>
                <input
                  type="checkbox"
                  checked={alertAppInstall}
                  onChange={(e) => setAlertAppInstall(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 cursor-pointer">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200">Support & Feedback Tickets</p>
                  <p className="text-[11px] text-slate-400">Notify admin when users submit support inquiries</p>
                </div>
                <input
                  type="checkbox"
                  checked={alertSupportTicket}
                  onChange={(e) => setAlertSupportTicket(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 cursor-pointer">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200">Critical Security & Error Alerts</p>
                  <p className="text-[11px] text-slate-400">Immediate notice on repeated failed logins or incidents</p>
                </div>
                <input
                  type="checkbox"
                  checked={alertCriticalSecurity}
                  onChange={(e) => setAlertCriticalSecurity(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 cursor-pointer sm:col-span-2">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200">Push Delivery Failure Threshold Alerts</p>
                  <p className="text-[11px] text-slate-400">Alert admin when Web Push delivery failure rates spike</p>
                </div>
                <input
                  type="checkbox"
                  checked={alertPushFailure}
                  onChange={(e) => setAlertPushFailure(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
              </label>
            </div>
          </div>

          {/* Delivery Channel Preference */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              Admin Delivery Channel
            </label>
            <select
              value={deliveryChannel}
              onChange={(e: any) => setDeliveryChannel(e.target.value)}
              className="w-full sm:w-80 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium"
            >
              <option value="push_and_inapp">Web Push + Admin Notification Center</option>
              <option value="push_only">Web Push Only</option>
              <option value="email_only">Email Alerts Only</option>
              <option value="inapp_only">Admin Notification Center Only</option>
            </select>
          </div>

          {/* Quiet Hours Configuration */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Moon className="w-4 h-4 text-indigo-500" />
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100">Quiet Hours</p>
                  <p className="text-[11px] text-slate-400">Suppress non-critical audible push alerts during rest hours</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={quietHoursEnabled}
                onChange={(e) => setQuietHoursEnabled(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded"
              />
            </div>

            {quietHoursEnabled && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={quietHoursStart}
                    onChange={(e) => setQuietHoursStart(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">End Time</label>
                  <input
                    type="time"
                    value={quietHoursEnd}
                    onChange={(e) => setQuietHoursEnd(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isSavingPrefs}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
          >
            {isSavingPrefs ? 'Saving Preferences...' : 'Save Notification Preferences'}
          </button>
        </form>
      </div>

      {/* Maintenance Preview Modal */}
      {showMaintPreview && (
        <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
          <div className="p-3 bg-amber-500 text-slate-950 text-xs font-bold flex items-center justify-between">
            <span>PREVIEW MODE: This is what normal users will see when Maintenance Mode is ON.</span>
            <button
              onClick={() => setShowMaintPreview(false)}
              className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs cursor-pointer"
            >
              Close Preview
            </button>
          </div>
          <div className="flex-1">
            <MaintenanceScreen settings={maintForm} onRefresh={() => {}} />
          </div>
        </div>
      )}
    </div>
  );
};
