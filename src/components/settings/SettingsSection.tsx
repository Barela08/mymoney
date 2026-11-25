import React, { useState } from 'react';
import {
  Sun,
  Moon,
  Trash2,
  Download,
  User,
  Sliders,
  Scale,
  BellRing,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { ConfirmModal } from '../common/ConfirmModal';
import { UserProfileSection } from '../profile/UserProfileSection';
import { AccountDeletionSection } from '../profile/AccountDeletionSection';
import { LegalCenterSection } from '../legal/LegalCenterSection';
import { PermissionsSettingsCard } from './PermissionsSettingsCard';
import { UpiAutoDetectionSettings } from '../upi/UpiAutoDetectionSettings';

export type SettingsTabId = 'profile' | 'auto_detection' | 'preferences' | 'deletion' | 'legal';

interface SettingsSectionProps {
  initialTab?: SettingsTabId;
  initialLegalPolicy?: string;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  initialTab = 'profile',
  initialLegalPolicy = 'privacy_policy',
}) => {
  const {
    transactions,
    clearAllTransactions,
  } = useExpense();
  const { theme, setTheme } = useTheme();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<SettingsTabId>(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#auto-detection') {
      return 'auto_detection';
    }
    return initialTab;
  });

  // Clear data confirmation modal
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

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

  return (
    <div className="space-y-6 animate-fade-in pb-20 lg:pb-8 max-w-4xl mx-auto">
      {/* Settings Top Subtabs */}
      <div className="flex flex-wrap bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl gap-1 w-full sm:w-fit">
        <button
          onClick={() => setActiveTab('profile')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'profile'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          <span>Profile & Security</span>
        </button>

        <button
          onClick={() => setActiveTab('auto_detection')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'auto_detection'
              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <BellRing className="w-3.5 h-3.5" />
          <span>Automatic Expense Detection</span>
        </button>

        <button
          onClick={() => setActiveTab('preferences')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'preferences'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Preferences & Backup</span>
        </button>

        <button
          onClick={() => setActiveTab('deletion')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'deletion'
              ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
              : 'text-slate-500 hover:text-rose-600 dark:hover:text-rose-400'
          }`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete Account & Data</span>
        </button>

        <button
          onClick={() => setActiveTab('legal')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'legal'
              ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400'
          }`}
        >
          <Scale className="w-3.5 h-3.5" />
          <span>Legal & Privacy Center</span>
        </button>
      </div>

      {/* Profile & Security Tab */}
      {activeTab === 'profile' && (
        <UserProfileSection onNavigateToDeletion={() => setActiveTab('deletion')} />
      )}

      {/* Automatic UPI Expense Detection Tab */}
      {activeTab === 'auto_detection' && (
        <UpiAutoDetectionSettings onOpenPrivacyPolicy={() => setActiveTab('legal')} />
      )}

      {/* Preferences & Data Tab */}
      {activeTab === 'preferences' && (
        <div className="space-y-6">
          {/* Device Hardware Permissions Card */}
          <PermissionsSettingsCard />

          {/* Theme Selector */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="p-2.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 rounded-xl">
                {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Application Theme
                </h3>
                <p className="text-xs text-slate-500">Toggle between light and dark display modes</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 max-w-xs">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  theme === 'light'
                    ? 'border-emerald-500 bg-emerald-50/50 text-emerald-700 shadow-sm'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                <Sun className="w-4 h-4 text-amber-500" />
                <span>Light Mode</span>
              </button>

              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  theme === 'dark'
                    ? 'border-emerald-500 bg-emerald-950/30 text-emerald-300 shadow-sm'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                <Moon className="w-4 h-4 text-indigo-400" />
                <span>Dark Mode</span>
              </button>
            </div>
          </div>

          {/* Export JSON Backup */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="p-2.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-xl">
                <Download className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Data Backup & Export
                </h3>
                <p className="text-xs text-slate-500">
                  Export all your personal transactions to a local JSON backup file
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

          {/* Danger Zone: Clear Transactions */}
          <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
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
                You can restore these items later from the Recycle Bin if needed.
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

      {/* Account & Data Deletion Tab */}
      {activeTab === 'deletion' && (
        <div className="space-y-4">
          <AccountDeletionSection />
        </div>
      )}

      {/* Legal & Privacy Center Tab */}
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
