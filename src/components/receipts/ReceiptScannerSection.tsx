import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Camera,
  Upload,
  ScanLine,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Trash2,
  Sparkles,
  FileText,
  Save,
  X,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { aiFinanceApi, ApiClientError, ReceiptRecord } from '../../lib/aiFinanceApi';
import {
  categorizeTransactionDeterministic,
  detectDuplicateReceipt,
  getDisplayCategoryLabel,
  ReceiptOcrExtraction,
  UserCategorizationRule,
  validateReceiptUpload,
} from '../../lib/financialIntelligenceEngine';
import { getCurrentISTDate, getCurrentISTTime, formatINR } from '../../lib/dateUtils';
import { TransactionCategory, TransactionSubcategory } from '../../types';

const SUBCATEGORIES_BY_CAT: Record<'food' | 'room' | 'other', Array<{ id: TransactionSubcategory; label: string }>> = {
  food: [
    { id: 'restaurant', label: 'Restaurant / Dining' },
    { id: 'delivery', label: 'Swiggy / Zomato' },
    { id: 'snacks', label: 'Fast Food / Snacks' },
    { id: 'beverages', label: 'Chai / Coffee' },
    { id: 'mess_tiffin', label: 'Mess / Tiffin' },
    { id: 'other_food', label: 'Other Food' },
  ],
  room: [
    { id: 'grocery', label: 'Groceries' },
    { id: 'rent', label: 'Room Rent' },
    { id: 'electricity', label: 'Electricity' },
    { id: 'gas', label: 'Gas / LPG' },
  ],
  other: [
    { id: 'shopping', label: 'Shopping' },
    { id: 'travel', label: 'Travel & Fuel' },
    { id: 'bills', label: 'Bills & Recharge' },
    { id: 'health', label: 'Medical & Health' },
    { id: 'entertainment', label: 'Entertainment' },
    { id: 'personal_care', label: 'Personal Care' },
    { id: 'education', label: 'Education' },
    { id: 'other_general', label: 'General Other' },
  ],
};

export const ReceiptScannerSection: React.FC = () => {
  const { transactions, addTransaction } = useExpense();
  const toast = useToast();

  const [ocrSupported, setOcrSupported] = useState<boolean | null>(null);
  const [knownReceipts, setKnownReceipts] = useState<ReceiptRecord[]>([]);
  const [userRules, setUserRules] = useState<UserCategorizationRule[]>([]);

  // Image & Camera state
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [fileHash, setFileHash] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [ocrError, setOcrError] = useState<{ message: string; code?: string } | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Camera stream refs
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Editable review form (NEVER auto-saved without user confirmation)
  const [merchant, setMerchant] = useState('');
  const [receiptDate, setReceiptDate] = useState(getCurrentISTDate());
  const [receiptTime, setReceiptTime] = useState(getCurrentISTTime().slice(0, 5));
  const [totalAmount, setTotalAmount] = useState('');
  const [subtotal, setSubtotal] = useState('');
  const [tax, setTax] = useState('');
  const [discount, setDiscount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [items, setItems] = useState<Array<{ name: string; quantity?: number; price?: number }>>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [category, setCategory] = useState<'food' | 'room' | 'other'>('other');
  const [subcategory, setSubcategory] = useState<TransactionSubcategory>('shopping');
  const [notes, setNotes] = useState('');
  const [suggestedCategoryLabel, setSuggestedCategoryLabel] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      aiFinanceApi.getAiStatus().catch(() => null),
      aiFinanceApi.getReceiptRecords().catch(() => []),
      aiFinanceApi.getCategorizationRules().catch(() => []),
    ]).then(([status, receipts, rules]) => {
      if (status) setOcrSupported(status.ocrSupported);
      setKnownReceipts(receipts);
      setUserRules(rules);
    });
  }, []);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Camera access is not supported in this browser. Please upload an image instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setIsCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      setCameraError('Camera permission denied or unavailable. You can upload a receipt photo instead.');
    }
  };

  const captureFromCamera = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const maxDim = 1400;
    let w = video.videoWidth;
    let h = video.videoHeight;
    if (w > h && w > maxDim) {
      h = Math.round((h * maxDim) / w);
      w = maxDim;
    } else if (h > maxDim) {
      w = Math.round((w * maxDim) / h);
      h = maxDim;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      stopCamera();
      setImageDataUrl(dataUrl);
      runOcrScan(dataUrl);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateReceiptUpload(file.type, file.size);
    if (!validation.valid) {
      toast.error('Invalid receipt file', validation.error || 'Please choose a valid image.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_DIM = 1400;
        let width = img.width;
        let height = img.height;
        if (width > height && width > MAX_DIM) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else if (height > MAX_DIM) {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.85);
          setImageDataUrl(compressed);
          runOcrScan(compressed);
        }
      };
      img.onerror = () => {
        toast.error('Unreadable image', 'Could not decode this image file.');
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const applyExtraction = (ext: ReceiptOcrExtraction) => {
    setMerchant(ext.merchant || '');
    setReceiptDate(ext.receiptDate || getCurrentISTDate());
    setReceiptTime(ext.receiptTime || getCurrentISTTime().slice(0, 5));
    setTotalAmount(ext.totalAmount !== null ? String(ext.totalAmount) : '');
    setSubtotal(ext.subtotal !== null ? String(ext.subtotal) : '');
    setTax(ext.tax !== null ? String(ext.tax) : '');
    setDiscount(ext.discount !== null ? String(ext.discount) : '');
    setPaymentMethod(ext.paymentMethod || 'UPI');
    setReceiptNumber(ext.receiptNumber || '');
    setItems(ext.items || []);
    setConfidence(ext.confidence);
    if (ext.rawNotes) setNotes(ext.rawNotes);

    // Apply Smart Categorization to extracted merchant & items
    const suggestion = categorizeTransactionDeterministic(
      {
        merchant: ext.merchant,
        title: ext.merchant,
        description: ext.items.map((i) => i.name).join(', '),
        amount: ext.totalAmount ?? undefined,
      },
      userRules,
      transactions
    );

    if (suggestion && (suggestion.category === 'food' || suggestion.category === 'room' || suggestion.category === 'other')) {
      setCategory(suggestion.category);
      setSubcategory(suggestion.subcategory);
      setSuggestedCategoryLabel(suggestion.displayCategory);
    }
  };

  const runOcrScan = async (dataUrl: string) => {
    setIsScanning(true);
    setOcrError(null);
    setHasScanned(false);
    try {
      const res = await aiFinanceApi.scanReceiptOcr(dataUrl);
      setFileHash(res.fileHash || '');
      applyExtraction(res.extraction);
      setHasScanned(true);
      toast.success('Receipt scanned', 'Review and confirm extracted details before saving.');
    } catch (err: any) {
      const code = err instanceof ApiClientError ? err.code : undefined;
      if (err instanceof ApiClientError && err.payload?.fileHash) {
        setFileHash(err.payload.fileHash);
      }
      setOcrError({
        message: err?.message || 'OCR extraction failed. You can retry or complete the fields manually below.',
        code,
      });
      setHasScanned(true);
    } finally {
      setIsScanning(false);
    }
  };

  const duplicateCheck = useMemo(() => {
    const amt = parseFloat(totalAmount);
    return detectDuplicateReceipt({
      extraction: {
        merchant,
        receiptDate,
        totalAmount: Number.isFinite(amt) ? amt : null,
        receiptNumber,
      },
      fileHash: fileHash || undefined,
      existingTransactions: transactions,
      knownReceiptHashes: knownReceipts,
    });
  }, [merchant, receiptDate, totalAmount, receiptNumber, fileHash, transactions, knownReceipts]);

  const handleReset = () => {
    setImageDataUrl(null);
    setFileHash('');
    setOcrError(null);
    setHasScanned(false);
    setMerchant('');
    setReceiptDate(getCurrentISTDate());
    setReceiptTime(getCurrentISTTime().slice(0, 5));
    setTotalAmount('');
    setSubtotal('');
    setTax('');
    setDiscount('');
    setPaymentMethod('UPI');
    setReceiptNumber('');
    setItems([]);
    setConfidence(null);
    setNotes('');
    setSuggestedCategoryLabel(null);
  };

  const handleConfirmAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const parsedTotal = parseFloat(totalAmount);
    if (!Number.isFinite(parsedTotal) || parsedTotal <= 0) {
      toast.error('Invalid total amount', 'Please enter a valid receipt total greater than 0.');
      return;
    }
    const cleanMerchant = merchant.trim() || 'Receipt Expense';

    const itemsSummary =
      items.length > 0
        ? items.map((it) => `${it.name}${it.price ? ` (₹${it.price})` : ''}`).join(', ')
        : '';

    const descriptionParts = [
      cleanMerchant,
      itemsSummary ? `Items: ${itemsSummary}` : '',
      receiptNumber ? `Receipt #${receiptNumber}` : '',
    ].filter(Boolean);

    const metadata: Record<string, any> = {
      payment_method: paymentMethod,
      receipt_url: imageDataUrl || undefined,
      receipt_data: imageDataUrl || undefined,
      receipt_number: receiptNumber || undefined,
      subtotal: subtotal ? parseFloat(subtotal) : undefined,
      tax: tax ? parseFloat(tax) : undefined,
      discount: discount ? parseFloat(discount) : undefined,
      ocr_confidence: confidence ?? undefined,
      line_items: items.length > 0 ? items : undefined,
    };

    if (category === 'food') {
      metadata.food_item = items[0]?.name || cleanMerchant;
      metadata.restaurant_name = cleanMerchant;
      metadata.platform = cleanMerchant;
    } else if (category === 'room' && subcategory === 'grocery') {
      metadata.grocery_item = items[0]?.name || cleanMerchant;
    } else if (category === 'other') {
      metadata.spent_at = cleanMerchant;
      metadata.spent_for = items[0]?.name || getDisplayCategoryLabel(category, subcategory);
      metadata.category_tag = subcategory;
    }

    setIsSaving(true);
    try {
      await addTransaction({
        category: category as TransactionCategory,
        subcategory,
        transaction_type: 'expense',
        amount: parsedTotal,
        title: cleanMerchant,
        description: descriptionParts.join(' · ').slice(0, 260),
        transaction_date: receiptDate || getCurrentISTDate(),
        transaction_time: receiptTime.length === 5 ? `${receiptTime}:00` : getCurrentISTTime(),
        notes: notes.trim() || undefined,
        metadata,
      });

      // Record receipt hash/metadata for future duplicate detection
      if (fileHash || receiptNumber) {
        const savedRec = await aiFinanceApi
          .saveReceiptRecord({
            file_hash: fileHash || `manual_${Date.now()}`,
            merchant: cleanMerchant,
            amount: parsedTotal,
            receipt_date: receiptDate || getCurrentISTDate(),
            receipt_number: receiptNumber || undefined,
            payment_method: paymentMethod,
            confidence: confidence ?? undefined,
          })
          .catch(() => null);
        if (savedRec) {
          setKnownReceipts((prev) => [savedRec, ...prev]);
        }
      }

      // Teach Smart Categorization rule from confirmed merchant
      if (cleanMerchant.length >= 3) {
        aiFinanceApi
          .saveCategorizationRule({
            merchant_pattern: cleanMerchant,
            category: category as TransactionCategory,
            subcategory,
            transaction_type: 'expense',
          })
          .then(setUserRules)
          .catch(() => {});
      }

      toast.success('Expense saved from receipt', `${cleanMerchant} (${formatINR(parsedTotal)}) added to your ledger.`);
      handleReset();
    } catch (err: any) {
      toast.error('Failed to save expense', err.message || 'Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <ScanLine className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              Receipt Scanner & OCR
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Capture or upload a receipt · Extract fields via OCR · Review & confirm before saving
            </p>
          </div>
        </div>
        {imageDataUrl && (
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer self-start sm:self-auto"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Scan Another Receipt</span>
          </button>
        )}
      </div>

      {/* Provider Status Notice */}
      {ocrSupported === false && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Automated Vision OCR requires server-side AI configuration</p>
            <p className="text-amber-800/80 dark:text-amber-300/80 mt-0.5">
              You can still attach receipt photos and fill in the structured expense form below. We never fabricate fake OCR results.
            </p>
          </div>
        </div>
      )}

      {/* Main Grid: Upload/Preview + Review Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Capture / Upload / Preview */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Camera className="w-4 h-4 text-emerald-600" />
            <span>1. Capture or Upload Receipt</span>
          </h2>

          {isCameraOpen ? (
            <div className="space-y-3">
              <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-[3/4] max-h-[380px] flex items-center justify-center">
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={captureFromCamera}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                >
                  Capture Photo
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : imageDataUrl ? (
            <div className="space-y-3">
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950">
                <img
                  src={imageDataUrl}
                  alt="Uploaded receipt preview"
                  className="w-full max-h-[380px] object-contain mx-auto"
                />
                {isScanning && (
                  <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex flex-col items-center justify-center gap-2 text-white">
                    <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                    <span className="text-xs font-semibold">Running OCR extraction...</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isScanning}
                  onClick={() => runOcrScan(imageDataUrl)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                  <span>Retry OCR</span>
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs font-semibold cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="flex flex-col items-center justify-center gap-2.5 p-8 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 bg-slate-50/70 dark:bg-slate-800/30 cursor-pointer transition-colors text-center">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    Upload Receipt Image
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    JPG, PNG, or WEBP · Max 5 MB
                  </p>
                </div>
              </label>

              <button
                type="button"
                onClick={startCamera}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4 text-emerald-600" />
                <span>Open Camera to Capture Receipt</span>
              </button>

              {cameraError && (
                <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 p-2.5 rounded-xl border border-rose-200 dark:border-rose-800/60">
                  {cameraError}
                </p>
              )}
            </div>
          )}

          {/* OCR Error / Status */}
          {ocrError && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{ocrError.message}</span>
            </div>
          )}

          {confidence !== null && !ocrError && (
            <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60 text-xs flex items-center justify-between">
              <span className="font-medium text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Extraction Confidence
              </span>
              <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                {Math.round(confidence * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* Right: Review & Confirm Expense Form */}
        <form
          onSubmit={handleConfirmAndSave}
          className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-600" />
              <span>2. Review & Confirm Extracted Expense</span>
            </h2>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Never auto-saved
            </span>
          </div>

          {/* Duplicate Receipt Warning */}
          {duplicateCheck.isDuplicate && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Possible duplicate receipt detected</p>
                <p className="mt-0.5 opacity-90">{duplicateCheck.reason}</p>
              </div>
            </div>
          )}

          {/* Smart Categorization Banner */}
          {suggestedCategoryLabel && (
            <div className="p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>
                Smart Categorization suggested <strong>{suggestedCategoryLabel}</strong> — edit below if needed.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Merchant / Vendor <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="e.g. Swiggy, Reliance Fresh, HP Petrol"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Total Amount (₹) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Receipt Date
              </label>
              <input
                type="date"
                required
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Receipt Time
              </label>
              <input
                type="time"
                value={receiptTime}
                onChange={(e) => setReceiptTime(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => {
                  const nextCat = e.target.value as 'food' | 'room' | 'other';
                  setCategory(nextCat);
                  setSubcategory(SUBCATEGORIES_BY_CAT[nextCat][0].id);
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="food">Food & Dining</option>
                <option value="room">Room & Groceries</option>
                <option value="other">Other Expense</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Subcategory
              </label>
              <select
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value as TransactionSubcategory)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {SUBCATEGORIES_BY_CAT[category].map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Payment Method
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100"
              >
                {['UPI', 'Card', 'Cash', 'Bank Transfer', 'Other'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Receipt / Invoice #
              </label>
              <input
                type="text"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Optional Tax / Subtotal / Discount Row */}
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Subtotal (₹)</label>
              <input
                type="number"
                step="0.01"
                value={subtotal}
                onChange={(e) => setSubtotal(e.target.value)}
                placeholder="—"
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Tax / GST (₹)</label>
              <input
                type="number"
                step="0.01"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                placeholder="—"
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Discount (₹)</label>
              <input
                type="number"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="—"
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs tabular-nums"
              />
            </div>
          </div>

          {/* Extracted Line Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Line Items ({items.length})
              </label>
              <button
                type="button"
                onClick={() => setItems((prev) => [...prev, { name: '', price: undefined }])}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add item
              </button>
            </div>
            {items.length > 0 && (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) =>
                        setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, name: e.target.value } : it)))
                      }
                      placeholder="Item description"
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={item.price ?? ''}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((it, i) =>
                            i === idx ? { ...it, price: e.target.value ? Number(e.target.value) : undefined } : it
                          )
                        )
                      }
                      placeholder="₹"
                      className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                      aria-label="Remove item"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional memo..."
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2.5 rounded-xl text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
            >
              Cancel / Reset
            </button>
            <button
              type="submit"
              disabled={isSaving || isScanning}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving...' : hasScanned ? 'Confirm & Save Expense' : 'Save Expense'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
