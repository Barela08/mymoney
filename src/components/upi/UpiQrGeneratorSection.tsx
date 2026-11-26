import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import {
  QrCode,
  Download,
  Share2,
  Copy,
  Check,
  ShieldCheck,
  AlertTriangle,
  Info,
  RefreshCw,
  ExternalLink,
  IndianRupee,
  Sparkles,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { formatINR } from '../../lib/dateUtils';

interface UpiQrGeneratorSectionProps {
  initialVpa?: string;
  initialPayeeName?: string;
  initialAmount?: number | string;
  initialNote?: string;
  onNavigate?: (tab: any) => void;
}

const UPI_ID_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

export const UpiQrGeneratorSection: React.FC<UpiQrGeneratorSectionProps> = ({
  initialVpa = '',
  initialPayeeName = '',
  initialAmount = '',
  initialNote = '',
  onNavigate,
}) => {
  const toast = useToast();

  const [vpa, setVpa] = useState<string>(initialVpa);
  const [payeeName, setPayeeName] = useState<string>(initialPayeeName);
  const [amount, setAmount] = useState<string>(
    initialAmount ? String(initialAmount) : ''
  );
  const [note, setNote] = useState<string>(initialNote);
  const [mode, setMode] = useState<'fixed' | 'normal'>(
    initialAmount ? 'fixed' : 'normal'
  );

  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [paymentUri, setPaymentUri] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isCopiedUri, setIsCopiedUri] = useState<boolean>(false);
  const [isCopiedVpa, setIsCopiedVpa] = useState<boolean>(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);

  // Validation states
  const vpaTrimmed = vpa.trim();
  const isVpaValid = UPI_ID_REGEX.test(vpaTrimmed);
  const numAmount = parseFloat(amount);
  const isAmountValid =
    mode === 'normal' || (!isNaN(numAmount) && numAmount > 0);

  // Build the official UPI specification URI
  const generateUpiUri = (): string => {
    if (!vpaTrimmed || !isVpaValid) return '';
    const params = new URLSearchParams();
    params.set('pa', vpaTrimmed);

    const name = payeeName.trim();
    if (name) params.set('pn', name);

    params.set('cu', 'INR');

    if (mode === 'fixed' && !isNaN(numAmount) && numAmount > 0) {
      params.set('am', numAmount.toFixed(2));
    }

    const cleanNote = note.trim();
    if (cleanNote) {
      params.set('tn', cleanNote.slice(0, 80));
    }

    return `upi://pay?${params.toString()}`;
  };

  // Re-generate QR whenever relevant fields change
  useEffect(() => {
    let active = true;
    if (!vpaTrimmed || !isVpaValid || (mode === 'fixed' && !isAmountValid)) {
      setQrDataUrl('');
      setPaymentUri('');
      return;
    }

    const uri = generateUpiUri();
    setPaymentUri(uri);
    setIsGenerating(true);

    QRCode.toDataURL(uri, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) {
          setQrDataUrl(url);
          setIsGenerating(false);
        }
      })
      .catch((err) => {
        if (active) {
          console.error('Failed to generate UPI QR:', err);
          setIsGenerating(false);
        }
      });

    return () => {
      active = false;
    };
  }, [vpaTrimmed, isVpaValid, payeeName, amount, note, mode, isAmountValid]);

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
      mode === 'fixed' && numAmount > 0 ? `_INR_${Math.round(numAmount)}` : '';
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
            text: `Pay ₹${mode === 'fixed' && numAmount ? numAmount.toFixed(2) : ''} to ${payeeName || vpaTrimmed} (${vpaTrimmed}) using any UPI app (GPay, PhonePe, Paytm, BHIM).`,
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
          handleCopyUri();
        }
        return;
      }
    }

    handleCopyUri();
  };

  const handleReset = () => {
    setVpa('');
    setPayeeName('');
    setAmount('');
    setNote('');
    setMode('normal');
  };

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
            <span>Official NPCI Standard UPI QR</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Universal UPI Payment QR Generator
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Generate custom, scan-and-pay UPI QR codes compatible with Google Pay,
            PhonePe, Paytm, BHIM, CRED, and all Indian bank UPI apps.
          </p>
        </div>
      </div>

      {/* Critical Payment Safety Disclaimer */}
      <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-amber-800 dark:text-amber-200">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
        <div className="space-y-1 text-xs leading-relaxed">
          <p className="font-bold">
            Important Payment Safety Notice (सुरक्षा सूचना):
          </p>
          <p>
            Generating or scanning a UPI QR code does <span className="underline font-bold">NOT</span> confirm that money has been received.
            Always open your actual banking app or SMS alert to confirm credited funds before handing over cash or marking Udhar as settled.
            The system <span className="font-bold">never</span> automatically settles any financial transactions from generating a QR code.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Form: Inputs & Configuration */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-slate-100">
                Payment Details
              </h2>
              <p className="text-xs text-slate-500">
                Enter your VPA (UPI ID) and optional transaction parameters
              </p>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 font-semibold cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>

          {/* Mode Selector: Normal vs Fixed Amount */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              QR Type / Mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('normal')}
                className={`p-3 rounded-2xl border text-left text-xs font-bold transition-all cursor-pointer ${
                  mode === 'normal'
                    ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="font-bold">Normal QR (Open Amount)</div>
                <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                  Payer enters any amount in their UPI app
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode('fixed')}
                className={`p-3 rounded-2xl border text-left text-xs font-bold transition-all cursor-pointer ${
                  mode === 'fixed'
                    ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="font-bold">Fixed Amount QR</div>
                <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                  Pre-fills exact rupee amount for instant payment
                </div>
              </button>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            {/* UPI ID (VPA) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Receiver UPI ID (VPA) <span className="text-rose-500">*</span>
                </label>
                {vpaTrimmed && (
                  <span
                    className={`text-[11px] font-bold ${
                      isVpaValid ? 'text-emerald-600' : 'text-rose-500'
                    }`}
                  >
                    {isVpaValid ? '✓ Valid UPI format' : '✗ Invalid UPI ID format'}
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={vpa}
                  onChange={(e) => setVpa(e.target.value.toLowerCase().trim())}
                  placeholder="e.g. yourname@okhdfcbank or 9876543210@paytm"
                  className={`block w-full px-3.5 py-2.5 rounded-xl border text-xs font-mono transition-all ${
                    vpaTrimmed && !isVpaValid
                      ? 'border-rose-300 focus:ring-rose-500 bg-rose-50/30'
                      : 'border-slate-300 dark:border-slate-700 focus:ring-indigo-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  }`}
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Format: username@bank (e.g. mobile@ybl, name@oksbi, business@okaxis)
              </p>
            </div>

            {/* Payee Name */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Payee / Beneficiary Name (Optional)
              </label>
              <input
                type="text"
                value={payeeName}
                onChange={(e) => setPayeeName(e.target.value)}
                placeholder="e.g. Nilesh Barela / My Store"
                maxLength={60}
                className="block w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:ring-indigo-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Displays on payer's screen before they confirm the payment
              </p>
            </div>

            {/* Amount (Only if Fixed mode) */}
            {mode === 'fixed' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Exact Amount (INR ₹) <span className="text-rose-500">*</span>
                  </label>
                  {amount && (
                    <span
                      className={`text-[11px] font-bold ${
                        isAmountValid ? 'text-emerald-600' : 'text-rose-500'
                      }`}
                    >
                      {isAmountValid
                        ? formatINR(numAmount)
                        : 'Enter a valid amount > ₹0'}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold">
                    ₹
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 500"
                    className="block w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}

            {/* Transaction Note */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Transaction Note / Remarks (Optional)
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
          {mode === 'fixed' && (
            <div className="space-y-1.5 pt-2">
              <span className="text-[11px] font-bold text-slate-500">Quick Amounts:</span>
              <div className="flex items-center gap-2 flex-wrap">
                {[100, 200, 500, 1000, 2000, 5000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(String(preset))}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-all cursor-pointer"
                  >
                    ₹{preset}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Preview & Action Column */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col items-center text-center space-y-4">
            <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
              Live QR Preview
            </h3>

            {/* QR Card Presentation */}
            <div className="w-full max-w-xs bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-800/80 dark:to-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-md space-y-3">
              {/* Card Header with UPI Branding */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700">
                <span className="text-[11px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  BHIM UPI
                </span>
                <span className="text-[10px] font-bold text-slate-400">
                  {mode === 'fixed' && numAmount ? `Fixed ₹${numAmount}` : 'Universal QR'}
                </span>
              </div>

              {/* QR Image Container */}
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
                      {vpaTrimmed
                        ? 'Enter a valid UPI format'
                        : 'Enter your UPI ID to generate QR'}
                    </p>
                  </div>
                )}
              </div>

              {/* Payee Info on Card */}
              {qrDataUrl && (
                <div className="space-y-1 pt-1">
                  <div className="text-xs font-black text-slate-900 dark:text-slate-100 truncate">
                    {payeeName || 'Verified Payee'}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 truncate">
                    {vpaTrimmed}
                  </div>
                  {mode === 'fixed' && numAmount > 0 && (
                    <div className="text-base font-black text-emerald-600 dark:text-emerald-400 pt-1">
                      ₹{numAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                  )}
                  {note && (
                    <div className="text-[10px] text-slate-400 italic truncate">
                      "{note}"
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons */}
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
                  onClick={() => setIsPreviewOpen(true)}
                  className="w-full py-2 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  View Full Screen QR Modal &rarr;
                </button>
              </div>
            )}
          </div>

          {/* Quick link back to Udhar or Calculator */}
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

      {/* Full Screen View Modal */}
      {isPreviewOpen && qrDataUrl && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-indigo-600">
                BHIM UPI QR
              </span>
              <button
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
              {mode === 'fixed' && numAmount > 0 && (
                <div className="text-lg font-black text-emerald-600">
                  ₹{numAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
