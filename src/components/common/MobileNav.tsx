import React, { useState, useEffect } from 'react';
import { AiCompanionMark } from '../ai/AiCompanionMark';
import {
  LayoutDashboard,
  ArrowDownLeft,
  Home,
  DoorOpen,
  ShoppingBag,
  Users,
  BarChart3,
  ListOrdered,
  User,
  X,
  Plus,
  LogOut,
  Shield,
  Trash2,
  FolderKanban,
  GraduationCap,
  Briefcase,
  Heart,
  Plane,
  Car,
  Sparkles,
  Utensils,
  Coffee,
  HelpCircle,
  MessageSquare,
  Mic,
  Calculator,
  ShieldCheck,
  PieChart,
  Target,
  CalendarClock,
  Bell,
  MoreHorizontal,
  Calendar,
  Landmark,
  Receipt,
  QrCode,
  Scale,
} from 'lucide-react';
import { NavTab } from './Sidebar';
import { useExpense } from '../../context/ExpenseContext';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { formatINR } from '../../lib/dateUtils';
import { SUPPORT_CONTACT } from '../../config/contact';
import { ThemeToggle } from './ThemeToggle';

const iconMap: Record<string, any> = {
  Home,
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

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenAddModal: () => void;
  onOpenHelpModal?: (tab?: 'help' | 'feedback' | 'complaint' | 'dpdp') => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  isOpen,
  onClose,
  currentTab,
  onSelectTab,
  onOpenAddModal,
  onOpenHelpModal,
}) => {
  const { summary, recycleBinTransactions, dynamicSections, appBranding } = useExpense();
  const { user, isAdmin, logout } = useAuth();
  const { totalUnreadCount } = useNotifications();
  const [isMoreSheetOpen, setIsMoreSheetOpen] = useState(false);
  const [isAiMenuOpen, setIsAiMenuOpen] = useState(false);

  // Nielsen Heuristic: User Control & Freedom — Escape key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isAiMenuOpen) setIsAiMenuOpen(false);
        else if (isMoreSheetOpen) setIsMoreSheetOpen(false);
        else if (isOpen) onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isMoreSheetOpen, isAiMenuOpen, onClose]);

  const coreSectionIds = ['home', 'room', 'food', 'other', 'people'];
  const customSections = dynamicSections.filter(
    (s) => s.is_enabled && !coreSectionIds.includes(s.id)
  );

  interface MobileNavItem {
    id: NavTab;
    label: string;
    icon: any;
    badge?: string;
    count?: number;
  }

  interface MobileNavGroup {
    title: string;
    items: MobileNavItem[];
  }

  const navGroups: MobileNavGroup[] = [
    {
      title: 'Overview & Ledger',
      items: [
        { id: 'dashboard' as NavTab, label: 'Dashboard', icon: LayoutDashboard },
        { id: 'all_transactions' as NavTab, label: 'All Transactions', icon: ListOrdered, count: summary.totalTransactionsCount },
        { id: 'people' as NavTab, label: 'People (Udhar)', icon: Users, badge: formatINR(summary.netPeopleBalance) },
        ...customSections.map((sec) => ({
          id: sec.id as NavTab,
          label: sec.name,
          icon: iconMap[sec.icon] || FolderKanban,
        })),
      ],
    },
    {
      title: 'Financial Tools',
      items: [
        { id: 'upi_qr' as NavTab, label: 'UPI QR', icon: QrCode },
        { id: 'calculator' as NavTab, label: 'Calculator', icon: Calculator },
        { id: 'expense_calendar' as NavTab, label: 'Expense Calendar', icon: Calendar },
        { id: 'net_worth' as NavTab, label: 'Net Worth', icon: Landmark },
        { id: 'safe_to_spend' as NavTab, label: 'Safe-to-Spend', icon: ShieldCheck },
        { id: 'recycle_bin' as NavTab, label: 'Recycle Bin', icon: Trash2, count: recycleBinTransactions.length > 0 ? recycleBinTransactions.length : undefined },
      ],
    },
    {
      title: 'Reports & Planning',
      items: [
        { id: 'reports' as NavTab, label: 'Reports & Analytics', icon: BarChart3 },
        { id: 'budget' as NavTab, label: 'Monthly Budget', icon: PieChart },
        { id: 'savings_goals' as NavTab, label: 'Savings Goals', icon: Target },
        { id: 'recurring_bills' as NavTab, label: 'Recurring Bills', icon: CalendarClock },
      ],
    },
    {
      title: 'AI & Smart Features',
      items: [
        { id: 'ai_assistant' as NavTab, label: 'AI Money Assistant', icon: Sparkles },
        { id: 'receipt_scanner' as NavTab, label: 'Receipt Scanner (OCR)', icon: Receipt },
      ],
    },
    {
      title: 'Notifications & Alerts',
      items: [
        {
          id: 'notifications' as NavTab,
          label: 'Notifications & Alerts',
          icon: Bell,
          count: totalUnreadCount > 0 ? totalUnreadCount : undefined,
        },
      ],
    },
    {
      title: 'Account & Privacy',
      items: [
        { id: 'profile' as NavTab, label: 'My Account', icon: User },
        { id: 'legal' as NavTab, label: 'Privacy & Legal', icon: Scale },
      ],
    },
    {
      title: 'Help & Support',
      items: [
        { id: 'help_support' as NavTab, label: 'Help & Feedback', icon: HelpCircle },
        ...(isAdmin ? [{ id: 'admin' as NavTab, label: 'Admin Control', icon: Shield }] : []),
      ],
    },
  ];

  const handleSelect = (tab: NavTab) => {
    onSelectTab(tab);
    onClose();
  };

  const handleLogout = async () => {
    onClose();
    await logout();
  };

  return (
    <>
      {/* Mobile Drawer Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden animate-fade-in"
        />
      )}

      {/* Slide-out Drawer */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out lg:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={appBranding?.logoUrl || '/logo.jpg'}
              alt={`${appBranding?.appName || 'My Money Manager'} ${appBranding?.subTitle || 'by HackifyPro'}`}
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/logo.jpg'; }}
              className="w-10 h-10 rounded-xl object-cover shadow-sm border border-emerald-500/30 shrink-0"
            />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {appBranding?.appName || 'My Money Manager'}
              </h2>
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 truncate">
                {appBranding?.subTitle || 'by HackifyPro'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Card in Mobile Drawer */}
        {user && (
          <div
            onClick={() => handleSelect('profile')}
            className="mx-4 mt-3 p-3 bg-slate-100/80 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700/80 transition-colors cursor-pointer rounded-2xl flex items-center justify-between border border-slate-200/60 dark:border-slate-700/60"
            title="Open Profile & Account"
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
              {user.avatar_url || user.avatarUrl ? (
                <img
                  src={user.avatar_url || user.avatarUrl || ''}
                  alt={user.displayName || 'User'}
                  className="w-8 h-8 rounded-xl object-cover border border-emerald-500/40 shadow-xs shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold flex items-center justify-center text-xs shrink-0">
                  {user.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                  {user.displayName}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 break-all line-clamp-1" title={user.email || ''}>
                  {user.email}
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
        )}

        {/* Available Balance Box */}
        <div className={`p-4 mx-4 my-2.5 rounded-xl border ${
          summary.availableBalance < 0
            ? 'bg-rose-50/60 dark:bg-rose-950/30 border-rose-200/80 dark:border-rose-900/40'
            : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200/60 dark:border-slate-700/60'
        }`}>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Available Balance</span>
          <div className={`text-xl font-bold font-sans tabular-nums mt-0.5 ${
            summary.availableBalance < 0
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-slate-900 dark:text-slate-100'
          }`}>
            {formatINR(summary.availableBalance)}
          </div>
        </div>

        {/* Unified Add Transaction CTA */}
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenAddModal();
            }}
            className="w-full min-h-[42px] flex items-center justify-center gap-2 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.2]" />
            <span>+ Add Transaction</span>
          </button>
        </div>

        {/* Navigation list */}
        <div className="flex-1 px-3 py-2 space-y-4 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {group.title}
              </div>
              {group.items.map((item) => {
                const isActive =
                  currentTab === item.id ||
                  (item.id === 'notifications' && currentTab === 'smart_alerts');
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                      <span className="truncate">{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className="ml-2 text-xs font-mono text-slate-500 dark:text-slate-400 shrink-0">
                        {item.badge}
                      </span>
                    )}
                    {item.count !== undefined && (
                      <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
          {/* Help & Support on Mobile */}
          {onOpenHelpModal && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenHelpModal('help');
              }}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-all cursor-pointer"
            >
              <HelpCircle className="w-4 h-4 text-emerald-500" />
              <span>Help & Feedback ({SUPPORT_CONTACT.displayPhone})</span>
            </button>
          )}

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 py-1">
            <span className="font-medium">Theme Mode</span>
            <ThemeToggle size="sm" />
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Floating Action Buttons (FAB) for Mobile Quick Add & AI Assistant */}
      <div className="fixed right-4 bottom-20 z-40 flex flex-col gap-2.5 items-center transition-all duration-300 ease-out">
        {/* Speed-dial Popup Options for Voice AI & Chat AI */}
        {isAiMenuOpen && (
          <>
            {/* Backdrop to dismiss when tapped outside */}
            <div
              className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[1px]"
              onClick={() => setIsAiMenuOpen(false)}
            />

            <div className="flex flex-col items-end gap-2 mb-1 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
              {/* Option 1: Voice AI (बोलकर पूछें) */}
              <button
                type="button"
                onClick={() => {
                  setIsAiMenuOpen(false);
                  setIsMoreSheetOpen(false);
                  onSelectTab('ai_assistant');
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('start-ai-voice'));
                  }, 350);
                }}
                className="flex items-center gap-2.5 py-2 px-3.5 bg-white dark:bg-slate-900 border border-emerald-500/50 hover:border-emerald-500 shadow-xl rounded-2xl text-slate-800 dark:text-slate-100 hover:text-emerald-600 dark:hover:text-emerald-400 active:scale-95 transition-all cursor-pointer group"
              >
                <div className="flex flex-col text-right">
                  <span className="text-xs font-bold flex items-center justify-end gap-1.5 text-emerald-600 dark:text-emerald-400">
                    Voice AI
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">बोलकर पूछें</span>
                </div>
                <div className="w-8 h-8 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center shadow-md shadow-emerald-500/30 group-hover:scale-105 transition-transform">
                  <Mic className="w-4 h-4 stroke-[2.5]" />
                </div>
              </button>

              {/* Option 2: Chat AI (चैट करके पूछें) */}
              <button
                type="button"
                onClick={() => {
                  setIsAiMenuOpen(false);
                  setIsMoreSheetOpen(false);
                  onSelectTab('ai_assistant');
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('focus-ai-chat'));
                  }, 350);
                }}
                className="flex items-center gap-2.5 py-2 px-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-xl rounded-2xl text-slate-800 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 active:scale-95 transition-all cursor-pointer group"
              >
                <div className="flex flex-col text-right">
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Chat AI</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">टाइप करके चैट करें</span>
                </div>
                <div className="w-8 h-8 rounded-xl bg-blue-500 text-white flex items-center justify-center shadow-md shadow-blue-500/30 group-hover:scale-105 transition-transform">
                  <MessageSquare className="w-4 h-4 stroke-[2.5]" />
                </div>
              </button>
            </div>
          </>
        )}

        {/* Floating AI Assistant Trigger Button */}
        <button
          onClick={() => setIsAiMenuOpen((prev) => !prev)}
          className={`flex items-center justify-center w-12 h-12 rounded-full shadow-lg border transition-all duration-200 cursor-pointer ${
            isAiMenuOpen
              ? 'bg-emerald-600 text-emerald-50 border-emerald-400/70 ring-4 ring-emerald-500/25 scale-105 z-50'
              : currentTab === 'ai_assistant'
              ? 'bg-emerald-500 text-slate-950 border-emerald-300 ring-4 ring-emerald-500/30 scale-105'
              : 'bg-emerald-700 text-emerald-50 hover:bg-emerald-600 border-emerald-500/40 hover:scale-105 active:scale-95 shadow-emerald-950/30'
          }`}
          aria-label="Ask AI Assistant"
          title="Ask AI Assistant (Voice or Chat)"
        >
          {isAiMenuOpen ? (
            <X className="w-5 h-5 stroke-[2.5]" />
          ) : (
            <AiCompanionMark size={22} />
          )}
        </button>

        {/* Floating Add Transaction (+) Button */}
        <button
          onClick={onOpenAddModal}
          className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white shadow-md border border-emerald-500/30 transition-transform cursor-pointer"
          aria-label="Add transaction"
          title="Add transaction"
        >
          <Plus className="w-5 h-5 stroke-[2]" />
        </button>
      </div>

      {/* Floating Notch 6-Tab Bottom Navigation for Mobile (Home, Transactions, People, UPI QR, Reports, More) */}
      {(() => {
        const MORE_TABS = new Set([
          'ai_assistant',
          'expense_calendar',
          'smart_alerts',
          'receipt_scanner',
          'net_worth',
          'safe_to_spend',
          'budget',
          'savings_goals',
          'recurring_bills',
          'calculator',
          'notifications',
          'settings',
          'help_support',
          'recycle_bin',
          'legal',
          'home',
          'room',
          'food',
          'other',
        ]);
        const activeIndex = isMoreSheetOpen || MORE_TABS.has(currentTab)
          ? 5
          : currentTab === 'dashboard'
          ? 0
          : currentTab === 'all_transactions'
          ? 1
          : currentTab === 'people'
          ? 2
          : currentTab === 'upi_qr'
          ? 3
          : currentTab === 'reports'
          ? 4
          : 0;

        const mobileBottomItems = [
          {
            key: 'dashboard',
            label: 'Home',
            shortLabel: 'Home',
            icon: LayoutDashboard,
            onClick: () => {
              setIsMoreSheetOpen(false);
              onSelectTab('dashboard');
            },
          },
          {
            key: 'all_transactions',
            label: 'Transactions',
            shortLabel: 'Txns',
            icon: ListOrdered,
            onClick: () => {
              setIsMoreSheetOpen(false);
              onSelectTab('all_transactions');
            },
          },
          {
            key: 'people',
            label: 'People',
            shortLabel: 'People',
            icon: Users,
            onClick: () => {
              setIsMoreSheetOpen(false);
              onSelectTab('people');
            },
          },
          {
            key: 'upi_qr',
            label: 'UPI QR',
            shortLabel: 'UPI QR',
            icon: QrCode,
            onClick: () => {
              setIsMoreSheetOpen(false);
              onSelectTab('upi_qr');
            },
          },
          {
            key: 'reports',
            label: 'Reports',
            shortLabel: 'Reports',
            icon: BarChart3,
            onClick: () => {
              setIsMoreSheetOpen(false);
              onSelectTab('reports');
            },
          },
          {
            key: 'more',
            label: 'More',
            shortLabel: 'More',
            icon: MoreHorizontal,
            onClick: () => setIsMoreSheetOpen(!isMoreSheetOpen),
          },
        ];

        return (
          <nav
            aria-label="Mobile Navigation"
            data-testid="floating-notch-tab-bar"
            className="fixed bottom-0 inset-x-0 z-30 lg:hidden pointer-events-none px-2 sm:px-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-2"
          >
            <div className="pointer-events-auto relative mx-auto max-w-lg rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200/90 dark:border-slate-700/80 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.22)] dark:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.65)] px-1.5 py-1.5">
              {/* Smooth Sliding Floating Notch Pill */}
              <div
                aria-hidden="true"
                data-testid="floating-notch-indicator"
                data-active-index={activeIndex}
                className="absolute top-1.5 bottom-1.5 left-1.5 w-[calc((100%-0.75rem)/6)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.35,0.64,1)] pointer-events-none"
                style={{ transform: `translateX(${activeIndex * 100}%)` }}
              >
                <div className="relative w-full h-full rounded-xl bg-emerald-50 dark:bg-emerald-950/75 border border-emerald-200/80 dark:border-emerald-700/60 shadow-xs">
                  {/* Top Notch Accent Crest */}
                  <span className="absolute -top-[5px] left-1/2 -translate-x-1/2 w-5 h-1 rounded-full bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.65)]" />
                </div>
              </div>

              <div className="relative z-10 grid grid-cols-6 items-center">
                {mobileBottomItems.map((item, idx) => {
                  const Icon = item.icon;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={item.onClick}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={item.label}
                      data-testid={`mobile-tab-${item.key}`}
                      className={`flex flex-col items-center justify-center min-h-[44px] py-1.5 px-0.5 rounded-xl transition-all duration-200 select-none cursor-pointer ${
                        isActive
                          ? 'text-emerald-700 dark:text-emerald-300 font-semibold'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium'
                      }`}
                    >
                      <Icon
                        className={`w-[18px] h-[18px] mb-0.5 transition-transform duration-200 shrink-0 ${
                          isActive ? '-translate-y-0.5 stroke-[2.25]' : 'stroke-[1.75]'
                        }`}
                      />
                      <span className="text-[9.5px] sm:text-[10.5px] leading-tight whitespace-nowrap truncate max-w-full">
                        {item.shortLabel !== item.label ? (
                          <>
                            <span className="min-[410px]:hidden">{item.shortLabel}</span>
                            <span className="hidden min-[410px]:inline">{item.label}</span>
                          </>
                        ) : (
                          item.label
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>
        );
      })()}

      {/* More Slide-up Bottom Sheet */}
      {isMoreSheetOpen && (
        <>
          <div
            onClick={() => setIsMoreSheetOpen(false)}
            className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden animate-fade-in"
          />
          <div className="fixed bottom-0 inset-x-0 z-50 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-2xl shadow-xl p-5 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] max-h-[82vh] overflow-y-auto lg:hidden animate-slide-up space-y-4">
            <div className="w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto" />

            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-semibold text-base text-slate-900 dark:text-slate-100">
                  More Features
                </h3>
                <p className="text-xs text-slate-500">Organized financial tools, alerts &amp; account</p>
              </div>
              <button
                onClick={() => setIsMoreSheetOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4 stroke-[1.75]" />
              </button>
            </div>

            {/* Unified Notifications & Alerts Highlight Card */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Notifications &amp; Alerts
              </p>
              <button
                type="button"
                onClick={() => {
                  setIsMoreSheetOpen(false);
                  onSelectTab('notifications');
                }}
                className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer ${
                  currentTab === 'notifications' || currentTab === 'smart_alerts'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200/70 dark:border-slate-700/70 text-slate-800 dark:text-slate-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 text-left">
                  <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Bell className="w-4 h-4 stroke-[2]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">Notifications &amp; Alerts</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      Activity, reminders, security &amp; smart budget alerts
                    </p>
                  </div>
                </div>
                {totalUnreadCount > 0 && (
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-xs font-bold tabular-nums shrink-0">
                    {totalUnreadCount}
                  </span>
                )}
              </button>
            </div>

            {/* Financial Tools */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Financial Tools
              </p>
              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    onSelectTab('expense_calendar');
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 active:scale-[0.98] transition-colors text-center gap-1.5 cursor-pointer"
                >
                  <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400 stroke-[1.75]" />
                  <span className="text-[11px] font-medium">Calendar</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    onSelectTab('safe_to_spend');
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 active:scale-[0.98] transition-colors text-center gap-1.5 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
                  <span className="text-[11px] font-medium">Safe Spend</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    onSelectTab('net_worth');
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 active:scale-[0.98] transition-colors text-center gap-1.5 cursor-pointer"
                >
                  <Landmark className="w-4 h-4 text-indigo-600 dark:text-indigo-400 stroke-[1.75]" />
                  <span className="text-[11px] font-medium">Net Worth</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    onSelectTab('calculator');
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 active:scale-[0.98] transition-colors text-center gap-1.5 cursor-pointer"
                >
                  <Calculator className="w-4 h-4 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
                  <span className="text-[11px] font-medium">Calculator</span>
                </button>
              </div>
            </div>

            {/* Reports & Planning */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Reports &amp; Planning
              </p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    onSelectTab('budget');
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 active:scale-[0.98] transition-colors text-center gap-1.5 cursor-pointer"
                >
                  <PieChart className="w-4 h-4 text-purple-600 dark:text-purple-400 stroke-[1.75]" />
                  <span className="text-[11px] font-medium">Monthly Budget</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    onSelectTab('savings_goals');
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 active:scale-[0.98] transition-colors text-center gap-1.5 cursor-pointer"
                >
                  <Target className="w-4 h-4 text-teal-600 dark:text-teal-400 stroke-[1.75]" />
                  <span className="text-[11px] font-medium">Savings Goals</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    onSelectTab('recurring_bills');
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 active:scale-[0.98] transition-colors text-center gap-1.5 cursor-pointer"
                >
                  <CalendarClock className="w-4 h-4 text-indigo-600 dark:text-indigo-400 stroke-[1.75]" />
                  <span className="text-[11px] font-medium">Recurring Bills</span>
                </button>
              </div>
            </div>

            {/* AI & Smart Features */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                AI &amp; Smart Features
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    onSelectTab('ai_assistant');
                  }}
                  className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 active:scale-[0.98] transition-colors text-xs font-semibold cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 stroke-[1.75]" />
                  <span>AI Money Assistant</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    onSelectTab('receipt_scanner');
                  }}
                  className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 active:scale-[0.98] transition-colors text-xs font-semibold cursor-pointer"
                >
                  <Receipt className="w-4 h-4 text-emerald-600 dark:text-emerald-400 stroke-[1.75]" />
                  <span>Receipt Scanner (OCR)</span>
                </button>
              </div>
            </div>

            {/* Account & Privacy + Help & Support */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
              <button
                type="button"
                onClick={() => {
                  setIsMoreSheetOpen(false);
                  onOpenAddModal();
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[2.4]" />
                <span>+ Add Transaction</span>
              </button>

              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 pt-1">
                Account, Privacy &amp; Support
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    onSelectTab('profile');
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
                >
                  <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>My Account</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    onSelectTab('legal');
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
                >
                  <Scale className="w-4 h-4 text-blue-500" />
                  <span>Privacy &amp; Legal</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    onSelectTab('recycle_bin');
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
                >
                  <Trash2 className="w-4 h-4 text-slate-500" />
                  <span>Recycle Bin</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreSheetOpen(false);
                    if (onOpenHelpModal) onOpenHelpModal('help');
                    else onSelectTab('help_support');
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
                >
                  <HelpCircle className="w-4 h-4 text-emerald-500" />
                  <span>Help &amp; Support</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};
