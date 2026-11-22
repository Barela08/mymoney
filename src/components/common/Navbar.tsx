import React, { useState, useEffect } from 'react';
import {
  Menu,
  PlusCircle,
  Sun,
  Moon,
  Clock,
  Shield,
  User,
  LogOut,
  Bell,
  AlertTriangle,
  X,
  Info,
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
  const { user, isAdmin, logout } = useAuth();
  const {
    maintenanceSettings,
    notifications,
    dynamicSections,
  } = useExpense();
  const [istTimeStr, setIstTimeStr] = useState('');
  const [istDateStr, setIstDateStr] = useState('');
  const [isNotifOpen, setIsNotifOpen] = useState(false);

  // Active notifications for this user or all users
  const activeNotifs = notifications.filter(
    (n) =>
      n.is_active &&
      (!n.target_user_id ||
        n.target_user_id === 'all' ||
        n.target_user_id === user?.uid ||
        n.target_user_id === user?.id)
  );

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
    home: { title: 'Home Section', shortTitle: 'Home Money', subtitle: 'Money received & spent for home' },
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
        {/* Left: Hamburger + Logo + Title */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={onOpenMobileMenu}
            className="lg:hidden p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <img
            src="/logo.jpg"
            alt="My Money Manager Logo"
            className="w-8 h-8 rounded-lg object-cover lg:hidden border border-emerald-500/30 shrink-0"
          />

          <div className="min-w-0">
            <h2 className="text-base sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 truncate">
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
              className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[10px] rounded-lg uppercase tracking-wider cursor-pointer shadow-sm animate-pulse"
              title="Maintenance Mode is Active! Normal users are blocked. Click to manage."
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Maintenance Active</span>
            </div>
          )}


          {/* Quick Calculator Access (Responsive: Visible on sm and up) */}
          <button
            type="button"
            onClick={() => onSelectTab('calculator')}
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
              currentTab === 'calculator'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-600/30'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200/80 dark:border-slate-800'
            }`}
            title="Financial Calculator (GST, Offer & Split)"
          >
            <Calculator className={`w-3.5 h-3.5 ${currentTab === 'calculator' ? 'text-white' : 'text-emerald-500'}`} />
            <span className="hidden sm:inline text-[11px]">Calculator</span>
          </button>

          {/* Help, Feedback & Support Button (Responsive: Visible on sm and up) */}
          {onOpenHelpModal && (
            <button
              type="button"
              onClick={() => onOpenHelpModal('help')}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-xs font-semibold cursor-pointer border border-slate-200/80 dark:border-slate-800"
              title={`Help, Feedback, Complaints & WhatsApp (${SUPPORT_CONTACT.displayPhone})`}
            >
              <HelpCircle className="w-3.5 h-3.5 text-emerald-500" />
              <span className="hidden xl:inline text-[11px]">Help</span>
            </button>
          )}

          {/* Notification Center Bell & Dropdown */}
          <NotificationBell
            onSelectTab={onSelectTab}
            onOpenFullCenter={onOpenNotificationCenter || (() => {})}
            onOpenPreferences={onOpenNotificationPreferences || (() => {})}
            onOpenHelpModal={onOpenHelpModal}
          />

          {/* Live IST clock */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-xl text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60 font-mono">
            <Clock className="w-3.5 h-3.5 text-emerald-500" />
            <span>{istDateStr}</span>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">{istTimeStr} (IST)</span>
          </div>

          {/* User Badge */}
          {user && (
            <div
              onClick={() => onSelectTab(isAdmin ? 'admin' : 'settings')}
              className="hidden sm:flex items-center gap-2 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
              title={isAdmin ? 'Open Admin Control' : 'View Profile Settings'}
            >
              {user.avatar_url || user.avatarUrl ? (
                <img
                  src={user.avatar_url || user.avatarUrl || ''}
                  alt={user.displayName}
                  className="w-5 h-5 rounded-lg object-cover border border-emerald-500/30"
                />
              ) : (
                <div className="w-5 h-5 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-[10px] font-bold">
                  {user.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
                </div>
              )}
              <span className="truncate max-w-[100px]">{user.displayName}</span>
              {isAdmin && (
                <span className="px-1 py-0.5 rounded text-[9px] bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-bold">
                  Admin
                </span>
              )}
            </div>
          )}

          {/* Add Transaction Button */}
          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-emerald-600/20 transition-all cursor-pointer whitespace-nowrap"
          >
            <PlusCircle className="w-4 h-4 shrink-0" />
            <span>Add</span>
          </button>

          {/* Theme Switcher */}
          <button
            onClick={toggleTheme}
            className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors shrink-0 cursor-pointer"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
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
