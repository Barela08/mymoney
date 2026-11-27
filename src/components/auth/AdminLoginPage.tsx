import React, { useState } from 'react';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

interface AdminLoginPageProps {
  onReturnHome?: () => void;
}

export const AdminLoginPage: React.FC<AdminLoginPageProps> = ({ onReturnHome }) => {
  const { adminLogin } = useAuth();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleReturnHome = () => {
    if (onReturnHome) {
      onReturnHome();
      return;
    }
    if (typeof window !== 'undefined') {
      const host = (window.location.hostname || '').toLowerCase();
      if (host.startsWith('admin.')) {
        window.location.href =
          host === 'admin.nileshbarela.site'
            ? 'https://mymoney.nileshbarela.site'
            : `${window.location.protocol}//${window.location.host.replace(/^admin\./i, '')}/`;
        return;
      }
      window.location.href = '/';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setErrorMessage('Please enter a valid administrator email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your administrator password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await adminLogin(trimmedEmail, password, rememberMe);
      if (res.success) {
        toast.success('Admin Authenticated', 'Welcome to My Money Manager Admin.');
      } else {
        const msg = res.message || 'Invalid administrator credentials.';
        setErrorMessage(msg);
        toast.error('Admin Login Failed', msg);
      }
    } catch (err: any) {
      const msg = err?.message || 'Unable to authenticate administrator.';
      setErrorMessage(msg);
      toast.error('Authentication Error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-8">
      {/* Top Bar */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/admin-logo.png"
            alt="My Money Manager Admin by HackifyPro"
            className="w-10 h-10 rounded-xl object-cover border border-slate-800 shrink-0"
          />
          <div className="min-w-0">
            <span className="text-sm font-bold tracking-tight text-white block truncate">
              My Money Manager Admin
            </span>
            <span className="text-xs text-slate-400 block truncate">
              HackifyPro Operations &amp; Security Gateway
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleReturnHome}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
          <span>Consumer App</span>
        </button>
      </header>

      {/* Center Admin Login Card */}
      <main className="w-full max-w-md mx-auto my-8">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="text-center space-y-2.5">
            <img
              src="/admin-logo.png"
              alt="My Money Manager Admin"
              className="w-14 h-14 rounded-2xl object-cover mx-auto border border-emerald-500/30"
            />
            <p className="text-xs font-semibold text-emerald-400 flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Restricted Administrator Console</span>
            </p>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Sign in to Admin Console
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Manage live users, security alerts, complaints, support requests, and mobile push notifications.
            </p>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed font-medium">{errorMessage}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="admin-login-email"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                Administrator Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-login-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@mymoney.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:outline-none text-sm text-white placeholder-slate-500"
                  required
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="admin-login-password"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter administrator password"
                  className="w-full pl-10 pr-11 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:outline-none text-sm text-white placeholder-slate-500"
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
                className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
              />
              <span>Keep admin session active for 30 days</span>
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{isSubmitting ? 'Verifying Credentials...' : 'Sign In to Admin Console'}</span>
              {!isSubmitting && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-800 text-center">
            <p className="text-xs text-slate-500 leading-relaxed">
              Authorized administrators only. Standard user accounts must sign in on the main consumer application.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-slate-500">
        My Money Manager Admin &middot; A product of HackifyPro
      </footer>
    </div>
  );
};
