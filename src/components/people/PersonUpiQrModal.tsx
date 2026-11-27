import React, { useState, useEffect, useRef, useMemo } from 'react';
import QRCode from 'qrcode';
import {
  X,
  QrCode,
  IndianRupee,
  Copy,
  Check,
  Download,
  Share2,
  ExternalLink,
  AlertCircle,
  Loader2,
  ShieldCheck,
  User,
  Info,
  Smartphone,
} from 'lucide-react';
import { udharDeletionApi } from '../../lib/udharDeletionApi';
import { useToast } from '../../context/ToastContext';
import { buildNormalUpiUri, buildAmountUpiUri, validateAmountForUpiQr, copyTextToClipboard } from '../../lib/upiQrUtils';
import { formatINR } from '../../lib/dateUtils';

export interface PersonUpiQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  personName: string;
  contactId?: string | null;
  linkedUserId?: string | null;
  suggestedAmount?: number | null; // e.g. amount user owes this person
}

interface PersonUpiProfileState {
  hasUpi: boolean;
  upiId?: string;
  payeeName?: string;
  paymentNote?: string;
  targetUserId?: string;
  recipientName?: string;
  avatarUrl?: string | null;
  isManualContact?: boolean;
  message?: string;
}

export const PersonUpiQrModal: React.FC<PersonUpiQrModalProps> = ({
  isOpen,
  onClose,
  personName,
  contactId,
  linkedUserId,
  suggestedAmount,
}) => {
  const toast = useToast();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [profile, setProfile] = useState<PersonUpiProfileState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Payment amount & QR code state
  const [amount, setAmount] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedUpi, setCopiedUpi] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isLaunchingApp, setIsLaunchingApp] = useState<boolean>(false);
  const [showAppNotice, setShowAppNotice] = useState<boolean>(false);

  const amountInputRef = useRef<HTMLInputElement>(null);

  // Initialize and fetch profile on open
  useEffect(() => {
    if (!isOpen) {
      setProfile(null);
      setError(null);
      setAmount('');
      setQrDataUrl(null);
      setShowAppNotice(false);
      return;
    }

    // Prefill suggested amount if user owes money to this person (> 0)
    if (suggestedAmount && suggestedAmount > 0) {
      setAmount(String(Math.round(suggestedAmount)));
    } else {
      setAmount('');
    }

    let isCancelled = false;

    const loadProfile = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const identifier = linkedUserId || contactId || personName;
        const res = await udharDeletionApi.getPersonUpiProfile(identifier);
        if (isCancelled) return;

        if (res.success) {
          setProfile(res);
        } else {
          setError(res.message || 'Unable to retrieve UPI profile for this person.');
        }
      } catch (err: any) {
        if (isCancelled) return;
        setError(err.message || 'Failed to fetch person UPI details.');
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadProfile();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, personName, contactId, linkedUserId, suggestedAmount]);

  // Verified recipient details
  const verifiedUpiId = profile?.hasUpi && profile.upiId ? profile.upiId.trim() : null;
  const verifiedRecipientName = (profile?.payeeName || profile?.recipientName || personName).trim();

  // Computed UPI payment URI based on verified UPI ID and optional amount
  const computedUpiUri = useMemo(() => {
    if (!verifiedUpiId) return '';
    try {
      const parsedAmt = parseFloat(amount);
      if (!isNaN(parsedAmt) && parsedAmt > 0) {
        const amtValidation = validateAmountForUpiQr(parsedAmt);
        if (amtValidation.isValid) {
          return buildAmountUpiUri({
            upiId: verifiedUpiId,
            payeeName: verifiedRecipientName,
            amount: amtValidation.formatted,
            paymentNote: `Udhar payment to ${verifiedRecipientName}`,
          });
        }
      }
      return buildNormalUpiUri({
        upiId: verifiedUpiId,
        payeeName: verifiedRecipientName,
        paymentNote: `Udhar payment to ${verifiedRecipientName}`,
      });
    } catch {
      return '';
    }
  }, [verifiedUpiId, verifiedRecipientName, amount]);

  // Generate QR code canvas data URL dynamically whenever URI changes
  useEffect(() => {
    if (!computedUpiUri) {
      setQrDataUrl(null);
      return;
    }

    let isSubscribed = true;
    QRCode.toDataURL(computedUpiUri, {
      width: 360,
      margin: 1,
      color: {
        dark: '#0f172a', // slate-900 for high-contrast scanning
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (isSubscribed) setQrDataUrl(url);
      })
      .catch((err) => {
        console.error('Failed to generate person UPI QR:', err);
      });

    return () => {
      isSubscribed = false;
    };
  }, [computedUpiUri]);

  if (!isOpen) return null;

  // Handle 1-tap Copy UPI ID
  const handleCopyUpiId = async () => {
    if (!verifiedUpiId) return;
    const ok = await copyTextToClipboard(verifiedUpiId);
    if (ok) {
      setCopiedUpi(true);
      toast.success('UPI ID Copied', `${verifiedUpiId} copied to clipboard.`);
      setTimeout(() => setCopiedUpi(false), 2500);
    }
  };

  // Handle 1-tap Copy UPI Link
  const handleCopyUpiLink = async () => {
    if (!computedUpiUri) return;
    const ok = await copyTextToClipboard(computedUpiUri);
    if (ok) {
      setCopiedLink(true);
      toast.success('Payment Link Copied', 'UPI payment link copied to clipboard.');
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  // Handle Pay button (Open installed UPI App)
  const handlePay = () => {
    if (!computedUpiUri || !verifiedUpiId) {
      toast.error('UPI ID Not Available', 'Cannot initiate payment without a valid UPI ID.');
      return;
    }

    setIsLaunchingApp(true);
    setShowAppNotice(true);

    // Deep-link launch via standard upi:// protocol handler
    try {
      window.location.href = computedUpiUri;
    } catch (err) {
      console.warn('Direct location.href deep-link error:', err);
    }

    // Reset button state after brief transition
    setTimeout(() => {
      setIsLaunchingApp(false);
    }, 1500);
  };

  // Download QR Code as PNG
  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    const safeName = verifiedRecipientName.replace(/[^a-zA-Z0-9_-]/g, '_');
    link.download = `UPI_QR_${safeName}.png`;
    link.href = qrDataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('QR Code Downloaded', `Saved UPI QR for ${verifiedRecipientName}.`);
  };

  // Share QR or Payment Details via Web Share API
  const handleShare = async () => {
    if (!verifiedUpiId) return;
    const parsedAmt = parseFloat(amount);
    const amountText = !isNaN(parsedAmt) && parsedAmt > 0 ? ` for ₹${parsedAmt.toLocaleString('en-IN')}` : '';
    const shareText = `Pay ${verifiedRecipientName}${amountText} via UPI: ${verifiedUpiId}\n${computedUpiUri}`;

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `UPI Payment to ${verifiedRecipientName}`,
          text: shareText,
          url: computedUpiUri,
        });
        toast.success('Shared', 'Payment details shared.');
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
      }
    }
    // Fallback: copy link
    await handleCopyUpiLink();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/65 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div
        className="w-full sm:max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[88vh] transition-all"
        role="dialog"
        aria-modal="true"
        aria-labelledby="person-upi-modal-title"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
              <QrCode className="w-5 h-5 stroke-[2]" />
            </div>
            <div className="min-w-0">
              <h3 id="person-upi-modal-title" className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                Pay via UPI · {personName}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Direct UPI QR &amp; App Payment
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1">
          {/* 1. LOADING STATE */}
          {isLoading && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Fetching verified UPI details for {personName}...
              </p>
            </div>
          )}

          {/* 2. ERROR STATE */}
          {!isLoading && error && (
            <div className="p-5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 text-center space-y-2.5">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
              <h4 className="text-xs font-bold text-rose-800 dark:text-rose-200">
                Unable to Load UPI Details
              </h4>
              <p className="text-[11px] text-rose-600 dark:text-rose-400 leading-relaxed">
                {error}
              </p>
            </div>
          )}

          {/* 3. MISSING UPI ID STATE (hasUpi === false) */}
          {!isLoading && !error && profile && !profile.hasUpi && (
            <div className="py-6 px-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-center space-y-3.5">
              <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center mx-auto shadow-sm border border-amber-300 dark:border-amber-800">
                <QrCode className="w-7 h-7 stroke-[1.75]" />
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  UPI ID not available
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  <strong>{personName}</strong> has not configured a verified UPI ID on My Money Manager yet.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/50 text-left flex items-start gap-2.5">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
                  Ask {personName} to save their UPI ID in <strong>My Account → Profile &amp; UPI Settings</strong>. Once saved, their UPI QR code will appear here automatically.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          )}

          {/* 4. ACTIVE PROFILE OWNER UPI QR & PAY CONTROLS */}
          {!isLoading && !error && profile && profile.hasUpi && verifiedUpiId && (
            <div className="space-y-4">
              {/* Recipient Profile Card */}
              <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/50 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {profile.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt={verifiedRecipientName}
                      className="w-10 h-10 rounded-xl object-cover border border-emerald-300 dark:border-emerald-700"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white font-bold text-sm flex items-center justify-center shrink-0 shadow-xs">
                      {verifiedRecipientName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate">
                        {verifiedRecipientName}
                      </span>
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                        <ShieldCheck className="w-2.5 h-2.5" />
                        <span>Verified Payee</span>
                      </span>
                    </div>
                    <p className="font-mono text-xs text-emerald-700 dark:text-emerald-400 font-semibold truncate mt-0.5 select-all">
                      {verifiedUpiId}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCopyUpiId}
                  className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                  title="Copy UPI ID"
                >
                  {copiedUpi ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-600 font-bold">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* High-Resolution Scannable UPI QR Box */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 shadow-sm flex flex-col items-center justify-center text-center space-y-2">
                <div className="p-3 bg-white rounded-2xl shadow-inner border border-slate-100">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt={`UPI QR code for ${verifiedRecipientName}`}
                      className="w-52 h-52 sm:w-56 sm:h-56 object-contain rounded-lg"
                    />
                  ) : (
                    <div className="w-52 h-52 flex items-center justify-center text-slate-300">
                      <QrCode className="w-16 h-16" />
                    </div>
                  )}
                </div>

                <div className="text-center pt-1">
                  <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1">
                    <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Scan with GPay, PhonePe, Paytm, or any UPI App</span>
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                    NPCI Standard UPI QR · Scannable on all devices
                  </p>
                </div>
              </div>

              {/* Optional Amount Input Field */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="person-upi-amount-input" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Payment Amount <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  {amount && parseFloat(amount) > 0 && (
                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                      Amount locked in QR: ₹{parseFloat(amount).toLocaleString('en-IN')}
                    </span>
                  )}
                </div>

                <div className="relative flex items-center rounded-xl border-2 border-slate-200 dark:border-slate-700 focus-within:border-emerald-500 bg-slate-50/50 dark:bg-slate-800/40 transition-colors">
                  <span className="pl-3.5 text-base font-bold text-slate-500 select-none">
                    ₹
                  </span>
                  <input
                    ref={amountInputRef}
                    id="person-upi-amount-input"
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*[.,]?[0-9]*"
                    autoComplete="off"
                    value={amount}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      const parts = val.split('.');
                      if (parts.length > 2) return;
                      setAmount(val);
                    }}
                    placeholder="Enter amount (or leave blank to specify in UPI app)"
                    className="w-full py-2.5 px-2 text-sm font-bold bg-transparent text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none tabular-nums"
                  />
                  {amount && (
                    <button
                      type="button"
                      onClick={() => setAmount('')}
                      className="mr-3 p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                      title="Clear amount"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Quick amount suggestion chips */}
                <div className="flex items-center gap-1.5 pt-0.5 overflow-x-auto pb-1 no-scrollbar">
                  {suggestedAmount && suggestedAmount > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(Math.round(suggestedAmount)))}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 shrink-0 cursor-pointer"
                    >
                      Due: {formatINR(suggestedAmount)}
                    </button>
                  )}
                  {[100, 200, 500, 1000, 2000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setAmount(String(amt))}
                      className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0 cursor-pointer transition-colors"
                    >
                      +₹{amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pay Button (Primary Action - Deep-Link Launch) */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={handlePay}
                  disabled={isLaunchingApp}
                  className="w-full py-3.5 px-4 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                >
                  <ExternalLink className="w-4 h-4 stroke-[2.2]" />
                  <span>
                    {amount && parseFloat(amount) > 0
                      ? `Pay ₹${parseFloat(amount).toLocaleString('en-IN')} via UPI App`
                      : 'Pay via UPI App'}
                  </span>
                </button>

                {/* Secondary QR Actions: Download & Share */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadQr}
                    className="py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700 cursor-pointer transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download QR</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleShare}
                    className="py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700 cursor-pointer transition-colors"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share QR / Link</span>
                  </button>
                </div>

                {/* Helpful App Notice when tapped */}
                {showAppNotice && (
                  <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    📱 <strong>UPI app not opening?</strong> On desktop or unsupported browsers, scan the QR code above directly from your mobile camera or any UPI app.
                  </div>
                )}
              </div>

              {/* Crucial Security / Ledger Sync Notice */}
              <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                  <strong>Important:</strong> Launching a UPI app does not automatically record or mark an Udhar transaction as paid. After completing payment in your UPI app, return here and record repayment or tap <strong>Settle Full</strong> so both accounts stay in sync.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
