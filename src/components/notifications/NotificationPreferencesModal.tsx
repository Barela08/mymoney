import React, { useState, useEffect } from 'react';
import {
  X,
  Bell,
  Smartphone,
  Mail,
  Shield,
  Moon,
  EyeOff,
  Check,
  Send,
  Loader2,
  Info,
} from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import { useToast } from '../../context/ToastContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationPreferencesModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const {
    preferences,
    updatePreferences,
    isPushSupported,
    isPushSubscribed,
    pushPermission,
    enablePush,
    disablePush,
    sendTestPush,
  } = useNotifications();
  const toast = useToast();

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Form state initialized from preferences
  const [inApp, setInApp] = useState(preferences?.in_app_enabled ?? true);
  const [push, setPush] = useState(preferences?.push_enabled ?? true);
  const [email, setEmail] = useState(preferences?.email_enabled ?? true);

  const [income, setIncome] = useState(preferences?.notify_income ?? true);
  const [expense, setExpense] = useState(preferences?.notify_expense ?? true);
  const [udhar, setUdhar] = useState(preferences?.notify_udhar ?? true);
  const [support, setSupport] = useState(preferences?.notify_support ?? true);
  const [announcements, setAnnouncements] = useState(preferences?.notify_announcements ?? true);
  const [offers, setOffers] = useState(preferences?.notify_offers ?? true);

  const [quietHours, setQuietHours] = useState(preferences?.quiet_hours_enabled ?? false);
  const [quietStart, setQuietStart] = useState(preferences?.quiet_hours_start ?? '22:00');
  const [quietEnd, setQuietEnd] = useState(preferences?.quiet_hours_end ?? '07:00');
  const [privacyAmounts, setPrivacyAmounts] = useState(preferences?.privacy_hide_amounts ?? false);

  // Nielsen Heuristic: User Control & Freedom — Escape key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSaving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updatePreferences({
        in_app_enabled: inApp,
        push_enabled: push,
        email_enabled: email,
        notify_income: income,
        notify_expense: expense,
        notify_udhar: udhar,
        notify_support: support,
        notify_announcements: announcements,
        notify_offers: offers,
        quiet_hours_enabled: quietHours,
        quiet_hours_start: quietStart,
        quiet_hours_end: quietEnd,
        privacy_hide_amounts: privacyAmounts,
      });
      toast.success('Preferences Saved', 'Your notification preferences have been updated.');
      onClose();
    } catch {
      toast.error('Save Failed', 'Could not save notification preferences.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTogglePush = async () => {
    if (isPushSubscribed) {
      const ok = await disablePush();
      if (ok) {
        setPush(false);
        toast.info('Push Disabled', 'Push notifications disabled for this device.');
      }
    } else {
      const res = await enablePush();
      if (res.success) {
        setPush(true);
        toast.success('Push Enabled', 'Browser push notifications successfully activated!');
      } else {
        toast.error('Permission Required', res.error || 'Could not enable push.');
      }
    }
  };

  const handleSendTest = async () => {
    setIsTesting(true);
    try {
      const ok = await sendTestPush();
      if (ok) {
        toast.success('Test Dispatched', 'Check your device and notification bell!');
      } else {
        toast.error('Test Failed', 'Could not dispatch test notification.');
      }
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Notification Preferences
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Customize where and how you receive alerts
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-6 text-xs flex-1">
          {/* Section 1: Channels */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              Delivery Channels
            </h4>
            <div className="space-y-3">
              {/* In-App */}
              <div className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <Bell className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                      In-App Notifications
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Show in notification bell & activity ledger
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inApp}
                    onChange={(e) => setInApp(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {/* Push Notifications */}
              <div className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                        Mobile & Web Push
                      </p>
                      {isPushSubscribed && (
                        <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[9px] font-bold">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Instant device notifications even when app is closed
                    </p>
                  </div>
                </div>
                {isPushSupported ? (
                  <button
                    type="button"
                    onClick={handleTogglePush}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isPushSubscribed
                        ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                    }`}
                  >
                    {isPushSubscribed ? 'Disable' : 'Enable Push'}
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-400">Unsupported</span>
                )}
              </div>

              {/* Email Alerts */}
              <div className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                      Email Notifications
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Major announcements, settlements & tickets
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={email}
                    onChange={(e) => setEmail(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Section 2: Categories */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              Event Categories
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[
                { label: 'Income Added', state: income, set: setIncome },
                { label: 'Expense Recorded', state: expense, set: setExpense },
                { label: 'Udhar & Khata Updates', state: udhar, set: setUdhar },
                { label: 'Support & Tickets', state: support, set: setSupport },
                { label: 'System Announcements', state: announcements, set: setAnnouncements },
                { label: 'Exclusive Offers', state: offers, set: setOffers },
              ].map((item, idx) => (
                <label
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                    {item.label}
                  </span>
                  <input
                    type="checkbox"
                    checked={item.state}
                    onChange={(e) => item.set(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Section 3: Quiet Hours & Privacy */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              Quiet Hours & Privacy
            </h4>
            <div className="space-y-3">
              {/* Quiet Hours Toggle */}
              <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Moon className="w-4 h-4 text-indigo-500" />
                    <div>
                      <p className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                        Do Not Disturb (Quiet Hours)
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Mute sound & push during sleeping hours
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={quietHours}
                      onChange={(e) => setQuietHours(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                {quietHours && (
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200/60 dark:border-slate-800">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Quiet Starts (IST)
                      </label>
                      <input
                        type="time"
                        value={quietStart}
                        onChange={(e) => setQuietStart(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Quiet Ends (IST)
                      </label>
                      <input
                        type="time"
                        value={quietEnd}
                        onChange={(e) => setQuietEnd(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Privacy Mode */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                <div className="flex items-center gap-2.5">
                  <EyeOff className="w-4 h-4 text-emerald-600" />
                  <div>
                    <p className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                      Lock Screen Financial Privacy
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Hide rupee amounts from lock-screen push previews
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={privacyAmounts}
                    onChange={(e) => setPrivacyAmounts(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Test Push Button */}
          <div className="pt-2 flex items-center justify-between p-3 rounded-2xl bg-emerald-500/10 dark:bg-emerald-950/40 border border-emerald-500/20">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
              <Info className="w-4 h-4 shrink-0" />
              <span className="text-[11px] font-medium">Verify your alert settings right now</span>
            </div>
            <button
              type="button"
              onClick={handleSendTest}
              disabled={isTesting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>Send Test</span>
            </button>
          </div>

          {/* Footer Save */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              <span>Save Preferences</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
