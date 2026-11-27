import React, { useState } from 'react';
import {
  Shield,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  ShieldCheck,
  Laptop,
  Smartphone,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import type { ActiveDeviceSession } from '../../lib/authApi';

interface AdminLoginPageProps {
  onReturnHome?: () => void;
}

export const AdminLoginPage: React.FC<AdminLoginPageProps> = ({ onReturnHome }) => {
  const { adminLogin } = useAuth();
  const { appBranding } = useExpense();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [maxSessionsPrompt, setMaxSessionsPrompt] = useState<{
    sessions: ActiveDeviceSession[];
    maxSessions: number;
  } | null>(null);
  const [showManageDevices, setShowManageDevices] = useState(false);
  const [confirmReplaceSession, setConfirmReplaceSession] = useState<ActiveDeviceSession | null>(null);

  const handleReturnHome = () => {
    if (onReturnHome) {
      onReturnHome();
      return;
    }
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/');
      window.location.hash = '';
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setMaxSessionsPrompt(null);
    setShowManageDevices(false);
    setConfirmReplaceSession(null);

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
        toast.success('Admin Authenticated', 'Welcome to the HackifyPro Admin Control Center.');
      } else {
        const msg = res.message || 'Invalid administrator credentials.';
        setErrorMessage(msg);
        if (res.code === 'MAX_SESSIONS_REACHED' && Array.isArray(res.activeSessions)) {
          setMaxSessionsPrompt({
            sessions: res.activeSessions,
            maxSessions: res.maxSessions || 3,
          });
        }
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-8 relative overflow-hidden">
      {/* Background ambient accents */}
      <div className="absolute -top-28 left-1/2 -translate-x-1/2 w-[520px] h-[520px] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Bar */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-2 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src={appBranding?.logoUrl || '/logo.jpg'}
            alt={`${appBranding?.appName || 'My Money Manager'} by HackifyPro`}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = '/logo.jpg';
            }}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-cover border border-emerald-500/40 shadow-lg shrink-0"
          />
          <div className="min-w-0">
            <span className="text-sm font-black tracking-tight text-white block truncate">
              {appBranding?.appName || 'My Money Manager'}
            </span>
            <span className="text-[11px] font-semibold text-emerald-400 block truncate">
              A product of HackifyPro · Admin Security Gateway
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleReturnHome}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
          <span>User Website</span>
        </button>
      </header>

      {/* Center Admin Login Card */}
      <main className="w-full max-w-md mx-auto my-8 z-10">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/50 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
              <Shield className="w-7 h-7" />
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-extrabold uppercase tracking-wider text-emerald-300">
              <ShieldCheck className="w-3 h-3" />
              Restricted Admin Portal (/admin)
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Administrator Sign In
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Sign in with an authorized administrator account to manage platform settings, API keys, maintenance mode, and users.
            </p>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed font-medium">{errorMessage}</p>
            </div>
          )}

          {maxSessionsPrompt && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-amber-300">
                    Active on {maxSessionsPrompt.sessions.length} / {maxSessionsPrompt.maxSessions} Devices
                  </p>
                  <p className="text-[11px] text-amber-200/80 mt-0.5">
                    Manage active admin devices to free up a slot.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowManageDevices((prev) => !prev);
                    setConfirmReplaceSession(null);
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold shrink-0 cursor-pointer"
                >
                  {showManageDevices ? 'Hide Devices' : 'Manage My Devices'}
                </button>
              </div>

              {showManageDevices && (
                <div className="space-y-2 pt-2 border-t border-amber-500/20">
                  {maxSessionsPrompt.sessions.map((sess) => {
                    const isConfirming = confirmReplaceSession?.id === sess.id;
                    return (
                      <div
                        key={sess.id}
                        className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {sess.deviceType === 'mobile' ? (
                              <Smartphone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            ) : (
                              <Laptop className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="text-[11px] font-bold text-white truncate">{sess.deviceName}</p>
                              <p className="text-[10px] text-slate-400 truncate">
                                {sess.browser} · {sess.os}
                              </p>
                            </div>
                          </div>
                          {!isConfirming && (
                            <button
                              type="button"
                              onClick={() => setConfirmReplaceSession(sess)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-bold shrink-0 cursor-pointer"
                            >
                              <LogOut className="w-3 h-3" />
                              <span>Log Out Device</span>
                            </button>
                          )}
                        </div>

                        {isConfirming && (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-rose-950/50 border border-rose-500/30">
                            <p className="text-[10.5px] text-rose-200">
                              Log out <strong>{sess.deviceName}</strong> and sign in here?
                            </p>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => setConfirmReplaceSession(null)}
                                className="px-2 py-1 rounded-md text-[10px] font-bold bg-slate-800 text-slate-300 cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={async () => {
                                  setErrorMessage(null);
                                  setIsSubmitting(true);
                                  try {
                                    const retry = await adminLogin(email.trim().toLowerCase(), password, rememberMe, sess.id);
                                    if (retry.success) {
                                      setMaxSessionsPrompt(null);
                                      setShowManageDevices(false);
                                      setConfirmReplaceSession(null);
                                      toast.success('Admin Authenticated', 'Replaced older session and signed in.');
                                    } else {
                                      setErrorMessage(retry.message || 'Admin login failed.');
                                      setConfirmReplaceSession(null);
                                    }
                                  } finally {
                                    setIsSubmitting(false);
                                  }
                                }}
                                className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
                              >
                                Confirm Log Out &amp; Sign In
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="admin-login-email"
                className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Admin Email
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
                className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1.5"
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
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold text-sm shadow-lg shadow-emerald-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{isSubmitting ? 'Verifying Clearance...' : 'Sign In to Admin Panel'}</span>
              {!isSubmitting && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-800/80 text-center">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Standard user accounts do not have permission to sign in here. Normal users should sign in on the main website.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-[11px] text-slate-500 z-10">
        {appBranding?.appName || 'My Money Manager'} — A product of HackifyPro
      </footer>
    </div>
  );
};
