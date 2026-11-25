import React, { useState, useEffect } from 'react';
import {
  Menu,
  PlusCircle,
  Sun,
  Moon,
  Clock,
  Shield,
  User,
  AlertTriangle,
  HelpCircle,
  Calculator,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useExpense } from '../../context/ExpenseContext';
import { NavTab } from './Sidebar';
import { formatDisplayDate, formatDisplayTime, getISTNow } from '../../lib/dateUtils';
import { SUPPORT_CONTACT } from '../../config/contact';
import { NotificationBell } from '../notifications/NotificationBell';
import { HeaderInstallButton } from './HeaderInstallButton';
import { SyncStatusIndicator } from './SyncStatusIndicator';

interface NavbarProps {
  currentTab: NavTab;
  onOpenMobileMenu: () => void;
  onOpenAddModal: () => void;
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
  onOpenHelpModal,
  onOpenNotificationCenter,
  onOpenNotificationPreferences,
}) => {
  const { theme, toggleTheme } = useTheme();
  const { user, isAdmin } = useAuth();
  const {
    maintenanceSettings,
    dynamicSections,
  } = useExpense();
  const [istTimeStr, setIstTimeStr] = useState('');
  const [istDateStr, setIstDateStr] = useState('');

  // Live IST Clock (Without seconds churn)
  useEffect(() => {
    const updateTime = () => {
      const ist = getISTNow();
      const hours = String(ist.getHours()).padStart(2, '0');
      const minutes = String(ist.getMinutes()).padStart(2, '0');
      // Format clean time without seconds (e.g. 10:30 AM)
      setIstTimeStr(formatDisplayTime(`${hours}:${minutes}`));

      const year = ist.getFullYear();
      const month = String(ist.getMonth() + 1).padStart(2, '0');
      const day = String(ist.getDate()).padStart(2, '0');
      setIstDateStr(formatDisplayDate(`${year}-${month}-${day}`));
    };

    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  const titles: Record<string, { title: string; subtitle: string; shortTitle: string }> = {
    dashboard: { title: 'Dashboard', shortTitle: 'Dashboard', subtitle: 'Overview & Main Sections' },
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
    settings: { title: 'Settings & Profile', shortTitle: 'Settings', subtitle: 'User profile & preferences' },
    admin: { title: 'Admin Master Control Center', shortTitle: 'Admin Control', subtitle: 'Complete multi-user management, transactions & platform settings' },
  };

  // Check if currentTab is a dynamic custom section
  const customSec = dynamicSections.find((s) => s.id === currentTab);
  const currentInfo = customSec
    ? { title: customSec.name, shortTitle: customSec.name, subtitle: customSec.description || 'Custom Section' }
    : titles[currentTab] || { title: 'Dashboard', shortTitle: 'Dashboard', subtitle: '' };

  return (
    <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-3 sm:px-6 lg:px-8 py-3 transition-colors">
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Hamburger + Title (Optimized for mobile to avoid text truncation) */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 sm:flex-initial">
          <button
            onClick={onOpenMobileMenu}
            className="lg:hidden p-2 -ml-1 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <img
            src="/logo.jpg"
            alt="My Money"
            className="w-7 h-7 rounded-lg object-cover hidden sm:block lg:hidden border border-emerald-500/30 shrink-0"
          />

          <div className="min-w-0 flex-1">
            <h2 className="text-sm sm:text-base lg:text-lg font-semibold text-slate-900 dark:text-slate-100 truncate leading-tight">
              <span className="sm:hidden">{currentInfo.shortTitle}</span>
              <span className="hidden sm:inline">{currentInfo.title}</span>
            </h2>
            <p className="hidden md:block text-xs text-slate-500 dark:text-slate-400 truncate">
              {currentInfo.subtitle}
            </p>
          </div>
        </div>

        {/* Right: IST Clock + User Pill + Add Button + Theme Toggle */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Admin Maintenance Mode Indicator */}
          {isAdmin && maintenanceSettings.isEnabled && (
            <div
              onClick={() => onSelectTab('admin')}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-medium text-xs rounded-xl cursor-pointer"
              title="Maintenance Mode is Active! Normal users are blocked. Click to manage."
            >
              <AlertTriangle className="w-3.5 h-3.5 stroke-[1.75]" />
              <span className="hidden sm:inline">Maintenance active</span>
            </div>
          )}

          {/* Live Cloud & System Synchronization Status */}
          <SyncStatusIndicator />

          {/* Top-right PWA Install Entry Point (only visible when installable & not installed) */}
          <HeaderInstallButton />

          {/* Quick Calculator Access (Standardized secondary button h-9) */}
          <button
            type="button"
            onClick={() => onSelectTab('calculator')}
            className={`hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium transition-colors cursor-pointer border ${
              currentTab === 'calculator'
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200/80 dark:border-slate-800'
            }`}
            title="Financial Calculator (GST, Offer & Split)"
            aria-label="Open calculator"
          >
            <Calculator className={`w-3.5 h-3.5 stroke-[1.75] ${currentTab === 'calculator' ? 'text-white' : 'text-emerald-500'}`} />
            <span className="hidden sm:inline">Calculator</span>
          </button>

          {/* Help, Feedback & Support Button (Standardized secondary button h-9) */}
          {onOpenHelpModal && (
            <button
              type="button"
              onClick={() => onOpenHelpModal('help')}
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-xs font-medium cursor-pointer border border-slate-200/80 dark:border-slate-800"
              title={`Help, Feedback, Complaints & WhatsApp (${SUPPORT_CONTACT.displayPhone})`}
              aria-label="Help and support"
            >
              <HelpCircle className="w-3.5 h-3.5 stroke-[1.75] text-emerald-500" />
              <span className="hidden xl:inline">Help</span>
            </button>
          )}

          {/* Notification Center Bell & Dropdown */}
          <NotificationBell
            onSelectTab={onSelectTab}
            onOpenFullCenter={onOpenNotificationCenter || (() => {})}
            onOpenPreferences={onOpenNotificationPreferences || (() => {})}
            onOpenHelpModal={onOpenHelpModal}
          />

          {/* Live IST clock (Subtle, non-distracting typography) */}
          <div className="hidden 2xl:flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono px-1">
            <Clock className="w-3.5 h-3.5 stroke-[1.75] text-slate-400" />
            <span>{istDateStr}</span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="tabular-nums font-medium">{istTimeStr} IST</span>
          </div>

          {/* User Badge */}
          {user && (
            <div
              onClick={() => onSelectTab(isAdmin ? 'admin' : 'settings')}
              className="hidden sm:flex items-center gap-2 h-9 px-2.5 bg-slate-100/80 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-xs font-medium cursor-pointer transition-colors border border-slate-200/60 dark:border-slate-700/60"
              title={isAdmin ? 'Open Admin Control' : 'View Profile Settings'}
            >
              {user.avatar_url || user.avatarUrl ? (
                <img
                  src={user.avatar_url || user.avatarUrl || ''}
                  alt={user.displayName}
                  className="w-5 h-5 rounded-lg object-cover border border-emerald-500/30"
                />
              ) : (
                <div className="w-5 h-5 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">
                  {user.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
                </div>
              )}
              <span className="truncate max-w-[100px]">{user.displayName}</span>
              {isAdmin && (
                <span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-medium">
                  Admin
                </span>
              )}
            </div>
          )}

          {/* Add Transaction Button (visible on mobile where sidebar is hidden) */}
          <button
            onClick={onOpenAddModal}
            className="flex lg:hidden items-center gap-1 h-9 px-2.5 sm:px-3.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Add Transaction"
            aria-label="Add Transaction"
          >
            <PlusCircle className="w-4 h-4 stroke-[2] shrink-0" />
            <span className="hidden xs:inline">Add</span>
          </button>

          {/* Theme Switcher (Standardized icon button h-9 w-9) */}
          <button
            onClick={toggleTheme}
            className="h-9 w-9 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-800 transition-colors shrink-0 cursor-pointer"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <Moon className="w-4 h-4 text-amber-400" />
            ) : (
              <Sun className="w-4 h-4 text-amber-500" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
