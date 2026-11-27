import React, { useState, useEffect, lazy, Suspense } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ExpenseProvider, useExpense } from './context/ExpenseContext';
import { Sidebar, NavTab } from './components/common/Sidebar';
import { Navbar } from './components/common/Navbar';
import { MobileNav } from './components/common/MobileNav';
import { DashboardView } from './components/dashboard/DashboardView';
import { HomeSection } from './components/home/HomeSection';
import { RoomSection } from './components/room/RoomSection';
import { FoodSection } from './components/food/FoodSection';
import { OtherSection } from './components/other/OtherSection';
import { PeopleSection } from './components/people/PeopleSection';
import { AllTransactionsSection } from './components/all-transactions/AllTransactionsSection';
import { MaintenanceScreen } from './components/maintenance/MaintenanceScreen';
import { OfflineBanner } from './components/common/OfflineBanner';
import { ScanQrModal } from './components/people/ScanQrModal';
import { udharDeletionApi } from './lib/udharDeletionApi';
import { AddTransactionModal } from './components/modals/AddTransactionModal';
import { AuthPage } from './components/auth/AuthPage';
import { AdminLoginPage } from './components/auth/AdminLoginPage';
import { StaffLoginPage } from './components/auth/StaffLoginPage';
import { AppDownloadPopup } from './components/common/AppDownloadPopup';
import { TransactionCategory, TransactionSubcategory } from './types';
import { AlertTriangle, EyeOff } from 'lucide-react';
import { getPortalScopeFromLocation } from './lib/portalAuth';
import { PwaInstallProvider, usePwaInstall } from './context/PwaInstallContext';
import { PwaInstallBanner } from './components/common/PwaInstallBanner';
import { PwaInstallModal } from './components/common/PwaInstallModal';
import { DpdpConsentBanner } from './components/common/DpdpConsentBanner';
import { DpdpConsentModal } from './components/common/DpdpConsentModal';
import { PullToRefresh } from './components/common/PullToRefresh';
import { NotificationProvider } from './context/NotificationContext';
import { PermissionProvider } from './context/PermissionContext';
import { UpiDetectionProvider } from './context/UpiDetectionContext';
import { InstantExpensePopupModal } from './components/upi/InstantExpensePopupModal';
import { UpiDetectionOnboardingModal } from './components/upi/UpiDetectionOnboardingModal';
import { AppErrorBoundary } from './components/common/AppErrorBoundary';

// High-Performance On-Demand Lazy Loaded Modules
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const StaffDashboard = lazy(() => import('./components/staff/StaffDashboard').then(m => ({ default: m.StaffDashboard })));
const LegalCenterSection = lazy(() => import('./components/legal/LegalCenterSection').then(m => ({ default: m.LegalCenterSection })));
const CalculatorSection = lazy(() => import('./components/calculator/CalculatorSection').then(m => ({ default: m.CalculatorSection })));
const ReportsSection = lazy(() => import('./components/reports/ReportsSection').then(m => ({ default: m.ReportsSection })));
const RecycleBinSection = lazy(() => import('./components/recycle-bin/RecycleBinSection').then(m => ({ default: m.RecycleBinSection })));
const DynamicCustomSection = lazy(() => import('./components/dynamic/DynamicCustomSection').then(m => ({ default: m.DynamicCustomSection })));
const SettingsSection = lazy(() => import('./components/settings/SettingsSection').then(m => ({ default: m.SettingsSection })));
const UserProfileSection = lazy(() => import('./components/profile/UserProfileSection').then(m => ({ default: m.UserProfileSection })));
const HelpSupportSection = lazy(() => import('./components/support/HelpSupportSection').then(m => ({ default: m.HelpSupportSection })));
const BudgetSection = lazy(() => import('./components/budget/BudgetSection').then(m => ({ default: m.BudgetSection })));
const SavingsGoalsSection = lazy(() => import('./components/savings/SavingsGoalsSection').then(m => ({ default: m.SavingsGoalsSection })));
const RecurringBillsSection = lazy(() => import('./components/bills/RecurringBillsSection').then(m => ({ default: m.RecurringBillsSection })));
const NotificationsSection = lazy(() => import('./components/notifications/NotificationsSection').then(m => ({ default: m.NotificationsSection })));
const AiAssistantSection = lazy(() => import('./components/ai/AiAssistantSection').then(m => ({ default: m.AiAssistantSection })));
const ExpenseCalendarSection = lazy(() => import('./components/calendar/ExpenseCalendarSection').then(m => ({ default: m.ExpenseCalendarSection })));
const ReceiptScannerSection = lazy(() => import('./components/receipts/ReceiptScannerSection').then(m => ({ default: m.ReceiptScannerSection })));
const NetWorthSection = lazy(() => import('./components/net-worth/NetWorthSection').then(m => ({ default: m.NetWorthSection })));
const SafeToSpendSection = lazy(() => import('./components/safe-to-spend/SafeToSpendSection').then(m => ({ default: m.SafeToSpendSection })));
const UpiQrGeneratorSection = lazy(() => import('./components/upi/UpiQrGeneratorSection').then(m => ({ default: m.UpiQrGeneratorSection })));
const NotificationPreferencesModal = lazy(() => import('./components/notifications/NotificationPreferencesModal').then(m => ({ default: m.NotificationPreferencesModal })));
const CompleteProfileScreen = lazy(() => import('./components/auth/CompleteProfileScreen').then(m => ({ default: m.CompleteProfileScreen })));
const AddUdharModal = lazy(() => import('./components/people/AddUdharModal').then(m => ({ default: m.AddUdharModal })));

const PATH_TO_TAB: Record<string, NavTab> = {
  '/myadmin': 'admin',
  '/admin': 'admin',
  '/transactions': 'all_transactions',
  '/people': 'people',
  '/reports': 'reports',
  '/settings': 'settings',
  '/budget': 'budget',
  '/savings': 'savings_goals',
  '/bills': 'recurring_bills',
  '/ai-assistant': 'ai_assistant',
  '/expense-calendar': 'expense_calendar',
  '/smart-alerts': 'notifications',
  '/notifications': 'notifications',
  '/receipt-scanner': 'receipt_scanner',
  '/net-worth': 'net_worth',
  '/safe-to-spend': 'safe_to_spend',
  '/upi-qr': 'upi_qr',
  '/profile': 'profile',
};

const TAB_TO_PATH: Partial<Record<NavTab, string>> = {
  dashboard: '/',
  admin: '/myadmin',
  all_transactions: '/transactions',
  people: '/people',
  reports: '/reports',
  settings: '/settings',
  budget: '/budget',
  savings_goals: '/savings',
  recurring_bills: '/bills',
  ai_assistant: '/ai-assistant',
  expense_calendar: '/expense-calendar',
  smart_alerts: '/notifications',
  notifications: '/notifications',
  receipt_scanner: '/receipt-scanner',
  net_worth: '/net-worth',
  safe_to_spend: '/safe-to-spend',
  upi_qr: '/upi-qr',
  profile: '/profile',
};

const SectionFallback: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-20 min-h-[300px] space-y-3 animate-pulse">
    <div className="w-9 h-9 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading View...</span>
  </div>
);

const MainContent: React.FC = () => {
  const { user, isAdmin, isStaff, isLoading, isRecoveryMode } = useAuth();
  const { maintenanceSettings, refreshSiteConfig, dynamicSections, refreshTransactions, appBranding, siteConfig } = useExpense();
  const toast = useToast();

  const [routeLocation, setRouteLocation] = useState<{ pathname: string; hash: string }>(() => {
    if (typeof window === 'undefined') return { pathname: '/', hash: '' };
    return {
      pathname: window.location.pathname.replace(/\/+$/, '') || '/',
      hash: window.location.hash || '',
    };
  });

  const syncRouteLocation = () => {
    if (typeof window === 'undefined') return;
    setRouteLocation({
      pathname: window.location.pathname.replace(/\/+$/, '') || '/',
      hash: window.location.hash || '',
    });
    window.dispatchEvent(new Event('mymoney:portal-change'));
  };

  const navigatePortalPath = (targetPath: '/' | '/myadmin' | '/mystaff') => {
    if (typeof window !== 'undefined') {
      window.location.href = targetPath;
    }
  };

  const [currentTab, setCurrentTabState] = useState<NavTab>(() => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname.replace(/\/+$/, '') || '/';
      const hash = window.location.hash;
      if (
        p === '/myadmin' ||
        p.startsWith('/myadmin/') ||
        p === '/admin' ||
        hash === '#myadmin' ||
        hash.startsWith('#myadmin=') ||
        hash === '#admin' ||
        hash.startsWith('#admin=')
      ) {
        return 'admin';
      }
      if (hash === '#privacy-policy') return 'legal';
      if (
        hash === '#delete-account' ||
        hash === '#auto-detection' ||
        hash === '#privacy' ||
        hash === '#manage-consent' ||
        hash === '#appearance' ||
        hash === '#notifications' ||
        hash === '#language' ||
        hash === '#app-install' ||
        hash === '#install'
      ) {
        return 'settings';
      }
      if (hash === '#profile') return 'profile';
      if (hash.includes('legal=')) return 'legal';
      return PATH_TO_TAB[p] || 'dashboard';
    }
    return 'dashboard';
  });
  const [aiInitialPrompt, setAiInitialPrompt] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string>(() => {
    if (typeof window === 'undefined') return 'appearance';
    const hash = window.location.hash;
    if (hash === '#app-install' || hash === '#install') return 'install';
    if (hash === '#auto-detection' || hash === '#privacy' || hash === '#manage-consent') return 'privacy';
    if (hash === '#delete-account') return 'deletion';
    if (hash === '#notifications') return 'notifications';
    if (hash === '#language') return 'language';
    return 'appearance';
  });

  const setCurrentTab = (tab: NavTab) => {
    setCurrentTabState(tab);
    const targetPath = TAB_TO_PATH[tab];
    if (targetPath && window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
      syncRouteLocation();
    } else if (!targetPath && PATH_TO_TAB[window.location.pathname]) {
      window.history.pushState(null, '', '/');
      syncRouteLocation();
    }
  };

  useEffect(() => {
    const onPopState = () => {
      const p = window.location.pathname.replace(/\/+$/, '') || '/';
      const h = window.location.hash || '';
      setRouteLocation({ pathname: p, hash: h });
      window.dispatchEvent(new Event('mymoney:portal-change'));
      if (
        p === '/myadmin' ||
        p.startsWith('/myadmin/') ||
        p === '/admin' ||
        h === '#myadmin' ||
        h.startsWith('#myadmin=') ||
        h === '#admin' ||
        h.startsWith('#admin=')
      ) {
        setCurrentTabState('admin');
      } else {
        setCurrentTabState(PATH_TO_TAB[p] || 'dashboard');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Global QR Modal State (QR pairing lives inside the People workflow)
  const [isScanQrOpen, setIsScanQrOpen] = useState(false);
  const [initialPairCode, setInitialPairCode] = useState<string | null>(null);
  const [initialLegalPolicy, setInitialLegalPolicy] = useState('privacy_policy');

  // Notification Preferences Modal State (history is the notifications page)
  const [isNotifPrefsOpen, setIsNotifPrefsOpen] = useState(false);

  // Hash & URL routing listener (for deletion email cancellation links, direct legal links, admin routes, etc.)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const path = window.location.pathname.replace(/\/+$/, '') || '/';
      setRouteLocation({ pathname: path, hash });
      window.dispatchEvent(new Event('mymoney:portal-change'));

      if (
        path === '/myadmin' ||
        path.startsWith('/myadmin/') ||
        path === '/admin' ||
        hash === '#myadmin' ||
        hash.startsWith('#myadmin=') ||
        hash === '#admin' ||
        hash.startsWith('#admin=')
      ) {
        setCurrentTabState('admin');
        return;
      }
      if (path === '/mystaff' || path.startsWith('/mystaff/') || hash === '#mystaff' || hash.startsWith('#mystaff=')) {
        return;
      }

      if (!hash) return;

      if (hash.includes('cancel-deletion=')) {
        const token = hash.split('cancel-deletion=')[1]?.split('&')[0];
        if (token) {
          udharDeletionApi
            .cancelAccountDeletionByToken(token)
            .then((res) => {
              if (res.success) {
                toast.success('Deletion Cancelled', 'Your account and data deletion request was successfully cancelled.');
                window.location.hash = '';
                setCurrentTab('settings');
              } else {
                toast.error('Cancellation Failed', res.message);
              }
            })
            .catch((err) => {
              toast.error('Cancellation Error', err.message);
            });
        }
      } else if (hash.includes('legal=')) {
        const policy = hash.split('legal=')[1]?.split('&')[0];
        if (policy) {
          setInitialLegalPolicy(policy);
          setCurrentTab('legal');
        }
      } else if (hash.includes('pair=')) {
        const pairCode = hash.split('pair=')[1]?.split('&')[0]?.trim();
        if (pairCode) {
          setInitialPairCode(decodeURIComponent(pairCode));
          setCurrentTab('people');
          setIsScanQrOpen(true);
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      } else if (hash === '#privacy-policy') {
        setInitialLegalPolicy('privacy_policy');
        setCurrentTab('legal');
      } else if (hash === '#delete-account') {
        setSettingsInitialTab('deletion');
        setCurrentTab('settings');
      } else if (hash === '#auto-detection' || hash === '#privacy' || hash === '#manage-consent') {
        setSettingsInitialTab('privacy');
        setCurrentTab('settings');
      } else if (hash === '#notifications') {
        setSettingsInitialTab('notifications');
        setCurrentTab('settings');
      } else if (hash === '#language') {
        setSettingsInitialTab('language');
        setCurrentTab('settings');
      } else if (hash === '#app-install' || hash === '#install') {
        setSettingsInitialTab('install');
        setCurrentTab('settings');
      } else if (hash === '#appearance') {
        setSettingsInitialTab('appearance');
        setCurrentTab('settings');
      } else if (hash === '#profile') {
        setCurrentTab('profile');
      }
    };

    const handleOpenSettingsEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<{ tab?: string }>).detail;
      if (detail?.tab) setSettingsInitialTab(detail.tab);
      setCurrentTab('settings');
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('mymoney:open-settings', handleOpenSettingsEvent);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('mymoney:open-settings', handleOpenSettingsEvent);
    };
  }, [toast]);

  // Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAddUdharModalOpen, setIsAddUdharModalOpen] = useState(false);
  const [addUdharInitialPerson, setAddUdharInitialPerson] = useState<string | undefined>(undefined);
  const [modalInitialCategory, setModalInitialCategory] = useState<TransactionCategory | undefined>(undefined);
  const [modalInitialSubcategory, setModalInitialSubcategory] = useState<TransactionSubcategory | undefined>(undefined);
  const [modalInitialPerson, setModalInitialPerson] = useState<string | undefined>(undefined);
  const [modalInitialAmount, setModalInitialAmount] = useState<string | undefined>(undefined);
  const [modalInitialTitle, setModalInitialTitle] = useState<string | undefined>(undefined);
  const [modalInitialDate, setModalInitialDate] = useState<string | undefined>(undefined);
  const [txInitialCategory, setTxInitialCategory] = useState<string>('all');
  const [txInitialSubcategory, setTxInitialSubcategory] = useState<string>('all');

  // Help & Feedback state (single page at help_support)
  const [helpInitialTab, setHelpInitialTab] = useState<'help' | 'feedback' | 'complaint' | 'dpdp'>('feedback');

  const { setScannerActive, setModalsSuppressed } = usePwaInstall();

  const isAnyInteractiveModalOpen = isAddModalOpen || isAddUdharModalOpen || isScanQrOpen || isNotifPrefsOpen;

  useEffect(() => {
    setModalsSuppressed(isAnyInteractiveModalOpen);
  }, [isAnyInteractiveModalOpen, setModalsSuppressed]);

  useEffect(() => {
    setScannerActive(isScanQrOpen);
  }, [isScanQrOpen, setScannerActive]);

  const handleOpenHelpModal = (tab: 'help' | 'feedback' | 'complaint' | 'dpdp' = 'help') => {
    setHelpInitialTab(tab);
    setCurrentTab('help_support');
  };

  const handleOpenAddModal = (
    category?: TransactionCategory,
    subcategory?: TransactionSubcategory,
    personName?: string,
    amount?: number | string,
    title?: string,
    dateKey?: string
  ) => {
    if (category === 'people') {
      setAddUdharInitialPerson(personName);
      setIsAddUdharModalOpen(true);
      return;
    }
    const validCategories: TransactionCategory[] = ['home', 'room', 'food', 'other', 'people', 'received'];
    setModalInitialCategory(category && validCategories.includes(category) ? category : undefined);
    setModalInitialSubcategory(subcategory);
    setModalInitialPerson(personName);
    setModalInitialAmount(amount !== undefined ? String(amount) : undefined);
    setModalInitialTitle(title);
    setModalInitialDate(dateKey);
    setIsAddModalOpen(true);
  };

  const handleAskAiPrompt = (prompt: string) => {
    setAiInitialPrompt(prompt);
    setCurrentTab('ai_assistant');
  };

  // Automatically navigate away from /login or /register to /dashboard once user is authenticated
  useEffect(() => {
    if (user && (routeLocation.pathname === '/login' || routeLocation.pathname === '/register' || routeLocation.hash === '#register')) {
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', '/');
      }
      setRouteLocation({ pathname: '/', hash: '' });
      setCurrentTabState('dashboard');
    }
  }, [user, routeLocation.pathname, routeLocation.hash]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center">
        <img
          src={appBranding?.logoUrl || '/logo.jpg'}
          alt={`${appBranding?.appName || 'My Money Manager'} ${appBranding?.subTitle || 'by HackifyPro'}`}
          onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/logo.jpg'; }}
          className="w-16 h-16 rounded-2xl object-cover shadow-2xl shadow-emerald-500/20 border-2 border-emerald-500/40 animate-pulse"
        />
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-4 tracking-wider uppercase">
          Loading {appBranding?.appName || 'My Money Manager'}...
        </p>
      </div>
    );
  }

  const portalScope = getPortalScopeFromLocation(
    routeLocation.pathname,
    routeLocation.hash,
    typeof window !== 'undefined' ? window.location.hostname : ''
  );
  const isStaffRoute = portalScope === 'mystaff';
  const isAdminRoute = portalScope === 'myadmin';

  // Separate Staff Portal Route (/mystaff) — Strictly isolated Staff Login & Operations Desk
  if (isStaffRoute) {
    const isStaffMaintenanceBlocked = Boolean(
      maintenanceSettings.isEnabled &&
        maintenanceSettings.allowStaffAccessDuringMaintenance === false &&
        !isAdmin
    );
    if (isStaffMaintenanceBlocked) {
      return (
        <MaintenanceScreen
          settings={maintenanceSettings}
          onRefresh={refreshSiteConfig}
        />
      );
    }

    if (!user) {
      return (
        <>
          <StaffLoginPage
            onReturnHome={() => navigatePortalPath('/')}
            onGoToAdmin={() => navigatePortalPath('/myadmin')}
          />
          <AppDownloadPopup
            portalScope="mystaff"
            isAdminRoute={false}
            isMaintenanceBlocked={false}
            hasBottomMobileNav={false}
          />
        </>
      );
    }

    return (
      <>
        <Suspense fallback={<SectionFallback />}>
          <StaffDashboard
            onExit={() => navigatePortalPath('/')}
            onGoToAdmin={() => navigatePortalPath('/myadmin')}
          />
        </Suspense>
        <AppDownloadPopup
          portalScope="mystaff"
          isAdminRoute={false}
          isMaintenanceBlocked={false}
          hasBottomMobileNav={false}
        />
      </>
    );
  }

  // Separate Admin Portal Route (/myadmin) — Always accessible even during Maintenance Mode
  if (isAdminRoute) {
    if (!user) {
      return (
        <>
          <AdminLoginPage
            onReturnHome={() => navigatePortalPath('/')}
            onGoToStaff={() => navigatePortalPath('/mystaff')}
          />
          <AppDownloadPopup
            portalScope="myadmin"
            isAdminRoute={false}
            isMaintenanceBlocked={false}
            hasBottomMobileNav={false}
          />
        </>
      );
    }

    // Role Enforcement: Non-admin users (including Staff) cannot enter Admin Control Center
    if (user && !isAdmin) {
      return (
        <Suspense fallback={<SectionFallback />}>
          <AdminDashboard
            onExit={() => navigatePortalPath('/')}
            onGoToStaff={() => navigatePortalPath('/mystaff')}
          />
        </Suspense>
      );
    }

    return (
      <>
        <Suspense fallback={<SectionFallback />}>
          <AdminDashboard
            onExit={() => navigatePortalPath('/')}
            onGoToStaff={() => navigatePortalPath('/mystaff')}
          />
        </Suspense>
        <AppDownloadPopup
          portalScope="myadmin"
          isAdminRoute={false}
          isMaintenanceBlocked={false}
          hasBottomMobileNav={false}
        />
      </>
    );
  }

  // MAINTENANCE MODE ENFORCEMENT (Homepage, Normal Login/Register, and User Dashboard):
  // If maintenance mode is enabled and current visitor is NOT an authenticated admin, block access.
  const isMaintenanceBlocked = Boolean(maintenanceSettings.isEnabled && !isAdmin);
  if (isMaintenanceBlocked) {
    return (
      <MaintenanceScreen
        settings={maintenanceSettings}
        onRefresh={refreshSiteConfig}
      />
    );
  }

  // If user is in password recovery mode, visiting auth routes, or not logged in, render AuthPage + AppDownloadPopup
  const isAuthRoute =
    isRecoveryMode ||
    routeLocation.pathname === '/reset-password' ||
    routeLocation.hash.includes('reset-password') ||
    (!user && (
      routeLocation.pathname === '/forgot-password' ||
      routeLocation.pathname === '/login' ||
      routeLocation.pathname === '/register' ||
      routeLocation.hash === '#forgot-password' ||
      routeLocation.hash === '#register'
    ));

  if (!user || isAuthRoute) {
    return (
      <>
        <AuthPage />
        <AppDownloadPopup
          isAdminRoute={false}
          isMaintenanceBlocked={false}
          hasBottomMobileNav={false}
        />
      </>
    );
  }

  // Mandatory first-time Complete Your Profile gate after Google, Passkey, or Email registration
  if (user && !isAdmin && (user.profileCompleted === false || user.profile_completed === false)) {
    return (
      <Suspense fallback={<SectionFallback />}>
        <CompleteProfileScreen />
      </Suspense>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* State 11 & 12: Offline and Reconnecting Status Banner */}
      <OfflineBanner />

      {/* Admin Maintenance Mode Banner */}
      {maintenanceSettings.isEnabled && isAdmin && (
        <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-black flex items-center justify-between border-b border-amber-600 shadow-sm animate-pulse z-50">
          <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              MAINTENANCE MODE ACTIVE: Normal users are blocked. You are browsing with Admin Bypass privilege.
            </span>
            <button
              onClick={() => setCurrentTab('admin')}
              className="ml-auto underline font-bold cursor-pointer hover:text-black shrink-0"
            >
              Admin Control Panel &rarr;
            </button>
          </div>
        </div>
      )}

      {currentTab === 'admin' && isAdmin ? (
        <Suspense fallback={<SectionFallback />}>
          <AdminDashboard
            onExit={() => {
              if (typeof window !== 'undefined') {
                const curPath = window.location.pathname.replace(/\/+$/, '') || '/';
                if (curPath === '/admin' || curPath === '/myadmin') {
                  window.history.pushState(null, '', '/');
                }
                if (window.location.hash.startsWith('#admin') || window.location.hash.startsWith('#myadmin')) {
                  window.location.hash = '';
                }
              }
              setCurrentTab('dashboard');
            }}
            onGoToStaff={() => navigatePortalPath('/mystaff')}
          />
        </Suspense>
      ) : (
        <PullToRefresh onRefresh={refreshTransactions} className="flex flex-1 min-h-0 flex-col">
          <div className="flex flex-1 min-h-0">
            {/* Sidebar for Desktop */}
            <Sidebar
              currentTab={currentTab}
              onSelectTab={setCurrentTab}
              onOpenAddModal={() => handleOpenAddModal()}
              onOpenHelpModal={handleOpenHelpModal}
            />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 min-h-screen">
              {/* Top Navbar */}
              <Navbar
                currentTab={currentTab}
                onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
                onOpenAddModal={() => handleOpenAddModal()}
                onSelectTab={setCurrentTab}
                onOpenHelpModal={handleOpenHelpModal}
                onOpenNotificationCenter={() => setCurrentTab('notifications')}
                onOpenNotificationPreferences={() => setIsNotifPrefsOpen(true)}
              />

              {/* Dynamic Section Views */}
              <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-[calc(6rem+env(safe-area-inset-bottom,0px))] lg:pb-8">
                <Suspense fallback={<SectionFallback />}>
                  {currentTab === 'dashboard' && (
                    <DashboardView
                      onNavigate={setCurrentTab}
                      onOpenAddModal={handleOpenAddModal}
                      onOpenFilteredTransactions={(category, subcategory) => {
                        setTxInitialCategory(category || 'all');
                        setTxInitialSubcategory(subcategory || 'all');
                        setCurrentTab('all_transactions');
                      }}
                      onOpenScanQr={() => setIsScanQrOpen(true)}
                      onAskAiPrompt={handleAskAiPrompt}
                    />
                  )}

                  {currentTab === 'ai_assistant' && (
                    !isAdmin && !siteConfig.featureVisibility.aiAssistantEnabled ? (
                      <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3 max-w-md mx-auto my-8">
                        <EyeOff className="w-8 h-8 text-slate-400 mx-auto" />
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">Section Temporarily Hidden</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          AI Financial Assistant is currently hidden by the administrator. Your saved data remains intact.
                        </p>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('dashboard')}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                        >
                          Return to Dashboard
                        </button>
                      </div>
                    ) : (
                      <AiAssistantSection
                        initialPrompt={aiInitialPrompt}
                        onClearInitialPrompt={() => setAiInitialPrompt(null)}
                      />
                    )
                  )}

                  {currentTab === 'expense_calendar' && (
                    <ExpenseCalendarSection
                      onOpenAddModalForDate={(dateKey) =>
                        handleOpenAddModal('other', undefined, undefined, undefined, undefined, dateKey)
                      }
                    />
                  )}

                  {(currentTab === 'smart_alerts' || currentTab === 'notifications') && (
                    <NotificationsSection
                      initialFilter={currentTab === 'smart_alerts' ? 'alerts' : 'all'}
                      onNavigate={setCurrentTab}
                      onOpenPreferences={() => setIsNotifPrefsOpen(true)}
                    />
                  )}

                  {currentTab === 'receipt_scanner' && (
                    !isAdmin && !siteConfig.featureVisibility.receiptScannerEnabled ? (
                      <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3 max-w-md mx-auto my-8">
                        <EyeOff className="w-8 h-8 text-slate-400 mx-auto" />
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">Section Temporarily Hidden</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          AI Receipt Scanner is currently hidden by the administrator. Your saved data remains intact.
                        </p>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('dashboard')}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                        >
                          Return to Dashboard
                        </button>
                      </div>
                    ) : (
                      <ReceiptScannerSection />
                    )
                  )}

                  {currentTab === 'net_worth' && (
                    <NetWorthSection />
                  )}
                  {currentTab === 'safe_to_spend' && (
                    <SafeToSpendSection onSelectTab={setCurrentTab} />
                  )}

                  {currentTab === 'upi_qr' && (
                    !isAdmin && !siteConfig.featureVisibility.upiQrEnabled ? (
                      <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3 max-w-md mx-auto my-8">
                        <EyeOff className="w-8 h-8 text-slate-400 mx-auto" />
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">Section Temporarily Hidden</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          UPI QR tools are currently hidden by the administrator. Your saved data remains intact.
                        </p>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('dashboard')}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                        >
                          Return to Dashboard
                        </button>
                      </div>
                    ) : (
                      <UpiQrGeneratorSection onNavigate={setCurrentTab} />
                    )
                  )}

                  {currentTab === 'home' && (
                    <HomeSection onOpenAddModal={handleOpenAddModal} />
                  )}

                  {currentTab === 'room' && (
                    <RoomSection onOpenAddModal={handleOpenAddModal} />
                  )}

                  {currentTab === 'food' && (
                    <FoodSection onOpenAddModal={handleOpenAddModal} />
                  )}

                  {currentTab === 'other' && (
                    <OtherSection onOpenAddModal={handleOpenAddModal} />
                  )}

                  {currentTab === 'people' && (
                    !isAdmin && !siteConfig.featureVisibility.udharEnabled ? (
                      <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3 max-w-md mx-auto my-8">
                        <EyeOff className="w-8 h-8 text-slate-400 mx-auto" />
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">Section Temporarily Hidden</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          People &amp; Udhar ledger view is currently hidden by the administrator. Your records remain intact.
                        </p>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('dashboard')}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                        >
                          Return to Dashboard
                        </button>
                      </div>
                    ) : (
                      <PeopleSection onOpenAddModal={handleOpenAddModal} />
                    )
                  )}

                  {currentTab === 'calculator' && (
                    <CalculatorSection onOpenAddModal={handleOpenAddModal} />
                  )}

                  {currentTab === 'reports' && (
                    !isAdmin && !siteConfig.featureVisibility.reportsEnabled ? (
                      <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3 max-w-md mx-auto my-8">
                        <EyeOff className="w-8 h-8 text-slate-400 mx-auto" />
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">Section Temporarily Hidden</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Financial Reports view is currently hidden by the administrator. Your saved data remains intact.
                        </p>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('dashboard')}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                        >
                          Return to Dashboard
                        </button>
                      </div>
                    ) : (
                      <ReportsSection />
                    )
                  )}

                  {currentTab === 'all_transactions' && (
                    <AllTransactionsSection
                      onOpenAddModal={handleOpenAddModal}
                      initialCategoryFilter={txInitialCategory}
                      initialSubcategoryFilter={txInitialSubcategory}
                    />
                  )}

                  {currentTab === 'recycle_bin' && (
                    <RecycleBinSection />
                  )}

                  {currentTab === 'budget' && (
                    <BudgetSection />
                  )}

                  {currentTab === 'savings_goals' && (
                    <SavingsGoalsSection />
                  )}

                  {currentTab === 'recurring_bills' && (
                    <RecurringBillsSection />
                  )}

                  {/* Custom Dynamic Sections */}
                  {dynamicSections.some((s) => s.id === currentTab && !['home', 'room', 'food', 'other', 'people'].includes(s.id)) && (
                    <DynamicCustomSection
                      section={dynamicSections.find((s) => s.id === currentTab)!}
                      onOpenAddModal={handleOpenAddModal}
                    />
                  )}

                  {currentTab === 'help_support' && (
                    !isAdmin && !siteConfig.featureVisibility.supportDeskEnabled ? (
                      <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3 max-w-md mx-auto my-8">
                        <EyeOff className="w-8 h-8 text-slate-400 mx-auto" />
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">Section Temporarily Hidden</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Help &amp; Support desk is currently hidden by the administrator.
                        </p>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('dashboard')}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                        >
                          Return to Dashboard
                        </button>
                      </div>
                    ) : (
                      <HelpSupportSection
                        key={`help-${helpInitialTab}`}
                        initialTab={helpInitialTab}
                      />
                    )
                  )}

                  {currentTab === 'profile' && (
                    <UserProfileSection
                      onNavigateToDeletion={() => {
                        setSettingsInitialTab('deletion');
                        setCurrentTab('settings');
                      }}
                      onNavigateToSettings={() => {
                        setSettingsInitialTab('appearance');
                        setCurrentTab('settings');
                      }}
                    />
                  )}

                  {currentTab === 'settings' && (
                    <SettingsSection
                      initialTab={settingsInitialTab}
                      initialLegalPolicy={initialLegalPolicy}
                      onNavigateToProfile={() => setCurrentTab('profile')}
                    />
                  )}

                  {currentTab === 'legal' && (
                    !isAdmin && !siteConfig.featureVisibility.legalCenterEnabled ? (
                      <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3 max-w-md mx-auto my-8">
                        <EyeOff className="w-8 h-8 text-slate-400 mx-auto" />
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">Section Temporarily Hidden</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Legal &amp; Policy Center is currently hidden from navigation by the administrator.
                        </p>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('dashboard')}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                        >
                          Return to Dashboard
                        </button>
                      </div>
                    ) : (
                      <LegalCenterSection
                        initialPolicyId={initialLegalPolicy}
                        onNavigateToAccountDeletion={() => {
                          setSettingsInitialTab('deletion');
                          setCurrentTab('settings');
                        }}
                      />
                    )
                  )}
                </Suspense>
              </main>
            </div>

            {/* Mobile Drawer & Bottom Navigation */}
            <MobileNav
              isOpen={isMobileMenuOpen}
              onClose={() => setIsMobileMenuOpen(false)}
              currentTab={currentTab}
              onSelectTab={setCurrentTab}
              onOpenAddModal={() => handleOpenAddModal()}
              onOpenHelpModal={handleOpenHelpModal}
            />
          </div>
        </PullToRefresh>
      )}

        {/* Universal Add Transaction Modal */}
        <AddTransactionModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          initialCategory={modalInitialCategory}
          initialSubcategory={modalInitialSubcategory}
          initialPersonName={modalInitialPerson}
          initialAmount={modalInitialAmount}
          initialTitle={modalInitialTitle}
          initialDate={modalInitialDate}
          onOpenReceiptScanner={() => setCurrentTab('receipt_scanner')}
        />

        <Suspense fallback={null}>
          {/* Dedicated Add Udhar Modal (when triggered via People / quick-action) */}
          <AddUdharModal
            isOpen={isAddUdharModalOpen}
            onClose={() => {
              setIsAddUdharModalOpen(false);
              setAddUdharInitialPerson(undefined);
            }}
            initialPersonName={addUdharInitialPerson}
            onOpenScanner={() => {
              setIsAddUdharModalOpen(false);
              setIsScanQrOpen(true);
            }}
            onSuccess={() => {
              refreshTransactions();
            }}
          />

          {/* Scan QR Modal (Udhar pairing) */}
          <ScanQrModal
            isOpen={isScanQrOpen}
            initialPairCode={initialPairCode}
            onClose={() => {
              setIsScanQrOpen(false);
              setInitialPairCode(null);
            }}
            onConnected={(person) => {
              setIsScanQrOpen(false);
              setInitialPairCode(null);
              setCurrentTab('people');
              toast.success('Connected!', `${person.name} is now connected for 2-way Shared Udhar.`);
            }}
            onRecordExpense={(draft) => {
              setIsScanQrOpen(false);
              setInitialPairCode(null);
              handleOpenAddModal(
                'other',
                'miscellaneous',
                undefined,
                draft.amount ? Number(draft.amount) : undefined,
                draft.title
              );
            }}
          />

          {/* Privacy Choices & Consent Center Modal Gate */}
          <DpdpConsentBanner onOpenPrivacyModal={() => handleOpenHelpModal('dpdp')} />
          <DpdpConsentModal
            onOpenPrivacyPolicy={() => {
              setInitialLegalPolicy('privacy_policy');
              setCurrentTab('legal');
            }}
          />

          {/* Notification Preferences Modal */}
          {isNotifPrefsOpen && (
            <NotificationPreferencesModal
              isOpen={isNotifPrefsOpen}
              onClose={() => setIsNotifPrefsOpen(false)}
            />
          )}
        </Suspense>

        {/* Automatic UPI Expense Detection Instant Categorization Popup & Onboarding */}
        <InstantExpensePopupModal />
        <UpiDetectionOnboardingModal />

        {/* Bottom-Right App Download Popup (never shown on Maintenance views) */}
        <AppDownloadPopup
          portalScope={portalScope}
          isAdminRoute={isAdminRoute || currentTab === 'admin'}
          isMaintenanceBlocked={isMaintenanceBlocked}
          hasBottomMobileNav={Boolean(user && currentTab !== 'admin')}
        />
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <PermissionProvider>
            <ExpenseProvider>
              <UpiDetectionProvider>
                <PwaInstallProvider>
                  <NotificationProvider>
                    <AppErrorBoundary>
                      <MainContent />
                    </AppErrorBoundary>
                    <PwaInstallBanner />
                    <PwaInstallModal />
                  </NotificationProvider>
                </PwaInstallProvider>
              </UpiDetectionProvider>
            </ExpenseProvider>
          </PermissionProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
