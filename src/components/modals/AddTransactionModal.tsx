import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  PlusCircle,
  Home,
  DoorOpen,
  ShoppingBag,
  Users,
  Flame,
  Apple,
  Building,
  Zap,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRightLeft,
  Calendar,
  Clock,
  Sparkles,
  Utensils,
  Coffee,
  CreditCard,
  Camera,
  Upload,
  Trash2,
  Image as ImageIcon,
  Mic,
  MicOff,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { useVoiceInput } from '../../lib/useVoiceInput';
import { parseVoiceTransaction, ParsedVoiceDraft } from '../../lib/voiceTransactionParser';
import {
  TransactionCategory,
  TransactionSubcategory,
  TransactionType,
  NewTransactionPayload,
} from '../../types';
import {
  getCurrentISTDate,
  getCurrentISTTime,
  getCurrentMonthName,
} from '../../lib/dateUtils';
import { UnsavedChangesModal } from '../common/states';
import {
  RECEIVED_CATEGORIES,
  PAYMENT_METHODS,
  getReceivedCategoryConfig,
  classifyFinancialTransaction,
} from '../../lib/receivedMoneyCategories';
import {
  categorizeTransactionDeterministic,
  CategorizationSuggestion,
  UserCategorizationRule,
} from '../../lib/financialIntelligenceEngine';
import { aiFinanceApi } from '../../lib/aiFinanceApi';

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: TransactionCategory;
  initialSubcategory?: TransactionSubcategory;
  initialPersonName?: string;
  initialAmount?: number | string;
  initialTitle?: string;
  initialDate?: string;
  onOpenReceiptScanner?: () => void;
}

export const AddTransactionModal: React.FC<AddTransactionModalProps> = ({
  isOpen,
  onClose,
  initialCategory = 'home',
  initialSubcategory,
  initialPersonName,
  initialAmount,
  initialTitle,
  initialDate,
  onOpenReceiptScanner,
}) => {
  const { addTransaction, transactions } = useExpense();
  const toast = useToast();

  const [category, setCategory] = useState<TransactionCategory>(initialCategory);
  const [subcategory, setSubcategory] = useState<TransactionSubcategory>(
    initialSubcategory || 'received_home'
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Core fields
  const [amount, setAmount] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [date, setDate] = useState<string>(getCurrentISTDate());
  const [time, setTime] = useState<string>(getCurrentISTTime());
  const [notes, setNotes] = useState<string>('');

  // Subcategory specific fields
  // Received Money
  const [receivedSource, setReceivedSource] = useState<string>('');
  const [receivedPurpose, setReceivedPurpose] = useState<string>('');
  const [receivedPaymentMethod, setReceivedPaymentMethod] = useState<string>('upi');
  const [receivedUtr, setReceivedUtr] = useState<string>('');
  // Legacy Home fields
  const [homePurpose, setHomePurpose] = useState<string>('');
  const [homeExpenseReason, setHomeExpenseReason] = useState<string>('');

  // Room - Grocery
  const [groceryItem, setGroceryItem] = useState<string>('');
  const [groceryQuantity, setGroceryQuantity] = useState<string>('');

  // Room - Gas
  const [gasPaidBy, setGasPaidBy] = useState<string>('Self');

  // Room - Rent
  const [rentMonth, setRentMonth] = useState<string>(getCurrentMonthName());
  const [rentPaidTo, setRentPaidTo] = useState<string>('');

  // Room - Electricity
  const [elecMonth, setElecMonth] = useState<string>(getCurrentMonthName());

  // Food & Dining
  const [foodItem, setFoodItem] = useState<string>('');
  const [foodPlace, setFoodPlace] = useState<string>('');

  // Other Expense
  const [spentAt, setSpentAt] = useState<string>('');
  const [spentFor, setSpentFor] = useState<string>('');

  // People
  const [personName, setPersonName] = useState<string>(initialPersonName || '');
  const [peopleReason, setPeopleReason] = useState<string>('');

  // Screen 2 New Fields: Transaction Type, Payment Method, Receipt Attachment
  const [transactionType, setTransactionType] = useState<TransactionType | 'transfer'>('expense');
  const [paymentMethod, setPaymentMethod] = useState<string>('UPI');
  const [receiptImage, setReceiptImage] = useState<string | null>(null);
  const [isCompressingReceipt, setIsCompressingReceipt] = useState(false);

  // Feature 2: Smart Transaction Categorization State (Non-blocking)
  const [userCatRules, setUserCatRules] = useState<UserCategorizationRule[]>([]);
  const [smartSuggestion, setSmartSuggestion] = useState<CategorizationSuggestion | null>(null);
  const [isSuggestingAi, setIsSuggestingAi] = useState(false);
  const [showLearnedRules, setShowLearnedRules] = useState(false);
  const [userAppliedSuggestion, setUserAppliedSuggestion] = useState(false);

  // Feature: Voice Transaction Entry & Dictation
  const [voiceDraft, setVoiceDraft] = useState<ParsedVoiceDraft | null>(null);
  const [activeDictationField, setActiveDictationField] = useState<'transaction' | 'title' | 'notes' | null>(null);

  const {
    isListening,
    transcript: voiceTranscript,
    startListening,
    stopListening,
    language: voiceLang,
    setLanguage: setVoiceLang,
  } = useVoiceInput({
    onResult: (text) => {
      if (activeDictationField === 'title') {
        setTitle(text);
      } else if (activeDictationField === 'notes') {
        setNotes(text);
      } else if (activeDictationField === 'transaction') {
        const parsed = parseVoiceTransaction(text);
        setVoiceDraft(parsed);
        if (parsed.amount) setAmount(parsed.amount);
        if (parsed.category) setCategory(parsed.category);
        if (parsed.subcategory) setSubcategory(parsed.subcategory as any);
        if (parsed.title) setTitle(parsed.title);
        if (parsed.notes) setNotes(parsed.notes);
        if (parsed.personName) setPersonName(parsed.personName);
      }
    },
    onError: (err) => {
      toast.error('Voice Error', err);
    },
  });

  // Compress & handle receipt attachment
  const handleReceiptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Invalid File', 'Please select an image file (PNG, JPG, JPEG, WEBP).');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File Too Large', 'Please select an image smaller than 10MB.');
      return;
    }

    setIsCompressingReceipt(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_DIM = 960;
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
          const compressed = canvas.toDataURL('image/jpeg', 0.8);
          setReceiptImage(compressed);
        }
        setIsCompressingReceipt(false);
      };
      img.onerror = () => {
        setIsCompressingReceipt(false);
        toast.error('Image Error', 'Failed to load receipt image.');
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Reset or initialize state when opening
  useEffect(() => {
    if (isOpen) {
      setShowUnsavedConfirm(false);
      setDate(initialDate || getCurrentISTDate());
      setTime(getCurrentISTTime());
      setSmartSuggestion(null);
      setUserAppliedSuggestion(false);
      if (initialCategory) setCategory(initialCategory);
      if (initialSubcategory) {
        setSubcategory(initialSubcategory);
      } else {
        if (initialCategory === 'home' || initialCategory === 'received') setSubcategory('salary');
        else if (initialCategory === 'room') setSubcategory('grocery');
        else if (initialCategory === 'food') setSubcategory('snacks');
        else if (initialCategory === 'other') setSubcategory('shopping');
        else if (initialCategory === 'people') setSubcategory('money_given');
      }
      if (initialPersonName) setPersonName(initialPersonName);
      if (initialAmount !== undefined && initialAmount !== '') setAmount(String(initialAmount));
      if (initialTitle) setTitle(initialTitle);
      setRentMonth(getCurrentMonthName());
      setElecMonth(getCurrentMonthName());
      aiFinanceApi.getCategorizationRules().then(setUserCatRules).catch(() => {});
    }
  }, [isOpen, initialCategory, initialSubcategory, initialPersonName, initialAmount, initialTitle, initialDate]);

  // Debounced live Smart Categorization as user types merchant/description
  const liveMerchantText = [
    title,
    foodPlace,
    foodItem,
    spentAt,
    spentFor,
    groceryItem,
    receivedSource,
    receivedPurpose,
    notes,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  useEffect(() => {
    if (!isOpen || category === 'people' || transactionType === 'transfer') {
      setSmartSuggestion(null);
      return;
    }
    if (liveMerchantText.length < 3) {
      setSmartSuggestion(null);
      return;
    }

    const det = categorizeTransactionDeterministic(
      {
        title: title || foodItem || spentFor || groceryItem,
        merchant: spentAt || foodPlace || receivedSource,
        description: liveMerchantText,
        amount: parseFloat(amount) || undefined,
      },
      userCatRules,
      transactions
    );

    if (det && !det.needsAiFallback) {
      setSmartSuggestion(det);
      return;
    }

    const timer = setTimeout(() => {
      setIsSuggestingAi(true);
      aiFinanceApi
        .predictCategory({
          title: title || foodItem || spentFor || groceryItem,
          merchant: spentAt || foodPlace || receivedSource,
          description: liveMerchantText,
          amount: parseFloat(amount) || undefined,
        })
        .then((res) => {
          if (res.suggestion && res.suggestion.confidence >= 0.55) {
            setSmartSuggestion(res.suggestion);
          } else {
            setSmartSuggestion(null);
          }
        })
        .catch(() => {
          setSmartSuggestion(null);
        })
        .finally(() => setIsSuggestingAi(false));
    }, 550);

    return () => clearTimeout(timer);
  }, [isOpen, liveMerchantText, category, transactionType, amount, userCatRules, transactions, title, foodItem, spentFor, groceryItem, spentAt, foodPlace, receivedSource]);

  const handleApplySmartSuggestion = () => {
    if (!smartSuggestion) return;
    setCategory(smartSuggestion.category);
    setSubcategory(smartSuggestion.subcategory);
    setTransactionType(smartSuggestion.transaction_type);
    if (smartSuggestion.category === 'food' && !foodItem) {
      setFoodItem(smartSuggestion.merchant || title || spentFor || groceryItem || 'Meal');
      if (!foodPlace && spentAt) setFoodPlace(spentAt);
    } else if (smartSuggestion.category === 'room' && smartSuggestion.subcategory === 'grocery' && !groceryItem) {
      setGroceryItem(smartSuggestion.merchant || title || spentFor || foodItem || 'Grocery');
    } else if (smartSuggestion.category === 'other' && !spentAt && !spentFor) {
      setSpentAt(smartSuggestion.merchant || title || foodPlace || '');
      setSpentFor(smartSuggestion.suggestedDescription || title || foodItem || '');
    }
    setUserAppliedSuggestion(true);
    toast.success('Category applied', `Set to ${smartSuggestion.displayCategory}.`);
  };

  const handleDeleteLearnedRule = async (ruleId: string) => {
    try {
      const updated = await aiFinanceApi.deleteCategorizationRule(ruleId);
      setUserCatRules(updated);
    } catch {
      // ignore
    }
  };

  // Adjust subcategory when category changes
  const handleCategoryChange = (cat: TransactionCategory) => {
    setCategory(cat);
    if (cat === 'home' || cat === 'received') setSubcategory('salary');
    else if (cat === 'room') setSubcategory('grocery');
    else if (cat === 'food') setSubcategory('snacks');
    else if (cat === 'other') setSubcategory('shopping');
    else if (cat === 'people') setSubcategory('money_given');
  };

  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

  const isDirty = Boolean(
    amount ||
    title ||
    notes ||
    receiptImage ||
    homePurpose ||
    homeExpenseReason ||
    groceryItem ||
    rentPaidTo ||
    foodItem ||
    foodPlace ||
    spentAt ||
    spentFor ||
    (initialPersonName ? personName !== initialPersonName : personName) ||
    peopleReason
  );

  const handleAttemptClose = () => {
    if (isDirty) {
      setShowUnsavedConfirm(true);
    } else {
      resetForm();
      onClose();
    }
  };

  const handleDiscardChanges = () => {
    setShowUnsavedConfirm(false);
    resetForm();
    onClose();
  };

  const resetForm = () => {
    setAmount('');
    setTitle('');
    setNotes('');
    setReceivedSource('');
    setReceivedPurpose('');
    setReceivedUtr('');
    setHomePurpose('');
    setHomeExpenseReason('');
    setGroceryItem('');
    setGroceryQuantity('');
    setGasPaidBy('Self');
    setRentPaidTo('');
    setFoodItem('');
    setFoodPlace('');
    setSpentAt('');
    setSpentFor('');
    setPersonName('');
    setPeopleReason('');
    setReceiptImage(null);
    setPaymentMethod('UPI');
    setTransactionType('expense');
  };

  // Nielsen Heuristic: Error Prevention — Duplicate Transaction Warning
  const duplicateCandidate = useMemo(() => {
    const parsedAmt = parseFloat(amount);
    if (!parsedAmt || isNaN(parsedAmt) || parsedAmt <= 0) return null;
    return transactions.find((t) => {
      if (t.is_deleted) return false;
      const amtMatch = Math.abs(Number(t.amount) - parsedAmt) < 0.01;
      const catMatch = t.category === category;
      const dateMatch = t.transaction_date === date;
      return amtMatch && catMatch && dateMatch;
    });
  }, [amount, category, date, transactions]);

  // Nielsen Heuristic: User Control & Freedom — Escape key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !showUnsavedConfirm) {
        handleAttemptClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDirty, showUnsavedConfirm]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error('Invalid Amount', 'Please enter a valid amount greater than 0');
      return;
    }

    let finalTitle = title.trim();
    let finalDescription = '';
    let finalType: TransactionType = 'expense';
    let metadata: Record<string, any> = {};

    // Build payload according to category & subcategory requirements
    if (category === 'home' || category === 'received') {
      if (subcategory === 'home_expense') {
        finalType = 'expense';
        finalTitle = finalTitle || `Home Expense: ${homeExpenseReason.trim() || 'Expense'}`;
        finalDescription = homeExpenseReason.trim();
      } else {
        finalType = 'income';
        const catConfig = getReceivedCategoryConfig(subcategory);
        const classification = classifyFinancialTransaction(subcategory);
        finalTitle = finalTitle || receivedPurpose.trim() || homePurpose.trim() || `${catConfig.label} Received`;
        finalDescription = receivedSource.trim()
          ? `From: ${receivedSource.trim()}`
          : (homePurpose.trim() ? `From Home — ${homePurpose.trim()}` : catConfig.label);
        metadata.received_from = receivedSource.trim() || undefined;
        metadata.payment_method = receivedPaymentMethod;
        metadata.utr = receivedUtr.trim() || undefined;
        metadata.financial_classification = classification;
      }
    } else if (category === 'room') {
      finalType = 'expense';
      if (subcategory === 'gas') {
        finalTitle = finalTitle || 'Gas Expense (LPG Cylinder)';
        finalDescription = gasPaidBy ? `Paid by: ${gasPaidBy}` : 'Gas cylinder refilled';
        metadata.paid_by = gasPaidBy;
      } else if (subcategory === 'grocery') {
        if (!groceryItem.trim()) {
          toast.error('Item Name Required', 'Please enter the grocery item name');
          return;
        }
        finalTitle = groceryItem.trim();
        finalDescription = groceryQuantity ? `Qty: ${groceryQuantity.trim()}` : 'Room Grocery item';
        metadata.grocery_item = groceryItem.trim();
        metadata.quantity = groceryQuantity.trim();
      } else if (subcategory === 'rent') {
        if (!rentMonth.trim()) {
          toast.error('Month Required', 'Please specify the rent month');
          return;
        }
        finalTitle = finalTitle || `Room Rent (${rentMonth.trim()})`;
        finalDescription = rentPaidTo ? `Paid to: ${rentPaidTo.trim()}` : `Room Rent for ${rentMonth.trim()}`;
        metadata.month = rentMonth.trim();
        metadata.paid_to = rentPaidTo.trim();
      } else if (subcategory === 'electricity') {
        if (!elecMonth.trim()) {
          toast.error('Month Required', 'Please specify the billing month');
          return;
        }
        finalTitle = finalTitle || `Electricity Bill (${elecMonth.trim()})`;
        finalDescription = `Power bill for ${elecMonth.trim()}`;
        metadata.billing_month = elecMonth.trim();
      }
    } else if (category === 'food') {
      finalType = 'expense';
      if (!foodItem.trim()) {
        toast.error('Food Item Required', 'Please enter what food was ordered or consumed');
        return;
      }
      finalTitle = finalTitle || foodItem.trim();
      finalDescription = foodPlace.trim() ? `${foodItem.trim()} at ${foodPlace.trim()}` : foodItem.trim();
      metadata.food_item = foodItem.trim();
      metadata.restaurant_name = foodPlace.trim();
      metadata.platform = foodPlace.trim();
    } else if (category === 'other') {
      finalType = 'expense';
      if (!spentFor.trim() && !spentAt.trim()) {
        toast.error('Details Required', 'Please enter why or where the money was spent');
        return;
      }
      finalTitle = finalTitle || spentFor.trim() || spentAt.trim();
      finalDescription = spentAt.trim() && spentFor.trim()
        ? `Spent at ${spentAt.trim()} for ${spentFor.trim()}`
        : (spentAt.trim() || spentFor.trim());
      metadata.spent_at = spentAt.trim();
      metadata.spent_for = spentFor.trim();
      metadata.category_tag = subcategory;
    } else if (category === 'people') {
      if (!personName.trim()) {
        toast.error("Person's Name Required", 'Please enter the person name');
        return;
      }
      if (!peopleReason.trim()) {
        toast.error('Reason Required', 'Please enter the purpose / reason');
        return;
      }

      if (subcategory === 'money_given') {
        finalType = 'expense';
        finalTitle = `Udhar Given to ${personName.trim()}`;
        finalDescription = peopleReason.trim();
      } else {
        finalType = 'income';
        finalTitle = `Money Received from ${personName.trim()}`;
        finalDescription = peopleReason.trim();
      }
    }

    // Apply explicit Transaction Type overrides
    if (transactionType === 'transfer') {
      finalType = 'expense';
      finalTitle = finalTitle || `Transfer: ${category}`;
      finalDescription = finalDescription || `Transfer via ${paymentMethod}`;
      metadata.is_transfer = true;
      metadata.transfer_type = 'account_transfer';
    } else if (transactionType === 'income' && category !== 'people' && category !== 'home') {
      finalType = 'income';
    }

    // Attach payment method & receipt
    if (paymentMethod) {
      metadata.payment_method = paymentMethod;
    }
    if (receiptImage) {
      metadata.receipt_url = receiptImage;
      metadata.receipt_data = receiptImage;
    }
    if (personName.trim() && category !== 'people') {
      metadata.associated_person = personName.trim();
    }

    const payload: NewTransactionPayload = {
      category,
      subcategory,
      transaction_type: finalType,
      amount: parsedAmount,
      title: finalTitle,
      description: finalDescription,
      person_name: category === 'people' ? personName.trim() : undefined,
      transaction_date: date,
      transaction_time: time,
      notes: notes.trim() || undefined,
      metadata,
    };

    try {
      setIsSubmitting(true);
      await addTransaction(payload);

      // Learn merchant rule asynchronously (never mutates historical records)
      const merchantCandidate = (
        spentAt ||
        foodPlace ||
        receivedSource ||
        groceryItem ||
        payload.title ||
        ''
      ).trim();
      if (
        merchantCandidate.length >= 3 &&
        category !== 'people' &&
        transactionType !== 'transfer' &&
        (!smartSuggestion ||
          !userAppliedSuggestion ||
          smartSuggestion.category !== category ||
          smartSuggestion.subcategory !== subcategory)
      ) {
        aiFinanceApi
          .saveCategorizationRule({
            merchant_pattern: merchantCandidate,
            category,
            subcategory,
            transaction_type: finalType,
          })
          .then(setUserCatRules)
          .catch(() => {});
      }

      toast.success(
        'Transaction Added!',
        `${payload.title} (₹${parsedAmount.toLocaleString('en-IN')}) recorded successfully.`
      );
      resetForm();
      onClose();
    } catch (err: any) {
      toast.error('Failed to add transaction', err.message || 'Please try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-xl my-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-950/80 rounded-xl text-emerald-600 dark:text-emerald-400">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                Add New Transaction
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Automatic IST date & time captured
              </p>
            </div>
          </div>
          <button
            onClick={handleAttemptClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* Quick Smart Actions: Scan Receipt OCR + Learned Rules */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {onOpenReceiptScanner && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenReceiptScanner();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 text-xs font-semibold cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Scan Receipt (OCR)</span>
              </button>
            )}
            {userCatRules.length > 0 && (
              <button
                type="button"
                onClick={() => setShowLearnedRules((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer ml-auto"
              >
                <Sparkles className="w-3 h-3 text-emerald-500" />
                <span>{showLearnedRules ? 'Hide' : 'Manage'} Learned Rules ({userCatRules.length})</span>
              </button>
            )}
          </div>

          {showLearnedRules && userCatRules.length > 0 && (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5 max-h-32 overflow-y-auto">
              <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Learned Merchant Rules (applied automatically on future entries)
              </p>
              {userCatRules.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between text-xs py-1">
                  <span className="truncate text-slate-700 dark:text-slate-300">
                    <strong>{rule.merchant_pattern}</strong> &rarr; {rule.category}/{rule.subcategory}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteLearnedRule(rule.id)}
                    className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                    title="Delete rule"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Voice Input Assistant Bar */}
          <div className="p-3.5 bg-gradient-to-r from-emerald-50 via-teal-50/50 to-blue-50/40 dark:from-emerald-950/40 dark:via-slate-800 dark:to-slate-900 border border-emerald-200/80 dark:border-emerald-800/60 rounded-2xl space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (isListening && activeDictationField === 'transaction') {
                      stopListening();
                      setActiveDictationField(null);
                    } else {
                      setActiveDictationField('transaction');
                      void startListening();
                    }
                  }}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    isListening && activeDictationField === 'transaction'
                      ? 'bg-rose-500 text-white animate-pulse shadow-md shadow-rose-500/30 ring-2 ring-rose-400'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                  }`}
                >
                  {isListening && activeDictationField === 'transaction' ? (
                    <>
                      <MicOff className="w-3.5 h-3.5" />
                      <span>Listening... (Tap to stop)</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5" />
                      <span>Speak Transaction (बोलकर जोड़ें)</span>
                    </>
                  )}
                </button>

                {/* Language Toggle Pill */}
                <button
                  type="button"
                  onClick={() => setVoiceLang(voiceLang === 'hi-IN' ? 'en-IN' : 'hi-IN')}
                  className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 transition-colors cursor-pointer"
                  title="Switch speech language between Hindi and English"
                >
                  {voiceLang === 'hi-IN' ? '🇮🇳 Hindi' : '🌐 English'}
                </button>
              </div>

              <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">
                Say: &quot;Spent 500 on food&quot; or &quot;2000 salary received&quot;
              </span>
            </div>

            {/* Live speech feedback or detected draft banner */}
            {isListening && activeDictationField === 'transaction' && (
              <div className="p-2.5 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/40 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
                <span className="font-mono truncate">{voiceTranscript || 'Listening to your voice...'}</span>
              </div>
            )}

            {voiceDraft && !isListening && (
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800/90 border border-emerald-500/30 text-xs space-y-1">
                <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300 font-bold">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Voice Draft Applied — Please Review
                  </span>
                  <button
                    type="button"
                    onClick={() => setVoiceDraft(null)}
                    className="text-[10px] text-slate-400 hover:text-slate-600 underline cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Recognized: &quot;{voiceDraft.rawTranscript}&quot;. Amount: <strong>₹{amount || '0'}</strong>, Category: <strong>{category}</strong>. Please review details below before saving.
                </p>
              </div>
            )}
          </div>

          {/* Smart Categorization Live Suggestion Banner */}
          {(smartSuggestion || isSuggestingAi) && (
            <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/35 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                {isSuggestingAi ? (
                  <span className="text-emerald-800 dark:text-emerald-200">Checking smart category suggestion...</span>
                ) : smartSuggestion ? (
                  <span className="text-emerald-900 dark:text-emerald-100 truncate">
                    Suggested: <strong>{smartSuggestion.displayCategory}</strong>{' '}
                    <span className="opacity-75">
                      ({Math.round(smartSuggestion.confidence * 100)}% ·{' '}
                      {smartSuggestion.source === 'user_rule'
                        ? 'learned rule'
                        : smartSuggestion.source === 'history'
                        ? 'your history'
                        : smartSuggestion.source === 'ai'
                        ? 'AI'
                        : 'merchant match'})
                    </span>
                  </span>
                ) : null}
              </div>
              {smartSuggestion &&
                (smartSuggestion.category !== category || smartSuggestion.subcategory !== subcategory) && (
                  <button
                    type="button"
                    onClick={handleApplySmartSuggestion}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shrink-0 cursor-pointer"
                  >
                    Apply
                  </button>
                )}
            </div>
          )}

          {/* Transaction Type: Expense / Income / Transfer */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Transaction Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTransactionType('expense');
                  if (category === 'home' && subcategory === 'received_home') {
                    setSubcategory('home_expense');
                  }
                }}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  transactionType === 'expense'
                    ? 'bg-rose-50 dark:bg-rose-950/70 border-rose-400 text-rose-700 dark:text-rose-300 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                <ArrowUpRight className="w-3.5 h-3.5 text-rose-500" />
                <span>Expense (खर्च)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTransactionType('income');
                  if (category === 'home') {
                    setSubcategory('received_home');
                  }
                }}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  transactionType === 'income'
                    ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-400 text-emerald-700 dark:text-emerald-300 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500" />
                <span>Income (आय)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTransactionType('transfer');
                }}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  transactionType === 'transfer'
                    ? 'bg-blue-50 dark:bg-blue-950/70 border-blue-400 text-blue-700 dark:text-blue-300 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5 text-blue-500" />
                <span>Transfer (ट्रांसफर)</span>
              </button>
            </div>
          </div>
          {/* Section Picker Tabs */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
              Select Category
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { id: 'home' as TransactionCategory, label: 'Received Money', icon: ArrowDownLeft },
                { id: 'room' as TransactionCategory, label: 'Room Expense', icon: DoorOpen },
                { id: 'food' as TransactionCategory, label: 'Food & Dining', icon: Utensils },
                { id: 'other' as TransactionCategory, label: 'Other Expense', icon: ShoppingBag },
                { id: 'people' as TransactionCategory, label: 'People (Udhar)', icon: Users },
              ].map((tab) => {
                const Icon = tab.icon;
                const isSelected = category === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleCategoryChange(tab.id)}
                    className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-semibold border transition-all ${
                      isSelected
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                        : 'bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subcategory selectors based on category */}
          {(category === 'home' || category === 'received') && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Received Money Category
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {RECEIVED_CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const isSelected = subcategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSubcategory(cat.id)}
                      className={`flex items-center gap-2 p-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        isSelected
                          ? `${cat.color.bg} ${cat.color.border} ${cat.color.text} shadow-xs ring-1 ring-emerald-500 font-bold`
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{cat.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {category === 'room' && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                Room Expense Type
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'grocery' as TransactionSubcategory, label: 'Grocery', icon: Apple },
                  { id: 'gas' as TransactionSubcategory, label: 'Gas LPG', icon: Flame },
                  { id: 'rent' as TransactionSubcategory, label: 'Room Rent', icon: Building },
                  { id: 'electricity' as TransactionSubcategory, label: 'Electricity', icon: Zap },
                ].map((item) => {
                  const Icon = item.icon;
                  const isSel = subcategory === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSubcategory(item.id)}
                      className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-semibold border transition-all ${
                        isSel
                          ? 'bg-blue-50 dark:bg-blue-950/70 border-blue-400 text-blue-700 dark:text-blue-300 shadow-sm'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {category === 'food' && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                Food & Dining Type
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { id: 'snacks', label: 'Fast Food / Snacks' },
                  { id: 'restaurant', label: 'Dining / Restaurant' },
                  { id: 'beverages', label: 'Chai / Coffee' },
                  { id: 'delivery', label: 'Swiggy / Zomato' },
                  { id: 'mess_tiffin', label: 'Mess / Tiffin' },
                  { id: 'other_food', label: 'Other Food' },
                ].map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setSubcategory(sub.id)}
                    className={`py-2 px-2 rounded-lg text-xs font-semibold border transition-all ${
                      subcategory === sub.id
                        ? 'bg-orange-50 dark:bg-orange-950/70 border-orange-400 text-orange-700 dark:text-orange-300 shadow-sm'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {category === 'other' && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                Expense Category
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'shopping', label: 'Shopping' },
                  { id: 'travel', label: 'Travel & Transit' },
                  { id: 'entertainment', label: 'Entertainment' },
                  { id: 'health', label: 'Medical & Health' },
                  { id: 'personal_care', label: 'Personal Care' },
                  { id: 'bills', label: 'Bills & Recharge' },
                  { id: 'education', label: 'Education' },
                  { id: 'other_general', label: 'General Other' },
                ].map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setSubcategory(sub.id)}
                    className={`py-2 px-2 rounded-lg text-xs font-semibold border transition-all ${
                      subcategory === sub.id
                        ? 'bg-purple-50 dark:bg-purple-950/70 border-purple-400 text-purple-700 dark:text-purple-300 shadow-sm'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {category === 'people' && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                People Transaction Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSubcategory('money_given')}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                    subcategory === 'money_given'
                      ? 'bg-rose-50 dark:bg-rose-950/70 border-rose-400 text-rose-700 dark:text-rose-300 shadow-sm'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" />
                  <span>Money Given (Udhar Diya)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSubcategory('money_received')}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                    subcategory === 'money_received'
                      ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-400 text-emerald-700 dark:text-emerald-300 shadow-sm'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Money Received (Udhar Liya / Wapas)</span>
                </button>
              </div>
            </div>
          )}

          {/* Amount Field (Universal Required) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Amount (₹ INR) <span className="text-rose-500">*</span>
            </label>
            <div className="relative rounded-xl shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold text-lg">
                ₹
              </div>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-bold text-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            {duplicateCandidate && (
              <div className="mt-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5 animate-fade-in">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-bold">Possible duplicate transaction detected</p>
                  <p className="text-[11px] leading-relaxed opacity-90">
                    A record of ₹{duplicateCandidate.amount} ("{duplicateCandidate.title}") is already saved on {duplicateCandidate.transaction_date}. If this is a separate legitimate transaction, you can proceed.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Dynamic Category-Specific Fields */}

          {/* Received Money Fields */}
          {(category === 'home' || category === 'received') && (
            <div className="space-y-3 p-3.5 bg-emerald-50/40 dark:bg-emerald-950/20 rounded-xl border border-emerald-500/20">
              {(() => {
                const config = getReceivedCategoryConfig(subcategory);
                return (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {config.sourceField.label} <span className="text-[10px] text-slate-400 font-normal lowercase">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={receivedSource}
                        onChange={(e) => setReceivedSource(e.target.value)}
                        placeholder={config.sourceField.placeholder}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {config.descriptionField.label} <span className="text-[10px] text-slate-400 font-normal lowercase">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={receivedPurpose}
                        onChange={(e) => setReceivedPurpose(e.target.value)}
                        placeholder={config.descriptionField.placeholder}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Payment Method
                      </label>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                        {PAYMENT_METHODS.map((pm) => (
                          <button
                            key={pm.id}
                            type="button"
                            onClick={() => setReceivedPaymentMethod(pm.id)}
                            className={`py-1.5 px-2 rounded-lg border text-[11px] font-semibold text-center transition-all cursor-pointer ${
                              receivedPaymentMethod === pm.id
                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {pm.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Room - Grocery Fields */}
          {category === 'room' && subcategory === 'grocery' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Grocery Item Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={groceryItem}
                  onChange={(e) => setGroceryItem(e.target.value)}
                  placeholder="e.g. Rice, Oil, Vegetables, Milk"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Quantity (Optional)
                </label>
                <input
                  type="text"
                  value={groceryQuantity}
                  onChange={(e) => setGroceryQuantity(e.target.value)}
                  placeholder="e.g. 5 kg, 2 Liters, 1 packet"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          )}

          {/* Room - Gas Fields */}
          {category === 'room' && subcategory === 'gas' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Who Paid? (Optional)
              </label>
              <input
                type="text"
                value={gasPaidBy}
                onChange={(e) => setGasPaidBy(e.target.value)}
                placeholder="e.g. Self, Flatmate Amit, Cash"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}

          {/* Room - Rent Fields */}
          {category === 'room' && subcategory === 'rent' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Rent Month <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={rentMonth}
                  onChange={(e) => setRentMonth(e.target.value)}
                  placeholder="e.g. November 2026"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Paid To (Optional)
                </label>
                <input
                  type="text"
                  value={rentPaidTo}
                  onChange={(e) => setRentPaidTo(e.target.value)}
                  placeholder="e.g. Landlord Sharma Ji"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          )}

          {/* Room - Electricity Fields */}
          {category === 'room' && subcategory === 'electricity' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Billing Month <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={elecMonth}
                onChange={(e) => setElecMonth(e.target.value)}
                placeholder="e.g. October - November 2026"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}

          {/* Food & Dining Specific Fields */}
          {category === 'food' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Food Item / Meal <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={foodItem}
                    onChange={(e) => setFoodItem(e.target.value)}
                    placeholder="e.g. Evening Chai & Samosa, Pizza, Thali"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Restaurant / Platform / Location
                  </label>
                  <input
                    type="text"
                    value={foodPlace}
                    onChange={(e) => setFoodPlace(e.target.value)}
                    placeholder="e.g. Swiggy, Zomato, Canteen, Dhaba"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              {/* Quick Suggestion Chips */}
              <div>
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-2">
                  Quick Food Chips:
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {[
                    'Evening Chai & Samosa',
                    'Pizza',
                    'Burger & Fries',
                    'Lunch Thali',
                    'Biryani',
                    'Tea & Poha',
                    'Cold Drink / Juice',
                    'Dosa',
                    'Street Chaat',
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setFoodItem(chip)}
                      className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-orange-50 dark:hover:bg-orange-950/40 text-slate-700 dark:text-slate-300 hover:text-orange-700 dark:hover:text-orange-300 rounded-lg text-[10px] font-medium border border-slate-200 dark:border-slate-700 cursor-pointer"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Other Expenses Fields */}
          {category === 'other' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Where was money spent? <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={spentAt}
                    onChange={(e) => setSpentAt(e.target.value)}
                    placeholder="e.g. Amazon, Metro Station, Pharmacy"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Why was it spent? (Reason) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={spentFor}
                    onChange={(e) => setSpentFor(e.target.value)}
                    placeholder="e.g. Travelling, Online Shopping, Haircut"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              {/* Quick Other Suggestion Chips */}
              <div>
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-2">
                  Quick Reasons:
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {[
                    'Online Shopping',
                    'Metro Card Recharge',
                    'Cab / Auto Fare',
                    'Petrol',
                    'Medicine',
                    'Mobile Data Recharge',
                    'Haircut / Salon',
                    'Movie Tickets',
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setSpentFor(chip)}
                      className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-950/40 text-slate-700 dark:text-slate-300 hover:text-purple-700 dark:hover:text-purple-300 rounded-lg text-[10px] font-medium border border-slate-200 dark:border-slate-700 cursor-pointer"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* People Section Fields */}
          {category === 'people' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Person's Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  placeholder="e.g. Rahul Verma, Aman Gupta, Sister"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Purpose / Reason <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={peopleReason}
                  onChange={(e) => setPeopleReason(e.target.value)}
                  placeholder="e.g. College fees emergency, Dinner bill split, Borrowed for books"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          )}

          {/* Automatic Date and Time System (IST) - Fully Editable */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-500" />
                <span>Date & Time (IST — Indian Standard Time)</span>
              </span>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md">
                Auto-captured
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Transaction Date
                </label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Transaction Time (IST)
                </label>
                <div className="relative">
                  <input
                    type="time"
                    step="1"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Payment Method Selector (Screen 2) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5 text-emerald-500" />
              <span>Payment Method</span>
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {[
                { id: 'UPI', label: 'UPI / QR' },
                { id: 'Cash', label: 'Cash (नकद)' },
                { id: 'Bank Transfer', label: 'Net Banking' },
                { id: 'Card', label: 'Card' },
                { id: 'Other', label: 'Other' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaymentMethod(m.id)}
                  className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-all text-center cursor-pointer ${
                    paymentMethod === m.id
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-400 text-emerald-700 dark:text-emerald-300 shadow-sm font-bold'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Receipt Image Attachment (Screen 2) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-emerald-500" />
                <span>Receipt Attachment (Optional)</span>
              </span>
              {receiptImage && (
                <button
                  type="button"
                  onClick={() => setReceiptImage(null)}
                  className="text-xs text-rose-500 hover:text-rose-700 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Remove Receipt</span>
                </button>
              )}
            </label>

            {receiptImage ? (
              <div className="relative p-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                <img
                  src={receiptImage}
                  alt="Receipt Preview"
                  className="w-16 h-16 rounded-xl object-cover border border-slate-300 dark:border-slate-600 shadow-sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                    Receipt Attached
                  </p>
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                    Optimized & compressed (ready to save)
                  </p>
                </div>
              </div>
            ) : (
              <label className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-2xl p-4 flex flex-col items-center justify-center gap-1.5 cursor-pointer bg-slate-50/50 dark:bg-slate-800/30 transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleReceiptChange}
                  className="hidden"
                />
                {isCompressingReceipt ? (
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                    <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <span>Compressing image...</span>
                  </div>
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-slate-400" />
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Upload or take photo of receipt / bill
                    </span>
                    <span className="text-[10px] text-slate-400">PNG, JPG, WEBP (Max 10MB)</span>
                  </>
                )}
              </label>
            )}
          </div>

          {/* Notes (Optional) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Optional Notes / Remarks
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Paid via UPI, bill receipt kept in drawer, promised repayment date..."
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
            />
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
            <button
              type="button"
              onClick={resetForm}
              disabled={isSubmitting || !isDirty}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all disabled:opacity-40 cursor-pointer"
              title="Reset all form fields to default"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAttemptClose}
                disabled={isSubmitting}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 rounded-xl shadow-lg shadow-emerald-600/25 transition-all cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <PlusCircle className="w-4 h-4" />
                    <span>Save Record</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      <UnsavedChangesModal
        isOpen={showUnsavedConfirm}
        documentName="New Transaction"
        onStay={() => setShowUnsavedConfirm(false)}
        onDiscard={handleDiscardChanges}
      />
    </div>
  );
};
