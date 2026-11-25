import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calculator as CalcIcon,
  Percent,
  Tag,
  Users,
  Copy,
  Check,
  RotateCcw,
  Plus,
  Trash2,
  Sparkles,
  ArrowRight,
  Info,
  Clock,
  Receipt,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { formatINR, getCurrentISTTime } from '../../lib/dateUtils';
import { TransactionCategory } from '../../types';
import {
  CalculatorMode,
  CalculationHistoryRecord,
  fetchCalculatorSettings,
  persistCalculatorSettings,
  fetchCalculationHistory,
  recordCalculation,
  clearCalculationHistory,
} from '../../lib/calculatorApi';

interface CalculatorSectionProps {
  onOpenAddModal?: (
    category?: TransactionCategory,
    subcategory?: any,
    personName?: string,
    amount?: number | string,
    title?: string
  ) => void;
}

/**
 * Precise currency rounding helper avoiding IEEE 754 floating point inaccuracies
 */
function roundMoney(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export const CalculatorSection: React.FC<CalculatorSectionProps> = ({ onOpenAddModal }) => {
  const { user } = useAuth();
  const toast = useToast();

  // Active Mode: 'gst' | 'offer' | 'split' | 'basic'
  const [activeMode, setActiveMode] = useState<CalculatorMode>('gst');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // History and Settings state
  const [historyList, setHistoryList] = useState<CalculationHistoryRecord[]>([]);
  const [historyFilter, setHistoryFilter] = useState<'all' | CalculatorMode>('all');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Mode Specific States (declared upfront to ensure clean hooks initialization)
  const [gstAmount, setGstAmount] = useState<string>('');
  const [gstPercent, setGstPercent] = useState<string>('18');
  const [gstType, setGstType] = useState<'add' | 'remove'>('add'); // Exclusive vs Inclusive
  const [gstError, setGstError] = useState<string | null>(null);

  const [offerAmount, setOfferAmount] = useState<string>('');
  const [offerPercent, setOfferPercent] = useState<string>('15');
  const [offerError, setOfferError] = useState<string | null>(null);

  const [splitAmount, setSplitAmount] = useState<string>('');
  const [splitPeople, setSplitPeople] = useState<string>('4');
  const [splitError, setSplitError] = useState<string | null>(null);

  const [basicDisplay, setBasicDisplay] = useState<string>('0');
  const [basicPrev, setBasicPrev] = useState<number | null>(null);
  const [basicOp, setBasicOp] = useState<string | null>(null);
  const [waitingOperand, setWaitingOperand] = useState<boolean>(false);
  const [basicTape, setBasicTape] = useState<string>('');

  // Load initial settings and history on mount
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setIsLoadingHistory(true);
      try {
        const settings = await fetchCalculatorSettings();
        if (isMounted && settings?.last_mode) {
          setActiveMode(settings.last_mode);
          if (settings.default_gst_percent) {
            setGstPercent(String(settings.default_gst_percent));
          }
          if (settings.default_offer_percent) {
            setOfferPercent(String(settings.default_offer_percent));
          }
          if (settings.default_split_people) {
            setSplitPeople(String(settings.default_split_people));
          }
        }

        const hist = await fetchCalculationHistory();
        if (isMounted) {
          setHistoryList(hist);
        }
      } catch (err) {
        console.warn('Failed loading calculator settings/history:', err);
      } finally {
        if (isMounted) {
          setIsLoadingHistory(false);
        }
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Update active mode & persist
  const handleModeChange = useCallback((mode: CalculatorMode) => {
    setActiveMode(mode);
    persistCalculatorSettings({ last_mode: mode }).catch(() => {});
  }, []);

  const handleCopy = (text: string, key = 'result') => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    toast.success('Copied to Clipboard', text);
  };

  // =========================================================================
  // 1. GST CALCULATOR STATE & LOGIC
  // =========================================================================

  // Calculated GST results
  const gstResult = useMemo(() => {
    const rawAmt = parseFloat(gstAmount);
    const rawPct = parseFloat(gstPercent);

    if (isNaN(rawAmt) || rawAmt <= 0) {
      return null;
    }
    if (isNaN(rawPct) || rawPct < 0) {
      return null;
    }

    if (gstType === 'add') {
      // GST Exclusive: Final = Amount + (Amount * Pct / 100)
      const taxAmt = roundMoney((rawAmt * rawPct) / 100);
      const finalAmt = roundMoney(rawAmt + taxAmt);
      return {
        originalAmount: roundMoney(rawAmt),
        gstPercentage: rawPct,
        gstAmount: taxAmt,
        finalAmount: finalAmt,
        type: 'add' as const,
      };
    } else {
      // GST Inclusive (Reverse): Base = Amount / (1 + Pct / 100), Tax = Amount - Base
      const baseAmt = roundMoney(rawAmt / (1 + rawPct / 100));
      const taxAmt = roundMoney(rawAmt - baseAmt);
      return {
        originalAmount: roundMoney(rawAmt),
        gstPercentage: rawPct,
        gstAmount: taxAmt,
        finalAmount: baseAmt,
        type: 'remove' as const,
      };
    }
  }, [gstAmount, gstPercent, gstType]);

  const handleSaveGstHistory = async () => {
    if (!gstResult) return;
    try {
      const record = await recordCalculation({
        calc_type: 'gst',
        title: `GST ${gstResult.gstPercentage}% on ₹${gstResult.originalAmount.toLocaleString('en-IN')}`,
        input_values: {
          amount: gstResult.originalAmount,
          gst_percent: gstResult.gstPercentage,
          type: gstType,
        },
        result_values: {
          gst_amount: gstResult.gstAmount,
          final_amount: gstResult.finalAmount,
        },
      });
      setHistoryList((prev) => [record, ...prev.slice(0, 49)]);
      toast.success('Calculation Saved', 'GST record saved to history.');
    } catch (e: any) {
      toast.error('Save Failed', e.message);
    }
  };

  const handleResetGst = () => {
    setGstAmount('');
    setGstPercent('18');
    setGstType('add');
    setGstError(null);
  };

  // =========================================================================
  // 2. OFFER / DISCOUNT CALCULATOR STATE & LOGIC
  // =========================================================================

  // Calculated Offer/Discount results
  const offerResult = useMemo(() => {
    const rawAmt = parseFloat(offerAmount);
    const rawPct = parseFloat(offerPercent);

    if (isNaN(rawAmt) || rawAmt <= 0) {
      return null;
    }
    if (isNaN(rawPct) || rawPct < 0 || rawPct > 100) {
      return null;
    }

    const discountAmount = roundMoney((rawAmt * rawPct) / 100);
    const finalPrice = roundMoney(Math.max(0, rawAmt - discountAmount));
    const savings = discountAmount;

    return {
      originalPrice: roundMoney(rawAmt),
      discountPercent: rawPct,
      discountAmount,
      finalPrice,
      savings,
    };
  }, [offerAmount, offerPercent]);

  const handleSaveOfferHistory = async () => {
    if (!offerResult) return;
    try {
      const record = await recordCalculation({
        calc_type: 'offer',
        title: `${offerResult.discountPercent}% Off on ₹${offerResult.originalPrice.toLocaleString('en-IN')}`,
        input_values: {
          original_amount: offerResult.originalPrice,
          discount_percent: offerResult.discountPercent,
        },
        result_values: {
          discount_amount: offerResult.discountAmount,
          final_price: offerResult.finalPrice,
          savings: offerResult.savings,
        },
      });
      setHistoryList((prev) => [record, ...prev.slice(0, 49)]);
      toast.success('Calculation Saved', 'Discount record saved to history.');
    } catch (e: any) {
      toast.error('Save Failed', e.message);
    }
  };

  const handleResetOffer = () => {
    setOfferAmount('');
    setOfferPercent('15');
    setOfferError(null);
  };

  // =========================================================================
  // 3. SPLIT CALCULATOR STATE & LOGIC (SIMPLE, DYNAMIC PEOPLE)
  // =========================================================================

  // Calculated Split results with remainder handling
  const splitResult = useMemo(() => {
    const rawAmt = parseFloat(splitAmount);
    const rawCount = parseInt(splitPeople, 10);

    if (isNaN(rawAmt) || rawAmt <= 0) {
      return null;
    }
    if (isNaN(rawCount) || rawCount <= 0 || !Number.isInteger(rawCount)) {
      return null;
    }

    // Exact per person in paise/cents to prevent monetary loss
    const totalPaise = Math.round(rawAmt * 100);
    const basePaisePerPerson = Math.floor(totalPaise / rawCount);
    const remainderPaise = totalPaise % rawCount;

    const basePerPerson = basePaisePerPerson / 100;
    const higherPerPerson = (basePaisePerPerson + 1) / 100;
    const peoplePayingHigher = remainderPaise;
    const peoplePayingBase = rawCount - remainderPaise;

    const exactAverage = roundMoney(rawAmt / rawCount);

    return {
      totalAmount: roundMoney(rawAmt),
      peopleCount: rawCount,
      exactAverage,
      basePerPerson: roundMoney(basePerPerson),
      higherPerPerson: roundMoney(higherPerPerson),
      remainderPaise,
      remainderAmount: roundMoney(remainderPaise / 100),
      peoplePayingBase,
      peoplePayingHigher,
      hasRemainder: remainderPaise > 0,
    };
  }, [splitAmount, splitPeople]);

  const handleSaveSplitHistory = async () => {
    if (!splitResult) return;
    try {
      const record = await recordCalculation({
        calc_type: 'split',
        title: `Split ₹${splitResult.totalAmount.toLocaleString('en-IN')} among ${splitResult.peopleCount} people`,
        input_values: {
          total_amount: splitResult.totalAmount,
          people_count: splitResult.peopleCount,
        },
        result_values: {
          per_person: splitResult.exactAverage,
          base_per_person: splitResult.basePerPerson,
          remainder: splitResult.remainderAmount,
        },
      });
      setHistoryList((prev) => [record, ...prev.slice(0, 49)]);
      toast.success('Calculation Saved', 'Split record saved to history.');
    } catch (e: any) {
      toast.error('Save Failed', e.message);
    }
  };

  const handleResetSplit = () => {
    setSplitAmount('');
    setSplitPeople('4');
    setSplitError(null);
  };

  // =========================================================================
  // 4. BASIC CALCULATOR KEYPAD STATE & LOGIC (PRESERVED DESIGN)
  // =========================================================================

  const handleBasicDigit = (digit: string) => {
    if (waitingOperand) {
      setBasicDisplay(digit);
      setWaitingOperand(false);
    } else {
      setBasicDisplay(basicDisplay === '0' ? digit : basicDisplay + digit);
    }
  };

  const handleBasicDecimal = () => {
    if (waitingOperand) {
      setBasicDisplay('0.');
      setWaitingOperand(false);
    } else if (!basicDisplay.includes('.')) {
      setBasicDisplay(basicDisplay + '.');
    }
  };

  const handleBasicClear = () => {
    setBasicDisplay('0');
    setBasicPrev(null);
    setBasicOp(null);
    setWaitingOperand(false);
    setBasicTape('');
  };

  const handleBasicDelete = () => {
    if (waitingOperand) return;
    if (basicDisplay.length > 1) {
      setBasicDisplay(basicDisplay.slice(0, -1));
    } else {
      setBasicDisplay('0');
    }
  };

  const handleBasicToggleSign = () => {
    const val = parseFloat(basicDisplay);
    if (!isNaN(val) && val !== 0) {
      setBasicDisplay(String(-val));
    }
  };

  const handleBasicOp = (nextOp: string) => {
    const inputVal = parseFloat(basicDisplay);

    if (basicPrev === null) {
      setBasicPrev(inputVal);
      setBasicTape(`${inputVal} ${nextOp}`);
    } else if (basicOp) {
      const cur = basicPrev || 0;
      let res = inputVal;
      if (basicOp === '+') res = cur + inputVal;
      else if (basicOp === '-') res = cur - inputVal;
      else if (basicOp === '×') res = cur * inputVal;
      else if (basicOp === '÷') res = inputVal !== 0 ? cur / inputVal : 0;

      const clean = roundMoney(res);
      setBasicDisplay(String(clean));
      setBasicPrev(clean);
      setBasicTape(`${clean} ${nextOp}`);
    }

    setWaitingOperand(true);
    setBasicOp(nextOp);
  };

  const handleBasicEquals = async () => {
    const inputVal = parseFloat(basicDisplay);

    if (basicPrev !== null && basicOp) {
      let res = inputVal;
      if (basicOp === '+') res = basicPrev + inputVal;
      else if (basicOp === '-') res = basicPrev - inputVal;
      else if (basicOp === '×') res = basicPrev * inputVal;
      else if (basicOp === '÷') res = inputVal !== 0 ? basicPrev / inputVal : 0;

      const clean = roundMoney(res);
      const expr = `${basicPrev} ${basicOp} ${inputVal} =`;

      setBasicDisplay(String(clean));
      setBasicTape(expr);
      setBasicPrev(null);
      setBasicOp(null);
      setWaitingOperand(true);

      try {
        const record = await recordCalculation({
          calc_type: 'basic',
          title: `${expr} ${clean}`,
          input_values: { expression: expr },
          result_values: { result: clean },
        });
        setHistoryList((prev) => [record, ...prev.slice(0, 49)]);
      } catch {
        // ignore
      }
    }
  };

  // Transfer basic calculator display value to active mode
  const sendBasicToMode = (targetMode: 'gst' | 'offer' | 'split') => {
    const val = parseFloat(basicDisplay);
    if (isNaN(val) || val <= 0) {
      toast.info('Enter a valid amount first');
      return;
    }
    if (targetMode === 'gst') {
      setGstAmount(String(val));
      setActiveMode('gst');
      toast.success('Loaded into GST', `₹${val.toLocaleString('en-IN')} set as GST amount.`);
    } else if (targetMode === 'offer') {
      setOfferAmount(String(val));
      setActiveMode('offer');
      toast.success('Loaded into Offer', `₹${val.toLocaleString('en-IN')} set as original price.`);
    } else if (targetMode === 'split') {
      setSplitAmount(String(val));
      setActiveMode('split');
      toast.success('Loaded into Split', `₹${val.toLocaleString('en-IN')} set as total amount.`);
    }
  };

  // =========================================================================
  // HISTORY ACTIONS
  // =========================================================================
  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all') return historyList;
    return historyList.filter((h) => h.calc_type === historyFilter);
  }, [historyList, historyFilter]);

  const handleClearHistory = async () => {
    await clearCalculationHistory();
    setHistoryList([]);
    toast.info('History Cleared', 'All calculation records removed.');
  };

  const handleDeleteHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await clearCalculationHistory(id);
    setHistoryList((prev) => prev.filter((item) => item.id !== id));
    toast.info('Deleted', 'Record removed.');
  };

  const handleRestoreHistoryItem = (item: CalculationHistoryRecord) => {
    if (item.calc_type === 'gst' && item.input_values) {
      setActiveMode('gst');
      if (item.input_values.amount !== undefined) setGstAmount(String(item.input_values.amount));
      if (item.input_values.gst_percent !== undefined) setGstPercent(String(item.input_values.gst_percent));
      if (item.input_values.type !== undefined) setGstType(item.input_values.type);
      toast.info('Loaded GST Calculation', item.title || 'Calculation loaded.');
    } else if (item.calc_type === 'offer' && item.input_values) {
      setActiveMode('offer');
      if (item.input_values.original_amount !== undefined) setOfferAmount(String(item.input_values.original_amount));
      if (item.input_values.discount_percent !== undefined) setOfferPercent(String(item.input_values.discount_percent));
      toast.info('Loaded Discount Calculation', item.title || 'Calculation loaded.');
    } else if (item.calc_type === 'split' && item.input_values) {
      setActiveMode('split');
      if (item.input_values.total_amount !== undefined) setSplitAmount(String(item.input_values.total_amount));
      if (item.input_values.people_count !== undefined) setSplitPeople(String(item.input_values.people_count));
      toast.info('Loaded Split Calculation', item.title || 'Calculation loaded.');
    } else if (item.calc_type === 'basic' && item.result_values) {
      setActiveMode('basic');
      if (item.result_values.result !== undefined) {
        setBasicDisplay(String(item.result_values.result));
        setWaitingOperand(true);
      }
      toast.info('Loaded Basic Math', String(item.result_values.result));
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in pb-20 lg:pb-8">
      {/* =========================================================================
          TOP BANNER & MODE SELECTION UI: GST | Offer | Split | Basic Keypad
          ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 sm:p-6 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 rounded-3xl text-white shadow-xl shadow-emerald-900/10">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-semibold tracking-wide uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Financial Utilities</span>
          </span>
          <h2 className="text-xl sm:text-2xl font-black mt-2 tracking-tight">
            Financial Calculator
          </h2>
          <p className="text-xs sm:text-sm text-emerald-100/90 mt-1 font-medium">
            Dynamic GST calculations, custom discount offers, and accurate per-person bill split
          </p>
        </div>

        {/* Mode-Selection UI: GST | Offer | Split | Basic */}
        <div className="inline-flex items-center p-1 bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/20 self-start sm:self-auto overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => handleModeChange('gst')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMode === 'gst'
                ? 'bg-white text-emerald-800 shadow-md scale-100'
                : 'text-white/80 hover:text-white hover:bg-white/10'
            }`}
          >
            <Percent className="w-3.5 h-3.5" />
            <span>GST</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange('offer')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMode === 'offer'
                ? 'bg-white text-emerald-800 shadow-md scale-100'
                : 'text-white/80 hover:text-white hover:bg-white/10'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Offer / Discount</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange('split')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMode === 'split'
                ? 'bg-white text-emerald-800 shadow-md scale-100'
                : 'text-white/80 hover:text-white hover:bg-white/10'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Split</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange('basic')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMode === 'basic'
                ? 'bg-white text-emerald-800 shadow-md scale-100'
                : 'text-white/80 hover:text-white hover:bg-white/10'
            }`}
          >
            <CalcIcon className="w-3.5 h-3.5" />
            <span>Keypad</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Calculator Mode Panel + History Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Active Calculation Mode */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-6">
          {/* =========================================================================
              MODE 1: GST CALCULATOR — DYNAMIC INPUT
              ========================================================================= */}
          {activeMode === 'gst' && (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-sm">
                    <Percent className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                      GST Calculator
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Calculate GST amount and final price with manual percentage input
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleResetGst}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold transition-all cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              </div>

              {/* GST Type Selection (Add vs Remove) */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 mr-1">
                  Type:
                </span>
                <button
                  type="button"
                  onClick={() => setGstType('add')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                    gstType === 'add'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  Add GST (Exclusive)
                </button>
                <button
                  type="button"
                  onClick={() => setGstType('remove')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                    gstType === 'remove'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  Remove GST (Inclusive)
                </button>
              </div>

              {/* Dynamic Inputs: Amount & GST Percentage */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 1. Amount Input */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    {gstType === 'add' ? 'Original Amount (₹) *' : 'Total Amount Including GST (₹) *'}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                      ₹
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      placeholder="e.g. 1000"
                      value={gstAmount}
                      onChange={(e) => {
                        setGstAmount(e.target.value);
                        setGstError(null);
                      }}
                      className="w-full pl-8 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                {/* 2. Manual GST Percentage Input */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    GST Percentage (%) *
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      max="100"
                      placeholder="e.g. 5, 12, 15, 18, 28"
                      value={gstPercent}
                      onChange={(e) => {
                        setGstPercent(e.target.value);
                        setGstError(null);
                      }}
                      className="w-full pl-4 pr-9 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 dark:text-slate-100"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                      %
                    </span>
                  </div>
                </div>
              </div>

              {/* Unrestricted Quick Fill Chips (Convenience suggestions, not restrictive) */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-slate-400">
                  Popular GST rates (or type any custom % above):
                </span>
                <div className="flex flex-wrap gap-2">
                  {[5, 12, 15, 18, 28].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setGstPercent(String(pct))}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                        gstPercent === String(pct)
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Error message */}
              {gstError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{gstError}</span>
                </div>
              )}

              {/* Result Display Card */}
              {gstResult ? (
                <div className="p-5 bg-gradient-to-br from-emerald-50/80 to-teal-50/80 dark:from-emerald-950/30 dark:to-teal-950/30 rounded-3xl border border-emerald-200/80 dark:border-emerald-800/80 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between pb-3 border-b border-emerald-200/60 dark:border-emerald-800/60">
                    <span className="text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                      Calculation Breakdown
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          `Amount: ${formatINR(gstResult.originalAmount, true)} | GST (${gstResult.gstPercentage}%): ${formatINR(gstResult.gstAmount, true)} | Final: ${formatINR(gstResult.finalAmount, true)}`,
                          'gst'
                        )
                      }
                      className="flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer"
                    >
                      {copiedKey === 'gst' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey === 'gst' ? 'Copied' : 'Copy Result'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-white/80 dark:bg-slate-900/80 rounded-2xl border border-emerald-100 dark:border-emerald-900/40">
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Original Amount</p>
                      <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 font-mono mt-0.5">
                        {formatINR(gstResult.originalAmount, true)}
                      </p>
                    </div>

                    <div className="p-3 bg-white/80 dark:bg-slate-900/80 rounded-2xl border border-emerald-100 dark:border-emerald-900/40">
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">GST Percentage</p>
                      <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                        {gstResult.gstPercentage}%
                      </p>
                    </div>

                    <div className="p-3 bg-white/80 dark:bg-slate-900/80 rounded-2xl border border-emerald-100 dark:border-emerald-900/40">
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">GST Amount</p>
                      <p className="text-base font-extrabold text-amber-600 dark:text-amber-400 font-mono mt-0.5">
                        {formatINR(gstResult.gstAmount, true)}
                      </p>
                    </div>

                    <div className="p-3 bg-emerald-600 text-white rounded-2xl shadow-md shadow-emerald-600/20">
                      <p className="text-[11px] font-semibold text-emerald-100">Final Amount</p>
                      <p className="text-base sm:text-lg font-black font-mono mt-0.5">
                        {formatINR(gstResult.finalAmount, true)}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={handleSaveGstHistory}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-slate-800 rounded-xl text-xs font-bold border border-emerald-200 dark:border-emerald-800 transition-all cursor-pointer shadow-sm"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Save to History</span>
                    </button>

                    {onOpenAddModal && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenAddModal(
                            'other',
                            'bills',
                            undefined,
                            gstResult.finalAmount,
                            `GST Bill (${gstResult.gstPercentage}%)`
                          )
                        }
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>+ Add to Transactions</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400 space-y-1.5">
                  <Percent className="w-8 h-8 mx-auto opacity-30 text-emerald-500" />
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    Enter Amount & GST Percentage above
                  </p>
                  <p className="text-[11px]">Results will calculate automatically with exact Indian Rupee formatting.</p>
                </div>
              )}
            </div>
          )}

          {/* =========================================================================
              MODE 2: OFFER / DISCOUNT CALCULATOR
              ========================================================================= */}
          {activeMode === 'offer' && (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-teal-100 dark:bg-teal-950/80 text-teal-600 dark:text-teal-400 flex items-center justify-center shadow-sm">
                    <Tag className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                      Offer & Discount Calculator
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Calculate your savings and final payable price with any discount percentage (0–100%)
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleResetOffer}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold transition-all cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              </div>

              {/* Dynamic Inputs: Original Price & Discount Percentage */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 1. Original Amount */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    Original Price (₹) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                      ₹
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      placeholder="e.g. 1000"
                      value={offerAmount}
                      onChange={(e) => {
                        setOfferAmount(e.target.value);
                        setOfferError(null);
                      }}
                      className="w-full pl-8 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                {/* 2. Discount Percentage (0 to 100) */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    Offer / Discount (%) *
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      max="100"
                      placeholder="e.g. 10, 15, 50, 90"
                      value={offerPercent}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && (val < 0 || val > 100)) {
                          setOfferError('Discount percentage must be between 0% and 100%.');
                        } else {
                          setOfferError(null);
                        }
                        setOfferPercent(e.target.value);
                      }}
                      className="w-full pl-4 pr-9 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20 text-slate-900 dark:text-slate-100"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                      %
                    </span>
                  </div>
                </div>
              </div>

              {/* Unrestricted Quick Fill Chips for Offers */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-slate-400">
                  Quick suggestions (or type any custom % above):
                </span>
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 15, 20, 25, 50, 70].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setOfferPercent(String(pct))}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                        offerPercent === String(pct)
                          ? 'bg-teal-50 dark:bg-teal-950/60 border-teal-500 text-teal-700 dark:text-teal-300'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {pct}% Off
                    </button>
                  ))}
                </div>
              </div>

              {offerError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{offerError}</span>
                </div>
              )}

              {/* Result Display Card */}
              {offerResult ? (
                <div className="p-5 bg-gradient-to-br from-teal-50/80 to-emerald-50/80 dark:from-teal-950/30 dark:to-emerald-950/30 rounded-3xl border border-teal-200/80 dark:border-teal-800/80 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between pb-3 border-b border-teal-200/60 dark:border-teal-800/60">
                    <span className="text-xs font-black uppercase tracking-wider text-teal-700 dark:text-teal-300">
                      Discount & Savings Breakdown
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          `Original: ${formatINR(offerResult.originalPrice, true)} | Discount (${offerResult.discountPercent}%): ${formatINR(offerResult.discountAmount, true)} | Final Price: ${formatINR(offerResult.finalPrice, true)} | You Save: ${formatINR(offerResult.savings, true)}`,
                          'offer'
                        )
                      }
                      className="flex items-center gap-1 text-xs font-bold text-teal-700 dark:text-teal-300 hover:underline cursor-pointer"
                    >
                      {copiedKey === 'offer' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey === 'offer' ? 'Copied' : 'Copy Result'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-white/80 dark:bg-slate-900/80 rounded-2xl border border-teal-100 dark:border-teal-900/40">
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Original Price</p>
                      <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 font-mono mt-0.5">
                        {formatINR(offerResult.originalPrice, true)}
                      </p>
                    </div>

                    <div className="p-3 bg-white/80 dark:bg-slate-900/80 rounded-2xl border border-teal-100 dark:border-teal-900/40">
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Discount ({offerResult.discountPercent}%)</p>
                      <p className="text-base font-extrabold text-amber-600 dark:text-amber-400 font-mono mt-0.5">
                        -{formatINR(offerResult.discountAmount, true)}
                      </p>
                    </div>

                    <div className="p-3 bg-white/80 dark:bg-slate-900/80 rounded-2xl border border-teal-100 dark:border-teal-900/40">
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">You Save</p>
                      <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                        {formatINR(offerResult.savings, true)}
                      </p>
                    </div>

                    <div className="p-3 bg-teal-600 text-white rounded-2xl shadow-md shadow-teal-600/20">
                      <p className="text-[11px] font-semibold text-teal-100">Final Price</p>
                      <p className="text-base sm:text-lg font-black font-mono mt-0.5">
                        {formatINR(offerResult.finalPrice, true)}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={handleSaveOfferHistory}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-slate-800 rounded-xl text-xs font-bold border border-teal-200 dark:border-teal-800 transition-all cursor-pointer shadow-sm"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Save to History</span>
                    </button>

                    {onOpenAddModal && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenAddModal(
                            'other',
                            'shopping',
                            undefined,
                            offerResult.finalPrice,
                            `Discounted Purchase (${offerResult.discountPercent}% Off)`
                          )
                        }
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-teal-600/20 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>+ Add to Transactions</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400 space-y-1.5">
                  <Tag className="w-8 h-8 mx-auto opacity-30 text-teal-500" />
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    Enter Original Price & Discount Percentage above
                  </p>
                  <p className="text-[11px]">Calculates final payable price and total savings immediately.</p>
                </div>
              )}
            </div>
          )}

          {/* =========================================================================
              MODE 3: SPLIT CALCULATOR — DYNAMIC NUMBER OF PEOPLE
              ========================================================================= */}
          {activeMode === 'split' && (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-cyan-100 dark:bg-cyan-950/80 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shadow-sm">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                      Split Calculator
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Divide any total bill amount among any number of people with accurate rounding
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleResetSplit}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold transition-all cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              </div>

              {/* Dynamic Inputs: Total Amount & Number of People */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 1. Total Bill Amount */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    Total Amount (₹) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                      ₹
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      placeholder="e.g. 1200"
                      value={splitAmount}
                      onChange={(e) => {
                        setSplitAmount(e.target.value);
                        setSplitError(null);
                      }}
                      className="w-full pl-8 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/20 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                {/* 2. Number of People (Dynamic positive integer) */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    Number of People *
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      min="1"
                      placeholder="e.g. 2, 3, 4, 6, 10"
                      value={splitPeople}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val <= 0) {
                          setSplitError('Number of people must be at least 1.');
                        } else {
                          setSplitError(null);
                        }
                        setSplitPeople(e.target.value);
                      }}
                      className="w-full pl-4 pr-16 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/20 text-slate-900 dark:text-slate-100"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">
                      people
                    </span>
                  </div>
                </div>
              </div>

              {/* Unrestricted Quick Fill Chips for People count */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-slate-400">
                  Quick suggestions (or type any whole number above):
                </span>
                <div className="flex flex-wrap gap-2">
                  {[2, 3, 4, 5, 6, 8, 10, 12].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setSplitPeople(String(cnt))}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                        splitPeople === String(cnt)
                          ? 'bg-cyan-50 dark:bg-cyan-950/60 border-cyan-500 text-cyan-700 dark:text-cyan-300'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {cnt} People
                    </button>
                  ))}
                </div>
              </div>

              {splitError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{splitError}</span>
                </div>
              )}

              {/* Result Display Card */}
              {splitResult ? (
                <div className="p-5 bg-gradient-to-br from-cyan-50/80 to-blue-50/80 dark:from-cyan-950/30 dark:to-blue-950/30 rounded-3xl border border-cyan-200/80 dark:border-cyan-800/80 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between pb-3 border-b border-cyan-200/60 dark:border-cyan-800/60">
                    <span className="text-xs font-black uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                      Per Person Split Result
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          `Total: ${formatINR(splitResult.totalAmount, true)} | People: ${splitResult.peopleCount} | Per Person: ${formatINR(splitResult.exactAverage, true)}`,
                          'split'
                        )
                      }
                      className="flex items-center gap-1 text-xs font-bold text-cyan-700 dark:text-cyan-300 hover:underline cursor-pointer"
                    >
                      {copiedKey === 'split' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey === 'split' ? 'Copied' : 'Copy Result'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-white/80 dark:bg-slate-900/80 rounded-2xl border border-cyan-100 dark:border-cyan-900/40">
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Total Amount</p>
                      <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 font-mono mt-0.5">
                        {formatINR(splitResult.totalAmount, true)}
                      </p>
                    </div>

                    <div className="p-3 bg-white/80 dark:bg-slate-900/80 rounded-2xl border border-cyan-100 dark:border-cyan-900/40">
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Number of People</p>
                      <p className="text-base font-extrabold text-cyan-600 dark:text-cyan-400 font-mono mt-0.5">
                        {splitResult.peopleCount} {splitResult.peopleCount === 1 ? 'Person' : 'People'}
                      </p>
                    </div>

                    <div className="p-3 bg-cyan-600 text-white rounded-2xl shadow-md shadow-cyan-600/20">
                      <p className="text-[11px] font-semibold text-cyan-100">Amount Per Person</p>
                      <p className="text-base sm:text-lg font-black font-mono mt-0.5">
                        {formatINR(splitResult.exactAverage, true)}
                      </p>
                    </div>
                  </div>

                  {/* Remainder Explanation Note (if uneven division occurs, e.g. 1000/3) */}
                  {splitResult.hasRemainder && (
                    <div className="p-3.5 bg-white/90 dark:bg-slate-900/90 rounded-2xl border border-cyan-200 dark:border-cyan-800 text-xs space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-cyan-800 dark:text-cyan-300">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        <span>Exact Paise Balance (No Money Lost):</span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                        Base share is <strong className="font-mono">{formatINR(splitResult.basePerPerson, true)}</strong>.
                        To balance the exact total of <strong className="font-mono">{formatINR(splitResult.totalAmount, true)}</strong>,{' '}
                        {splitResult.peoplePayingHigher} person pays{' '}
                        <strong className="font-mono text-cyan-700 dark:text-cyan-300">
                          {formatINR(splitResult.higherPerPerson, true)}
                        </strong>{' '}
                        and {splitResult.peoplePayingBase} {splitResult.peoplePayingBase === 1 ? 'person pays' : 'people pay'}{' '}
                        <strong className="font-mono">
                          {formatINR(splitResult.basePerPerson, true)}
                        </strong>.
                      </p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={handleSaveSplitHistory}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-slate-800 rounded-xl text-xs font-bold border border-cyan-200 dark:border-cyan-800 transition-all cursor-pointer shadow-sm"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Save to History</span>
                    </button>

                    {onOpenAddModal && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenAddModal(
                            'other',
                            'other_expense',
                            undefined,
                            splitResult.exactAverage,
                            `Split Bill Share (1/${splitResult.peopleCount})`
                          )
                        }
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-cyan-600/20 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>+ Add My Share to Ledger</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400 space-y-1.5">
                  <Users className="w-8 h-8 mx-auto opacity-30 text-cyan-500" />
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    Enter Total Amount & Number of People above
                  </p>
                  <p className="text-[11px]">Calculates per-person share and explains exact remainder distribution without losing money.</p>
                </div>
              )}
            </div>
          )}

          {/* =========================================================================
              MODE 4: BASIC CALCULATOR KEYPAD (PRESERVED KEYPAD DESIGN)
              ========================================================================= */}
          {activeMode === 'basic' && (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
              {/* Display Area */}
              <div className="bg-slate-900 dark:bg-slate-950 rounded-2xl p-4 sm:p-5 text-white flex flex-col justify-between min-h-[110px] shadow-inner relative overflow-hidden border border-slate-800">
                <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                  <span className="truncate pr-2">{basicTape || 'Ready'}</span>
                  <button
                    onClick={() => handleCopy(basicDisplay, 'basic-calc')}
                    className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    title="Copy Result"
                  >
                    {copiedKey === 'basic-calc' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <div className="text-right mt-2">
                  <span className="text-3xl sm:text-5xl font-black font-mono tracking-tight text-emerald-400 select-all break-all">
                    {basicDisplay}
                  </span>
                </div>
              </div>

              {/* Hand-off Bar: Send Display value to GST / Offer / Split */}
              <div className="flex items-center justify-between text-xs p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700">
                <span className="font-semibold text-slate-500 dark:text-slate-400">
                  Send current value (₹{basicDisplay}) to:
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => sendBasicToMode('gst')}
                    className="px-2.5 py-1 bg-white dark:bg-slate-700 hover:bg-emerald-50 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-600 transition-all cursor-pointer"
                  >
                    → GST
                  </button>
                  <button
                    type="button"
                    onClick={() => sendBasicToMode('offer')}
                    className="px-2.5 py-1 bg-white dark:bg-slate-700 hover:bg-teal-50 text-teal-700 dark:text-teal-300 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-600 transition-all cursor-pointer"
                  >
                    → Offer
                  </button>
                  <button
                    type="button"
                    onClick={() => sendBasicToMode('split')}
                    className="px-2.5 py-1 bg-white dark:bg-slate-700 hover:bg-cyan-50 text-cyan-700 dark:text-cyan-300 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-600 transition-all cursor-pointer"
                  >
                    → Split
                  </button>
                </div>
              </div>

              {/* Keypad Grid */}
              <div className="grid grid-cols-4 gap-2.5 sm:gap-3 text-base sm:text-lg font-bold select-none pt-1">
                {/* Row 1 */}
                <button
                  type="button"
                  onClick={handleBasicClear}
                  className="py-3.5 rounded-2xl bg-rose-100 hover:bg-rose-200 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 active:scale-95 transition-all cursor-pointer"
                >
                  AC
                </button>
                <button
                  type="button"
                  onClick={handleBasicDelete}
                  className="py-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 active:scale-95 transition-all cursor-pointer"
                >
                  DEL
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const val = parseFloat(basicDisplay);
                    if (!isNaN(val)) setBasicDisplay(String(roundMoney(val / 100)));
                  }}
                  className="py-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 active:scale-95 transition-all cursor-pointer"
                >
                  %
                </button>
                <button
                  type="button"
                  onClick={() => handleBasicOp('÷')}
                  className="py-3.5 rounded-2xl bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/80 dark:hover:bg-emerald-900/80 text-emerald-800 dark:text-emerald-300 active:scale-95 transition-all cursor-pointer"
                >
                  ÷
                </button>

                {/* Row 2 */}
                <button
                  type="button"
                  onClick={() => handleBasicDigit('7')}
                  className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
                >
                  7
                </button>
                <button
                  type="button"
                  onClick={() => handleBasicDigit('8')}
                  className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
                >
                  8
                </button>
                <button
                  type="button"
                  onClick={() => handleBasicDigit('9')}
                  className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
                >
                  9
                </button>
                <button
                  type="button"
                  onClick={() => handleBasicOp('×')}
                  className="py-3.5 rounded-2xl bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/80 dark:hover:bg-emerald-900/80 text-emerald-800 dark:text-emerald-300 active:scale-95 transition-all cursor-pointer"
                >
                  ×
                </button>

                {/* Row 3 */}
                <button
                  type="button"
                  onClick={() => handleBasicDigit('4')}
                  className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
                >
                  4
                </button>
                <button
                  type="button"
                  onClick={() => handleBasicDigit('5')}
                  className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
                >
                  5
                </button>
                <button
                  type="button"
                  onClick={() => handleBasicDigit('6')}
                  className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
                >
                  6
                </button>
                <button
                  type="button"
                  onClick={() => handleBasicOp('-')}
                  className="py-3.5 rounded-2xl bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/80 dark:hover:bg-emerald-900/80 text-emerald-800 dark:text-emerald-300 active:scale-95 transition-all cursor-pointer"
                >
                  -
                </button>

                {/* Row 4 */}
                <button
                  type="button"
                  onClick={() => handleBasicDigit('1')}
                  className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
                >
                  1
                </button>
                <button
                  type="button"
                  onClick={() => handleBasicDigit('2')}
                  className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
                >
                  2
                </button>
                <button
                  type="button"
                  onClick={() => handleBasicDigit('3')}
                  className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
                >
                  3
                </button>
                <button
                  type="button"
                  onClick={() => handleBasicOp('+')}
                  className="py-3.5 rounded-2xl bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/80 dark:hover:bg-emerald-900/80 text-emerald-800 dark:text-emerald-300 active:scale-95 transition-all cursor-pointer"
                >
                  +
                </button>

                {/* Row 5 */}
                <button
                  type="button"
                  onClick={handleBasicToggleSign}
                  className="py-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 active:scale-95 transition-all cursor-pointer"
                >
                  +/-
                </button>
                <button
                  type="button"
                  onClick={() => handleBasicDigit('0')}
                  className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleBasicDecimal}
                  className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
                >
                  .
                </button>
                <button
                  type="button"
                  onClick={handleBasicEquals}
                  className="py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black shadow-lg shadow-emerald-600/30 active:scale-95 transition-all cursor-pointer"
                >
                  =
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Calculation History Tape & Saved Logs */}
        <div className="lg:col-span-5 xl:col-span-4 bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-full space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Calculation History
              </h3>
            </div>
            {historyList.length > 0 && (
              <button
                type="button"
                onClick={handleClearHistory}
                className="text-xs text-slate-400 hover:text-rose-500 font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                title="Clear all calculation history"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
          </div>

          {/* History Mode Filter Tabs */}
          <div className="flex items-center gap-1 pb-1 overflow-x-auto text-[11px] font-bold">
            {(['all', 'gst', 'offer', 'split'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setHistoryFilter(f)}
                className={`px-2.5 py-1 rounded-lg uppercase tracking-wider transition-all cursor-pointer ${
                  historyFilter === f
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* History Records List */}
          <div className="flex-1 space-y-2 overflow-y-auto max-h-[500px] pr-1">
            {filteredHistory.length === 0 ? (
              <div className="py-12 text-center text-slate-400 space-y-2">
                <Clock className="w-8 h-8 mx-auto opacity-30" />
                <p className="text-xs font-semibold">No calculation records yet.</p>
                <p className="text-[11px] text-slate-500">
                  Calculations you perform in GST, Offer, or Split modes will be stored here.
                </p>
              </div>
            ) : (
              filteredHistory.map((item) => {
                const badgeColor =
                  item.calc_type === 'gst'
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                    : item.calc_type === 'offer'
                    ? 'bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300'
                    : item.calc_type === 'split'
                    ? 'bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';

                return (
                  <div
                    key={item.id}
                    onClick={() => handleRestoreHistoryItem(item)}
                    className="p-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40 rounded-2xl border border-slate-200/70 dark:border-slate-800 transition-all cursor-pointer group relative"
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span className={`px-2 py-0.5 rounded-full font-black uppercase text-[9px] ${badgeColor}`}>
                        {item.calc_type}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteHistoryItem(item.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-rose-500 transition-all"
                          title="Delete entry"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-1.5">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                        {item.title || 'Calculation'}
                      </p>

                      {/* Display Key Output */}
                      {item.calc_type === 'gst' && item.result_values?.final_amount !== undefined && (
                        <p className="text-xs font-mono font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
                          Total: {formatINR(item.result_values.final_amount, true)}
                        </p>
                      )}
                      {item.calc_type === 'offer' && item.result_values?.final_price !== undefined && (
                        <p className="text-xs font-mono font-extrabold text-teal-600 dark:text-teal-400 mt-0.5">
                          Final Price: {formatINR(item.result_values.final_price, true)} (Saved {formatINR(item.result_values.savings, true)})
                        </p>
                      )}
                      {item.calc_type === 'split' && item.result_values?.per_person !== undefined && (
                        <p className="text-xs font-mono font-extrabold text-cyan-600 dark:text-cyan-400 mt-0.5">
                          Per Person: {formatINR(item.result_values.per_person, true)}
                        </p>
                      )}
                    </div>

                    <span className="text-[10px] text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity font-bold block mt-1">
                      Tap to restore values
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
