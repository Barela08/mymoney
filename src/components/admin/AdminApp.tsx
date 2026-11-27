import React, { useEffect } from 'react';
import { AlertTriangle, ArrowLeft, LogOut, ShieldCheck } from 'lucide-react';
import { ThemeProvider } from '../../context/ThemeContext';
import { ToastProvider } from '../../context/ToastContext';
import { AuthProvider, useAuth } from '../../context/AuthContext';
import { ExpenseProvider } from '../../context/ExpenseContext';
import { AdminPwaInstallProvider } from '../../context/AdminPwaInstallContext';
import { AdminLoginPage } from '../auth/AdminLoginPage';
import { AdminDashboard } from './AdminDashboard';
import { AdminInstallPopup } from './AdminInstallPopup';
import { ensureAdminServiceWorker, syncAdminPushIfGranted } from '../../lib/adminPushNotifications';
import { dispatchAdminRealtimeEvent, useAdminRealtime } from '../../lib/useAdminRealtime';
import { mapAdminNotificationTargetToSection } from './AdminAppNavigation';

function isAdminSubdomainHost(): boolean {
  if (typeof window === 'undefined') return false;
  return (window.location.hostname || '').toLowerCase().startsWith('admin.');
}

function resolveUserAppUrl(): string {
  if (typeof window === 'undefined') return 'https://mymoney.nileshbarela.site';
  const host = (window.location.hostname || '').toLowerCase();
  if (host.startsWith('admin.')) {
    if (host === 'admin.nileshbarela.site') {
      return 'https://mymoney.nileshbarela.site';
    }
    return `${window.location.protocol}//${window.location.host.replace(/^admin\./i, '')}/`;
  }
  return '/';
}

const AdminSplashScreen: React.FC = () => (
  <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 relative overflow-hidden">
    <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
    <div className="relative flex flex-col items-center text-center space-y-4">
      <div className="w-20 h-20 rounded-3xl bg-slate-900 border-2 border-emerald-500/40 shadow-2xl shadow-emerald-500/20 flex items-center justify-center p-1.5 animate-pulse">
        <img
          src="/admin-logo.png"
          alt="My Money Manager Admin"
          className="w-full h-full rounded-2xl object-cover"
        />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-black tracking-tight text-white">
          My Money Manager Admin
        </h1>
        <p className="text-xs font-semibold text-emerald-400 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>HackifyPro Operations & Security Console</span>
        </p>
      </div>
      <div className="w-40 h-1 bg-slate-800 rounded-full overflow-hidden mt-2">
        <div className="h-full w-1/2 bg-emerald-500 rounded-full animate-pulse" />
      </div>
    </div>
  </div>
);

const AdminAppShell: React.FC = () => {
  const { user, isAdmin, isLoading, logout } = useAuth();

  // Keep Supabase Realtime active while authenticated admin uses the console
  useAdminRealtime(Boolean(user && isAdmin));

  // Ensure standalone Admin manifest, document branding, and dedicated /admin-sw.js
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    document.title = 'My Money Manager Admin — HackifyPro';
    const manifestHref = isAdminSubdomainHost()
      ? '/admin-subdomain-manifest.json'
      : '/admin-manifest.json';

    const existingManifest = document.querySelector('link[rel="manifest"]');
    if (existingManifest) {
      if (existingManifest.getAttribute('href') !== manifestHref) {
        existingManifest.setAttribute('href', manifestHref);
      }
    } else {
      const link = document.createElement('link');
      link.rel = 'manifest';
      link.href = manifestHref;
      document.head.appendChild(link);
    }

    ensureAdminServiceWorker().catch(() => {});

    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'ADMIN_PUSH_RECEIVED') {
        dispatchAdminRealtimeEvent({ table: 'admin_notifications', eventType: 'INSERT', payload: data.payload });
      } else if (data.type === 'ADMIN_NOTIFICATION_NAVIGATE') {
        const target = mapAdminNotificationTargetToSection({
          url: data.url,
          category: data.category,
          eventType: data.eventType,
        });
        window.dispatchEvent(
          new CustomEvent('mymoney:admin-navigate', {
            detail: {
              section: target.section,
              recordId: data.recordId || target.recordId || null,
              notificationId: data.notificationId || null,
            },
          })
        );
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
    };
  }, []);

  // Silently re-sync push subscription if admin already granted permission on this device
  useEffect(() => {
    if (user && isAdmin) {
      syncAdminPushIfGranted().catch(() => {});
    }
  }, [user, isAdmin]);

  const handleOpenUserApp = () => {
    if (typeof window !== 'undefined') {
      window.location.href = resolveUserAppUrl();
    }
  };

  if (isLoading) {
    return <AdminSplashScreen />;
  }

  if (!user) {
    return (
      <>
        <AdminLoginPage onReturnHome={handleOpenUserApp} />
        <AdminInstallPopup />
      </>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-rose-500/30 rounded-3xl p-8 text-center space-y-5 shadow-2xl">
          <img
            src="/admin-logo.png"
            alt="My Money Manager Admin"
            className="w-14 h-14 rounded-2xl mx-auto border border-slate-700"
          />
          <div className="w-12 h-12 bg-rose-500/10 text-rose-500 rounded-2xl flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black text-white">403 Forbidden: Admin Access Only</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              This standalone Admin Console is restricted exclusively to authorized HackifyPro administrators. Standard user accounts must sign in on the consumer My Money Manager application.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleOpenUserApp}
              className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>User Website</span>
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Switch to Admin</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <AdminDashboard onExit={handleOpenUserApp} />
      <AdminInstallPopup />
    </>
  );
};

export const AdminApp: React.FC = () => {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <ExpenseProvider>
            <AdminPwaInstallProvider>
              <AdminAppShell />
            </AdminPwaInstallProvider>
          </ExpenseProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
};

export default AdminApp;
