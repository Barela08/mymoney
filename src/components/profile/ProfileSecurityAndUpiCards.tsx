import React, { useState, useEffect, useCallback } from 'react';
import {
  QrCode,
  Edit3,
  Trash2,
  ShieldCheck,
  KeyRound,
  Fingerprint,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Link2,
  Unlink,
  Mail,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { authApi, type SecurityMethodsData } from '../../lib/authApi';
import { upiProfileApi, type UpiProfileChangedDetail } from '../../lib/upiProfileApi';
import { doesUpiProfileBelongToUser, type UpiProfileRecord } from '../../lib/upiQrUtils';
import { UpiSetupModal } from '../upi/UpiSetupModal';
import { isPasskeySupported, registerPasskeyOnDevice } from '../../lib/webauthnClient';
import { isFirebaseGoogleConfigured, signInWithFirebaseGoogle } from '../../lib/firebaseClient';

export const ProfileSecurityAndUpiCards: React.FC = () => {
  const { user } = useAuth();
  const currentUserId = user?.id || user?.uid || null;

  // Saved UPI QR state
  const [upiProfile, setUpiProfile] = useState<UpiProfileRecord | null>(null);
  const [upiConsentStatus, setUpiConsentStatus] = useState<'granted' | 'withdrawn' | 'not_granted'>('not_granted');
  const [upiConsentVersion, setUpiConsentVersion] = useState<string | null>(null);
  const [upiLoading, setUpiLoading] = useState(true);
  const [upiModalOpen, setUpiModalOpen] = useState(false);
  const [removeUpiOpen, setRemoveUpiOpen] = useState(false);
  const [removingUpi, setRemovingUpi] = useState(false);

  // Unified Auth Security Methods state
  const [security, setSecurity] = useState<SecurityMethodsData | null>(null);
  const [secLoading, setSecLoading] = useState(true);
  const [secFeedback, setSecFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [passkeyDeviceName, setPasskeyDeviceName] = useState('');
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(null);
  const [googleActionLoading, setGoogleActionLoading] = useState(false);

  const loadAll = useCallback(async (forceUpiRefresh = false) => {
    if (!currentUserId) {
      setUpiProfile(null);
      setUpiConsentStatus('not_granted');
      setUpiConsentVersion(null);
      setUpiLoading(false);
      setSecLoading(false);
      return;
    }
    setUpiLoading(true);
    setSecLoading(true);
    try {
      const [upiRes, secRes] = await Promise.allSettled([
        upiProfileApi.getProfile({ forceRefresh: forceUpiRefresh }),
        authApi.getSecurityMethods(),
      ]);
      if (upiRes.status === 'fulfilled' && upiRes.value.success) {
        const owned =
          upiRes.value.consentStatus !== 'withdrawn' &&
          doesUpiProfileBelongToUser(upiRes.value.profile, currentUserId)
            ? upiRes.value.profile
            : null;
        setUpiProfile(owned);
        setUpiConsentStatus(upiRes.value.consentStatus || 'not_granted');
        setUpiConsentVersion(upiRes.value.consentVersion ?? null);
      }
      if (secRes.status === 'fulfilled' && secRes.value.success) {
        setSecurity(secRes.value.security);
      }
    } finally {
      setUpiLoading(false);
      setSecLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    loadAll();
    const onUpiChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<UpiProfileChangedDetail | undefined>).detail;
      if (detail) {
        if (detail.userId && currentUserId && detail.userId !== currentUserId) return;
        const owned =
          detail.consentStatus !== 'withdrawn' &&
          doesUpiProfileBelongToUser(detail.profile, currentUserId)
            ? detail.profile
            : null;
        setUpiProfile(owned);
        setUpiConsentStatus(detail.consentStatus || 'not_granted');
        if (detail.consentVersion !== undefined) setUpiConsentVersion(detail.consentVersion);
        return;
      }
      void loadAll(true);
    };
    window.addEventListener('my-money-upi-profile-changed', onUpiChanged);
    return () => window.removeEventListener('my-money-upi-profile-changed', onUpiChanged);
  }, [loadAll, currentUserId]);

  const handleRemoveUpi = async () => {
    setRemovingUpi(true);
    try {
      await upiProfileApi.removeProfile({ withdrawConsent: true, source: 'settings_upi_qr' });
      setUpiProfile(null);
      setUpiConsentStatus('withdrawn');
      setRemoveUpiOpen(false);
    } finally {
      setRemovingUpi(false);
    }
  };

  const handleAddPasskey = async () => {
    setSecFeedback(null);
    setRegisteringPasskey(true);
    try {
      const res = await registerPasskeyOnDevice(passkeyDeviceName.trim() || undefined);
      setPasskeyDeviceName('');
      setSecFeedback({ type: 'success', text: res.message || 'Passkey registered.' });
      await loadAll();
    } catch (err: any) {
      setSecFeedback({ type: 'error', text: err?.message || 'Could not register passkey.' });
    } finally {
      setRegisteringPasskey(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    setSecFeedback(null);
    setRemovingPasskeyId(id);
    try {
      const res = await authApi.deletePasskey(id);
      setSecFeedback({ type: 'success', text: res.message || 'Passkey removed.' });
      await loadAll();
    } catch (err: any) {
      setSecFeedback({ type: 'error', text: err?.message || 'Could not remove passkey.' });
    } finally {
      setRemovingPasskeyId(null);
    }
  };

  const handleLinkGoogle = async () => {
    setSecFeedback(null);
    setGoogleActionLoading(true);
    try {
      const { idToken } = await signInWithFirebaseGoogle();
      const res = await authApi.linkGoogleAccount(idToken);
      setSecFeedback({ type: 'success', text: res.message || 'Google account linked.' });
      await loadAll();
    } catch (err: any) {
      setSecFeedback({ type: 'error', text: err?.message || 'Could not link Google account.' });
    } finally {
      setGoogleActionLoading(false);
    }
  };

  const handleUnlinkGoogle = async () => {
    setSecFeedback(null);
    setGoogleActionLoading(true);
    try {
      const res = await authApi.unlinkGoogleAccount();
      setSecFeedback({ type: 'success', text: res.message || 'Google account unlinked.' });
      await loadAll();
    } catch (err: any) {
      setSecFeedback({ type: 'error', text: err?.message || 'Could not unlink Google account.' });
    } finally {
      setGoogleActionLoading(false);
    }
  };

  const defaultPayeeName = user?.full_name || user?.displayName || '';

  return (
    <div className="space-y-6">
      {/* 1. Saved UPI QR Profile Management Card */}
      <div
        data-testid="settings-upi-qr-card"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <QrCode className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Personal UPI QR Details
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Private to your account · Protected by DPDP consent &amp; Row Level Security
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUpiModalOpen(true)}
              data-testid="settings-upi-edit-btn"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{upiProfile?.upiId ? 'Edit UPI Details' : 'Set Up UPI QR'}</span>
            </button>
            {upiProfile?.upiId && (
              <button
                type="button"
                onClick={() => setRemoveUpiOpen(true)}
                data-testid="settings-upi-remove-btn"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            )}
          </div>
        </div>

        {upiLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading UPI QR configuration...</span>
          </div>
        ) : upiProfile?.upiId ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Saved UPI ID</p>
              <p className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 truncate">
                {upiProfile.upiId}
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Payee Name</p>
              <p className="font-semibold text-slate-900 dark:text-white mt-0.5 truncate">
                {upiProfile.payeeName || defaultPayeeName || '—'}
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Consent Status</p>
              <p className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {upiConsentStatus === 'granted' ? 'Consent Granted' : 'Active'}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No UPI ID saved yet. Click <strong>Set Up UPI QR</strong> here or from your Dashboard Available Balance card to start generating Normal and Fixed Amount payment QRs.
          </p>
        )}
      </div>

      {/* 2. Unified Sign-In Methods (Google, Passkeys, Email/Password) */}
      <div
        data-testid="settings-security-methods-card"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5"
      >
        <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Sign-In Methods &amp; Passkeys</span>
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            All linked sign-in methods resolve to your single verified My Money Manager account. Accounts are never merged automatically without your explicit confirmation.
          </p>
        </div>

        {secFeedback && (
          <div
            className={`flex items-start gap-2 p-3 rounded-xl text-xs border ${
              secFeedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
            }`}
          >
            {secFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{secFeedback.text}</span>
          </div>
        )}

        {secLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading linked sign-in methods...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Email & Password */}
            <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 dark:text-white">Email &amp; Password</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {security?.email.address || user?.email}{' '}
                    {security?.email.hasPassword ? '· Password enabled' : '· No password set'}
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                Primary
              </span>
            </div>

            {/* Google Account (Firebase Auth) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 text-sm font-black text-slate-700 dark:text-slate-200">
                  G
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 dark:text-white">Google Sign-In</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {security?.google.linked
                      ? `Linked: ${security.google.email}`
                      : isFirebaseGoogleConfigured()
                      ? 'Not linked — link your Google account for one-tap sign-in'
                      : 'Requires Firebase web credentials (VITE_FIREBASE_*) in deployment settings'}
                  </p>
                </div>
              </div>

              {security?.google.linked ? (
                <button
                  type="button"
                  onClick={handleUnlinkGoogle}
                  disabled={googleActionLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 border border-rose-200 dark:border-rose-900 shrink-0 disabled:opacity-50"
                >
                  {googleActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                  <span>Unlink</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleLinkGoogle}
                  disabled={googleActionLoading || !isFirebaseGoogleConfigured()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 shrink-0 disabled:opacity-45"
                >
                  {googleActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                  <span>Link Google</span>
                </button>
              )}
            </div>

            {/* Registered Passkeys (WebAuthn — Multiple Devices Supported) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <Fingerprint className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      Passkeys ({security?.passkeys.length || 0})
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Sign in with Touch ID, Face ID, Windows Hello, or a hardware security key.
                    </p>
                  </div>
                </div>
              </div>

              {/* Register new passkey */}
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={passkeyDeviceName}
                  onChange={(e) => setPasskeyDeviceName(e.target.value)}
                  maxLength={50}
                  placeholder="Optional device label (e.g. Work Laptop, Pixel 9)"
                  className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
                <button
                  type="button"
                  onClick={handleAddPasskey}
                  disabled={registeringPasskey || !isPasskeySupported()}
                  data-testid="register-passkey-btn"
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 disabled:opacity-50"
                >
                  {registeringPasskey ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  <span>Register Passkey</span>
                </button>
              </div>

              {/* List of registered passkeys */}
              {security && security.passkeys.length > 0 && (
                <div className="space-y-2 pt-1">
                  {security.passkeys.map((pk) => (
                    <div
                      key={pk.id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <KeyRound className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {pk.deviceName}
                          </p>
                          <p className="text-[10.5px] text-slate-400">
                            Added {new Date(pk.createdAt).toLocaleDateString('en-IN')}
                            {pk.lastUsedAt
                              ? ` · Last used ${new Date(pk.lastUsedAt).toLocaleDateString('en-IN')}`
                              : ''}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeletePasskey(pk.id)}
                        disabled={removingPasskeyId === pk.id}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
                        title="Remove passkey"
                      >
                        {removingPasskeyId === pk.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* UPI Setup / Edit Modal */}
      <UpiSetupModal
        isOpen={upiModalOpen}
        onClose={() => setUpiModalOpen(false)}
        defaultPayeeName={defaultPayeeName}
        existingProfile={upiProfile}
        consentStatus={upiConsentStatus}
        consentVersion={upiConsentVersion}
        source="settings_upi_qr"
        onSaved={(saved) => {
          setUpiProfile(saved);
          setUpiConsentStatus('granted');
        }}
      />

      {/* Remove UPI Confirmation Modal */}
      {removeUpiOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !removingUpi && setRemoveUpiOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Remove Saved UPI ID?</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  This removes <strong className="font-mono">{upiProfile?.upiId}</strong> and withdraws your UPI QR storage consent.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoveUpiOpen(false)}
                disabled={removingUpi}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemoveUpi}
                disabled={removingUpi}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
              >
                {removingUpi && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Remove UPI ID
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
