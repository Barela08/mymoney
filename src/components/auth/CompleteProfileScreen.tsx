import React, { useState } from 'react';
import { UserCheck, AtSign, Phone, Loader2, AlertCircle, ShieldCheck, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const CompleteProfileScreen: React.FC = () => {
  const { user, completeUserProfile, logout } = useAuth();
  const initialName = user?.full_name || user?.displayName || '';
  const [fullName, setFullName] = useState(
    initialName && initialName !== user?.email?.split('@')[0] ? initialName : initialName
  );
  const [username, setUsername] = useState(user?.username || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = fullName.trim();
    const trimmedUsername = username.trim().toLowerCase();
    const trimmedPhone = phone.trim();

    if (trimmedName.length < 2 || trimmedName.length > 80) {
      setError('Please enter your full name (2–80 characters).');
      return;
    }
    if (trimmedUsername && !/^[a-z0-9_]{3,30}$/.test(trimmedUsername)) {
      setError('Username must be 3–30 characters using lowercase letters, numbers, or underscores.');
      return;
    }
    if (trimmedPhone && !/^[+]?[\d\s-]{10,16}$/.test(trimmedPhone)) {
      setError('Please enter a valid mobile number (10–15 digits).');
      return;
    }

    setSubmitting(true);
    try {
      const res = await completeUserProfile({
        fullName: trimmedName,
        username: trimmedUsername || undefined,
        phone: trimmedPhone || undefined,
      });
      if (!res.success) {
        setError(res.message || 'Could not save your profile. Please try again.');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not save your profile. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="complete-profile-screen"
      className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4"
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        <div className="px-6 pt-7 pb-5 text-center border-b border-slate-100 dark:border-slate-800 bg-gradient-to-b from-emerald-50/60 to-transparent dark:from-emerald-950/25">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto shadow-md">
            <UserCheck className="w-6 h-6" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">
            Complete Your Profile
          </h1>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            Confirm your name to finish setting up your <strong>My Money Manager by HackifyPro</strong> account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
              Registered Email
            </label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-sm text-slate-500 dark:text-slate-400 cursor-not-allowed"
            />
          </div>

          <div>
            <label
              htmlFor="complete-profile-fullname"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
            >
              Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="complete-profile-fullname"
              data-testid="complete-profile-fullname"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              autoFocus
              placeholder="Enter your full name"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
            />
          </div>

          <div>
            <label
              htmlFor="complete-profile-username"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
            >
              Username <span className="text-slate-400 font-normal">(optional — helps friends find you in Udhar)</span>
            </label>
            <div className="relative">
              <AtSign className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="complete-profile-username"
                data-testid="complete-profile-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                maxLength={30}
                placeholder="your_username"
                className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="complete-profile-phone"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
            >
              Mobile Number <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="complete-profile-phone"
                data-testid="complete-profile-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={16}
                placeholder="+91 9876543210"
                className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || fullName.trim().length < 2}
            data-testid="complete-profile-submit"
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Save & Continue</span>
          </button>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Stored securely in Supabase
            </span>
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-rose-600"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
