import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calculator as CalcIcon,
  Percent,
  Tag,
  Users,
  Copy,
  Check,
  Clock,
  Trash2,
  Plus,
  Info,
  AlertCircle,
  BookmarkPlus,
  Receipt,
  RotateCcw,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { formatINR } from '../../lib/dateUtils';
import { TransactionCategory } from '../../types';
import {
  CalculationHistoryRecord,
  fetchCalculatorSettings,
  fetchCalculationHistory,
  recordCalculation,
  clearCalculationHistory,
} from '../../lib/calculatorApi';
import {
  CalculatorMode,
  GstOperation,
  GstTaxType,
  DiscountType,
  appendDecimal,
  appendDigit,
  appendDoubleZero,
  appendOperator,
  appendPercent,
  backspaceExpression,
  calculateDiscount,
  calculateGst,
  evaluateExpression,
  evaluateForDisplay,
  fromPaise,
  parseAmountToPaise,
  reconcileShares,
  splitBill,
  MAX_SPLIT_PEOPLE,
} from '../../lib/smartCalculator';

interface CalculatorSectionProps {
  onOpenAddModal?: (
    category?: TransactionCategory,
    subcategory?: any,
    personName?: string,
    amount?: number | string,
    title?: string
  ) => void;
}

const GST_RATES = [5, 12, 18, 28];
const OFFER_PERCENTS = [5, 10, 15, 20, 25, 50];
const KEY_ROWS: string[][] = [
  ['AC', '⌫', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['00', '0', '.', '='],
];

const MODES: { id: CalculatorMode; label: string; icon: React.ElementType }[] = [
  { id: 'gst', label: 'GST', icon: Percent },
  { id: 'offer', label: 'Offer', icon: Tag },
  { id: 'split', label: 'Split', icon: Users },
];

function rupees(paise: number | null | undefined): string {
  return formatINR(fromPaise(paise || 0), true);
}

export const CalculatorSection: React.FC<CalculatorSectionProps> = ({ onOpenAddModal }) => {
  const toast = useToast();

  const [expression, setExpression] = useState('');
  const [tape, setTape] = useState('');
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [displayError, setDisplayError] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<CalculatorMode>('normal');
  const [copied, setCopied] = useState(false);

  // GST
  const [gstRate, setGstRate] = useState('18');
  const [gstOperation, setGstOperation] = useState<GstOperation>('add');
  const [gstTaxType, setGstTaxType] = useState<GstTaxType>('intra');
  const [gstSaveTarget, setGstSaveTarget] = useState<'taxable' | 'total'>('total');

  // Offer
  const [discountType, setDiscountType] = useState<DiscountType>('percent');
  const [discountValue, setDiscountValue] = useState('20');

  // Split
  const [people, setPeople] = useState('4');
  const [tip, setTip] = useState('');
  const [splitType, setSplitType] = useState<'equal' | 'custom'>('equal');
  const [customShares, setCustomShares] = useState<string[]>([]);

  // History
  const [historyList, setHistoryList] = useState<CalculationHistoryRecord[]>([]);
  const [isSavingHistory, setIsSavingHistory] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [settings, history] = await Promise.all([
          fetchCalculatorSettings(),
          fetchCalculationHistory(),
        ]);
        if (!mounted) return;
        if (settings?.default_gst_percent) setGstRate(String(settings.default_gst_percent));
        if (settings?.default_offer_percent) setDiscountValue(String(settings.default_offer_percent));
        if (settings?.default_split_people) setPeople(String(settings.default_split_people));
        setHistoryList(history);
      } catch {
        // Offline / unauthenticated: calculator still works with local defaults.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const displayPaise = useMemo(() => evaluateForDisplay(expression), [expression]);
  const amountPaise = displayPaise ?? 0;
  const totalPeople = parseInt(people, 10);

  useEffect(() => {
    const count = Number.isInteger(totalPeople) ? Math.min(Math.max(totalPeople, 1), MAX_SPLIT_PEOPLE) : 1;
    setCustomShares((prev) => Array.from({ length: count }, (_, i) => prev[i] ?? ''));
  }, [totalPeople]);

  const gstOutcome = useMemo(
    () => calculateGst(amountPaise, parseFloat(gstRate), gstOperation, gstTaxType),
    [amountPaise, gstRate, gstOperation, gstTaxType]
  );

  const discountOutcome = useMemo(
    () => calculateDiscount(amountPaise, discountType, parseFloat(discountValue)),
    [amountPaise, discountType, discountValue]
  );

  const tipPaise = parseAmountToPaise(tip) ?? 0;
  const customSharesPaise = customShares.map((share) => parseAmountToPaise(share) ?? 0);
  const splitTotalPaise = amountPaise + tipPaise;
  const customReconciliation = reconcileShares(splitTotalPaise, customSharesPaise);
  const splitOutcome = useMemo(
    () =>
      splitBill(amountPaise, totalPeople, {
        tipPaise,
        customShares: splitType === 'custom' ? customSharesPaise : null,
      }),
    [amountPaise, totalPeople, tipPaise, splitType, customSharesPaise]
  );

  // ---------------------------------------------------------------------------
  // Keypad
  // ---------------------------------------------------------------------------
  const handleKey = useCallback(
    (key: string) => {
      setDisplayError(null);
      if (key === 'AC') {
        setExpression('');
        setTape('');
        setJustEvaluated(false);
        return;
      }
      if (key === '⌫') {
        if (justEvaluated) {
          setJustEvaluated(false);
          setTape('');
        }
        setExpression((prev) => backspaceExpression(prev));
        return;
      }
      if (key === '=') {
        const result = evaluateExpression(expression);
        if (!result.ok) {
          setDisplayError(result.error);
          return;
        }
        const resolved = String(fromPaise(result.value));
        setTape(expression ? `${expression} =` : '');
        setExpression(resolved);
        setJustEvaluated(true);
        recordCalculation({
          calc_type: 'basic',
          title: `${expression || '0'} = ${resolved}`,
          input_values: { expression },
          result_values: { result: result.value / 100 },
        })
          .then((record) => setHistoryList((prev) => [record, ...prev.slice(0, 49)]))
          .catch(() => {});
        return;
      }

      const startFresh = justEvaluated;
      setJustEvaluated(false);

      if (/^\d$/.test(key)) {
        if (startFresh) {
          setExpression(key);
          setTape('');
        } else {
          setExpression((prev) => appendDigit(prev, key));
        }
        return;
      }
      if (key === '00') {
        if (startFresh) {
          setExpression('0');
          setTape('');
        } else {
          setExpression((prev) => appendDoubleZero(prev));
        }
        return;
      }
      if (key === '.') {
        if (startFresh) {
          setExpression('0.');
          setTape('');
        } else {
          setExpression((prev) => appendDecimal(prev));
        }
        return;
      }
      if (key === '%') {
        setExpression((prev) => appendPercent(prev));
        return;
      }
      if (key === '+' || key === '−' || key === '×' || key === '÷') {
        setExpression((prev) => appendOperator(prev, key));
        return;
      }
    },
    [expression, justEvaluated]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target?.tagName === 'BUTTON' && (event.key === 'Enter' || event.key === ' ')) return;

      const map: Record<string, string> = {
        Enter: '=',
        '=': '=',
        Backspace: '⌫',
        Escape: 'AC',
        '+': '+',
        '-': '−',
        '*': '×',
        x: '×',
        X: '×',
        '/': '÷',
        '%': '%',
        '.': '.',
      };
      const key = /^\d$/.test(event.key) ? event.key : map[event.key];
      if (!key) return;
      event.preventDefault();
      handleKey(key);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleKey]);

  const handleCopyResult = () => {
    if (displayPaise === null) return;
    navigator.clipboard.writeText(String(fromPaise(amountPaise)));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const toggleMode = (mode: CalculatorMode) => {
    setActiveMode((prev) => (prev === mode ? 'normal' : mode));
  };

  // Amount that "+ Add Transaction" will prefill, per mode rules.
  const savePaise = useMemo(() => {
    if (activeMode === 'normal') return amountPaise;
    if (activeMode === 'gst') {
      if (!gstOutcome.ok) return 0;
      return gstSaveTarget === 'total' ? gstOutcome.value.totalPaise : gstOutcome.value.taxablePaise;
    }
    if (activeMode === 'offer') return discountOutcome.ok ? discountOutcome.value.finalPaise : 0;
    return splitOutcome.ok ? splitOutcome.value.mySharePaise : 0;
  }, [activeMode, amountPaise, gstOutcome, gstSaveTarget, discountOutcome, splitOutcome]);

  const handleAddTransaction = () => {
    if (!onOpenAddModal) {
      toast.error('Unavailable', 'Transaction entry is not available right now.');
      return;
    }
    if (savePaise <= 0) {
      toast.info('Enter an amount first', 'Use the keypad to calculate the amount to save.');
      return;
    }
    const value = fromPaise(savePaise);

    if (activeMode === 'gst' && gstOutcome.ok) {
      onOpenAddModal(
        'other',
        'bills',
        undefined,
        value,
        `GST ${gstOperation === 'add' ? 'Bill' : 'Inclusive Bill'} (${gstOutcome.value.ratePercent}%)`
      );
    } else if (activeMode === 'offer' && discountOutcome.ok) {
      const label =
        discountType === 'percent' ? `${discountValue}% Off Purchase` : `₹${discountValue} Off Purchase`;
      onOpenAddModal('other', 'shopping', undefined, value, label);
    } else if (activeMode === 'split' && splitOutcome.ok) {
      onOpenAddModal(
        'other',
        'other_expense',
        undefined,
        value,
        `Split Bill Share (1/${splitOutcome.value.people})`
      );
    } else {
      onOpenAddModal('other', undefined, undefined, value, 'Calculator Entry');
    }
  };

  // ---------------------------------------------------------------------------
  // Calculation history
  // ---------------------------------------------------------------------------
  const buildHistoryPayload = (): Parameters<typeof recordCalculation>[0] | null => {
    if (activeMode === 'gst' && gstOutcome.ok) {
      return {
        calc_type: 'gst',
        title: `GST ${gstOutcome.value.ratePercent}% (${gstOperation === 'add' ? 'Add' : 'Remove'}) on ${rupees(
          gstOutcome.value.originalPaise
        )}`,
        input_values: {
          amount: fromPaise(gstOutcome.value.originalPaise),
          gst_percent: gstOutcome.value.ratePercent,
          type: gstOperation,
        },
        result_values: {
          gst_amount: fromPaise(gstOutcome.value.gstPaise),
          final_amount: fromPaise(gstOutcome.value.totalPaise),
        },
      };
    }
    if (activeMode === 'offer' && discountOutcome.ok) {
      return {
        calc_type: 'offer',
        title: `${discountValue}${discountType === 'percent' ? '%' : '₹'} off ${rupees(
          discountOutcome.value.originalPaise
        )}`,
        input_values: {
          original_amount: fromPaise(discountOutcome.value.originalPaise),
          discount_type: discountType,
          discount_value: discountValue,
        },
        result_values: {
          discount_amount: fromPaise(discountOutcome.value.discountPaise),
          final_price: fromPaise(discountOutcome.value.finalPaise),
          savings: fromPaise(discountOutcome.value.savingsPaise),
        },
      };
    }
    if (activeMode === 'split' && splitOutcome.ok) {
      return {
        calc_type: 'split',
        title: `Split ${rupees(splitOutcome.value.totalPaise)} among ${splitOutcome.value.people} people`,
        input_values: {
          total_amount: fromPaise(splitOutcome.value.totalPaise),
          people_count: splitOutcome.value.people,
        },
        result_values: {
          per_person: fromPaise(splitOutcome.value.perPersonPaise),
          base_per_person: fromPaise(splitOutcome.value.basePerPersonPaise),
          remainder: fromPaise(splitOutcome.value.remainderPaise),
        },
      };
    }
    return null;
  };

  const handleSaveCalculation = async () => {
    if (activeMode === 'normal') {
      toast.info('Press = first', 'Normal calculations are saved automatically when you press =.');
      return;
    }
    const payload = buildHistoryPayload();
    if (!payload) {
      toast.info('Nothing to save', 'Enter a valid amount to save this calculation.');
      return;
    }
    setIsSavingHistory(true);
    try {
      const record = await recordCalculation(payload);
      setHistoryList((prev) => [record, ...prev.slice(0, 49)]);
      toast.success('Saved', 'Calculation saved to calculator history.');
    } catch (error: any) {
      toast.error('Save failed', error?.message || 'Please try again.');
    } finally {
      setIsSavingHistory(false);
    }
  };

  const handleClearHistory = async () => {
    await clearCalculationHistory();
    setHistoryList([]);
  };

  const handleDeleteHistory = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    await clearCalculationHistory(id);
    setHistoryList((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRestore = (item: CalculationHistoryRecord) => {
    const inputs = item.input_values || {};
    if (item.calc_type === 'gst') {
      setActiveMode('gst');
      if (inputs.amount !== undefined) setExpression(String(inputs.amount));
      if (inputs.gst_percent !== undefined) setGstRate(String(inputs.gst_percent));
      if (inputs.type === 'add' || inputs.type === 'remove') setGstOperation(inputs.type);
    } else if (item.calc_type === 'offer') {
      setActiveMode('offer');
      if (inputs.original_amount !== undefined) setExpression(String(inputs.original_amount));
      if (inputs.discount_value !== undefined) setDiscountValue(String(inputs.discount_value));
      if (inputs.discount_type === 'percent' || inputs.discount_type === 'fixed') {
        setDiscountType(inputs.discount_type);
      }
    } else if (item.calc_type === 'split') {
      setActiveMode('split');
      if (inputs.total_amount !== undefined) setExpression(String(inputs.total_amount));
      if (inputs.people_count !== undefined) setPeople(String(inputs.people_count));
    } else if (item.result_values?.result !== undefined) {
      setActiveMode('normal');
      setExpression(String(item.result_values.result));
    }
    setJustEvaluated(false);
    setTape('');
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const inlineError = activeMode === 'gst' && !gstOutcome.ok ? gstOutcome.error : null;
  const offerError = activeMode === 'offer' && !discountOutcome.ok ? discountOutcome.error : null;
  const splitError = activeMode === 'split' && !splitOutcome.ok ? splitOutcome.error : null;

  return (
    <div className="animate-fade-in pb-20 lg:pb-8">
      <div className="mx-auto w-full max-w-xl space-y-3 sm:space-y-4">
        {/* Heading */}
        <header className="px-1">
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
            <CalcIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            Calculator
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400">
            Normal math, GST, discounts and bill splits — one screen, no page jumps.
          </p>
        </header>

        {/* Display */}
        <section
          aria-label="Calculation display"
          className="rounded-3xl border border-slate-800 bg-slate-900 p-4 text-white shadow-sm dark:bg-slate-950"
        >
          <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
            <span className="truncate">{activeMode === 'normal' ? 'Normal' : activeMode.toUpperCase()}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopyResult}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:text-white"
                title="Copy result"
                aria-label="Copy result"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              {activeMode !== 'normal' && (
                <button
                  type="button"
                  onClick={handleSaveCalculation}
                  disabled={isSavingHistory}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:text-white disabled:opacity-50"
                  title="Save calculation to history"
                  aria-label="Save calculation to history"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="mt-1 min-h-[24px] truncate text-right font-mono text-xs text-slate-400">
            {tape || expression || 'Ready'}
          </div>
          <div
            className="mt-0.5 break-all text-right font-mono text-3xl font-black tracking-tight text-emerald-400 sm:text-4xl"
            aria-live="polite"
          >
            {displayPaise === null ? '—' : rupees(amountPaise)}
          </div>
          {displayError && (
            <p role="alert" className="mt-1 text-right text-[11px] font-semibold text-rose-400">
              {displayError}
            </p>
          )}

          {/* Same-screen mode panels — compact, inside the display card */}
          {activeMode === 'gst' && (
            <div className="mt-3 space-y-2 rounded-2xl border border-slate-700/80 bg-slate-800/50 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Segmented
                  value={gstOperation}
                  options={[
                    { id: 'add', label: 'Add GST' },
                    { id: 'remove', label: 'Remove GST' },
                  ]}
                  onChange={(v) => setGstOperation(v as GstOperation)}
                />
                <Segmented
                  value={gstTaxType}
                  options={[
                    { id: 'intra', label: 'CGST + SGST' },
                    { id: 'inter', label: 'IGST' },
                  ]}
                  onChange={(v) => setGstTaxType(v as GstTaxType)}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {GST_RATES.map((rate) => (
                  <Chip key={rate} active={gstRate === String(rate)} onClick={() => setGstRate(String(rate))}>
                    {rate}%
                  </Chip>
                ))}
                <label className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-slate-300">
                  Custom
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="any"
                    value={gstRate}
                    onChange={(event) => setGstRate(event.target.value)}
                    aria-label="Custom GST rate percentage"
                    className="w-16 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-right font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                  %
                </label>
              </div>

              {gstOutcome.ok ? (
                <>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <MiniStat label="Taxable" value={rupees(gstOutcome.value.taxablePaise)} />
                    <MiniStat
                      label={gstTaxType === 'intra' ? 'CGST + SGST' : 'IGST'}
                      value={rupees(gstOutcome.value.gstPaise)}
                      hint={
                        gstTaxType === 'intra'
                          ? `${rupees(gstOutcome.value.cgstPaise)} + ${rupees(gstOutcome.value.sgstPaise)}`
                          : undefined
                      }
                    />
                    <MiniStat
                      label={gstOperation === 'add' ? 'Final payable' : 'Total (incl.)'}
                      value={rupees(gstOutcome.value.totalPaise)}
                      highlight
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
                    <span className="font-semibold">Save amount:</span>
                    <Segmented
                      value={gstSaveTarget}
                      options={[
                        { id: 'taxable', label: 'Taxable' },
                        { id: 'total', label: gstOperation === 'add' ? 'Final' : 'Inclusive' },
                      ]}
                      onChange={(v) => setGstSaveTarget(v as 'taxable' | 'total')}
                    />
                  </div>
                </>
              ) : (
                <p className="text-[11px] font-medium text-amber-300">{inlineError}</p>
              )}
            </div>
          )}

          {activeMode === 'offer' && (
            <div className="mt-3 space-y-2 rounded-2xl border border-slate-700/80 bg-slate-800/50 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Segmented
                  value={discountType}
                  options={[
                    { id: 'percent', label: '% Off' },
                    { id: 'fixed', label: '₹ Off' },
                  ]}
                  onChange={(v) => setDiscountType(v as DiscountType)}
                />
                <label className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-slate-300">
                  Discount
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={discountValue}
                    onChange={(event) => setDiscountValue(event.target.value)}
                    aria-label={discountType === 'percent' ? 'Discount percentage' : 'Discount amount in rupees'}
                    className="w-16 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-right font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                  {discountType === 'percent' ? '%' : '₹'}
                </label>
              </div>

              {discountType === 'percent' && (
                <div className="flex flex-wrap gap-1.5">
                  {OFFER_PERCENTS.map((pct) => (
                    <Chip
                      key={pct}
                      active={discountValue === String(pct)}
                      onClick={() => setDiscountValue(String(pct))}
                    >
                      {pct}%
                    </Chip>
                  ))}
                </div>
              )}

              {discountOutcome.ok ? (
                <div className="grid grid-cols-4 gap-1.5 text-[10px] sm:text-[11px]">
                  <MiniStat label="Original" value={rupees(discountOutcome.value.originalPaise)} />
                  <MiniStat label="Discount" value={`-${rupees(discountOutcome.value.discountPaise)}`} />
                  <MiniStat label="You save" value={rupees(discountOutcome.value.savingsPaise)} />
                  <MiniStat label="Final" value={rupees(discountOutcome.value.finalPaise)} highlight />
                </div>
              ) : (
                <p className="text-[11px] font-medium text-amber-300">{offerError}</p>
              )}
            </div>
          )}

          {activeMode === 'split' && (
            <div className="mt-3 space-y-2 rounded-2xl border border-slate-700/80 bg-slate-800/50 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-300">
                  People
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={MAX_SPLIT_PEOPLE}
                    step="1"
                    value={people}
                    onChange={(event) => setPeople(event.target.value)}
                    aria-label="Number of people"
                    className="w-14 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-right font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-300">
                  Tip / extra
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={tip}
                    onChange={(event) => setTip(event.target.value)}
                    aria-label="Tip or additional charges in rupees"
                    className="w-16 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-right font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <div className="ml-auto">
                  <Segmented
                    value={splitType}
                    options={[
                      { id: 'equal', label: 'Equal' },
                      { id: 'custom', label: 'Custom' },
                    ]}
                    onChange={(v) => setSplitType(v as 'equal' | 'custom')}
                  />
                </div>
              </div>

              {splitType === 'custom' && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {customShares.map((share, index) => (
                      <label key={index} className="flex items-center gap-1 text-[10px] text-slate-400">
                        P{index + 1}
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={share}
                          onChange={(event) =>
                            setCustomShares((prev) => {
                              const next = [...prev];
                              next[index] = event.target.value;
                              return next;
                            })
                          }
                          aria-label={`Share for person ${index + 1} in rupees`}
                          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-1.5 py-1 text-right font-mono text-[11px] text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </label>
                    ))}
                  </div>
                  <p
                    className={`text-[11px] font-semibold ${
                      customReconciliation.balanced ? 'text-emerald-400' : 'text-amber-300'
                    }`}
                  >
                    {customReconciliation.balanced
                      ? 'All shares reconcile with the total.'
                      : customReconciliation.unallocatedPaise > 0
                      ? `Unallocated: ${rupees(customReconciliation.unallocatedPaise)}`
                      : `Over by ${rupees(Math.abs(customReconciliation.unallocatedPaise))}`}
                  </p>
                </div>
              )}

              {splitOutcome.ok ? (
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <MiniStat label="Total bill" value={rupees(splitOutcome.value.totalPaise)} />
                  <MiniStat label="People" value={String(splitOutcome.value.people)} />
                  <MiniStat
                    label="Your share"
                    value={rupees(splitOutcome.value.mySharePaise)}
                    highlight
                    hint={splitType === 'equal' ? 'per person' : undefined}
                  />
                </div>
              ) : (
                <p className="text-[11px] font-medium text-amber-300">{splitError}</p>
              )}

              {splitOutcome.ok && splitOutcome.value.remainderPaise > 0 && splitType === 'equal' && (
                <p className="flex items-start gap-1 text-[10px] leading-relaxed text-slate-400">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  Exact split: {splitOutcome.value.peoplePayingHigher} pay{' '}
                  {rupees(splitOutcome.value.higherPerPersonPaise)} and {splitOutcome.value.peoplePayingBase} pay{' '}
                  {rupees(splitOutcome.value.basePerPersonPaise)} — no rupee lost.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Compact mode shortcuts — directly above the first keypad row */}
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Calculator shortcuts">
          {MODES.map(({ id, label, icon: Icon }) => {
            const active = activeMode === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => toggleMode(id)}
                className={`flex h-9 items-center justify-center gap-1.5 rounded-xl border text-xs font-bold transition-colors ${
                  active
                    ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-4 gap-2 select-none" role="group" aria-label="Calculator keypad">
          {KEY_ROWS.flat().map((key) => {
            const isUtility = key === 'AC' || key === '⌫' || key === '%';
            const isOperator = key === '÷' || key === '×' || key === '−' || key === '+';
            const isEquals = key === '=';
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleKey(key)}
                aria-label={key === '⌫' ? 'Backspace' : key === 'AC' ? 'Clear all' : key}
                className={`h-11 rounded-2xl text-base font-bold transition-colors active:scale-95 sm:h-12 ${
                  isEquals
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-700'
                    : isOperator
                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:hover:bg-emerald-900/80'
                    : isUtility
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    : 'bg-slate-50 text-slate-800 shadow-sm hover:bg-slate-100 dark:bg-slate-800/60 dark:text-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {key}
              </button>
            );
          })}
        </div>

        {/* Add Transaction */}
        <button
          type="button"
          onClick={handleAddTransaction}
          disabled={savePaise <= 0}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add Transaction
          {savePaise > 0 && <span className="font-mono text-xs opacity-90">· {rupees(savePaise)}</span>}
        </button>

        {/* Calculation history (separate from financial transactions) */}
        <details className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300">
            <Receipt className="h-3.5 w-3.5 text-emerald-600" />
            Calculation history
            <span className="ml-auto text-[11px] font-semibold text-slate-400">{historyList.length}</span>
          </summary>
          <div className="space-y-1.5 border-t border-slate-100 p-2.5 dark:border-slate-800">
            {historyList.length === 0 ? (
              <p className="flex items-center gap-1.5 py-3 text-center text-[11px] text-slate-400">
                <Clock className="h-3.5 w-3.5" /> Saved calculations will appear here. These are not expenses.
              </p>
            ) : (
              <>
                {historyList.slice(0, 12).map((item) => (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRestore(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') handleRestore(item);
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50 px-2.5 py-1.5 hover:bg-emerald-50 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-emerald-950/40"
                  >
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      {item.calc_type}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      {item.title || 'Calculation'}
                    </span>
                    <button
                      type="button"
                      onClick={(event) => handleDeleteHistory(item.id, event)}
                      className="p-0.5 text-slate-400 hover:text-rose-500"
                      aria-label="Delete calculation record"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-400">Tap a record to restore its values.</span>
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-rose-500"
                  >
                    <RotateCcw className="h-3 w-3" /> Clear
                  </button>
                </div>
              </>
            )}
          </div>
        </details>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-slate-900/70 p-0.5" role="group">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-md px-2 py-1 text-[10px] font-bold transition-colors sm:text-[11px] ${
            value === option.id
              ? 'bg-emerald-600 text-white'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors sm:text-[11px] ${
        active
          ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
          : 'border-slate-600 bg-slate-900/40 text-slate-300 hover:bg-slate-700/50'
      }`}
    >
      {children}
    </button>
  );
}

function MiniStat({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-900/60 px-2 py-1.5">
      <p className="truncate text-[10px] font-semibold text-slate-400">{label}</p>
      <p
        className={`truncate font-mono text-xs font-bold ${
          highlight ? 'text-emerald-400' : 'text-slate-100'
        }`}
      >
        {value}
      </p>
      {hint && <p className="truncate font-mono text-[9px] text-slate-500">{hint}</p>}
    </div>
  );
}
