import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import {
  QrCode,
  Download,
  Share2,
  Copy,
  Check,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  IndianRupee,
  Sparkles,
  ArrowRight,
  Edit3,
  Trash2,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatINR } from '../../lib/dateUtils';
import { upiProfileApi } from '../../lib/upiProfileApi';
import {
  buildNormalUpiUri,
  buildAmountUpiUri,
  validateAmountForUpiQr,
  validateUpiId,
  type UpiProfileRecord,
} from '../../lib/upiQrUtils';
import { UpiSetupModal } from './UpiSetupModal';

interface UpiQrGeneratorSectionProps {
  initialVpa?: string;
  initialPayeeName?: string;
  initialAmount?: number | string;
  initialNote?: string;
  onNavigate?: (tab: any) => void;
}

export const UpiQrGeneratorSection: React.FC<UpiQrGeneratorSectionProps> = ({
  initialVpa = '',
  initialPayeeName = '',
  initialAmount = '',
  initialNote = '',
  onNavigate,
}) => {
  const { user } = useAuth();
  const toast = useToast();

  const [savedProfile, setSavedProfile] = useState<UpiProfileRecord | null>(null);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(!initialVpa);
  const [setupModalOpen, setSetupModalOpen] = useState<boolean>(false);
  const [pendingModeAfterSetup, setPendingModeAfterSetup] = useState<'normal' | 'fixed'>('normal');
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState<boolean>(false);
  const [removing, setRemoving] = useState<boolean>(false);

  const [vpa, setVpa] = useState<string>(initialVpa);
  const [payeeName, setPayeeName] = useState<string>(initialPayeeName);
  const [amount, setAmount] = useState<string>(initialAmount ? String(initialAmount) : '');
  const [note, setNote] = useState<string>(initialNote);
  const [mode, setMode] = useState<'fixed' | 'normal'>(initialAmount ? 'fixed' : 'normal');
  const [generatedFixedAmount, setGeneratedFixedAmount] = useState<string | null>(
    initialAmount ? String(initialAmount) : null
  );

  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [paymentUri, setPaymentUri] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isCopiedUri, setIsCopiedUri] = useState<boolean>(false);
  const [isCopiedVpa, setIsCopiedVpa] = useState<boolean>(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);

  const defaultPayeeName =
    user?.full_name || user?.displayName || user?.email?.split('@')[0] || '';

  const loadSavedProfile = useCallback(async () => {
    if (initialVpa) {
      setLoadingProfile(false);
      return;
    }
    setLoadingProfile(true);
    try {
      const res = await upiProfileApi.getProfile();
      if (res.success && res.profile) {
        setSavedProfile(res.profile);
        setVpa(res.profile.upiId);
        setPayeeName(res.profile.payeeName || defaultPayeeName);
        setNote((prev) => prev || res.profile!.paymentNote || '');
      } else {
        setSavedProfile(null);
        setVpa('');
      }
    } catch {
      // Keep UI interactive if transient failure occurs
    } finally {
      setLoadingProfile(false);
    }
  }, [initialVpa, defaultPayeeName]);

  useEffect(() => {
    void loadSavedProfile();
    const onProfileChanged = () => {
      void loadSavedProfile();
    };
    window.addEventListener('my-money-upi-profile-changed', onProfileChanged);
    return () => window.removeEventListener('my-money-upi-profile-changed', onProfileChanged);
  }, [loadSavedProfile]);

  const vpaTrimmed = vpa.trim();
  const isVpaValid = validateUpiId(vpaTrimmed).isValid;
  const amountValidation = validateAmountForUpiQr(amount);
  const activeAmountForQr = mode === 'fixed' ? generatedFixedAmount : null;

  const computePaymentUri = useCallback((): string => {
    if (!vpaTrimmed || !isVpaValid) return '';
    try {
      if (mode === 'fixed') {
        if (!activeAmountForQr) return '';
        return buildAmountUpiUri({
          upiId: vpaTrimmed,
          payeeName: payeeName.trim() || defaultPayeeName,
          amount: activeAmountForQr,
          paymentNote: note.trim() || 'Payment via My Money Manager',
        });
      }
      return buildNormalUpiUri({
        upiId: vpaTrimmed,
        payeeName: payeeName.trim() || defaultPayeeName,
        paymentNote: note.trim() || 'Payment via My Money Manager',
      });
    } catch {
      return '';
    }
  }, [vpaTrimmed, isVpaValid, mode, activeAmountForQr, payeeName, defaultPayeeName, note]);

  useEffect(() => {
    let active = true;
    const uri = computePaymentUri();
    if (!uri) {
      setQrDataUrl('');
      setPaymentUri('');
      return;
    }

    setPaymentUri(uri);
    setIsGenerating(true);

    QRCode.toDataURL(uri, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (active) {
          setQrDataUrl(url);
          setIsGenerating(false);
        }
      })
      .catch(() => {
        if (active) setIsGenerating(false);
      });

    return () => {
      active = false;
    };
  }, [computePaymentUri]);

  const handleOpenSetup = (targetMode: 'normal' | 'fixed') => {
    setPendingModeAfterSetup(targetMode);
    setSetupModalOpen(true);
  };

  const handleUpiProfileSaved = (saved: UpiProfileRecord) => {
    setSavedProfile(saved);
    setVpa(saved.upiId);
    setPayeeName(saved.payeeName || defaultPayeeName);
    setNote(saved.paymentNote || '');
    setMode(pendingModeAfterSetup);
    toast.success(
      'UPI ID Saved',
      pendingModeAfterSetup === 'fixed'
        ? 'Now enter the amount to generate your dynamic UPI QR.'
        : 'Your default UPI QR is ready.'
    );
  };

  const handleGenerateAmountQr = () => {
    if (!vpaTrimmed || !isVpaValid) {
      handleOpenSetup('fixed');
      toast.info('Set Up UPI ID First', 'Please set up your UPI ID first to generate an amount QR.');
      return;
    }
    const check = validateAmountForUpiQr(amount);
    if (!check.isValid) {
      setMode('fixed');
      setGeneratedFixedAmount(null);
      toast.error('Invalid Amount', check.error || 'Please enter an amount greater than ₹0.');
      const el = document.getElementById('upi-qr-amount-input');
      if (el) el.focus();
      return;
    }
    setMode('fixed');
    setGeneratedFixedAmount(check.formatted);
    toast.success('Amount QR Generated', `Fixed amount of ₹${check.formatted} encoded into QR.`);
  };

  const handleGenerateAnotherQr = () => {
    setAmount('');
    setGeneratedFixedAmount(null);
    setNote(savedProfile?.paymentNote || '');
    setMode('fixed');
  };

  const handleRemoveSavedUpi = async () => {
    setRemoving(true);
    try {
      await upiProfileApi.removeProfile({ withdrawConsent: true, source: 'upi_qr_setup' });
      setSavedProfile(null);
      setVpa('');
      setPayeeName('');
      setAmount('');
      setGeneratedFixedAmount(null);
      setNote('');
      setRemoveConfirmOpen(false);
      toast.info('UPI ID Removed', 'Your saved UPI ID was removed. Transaction history was kept intact.');
    } catch (err: any) {
      toast.error('Remove Failed', err?.message || 'Could not remove saved UPI ID.');
    } finally {
      setRemoving(false);
    }
  };

  const handleCopyUri = async () => {
    if (!paymentUri) return;
    try {
      await navigator.clipboard.writeText(paymentUri);
      setIsCopiedUri(true);
      toast.success('Payment Link Copied', 'Paste into any UPI-supported app.');
      setTimeout(() => setIsCopiedUri(false), 2000);
    } catch {
      toast.error('Copy Failed', 'Unable to copy to clipboard.');
    }
  };

  const handleCopyVpa = async () => {
    if (!vpaTrimmed) return;
    try {
      await navigator.clipboard.writeText(vpaTrimmed);
      setIsCopiedVpa(true);
      toast.success('UPI ID Copied', vpaTrimmed);
      setTimeout(() => setIsCopiedVpa(false), 2000);
    } catch {
      toast.error('Copy Failed', 'Unable to copy to clipboard.');
    }
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    const filenameAmount =
      mode === 'fixed' && generatedFixedAmount ? `_INR_${generatedFixedAmount}` : '';
    a.download = `UPI_QR_${vpaTrimmed.replace(/[^a-zA-Z0-9]/g, '_')}${filenameAmount}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('QR Code Downloaded', 'High-resolution PNG saved to your downloads.');
  };

  const handleShare = async () => {
    if (!qrDataUrl) return;

    if (navigator.share) {
      try {
        const res = await fetch(qrDataUrl);
        const blob = await res.blob();
        const file = new File([blob], 'upi-payment-qr.png', { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `Pay ${payeeName || vpaTrimmed} via UPI`,
            text: `Pay ${
              mode === 'fixed' && generatedFixedAmount ? `₹${generatedFixedAmount} ` : ''
            }to ${payeeName || vpaTrimmed} (${vpaTrimmed}) using any UPI app.`,
            files: [file],
          });
          toast.success('Shared', 'UPI QR shared successfully.');
          return;
        }

        await navigator.share({
          title: `Pay ${payeeName || vpaTrimmed} via UPI`,
          text: paymentUri,
        });
        toast.success('Shared', 'UPI payment link shared.');
        return;
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          void handleCopyUri();
        }
        return;
      }
    }

    void handleCopyUri();
  };

  const hasSavedOrInitialVpa = Boolean(vpaTrimmed && isVpaValid);
  const parsedDisplayAmount = generatedFixedAmount ? Number(generatedFixedAmount) : 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Top Banner / Header */}
      <div className="p-6 rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <QrCode className="w-56 h-56" />
        </div>

        <div className="relative z-10 max-w-2xl space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold border border-indigo-500/30">
            <Sparkles className="w-3.5 h-3.5" />
            <span>My Money Manager — a product of HackifyPro</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            UPI QR &amp; Dynamic Amount QR
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Manage your saved UPI ID, display your default QR, or generate amount-based payment QRs compatible with Google Pay, PhonePe, Paytm, BHIM, and all Indian bank UPI apps.
          </p>
        </div>
      </div>

      {/* Critical Payment Safety Disclaimer */}
      <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-amber-800 dark:text-amber-200">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
        <div className="space-y-1 text-xs leading-relaxed">
          <p className="font-bold">Important Payment Safety Notice:</p>
          <p>
            Generating or sharing a UPI QR code does <span className="underline font-bold">NOT</span> confirm that payment was received or automatically update your balances or Udhar ledger. Always verify credited funds in your bank or UPI app before confirming settlement.
          </p>
        </div>
      </div>

      {/* Setup Gate when user has no saved UPI ID */}
      {!loadingProfile && !hasSavedOrInitialVpa ? (
        <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto border border-emerald-200/70 dark:border-emerald-800/60">
            <QrCode className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
              Please set up your UPI ID first.
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Save your UPI ID once with explicit consent to unlock both your default UPI QR and instant amount-based UPI QRs.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => handleOpenSetup('normal')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm cursor-pointer"
            >
              <QrCode className="w-4 h-4" />
              <span>Set UPI ID for Default QR</span>
            </button>
            <button
              type="button"
              onClick={() => handleOpenSetup('fixed')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold cursor-pointer"
            >
              <IndianRupee className="w-4 h-4" />
              <span>Set UPI ID for Amount QR</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Form: Saved UPI ID Management & Amount Controls */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
            {/* Saved UPI Profile Summary */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Saved UPI Identity
                </span>
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate mt-0.5">
                  {payeeName || defaultPayeeName || 'My UPI Account'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400 truncate">
                    {vpaTrimmed || 'Loading...'}
                  </span>
                  {vpaTrimmed && (
                    <button
                      type="button"
                      onClick={handleCopyVpa}
                      className="p-1 rounded text-slate-400 hover:text-emerald-600 cursor-pointer"
                      title="Copy UPI ID"
                    >
                      {isCopiedVpa ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>

              {!initialVpa && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenSetup(mode)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoveConfirmOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-100 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              )}
            </div>

            {/* Mode Cards */}
            <div className="space-y-2.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Choose QR Mode
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  id="btn-generate-normal-qr"
                  onClick={() => {
                    setMode('normal');
                    toast.success('Default UPI QR Active', 'Payer can enter any amount in their UPI app.');
                  }}
                  className={`p-3.5 rounded-2xl border text-left text-xs font-bold transition-all cursor-pointer ${
                    mode === 'normal'
                      ? 'border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 shadow-sm ring-1 ring-indigo-500/30'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-black text-sm">UPI QR (Default)</span>
                    {mode === 'normal' && <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />}
                  </div>
                  <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-1">
                    Open-amount QR using your saved UPI ID.
                  </div>
                </button>

                <button
                  type="button"
                  id="btn-generate-amount-qr"
                  onClick={() => setMode('fixed')}
                  className={`p-3.5 rounded-2xl border text-left text-xs font-bold transition-all cursor-pointer ${
                    mode === 'fixed'
                      ? 'border-emerald-600 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 shadow-sm ring-1 ring-emerald-500/30'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-black text-sm">Generate UPI QR (Amount)</span>
                    {mode === 'fixed' && <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                  </div>
                  <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-1">
                    Fixed-amount payment QR without altering your saved default QR.
                  </div>
                </button>
              </div>
            </div>

            {/* Amount & Note Controls */}
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="upi-qr-amount-input"
                    className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
                  >
                    <IndianRupee className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Amount (INR ₹)</span>
                    <span className={mode === 'fixed' ? 'text-rose-500 font-black' : 'text-slate-400 font-normal'}>
                      {mode === 'fixed' ? '* Required' : '(Used in Amount QR mode)'}
                    </span>
                  </label>
                  {amount && (
                    <span className={`text-[11px] font-bold ${amountValidation.isValid ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {amountValidation.isValid ? formatINR(Number(amountValidation.formatted)) : amountValidation.error}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold">
                    ₹
                  </div>
                  <input
                    id="upi-qr-amount-input"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      if (mode !== 'fixed') setMode('fixed');
                    }}
                    placeholder="e.g. 250"
                    className="block w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Payment Note / Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Udhar settlement / Dinner share"
                  maxLength={80}
                  className="block w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Quick preset amount chips */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-slate-500">Quick Amounts:</span>
              <div className="flex items-center gap-2 flex-wrap">
                {[100, 200, 250, 500, 1000, 2000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setAmount(String(preset));
                      setGeneratedFixedAmount(preset.toFixed(2));
                      setMode('fixed');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-all cursor-pointer"
                  >
                    ₹{preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Dedicated Action Buttons */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleGenerateAmountQr}
                className="py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
              >
                <IndianRupee className="w-4 h-4" />
                <span>Generate Amount QR</span>
              </button>
              <button
                type="button"
                onClick={handleGenerateAnotherQr}
                className="py-3 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Generate Another QR</span>
              </button>
            </div>
          </div>

          {/* Right Preview & Action Column */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col items-center text-center space-y-4">
              <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
                {mode === 'fixed' && parsedDisplayAmount > 0 ? 'Amount-Based UPI QR' : 'Default UPI QR Preview'}
              </h3>

              <div className="w-full max-w-xs bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-800/80 dark:to-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-md space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700">
                  <span className="text-[11px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    BHIM UPI
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">
                    {mode === 'fixed' && parsedDisplayAmount > 0
                      ? `Fixed ₹${parsedDisplayAmount.toLocaleString('en-IN')}`
                      : 'Universal QR'}
                  </span>
                </div>

                {mode === 'fixed' && parsedDisplayAmount > 0 && (
                  <div className="w-full bg-emerald-50 dark:bg-emerald-950/70 border-2 border-emerald-500/50 rounded-xl py-2 px-3 text-center shadow-xs">
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block">
                      Amount to Pay
                    </span>
                    <span className="text-2xl font-black text-emerald-700 dark:text-emerald-300 font-mono tracking-tight">
                      ₹{parsedDisplayAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}

                <div className="bg-white p-3 rounded-xl shadow-inner flex items-center justify-center min-h-[220px]">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="UPI Payment QR Code"
                      className="w-52 h-52 object-contain rounded-lg"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center p-6 text-slate-400 space-y-2">
                      <QrCode className="w-12 h-12 stroke-[1.5]" />
                      <p className="text-xs font-semibold">
                        {mode === 'fixed'
                          ? 'Enter an amount and click Generate Amount QR'
                          : 'Loading your UPI QR...'}
                      </p>
                    </div>
                  )}
                </div>

                {qrDataUrl && (
                  <div className="space-y-1 pt-1">
                    <div className="text-xs font-black text-slate-900 dark:text-slate-100 truncate">
                      {payeeName || defaultPayeeName || 'Verified Payee'}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 truncate">
                      {vpaTrimmed}
                    </div>
                    {note && (
                      <div className="text-[10px] text-slate-400 italic truncate">
                        &ldquo;{note}&rdquo;
                      </div>
                    )}
                  </div>
                )}
              </div>

              {qrDataUrl && (
                <div className="w-full space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download PNG</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleShare}
                      className="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Share2 className="w-4 h-4" />
                      <span>Share QR</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleCopyVpa}
                      className="py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      {isCopiedVpa ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{isCopiedVpa ? 'Copied' : 'Copy UPI ID'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyUri}
                      className="py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      {isCopiedUri ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <ExternalLink className="w-3.5 h-3.5" />}
                      <span>{isCopiedUri ? 'Copied' : 'Copy Pay Link'}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    id="btn-regenerate-qr"
                    onClick={() => {
                      const uri = computePaymentUri();
                      if (!uri) return;
                      setIsGenerating(true);
                      QRCode.toDataURL(uri, {
                        width: 512,
                        margin: 2,
                        errorCorrectionLevel: 'H',
                        color: { dark: '#0f172a', light: '#ffffff' },
                      })
                        .then((url) => {
                          setQrDataUrl(url);
                          setIsGenerating(false);
                          toast.success('QR Refreshed', 'Updated with latest payment parameters.');
                        })
                        .catch(() => setIsGenerating(false));
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                    <span>Refresh QR Code</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsPreviewOpen(true)}
                    className="w-full py-2 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    View Full Screen QR &rarr;
                  </button>
                </div>
              )}
            </div>

            {onNavigate && (
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-500">Need to record debts or loans?</span>
                <button
                  type="button"
                  onClick={() => onNavigate('people')}
                  className="font-bold text-emerald-600 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>Open Udhar</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Setup / Edit UPI Modal */}
      <UpiSetupModal
        isOpen={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
        defaultPayeeName={defaultPayeeName}
        existingProfile={savedProfile}
        source="upi_qr_setup"
        onSaved={handleUpiProfileSaved}
      />

      {/* Remove UPI ID Confirmation Modal */}
      {removeConfirmOpen && createPortal(
        <div
          className="fixed inset-0 z-[90] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !removing && setRemoveConfirmOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Remove Saved UPI ID?</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  This will remove <strong className="font-mono">{savedProfile?.upiId || vpaTrimmed}</strong> from your profile. Your existing transactions remain untouched.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoveConfirmOpen(false)}
                disabled={removing}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemoveSavedUpi}
                disabled={removing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 cursor-pointer"
              >
                {removing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Remove UPI ID
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Full Screen View Modal */}
      {isPreviewOpen && qrDataUrl && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-indigo-600">
                BHIM UPI QR
              </span>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-inner inline-block">
              <img
                src={qrDataUrl}
                alt="UPI QR Code"
                className="w-64 h-64 object-contain mx-auto"
              />
            </div>

            <div className="space-y-1">
              <div className="text-sm font-black text-slate-900 dark:text-slate-100">
                {payeeName || 'Universal Payment QR'}
              </div>
              <div className="text-xs font-mono text-slate-500">{vpaTrimmed}</div>
              {mode === 'fixed' && parsedDisplayAmount > 0 && (
                <div className="text-lg font-black text-emerald-600">
                  ₹{parsedDisplayAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={handleDownload}
                className="py-2.5 px-3 rounded-xl bg-indigo-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download</span>
              </button>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
