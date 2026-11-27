import React, { useState, useEffect } from 'react';
import {
  Sun,
  Moon,
  Trash2,
  Download,
  Sliders,
  Scale,
  BellRing,
  ShieldCheck,
  Globe,
  Bell,
  Lock,
  ExternalLink,
  Laptop,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Shield,
  Layers,
  Sparkles,
  Smartphone,
  EyeOff,
  Share,
  MoreVertical,
  RotateCcw,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { usePwaInstall } from '../../context/PwaInstallContext';
import { ConfirmModal } from '../common/ConfirmModal';
import { AccountDeletionSection } from '../profile/AccountDeletionSection';
import { LegalCenterSection } from '../legal/LegalCenterSection';
import { PermissionsSettingsCard } from './PermissionsSettingsCard';
import { PrivacyConsentCard } from './PrivacyConsentCard';
import { UpiAutoDetectionSettings } from '../upi/UpiAutoDetectionSettings';

export type SettingsTabId =
  | 'appearance'
  | 'install'
  | 'language'
  | 'notifications'
  | 'privacy'
  | 'security'
  | 'preferences'
  | 'deletion'
  | 'legal';

interface SettingsSectionProps {
  initialTab?: SettingsTabId | string;
  initialLegalPolicy?: string;
  onNavigateToProfile?: () => void;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  initialTab = 'appearance',
  initialLegalPolicy = 'privacy_policy',
  onNavigateToProfile,
}) => {
  const { transactions, clearAllTransactions } = useExpense();
  const { theme, setTheme } = useTheme();
  const { user, logoutAllDevices } = useAuth();
  const {
    preferences,
    updatePreferences,
    isPushSupported,
    isPushSubscribed,
    pushPermission,
    enablePush,
    sendTestPush,
  } = useNotifications();
  const {
    isInstalled,
    isInstallable,
    compatibility,
    triggerInstallPrompt,
    openInstallModal,
    reopenInstallPopup,
    autoPromptDisabled,
    setAutoPromptDisabled,
  } = usePwaInstall();
  const toast = useToast();

  const [isInstallingApp, setIsInstallingApp] = useState(false);

  const [activeTab, setActiveTab] = useState<SettingsTabId>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      if (hash === '#app-install' || hash === '#install') return 'install';
      if (hash === '#auto-detection') return 'privacy';
      if (hash === '#privacy' || hash === '#manage-consent') return 'privacy';
      if (hash === '#delete-account') return 'deletion';
      if (hash === '#notifications') return 'notifications';
      if (hash === '#appearance' || hash === '#theme') return 'appearance';
      if (hash === '#language') return 'language';
    }
    if (initialTab === 'profile') return 'security';
    return (initialTab as SettingsTabId) || 'appearance';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncHash = () => {
      const hash = window.location.hash;
      if (hash === '#app-install' || hash === '#install') {
        setActiveTab('install');
      } else if (hash === '#auto-detection' || hash === '#privacy' || hash === '#manage-consent') {
        setActiveTab('privacy');
      } else if (hash === '#delete-account') {
        setActiveTab('deletion');
      } else if (hash === '#notifications') {
        setActiveTab('notifications');
      } else if (hash === '#appearance' || hash === '#theme') {
        setActiveTab('appearance');
      } else if (hash === '#language') {
        setActiveTab('language');
      }
    };
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  useEffect(() => {
    if (!initialTab) return;
    if (initialTab === 'profile') {
      setActiveTab('security');
    } else {
      setActiveTab(initialTab as SettingsTabId);
    }
  }, [initialTab]);

  // Language state & preference
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => {
    try {
      return localStorage.getItem('mm_selected_language') || 'en';
    } catch {
      return 'en';
    }
  });

  const handleSelectLanguage = (langCode: string, langName: string) => {
    setSelectedLanguage(langCode);
    try {
      localStorage.setItem('mm_selected_language', langCode);
    } catch {}
    toast.success('Language Selected', `${langName} set as your interface language.`);
  };

  // Notification in-app alert preferences
  const [budgetAlertsEnabled, setBudgetAlertsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mm_pref_budget_alerts') !== 'false';
    } catch {
      return true;
    }
  });

  const [udharRemindersEnabled, setUdharRemindersEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mm_pref_udhar_reminders') !== 'false';
    } catch {
      return true;
    }
  });

  const [dailyRecapEnabled, setDailyRecapEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mm_pref_daily_recap') === 'true';
    } catch {
      return false;
    }
  });

  const [isSendingTestAlert, setIsSendingTestAlert] = useState(false);
  const [isEnablingPushAlerts, setIsEnablingPushAlerts] = useState(false);

  const toggleBudgetAlerts = () => {
    const next = !budgetAlertsEnabled;
    setBudgetAlertsEnabled(next);
    try {
      localStorage.setItem('mm_pref_budget_alerts', String(next));
    } catch {}
    toast.success('Preference Saved', next ? 'Budget threshold warnings enabled.' : 'Budget warnings muted.');
  };

  const toggleUdharReminders = () => {
    const next = !udharRemindersEnabled;
    setUdharRemindersEnabled(next);
    try {
      localStorage.setItem('mm_pref_udhar_reminders', String(next));
    } catch {}
    toast.success('Preference Saved', next ? 'Udhar reminders enabled.' : 'Udhar reminders muted.');
  };

  const toggleDailyRecap = () => {
    const next = !dailyRecapEnabled;
    setDailyRecapEnabled(next);
    try {
      localStorage.setItem('mm_pref_daily_recap', String(next));
    } catch {}
    toast.success('Preference Saved', next ? 'Daily financial recap enabled.' : 'Daily recap disabled.');
  };

  const handleEnablePush = async () => {
    setIsEnablingPushAlerts(true);
    try {
      const res = await enablePush();
      if (res.success || res.permission === 'granted') {
        toast.success('Push Alerts Enabled', 'Device notification bar alerts are active.');
      } else {
        toast.warning('Permission Required', res.error || 'Please allow notifications in browser permissions.');
      }
    } finally {
      setIsEnablingPushAlerts(false);
    }
  };

  const handleTestNotification = async () => {
    setIsSendingTestAlert(true);
    try {
      const ok = await sendTestPush();
      if (ok) {
        toast.success('Test Alert Sent', 'Check your device screen or notification drawer!');
      } else {
        toast.info('Test Alert Triggered', 'Alert sound and in-app banner were emitted.');
      }
    } catch (err: any) {
      toast.error('Test Failed', err.message || 'Could not dispatch test notification.');
    } finally {
      setIsSendingTestAlert(false);
    }
  };

  // Clear data confirmation modal
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);

  const handleExportBackup = () => {
    try {
      const dataStr =
        'data:text/json;charset=utf-8,' +
        encodeURIComponent(JSON.stringify(transactions, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute(
        'download',
        `my_money_backup_${new Date().toISOString().split('T')[0]}.json`
      );
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      toast.success('Backup Exported', 'Your financial records have been exported to JSON.');
    } catch (err: any) {
      toast.error('Export Failed', err.message);
    }
  };

  const handleClearAllConfirm = async () => {
    try {
      setIsClearing(true);
      await clearAllTransactions();
      toast.success('Ledger Reset', 'All transactions moved to Recycle Bin.');
      setIsConfirmClearOpen(false);
    } catch (err: any) {
      toast.error('Reset Failed', err.message);
    } finally {
      setIsClearing(false);
    }
  };

  const handleLogoutAllDevices = async () => {
    try {
      setIsLoggingOutAll(true);
      await logoutAllDevices();
      toast.success('Sessions Revoked', 'Logged out of all active devices.');
    } catch (err: any) {
      toast.error('Error', err.message || 'Could not revoke sessions.');
    } finally {
      setIsLoggingOutAll(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20 lg:pb-8 max-w-4xl mx-auto">
      {/* Settings Top Header Banner */}
      <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
            Application Settings
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Configure appearance, language, notification alerts, privacy compliance &amp; app preferences
          </p>
        </div>
        {onNavigateToProfile && (
          <button
            type="button"
            onClick={onNavigateToProfile}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            title="Open User Profile"
          >
            <span>Open Profile</span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </button>
        )}
      </div>

      {/* Settings Navigation Tabs */}
      <div className="flex flex-wrap bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl gap-1 w-full">
        <button
          type="button"
          onClick={() => setActiveTab('appearance')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'appearance'
              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Sun className="w-3.5 h-3.5" />
          <span>Appearance</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('install')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'install'
              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
          data-testid="settings-tab-app-install"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>App Installation</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('language')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'language'
              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Language</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('notifications')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'notifications'
              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Notifications</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('privacy')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'privacy'
              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Privacy &amp; Permissions</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'security'
              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Security</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('preferences')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'preferences'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Preferences &amp; Backup</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('deletion')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'deletion'
              ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400'
          }`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete Account</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('legal')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'legal'
              ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400'
          }`}
        >
          <Scale className="w-3.5 h-3.5" />
          <span>Legal Center</span>
        </button>
      </div>

      {/* Tab 1: Appearance & Theme */}
      {activeTab === 'appearance' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="p-2.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 rounded-xl">
                {theme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Display Appearance &amp; Color Theme
                </h3>
                <p className="text-xs text-slate-500">
                  Select your preferred visual style across all pages and charts
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col gap-2 ${
                  theme === 'light'
                    ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 ring-2 ring-emerald-500/30'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sun className="w-4 h-4 text-amber-500" />
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100">Light Mode</span>
                  </div>
                  {theme === 'light' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                </div>
                <p className="text-xs text-slate-500">
                  Clean white backdrop with high contrast typography for bright daylight environments.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col gap-2 ${
                  theme === 'dark'
                    ? 'border-emerald-500 bg-emerald-950/30 ring-2 ring-emerald-500/30'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Moon className="w-4 h-4 text-indigo-400" />
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100">Dark Mode</span>
                  </div>
                  {theme === 'dark' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                </div>
                <p className="text-xs text-slate-500">
                  Deep slate and emerald palette for reduced eye strain and extended battery life.
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 1B: Permanent App Installation Section */}
      {activeTab === 'install' && (
        <div className="space-y-6" data-testid="settings-app-install-section">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
            <div className="flex items-start justify-between flex-wrap gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3.5">
                <img
                  src="/icon-192.png"
                  alt="My Money Manager App Icon"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/logo.jpg'; }}
                  className="w-12 h-12 rounded-2xl object-cover border border-emerald-500/30 bg-black shrink-0"
                />
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                    App Installation (PWA)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Install My Money Manager for standalone full-screen speed, offline shell &amp; home screen access
                  </p>
                </div>
              </div>

              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                  isInstalled
                    ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {isInstalled ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Installed (Standalone App)</span>
                  </>
                ) : (
                  <>
                    <Laptop className="w-3.5 h-3.5 text-slate-500" />
                    <span>Not Installed · Browser Mode</span>
                  </>
                )}
              </span>
            </div>

            {/* Browser Compatibility & Status Card */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/70 space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Detected Environment
                </p>
                <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                  {compatibility.deviceLabel}
                </p>
                <p className="text-[11px] text-slate-500">
                  OS: {compatibility.osLabel} · Browser: {compatibility.browserLabel}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/70 space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Installation Method
                </p>
                <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                  {isInstalled
                    ? 'App Active on Device'
                    : isInstallable
                    ? '1-Click Native Browser Install Ready'
                    : compatibility.supportsManualInstall
                    ? 'Manual Home Screen / Dock Install Supported'
                    : 'Browser Menu Install'}
                </p>
                <p className="text-[11px] text-slate-500">
                  {isInstalled
                    ? 'Duplicate installation prompts are automatically disabled.'
                    : isInstallable
                    ? 'Click Install Now below to trigger your browser install dialog.'
                    : 'Follow the step-by-step instructions below or reopen the install prompt.'}
                </p>
              </div>
            </div>

            {/* Primary Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                disabled={isInstalled || isInstallingApp}
                onClick={async () => {
                  if (isInstalled || isInstallingApp) return;
                  setIsInstallingApp(true);
                  try {
                    const res = await triggerInstallPrompt();
                    if (res.status === 'accepted') {
                      toast.success('Installing App', 'My Money Manager is being added to your device.');
                    } else if (res.status === 'dismissed') {
                      toast.info('Install Cancelled', 'You can install anytime here in Settings.');
                    } else if (res.status === 'manual_guide' || res.status === 'unavailable') {
                      openInstallModal();
                    }
                  } finally {
                    setIsInstallingApp(false);
                  }
                }}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                  isInstalled
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm cursor-pointer disabled:opacity-60'
                }`}
              >
                <Download className="w-4 h-4" />
                <span>
                  {isInstalled
                    ? 'Already Installed'
                    : isInstallingApp
                    ? 'Opening Prompt...'
                    : 'Install Now'}
                </span>
              </button>

              {!isInstalled && (
                <button
                  type="button"
                  onClick={() => {
                    reopenInstallPopup();
                    toast.success(
                      'Install Popup Reopened',
                      'The bottom-right install prompt is now visible again.'
                    );
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reopen Install Popup</span>
                </button>
              )}
            </div>

            {/* Auto-Reminder Preference */}
            {!isInstalled && (
              <div className="flex items-center justify-between p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 gap-4">
                <div>
                  <p className="font-bold text-xs text-slate-900 dark:text-slate-100">
                    Automatic 1-Minute Install Reminders
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Re-show the Install My Money Manager prompt every 1 minute after Cancel until installed
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextDisabled = !autoPromptDisabled;
                    setAutoPromptDisabled(nextDisabled);
                    toast.success(
                      'Reminder Setting Updated',
                      nextDisabled
                        ? 'Automatic install popup reminders paused. You can install anytime from here.'
                        : 'Automatic 1-minute install reminders enabled.'
                    );
                  }}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                    !autoPromptDisabled
                      ? 'bg-emerald-600 justify-end'
                      : 'bg-slate-300 dark:bg-slate-700 justify-start'
                  }`}
                  aria-label="Toggle automatic install reminders"
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>
            )}

            {/* Manual Install Instructions (Android Chrome, iPhone Safari, Desktop) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-700/60 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <Smartphone className="w-4 h-4 text-emerald-600" />
                  <span>Android (Chrome)</span>
                </div>
                <ol className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1 list-decimal list-inside leading-relaxed">
                  <li>
                    Tap browser menu (<MoreVertical className="w-3 h-3 inline text-slate-500" />) at top-right.
                  </li>
                  <li>
                    Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                  </li>
                  <li>Confirm <strong>Install</strong> to add the app icon.</li>
                </ol>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-700/60 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <Smartphone className="w-4 h-4 text-blue-600" />
                  <span>iPhone / iPad (Safari)</span>
                </div>
                <ol className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1 list-decimal list-inside leading-relaxed">
                  <li>
                    Tap <strong>Share</strong> (<Share className="w-3 h-3 inline text-blue-500" />) in Safari toolbar.
                  </li>
                  <li>
                    Select <strong>Add to Home Screen</strong>.
                  </li>
                  <li>Tap <strong>Add</strong> and launch from Home Screen.</li>
                </ol>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-700/60 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <Laptop className="w-4 h-4 text-indigo-600" />
                  <span>Desktop (Chrome / Edge)</span>
                </div>
                <ol className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1 list-decimal list-inside leading-relaxed">
                  <li>Click the <strong>Install</strong> icon inside the right side of the address bar.</li>
                  <li>Or open browser menu &rarr; <strong>Save and share &rarr; Install page as app</strong>.</li>
                  <li>Launch directly from Desktop or Dock.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Language & Region */}
      {activeTab === 'language' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="p-2.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-xl">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Language &amp; Regional Formatting
                </h3>
                <p className="text-xs text-slate-500">
                  Select your primary language for app labels, hints and AI assistance
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-w-xl">
              {[
                { code: 'en', name: 'English', sub: 'Standard Indian Financial English' },
                { code: 'hi', name: 'हिन्दी (Hindi)', sub: 'सरल हिन्दी वित्तीय शब्दावली' },
                { code: 'gu', name: 'ગુજરાતી (Gujarati)', sub: 'ગુજરાતી નાણાકીય લેજર' },
                { code: 'mr', name: 'मराठी (Marathi)', sub: 'मराठी आर्थिक हिशोब' },
              ].map((lang) => {
                const isSelected = selectedLanguage === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => handleSelectLanguage(lang.code, lang.name)}
                    className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 ring-2 ring-emerald-500/25'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <div>
                      <p className="font-bold text-xs sm:text-sm">{lang.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{lang.sub}</p>
                    </div>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Notification Preferences */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-xl">
                <BellRing className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Notification &amp; Alert Preferences
                </h3>
                <p className="text-xs text-slate-500">
                  Manage real-time alerts, mobile push banners and financial sound notifications
                </p>
              </div>
            </div>

            {/* Device Push Notifications Status */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="font-bold text-xs text-slate-900 dark:text-slate-100">
                    Device Notification Bar Alerts (Web Push)
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Receive alert banners with sound directly on your phone or desktop lock screen
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isPushSubscribed ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Active
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleEnablePush}
                      disabled={isEnablingPushAlerts}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer transition-colors"
                    >
                      {isEnablingPushAlerts ? 'Enabling...' : 'Enable Mobile Push'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleTestNotification}
                    disabled={isSendingTestAlert}
                    className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-bold cursor-pointer transition-colors"
                  >
                    {isSendingTestAlert ? 'Testing...' : 'Test Alert'}
                  </button>
                </div>
              </div>
            </div>

            {/* In-app Notification Toggles */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <div>
                  <p className="font-bold text-xs text-slate-900 dark:text-slate-100">Budget Limit &amp; Threshold Warnings</p>
                  <p className="text-[11px] text-slate-500">Get notified when category spending crosses 80% or 100%</p>
                </div>
                <button
                  type="button"
                  onClick={toggleBudgetAlerts}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                    budgetAlertsEnabled ? 'bg-emerald-600 justify-end' : 'bg-slate-300 dark:bg-slate-700 justify-start'
                  }`}
                  aria-label="Toggle budget alerts"
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <div>
                  <p className="font-bold text-xs text-slate-900 dark:text-slate-100">Udhar Payment &amp; Due Date Reminders</p>
                  <p className="text-[11px] text-slate-500">Alerts when borrowed or lent money reaches expected settlement dates</p>
                </div>
                <button
                  type="button"
                  onClick={toggleUdharReminders}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                    udharRemindersEnabled ? 'bg-emerald-600 justify-end' : 'bg-slate-300 dark:bg-slate-700 justify-start'
                  }`}
                  aria-label="Toggle Udhar reminders"
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <div>
                  <p className="font-bold text-xs text-slate-900 dark:text-slate-100">Daily Spending Summary Recap</p>
                  <p className="text-[11px] text-slate-500">Evening recap of today&apos;s total expenses and remaining safe-to-spend balance</p>
                </div>
                <button
                  type="button"
                  onClick={toggleDailyRecap}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                    dailyRecapEnabled ? 'bg-emerald-600 justify-end' : 'bg-slate-300 dark:bg-slate-700 justify-start'
                  }`}
                  aria-label="Toggle daily recap"
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-2xl border border-emerald-200/70 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 transition-colors">
                <div className="flex items-start gap-2.5 pr-3">
                  <EyeOff className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-bold text-xs text-slate-900 dark:text-slate-100">
                      Lock-Screen Financial Privacy Mode
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Hide ₹ amounts and Udhar counterparty details on lock-screen &amp; OS push notification previews
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const current = preferences?.privacy_hide_amounts ?? true;
                    const next = !current;
                    try {
                      await updatePreferences({ privacy_hide_amounts: next });
                      toast.success(
                        'Privacy Updated',
                        next
                          ? 'Financial amounts & Udhar details hidden on lock-screen notifications.'
                          : 'Full amounts will be shown in push notifications.'
                      );
                    } catch {
                      toast.error('Save Failed', 'Could not update lock-screen privacy setting.');
                    }
                  }}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                    (preferences?.privacy_hide_amounts ?? true)
                      ? 'bg-emerald-600 justify-end'
                      : 'bg-slate-300 dark:bg-slate-700 justify-start'
                  }`}
                  aria-label="Toggle lock-screen financial privacy"
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Privacy & Permissions */}
      {activeTab === 'privacy' && (
        <div className="space-y-6">
          <PrivacyConsentCard
            onOpenPrivacyPolicy={() => setActiveTab('legal')}
            onExportBackup={handleExportBackup}
            onNavigateToProfile={onNavigateToProfile}
            onNavigateToDeletion={() => setActiveTab('deletion')}
          />
          <PermissionsSettingsCard />
          <UpiAutoDetectionSettings onOpenPrivacyPolicy={() => setActiveTab('legal')} />
        </div>
      )}

      {/* Tab 5: Security Preferences */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="p-2.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-xl">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Security Policies &amp; Access Controls
                </h3>
                <p className="text-xs text-slate-500">
                  Row-level security, encryption standard and multi-device session management
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/70 space-y-2">
                <span className="flex items-center gap-1.5 font-bold text-xs text-slate-800 dark:text-slate-200">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  Database Security (RLS)
                </span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  PostgreSQL Row-Level Security actively isolates each user&apos;s financial records so other users can never read your entries.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/70 space-y-2">
                <span className="flex items-center gap-1.5 font-bold text-xs text-slate-800 dark:text-slate-200">
                  <KeyRound className="w-4 h-4 text-emerald-500" />
                  Password &amp; Credentials
                </span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Passphrases are salted with Bcrypt (12 cost factor rounds). Passwords can be updated securely inside your Profile.
                </p>
                {onNavigateToProfile && (
                  <button
                    type="button"
                    onClick={onNavigateToProfile}
                    className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:underline pt-1"
                  >
                    <span>Change password in Profile</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="font-bold text-xs text-slate-900 dark:text-slate-100">Revoke All Device Sessions</p>
                <p className="text-[11px] text-slate-500">Signs out all other phones, tablets, or laptops</p>
              </div>
              <button
                type="button"
                onClick={handleLogoutAllDevices}
                disabled={isLoggingOutAll}
                className="px-4 py-2 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                {isLoggingOutAll ? 'Revoking...' : 'Logout All Devices'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 6: Preferences & Data Backup */}
      {activeTab === 'preferences' && (
        <div className="space-y-6">
          {/* Export JSON Backup */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="p-2.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-xl">
                <Download className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Data Backup &amp; Offline Portability
                </h3>
                <p className="text-xs text-slate-500">
                  Export all your personal transactions to a local encrypted JSON file
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 pt-1">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Total records: <span className="font-bold text-slate-900 dark:text-slate-100">{transactions.length}</span>
              </p>
              <button
                type="button"
                onClick={handleExportBackup}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export JSON Backup</span>
              </button>
            </div>
          </div>

          {/* Reset Transactions / Danger Zone */}
          <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-rose-100 dark:border-rose-950">
              <div className="p-2.5 bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 rounded-xl">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-rose-900 dark:text-rose-300">
                  Clear All Financial Transactions
                </h3>
                <p className="text-xs text-slate-500">
                  Moves your financial records to the Recycle Bin for safe recovery
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-slate-500">
                You can restore these records later from the Recycle Bin if needed.
              </p>
              <button
                type="button"
                onClick={() => setIsConfirmClearOpen(true)}
                className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold border border-rose-200 dark:border-rose-900 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All Records</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 7: Account & Data Deletion */}
      {activeTab === 'deletion' && (
        <div className="space-y-4">
          <AccountDeletionSection />
        </div>
      )}

      {/* Tab 8: Legal & Privacy Center */}
      {activeTab === 'legal' && (
        <div className="space-y-4">
          <LegalCenterSection
            initialPolicyId={initialLegalPolicy}
            onNavigateToAccountDeletion={() => setActiveTab('deletion')}
          />
        </div>
      )}

      {/* Clear Confirmation Modal */}
      <ConfirmModal
        isOpen={isConfirmClearOpen}
        title="Clear All Transactions?"
        message="Are you sure you want to move all your financial transactions to the Recycle Bin? Your balances will reset to ₹0."
        confirmLabel="Move to Recycle Bin"
        isLoading={isClearing}
        onConfirm={handleClearAllConfirm}
        onCancel={() => setIsConfirmClearOpen(false)}
      />
    </div>
  );
};
