import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  QrCode,
  X,
  ShieldCheck,
  AlertCircle,
  Loader2,
  FileText,
  ChevronDown,
  ChevronUp,
  Lock,
} from 'lucide-react';
import {
  UPI_CONSENT_WORDING,
  UPI_PRIVACY_NOTICE,
  UPI_CONSENT_POLICY_VERSION,
  validateUpiId,
  canSaveUpiProfile,
  shouldRequireUpiConsent,
  type UpiProfileRecord,
} from '../../lib/upiQrUtils';
import { upiProfileApi } from '../../lib/upiProfileApi';

interface UpiSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPayeeName: string;
  existingProfile?: UpiProfileRecord | null;
  consentStatus?: 'granted' | 'withdrawn' | 'not_granted';
  consentVersion?: string | null;
  source?: 'upi_qr_setup' | 'settings_upi_qr';
  onSaved: (profile: UpiProfileRecord) => void;
}

export const UpiSetupModal: React.FC<UpiSetupModalProps> = ({
  isOpen,
  onClose,
  defaultPayeeName,
  existingProfile,
  consentStatus = 'not_granted',
  consentVersion = null,
  source = 'upi_qr_setup',
  onSaved,
}) => {
  const [upiId, setUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  // CRITICAL DPDP RULE: Always unchecked by default whenever consent is required!
  const [consentChecked, setConsentChecked] = useState(false);
  const [showPrivacyNotice, setShowPrivacyNotice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touchedUpi, setTouchedUpi] = useState(false);

  const isEditing = Boolean(existingProfile?.upiId);
  const requiresConsent = shouldRequireUpiConsent({
    hasSavedProfile: isEditing,
    consentStatus,
    consentVersion,
  });

  useEffect(() => {
    if (isOpen) {
      setUpiId(existingProfile?.upiId || '');
      setPayeeName(existingProfile?.payeeName || defaultPayeeName || '');
      setPaymentNote(existingProfile?.paymentNote || '');
      // Always start unchecked whenever explicit consent is required
      setConsentChecked(false);
      setShowPrivacyNotice(false);
      setError(null);
      setTouchedUpi(false);
    }
  }, [isOpen, existingProfile, defaultPayeeName]);

  if (!isOpen) return null;

  const upiCheck = validateUpiId(upiId);
  const saveGate = canSaveUpiProfile({
    upiId,
    consentAccepted: consentChecked,
    hasExistingValidConsent: !requiresConsent,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouchedUpi(true);
    setError(null);

    if (!saveGate.allowed) {
      setError(saveGate.reason || 'Please check your UPI ID and consent box.');
      return;
    }

    setSaving(true);
    try {
      const res = isEditing
        ? await upiProfileApi.updateProfile({
            upiId: upiCheck.normalized,
            payeeName: payeeName.trim(),
            paymentNote: paymentNote.trim(),
            ...(requiresConsent ? { consentAccepted: true } : {}),
            source,
          })
        : await upiProfileApi.saveProfile({
            upiId: upiCheck.normalized,
            payeeName: payeeName.trim(),
            paymentNote: paymentNote.trim(),
            consentAccepted: true,
            source,
          });

      if (res.success && res.profile) {
        onSaved(res.profile);
        onClose();
      } else {
        setError(res.message || 'Could not save your UPI details.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to save your UPI ID. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={() => !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upi-setup-title"
        data-testid="upi-setup-modal"
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 id="upi-setup-title" className="text-base font-bold text-slate-900 dark:text-white">
                {isEditing ? 'Edit Your UPI QR' : 'Create Your UPI QR'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Save your personal UPI ID to generate Normal & Fixed Amount payment QR codes.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Field 1: UPI ID */}
          <div>
            <label
              htmlFor="upi-setup-id-input"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
            >
              UPI ID <span className="text-rose-500">*</span>
            </label>
            <input
              id="upi-setup-id-input"
              data-testid="upi-id-input"
              type="text"
              value={upiId}
              onChange={(e) => {
                setUpiId(e.target.value);
                if (!touchedUpi) setTouchedUpi(true);
              }}
              onBlur={() => setTouchedUpi(true)}
              placeholder="yourname@upi"
              autoComplete="off"
              spellCheck={false}
              required
              className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 ${
                touchedUpi && !upiCheck.isValid
                  ? 'border-rose-400 focus:ring-rose-500/30 focus:border-rose-500'
                  : 'border-slate-200 dark:border-slate-700 focus:ring-emerald-500/30 focus:border-emerald-500'
              }`}
            />
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              Examples: <span className="font-mono text-slate-700 dark:text-slate-300">yourname@upi</span>,{' '}
              <span className="font-mono text-slate-700 dark:text-slate-300">name@okaxis</span>,{' '}
              <span className="font-mono text-slate-700 dark:text-slate-300">9876543210@ybl</span>
            </p>
            {touchedUpi && !upiCheck.isValid && upiCheck.error && (
              <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">{upiCheck.error}</p>
            )}
          </div>

          {/* Field 2: Payee Name */}
          <div>
            <label
              htmlFor="upi-setup-payee-input"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
            >
              Payee Name <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              id="upi-setup-payee-input"
              data-testid="upi-payee-input"
              type="text"
              value={payeeName}
              onChange={(e) => setPayeeName(e.target.value)}
              maxLength={80}
              placeholder="Your display name shown in UPI apps"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
          </div>

          {/* Field 3: Payment Note */}
          <div>
            <label
              htmlFor="upi-setup-note-input"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
            >
              Default Payment Note <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              id="upi-setup-note-input"
              data-testid="upi-note-input"
              type="text"
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
              maxLength={80}
              placeholder="e.g. Payment via My Money Manager"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
          </div>

          {/* Security assurance */}
          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 rounded-xl border border-slate-200/70 dark:border-slate-700/70">
            <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>
              We never ask for or store your UPI PIN, OTP, or banking passwords. Your UPI ID stays private to your account.
            </span>
          </div>

          {/* Mandatory DPDP Consent Gate (Unchecked by Default for First-Time / Withdrawn) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-emerald-50/40 dark:bg-emerald-950/20 p-3.5 space-y-2.5">
            {requiresConsent ? (
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  data-testid="upi-consent-checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 shrink-0"
                />
                <span className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                  {UPI_CONSENT_WORDING}
                </span>
              </label>
            ) : (
              <div
                data-testid="upi-consent-already-granted"
                className="flex items-start gap-2.5 text-xs text-emerald-800 dark:text-emerald-300"
              >
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                <span>
                  DPDP consent is already active for your saved UPI QR ({consentVersion || UPI_CONSENT_POLICY_VERSION}). You can update your UPI details without re-consenting.
                </span>
              </div>
            )}

            <div className="pl-6">
              <button
                type="button"
                onClick={() => setShowPrivacyNotice((v) => !v)}
                data-testid="upi-privacy-notice-toggle"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Privacy Notice</span>
                {showPrivacyNotice ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showPrivacyNotice && (
                <div
                  data-testid="upi-privacy-notice-panel"
                  className="mt-2.5 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 max-h-56 overflow-y-auto"
                >
                  <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-white text-xs">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>{UPI_PRIVACY_NOTICE.title}</span>
                  </div>
                  {UPI_PRIVACY_NOTICE.sections.map((sec) => (
                    <div key={sec.heading}>
                      <p className="font-semibold text-slate-800 dark:text-slate-200">{sec.heading}</p>
                      <p>{sec.body}</p>
                    </div>
                  ))}
                  <p className="pt-1.5 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
                    {UPI_PRIVACY_NOTICE.disclaimer}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              data-testid="upi-setup-cancel"
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!saveGate.allowed || saving}
              data-testid="upi-setup-save"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Save UPI ID</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
