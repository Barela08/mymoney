import React from 'react';
import {
  Menu,
  User,
  AlertTriangle,
  PlusCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useExpense } from '../../context/ExpenseContext';
import { NavTab } from './Sidebar';
import { SyncStatusIndicator } from './SyncStatusIndicator';

interface NavbarProps {
  currentTab: NavTab;
  onOpenMobileMenu: () => void;
  onOpenAddModal?: () => void;
  onSelectTab: (tab: NavTab) => void;
  onOpenHelpModal?: (tab?: 'help' | 'feedback' | 'complaint' | 'dpdp') => void;
  onOpenNotificationCenter?: () => void;
  onOpenNotificationPreferences?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onOpenMobileMenu,
  onOpenAddModal,
  onSelectTab,
}) => {
  const { user, isAdmin } = useAuth();
  const {
    maintenanceSettings,
    dynamicSections,
    appBranding,
  } = useExpense();

  const titles: Record<string, { title: string; subtitle: string; shortTitle: string }> = {
    dashboard: { title: 'Dashboard', shortTitle: 'Dashboard', subtitle: 'Overview & Main Financial Sections' },
    profile: { title: 'Profile & Account', shortTitle: 'Profile', subtitle: 'Personal credentials, active sessions & security' },
    settings: { title: 'Application Settings', shortTitle: 'Settings', subtitle: 'Appearance, language, notifications & privacy' },
    ai_assistant: { title: 'AI Money Assistant', shortTitle: 'AI Assistant', subtitle: 'Conversational financial advisor grounded in your real data' },
    expense_calendar: { title: 'Expense Calendar', shortTitle: 'Calendar', subtitle: 'Daily, weekly & monthly spending heatmap and ledger' },
    smart_alerts: { title: 'Smart Financial Alerts', shortTitle: 'Smart Alerts', subtitle: 'Budget thresholds, upcoming bills, anomalies & Udhar reminders' },
    receipt_scanner: { title: 'Receipt Scanner (OCR)', shortTitle: 'Receipt OCR', subtitle: 'Scan receipts & review extracted details before saving' },
    net_worth: { title: 'Net Worth Tracker', shortTitle: 'Net Worth', subtitle: 'Assets minus liabilities with real snapshot history' },
    safe_to_spend: { title: 'Safe-to-Spend Calculator', shortTitle: 'Safe-to-Spend', subtitle: 'True spendable cash after upcoming bills & protected reserves' },
    home: { title: 'Received Money', shortTitle: 'Received Money', subtitle: 'Salary, business, freelancing & all money received' },
    room: { title: 'Room Section', shortTitle: 'Room Expenses', subtitle: 'Gas, grocery, room rent & power bill' },
    food: { title: 'Food & Dining Section', shortTitle: 'Food & Dining', subtitle: 'Restaurant, fast food, snacks, tea/coffee & food delivery' },
    other: { title: 'Other Expenses', shortTitle: 'Other Expenses', subtitle: 'Shopping, travel, medical, bills & personal' },
    people: { title: 'People Section (Udhar)', shortTitle: 'People (Udhar)', subtitle: 'Money given & received from people' },
    budget: { title: 'Budget Planner', shortTitle: 'Budgets', subtitle: 'Category-wise limits & spend tracking' },
    savings_goals: { title: 'Savings Goals', shortTitle: 'Savings', subtitle: 'Target amounts & progress milestones' },
    recurring_bills: { title: 'Recurring Bills', shortTitle: 'Bills', subtitle: 'Subscriptions, rent, power & dues' },
    notifications: { title: 'Notification Center', shortTitle: 'Alerts', subtitle: 'Budget warnings & transaction activity' },
    calculator: { title: 'Calculator', shortTitle: 'Calculator', subtitle: 'GST, Offer & Split Calculations' },
    reports: { title: 'Reports & Analytics', shortTitle: 'Reports', subtitle: 'Expense charts & cashflow trends' },
    all_transactions: { title: 'All Transactions Ledger', shortTitle: 'All Ledger', subtitle: 'Searchable master ledger' },
    recycle_bin: { title: 'Recycle Bin & Recovery', shortTitle: 'Recycle Bin', subtitle: 'Soft-deleted transactions & safety recovery' },
    help_support: { title: 'Help & Support', shortTitle: 'Help', subtitle: 'Feedback, complaints & customer care' },
    legal: { title: 'Legal & Privacy Center', shortTitle: 'Legal', subtitle: 'Terms of service, privacy policy & DPDP rights' },
    admin: { title: 'Admin Master Control Center', shortTitle: 'Admin Control', subtitle: 'Complete multi-user management, transactions & platform settings' },
  };

  // Check if currentTab is a dynamic custom section
  const customSec = dynamicSections.find((s) => s.id === currentTab);
  const currentInfo = customSec
    ? { title: customSec.name, shortTitle: customSec.name, subtitle: customSec.description || 'Custom Section' }
    : titles[currentTab] || { title: 'Dashboard', shortTitle: 'Dashboard', subtitle: 'Overview & Main Financial Sections' };

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-3 sm:px-6 lg:px-8 py-2.5 transition-colors">
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Hamburger menu + Brand Logo / Section Title */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 sm:flex-initial">
          <button
            onClick={onOpenMobileMenu}
            className="lg:hidden p-2 -ml-1 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            aria-label="Open menu"
            title="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <img
            src={appBranding?.logoUrl || '/logo.jpg'}
            alt={appBranding?.appName || 'My Money Manager'}
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/logo.jpg'; }}
            className="w-7 h-7 rounded-lg object-cover hidden sm:block lg:hidden border border-emerald-500/30 shrink-0"
          />

          <div className="min-w-0 flex-1">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate leading-tight">
              <span className="sm:hidden">{currentInfo.shortTitle}</span>
              <span className="hidden sm:inline">{currentInfo.title}</span>
            </h2>
            <p className="hidden md:block text-xs text-slate-500 dark:text-slate-400 truncate">
              {currentInfo.subtitle}
            </p>
          </div>
        </div>

        {/* Right: Only Account Controls — Settings and Profile */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Admin Maintenance Mode Indicator */}
          {isAdmin && maintenanceSettings.isEnabled && (
            <div
              onClick={() => onSelectTab('admin')}
              className="flex items-center gap-1.5 px-2 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-medium text-xs rounded-xl cursor-pointer"
              title="Maintenance Mode is Active! Normal users are blocked. Click to manage."
            >
              <AlertTriangle className="w-3.5 h-3.5 stroke-[1.75]" />
              <span className="hidden sm:inline text-[11px] font-bold">Maintenance active</span>
            </div>
          )}

          {/* Real-time Network & Cloud Synchronization Indicator */}
          <SyncStatusIndicator />

          {/* Add Transaction Button */}
          {onOpenAddModal && (
            <button
              type="button"
              onClick={onOpenAddModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer shrink-0"
              title="Add Transaction"
              aria-label="Add Transaction"
            >
              <PlusCircle className="w-3.5 h-3.5 stroke-[2.5]" />
              <span className="hidden sm:inline">Add Transaction</span>
              <span className="sm:hidden">Add</span>
            </button>
          )}

          {/* Single My Account / Profile Icon */}
          <button
            type="button"
            onClick={() => onSelectTab('profile')}
            className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-all cursor-pointer relative group p-0.5 ${
              currentTab === 'profile'
                ? 'border-emerald-500 ring-2 ring-emerald-500/30'
                : 'border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
            }`}
            title="My Account"
            aria-label="My Account"
          >
            {(user?.avatar_url || user?.avatarUrl) ? (
              <img
                src={(user?.avatar_url || user?.avatarUrl) as string}
                alt={user?.displayName || 'User'}
                className="w-full h-full rounded-[10px] object-cover"
              />
            ) : user ? (
              <div className="w-full h-full rounded-[10px] bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-black text-xs flex items-center justify-center">
                {(user?.displayName || user?.full_name || user?.email || 'U').charAt(0).toUpperCase()}
              </div>
            ) : (
              <User className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            )}
            {/* Desktop Tooltip */}
            <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-sm z-50 hidden sm:block">
              My Account
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
