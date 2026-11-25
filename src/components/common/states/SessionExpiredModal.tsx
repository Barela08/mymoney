import React, { useState } from 'react';
import { Lock, LogIn, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';

export interface SessionExpiredModalProps {
  isOpen: boolean;
  onSuccess: () => void;
  userEmail?: string;
}

export const SessionExpiredModal: React.FC<SessionExpiredModalProps> = ({
  isOpen,
  onSuccess,
  userEmail = '',
}) => {
  const { login } = useAuth();
  const [email] = useState(userEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleReauth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setErrorMsg('Please enter your password to continue.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      await login(email, password);
      onSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-fade-in"
    >
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 overflow-hidden">
        <div className="p-3.5 bg-amber-100 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-900/50 rounded-2xl text-amber-600 dark:text-amber-400 w-fit mx-auto mb-4">
          <Lock className="w-8 h-8" />
        </div>

        <h3 id="session-expired-title" className="text-lg sm:text-xl font-bold text-center text-slate-900 dark:text-slate-100 mb-1">
          Session Expired
        </h3>

        <p className="text-xs sm:text-sm text-center text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
          For your financial security, your session has timed out. Please enter your password to resume exactly where you left off. Your current work has been preserved.
        </p>

        {errorMsg && (
          <div className="p-3 mb-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleReauth} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Account Email
            </label>
            <input
              type="email"
              value={email}
              readOnly
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-mono cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Enter Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoFocus
                required
                className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 disabled:opacity-60 text-white font-bold text-sm rounded-xl shadow-md transition-all cursor-pointer"
          >
            <LogIn className="w-4 h-4" />
            <span>{isSubmitting ? 'Authenticating...' : 'Resume Session'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
