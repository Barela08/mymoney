import React, { useState } from 'react';
import {
  Headset,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  BadgeCheck,
  Download,
  Smartphone,
  CheckCircle2,
  Shield,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { usePwaInstall } from '../../context/PwaInstallContext';
import { sanitizePublicUrl } from '../../lib/siteConfigDefaults';

interface StaffLoginPageProps {
  onReturnHome?: () => void;
  onGoToAdmin?: () => void;
}

export const StaffLoginPage: React.FC<StaffLoginPageProps> = ({ onReturnHome, onGoToAdmin }) => {
  const { staffLogin } = useAuth();
  const { siteConfig } = useExpense();
  const { isInstalled, canOfferInstall, triggerInstallPrompt, compatibility } = usePwaInstall();
  const toast = useToast();
  const staffBrand = siteConfig.branding.staff_app;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInstallingApp, setIsInstallingApp] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requiresAdminPortal, setRequiresAdminPortal] = useState(false);

  const handleReturnHome = () => {
    if (onReturnHome) {
      onReturnHome();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  const handleGoToAdmin = () => {
    if (onGoToAdmin) {
      onGoToAdmin();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.href = '/myadmin';
    }
  };

  const handleInstallStaffApp = async () => {
    if (isInstallingApp) return;
    setIsInstallingApp(true);
    try {
      const res = await triggerInstallPrompt();
      if (res.status === 'accepted') {
        toast.success('Installing Staff App', `${staffBrand.appName} is being installed to your device.`);
      } else if (res.status === 'already_installed') {
        toast.info('Already Installed', `${staffBrand.appName} is already running as an installed app.`);
      }
    } finally {
      setIsInstallingApp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setRequiresAdminPortal(false);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setErrorMessage('Please enter a valid staff email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your staff password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await staffLogin(trimmedEmail, password, rememberMe);
      if (res.success) {
        toast.success('Staff Authenticated', 'Welcome to My Money Manager Staff Operations Desk.');
      } else {
        const msg = res.message || 'Invalid staff credentials.';
        setErrorMessage(msg);
        if (res.code === 'ADMIN_PORTAL_REQUIRED') {
          setRequiresAdminPortal(true);
        }
        toast.error('Staff Login Failed', msg);
      }
    } catch (err: any) {
      const msg = err?.message || 'Unable to authenticate staff member.';
      setErrorMessage(msg);
      toast.error('Authentication Error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-8 relative overflow-hidden">
      {/* Indigo / Cyan Ambient Background */}
      <div className="absolute -top-28 left-1/2 -translate-x-1/2 w-[540px] h-[540px] bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Bar */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-2 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src={sanitizePublicUrl(staffBrand.logoUrl, '/staff-logo.png')}
            alt={staffBrand.appName || 'My Money Manager Staff'}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = '/staff-icon-192.png';
            }}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-cover border border-indigo-500/40 shadow-lg shrink-0 bg-indigo-950"
          />
          <div className="min-w-0">
            <span className="text-sm font-black tracking-tight text-white block truncate">
              <span className="sm:hidden">{staffBrand.shortName || 'MM Staff'}</span>
              <span className="hidden sm:inline">{staffBrand.appName || 'My Money Manager Staff'}</span>
            </span>
            <span className="text-[11px] font-semibold text-indigo-400 block truncate">
              <span className="sm:hidden">HackifyPro · Operations</span>
              <span className="hidden sm:inline">{staffBrand.tagline || 'A product of HackifyPro · Staff Operations Desk'}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isInstalled && canOfferInstall ? (
            <button
              type="button"
              onClick={handleInstallStaffApp}
              disabled={isInstallingApp}
              data-testid="staff-login-download-app-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-md shadow-indigo-900/30 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Download Staff App</span>
              <span className="sm:hidden">Install App</span>
            </button>
          ) : isInstalled ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-[11px] font-bold text-indigo-300">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Staff App Installed</span>
            </span>
          ) : null}

          <button
            type="button"
            onClick={handleReturnHome}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">User Website</span>
            <span className="sm:hidden">Home</span>
          </button>
        </div>
      </header>

      {/* Center Staff Login Card */}
      <main className="w-full max-w-md mx-auto my-8 z-10">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-indigo-900/60 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/50 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/35 text-indigo-400 flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/10">
              <Headset className="w-7 h-7" />
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-[10px] font-extrabold uppercase tracking-wider text-indigo-300">
              <BadgeCheck className="w-3 h-3" />
              Authorized Staff Portal (/mystaff)
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {staffBrand.loginTitle || 'Staff Member Sign In'}
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              {staffBrand.loginSubtitle ||
                'Sign in with your Support Agent, Analyst, or assigned Staff account to handle user tickets, complaints, and operations.'}
            </p>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="space-y-2.5 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed font-medium">{errorMessage}</p>
              </div>
              {requiresAdminPortal && (
                <button
                  type="button"
                  onClick={handleGoToAdmin}
                  className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Open Admin Portal (/myadmin)</span>
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="staff-login-email"
                className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Staff Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="staff-login-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="staff@mymoney.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none text-sm text-white placeholder-slate-500"
                  required
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="staff-login-password"
                className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="staff-login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter staff password"
                  className="w-full pl-10 pr-11 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none text-sm text-white placeholder-slate-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
              />
              <span>Keep staff session active for 30 days</span>
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold text-sm shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{isSubmitting ? 'Verifying Staff Role...' : 'Sign In to Staff Desk'}</span>
              {!isSubmitting && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          {/* Dedicated Staff App Download Card */}
          {!isInstalled && canOfferInstall && (
            <div className="p-3.5 rounded-2xl bg-indigo-500/5 border border-indigo-500/25 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white">Install Staff App</p>
                  <p className="text-[11px] text-slate-400">
                    Dedicated /mystaff PWA ({compatibility.osLabel})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleInstallStaffApp}
                disabled={isInstallingApp}
                className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shrink-0 flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Install</span>
              </button>
            </div>
          )}

          <div className="pt-4 border-t border-slate-800/80 text-center space-y-2">
            <p className="text-[11px] text-slate-400">
              Platform Administrator?{' '}
              <button
                type="button"
                onClick={handleGoToAdmin}
                className="text-emerald-400 hover:text-emerald-300 font-bold underline cursor-pointer"
              >
                Sign in at Admin Portal (/myadmin)
              </button>
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Only registered staff team members with Support, Analyst, or custom staff roles can sign in here.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-[11px] text-slate-500 z-10">
        {staffBrand.appName} — {siteConfig.footer.companyName || 'HackifyPro'}
      </footer>
    </div>
  );
};
