import React from 'react';
import {
  LayoutDashboard,
  ArrowDownLeft,
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
  HelpCircle,
  MessageSquare,
  Calculator,
  ShieldCheck,
  Scale,
  PieChart,
  Target,
  CalendarClock,
  Bell,
  Calendar,
  Landmark,
  Receipt,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { formatINR } from '../../lib/dateUtils';
import { SUPPORT_CONTACT } from '../../config/contact';

export type NavTab =
  | 'dashboard'
  | 'ai_assistant'
  | 'expense_calendar'
  | 'smart_alerts'
  | 'receipt_scanner'
  | 'net_worth'
  | 'safe_to_spend'
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
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  onOpenAddModal,
  onOpenHelpModal,
}) => {
  const { summary, recycleBinTransactions, dynamicSections, maintenanceSettings, appBranding } = useExpense();
  const { theme, toggleTheme } = useTheme();
  const { user, isAdmin, logout } = useAuth();

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
    onClick?: () => void;
  }

  interface NavGroup {
    title: string;
    items: NavItem[];
  }

  const navGroups: NavGroup[] = [
    {
      title: 'Overview',
      items: [
        { id: 'dashboard' as NavTab, label: 'Dashboard', icon: LayoutDashboard },
      ],
    },
    {
      title: 'Money Management',
      items: [
        { id: 'home' as NavTab, label: 'Received Money', icon: ArrowDownLeft, countBadge: formatINR(summary.totalReceivedMoney || summary.totalHomeReceived) },
        { id: 'room' as NavTab, label: 'Room Expenses', icon: DoorOpen, countBadge: formatINR(summary.totalRoomExpenses) },
        { id: 'food' as NavTab, label: 'Food & Dining', icon: Utensils, countBadge: formatINR(summary.totalFoodExpenses) },
        { id: 'other' as NavTab, label: 'Other Expenses', icon: ShoppingBag, countBadge: formatINR(summary.totalOtherExpenses) },
        { id: 'all_transactions' as NavTab, label: 'All Transactions', icon: ListOrdered, badgeNum: summary.totalTransactionsCount },
        ...customSections.map((sec) => ({
          id: sec.id as NavTab,
          label: sec.name,
          icon: iconMap[sec.icon] || FolderKanban,
        })),
      ],
    },
    {
      title: 'Planning',
      items: [
        { id: 'budget' as NavTab, label: 'Monthly Budget', icon: PieChart },
        { id: 'savings_goals' as NavTab, label: 'Savings Goals', icon: Target },
        { id: 'recurring_bills' as NavTab, label: 'Recurring Bills', icon: CalendarClock },
      ],
    },
    {
      title: 'Financial Tools',
      items: [
        { id: 'people' as NavTab, label: 'People (Udhar)', icon: Users, countBadge: formatINR(summary.netPeopleBalance) },
        { id: 'expense_calendar' as NavTab, label: 'Expense Calendar', icon: Calendar },
        { id: 'net_worth' as NavTab, label: 'Net Worth', icon: Landmark },
        { id: 'safe_to_spend' as NavTab, label: 'Safe-to-Spend', icon: ShieldCheck },
        { id: 'calculator' as NavTab, label: 'Calculator', icon: Calculator },
        { id: 'reports' as NavTab, label: 'Reports & Analytics', icon: BarChart3 },
        { id: 'recycle_bin' as NavTab, label: 'Recycle Bin', icon: Trash2, badgeNum: recycleBinTransactions.length > 0 ? recycleBinTransactions.length : undefined },
      ],
    },
    {
      title: 'Intelligence',
      items: [
        { id: 'ai_assistant' as NavTab, label: 'AI Money Assistant', icon: Sparkles },
        { id: 'smart_alerts' as NavTab, label: 'Smart Alerts', icon: Bell },
        { id: 'receipt_scanner' as NavTab, label: 'Receipt Scanner (OCR)', icon: Receipt },
      ],
    },
    {
      title: 'Account',
      items: [
        { id: 'settings' as NavTab, label: 'Settings & Profile', icon: Settings },
        { id: 'notifications' as NavTab, label: 'Notifications', icon: Bell },
        {
          id: 'help_support' as NavTab,
          label: 'Help & Feedback',
          icon: HelpCircle,
          onClick: onOpenHelpModal ? () => onOpenHelpModal('help') : undefined,
        },
      ],
    },
    ...(isAdmin ? [{
      title: 'Admin',
      items: [
        { id: 'admin' as NavTab, label: 'Admin Control', icon: Shield },
      ],
    }] : []),
  ];

  return (
    <aside className="hidden lg:flex flex-col w-64 xl:w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 h-screen sticky top-0 select-none">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-3">
          <img
            src={appBranding?.logoUrl || '/logo.jpg'}
            alt={`${appBranding?.appName || 'My Money Manager'} ${appBranding?.subTitle || 'by HackifyPro'}`}
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/logo.jpg'; }}
            className="w-10 h-10 rounded-xl object-cover border border-slate-200 dark:border-slate-800"
          />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight truncate">
              {appBranding?.appName || 'My Money Manager'}
            </h1>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              {appBranding?.subTitle || 'by HackifyPro'}
            </p>
          </div>
        </div>

        {/* Available Balance Pill */}
        <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>Available balance</span>
            <span className={`w-1.5 h-1.5 rounded-full ${summary.availableBalance < 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} />
          </div>
          <div className={`text-lg font-semibold tabular-nums font-sans mt-0.5 ${
            summary.availableBalance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'
          }`}>
            {formatINR(summary.availableBalance)}
          </div>
        </div>

        {/* Quick Add Button */}
        <button
          onClick={onOpenAddModal}
          className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white rounded-xl font-medium text-xs sm:text-sm transition-colors cursor-pointer"
        >
          <PlusCircle className="w-4 h-4 stroke-[2]" />
          <span>Add transaction</span>
        </button>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.title} className="space-y-1">
            <div className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {group.title}
            </div>

            {group.items.map((item) => {
              const isActive = currentTab === item.id;
              const Icon = item.icon;
              const isAdminItem = item.id === 'admin';

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.onClick) {
                      item.onClick();
                    } else {
                      onSelectTab(item.id);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all text-left cursor-pointer ${
                    isActive
                      ? isAdminItem
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold shadow-xs border border-indigo-200/60 dark:border-indigo-800/40'
                        : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold shadow-xs border border-emerald-200/60 dark:border-emerald-800/40'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
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

                  {item.countBadge && (
                    <span className="ml-2 text-xs font-mono text-slate-500 dark:text-slate-400">
                      {item.countBadge}
                    </span>
                  )}

                  {item.badgeNum !== undefined && (
                    <span className="ml-2 px-2 py-0.5 text-xs font-bold rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {item.badgeNum}
                    </span>
                  )}

                  {isAdminItem && (
                    <div className="flex items-center gap-1">
                      {maintenanceSettings.isEnabled && (
                        <span className="px-1.5 py-0.5 text-xs font-bold rounded-md bg-amber-500 text-slate-950 animate-pulse">
                          MAINT
                        </span>
                      )}
                      <span className="px-1.5 py-0.5 text-xs font-bold rounded-md bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                        ADM
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer / User Profile & Controls */}
      <div className="p-3.5 border-t border-slate-100 dark:border-slate-800/80 space-y-2.5">
        {/* User Profile Card */}
        <div
          onClick={() => onSelectTab(isAdmin ? 'admin' : 'settings')}
          className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer transition-colors"
          title={`Signed in as ${user?.email || 'User'}`}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
            {user?.avatar_url || user?.avatarUrl ? (
              <img
                src={user?.avatar_url || user?.avatarUrl || ''}
                alt={user?.displayName}
                className="w-8 h-8 rounded-xl object-cover shrink-0 border border-emerald-500/30"
              />
            ) : (
              <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold flex items-center justify-center text-xs shrink-0">
                {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                {user?.displayName || 'User'}
              </p>
              <p
                className="text-xs text-slate-500 dark:text-slate-400 break-all line-clamp-1"
                title={user?.email || ''}
              >
                {user?.email}
              </p>
            </div>
          </div>

          {isAdmin ? (
            <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300/50 dark:border-amber-800/50 shrink-0">
              Admin
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300/60 dark:border-slate-700/60 shrink-0">
              User
            </span>
          )}
        </div>

        {/* Theme Toggle & Logout (Balanced 2-Column Row) */}
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <button
            type="button"
            onClick={toggleTheme}
            className="h-9 px-3 flex items-center justify-center gap-1.5 text-xs font-medium rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer border border-slate-200/60 dark:border-slate-700/60"
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
            type="button"
            onClick={logout}
            className="h-9 px-3 flex items-center justify-center gap-1.5 text-xs font-medium rounded-xl text-rose-600 dark:text-rose-400 bg-rose-50/50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-950/70 border border-rose-200/60 dark:border-rose-900/40 transition-colors cursor-pointer"
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
