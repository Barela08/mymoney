import React, { useState, useMemo, useEffect } from 'react';
import {
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
  Sparkles,
  ShieldCheck,
  Clock,
  Fingerprint,
  Laptop,
  Smartphone,
  LogOut,
  X,
  Megaphone,
  Globe,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { authApi, type ActiveDeviceSession } from '../../lib/authApi';
import { PrivacyNoticeModal } from '../privacy/PrivacyNoticeModal';
import type { ConsentLanguage } from '../../lib/privacyConsent';

export const AuthPage: React.FC = () => {
  const {
    login,
    loginWithGoogle,
    loginWithPasskey,
    register,
    requestPasswordReset,
    completePasswordReset,
    isRecoveryMode,
    recoveryToken,
    setIsRecoveryMode,
  } = useAuth();
  const { appBranding, siteConfig } = useExpense();
  const toast = useToast();
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);

  const userBrand = siteConfig.branding.user_app;
  const webBrand = siteConfig.branding.website;
  const loginCfg = siteConfig.loginSettings;
  const homepageCfg = siteConfig.homepage;
  const footerCfg = siteConfig.footer;
  const announcementCfg = siteConfig.announcement;

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
  const showHeroSplit =
    (mode === 'login' || mode === 'register') &&
    siteConfig.featureVisibility.publicWelcomeHeroEnabled &&
    homepageCfg.showHero;
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
  const [maxSessionsPrompt, setMaxSessionsPrompt] = useState<{
    sessions: ActiveDeviceSession[];
    maxSessions: number;
    method: 'email' | 'google' | 'passkey';
  } | null>(null);

  // Navigate between auth modes and synchronize URL
  const navigateToMode = (newMode: 'login' | 'register' | 'forgot_password' | 'reset_password') => {
    setMode(newMode);
    setErrorMessage(null);
    setValidationErrors([]);
    setResetSuccessMessage(null);
    setMaxSessionsPrompt(null);

    if (typeof window !== 'undefined') {
      if (newMode === 'forgot_password') {
        window.history.pushState(null, '', '/forgot-password');
      } else if (newMode === 'reset_password') {
        window.history.pushState(null, '', '/reset-password');
      } else if (newMode === 'register') {
        window.history.pushState(null, '', '/register');
      } else {
        window.history.pushState(null, '', '/login');
        setIsRecoveryMode(false);
      }
    }
  };

  // Privacy Notice preview modal (read-only informational notice before account creation).
  // Optional consent choices are never pre-ticked or bundled with registration;
  // authenticated users choose optional categories explicitly in the Privacy Choices screen.
  const [isPrivacyNoticeOpen, setIsPrivacyNoticeOpen] = useState(false);
  const [noticeLanguage, setNoticeLanguage] = useState<ConsentLanguage>('en');
  // Never pre-tick the registration acknowledgement checkbox.
  const [isDpdpAgreed, setIsDpdpAgreed] = useState(false);

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
        let token = searchParams.get('token') || searchParams.get('code');
        if (!token) {
          const matchToken = hash.match(/(?:token|access_token)=([a-zA-Z0-9_.-]+)/);
          if (matchToken && matchToken[1]) token = matchToken[1];
        }
        if (!token && recoveryToken) token = recoveryToken;

        const foundToken = token || '';
        setActiveToken(foundToken);

        // Immediately strip sensitive token/query parameters from address bar to protect against history & referer leakage
        if (typeof window !== 'undefined' && (window.location.search || window.location.hash)) {
          try {
            window.history.replaceState(null, '', '/reset-password');
          } catch {}
        }

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
            .catch((err: any) => {
              setTokenStatus('invalid');
              const msg = err?.data?.message || err?.message || 'Unable to verify reset link. Please request a new link.';
              setErrorMessage(msg);
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

  // Live password strength calculation (8 to 128 characters, character diversity)
  const passwordStrength = useMemo(() => {
    if (!password) return null;
    const len = password.length;
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);
    const score = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;

    const meetsLength = len >= 8 && len <= 128;
    const isValid = meetsLength && (len >= 10 || score >= 2);

    let label = 'Very Weak';
    let color = 'bg-rose-500';
    let width = '20%';

    if (len >= 8 && score >= 3) {
      label = 'Strong';
      color = 'bg-emerald-500';
      width = '100%';
    } else if (len >= 8 && score >= 2) {
      label = 'Moderate';
      color = 'bg-amber-500';
      width = '70%';
    } else if (len >= 8) {
      label = 'Fair (Add numbers/symbols)';
      color = 'bg-yellow-500';
      width = '50%';
    } else {
      label = 'Weak (Needs 8+ chars)';
      color = 'bg-orange-500';
      width = '30%';
    }

    return { isValid, label, color, width, meetsLength };
  }, [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setValidationErrors([]);
    setResetSuccessMessage(null);
    setMaxSessionsPrompt(null);

    // 1. Reset Password Mode
    if (mode === 'reset_password') {
      if (!activeToken) {
        setErrorMessage('Reset token is missing or invalid. Please request a new reset link.');
        return;
      }
      if (!password || password.length < 8) {
        setErrorMessage('Password must be at least 8 characters long.');
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
        const msg = err?.data?.message || err?.message || 'An error occurred during password reset.';
        setErrorMessage(msg);
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
        if (res.success) {
          setResetSuccessMessage(
            res.message || 'If an account exists with this email, a password reset link has been sent.'
          );
          setResendCooldown(60);
          toast.success('Reset Request Dispatched', res.message || 'Instructions sent if account exists.');
        } else {
          setErrorMessage(res.message || 'Failed to dispatch reset request.');
        }
      } catch (err: any) {
        const msg = err?.data?.message || err?.message || 'You have made too many attempts. Please try again after some time.';
        setErrorMessage(msg);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // 3. Register Mode
    if (mode === 'register') {
      if (!loginCfg.allowRegistration) {
        setErrorMessage('New account registrations are currently paused by the administrator.');
        return;
      }
      if (!name.trim()) {
        setErrorMessage('Please enter your full name.');
        return;
      }
      if (!email.trim()) {
        setErrorMessage('Please enter your email address.');
        return;
      }
      if (password.length < 8) {
        setErrorMessage('Password must be at least 8 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage('Passwords do not match. Please verify both password fields.');
        return;
      }
    }

    if (mode === 'login' && !loginCfg.allowLogin) {
      setErrorMessage('User sign-in is temporarily paused by the administrator. Please check back shortly.');
      return;
    }

    // 4. Submit Login or Register
    // Login never requires optional consent. Registration asks the user to acknowledge
    // the Privacy Notice for essential account creation; optional categories remain OFF
    // until the user chooses them explicitly after signing in.
    if (mode === 'register' && !isDpdpAgreed) {
      setErrorMessage(
        'Please confirm that you have read the Privacy Notice for essential account creation.'
      );
      return;
    }

    try {
      setIsSubmitting(true);
      if (mode === 'login') {
        const res = await login(email, password, rememberMe);
        if (res.success) {
          toast.success('Welcome back!', 'Authenticated securely.');
          if (typeof window !== 'undefined') {
            window.history.replaceState(null, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }
        } else {
          setErrorMessage(res.message || 'Login failed. Please check your credentials.');
          if (res.code === 'MAX_SESSIONS_REACHED' && Array.isArray(res.activeSessions)) {
            setMaxSessionsPrompt({
              sessions: res.activeSessions,
              maxSessions: res.maxSessions || 3,
              method: 'email',
            });
          }
        }
      } else {
        const res = await register(name, email, password, confirmPassword, phone);
        if (res.success) {
          // Do NOT bundle or auto-grant optional consents (cloud_sync, ai_processing, etc.).
          // The Privacy Choices & Consent Center will prompt the authenticated user explicitly.
          toast.success('Account Created!', 'Welcome to My Money Manager by HackifyPro.');
          if (typeof window !== 'undefined') {
            window.history.replaceState(null, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }
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

  const resolvedLogoUrl = userBrand.logoUrl || appBranding?.logoUrl || '/logo.jpg';
  const resolvedAppName = userBrand.appName || appBranding?.appName || 'My Money Manager';
  const resolvedTagline =
    userBrand.tagline ||
    (appBranding?.subTitle && appBranding.subTitle !== 'by HackifyPro'
      ? appBranding.subTitle
      : 'A product of HackifyPro');

  const visibleFeatureCards = (homepageCfg.featureCards || []).filter((c) => c.visible !== false);
  const socialEntries = footerCfg.showSocialLinks
    ? Object.entries(footerCfg.socialLinks || {}).filter(([, url]) => Boolean(url && String(url).trim()))
    : [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col transition-colors">
      {/* Live Site Announcement Strip */}
      {announcementCfg.enabled && announcementCfg.message && !announcementDismissed && (
        <div
          className={`w-full px-4 py-2.5 text-xs font-semibold border-b ${
            announcementCfg.severity === 'announcement'
              ? 'bg-indigo-600 text-white border-indigo-700'
              : announcementCfg.severity === 'warning'
              ? 'bg-amber-400 text-slate-950 border-amber-500'
              : announcementCfg.severity === 'success'
              ? 'bg-emerald-600 text-white border-emerald-700'
              : 'bg-slate-900 dark:bg-slate-800 text-white border-slate-800 dark:border-slate-700'
          }`}
        >
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Megaphone className="w-3.5 h-3.5 shrink-0" />
              <p className="truncate sm:whitespace-normal">
                {announcementCfg.title ? <strong className="mr-1.5">{announcementCfg.title}:</strong> : null}
                <span>{announcementCfg.message}</span>
              </p>
            </div>
            {announcementCfg.dismissible && (
              <button
                type="button"
                onClick={() => setAnnouncementDismissed(true)}
                aria-label="Dismiss announcement"
                className="p-1 rounded-lg hover:bg-black/15 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col justify-center py-8 sm:py-12 sm:px-6 lg:px-8 px-4">
        <div
          className={
            showHeroSplit
              ? 'w-full max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center'
              : 'w-full'
          }
        >
          {showHeroSplit ? (
            <div className="lg:col-span-6 space-y-5">
              <div className="flex items-center gap-3.5">
                <img
                  src={resolvedLogoUrl}
                  alt={`${resolvedAppName} ${resolvedTagline}`}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/logo.jpg'; }}
                  className="w-14 h-14 rounded-2xl object-cover shadow-lg shadow-emerald-600/25 border-2 border-emerald-500/40 shrink-0"
                />
                <div>
                  <h2 className="text-xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
                    {resolvedAppName}
                  </h2>
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {resolvedTagline}
                  </p>
                </div>
              </div>

              {homepageCfg.heroBadge && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100/80 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>{homepageCfg.heroBadge}</span>
                </div>
              )}

              <div className="space-y-2.5">
                <h1 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">
                  {homepageCfg.heroHeading}
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
                  {homepageCfg.heroSubheading}
                </p>
              </div>

              {homepageCfg.showFeatureSection && visibleFeatureCards.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2.5 pt-1">
                  {visibleFeatureCards.slice(0, 3).map((card) => (
                    <div
                      key={card.id}
                      className="p-3 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 shadow-xs"
                    >
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{card.title}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                        {card.description}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {homepageCfg.showSecurityTrustSection && homepageCfg.securityTrustText && (
                <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/60">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
                    {homepageCfg.securityTrustText}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="sm:mx-auto sm:w-full sm:max-w-md mb-6">
              {/* Brand Header */}
              <div className="flex flex-col items-center justify-center gap-2 mb-3">
                <img
                  src={resolvedLogoUrl}
                  alt={`${resolvedAppName} ${resolvedTagline}`}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/logo.jpg'; }}
                  className="w-16 h-16 rounded-2xl object-cover shadow-xl shadow-emerald-600/30 border-2 border-emerald-500/40"
                />
                <div className="text-center">
                  <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
                    {resolvedAppName}
                  </h1>
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {resolvedTagline}
                  </p>
                </div>
              </div>

              <p className="text-center text-xs text-slate-500 dark:text-slate-400 mt-2">
                {userBrand.description || 'Personal Finance, Room Budgets, Udhar Ledger & UPI QR'}
              </p>
            </div>
          )}

          <div className={showHeroSplit ? 'lg:col-span-6 w-full max-w-md mx-auto lg:ml-auto' : 'sm:mx-auto sm:w-full sm:max-w-md'}>
            <div className="bg-white dark:bg-slate-900 py-7 px-6 shadow-xl shadow-slate-200/50 dark:shadow-slate-950/50 rounded-3xl border border-slate-200 dark:border-slate-800 transition-colors">
              {/* Live Login / Register Card Title */}
              {(mode === 'login' || mode === 'register') && (
                <div className="mb-4 text-center sm:text-left">
                  <h2 className="text-base font-black text-slate-900 dark:text-slate-100">
                    {mode === 'register'
                      ? loginCfg.registerHeadline || 'Create your financial workspace'
                      : loginCfg.loginHeadline || userBrand.loginTitle || 'Welcome back'}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {mode === 'register'
                      ? loginCfg.registerSubheadline || 'Free personal ledger with consent-verified Udhar.'
                      : loginCfg.loginSubheadline || userBrand.loginSubtitle}
                  </p>
                </div>
              )}

              {/* Custom Login Banner */}
              {(mode === 'login' || mode === 'register') && loginCfg.loginBannerText && (
                <div className="mb-4 p-3 rounded-2xl bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-900 text-xs text-sky-800 dark:text-sky-200 font-medium">
                  {loginCfg.loginBannerText}
                </div>
              )}

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
                  {loginCfg.allowRegistration && (
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
                  )}
                </div>
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
                  : 'Enter your new secure password (min 8 characters).'}
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
              <div className="text-xs text-rose-700 dark:text-rose-300 space-y-2">
                <p className="font-semibold">{errorMessage}</p>
                {errorMessage.includes('embedded preview frame') && typeof window !== 'undefined' && (
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 text-[11px] font-bold text-rose-700 dark:text-rose-200 hover:bg-rose-100/60 dark:hover:bg-rose-900/40 transition-colors"
                  >
                    <span>Open in Full Browser Tab</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                )}
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

          {/* 3-Device Concurrent Login Limit Prompt */}
          {maxSessionsPrompt && (
            <div className="mb-5 p-4 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-2xl space-y-3">
              <div className="flex items-start gap-2.5">
                <Laptop className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-900 dark:text-amber-200 leading-snug">
                    You have reached the maximum limit of {maxSessionsPrompt.maxSessions} active devices. Please log out from an existing device before signing in here.
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 text-[11px] font-bold">
                      Manage My Devices ({maxSessionsPrompt.sessions.length} / {maxSessionsPrompt.maxSessions})
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-1">
                    Select a device below to review and revoke its session so you can sign in here:
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {maxSessionsPrompt.sessions.map((sess) => (
                  <div
                    key={sess.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-amber-900/60"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {sess.deviceType === 'mobile' ? (
                        <Smartphone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      ) : (
                        <Laptop className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-slate-900 dark:text-white truncate">
                          {sess.deviceName}
                        </p>
                        <p className="text-[10px] text-slate-500 truncate">
                          {sess.ipAddress ? `${sess.ipAddress} · ` : ''}
                          {new Date(sess.lastActiveAt || sess.createdAt).toLocaleString('en-IN', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={async () => {
                        setErrorMessage(null);
                        setIsSubmitting(true);
                        try {
                          const retryRes =
                            maxSessionsPrompt.method === 'google'
                              ? await loginWithGoogle(sess.id)
                              : maxSessionsPrompt.method === 'passkey'
                              ? await loginWithPasskey(email.trim() || undefined, sess.id)
                              : await login(email, password, rememberMe, sess.id);

                          if (retryRes.success) {
                            setMaxSessionsPrompt(null);
                            toast.success('Signed In!', 'Replaced old device session securely.');
                            if (typeof window !== 'undefined') {
                              window.history.replaceState(null, '', '/');
                              window.dispatchEvent(new PopStateEvent('popstate'));
                            }
                          } else {
                            setErrorMessage(retryRes.message || 'Could not sign in.');
                          }
                        } finally {
                          setIsSubmitting(false);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <LogOut className="w-3 h-3" />
                      <span>Log Out &amp; Sign In</span>
                    </button>
                  </div>
                ))}
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

          {/* Admin Paused Login / Registration Guards */}
          {mode === 'register' && !loginCfg.allowRegistration && (
            <div className="py-6 text-center space-y-4">
              <div className="w-12 h-12 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  New Registrations Temporarily Paused
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
                  The administrator has temporarily paused public sign-ups. Existing users can continue signing in.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigateToMode('login')}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                Back to Sign In
              </button>
            </div>
          )}

          {mode === 'login' && !loginCfg.allowLogin && (
            <div className="mb-4 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 font-semibold">
              User sign-in is temporarily paused by the administrator. Please check back shortly.
            </div>
          )}

          {/* Form (Rendered when not in checking/invalid reset mode or paused registration) */}
          {((mode !== 'reset_password' || tokenStatus === 'valid') &&
            !(mode === 'register' && !loginCfg.allowRegistration)) && (
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
                      placeholder={mode === 'login' ? '••••••••••••' : 'Min 8 characters passphrase'}
                      className="block w-full pl-10 pr-10 py-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {/* Password strength visualizer for Register & Reset */}
                  {(mode === 'register' || mode === 'reset_password') && passwordStrength && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500">Strength Policy (min 8 chars):</span>
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
                      aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
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

              {/* Privacy Notice Acknowledgement Checkbox for Registration (Essential Service Only) */}
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
                    I have read the{' '}
                    <button
                      type="button"
                      onClick={() => setIsPrivacyNoticeOpen(true)}
                      className="text-emerald-600 dark:text-emerald-400 font-bold underline cursor-pointer"
                    >
                      Privacy Notice
                    </button>{' '}
                    for essential account and ledger services. All optional categories (Cloud Sync,
                    AI External Processing, Udhar Sharing, Analytics, Personalization, Marketing)
                    stay unchecked until I choose them in Privacy Choices.
                  </label>
                </div>
              )}

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || (mode === 'login' && !loginCfg.allowLogin)}
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

          {/* Unified Alternative Sign-In Methods: Google Auth & Passkey (WebAuthn) */}
          {(mode === 'login' || (mode === 'register' && loginCfg.allowRegistration)) &&
            (loginCfg.allowGoogleSignIn || loginCfg.allowPasskeySignIn) &&
            !(mode === 'login' && !loginCfg.allowLogin) && (
            <div className="mt-5 space-y-3">
              <div className="relative flex items-center justify-center">
                <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                <span className="px-3 bg-white dark:bg-slate-900 text-[11px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">
                  Or continue with
                </span>
                <div className="w-full border-t border-slate-200 dark:border-slate-800" />
              </div>

              <div
                className={`grid gap-2.5 ${
                  loginCfg.allowGoogleSignIn && loginCfg.allowPasskeySignIn
                    ? 'grid-cols-1 sm:grid-cols-2'
                    : 'grid-cols-1'
                }`}
              >
                {loginCfg.allowGoogleSignIn && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  data-testid="auth-google-btn"
                  onClick={async () => {
                    setErrorMessage(null);
                    setMaxSessionsPrompt(null);
                    setIsSubmitting(true);
                    try {
                      const res = await loginWithGoogle();
                      if (res.success) {
                        toast.success('Signed In', res.message || 'Authenticated with Google.');
                      } else {
                        setErrorMessage(res.message || 'Google sign-in could not be completed.');
                        if (res.code === 'MAX_SESSIONS_REACHED' && Array.isArray(res.activeSessions)) {
                          setMaxSessionsPrompt({
                            sessions: res.activeSessions,
                            maxSessions: res.maxSessions || 3,
                            method: 'google',
                          });
                        }
                      }
                    } finally {
                      setIsSubmitting(false);
                    }
                  }}
                  className="flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.08 3.57-5.15 3.57-8.64z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.29a7.18 7.18 0 0 1 0-4.58v-3.1H1.28a12 12 0 0 0 0 10.78l4-3.1z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.76c1.76 0 3.34.61 4.58 1.79l3.43-3.43C17.94 1.19 15.23 0 12 0A12 12 0 0 0 1.28 6.61l4 3.1c.95-2.84 3.6-4.95 6.72-4.95z"
                    />
                  </svg>
                  <span>Google</span>
                </button>
                )}

                {loginCfg.allowPasskeySignIn && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  data-testid="auth-passkey-btn"
                  onClick={async () => {
                    setErrorMessage(null);
                    setMaxSessionsPrompt(null);
                    setIsSubmitting(true);
                    try {
                      const res = await loginWithPasskey(email.trim() || undefined);
                      if (res.success) {
                        toast.success('Signed In', res.message || 'Authenticated with Passkey.');
                      } else {
                        setErrorMessage(res.message || 'Passkey sign-in could not be completed.');
                        if (res.code === 'MAX_SESSIONS_REACHED' && Array.isArray(res.activeSessions)) {
                          setMaxSessionsPrompt({
                            sessions: res.activeSessions,
                            maxSessions: res.maxSessions || 3,
                            method: 'passkey',
                          });
                        }
                      }
                    } finally {
                      setIsSubmitting(false);
                    }
                  }}
                  className="flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Fingerprint className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Passkey</span>
                </button>
                )}
              </div>
            </div>
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

            {mode === 'login' && loginCfg.allowRegistration && (
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
        </div>
      </div>

      {/* Consistent Product Branding Footer */}
      <footer className="py-5 px-4 border-t border-slate-200/70 dark:border-slate-800/80 bg-white/60 dark:bg-slate-900/40">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="text-center sm:text-left">
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {webBrand.footerBrandText || `${resolvedAppName} — A product of ${footerCfg.companyName || 'HackifyPro'}`}
            </span>
            {footerCfg.copyrightText && <span className="ml-2">· {footerCfg.copyrightText}</span>}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {footerCfg.supportEmail && (
              <a href={`mailto:${footerCfg.supportEmail}`} className="hover:text-emerald-600 dark:hover:text-emerald-400">
                {footerCfg.supportEmail}
              </a>
            )}
            {footerCfg.supportPhone && (
              <a href={`tel:${footerCfg.supportPhone.replace(/\s+/g, '')}`} className="hover:text-emerald-600 dark:hover:text-emerald-400">
                {footerCfg.supportPhone}
              </a>
            )}
            {footerCfg.showLegalLinks && (
              <button
                type="button"
                onClick={() => setIsPrivacyNoticeOpen(true)}
                className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                Privacy Notice
              </button>
            )}
            {socialEntries.map(([network, url]) => (
              <a
                key={network}
                href={String(url)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 capitalize hover:text-emerald-600 dark:hover:text-emerald-400"
              >
                <Globe className="w-3 h-3" />
                <span>{network}</span>
              </a>
            ))}
          </div>
        </div>
      </footer>

      {/* Standalone Trilingual Privacy Notice (read-only informational preview before login) */}
      <PrivacyNoticeModal
        isOpen={isPrivacyNoticeOpen}
        language={noticeLanguage}
        onChangeLanguage={setNoticeLanguage}
        onClose={() => setIsPrivacyNoticeOpen(false)}
      />
    </div>
  );
};
