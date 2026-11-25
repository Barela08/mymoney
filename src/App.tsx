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
import { TransactionCategory, TransactionSubcategory } from './types';
import { AlertTriangle } from 'lucide-react';
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
const LegalCenterSection = lazy(() => import('./components/legal/LegalCenterSection').then(m => ({ default: m.LegalCenterSection })));
const CalculatorSection = lazy(() => import('./components/calculator/CalculatorSection').then(m => ({ default: m.CalculatorSection })));
const ReportsSection = lazy(() => import('./components/reports/ReportsSection').then(m => ({ default: m.ReportsSection })));
const RecycleBinSection = lazy(() => import('./components/recycle-bin/RecycleBinSection').then(m => ({ default: m.RecycleBinSection })));
const DynamicCustomSection = lazy(() => import('./components/dynamic/DynamicCustomSection').then(m => ({ default: m.DynamicCustomSection })));
const SettingsSection = lazy(() => import('./components/settings/SettingsSection').then(m => ({ default: m.SettingsSection })));
const HelpSupportSection = lazy(() => import('./components/support/HelpSupportSection').then(m => ({ default: m.HelpSupportSection })));
const BudgetSection = lazy(() => import('./components/budget/BudgetSection').then(m => ({ default: m.BudgetSection })));
const SavingsGoalsSection = lazy(() => import('./components/savings/SavingsGoalsSection').then(m => ({ default: m.SavingsGoalsSection })));
const RecurringBillsSection = lazy(() => import('./components/bills/RecurringBillsSection').then(m => ({ default: m.RecurringBillsSection })));
const NotificationsSection = lazy(() => import('./components/notifications/NotificationsSection').then(m => ({ default: m.NotificationsSection })));
const AiAssistantSection = lazy(() => import('./components/ai/AiAssistantSection').then(m => ({ default: m.AiAssistantSection })));
const ExpenseCalendarSection = lazy(() => import('./components/calendar/ExpenseCalendarSection').then(m => ({ default: m.ExpenseCalendarSection })));
const SmartAlertsSection = lazy(() => import('./components/alerts/SmartAlertsSection').then(m => ({ default: m.SmartAlertsSection })));
const ReceiptScannerSection = lazy(() => import('./components/receipts/ReceiptScannerSection').then(m => ({ default: m.ReceiptScannerSection })));
const NetWorthSection = lazy(() => import('./components/net-worth/NetWorthSection').then(m => ({ default: m.NetWorthSection })));
const SafeToSpendSection = lazy(() => import('./components/safe-to-spend/SafeToSpendSection').then(m => ({ default: m.SafeToSpendSection })));
const NotificationPreferencesModal = lazy(() => import('./components/notifications/NotificationPreferencesModal').then(m => ({ default: m.NotificationPreferencesModal })));

const PATH_TO_TAB: Record<string, NavTab> = {
  '/admin': 'admin',
  '/ai-assistant': 'ai_assistant',
  '/expense-calendar': 'expense_calendar',
  '/smart-alerts': 'smart_alerts',
  '/receipt-scanner': 'receipt_scanner',
  '/net-worth': 'net_worth',
  '/safe-to-spend': 'safe_to_spend',
};

const TAB_TO_PATH: Partial<Record<NavTab, string>> = {
  dashboard: '/',
  admin: '/admin',
  ai_assistant: '/ai-assistant',
  expense_calendar: '/expense-calendar',
  smart_alerts: '/smart-alerts',
  receipt_scanner: '/receipt-scanner',
  net_worth: '/net-worth',
  safe_to_spend: '/safe-to-spend',
};

const SectionFallback: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-20 min-h-[300px] space-y-3 animate-pulse">
    <div className="w-9 h-9 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading View...</span>
  </div>
);

const MainContent: React.FC = () => {
  const { user, isAdmin, isLoading, isRecoveryMode } = useAuth();
  const { maintenanceSettings, dynamicSections, refreshTransactions, appBranding } = useExpense();
  const toast = useToast();

  const [currentTab, setCurrentTabState] = useState<NavTab>(() => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname.replace(/\/+$/, '') || '/';
      const hash = window.location.hash;
      if (p === '/admin' || hash === '#admin' || hash.startsWith('#admin=')) {
        return 'admin';
      }
      if (hash === '#privacy-policy') return 'legal';
      if (
        hash === '#delete-account' ||
        hash === '#auto-detection' ||
        hash === '#privacy' ||
        hash === '#manage-consent'
      ) {
        return 'settings';
      }
      if (hash.includes('legal=')) return 'legal';
      return PATH_TO_TAB[p] || 'dashboard';
    }
    return 'dashboard';
  });
  const [aiInitialPrompt, setAiInitialPrompt] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const setCurrentTab = (tab: NavTab) => {
    setCurrentTabState(tab);
    const targetPath = TAB_TO_PATH[tab];
    if (targetPath && window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    } else if (!targetPath && PATH_TO_TAB[window.location.pathname]) {
      window.history.pushState(null, '', '/');
    }
  };

  useEffect(() => {
    const onPopState = () => {
      const p = window.location.pathname.replace(/\/+$/, '') || '/';
      setCurrentTabState(PATH_TO_TAB[p] || 'dashboard');
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
      const path = window.location.pathname;

      if (path === '/admin' || hash === '#admin' || hash.startsWith('#admin=')) {
        setCurrentTab('admin');
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
      } else if (
        hash === '#delete-account' ||
        hash === '#auto-detection' ||
        hash === '#privacy' ||
        hash === '#manage-consent'
      ) {
        setCurrentTab('settings');
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [toast]);

  // Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalInitialCategory, setModalInitialCategory] = useState<TransactionCategory>('home');
  const [modalInitialSubcategory, setModalInitialSubcategory] = useState<TransactionSubcategory | undefined>(undefined);
  const [modalInitialPerson, setModalInitialPerson] = useState<string | undefined>(undefined);
  const [modalInitialAmount, setModalInitialAmount] = useState<string | undefined>(undefined);
  const [modalInitialTitle, setModalInitialTitle] = useState<string | undefined>(undefined);
  const [modalInitialDate, setModalInitialDate] = useState<string | undefined>(undefined);

  // Help & Feedback state (single page at help_support)
  const [helpInitialTab, setHelpInitialTab] = useState<'help' | 'feedback' | 'complaint' | 'dpdp'>('feedback');

  const { setScannerActive, setModalsSuppressed } = usePwaInstall();

  const isAnyInteractiveModalOpen = isAddModalOpen || isScanQrOpen || isNotifPrefsOpen;

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
    category: TransactionCategory = 'home',
    subcategory?: TransactionSubcategory,
    personName?: string,
    amount?: number | string,
    title?: string,
    dateKey?: string
  ) => {
    const validCategories: TransactionCategory[] = ['home', 'room', 'food', 'other', 'people', 'received'];
    setModalInitialCategory(validCategories.includes(category) ? category : 'other');
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

  // If user is in password recovery mode, visiting auth routes, or not logged in, render AuthPage
  const isAuthRoute =
    typeof window !== 'undefined' &&
    (window.location.pathname === '/forgot-password' ||
      window.location.pathname === '/reset-password' ||
      window.location.pathname === '/login' ||
      window.location.hash.includes('reset-password') ||
      window.location.hash === '#forgot-password');

  if (isRecoveryMode || isAuthRoute || !user) {
    return <AuthPage />;
  }

  // MAINTENANCE MODE ENFORCEMENT:
  // If maintenance mode is enabled and user is NOT an admin, block access with MaintenanceScreen
  if (maintenanceSettings.isEnabled && !isAdmin) {
    return (
      <MaintenanceScreen
        settings={maintenanceSettings}
        onRefresh={refreshTransactions}
      />
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

      {currentTab === 'admin' ? (
        <Suspense fallback={<SectionFallback />}>
          <AdminDashboard
            onExit={() => {
              if (typeof window !== 'undefined') {
                if (window.location.pathname === '/admin') {
                  window.history.pushState(null, '', '/');
                }
                if (window.location.hash.startsWith('#admin')) {
                  window.location.hash = '';
                }
              }
              setCurrentTab('dashboard');
            }}
          />
        </Suspense>
      ) : (
        <PullToRefresh onRefresh={refreshTransactions} className="flex flex-1 min-h-0 flex-col">
          <div className="flex flex-1 min-h-0">
            {/* Sidebar for Desktop */}
            <Sidebar
              currentTab={currentTab}
              onSelectTab={setCurrentTab}
              onOpenAddModal={() => handleOpenAddModal(currentTab === 'all_transactions' ? 'home' : (currentTab as any))}
              onOpenHelpModal={handleOpenHelpModal}
            />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 min-h-screen">
              {/* Top Navbar */}
              <Navbar
                currentTab={currentTab}
                onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
                onOpenAddModal={() => handleOpenAddModal(currentTab === 'all_transactions' ? 'home' : (currentTab as any))}
                onSelectTab={setCurrentTab}
                onOpenHelpModal={handleOpenHelpModal}
                onOpenNotificationCenter={() => setCurrentTab('notifications')}
                onOpenNotificationPreferences={() => setIsNotifPrefsOpen(true)}
              />

              {/* Dynamic Section Views */}
              <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] lg:pb-8">
                <Suspense fallback={<SectionFallback />}>
                  {currentTab === 'dashboard' && (
                    <DashboardView
                      onNavigate={setCurrentTab}
                      onOpenAddModal={handleOpenAddModal}
                      onOpenScanQr={() => setIsScanQrOpen(true)}
                      onAskAiPrompt={handleAskAiPrompt}
                    />
                  )}

                  {currentTab === 'ai_assistant' && (
                    <AiAssistantSection
                      initialPrompt={aiInitialPrompt}
                      onClearInitialPrompt={() => setAiInitialPrompt(null)}
                    />
                  )}

                  {currentTab === 'expense_calendar' && (
                    <ExpenseCalendarSection
                      onOpenAddModalForDate={(dateKey) =>
                        handleOpenAddModal('other', undefined, undefined, undefined, undefined, dateKey)
                      }
                    />
                  )}

                  {currentTab === 'smart_alerts' && (
                    <SmartAlertsSection onSelectTab={setCurrentTab} />
                  )}

                  {currentTab === 'receipt_scanner' && (
                    <ReceiptScannerSection />
                  )}

                  {currentTab === 'net_worth' && (
                    <NetWorthSection />
                  )}

                  {currentTab === 'safe_to_spend' && (
                    <SafeToSpendSection onSelectTab={setCurrentTab} />
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
                    <PeopleSection onOpenAddModal={handleOpenAddModal} />
                  )}

                  {currentTab === 'calculator' && (
                    <CalculatorSection onOpenAddModal={handleOpenAddModal} />
                  )}

                  {currentTab === 'reports' && (
                    <ReportsSection />
                  )}

                  {currentTab === 'all_transactions' && (
                    <AllTransactionsSection onOpenAddModal={handleOpenAddModal} />
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

                  {currentTab === 'notifications' && (
                    <NotificationsSection
                      onNavigate={setCurrentTab}
                      onOpenPreferences={() => setIsNotifPrefsOpen(true)}
                    />
                  )}

                  {/* Custom Dynamic Sections */}
                  {dynamicSections.some((s) => s.id === currentTab && !['home', 'room', 'food', 'other', 'people'].includes(s.id)) && (
                    <DynamicCustomSection
                      section={dynamicSections.find((s) => s.id === currentTab)!}
                      onOpenAddModal={handleOpenAddModal}
                    />
                  )}

                  {currentTab === 'help_support' && (
                    <HelpSupportSection
                      key={`help-${helpInitialTab}`}
                      initialTab={helpInitialTab}
                    />
                  )}

                  {currentTab === 'settings' && (
                    <SettingsSection
                      initialTab="profile"
                      initialLegalPolicy={initialLegalPolicy}
                    />
                  )}

                  {currentTab === 'legal' && (
                    <LegalCenterSection
                      initialPolicyId={initialLegalPolicy}
                      onNavigateToAccountDeletion={() => setCurrentTab('settings')}
                    />
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
              onOpenAddModal={() => handleOpenAddModal(currentTab === 'all_transactions' ? 'home' : (currentTab as any))}
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
