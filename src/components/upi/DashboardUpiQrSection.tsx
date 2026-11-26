import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import {
  QrCode,
  IndianRupee,
  Download,
  Share2,
  Copy,
  Check,
  RefreshCw,
  Edit3,
  Trash2,
  X,
  AlertTriangle,
  Info,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { upiProfileApi } from '../../lib/upiProfileApi';
import {
  buildNormalUpiUri,
  buildAmountUpiUri,
  validateAmountForUpiQr,
  type UpiProfileRecord,
} from '../../lib/upiQrUtils';
import { UpiSetupModal } from './UpiSetupModal';

type QrMode = 'normal' | 'amount';

const QrCanvas: React.FC<{ value: string; size: number; level?: 'L' | 'M' | 'Q' | 'H' }> = ({
  value,
  size,
  level = 'M',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;
    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: level,
      color: { dark: '#0f172a', light: '#ffffff' },
    }).catch(() => {});
  }, [value, size, level]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      aria-label="UPI payment QR code"
    />
  );
};

export const DashboardUpiQrSection: React.FC = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UpiProfileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrMode, setQrMode] = useState<QrMode>('normal');
  const [amountInput, setAmountInput] = useState('');
  const [amountNote, setAmountNote] = useState('');
  const [generatedAmount, setGeneratedAmount] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [qrVersion, setQrVersion] = useState(1);
  const [copied, setCopied] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  const qrCanvasWrapperRef = useRef<HTMLDivElement>(null);

  const defaultPayeeName =
    user?.full_name || user?.displayName || user?.email?.split('@')[0] || '';

  const loadUpiProfile = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await upiProfileApi.getProfile();
      if (res.success) {
        setProfile(res.profile || null);
      }
    } catch {
      // Keep UI usable even if transient network error occurs
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadUpiProfile();
    const onChanged = () => {
      void loadUpiProfile();
    };
    window.addEventListener('my-money-upi-profile-changed', onChanged);
    return () => window.removeEventListener('my-money-upi-profile-changed', onChanged);
  }, [loadUpiProfile]);

  const handleOpenMyQr = (mode: QrMode = 'normal') => {
    if (!profile?.upiId) {
      setQrMode(mode);
      setSetupModalOpen(true);
      return;
    }
    setQrMode(mode);
    setAmountError(null);
    if (mode === 'normal') {
      setGeneratedAmount(null);
    }
    setQrModalOpen(true);
  };

  const handleUpiSaved = (saved: UpiProfileRecord) => {
    setProfile(saved);
    setQrVersion((v) => v + 1);
    // Immediately present the generated QR right after first-time setup!
    setQrModalOpen(true);
  };

  const activeQrUri = (() => {
    if (!profile?.upiId) return '';
    try {
      if (qrMode === 'amount' && generatedAmount) {
        return buildAmountUpiUri({
          upiId: profile.upiId,
          payeeName: profile.payeeName || defaultPayeeName,
          amount: generatedAmount,
          paymentNote: amountNote.trim() || profile.paymentNote || 'Payment via My Money Manager',
        });
      }
      return buildNormalUpiUri({
        upiId: profile.upiId,
        payeeName: profile.payeeName || defaultPayeeName,
        paymentNote: profile.paymentNote || 'Payment via My Money Manager',
      });
    } catch {
      return '';
    }
  })();

  const handleGenerateAmountQr = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateAmountForUpiQr(amountInput);
    if (!check.isValid) {
      setAmountError(check.error || 'Enter a valid amount greater than ₹0.');
      setGeneratedAmount(null);
      return;
    }
    setAmountError(null);
    setGeneratedAmount(check.formatted);
    setQrVersion((v) => v + 1);
  };

  const handleCopyUpi = async () => {
    if (!profile?.upiId) return;
    try {
      await navigator.clipboard.writeText(profile.upiId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const buildStyledQrPngBlob = async (): Promise<Blob | null> => {
    const sourceCanvas = qrCanvasWrapperRef.current?.querySelector('canvas');
    if (!sourceCanvas || !profile) return null;

    const out = document.createElement('canvas');
    const width = 640;
    const height = qrMode === 'amount' && generatedAmount ? 820 : 760;
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#059669';
    ctx.fillRect(0, 0, width, 12);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(profile.payeeName || defaultPayeeName || 'My UPI QR', width / 2, 74);

    ctx.fillStyle = '#475569';
    ctx.font = '600 20px monospace';
    ctx.fillText(profile.upiId, width / 2, 110);

    let qrY = 148;
    if (qrMode === 'amount' && generatedAmount) {
      ctx.fillStyle = '#059669';
      ctx.font = 'bold 38px system-ui, -apple-system, sans-serif';
      ctx.fillText(`₹${Number(generatedAmount).toLocaleString('en-IN')}`, width / 2, 168);
      qrY = 200;
    }

    const qrSize = 420;
    ctx.drawImage(sourceCanvas, (width - qrSize) / 2, qrY, qrSize, qrSize);

    ctx.fillStyle = '#64748b';
    ctx.font = '500 18px system-ui, -apple-system, sans-serif';
    ctx.fillText('Scan with GPay, PhonePe, Paytm or any UPI app', width / 2, qrY + qrSize + 48);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 14px system-ui, -apple-system, sans-serif';
    ctx.fillText('My Money Manager by HackifyPro', width / 2, height - 28);

    return new Promise((resolve) => out.toBlob((blob) => resolve(blob), 'image/png'));
  };

  const handleDownloadQr = async () => {
    const blob = await buildStyledQrPngBlob();
    if (!blob || !profile) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const suffix = qrMode === 'amount' && generatedAmount ? `_INR_${generatedAmount}` : '';
    a.download = `UPI_QR_${profile.upiId.replace(/[^a-z0-9]/gi, '_')}${suffix}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleShareQr = async () => {
    if (!profile) return;
    setShareFeedback(null);
    const shareTitle =
      qrMode === 'amount' && generatedAmount
        ? `Pay ₹${generatedAmount} to ${profile.payeeName || profile.upiId}`
        : `UPI Payment QR — ${profile.payeeName || profile.upiId}`;
    const shareText =
      qrMode === 'amount' && generatedAmount
        ? `Pay ₹${generatedAmount} via UPI to ${profile.upiId} (${profile.payeeName || defaultPayeeName}).`
        : `Pay via UPI to ${profile.upiId} (${profile.payeeName || defaultPayeeName}).`;

    try {
      const blob = await buildStyledQrPngBlob();
      const nav = navigator as any;
      if (blob && nav.share && nav.canShare) {
        const file = new File([blob], 'my-upi-qr.png', { type: 'image/png' });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ title: shareTitle, text: shareText, files: [file] });
          return;
        }
      }
      if (nav.share) {
        await nav.share({ title: shareTitle, text: shareText, url: activeQrUri });
        return;
      }
      await navigator.clipboard.writeText(`${shareText} (${activeQrUri})`);
      setShareFeedback('UPI payment link copied to clipboard.');
      setTimeout(() => setShareFeedback(null), 2200);
    } catch {
      // User dismissed share sheet
    }
  };

  const handleRemoveUpi = async () => {
    setRemoving(true);
    try {
      await upiProfileApi.removeProfile({ withdrawConsent: true, source: 'upi_qr_setup' });
      setProfile(null);
      setGeneratedAmount(null);
      setAmountInput('');
      setRemoveConfirmOpen(false);
      setQrModalOpen(false);
    } finally {
      setRemoving(false);
    }
  };

  const previewUri = profile?.upiId
    ? buildNormalUpiUri({
        upiId: profile.upiId,
        payeeName: profile.payeeName || defaultPayeeName,
        paymentNote: profile.paymentNote,
      })
    : '';

  return (
    <div className="!mt-0">
      {/* Visually connected UPI QR strip directly below Available Balance */}
      <div
        data-testid="dashboard-upi-qr-section"
        className="-mt-2 pt-4 pb-3.5 px-4 sm:px-5 rounded-b-2xl rounded-t-lg bg-white dark:bg-slate-900 border border-t-0 border-slate-200/90 dark:border-slate-800 shadow-sm transition-colors"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          {/* Left: Icon / Compact Saved QR Preview + Copy */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => handleOpenMyQr('normal')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleOpenMyQr('normal');
              }
            }}
            className="flex items-center gap-3.5 cursor-pointer group min-w-0 flex-1"
          >
            {profile?.upiId && previewUri ? (
              <div className="p-1.5 rounded-xl bg-white border border-slate-200 dark:border-slate-700 shadow-xs shrink-0 group-hover:border-emerald-400 transition-colors">
                <QrCanvas value={previewUri} size={44} level="M" />
              </div>
            ) : (
              <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/70 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <QrCode className="w-5 h-5" />
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">
                  UPI QR
                </h3>
                {profile?.upiId && (
                  <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 truncate max-w-[180px] sm:max-w-[240px]">
                    {profile.upiId}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {loading
                  ? 'Checking your UPI QR settings...'
                  : profile?.upiId
                  ? `Ready to receive payments as ${profile.payeeName || defaultPayeeName}`
                  : 'Receive payments using your UPI ID'}
              </p>
            </div>
          </div>

          {/* Right: Action Buttons */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {profile?.upiId ? (
              <>
                <button
                  type="button"
                  onClick={() => handleOpenMyQr('normal')}
                  data-testid="dashboard-generate-my-qr-btn"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Show My QR</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenMyQr('amount')}
                  data-testid="dashboard-generate-amount-qr-btn"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 transition-colors"
                >
                  <IndianRupee className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Amount QR</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => handleOpenMyQr('normal')}
                data-testid="dashboard-generate-my-qr-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Generate My QR</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* First-Time / Edit Setup Modal */}
      <UpiSetupModal
        isOpen={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
        defaultPayeeName={defaultPayeeName}
        existingProfile={profile}
        source="upi_qr_setup"
        onSaved={handleUpiSaved}
      />

      {/* Active UPI QR Viewer & Amount QR Modal */}
      {qrModalOpen && profile && createPortal(
        <div
          className="fixed inset-0 z-[80] bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setQrModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            data-testid="upi-qr-viewer-modal"
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                  <QrCode className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">My UPI QR</h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    My Money Manager by HackifyPro
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Option A / Option B Mode Switcher */}
            <div className="px-5 pt-4">
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setQrMode('normal');
                    setAmountError(null);
                  }}
                  data-testid="upi-tab-normal"
                  className={`py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                    qrMode === 'normal'
                      ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Normal UPI QR
                </button>
                <button
                  type="button"
                  onClick={() => setQrMode('amount')}
                  data-testid="upi-tab-amount"
                  className={`py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                    qrMode === 'amount'
                      ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Generate Amount QR
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Option B: Fixed Amount Form */}
              {qrMode === 'amount' && (
                <form onSubmit={handleGenerateAmountQr} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                      Enter Amount (INR) <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <IndianRupee className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={amountInput}
                        onChange={(e) => setAmountInput(e.target.value)}
                        data-testid="upi-amount-input"
                        placeholder="e.g. 500"
                        className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                      />
                    </div>
                    {amountError && (
                      <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                        {amountError}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={amountNote}
                      onChange={(e) => setAmountNote(e.target.value)}
                      maxLength={60}
                      placeholder="Optional note (e.g. Room rent share)"
                      className="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                    <button
                      type="submit"
                      data-testid="upi-amount-generate-btn"
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Generate
                    </button>
                  </div>
                </form>
              )}

              {/* QR Display Card */}
              {(qrMode === 'normal' || generatedAmount) && activeQrUri ? (
                <div className="flex flex-col items-center text-center bg-slate-50 dark:bg-slate-800/70 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-700/80">
                  {qrMode === 'amount' && generatedAmount && (
                    <div
                      data-testid="upi-amount-banner"
                      className="mb-3 px-4 py-1.5 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                        Requested Amount
                      </p>
                      <p className="text-2xl font-extrabold text-emerald-800 dark:text-emerald-300 tabular-nums">
                        ₹{Number(generatedAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  )}

                  <div
                    ref={qrCanvasWrapperRef}
                    className="p-3.5 bg-white rounded-2xl shadow-sm border border-slate-200"
                  >
                    <QrCanvas
                      key={`${qrMode}-${generatedAmount || 'any'}-${qrVersion}`}
                      value={activeQrUri}
                      size={208}
                      level="H"
                    />
                  </div>

                  <p className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                    {profile.payeeName || defaultPayeeName}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-xs font-mono text-slate-600 dark:text-slate-300">
                      {profile.upiId}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyUpi}
                      data-testid="upi-copy-id-btn"
                      className="p-1 rounded-md text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
                      title="Copy UPI ID"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {qrMode === 'amount' && (
                    <div className="mt-3 flex items-start gap-2 text-left text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 rounded-xl px-3 py-2">
                      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        Payment request only — scanning or sharing this QR does not automatically confirm payment or increase your Available Balance.
                      </span>
                    </div>
                  )}

                  {shareFeedback && (
                    <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      {shareFeedback}
                    </p>
                  )}

                  {/* Primary QR Actions */}
                  <div className="mt-4 grid grid-cols-2 gap-2 w-full">
                    <button
                      type="button"
                      onClick={handleDownloadQr}
                      data-testid="upi-download-btn"
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download QR
                    </button>
                    <button
                      type="button"
                      onClick={handleShareQr}
                      data-testid="upi-share-btn"
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Share QR
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 px-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                  Enter an amount above and click <strong>Generate</strong> to create a fixed-amount UPI QR code.
                </div>
              )}

              {/* Management Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQrVersion((v) => v + 1)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQrModalOpen(false);
                      setSetupModalOpen(true);
                    }}
                    data-testid="upi-edit-details-btn"
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Edit UPI Details
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setRemoveConfirmOpen(true)}
                  data-testid="upi-remove-btn"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 px-2.5 py-1 rounded-lg"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove UPI ID
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Styled Remove Confirmation Modal */}
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
                  This will delete <strong className="font-mono">{profile?.upiId}</strong> from your account and withdraw your UPI QR storage consent. You can set it up again anytime.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoveConfirmOpen(false)}
                disabled={removing}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemoveUpi}
                disabled={removing}
                data-testid="upi-confirm-remove-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
              >
                {removing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Remove & Withdraw Consent
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
