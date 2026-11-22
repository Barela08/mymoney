import React, { useState, useEffect } from 'react';
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
import { CalculatorSection } from './components/calculator/CalculatorSection';
import { ReportsSection } from './components/reports/ReportsSection';
import { AllTransactionsSection } from './components/all-transactions/AllTransactionsSection';
import { RecycleBinSection } from './components/recycle-bin/RecycleBinSection';
import { DynamicCustomSection } from './components/dynamic/DynamicCustomSection';
import { MaintenanceScreen } from './components/maintenance/MaintenanceScreen';
import { OfflineBanner } from './components/common/OfflineBanner';
import { SettingsSection } from './components/settings/SettingsSection';
import { LegalCenterSection } from './components/legal/LegalCenterSection';
import { MyUdharQrModal } from './components/people/MyUdharQrModal';
import { ScanQrModal } from './components/people/ScanQrModal';
import { udharDeletionApi } from './lib/udharDeletionApi';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { AddTransactionModal } from './components/modals/AddTransactionModal';
import { AuthPage } from './components/auth/AuthPage';
import { TransactionCategory, TransactionSubcategory } from './types';
import { AlertTriangle } from 'lucide-react';
import { PwaInstallProvider } from './context/PwaInstallContext';
import { PwaInstallBanner } from './components/common/PwaInstallBanner';
import { PwaInstallModal } from './components/common/PwaInstallModal';
import { HelpSupportModal } from './components/support/HelpSupportModal';
import { HelpSupportSection } from './components/support/HelpSupportSection';
import { DpdpConsentBanner } from './components/common/DpdpConsentBanner';
import { DpdpConsentModal } from './components/common/DpdpConsentModal';
import { StartupPermissionsModal } from './components/common/StartupPermissionsModal';
import { PullToRefresh } from './components/common/PullToRefresh';
import { NotificationProvider } from './context/NotificationContext';
import { NotificationCenterModal } from './components/notifications/NotificationCenterModal';
import { NotificationPreferencesModal } from './components/notifications/NotificationPreferencesModal';
import { PushPermissionBanner } from './components/notifications/PushPermissionBanner';

const MainContent: React.FC = () => {
  const { user, isAdmin, isLoading, isRecoveryMode } = useAuth();
  const { maintenanceSettings, dynamicSections, refreshTransactions } = useExpense();
  const toast = useToast();

  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Global QR Modals State
  const [isMyQrOpen, setIsMyQrOpen] = useState(false);
  const [isScanQrOpen, setIsScanQrOpen] = useState(false);
  const [initialLegalPolicy, setInitialLegalPolicy] = useState('privacy_policy');

  // Notification Center & Preferences Modals State
  const [isNotifCenterOpen, setIsNotifCenterOpen] = useState(false);
  const [isNotifPrefsOpen, setIsNotifPrefsOpen] = useState(false);

  // Hash routing listener (for deletion email cancellation links, direct legal links, etc.)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
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
      } else if (hash === '#privacy-policy') {
        setCurrentTab('privacy_policy');
      } else if (hash === '#delete-account') {
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

  // Help & Feedback Modal State
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [helpModalInitialTab, setHelpModalInitialTab] = useState<'help' | 'feedback' | 'complaint' | 'dpdp'>('help');

  const handleOpenHelpModal = (tab: 'help' | 'feedback' | 'complaint' | 'dpdp' = 'help') => {
    setHelpModalInitialTab(tab);
    setIsHelpModalOpen(true);
  };

  const handleOpenAddModal = (
    category: TransactionCategory = 'home',
    subcategory?: TransactionSubcategory,
    personName?: string,
    amount?: number | string,
    title?: string
  ) => {
    setModalInitialCategory(category);
    setModalInitialSubcategory(subcategory);
    setModalInitialPerson(personName);
    setModalInitialAmount(amount !== undefined ? String(amount) : undefined);
    setModalInitialTitle(title);
    setIsAddModalOpen(true);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center">
        <img
          src="/logo.jpg"
          alt="My Money Manager by HackifyPro"
          className="w-16 h-16 rounded-2xl object-cover shadow-2xl shadow-emerald-500/20 border-2 border-emerald-500/40 animate-pulse"
        />
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-4 tracking-wider uppercase">
          Loading My Money Manager...
        </p>
      </div>
    );
  }

  // If user is in password recovery mode or not logged in, render AuthPage
  if (isRecoveryMode || !user) {
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

      {/* Push Notification Opt-in Value Proposition Banner */}
      <PushPermissionBanner />

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
        <AdminDashboard onExit={() => setCurrentTab('dashboard')} />
      ) : (
        <PullToRefresh onRefresh={refreshTransactions} className="flex flex-1 min-h-0 flex-col">
          <div className="flex flex-1 min-h-0">
            {/* Sidebar for Desktop */}
            <Sidebar
              currentTab={currentTab}
              onSelectTab={setCurrentTab}
              onOpenAddModal={() => handleOpenAddModal(currentTab === 'all_transactions' ? 'home' : (currentTab as any))}
              onOpenHelpModal={handleOpenHelpModal}
              onOpenMyQr={() => setIsMyQrOpen(true)}
              onOpenScanQr={() => setIsScanQrOpen(true)}
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
                onOpenNotificationCenter={() => setIsNotifCenterOpen(true)}
                onOpenNotificationPreferences={() => setIsNotifPrefsOpen(true)}
              />

              {/* Dynamic Section Views */}
              <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
                {currentTab === 'dashboard' && (
                  <DashboardView
                    onNavigate={setCurrentTab}
                    onOpenAddModal={handleOpenAddModal}
                  />
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

                {/* Custom Dynamic Sections */}
                {dynamicSections.some((s) => s.id === currentTab && !['home', 'room', 'food', 'other', 'people'].includes(s.id)) && (
                  <DynamicCustomSection
                    section={dynamicSections.find((s) => s.id === currentTab)!}
                    onOpenAddModal={handleOpenAddModal}
                  />
                )}

                {currentTab === 'help_support' && (
                  <HelpSupportSection />
                )}

                {currentTab === 'settings' && (
                  <SettingsSection
                    initialTab="profile"
                    initialLegalPolicy={initialLegalPolicy}
                  />
                )}

                {currentTab === 'privacy_policy' && (
                  <LegalCenterSection
                    initialPolicyId="privacy_policy"
                    onNavigateToAccountDeletion={() => setCurrentTab('settings')}
                  />
                )}

                {currentTab === 'legal' && (
                  <LegalCenterSection
                    initialPolicyId={initialLegalPolicy}
                    onNavigateToAccountDeletion={() => setCurrentTab('settings')}
                  />
                )}
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
              onOpenMyQr={() => setIsMyQrOpen(true)}
              onOpenScanQr={() => setIsScanQrOpen(true)}
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
        />

        {/* Help, Feedback & Complaint Support Modal */}
        <HelpSupportModal
          isOpen={isHelpModalOpen}
          onClose={() => setIsHelpModalOpen(false)}
          initialTab={helpModalInitialTab}
        />

        {/* My Udhar QR Code Modal */}
        <MyUdharQrModal
          isOpen={isMyQrOpen}
          onClose={() => setIsMyQrOpen(false)}
          onOpenScanner={() => {
            setIsMyQrOpen(false);
            setIsScanQrOpen(true);
          }}
        />

        {/* Scan QR Modal */}
        <ScanQrModal
          isOpen={isScanQrOpen}
          onClose={() => setIsScanQrOpen(false)}
          onConnected={(person) => {
            setIsScanQrOpen(false);
            handleOpenAddModal('people', undefined, person.name);
          }}
        />

        {/* DPDP Act 2023 Statutory Consent Banner & Modal Gate */}
        <DpdpConsentBanner onOpenPrivacyModal={() => handleOpenHelpModal('dpdp')} />
        <DpdpConsentModal onOpenPrivacyPolicy={() => handleOpenHelpModal('dpdp')} />

        {/* Startup Permissions Modal for Notification & Camera (for QR scanning) */}
        <StartupPermissionsModal />

        {/* Full Notification Center Modal */}
        <NotificationCenterModal
          isOpen={isNotifCenterOpen}
          onClose={() => setIsNotifCenterOpen(false)}
          onSelectTab={setCurrentTab}
          onOpenPreferences={() => {
            setIsNotifCenterOpen(false);
            setIsNotifPrefsOpen(true);
          }}
          onOpenHelpModal={handleOpenHelpModal}
        />

        {/* Notification Preferences Modal */}
        <NotificationPreferencesModal
          isOpen={isNotifPrefsOpen}
          onClose={() => setIsNotifPrefsOpen(false)}
        />
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <ExpenseProvider>
            <PwaInstallProvider>
              <NotificationProvider>
                <MainContent />
                <PwaInstallBanner />
                <PwaInstallModal />
              </NotificationProvider>
            </PwaInstallProvider>
          </ExpenseProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
