import React, { useState, useMemo, useEffect } from 'react';
import {
  Calculator as CalcIcon,
  Users,
  Divide,
  Percent,
  Plus,
  Minus,
  RotateCcw,
  Copy,
  Check,
  Share2,
  Trash2,
  Sparkles,
  ArrowRight,
  MessageCircle,
  CheckCircle2,
  DollarSign,
  UserPlus,
  X,
  Receipt,
  Info,
  Calendar,
  Clock,
  Utensils,
  DoorOpen,
  ShoppingBag,
  ExternalLink,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { formatINR, getCurrentISTDate, getCurrentISTTime } from '../../lib/dateUtils';
import { TransactionCategory } from '../../types';

interface CalculatorSectionProps {
  onOpenAddModal?: (
    category?: TransactionCategory,
    subcategory?: any,
    personName?: string,
    amount?: number | string,
    title?: string
  ) => void;
}

interface SplitMember {
  id: string;
  name: string;
  isYou: boolean;
  included: boolean; // For equal split
  customAmount: number; // For exact split
  customPercent: number; // For percent split
  customShares: number; // For shares split
  paidAmount: number; // How much this person actually paid
}

interface SettlementTransfer {
  from: string;
  to: string;
  amount: number;
}

interface CalculationHistoryItem {
  id: string;
  expression: string;
  result: number;
  timestamp: string;
}

export const CalculatorSection: React.FC<CalculatorSectionProps> = ({ onOpenAddModal }) => {
  const { peopleSummaries, addTransaction } = useExpense();
  const { user } = useAuth();
  const toast = useToast();

  // Active Tool Mode: 'calculator' or 'splitwise'
  const [activeMode, setActiveMode] = useState<'calculator' | 'splitwise'>('calculator');

  // =========================================================================
  // CALCULATOR ENGINE STATE
  // =========================================================================
  const [displayValue, setDisplayValue] = useState<string>('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState<boolean>(false);
  const [expressionTape, setExpressionTape] = useState<string>('');
  const [historyTape, setHistoryTape] = useState<CalculationHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('mm_calc_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isCopiedCalc, setIsCopiedCalc] = useState(false);

  // Save history tape to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('mm_calc_history', JSON.stringify(historyTape.slice(0, 30)));
    } catch {
      // ignore
    }
  }, [historyTape]);

  // Calculator Key Actions
  const handleDigit = (digit: string) => {
    if (waitingForOperand) {
      setDisplayValue(digit);
      setWaitingForOperand(false);
    } else {
      setDisplayValue(displayValue === '0' ? digit : displayValue + digit);
    }
  };

  const handleDecimal = () => {
    if (waitingForOperand) {
      setDisplayValue('0.');
      setWaitingForOperand(false);
    } else if (!displayValue.includes('.')) {
      setDisplayValue(displayValue + '.');
    }
  };

  const handleClear = () => {
    setDisplayValue('0');
    setPreviousValue(null);
    setOperator(null);
    setWaitingForOperand(false);
    setExpressionTape('');
  };

  const handleDelete = () => {
    if (waitingForOperand) return;
    if (displayValue.length > 1) {
      setDisplayValue(displayValue.slice(0, -1));
    } else {
      setDisplayValue('0');
    }
  };

  const handleToggleSign = () => {
    const val = parseFloat(displayValue);
    if (!isNaN(val) && val !== 0) {
      setDisplayValue(String(-val));
    }
  };

  const performCalculation = (op: string, prev: number, current: number): number => {
    switch (op) {
      case '+':
        return prev + current;
      case '-':
        return prev - current;
      case '×':
      case '*':
        return prev * current;
      case '÷':
      case '/':
        return current !== 0 ? prev / current : 0;
      default:
        return current;
    }
  };

  const handleOperator = (nextOp: string) => {
    const inputValue = parseFloat(displayValue);

    if (previousValue === null) {
      setPreviousValue(inputValue);
      setExpressionTape(`${inputValue} ${nextOp}`);
    } else if (operator) {
      const currentValue = previousValue || 0;
      const result = performCalculation(operator, currentValue, inputValue);
      const cleanResult = Math.round(result * 10000) / 10000;
      setDisplayValue(String(cleanResult));
      setPreviousValue(cleanResult);
      setExpressionTape(`${cleanResult} ${nextOp}`);
    }

    setWaitingForOperand(true);
    setOperator(nextOp);
  };

  const handleEquals = () => {
    const inputValue = parseFloat(displayValue);

    if (previousValue !== null && operator) {
      const result = performCalculation(operator, previousValue, inputValue);
      const cleanResult = Math.round(result * 10000) / 10000;
      const fullExpr = `${previousValue} ${operator} ${inputValue} =`;

      setDisplayValue(String(cleanResult));
      setExpressionTape(fullExpr);
      setPreviousValue(null);
      setOperator(null);
      setWaitingForOperand(true);

      // Add to history
      const newHist: CalculationHistoryItem = {
        id: String(Date.now()),
        expression: fullExpr,
        result: cleanResult,
        timestamp: getCurrentISTTime(),
      };
      setHistoryTape((prev) => [newHist, ...prev.slice(0, 29)]);
    }
  };

  const handlePercentage = () => {
    const val = parseFloat(displayValue);
    if (isNaN(val)) return;
    const res = val / 100;
    setDisplayValue(String(res));
  };

  // Quick Shortcuts: GST (+5%, +12%, +18%, +28%) and Discounts
  const applyGst = (pct: number) => {
    const val = parseFloat(displayValue);
    if (isNaN(val) || val <= 0) return;
    const added = val * (1 + pct / 100);
    const clean = Math.round(added * 100) / 100;
    setExpressionTape(`${val} + ${pct}% GST =`);
    setDisplayValue(String(clean));
    setWaitingForOperand(true);
    toast.info('GST Applied', `Added ${pct}% GST: ₹${clean.toLocaleString('en-IN')}`);
  };

  const removeGst = (pct: number) => {
    const val = parseFloat(displayValue);
    if (isNaN(val) || val <= 0) return;
    const base = val / (1 + pct / 100);
    const clean = Math.round(base * 100) / 100;
    setExpressionTape(`${val} - ${pct}% reverse GST =`);
    setDisplayValue(String(clean));
    setWaitingForOperand(true);
    toast.info('GST Deducted', `Base price without ${pct}% GST: ₹${clean.toLocaleString('en-IN')}`);
  };

  const applyQuickDivide = (divisor: number) => {
    const val = parseFloat(displayValue);
    if (isNaN(val) || val <= 0) return;
    const perHead = Math.round((val / divisor) * 100) / 100;
    setExpressionTape(`${val} ÷ ${divisor} people =`);
    setDisplayValue(String(perHead));
    setWaitingForOperand(true);
    toast.info('Split Calculated', `₹${val.toLocaleString('en-IN')} divided among ${divisor} = ₹${perHead.toLocaleString('en-IN')} each`);
  };

  const applyDiscount = (pct: number) => {
    const val = parseFloat(displayValue);
    if (isNaN(val) || val <= 0) return;
    const discounted = val * (1 - pct / 100);
    const clean = Math.round(discounted * 100) / 100;
    setExpressionTape(`${val} - ${pct}% discount =`);
    setDisplayValue(String(clean));
    setWaitingForOperand(true);
    toast.info('Discount Applied', `After ${pct}% off: ₹${clean.toLocaleString('en-IN')}`);
  };

  const copyCalcResult = () => {
    navigator.clipboard.writeText(displayValue);
    setIsCopiedCalc(true);
    setTimeout(() => setIsCopiedCalc(false), 2000);
    toast.success('Copied', `Result ₹${displayValue} copied to clipboard!`);
  };

  // Send current calculator value into Splitwise
  const sendToSplitwise = () => {
    const val = parseFloat(displayValue);
    if (!isNaN(val) && val > 0) {
      setBillTotal(String(val));
      setActiveMode('splitwise');
      toast.success('Amount Transferred', `₹${val.toLocaleString('en-IN')} loaded into Splitwise Bill Total!`);
    } else {
      setActiveMode('splitwise');
    }
  };

  // =========================================================================
  // SPLITWISE (BILL SPLITTER) STATE
  // =========================================================================
  const defaultUserName = user?.displayName || user?.full_name || 'You';

  const [billTitle, setBillTitle] = useState<string>('Dinner / Expense');
  const [billTotal, setBillTotal] = useState<string>('');
  const [billDate, setBillDate] = useState<string>(getCurrentISTDate());
  const [billCategory, setBillCategory] = useState<TransactionCategory>('food');
  const [newMemberName, setNewMemberName] = useState<string>('');
  const [payerMode, setPayerMode] = useState<'single' | 'multiple'>('single');
  const [singlePayerId, setSinglePayerId] = useState<string>('you');
  const [splitStrategy, setSplitStrategy] = useState<'equal' | 'exact' | 'percent' | 'shares'>('equal');
  const [isCopiedSplit, setIsCopiedSplit] = useState(false);
  const [recordedDebts, setRecordedDebts] = useState<Record<string, boolean>>({});

  // Group Members List
  const [members, setMembers] = useState<SplitMember[]>([
    {
      id: 'you',
      name: `${defaultUserName} (You)`,
      isYou: true,
      included: true,
      customAmount: 0,
      customPercent: 50,
      customShares: 1,
      paidAmount: 0,
    },
    {
      id: 'member-2',
      name: 'Friend 1',
      isYou: false,
      included: true,
      customAmount: 0,
      customPercent: 50,
      customShares: 1,
      paidAmount: 0,
    },
  ]);

  // Sync paid amount when in single payer mode
  useEffect(() => {
    const totalNum = parseFloat(billTotal) || 0;
    if (payerMode === 'single') {
      setMembers((prev) =>
        prev.map((m) => ({
          ...m,
          paidAmount: m.id === singlePayerId ? totalNum : 0,
        }))
      );
    }
  }, [payerMode, singlePayerId, billTotal]);

  // Add a member by name
  const handleAddMember = (nameToAdd?: string) => {
    const targetName = (nameToAdd || newMemberName).trim();
    if (!targetName) return;

    // Check duplicate
    if (members.some((m) => m.name.toLowerCase() === targetName.toLowerCase())) {
      toast.info('Already in group', `${targetName} is already added.`);
      return;
    }

    const newId = `member-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const newMember: SplitMember = {
      id: newId,
      name: targetName,
      isYou: false,
      included: true,
      customAmount: 0,
      customPercent: 0,
      customShares: 1,
      paidAmount: 0,
    };

    setMembers((prev) => [...prev, newMember]);
    setNewMemberName('');
    toast.success('Member Added', `${targetName} added to the split.`);
  };

  // Remove a member
  const handleRemoveMember = (id: string) => {
    if (members.length <= 2) {
      toast.error('Minimum 2 Members', 'A split requires at least two members.');
      return;
    }
    const target = members.find((m) => m.id === id);
    if (target?.isYou) {
      toast.error('Cannot remove owner', 'You cannot remove yourself from the split.');
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== id));
    if (singlePayerId === id) {
      setSinglePayerId('you');
    }
  };

  // Toggle included in equal split
  const handleToggleInclude = (id: string) => {
    setMembers((prev) => {
      const activeCount = prev.filter((m) => m.included).length;
      const target = prev.find((m) => m.id === id);
      if (target?.included && activeCount <= 1) {
        toast.error('At least one member', 'At least one member must be included in the split.');
        return prev;
      }
      return prev.map((m) => (m.id === id ? { ...m, included: !m.included } : m));
    });
  };

  // Update member field (paidAmount, customAmount, customPercent, customShares)
  const handleUpdateMember = (id: string, field: keyof SplitMember, val: any) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: val } : m))
    );
  };

  // Quick add from saved people in People section
  const savedPeopleNames = useMemo(() => {
    const list: string[] = [];
    peopleSummaries.forEach((p) => {
      if (p.name && !members.some((m) => m.name.toLowerCase() === p.name.toLowerCase())) {
        list.push(p.name);
      }
    });
    return list.slice(0, 8);
  }, [peopleSummaries, members]);

  // =========================================================================
  // SPLIT CALCULATIONS & DEBT SIMPLIFICATION
  // =========================================================================
  const numericTotal = parseFloat(billTotal) || 0;

  // Calculate each member's share based on split strategy
  const computedMembers = useMemo(() => {
    if (numericTotal <= 0 || members.length === 0) {
      return members.map((m) => ({ ...m, share: 0, net: m.paidAmount }));
    }

    if (splitStrategy === 'equal') {
      const activeMembers = members.filter((m) => m.included);
      const count = activeMembers.length || 1;
      const rawShare = numericTotal / count;
      const roundedShare = Math.round(rawShare * 100) / 100;

      return members.map((m) => {
        const share = m.included ? roundedShare : 0;
        const net = Math.round((m.paidAmount - share) * 100) / 100;
        return { ...m, share, net };
      });
    }

    if (splitStrategy === 'exact') {
      return members.map((m) => {
        const share = m.customAmount || 0;
        const net = Math.round((m.paidAmount - share) * 100) / 100;
        return { ...m, share, net };
      });
    }

    if (splitStrategy === 'percent') {
      return members.map((m) => {
        const share = Math.round((numericTotal * ((m.customPercent || 0) / 100)) * 100) / 100;
        const net = Math.round((m.paidAmount - share) * 100) / 100;
        return { ...m, share, net };
      });
    }

    if (splitStrategy === 'shares') {
      const totalShares = members.reduce((sum, m) => sum + (m.customShares || 1), 0) || 1;
      return members.map((m) => {
        const share = Math.round((numericTotal * ((m.customShares || 1) / totalShares)) * 100) / 100;
        const net = Math.round((m.paidAmount - share) * 100) / 100;
        return { ...m, share, net };
      });
    }

    return members.map((m) => ({ ...m, share: 0, net: m.paidAmount }));
  }, [numericTotal, members, splitStrategy]);

  // Validation warnings
  const totalSharesAllocated = useMemo(() => {
    return computedMembers.reduce((sum, m) => sum + m.share, 0);
  }, [computedMembers]);

  const totalPaidAllocated = useMemo(() => {
    return computedMembers.reduce((sum, m) => sum + m.paidAmount, 0);
  }, [computedMembers]);

  const exactDifference = Math.round((numericTotal - totalSharesAllocated) * 100) / 100;
  const paidDifference = Math.round((numericTotal - totalPaidAllocated) * 100) / 100;

  // Compute Optimal Settlements (Debt Simplification)
  const settlements = useMemo<SettlementTransfer[]>(() => {
    if (numericTotal <= 0) return [];

    let creditors: { name: string; amount: number }[] = [];
    let debtors: { name: string; amount: number }[] = [];

    computedMembers.forEach((m) => {
      if (m.net > 0.05) {
        creditors.push({ name: m.name, amount: m.net });
      } else if (m.net < -0.05) {
        debtors.push({ name: m.name, amount: Math.abs(m.net) });
      }
    });

    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);

    const transfers: SettlementTransfer[] = [];
    let i = 0;
    let j = 0;

    // Clone objects so we don't mutate state
    const cList = creditors.map((c) => ({ ...c }));
    const dList = debtors.map((d) => ({ ...d }));

    while (i < cList.length && j < dList.length) {
      const settle = Math.min(cList[i].amount, dList[j].amount);
      if (settle > 0.05) {
        transfers.push({
          from: dList[j].name,
          to: cList[i].name,
          amount: Math.round(settle * 100) / 100,
        });
      }

      cList[i].amount = Math.round((cList[i].amount - settle) * 100) / 100;
      dList[j].amount = Math.round((dList[j].amount - settle) * 100) / 100;

      if (cList[i].amount <= 0.05) i++;
      if (dList[j].amount <= 0.05) j++;
    }

    return transfers;
  }, [computedMembers, numericTotal]);

  // WhatsApp Message Generator
  const generateWhatsAppMessage = () => {
    let msg = `🧾 *Bill Split: ${billTitle || 'Expense'}*\n`;
    msg += `💰 *Total Bill:* ₹${numericTotal.toLocaleString('en-IN')}\n`;
    msg += `📅 *Date:* ${billDate}\n\n`;

    msg += `👥 *Members & Shares:*\n`;
    computedMembers.forEach((m) => {
      const netStr =
        m.net > 0.05
          ? `(Gets back ₹${m.net.toLocaleString('en-IN')})`
          : m.net < -0.05
          ? `(Owes ₹${Math.abs(m.net).toLocaleString('en-IN')})`
          : `(Settled)`;
      msg += `• *${m.name}*: Paid ₹${m.paidAmount.toLocaleString('en-IN')} | Share ₹${m.share.toLocaleString('en-IN')} ${netStr}\n`;
    });

    if (settlements.length > 0) {
      msg += `\n🤝 *Settlement Summary (Who pays whom):*\n`;
      settlements.forEach((s) => {
        msg += `👉 *${s.from}* pays *${s.to}*: ₹${s.amount.toLocaleString('en-IN')}\n`;
      });
    }

    msg += `\n✨ _Calculated via My Money Manager_`;
    return msg;
  };

  const handleShareWhatsApp = () => {
    const text = generateWhatsAppMessage();
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
    toast.success('WhatsApp Opened', 'Bill breakdown ready to send!');
  };

  const handleCopySplit = () => {
    const text = generateWhatsAppMessage();
    navigator.clipboard.writeText(text);
    setIsCopiedSplit(true);
    setTimeout(() => setIsCopiedSplit(false), 2000);
    toast.success('Copied', 'Bill summary copied to clipboard.');
  };

  // Record an owed debt into the real "People (Udhar)" ledger
  const handleRecordDebtInPeople = async (transfer: SettlementTransfer, index: number) => {
    try {
      // Determine if You are the creditor or debtor
      const youMember = computedMembers.find((m) => m.isYou);
      const youName = youMember?.name || 'You';

      const isYouCreditor = transfer.to === youName;
      const otherPersonName = isYouCreditor ? transfer.from : transfer.to;
      const cleanName = otherPersonName.replace(/\s*\(You\)/i, '').trim();

      await addTransaction({
        title: `Split: ${billTitle || 'Group Bill'}`,
        amount: transfer.amount,
        category: 'people',
        subcategory: isYouCreditor ? 'money_given' : 'money_received',
        transaction_type: isYouCreditor ? 'expense' : 'income',
        transaction_date: billDate,
        transaction_time: getCurrentISTTime(),
        notes: `Splitwise Bill "${billTitle}". ${transfer.from} pays ${transfer.to} ₹${transfer.amount}`,
        person_name: cleanName,
      });

      setRecordedDebts((prev) => ({ ...prev, [`debt-${index}`]: true }));
      toast.success(
        'Udhar Recorded!',
        `Logged ₹${transfer.amount.toLocaleString('en-IN')} for "${cleanName}" in People Ledger.`
      );
    } catch (err: any) {
      toast.error('Record Failed', err.message || 'Could not record debt');
    }
  };

  // Save the user's personal share directly as an expense
  const handleSaveMyShareAsExpense = async () => {
    const you = computedMembers.find((m) => m.isYou);
    if (!you || you.share <= 0) {
      toast.info('No share', 'Your share is ₹0.');
      return;
    }

    try {
      await addTransaction({
        title: `My Share: ${billTitle || 'Group Bill'}`,
        amount: you.share,
        category: billCategory,
        subcategory: billCategory === 'food' ? 'restaurant' : billCategory === 'room' ? 'grocery' : 'other_expense',
        transaction_type: 'expense',
        transaction_date: billDate,
        transaction_time: getCurrentISTTime(),
        notes: `My individual portion from Splitwise bill "${billTitle}" (Total Bill: ₹${numericTotal})`,
      });

      toast.success(
        'Expense Saved!',
        `Logged ₹${you.share.toLocaleString('en-IN')} to ${billCategory.toUpperCase()} expenses.`
      );
    } catch (err: any) {
      toast.error('Save Failed', err.message || 'Could not save expense');
    }
  };

  // Reset Splitwise Form
  const handleResetSplitwise = () => {
    setBillTitle('Dinner / Expense');
    setBillTotal('');
    setBillDate(getCurrentISTDate());
    setPayerMode('single');
    setSinglePayerId('you');
    setSplitStrategy('equal');
    setRecordedDebts({});
    setMembers([
      {
        id: 'you',
        name: `${defaultUserName} (You)`,
        isYou: true,
        included: true,
        customAmount: 0,
        customPercent: 50,
        customShares: 1,
        paidAmount: 0,
      },
      {
        id: 'member-2',
        name: 'Friend 1',
        isYou: false,
        included: true,
        customAmount: 0,
        customPercent: 50,
        customShares: 1,
        paidAmount: 0,
      },
    ]);
    toast.info('Reset', 'Splitwise form cleared for a fresh bill.');
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in pb-20 lg:pb-8">
      {/* Top Banner & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 sm:p-6 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 rounded-3xl text-white shadow-xl shadow-indigo-900/10">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-semibold tracking-wide uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Financial Utilities</span>
          </span>
          <h2 className="text-xl sm:text-2xl font-black mt-2 tracking-tight">
            Calculator & Splitwise (बिल स्प्लिटर)
          </h2>
          <p className="text-xs sm:text-sm text-indigo-100/90 mt-1 font-medium">
            Smart calculations, quick GST & tax tally, and group bill splitting with WhatsApp settlements
          </p>
        </div>

        {/* Mode Toggle Pills */}
        <div className="flex items-center gap-1.5 p-1 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 self-start sm:self-auto">
          <button
            onClick={() => setActiveMode('calculator')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeMode === 'calculator'
                ? 'bg-white text-indigo-700 shadow-md scale-100'
                : 'text-white/80 hover:text-white hover:bg-white/10'
            }`}
          >
            <CalcIcon className="w-4 h-4" />
            <span>Smart Calculator</span>
          </button>
          <button
            onClick={() => setActiveMode('splitwise')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeMode === 'splitwise'
                ? 'bg-white text-indigo-700 shadow-md scale-100'
                : 'text-white/80 hover:text-white hover:bg-white/10'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Splitwise (Split Bill)</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          MODE 1: SMART CALCULATOR
          ========================================================================= */}
      {activeMode === 'calculator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Calculator Screen & Keypad */}
          <div className="lg:col-span-7 xl:col-span-8 bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            {/* Digital Display Area */}
            <div className="bg-slate-900 dark:bg-slate-950 rounded-2xl p-4 sm:p-5 text-white flex flex-col justify-between min-h-[120px] shadow-inner relative overflow-hidden border border-slate-800">
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                <span className="truncate pr-2">{expressionTape || 'Ready'}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={copyCalcResult}
                    className="p-1 text-slate-400 hover:text-white transition-colors"
                    title="Copy Result"
                  >
                    {isCopiedCalc ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="text-right mt-2">
                <span className="text-3xl sm:text-5xl font-black font-mono tracking-tight text-emerald-400 select-all break-all">
                  {displayValue}
                </span>
              </div>
            </div>

            {/* Quick Financial Shortcuts Bar */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <span>Quick GST & Tax Shortcuts</span>
                <span className="text-indigo-600 dark:text-indigo-400 font-semibold lowercase">tap to apply</span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                <button
                  onClick={() => applyGst(5)}
                  className="py-1.5 px-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 rounded-xl text-xs font-bold transition-all border border-emerald-200 dark:border-emerald-800"
                >
                  +5% GST
                </button>
                <button
                  onClick={() => applyGst(12)}
                  className="py-1.5 px-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 rounded-xl text-xs font-bold transition-all border border-emerald-200 dark:border-emerald-800"
                >
                  +12% GST
                </button>
                <button
                  onClick={() => applyGst(18)}
                  className="py-1.5 px-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 rounded-xl text-xs font-bold transition-all border border-emerald-200 dark:border-emerald-800"
                >
                  +18% GST
                </button>
                <button
                  onClick={() => applyGst(28)}
                  className="py-1.5 px-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 rounded-xl text-xs font-bold transition-all border border-emerald-200 dark:border-emerald-800"
                >
                  +28% GST
                </button>
                <button
                  onClick={() => removeGst(5)}
                  className="py-1.5 px-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 rounded-xl text-xs font-bold transition-all"
                  title="Remove 5% tax from total"
                >
                  -5% GST
                </button>
                <button
                  onClick={() => removeGst(12)}
                  className="py-1.5 px-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 rounded-xl text-xs font-bold transition-all"
                  title="Remove 12% tax from total"
                >
                  -12% GST
                </button>
                <button
                  onClick={() => removeGst(18)}
                  className="py-1.5 px-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 rounded-xl text-xs font-bold transition-all"
                  title="Remove 18% tax from total"
                >
                  -18% GST
                </button>
              </div>

              {/* Quick Split & Discounts */}
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 pt-1">
                <button
                  onClick={() => applyQuickDivide(2)}
                  className="py-1.5 px-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 rounded-xl text-xs font-bold transition-all border border-indigo-200 dark:border-indigo-800"
                >
                  ÷ 2 (Half)
                </button>
                <button
                  onClick={() => applyQuickDivide(3)}
                  className="py-1.5 px-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 rounded-xl text-xs font-bold transition-all border border-indigo-200 dark:border-indigo-800"
                >
                  ÷ 3 People
                </button>
                <button
                  onClick={() => applyQuickDivide(4)}
                  className="py-1.5 px-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 rounded-xl text-xs font-bold transition-all border border-indigo-200 dark:border-indigo-800"
                >
                  ÷ 4 People
                </button>
                <button
                  onClick={() => applyQuickDivide(5)}
                  className="py-1.5 px-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 rounded-xl text-xs font-bold transition-all border border-indigo-200 dark:border-indigo-800"
                >
                  ÷ 5 People
                </button>
                <button
                  onClick={() => applyDiscount(10)}
                  className="py-1.5 px-2 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 rounded-xl text-xs font-bold transition-all"
                >
                  -10% Off
                </button>
                <button
                  onClick={() => applyDiscount(20)}
                  className="py-1.5 px-2 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 rounded-xl text-xs font-bold transition-all"
                >
                  -20% Off
                </button>
                <button
                  onClick={() => applyDiscount(50)}
                  className="py-1.5 px-2 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 rounded-xl text-xs font-bold transition-all"
                >
                  -50% Off
                </button>
              </div>
            </div>

            {/* Modern Numeric Keypad */}
            <div className="grid grid-cols-4 gap-2.5 sm:gap-3 text-base sm:text-lg font-bold select-none pt-2">
              {/* Row 1 */}
              <button
                onClick={handleClear}
                className="py-3.5 rounded-2xl bg-rose-100 hover:bg-rose-200 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 active:scale-95 transition-all cursor-pointer"
              >
                AC
              </button>
              <button
                onClick={handleDelete}
                className="py-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 active:scale-95 transition-all cursor-pointer"
              >
                DEL
              </button>
              <button
                onClick={handlePercentage}
                className="py-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 active:scale-95 transition-all cursor-pointer"
              >
                %
              </button>
              <button
                onClick={() => handleOperator('÷')}
                className="py-3.5 rounded-2xl bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-950/80 dark:hover:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 active:scale-95 transition-all cursor-pointer"
              >
                ÷
              </button>

              {/* Row 2 */}
              <button
                onClick={() => handleDigit('7')}
                className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                7
              </button>
              <button
                onClick={() => handleDigit('8')}
                className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                8
              </button>
              <button
                onClick={() => handleDigit('9')}
                className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                9
              </button>
              <button
                onClick={() => handleOperator('×')}
                className="py-3.5 rounded-2xl bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-950/80 dark:hover:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 active:scale-95 transition-all cursor-pointer"
              >
                ×
              </button>

              {/* Row 3 */}
              <button
                onClick={() => handleDigit('4')}
                className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                4
              </button>
              <button
                onClick={() => handleDigit('5')}
                className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                5
              </button>
              <button
                onClick={() => handleDigit('6')}
                className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                6
              </button>
              <button
                onClick={() => handleOperator('-')}
                className="py-3.5 rounded-2xl bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-950/80 dark:hover:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 active:scale-95 transition-all cursor-pointer"
              >
                -
              </button>

              {/* Row 4 */}
              <button
                onClick={() => handleDigit('1')}
                className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                1
              </button>
              <button
                onClick={() => handleDigit('2')}
                className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                2
              </button>
              <button
                onClick={() => handleDigit('3')}
                className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                3
              </button>
              <button
                onClick={() => handleOperator('+')}
                className="py-3.5 rounded-2xl bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-950/80 dark:hover:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 active:scale-95 transition-all cursor-pointer"
              >
                +
              </button>

              {/* Row 5 */}
              <button
                onClick={handleToggleSign}
                className="py-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 active:scale-95 transition-all cursor-pointer"
              >
                +/-
              </button>
              <button
                onClick={() => handleDigit('0')}
                className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                0
              </button>
              <button
                onClick={handleDecimal}
                className="py-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                .
              </button>
              <button
                onClick={handleEquals}
                className="py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black shadow-lg shadow-emerald-600/30 active:scale-95 transition-all cursor-pointer"
              >
                =
              </button>
            </div>

            {/* Quick Hand-off Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={sendToSplitwise}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-bold text-xs transition-all cursor-pointer border border-indigo-200 dark:border-indigo-900 active:scale-95"
              >
                <Users className="w-4 h-4 text-indigo-600" />
                <span>Send ₹{displayValue} to Splitwise</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  const val = parseFloat(displayValue);
                  if (onOpenAddModal) {
                    onOpenAddModal('food', undefined, undefined, !isNaN(val) && val > 0 ? val : undefined, 'Calculated Expense');
                  }
                }}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Add ₹{displayValue} as Transaction</span>
              </button>
            </div>
          </div>

          {/* Right Column: Calculation Tape & History */}
          <div className="lg:col-span-5 xl:col-span-4 bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-full space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Calculation Tape & History
                </h3>
              </div>
              {historyTape.length > 0 && (
                <button
                  onClick={() => {
                    setHistoryTape([]);
                    localStorage.removeItem('mm_calc_history');
                    toast.info('Cleared', 'History tape emptied.');
                  }}
                  className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                  title="Clear calculation history"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto max-h-[460px] pr-1">
              {historyTape.length === 0 ? (
                <div className="py-12 text-center text-slate-400 space-y-2">
                  <CalcIcon className="w-8 h-8 mx-auto opacity-30" />
                  <p className="text-xs">No calculations yet.</p>
                  <p className="text-[11px] text-slate-500">
                    Calculations you perform will be saved here automatically.
                  </p>
                </div>
              ) : (
                historyTape.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      setDisplayValue(String(item.result));
                      setWaitingForOperand(true);
                      toast.info('Restored', `Value ${item.result} loaded.`);
                    }}
                    className="p-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 rounded-2xl border border-slate-200/70 dark:border-slate-800 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-mono truncate pr-2">{item.expression}</span>
                      <span className="shrink-0">{item.timestamp}</span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100 font-mono">
                        = {item.result.toLocaleString('en-IN')}
                      </span>
                      <span className="text-[10px] text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity font-bold">
                        Tap to use
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODE 2: SPLITWISE (GROUP BILL SPLITTER)
          ========================================================================= */}
      {activeMode === 'splitwise' && (
        <div className="space-y-6">
          {/* Top Form: Bill Metadata */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/30">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                    Group Bill Details
                  </h3>
                  <p className="text-xs text-slate-500">
                    Enter bill amount, select participants, and calculate who owes whom
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetSplitwise}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 text-xs font-semibold transition-all cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Form</span>
                </button>
              </div>
            </div>

            {/* Inputs: Bill Name, Amount, Date, Category */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Bill Title / Purpose *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Cafe Dinner, Room Grocery"
                  value={billTitle}
                  onChange={(e) => setBillTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Total Bill Amount (₹) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={billTotal}
                    onChange={(e) => setBillTotal(e.target.value)}
                    className="w-full pl-8 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-bold font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Expense Category
                </label>
                <select
                  value={billCategory}
                  onChange={(e) => setBillCategory(e.target.value as TransactionCategory)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="food">Food & Dining</option>
                  <option value="room">Room Expenses</option>
                  <option value="other">Other / Shopping / Travel</option>
                  <option value="home">Home</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            {/* Quick Add Saved People Chips */}
            {savedPeopleNames.length > 0 && (
              <div className="pt-2">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2 font-medium">
                  <UserPlus className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Quick Add from your saved friends (People Udhar list):</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {savedPeopleNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => handleAddMember(name)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-indigo-950/60 text-slate-700 dark:text-slate-300 hover:text-indigo-600 rounded-full text-xs font-bold transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Middle Layout: Participants & Who Paid & Split Modes */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Participants & Split Config (Left 7 Cols) */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
              {/* Header: Add Custom Member */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-600" />
                    <span>Group Members ({members.length})</span>
                  </h4>
                  <span className="text-xs text-slate-400">At least 2 required</span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Enter friend's name (e.g. Rahul, Priya)..."
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
                    className="flex-1 px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddMember()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm shadow-indigo-600/20 flex items-center gap-1.5 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              </div>

              {/* Who Paid Section */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Who Paid the Bill? (बिल किसने भरा?)
                  </label>

                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setPayerMode('single')}
                      className={`px-2.5 py-1 rounded-md transition-all ${
                        payerMode === 'single'
                          ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      Single Payer
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayerMode('multiple')}
                      className={`px-2.5 py-1 rounded-md transition-all ${
                        payerMode === 'multiple'
                          ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      Multiple People
                    </button>
                  </div>
                </div>

                {payerMode === 'single' ? (
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSinglePayerId(m.id)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                          singlePayerId === m.id
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {m.name} {singlePayerId === m.id && '✓ (Paid 100%)'}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Enter how much each person paid out of pocket:
                    </p>
                    <div className="space-y-2">
                      {members.map((m) => (
                        <div key={m.id} className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {m.name}
                          </span>
                          <div className="relative w-32 shrink-0">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">
                              ₹
                            </span>
                            <input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={m.paidAmount || ''}
                              onChange={(e) =>
                                handleUpdateMember(m.id, 'paidAmount', parseFloat(e.target.value) || 0)
                              }
                              className="w-full pl-6 pr-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-right font-mono font-bold"
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    {paidDifference !== 0 && (
                      <div className="pt-2 text-[11px] font-bold text-amber-600 flex items-center justify-between">
                        <span>Total Paid: ₹{totalPaidAllocated.toLocaleString('en-IN')}</span>
                        <span>
                          {paidDifference > 0
                            ? `Remaining to allocate: ₹${paidDifference}`
                            : `Overpaid by: ₹${Math.abs(paidDifference)}`}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Split Strategy Section */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    How to Split? (विभाजन का तरीका)
                  </label>
                </div>

                {/* Strategy Tabs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'equal', label: 'Equally', sub: 'बराबर हिस्सा' },
                    { id: 'exact', label: 'Exact ₹', sub: 'अलग-अलग राशि' },
                    { id: 'percent', label: 'Percentage %', sub: 'प्रतिशत के आधार पर' },
                    { id: 'shares', label: 'By Shares', sub: 'अनुपात / हिस्सा' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSplitStrategy(s.id as any)}
                      className={`p-2.5 rounded-2xl text-left transition-all border cursor-pointer ${
                        splitStrategy === s.id
                          ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-500 text-indigo-900 dark:text-indigo-200 shadow-sm'
                          : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-400 hover:bg-slate-100'
                      }`}
                    >
                      <div className="font-bold text-xs">{s.label}</div>
                      <div className="text-[10px] opacity-70 mt-0.5">{s.sub}</div>
                    </button>
                  ))}
                </div>

                {/* Strategy Inputs List */}
                <div className="space-y-2 pt-2">
                  {computedMembers.map((m) => (
                    <div
                      key={m.id}
                      className={`flex items-center justify-between gap-3 p-3 rounded-2xl border transition-all ${
                        m.included || splitStrategy !== 'equal'
                          ? 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-800 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {splitStrategy === 'equal' && (
                          <input
                            type="checkbox"
                            checked={m.included}
                            onChange={() => handleToggleInclude(m.id)}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        )}
                        <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-black text-xs flex items-center justify-center shrink-0">
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            {m.name}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            Paid: ₹{m.paidAmount.toLocaleString('en-IN')}
                          </p>
                        </div>
                      </div>

                      {/* Right Control based on strategy */}
                      <div className="flex items-center gap-2 shrink-0">
                        {splitStrategy === 'equal' && (
                          <div className="text-right">
                            <span className="text-xs font-bold font-mono text-indigo-600 dark:text-indigo-400">
                              ₹{m.share.toLocaleString('en-IN')}
                            </span>
                            <span className="block text-[9px] text-slate-400">
                              {m.included ? 'Included' : 'Excluded'}
                            </span>
                          </div>
                        )}

                        {splitStrategy === 'exact' && (
                          <div className="relative w-28">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">
                              ₹
                            </span>
                            <input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={m.customAmount || ''}
                              onChange={(e) =>
                                handleUpdateMember(m.id, 'customAmount', parseFloat(e.target.value) || 0)
                              }
                              className="w-full pl-6 pr-2 py-1 text-xs rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-right font-mono font-bold"
                            />
                          </div>
                        )}

                        {splitStrategy === 'percent' && (
                          <div className="relative w-24">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              placeholder="0"
                              value={m.customPercent || ''}
                              onChange={(e) =>
                                handleUpdateMember(m.id, 'customPercent', parseFloat(e.target.value) || 0)
                              }
                              className="w-full pl-2 pr-6 py-1 text-xs rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-right font-mono font-bold"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">
                              %
                            </span>
                          </div>
                        )}

                        {splitStrategy === 'shares' && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateMember(m.id, 'customShares', Math.max(1, (m.customShares || 1) - 1))
                              }
                              className="w-6 h-6 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center text-xs font-bold"
                            >
                              -
                            </button>
                            <span className="w-6 text-center text-xs font-bold font-mono">
                              {m.customShares || 1}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateMember(m.id, 'customShares', (m.customShares || 1) + 1)
                              }
                              className="w-6 h-6 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center text-xs font-bold"
                            >
                              +
                            </button>
                          </div>
                        )}

                        {!m.isYou && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.id)}
                            className="p-1 text-slate-300 hover:text-rose-500 transition-colors ml-1"
                            title="Remove member"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Validation Warnings for Exact or Percent */}
                {splitStrategy === 'exact' && exactDifference !== 0 && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl text-xs text-amber-800 dark:text-amber-200 font-semibold flex items-center justify-between">
                    <span>Allocated: ₹{totalSharesAllocated} of ₹{numericTotal}</span>
                    <span>
                      {exactDifference > 0
                        ? `Remaining to allocate: ₹${exactDifference}`
                        : `Over-allocated by: ₹${Math.abs(exactDifference)}`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Settlement & Results Column (Right 5 Cols) */}
            <div className="lg:col-span-5 space-y-5">
              {/* Summary Card */}
              <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-emerald-600" />
                    <span>Split Summary</span>
                  </h4>
                  <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 font-mono">
                    ₹{numericTotal.toLocaleString('en-IN')}
                  </span>
                </div>

                {/* Breakdown per member */}
                <div className="space-y-2">
                  {computedMembers.map((m) => {
                    const isCreditor = m.net > 0.05;
                    const isDebtor = m.net < -0.05;

                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40"
                      >
                        <div>
                          <span className="font-bold text-slate-800 dark:text-slate-200">{m.name}</span>
                          <span className="block text-[10px] text-slate-400">
                            Share: ₹{m.share.toLocaleString('en-IN')}
                          </span>
                        </div>
                        <div className="text-right">
                          {isCreditor ? (
                            <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">
                              +₹{m.net.toLocaleString('en-IN')} (Gets back)
                            </span>
                          ) : isDebtor ? (
                            <span className="font-bold font-mono text-rose-500">
                              -₹{Math.abs(m.net).toLocaleString('en-IN')} (Owes)
                            </span>
                          ) : (
                            <span className="font-medium text-slate-400">Settled (₹0)</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Settlement Instructions: Who Pays Whom */}
              <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-600" />
                      <span>Smart Settlements</span>
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Minimum transactions to settle all debts
                    </p>
                  </div>
                </div>

                {numericTotal <= 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">
                    Enter bill amount above to view settlements.
                  </p>
                ) : settlements.length === 0 ? (
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl text-center text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    🎉 Everyone is already settled up! No money owes.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {settlements.map((s, idx) => {
                      const isRecorded = recordedDebts[`debt-${idx}`];
                      return (
                        <div
                          key={idx}
                          className="p-3 bg-indigo-50/70 dark:bg-indigo-950/40 rounded-2xl border border-indigo-100 dark:border-indigo-900/60 flex flex-col gap-2"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100">
                              <span className="text-rose-600 dark:text-rose-400">{s.from}</span>
                              <span className="text-slate-400">pays</span>
                              <span className="text-emerald-600 dark:text-emerald-400">{s.to}</span>
                            </div>
                            <span className="text-sm font-black font-mono text-indigo-600 dark:text-indigo-400">
                              ₹{s.amount.toLocaleString('en-IN')}
                            </span>
                          </div>

                          {/* Quick button to record into People Udhar */}
                          <div className="flex items-center justify-end pt-1">
                            {isRecorded ? (
                              <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Recorded in Udhar</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleRecordDebtInPeople(s, idx)}
                                className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Record in People Ledger</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Hand-off / Share Buttons */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={handleShareWhatsApp}
                    disabled={numericTotal <= 0}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs transition-all shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>Share Split Breakdown on WhatsApp</span>
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleCopySplit}
                      disabled={numericTotal <= 0}
                      className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isCopiedSplit ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{isCopiedSplit ? 'Copied!' : 'Copy Summary'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveMyShareAsExpense}
                      disabled={numericTotal <= 0}
                      className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-xs transition-all cursor-pointer disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Save My Share</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
