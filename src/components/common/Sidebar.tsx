import React from 'react';
import {
  LayoutDashboard,
  Home as HomeIcon,
  DoorOpen,
  ShoppingBag,
  Users,
  BarChart3,
  ListOrdered,
  Settings,
  Wallet,
  Sun,
  Moon,
  PlusCircle,
  LogOut,
  Shield,
  User,
  Trash2,
  FolderKanban,
  GraduationCap,
  Briefcase,
  Heart,
  Plane,
  Car,
  Sparkles,
  AlertTriangle,
  Utensils,
  Coffee,
  Download,
  HelpCircle,
  MessageSquare,
  Calculator,
  ShieldCheck,
  Scale,
  QrCode,
  ScanLine,
  PieChart,
  Target,
  CalendarClock,
  Bell,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { usePwaInstall } from '../../context/PwaInstallContext';
import { formatINR } from '../../lib/dateUtils';
import { SUPPORT_CONTACT } from '../../config/contact';

export type NavTab =
  | 'dashboard'
  | 'home'
  | 'room'
  | 'food'
  | 'other'
  | 'people'
  | 'budget'
  | 'savings_goals'
  | 'recurring_bills'
  | 'notifications'
  | 'calculator'
  | 'reports'
  | 'all_transactions'
  | 'recycle_bin'
  | 'help_support'
  | 'settings'
  | 'privacy_policy'
  | 'legal'
  | 'admin'
  | string;

const iconMap: Record<string, any> = {
  Home: HomeIcon,
  DoorOpen,
  ShoppingBag,
  Users,
  Utensils,
  Coffee,
  GraduationCap,
  Briefcase,
  Heart,
  Plane,
  Car,
  Sparkles,
  FolderKanban,
};

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenAddModal: () => void;
  onOpenHelpModal?: (tab?: 'help' | 'feedback' | 'complaint' | 'dpdp') => void;
  onOpenMyQr?: () => void;
  onOpenScanQr?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  onOpenAddModal,
  onOpenHelpModal,
  onOpenMyQr,
  onOpenScanQr,
}) => {
  const { summary, recycleBinTransactions, dynamicSections, maintenanceSettings } = useExpense();
  const { theme, toggleTheme } = useTheme();
  const { user, isAdmin, logout } = useAuth();
  const { isInstalled, triggerInstallPrompt } = usePwaInstall();

  // Find enabled custom sections that aren't the standard 5 (home, room, food, other, people)
  const coreSectionIds = ['home', 'room', 'food', 'other', 'people'];
  const customSections = dynamicSections.filter(
    (s) => s.is_enabled && !coreSectionIds.includes(s.id)
  );

  interface NavItem {
    id: NavTab;
    label: string;
    icon: any;
    countBadge?: string;
    badgeNum?: number;
  }

  const navItems: NavItem[] = [
    { id: 'dashboard' as NavTab, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'home' as NavTab, label: 'Home Money', icon: HomeIcon, countBadge: formatINR(summary.remainingHomeBalance) },
    { id: 'room' as NavTab, label: 'Room Expenses', icon: DoorOpen, countBadge: formatINR(summary.totalRoomExpenses) },
    { id: 'food' as NavTab, label: 'Food & Dining', icon: Utensils, countBadge: formatINR(summary.totalFoodExpenses) },
    { id: 'other' as NavTab, label: 'Other Expenses', icon: ShoppingBag, countBadge: formatINR(summary.totalOtherExpenses) },
    { id: 'people' as NavTab, label: 'People (Udhar)', icon: Users, countBadge: formatINR(summary.netPeopleBalance) },
    { id: 'budget' as NavTab, label: 'Budget Planner', icon: PieChart },
    { id: 'savings_goals' as NavTab, label: 'Savings Goals', icon: Target },
    { id: 'recurring_bills' as NavTab, label: 'Recurring Bills', icon: CalendarClock },
    { id: 'calculator' as NavTab, label: 'Calculator', icon: Calculator },
    ...customSections.map((sec) => ({
      id: sec.id as NavTab,
      label: sec.name,
      icon: iconMap[sec.icon] || FolderKanban,
    })),
    { id: 'reports' as NavTab, label: 'Reports & Analytics', icon: BarChart3 },
    { id: 'notifications' as NavTab, label: 'Notifications', icon: Bell },
    { id: 'all_transactions' as NavTab, label: 'All Transactions', icon: ListOrdered, badgeNum: summary.totalTransactionsCount },
    { id: 'recycle_bin' as NavTab, label: 'Recycle Bin', icon: Trash2, badgeNum: recycleBinTransactions.length > 0 ? recycleBinTransactions.length : undefined },
    { id: 'privacy_policy' as NavTab, label: 'Privacy Policy', icon: ShieldCheck },
    { id: 'help_support' as NavTab, label: 'Help & Feedback', icon: HelpCircle },
    { id: 'settings' as NavTab, label: 'Settings & Profile', icon: Settings },
  ];

  if (isAdmin) {
    navItems.push({
      id: 'admin' as NavTab,
      label: 'Admin Control',
      icon: Shield,
    });
  }

  return (
    <aside className="hidden lg:flex flex-col w-64 xl:w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 h-screen sticky top-0 select-none">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-3">
          <img
            src="/logo.jpg"
            alt="My Money Manager by HackifyPro"
            className="w-11 h-11 rounded-xl object-cover shadow-md shadow-emerald-500/20 border border-emerald-500/30"
          />
          <div className="min-w-0">
            <h1 className="text-base font-extrabold text-slate-900 dark:text-slate-100 leading-tight truncate">
              My Money Manager
            </h1>
            <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              by HackifyPro
            </p>
          </div>
        </div>

        {/* Available Balance Pill */}
        <div className="mt-5 p-3.5 bg-gradient-to-br from-blue-50 to-indigo-50/50 dark:from-blue-950/40 dark:to-slate-800/60 rounded-xl border border-blue-200/60 dark:border-blue-900/50">
          <div className="flex items-center justify-between text-xs text-blue-700 dark:text-blue-300 font-medium">
            <span>Available Balance</span>
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          </div>
          <div className="text-xl font-extrabold text-blue-700 dark:text-blue-300 font-sans mt-0.5">
            {formatINR(summary.availableBalance)}
          </div>
        </div>

        {/* Quick Add Button */}
        <button
          onClick={onOpenAddModal}
          className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl font-semibold text-sm shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Add Transaction</span>
        </button>

        {/* Quick Udhar QR Actions */}
        {(onOpenMyQr || onOpenScanQr) && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            {onOpenMyQr && (
              <button
                type="button"
                onClick={onOpenMyQr}
                className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                title="View My Udhar QR Code"
              >
                <QrCode className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>My QR</span>
              </button>
            )}
            {onOpenScanQr && (
              <button
                type="button"
                onClick={onOpenScanQr}
                className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                title="Scan Udhar QR Code"
              >
                <ScanLine className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Scan QR</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-4 py-4 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          const Icon = item.icon;
          const isAdminItem = item.id === 'admin';

          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-left cursor-pointer ${
                isActive
                  ? isAdminItem
                    ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold shadow-sm border border-indigo-200/60 dark:border-indigo-800/40'
                    : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold shadow-sm border border-emerald-200/60 dark:border-emerald-800/40'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive
                      ? isAdminItem
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                      : isAdminItem
                      ? 'text-indigo-500'
                      : 'text-slate-400'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </div>

              {item.badgeNum !== undefined && (
                <span className="ml-2 px-2 py-0.5 text-[11px] font-bold rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {item.badgeNum}
                </span>
              )}

              {isAdminItem && (
                <div className="flex items-center gap-1">
                  {maintenanceSettings.isEnabled && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-amber-500 text-slate-950 animate-pulse">
                      MAINT
                    </span>
                  )}
                  <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                    ADM
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer / User Profile & Controls */}
      <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
        {/* Help, Feedback & Support Buttons */}
        {onOpenHelpModal && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onOpenHelpModal('feedback')}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 text-[11px] font-bold transition-colors cursor-pointer"
              title="Give Feedback or Suggest a Feature"
            >
              <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
              <span>Feedback</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenHelpModal('help')}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 text-[11px] font-bold transition-colors cursor-pointer"
              title={`Helpline (${SUPPORT_CONTACT.displayPhone})`}
            >
              <HelpCircle className="w-3.5 h-3.5 text-blue-500" />
              <span>Help</span>
            </button>
          </div>
        )}

        {/* User Profile Card */}
        <div
          onClick={() => onSelectTab(isAdmin ? 'admin' : 'settings')}
          className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {user?.avatar_url || user?.avatarUrl ? (
              <img
                src={user?.avatar_url || user?.avatarUrl || ''}
                alt={user?.displayName}
                className="w-8 h-8 rounded-xl object-cover shrink-0 border border-emerald-500/30"
              />
            ) : (
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold flex items-center justify-center text-xs shrink-0">
                {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate">
                {user?.displayName || 'User'}
              </p>
              <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
            </div>
          </div>

          {isAdmin ? (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 shrink-0">
              Admin
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 shrink-0">
              User
            </span>
          )}
        </div>

        {/* Theme Toggle & Logout */}
        <div className="flex items-center justify-between px-1">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            title="Toggle theme"
          >
            {theme === 'dark' ? (
              <>
                <Moon className="w-3.5 h-3.5 text-amber-400" />
                <span>Dark</span>
              </>
            ) : (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                <span>Light</span>
              </>
            )}
          </button>

          <button
            onClick={logout}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950 transition-colors cursor-pointer"
            title="Log out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
