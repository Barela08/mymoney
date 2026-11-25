import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Wallet,
  Lock,
  Mail,
  User,
  Phone,
  ArrowRight,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RotateCcw,
  KeyRound,
  Copy,
  Check,
  Sparkles,
  ShieldCheck,
  Clock,
  GoogleCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { authApi } from '../../lib/authApi';
import { getSupabaseClient } from '../../lib/supabase';
import { DpdpConsentModal } from '../common/DpdpConsentModal';
import { getStoredDpdpConsent, saveConsentChoices } from '../common/DpdpConsentBanner';

export const AuthPage: React.FC = () => {
  const {
    login,
    register,
    requestPasswordReset,
    completePasswordReset,
    isRecoveryMode,
    recoveryToken,
    recoveryEmail,
    setIsRecoveryMode,
    setRecoveryToken,
  } = useAuth();
  const toast = useToast();

  const getInitialMode = (): 'login' | 'register' | 'forgot_password' | 'reset_password' => {
    if (typeof window === 'undefined') return 'login';
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    const hash = window.location.hash;
    const search = window.location.search;
    if (path === '/reset-password' || hash.includes('reset-password') || search.includes('token=')) {
      return 'reset_password';
    }
    if (path === '/forgot-password' || hash === '#forgot-password') {
      return 'forgot_password';
    }
    if (path === '/register' || hash === '#register') {
      return 'register';
    }
    return 'login';
  };

  const [mode, setMode] = useState<'login' | 'register' | 'forgot_password' | 'reset_password'>(getInitialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);
  const [generatedResetLink, setGeneratedResetLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Google OAuth state
  const [isGoogleLoggingIn, setIsGoogleLoggingIn] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [pendingGoogleProfile, setPendingGoogleProfile] = useState<any>(null);
  const [showNameConfirmation, setShowNameConfirmation] = useState(false);
  const [nameToConfirm, setNameToConfirm] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [customName, setCustomName] = useState('');

  // Navigate between auth modes and synchronize URL
  const navigateToMode = (newMode: 'login' | 'register' | 'forgot_password' | 'reset_password') => {
    setMode(newMode);
    setErrorMessage(null);
    setValidationErrors([]);
    setResetSuccessMessage(null);

    if (typeof window !== 'undefined') {
      if (newMode === 'forgot_password') {
        window.history.pushState(null, '', '/forgot-password');
      } else if (newMode === 'reset_password') {
        const qs = activeToken ? `?token=${encodeURIComponent(activeToken)}` : '';
        window.history.pushState(null, '', `/reset-password${qs}`);
      } else if (newMode === 'register') {
        window.history.pushState(null, '', '/register');
      } else {
        window.history.pushState(null, '', '/login');
        setIsRecoveryMode(false);
      }
    }
  };

  // Statutory DPDP Consent State
  const [isDpdpModalOpen, setIsDpdpModalOpen] = useState(false);
  // Never pre-tick a consent checkbox, even if the user agreed in the past.
  const [isDpdpAgreed, setIsDpdpAgreed] = useState(false);

  // Verify DPDP consent before login/signup at startup
  useEffect(() => {
    const consent = getStoredDpdpConsent();
    if (!consent.hasAnswered || !consent.isConsented) {
      setIsDpdpModalOpen(true);
    }
  }, []);

  const handleSaveDpdpChoices = () => {
    setIsDpdpModalOpen(false);
  };

  // Token Verification for reset_password mode
  const [activeToken, setActiveToken] = useState<string>('');
  const [tokenStatus, setTokenStatus] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [tokenTargetEmail, setTokenTargetEmail] = useState<string>('');

  // Resend Cooldown
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    let timer: any;
    if (resendCooldown > 0) {
      timer = setInterval(() => setResendCooldown((prev) => prev - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Synchronize route and verify reset token across pathname, search query, and hash
  useEffect(() => {
    const detectTokenAndRoute = () => {
      if (typeof window === 'undefined') return;
      const path = window.location.pathname.replace(/\/+$/, '') || '/';
      const hash = window.location.hash;
      const searchParams = new URLSearchParams(window.location.search);

      const isReset = path === '/reset-password' || hash.includes('reset-password') || isRecoveryMode;
      const isForgot = path === '/forgot-password' || hash === '#forgot-password';
      const isReg = path === '/register' || hash === '#register';

      if (isReset) {
        setMode('reset_password');
        let token = searchParams.get('token');
        if (!token) {
          const matchToken = hash.match(/token=([a-zA-Z0-9_-]+)/);
          if (matchToken && matchToken[1]) token = matchToken[1];
        }
        if (!token && recoveryToken) token = recoveryToken;

        const foundToken = token || '';
        setActiveToken(foundToken);

        if (foundToken) {
          setTokenStatus('checking');
          authApi
            .verifyResetToken(foundToken)
            .then((res) => {
              if (res.valid) {
                setTokenStatus('valid');
                if (res.email) setTokenTargetEmail(res.email);
              } else {
                setTokenStatus('invalid');
                setErrorMessage(res.message || 'This reset link is invalid, expired, or has already been used.');
              }
            })
            .catch(() => {
              setTokenStatus('invalid');
              setErrorMessage('Unable to verify reset link. Please check your network or request a new link.');
            });
        } else {
          setTokenStatus('invalid');
          setErrorMessage('Reset recovery token is missing. Please request a new link.');
        }
      } else if (isForgot) {
        setMode('forgot_password');
      } else if (isReg) {
        setMode('register');
      }
    };

    detectTokenAndRoute();
    window.addEventListener('popstate', detectTokenAndRoute);
    window.addEventListener('hashchange', detectTokenAndRoute);
    return () => {
      window.removeEventListener('popstate', detectTokenAndRoute);
      window.removeEventListener('hashchange', detectTokenAndRoute);
    };
  }, [isRecoveryMode, recoveryToken]);

  // Live password strength calculation (12 to 128 characters, character diversity)
  const passwordStrength = useMemo(() => {
    if (!password) return null;
    const len = password.length;
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);
    const score = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;

    const meetsLength = len >= 12 && len <= 128;
    const isValid = meetsLength && (len >= 16 || score >= 2);

    let label = 'Very Weak';
    let color = 'bg-rose-500';
    let width = '20%';

    if (len >= 12 && score >= 3) {
      label = 'Strong';
      color = 'bg-emerald-500';
      width = '100%';
    } else if (len >= 12 && score >= 2) {
      label = 'Moderate';
      color = 'bg-amber-500';
      width = '70%';
    } else if (len >= 8) {
      label = 'Weak (Needs 12+ chars)';
      color = 'bg-orange-500';
      width = '40%';
    }

    return { isValid, label, color, width, meetsLength };
  }, [password]);

  const handleCopyResetLink = () => {
    if (generatedResetLink) {
      navigator.clipboard.writeText(generatedResetLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
      toast.info('Copied', 'Password reset link copied to clipboard.');
    }
  };

  // Google OAuth login
  const handleGoogleLogin = async () => {
    setIsGoogleLoggingIn(true);
    setGoogleError(null);
    setPendingGoogleProfile(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase client not available');

      // Sign in with Google OAuth
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // Redirect to the same app URL after auth
          redirectTo: typeof window !== 'undefined'
            ? window.location.origin
            : undefined,
          // Prompt for email selection if needed
          // prompt: 'select_account',
        },
      });

      if (error) throw error;

      // If we get here, OAuth redirect has been initiated
      // The user will be redirected to Google and then back to the app
      // We need to handle the redirect callback
      if (data.url) {
        // User needs to complete OAuth on the redirect URL
        // The redirect will happen and supabase will handle the callback
        setGoogleError(null);
      } else if (data.session) {
        // Session available immediately (rare with OAuth, usually redirects)
        // handleGoogleCallback(data.session);
      }
    } catch (err: any) {
      console.error('Google OAuth error:', err);
      setGoogleError(err.message || 'Google login failed. Please try again.');
      setIsGoogleLoggingIn(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setValidationErrors([]);
    setResetSuccessMessage(null);

    // 1. Reset Password Mode
    if (mode === 'reset_password') {
      if (!activeToken) {
        setErrorMessage('Reset token is missing or invalid. Please request a new reset link.');
        return;
      }
      if (!password || password.length < 12) {
        setErrorMessage('Password must be at least 12 characters long according to enterprise policy.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage('Passwords do not match. Please enter the same password in both fields.');
        return;
      }

      try {
        setIsSubmitting(true);
        const res = await completePasswordReset(activeToken, password, confirmPassword);
        if (res.success) {
          toast.success('Password Reset Successful!', res.message);
          setResetSuccessMessage(res.message);
          setPassword('');
          setConfirmPassword('');
          setActiveToken('');
          setTimeout(() => {
            navigateToMode('login');
          }, 2000);
        } else {
          setErrorMessage(res.message || 'Failed to update password.');
        }
      } catch (err: any) {
        setErrorMessage(err.message || 'An error occurred during password reset.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // 2. Forgot Password Mode
    if (mode === 'forgot_password') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email.trim() || !emailRegex.test(email.trim())) {
        setErrorMessage('Please enter a valid email address (e.g. name@example.com).');
        return;
      }
      try {
        setIsSubmitting(true);
        const res = await requestPasswordReset(email);
        setResetSuccessMessage(
          res.message || 'If an account exists with this email, a password reset link has been sent.'
        );
        setResendCooldown(60);
        if (res.resetLink) {
          setGeneratedResetLink(res.resetLink);
        }
        toast.success('Reset Request Dispatched', res.message || 'Instructions sent if account exists.');
      } catch (err: any) {
        setErrorMessage(err.message || 'Failed to dispatch reset request.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // 3. Register Mode
    if (mode === 'register') {
      if (!name.trim()) {
        setErrorMessage('Please enter your full name.');
        return;
      }
      if (!email.trim()) {
        setErrorMessage('Please enter your email address.');
        return;
      }
      if (password.length < 12) {
        setErrorMessage('Password must be at least 12 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage('Passwords do not match. Please verify both password fields.');
        return;
      }
    }

    // 4. Submit Login or Register
    // Login never requires optional consent. Registration requires the user to
    // tick the specific consent control themselves (it is never pre-checked).
    if (mode === 'register' && !isDpdpAgreed) {
      setErrorMessage(
        'Please tick the consent checkbox to confirm cloud sync and financial processing for your new account.'
      );
      return;
    }

    try {
      setIsSubmitting(true);
      if (mode === 'login') {
        const res = await login(email, password, rememberMe);
        if (res.success) {
          toast.success('Welcome back!', 'Authenticated securely.');
        } else {
          setErrorMessage(res.message || 'Login failed. Please check your credentials.');
        }
      } else {
        const res = await register(name, email, password, confirmPassword, phone);
        if (res.success) {
          // The ticked checkbox is the explicit consent action for a new account.
          saveConsentChoices({ cloud_sync: true, financial_processing: true });
          toast.success('Account Created!', 'Welcome to My Money Manager.');
        } else {
          setErrorMessage(res.message || 'Registration failed.');
          if (res.errors) setValidationErrors(res.errors);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Authentication error.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 px-4 transition-colors">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Header */}
        <div className="flex flex-col items-center justify-center gap-2 mb-3">
          <img
            src="/logo.jpg"
            alt="My Money Manager by HackifyPro"
            className="w-16 h-16 rounded-2xl object-cover shadow-xl shadow-emerald-600/30 border-2 border-emerald-500/40"
          />
          <div className="text-center">
            <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
              My Money Manager
            </h1>
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
              by HackifyPro · Production Security
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 dark:text-slate-400 mt-2">
          Enterprise Security Architecture · Bcrypt Encryption · Multi-Tenant Isolation
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-slate-900 py-8 px-6 shadow-xl shadow-slate-200/50 dark:shadow-slate-950/50 rounded-3xl border border-slate-200 dark:border-slate-800 transition-colors">
          {/* Form Tabs (Only when not in forgot/reset password mode) */}
          {mode !== 'forgot_password' && mode !== 'reset_password' && (
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl mb-6">
              <button
                type="button"
                onClick={() => navigateToMode('login')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => navigateToMode('register')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                  mode === 'register'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                }`}
              >
                Create Account
              </button>
            </div>
          )}

          {/* Google OAuth Button */}
          {mode !== 'forgot_password' && mode !== 'reset_password' && (
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 border border-slate-300 dark:border-slate-700 rounded-xl shadow-sm text-xs font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer mb-4"
            >
              <GoogleCircle className="w-4 h-4" />
              <span>Continue with Google</span>
            </button>
          )}

          {/* Reset Password Header */}
          {mode === 'reset_password' && (
            <div className="mb-6 text-center space-y-1">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                <KeyRound className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Set Your New Password
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tokenTargetEmail
                  ? `Setting password for ${tokenTargetEmail}`
                  : 'Enter your new secure password (min 12 characters).'}
              </p>
            </div>
          )}

          {/* Forgot Password Header */}
          {mode === 'forgot_password' && (
            <div className="mb-6 text-center space-y-1">
              <div className="w-12 h-12 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                <RotateCcw className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Forgot Your Password?
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter your registered email and we'll send you a single-use secure reset link (valid 15 minutes).
              </p>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 rounded-2xl flex items-start gap-3">
              <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-700 dark:text-rose-300">
                <p className="font-semibold">{errorMessage}</p>
                {validationErrors.length > 0 && (
                  <ul className="list-disc list-inside mt-1 space-y-0.5 text-[11px] opacity-90">
                    {validationErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Success Banner */}
          {resetSuccessMessage && (
            <div className="mb-5 p-4 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-2xl space-y-2">
              <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200 font-bold text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Instructions Dispatched</span>
              </div>
              <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
                {resetSuccessMessage}
              </p>

              {/* Developer preview of link in local dev mode */}
              {generatedResetLink && (
                <div className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800/60">
                  <p className="text-[10px] text-emerald-800 dark:text-emerald-300 font-bold uppercase tracking-wider mb-1">
                    Direct Reset Link:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedResetLink}
                      className="text-[11px] font-mono bg-white dark:bg-slate-800 px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-slate-800 dark:text-slate-200 flex-1 truncate"
                    />
                    <button
                      type="button"
                      onClick={handleCopyResetLink}
                      className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm flex items-center gap-1 shrink-0"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reset Password Token Checking & Invalid State Cards */}
          {mode === 'reset_password' && tokenStatus === 'checking' && (
            <div className="py-10 text-center space-y-3">
              <div className="w-9 h-9 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                Verifying password recovery token...
              </p>
              <p className="text-[11px] text-slate-400">
                Checking validity with authentication server
              </p>
            </div>
          )}

          {mode === 'reset_password' && tokenStatus === 'invalid' && (
            <div className="py-6 text-center space-y-4">
              <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Reset Link Invalid or Expired
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
                  {errorMessage || 'For your security, password reset tokens are single-use and expire 15 minutes after issuance.'}
                </p>
              </div>
              <div className="pt-2 space-y-2 max-w-xs mx-auto">
                <button
                  type="button"
                  onClick={() => navigateToMode('forgot_password')}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer transition-all"
                >
                  Request a New Reset Link
                </button>
                <button
                  type="button"
                  onClick={() => navigateToMode('login')}
                  className="w-full py-2 px-4 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
                >
                  &larr; Back to Sign In
                </button>
              </div>
            </div>
          )}

          {/* Form (Rendered when not in checking/invalid reset mode) */}
          {(mode !== 'reset_password' || tokenStatus === 'valid') && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Full Name (Register Only) */}
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <User className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Rahul Sharma"
                      className="block w-full pl-10 pr-3.5 py-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              )}

              {/* Email (All modes except reset_password) */}
              {mode !== 'reset_password' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Email Address <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Mail className="h-4 w-4" />
                    </div>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="block w-full pl-10 pr-3.5 py-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              )}

              {/* Phone Number (Register Only) */}
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Phone Number (Optional)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Phone className="h-4 w-4" />
                    </div>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="block w-full pl-10 pr-3.5 py-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              )}

              {/* Password (Login, Register, Reset Password) */}
              {mode !== 'forgot_password' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {mode === 'reset_password' ? 'New Password' : 'Password'}{' '}
                      <span className="text-rose-500">*</span>
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => navigateToMode('forgot_password')}
                        className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        Forgot Password?
                      </button>
                    )}
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="h-4 w-4" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'login' ? '••••••••••••' : 'Min 12 characters passphrase'}
                      className="block w-full pl-10 pr-10 py-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {/* Password strength visualizer for Register & Reset */}
                  {(mode === 'register' || mode === 'reset_password') && passwordStrength && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500">Strength Policy (min 12 chars):</span>
                        <span
                          className={`font-bold ${
                            passwordStrength.isValid ? 'text-emerald-600' : 'text-rose-500'
                          }`}
                        >
                          {passwordStrength.label}
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${passwordStrength.color} transition-all duration-300`}
                          style={{ width: passwordStrength.width }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Prominent Forgot Password Link directly below password input on Login */}
                  {mode === 'login' && (
                    <div className="mt-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => navigateToMode('forgot_password')}
                        className="text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer inline-flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Forgot Password? Recover Account</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Confirm Password (Register and Reset Password) */}
              {(mode === 'register' || mode === 'reset_password') && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Confirm Password <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="h-4 w-4" />
                    </div>
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="block w-full pl-10 pr-10 py-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Remember Me Checkbox (Login Only) */}
              {mode === 'login' && (
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                    />
                    <span className="text-xs text-slate-600 dark:text-slate-400">Remember Me (30 days)</span>
                  </label>
                </div>
              )}

              {/* DPDP Consent Acceptance Checkbox for Registration */}
              {mode === 'register' && (
                <div className="flex items-start gap-2.5 pt-1 text-left">
                  <input
                    type="checkbox"
                    id="register-dpdp-consent"
                    checked={isDpdpAgreed}
                    onChange={(e) => {
                      setIsDpdpAgreed(e.target.checked);
                    }}
                    className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4 cursor-pointer"
                  />
                  <label
                    htmlFor="register-dpdp-consent"
                    className="text-xs text-slate-600 dark:text-slate-300 cursor-pointer leading-relaxed"
                  >
                    I agree to the{' '}
                    <button
                      type="button"
                      onClick={() => setIsDpdpModalOpen(true)}
                      className="text-emerald-600 dark:text-emerald-400 font-bold underline cursor-pointer"
                    >
                      privacy notice and consent terms
                    </button>{' '}
                    for cloud sync and financial processing of my new account. Optional AI,
                    analytics and Udhar sharing stay off unless I enable them in Settings.
                  </label>
                </div>
              )}

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 border border-transparent rounded-xl shadow-md text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-98 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {mode === 'login' && 'Sign In Securely'}
                        {mode === 'register' && 'Create Account'}
                        {mode === 'forgot_password' && 'Send Reset Link'}
                        {mode === 'reset_password' && 'Set New Password'}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Navigation between modes */}
          <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 text-center text-xs">
            {mode === 'forgot_password' && (
              <div className="space-y-2">
                {resendCooldown > 0 ? (
                  <p className="text-[11px] text-slate-400 flex items-center justify-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>Resend available in {resendCooldown}s</span>
                  </p>
                ) : (
                  resetSuccessMessage && (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline block mx-auto text-xs"
                    >
                      Resend Reset Email
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => navigateToMode('login')}
                  className="font-bold text-slate-600 dark:text-slate-300 hover:underline block mx-auto"
                >
                  &larr; Back to Sign In
                </button>
              </div>
            )}

            {mode === 'reset_password' && (
              <button
                type="button"
                onClick={() => navigateToMode('login')}
                className="font-bold text-slate-600 dark:text-slate-300 hover:underline"
              >
                &larr; Back to Sign In
              </button>
            )}

            {mode === 'login' && (
              <p className="text-slate-500 dark:text-slate-400">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => navigateToMode('register')}
                  className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  Create one now
                </button>
              </p>
            )}

            {mode === 'register' && (
              <p className="text-slate-500 dark:text-slate-400">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => navigateToMode('login')}
                  className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Purpose-specific consent choices. Nothing is pre-selected. */}
      <DpdpConsentModal isOpen={isDpdpModalOpen} onSave={handleSaveDpdpChoices} />
    </div>
  );
};
