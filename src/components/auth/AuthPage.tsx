import React, { useState, useMemo, useEffect } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { authApi } from '../../lib/authApi';

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

  const [mode, setMode] = useState<'login' | 'register' | 'forgot_password' | 'reset_password'>('login');
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

  // When in recovery mode, verify the token
  useEffect(() => {
    if (isRecoveryMode || window.location.hash.includes('reset-password')) {
      setMode('reset_password');
      const hash = window.location.hash;
      const matchToken = hash.match(/token=([a-zA-Z0-9_-]+)/);
      const token = matchToken?.[1] || recoveryToken || '';
      setActiveToken(token);

      if (token) {
        setTokenStatus('checking');
        authApi
          .verifyResetToken(token)
          .then((res) => {
            if (res.valid) {
              setTokenStatus('valid');
              if (res.email) setTokenTargetEmail(res.email);
            } else {
              setTokenStatus('invalid');
              setErrorMessage(res.message || 'Reset link is invalid or has expired.');
            }
          })
          .catch(() => {
            setTokenStatus('invalid');
            setErrorMessage('Unable to verify reset link.');
          });
      } else {
        setTokenStatus('invalid');
      }
    }
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
            setMode('login');
            setIsRecoveryMode(false);
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
      if (!email.trim()) {
        setErrorMessage('Please enter your account email address.');
        return;
      }
      try {
        setIsSubmitting(true);
        const res = await requestPasswordReset(email);
        setResetSuccessMessage(res.message);
        setResendCooldown(60);
        if (res.resetLink) {
          setGeneratedResetLink(res.resetLink);
        }
        toast.success('Reset Dispatched', res.message);
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
                onClick={() => {
                  setMode('login');
                  setErrorMessage(null);
                  setValidationErrors([]);
                }}
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
                onClick={() => {
                  setMode('register');
                  setErrorMessage(null);
                  setValidationErrors([]);
                }}
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

          {/* Form */}
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
                      onClick={() => {
                        setMode('forgot_password');
                        setErrorMessage(null);
                        setValidationErrors([]);
                      }}
                      className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      Forgot password?
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
                  onClick={() => {
                    setMode('login');
                    setErrorMessage(null);
                    setResetSuccessMessage(null);
                  }}
                  className="font-bold text-slate-600 dark:text-slate-300 hover:underline block mx-auto"
                >
                  &larr; Back to Sign In
                </button>
              </div>
            )}

            {mode === 'reset_password' && (
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setIsRecoveryMode(false);
                  window.location.hash = '';
                }}
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
                  onClick={() => setMode('register')}
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
                  onClick={() => setMode('login')}
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
  );
};
