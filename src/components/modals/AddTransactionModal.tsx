import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  Check,
  Briefcase,
  Building2,
  Users,
  Tag,
  Laptop,
  Gift,
  RefreshCw,
  Home,
  Utensils,
  ShoppingBag,
  Compass,
  FileText,
  CreditCard,
  Activity,
  GraduationCap,
  Gamepad2,
  Landmark,
  Loader2,
  Clock,
  CheckCircle2,
  Download,
  Upload,
  Plus,
  Trash2,
  Camera,
  Image as ImageIcon,
  Flame,
  ShoppingCart,
  Zap,
  Coffee,
  Truck,
  Heart,
  QrCode,
  Banknote,
  Wallet,
  HelpCircle,
  Calendar,
  Sparkles,
  ScanLine,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import {
  TransactionCategory,
  TransactionSubcategory,
  NewTransactionPayload,
  TransactionMetadata,
} from '../../types';
import { getCurrentISTDate, getCurrentISTTime } from '../../lib/dateUtils';
import { processImageAttachment, isSafeAttachmentUrl } from '../../lib/attachmentUtils';
import { roundMoney } from '../../lib/financialIntelligenceEngine';

export interface AddTransactionModalProps {
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

type ModalMode = 'select' | 'receive' | 'expense';
type ExpenseSubstep = 'main' | 'sub' | 'form';
type MainExpenseCategory = 'room' | 'food' | 'other';

interface RecentShortcut {
  mode: 'receive' | 'expense';
  mainCategory: TransactionCategory;
  subcategory: TransactionSubcategory;
  label: string;
}

interface AttachmentState {
  dataUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

interface BatchLineItem {
  id: string;
  mainCategory: MainExpenseCategory;
  subcategory: TransactionSubcategory;
  label: string;
  customLabel: string;
  amount: string;
  description: string;
}

const RECENT_SHORTCUTS_KEY = 'mymoney_recent_tx_shortcuts_v2';

// 7 Income Categories for Receive Money
const RECEIVE_CATEGORIES = [
  { id: 'salary', label: 'Salary', icon: Briefcase, subcategory: 'salary' as TransactionSubcategory },
  { id: 'business', label: 'Business', icon: Building2, subcategory: 'business' as TransactionSubcategory },
  { id: 'family', label: 'Received from Person', icon: Users, subcategory: 'family' as TransactionSubcategory },
  { id: 'freelancing', label: 'Freelance', icon: Laptop, subcategory: 'freelancing' as TransactionSubcategory },
  { id: 'gift', label: 'Gift', icon: Gift, subcategory: 'gift' as TransactionSubcategory },
  { id: 'refund', label: 'Refund', icon: RefreshCw, subcategory: 'refund' as TransactionSubcategory },
  { id: 'other_income', label: 'Other Income', icon: Tag, subcategory: 'other_income' as TransactionSubcategory },
] as const;

// 3 Main Expense Categories
const EXPENSE_MAIN_CATEGORIES: Array<{
  id: MainExpenseCategory;
  label: string;
  subtitle: string;
  icon: any;
  colorClass: string;
  iconBgClass: string;
}> = [
  {
    id: 'room',
    label: 'Room',
    subtitle: 'Gas, Grocery, Room Rent & Electricity',
    icon: Home,
    colorClass: 'border-blue-500/35 hover:border-blue-500 bg-blue-50/50 dark:bg-blue-950/25',
    iconBgClass: 'bg-blue-600 text-white shadow-blue-600/25',
  },
  {
    id: 'food',
    label: 'Food & Dining',
    subtitle: 'Restaurant, Snacks, Beverages & Delivery',
    icon: Utensils,
    colorClass: 'border-orange-500/35 hover:border-orange-500 bg-orange-50/50 dark:bg-orange-950/25',
    iconBgClass: 'bg-orange-600 text-white shadow-orange-600/25',
  },
  {
    id: 'other',
    label: 'Other Expenses',
    subtitle: 'Shopping, Travel, Bills, Medical, EMI & More',
    icon: ShoppingBag,
    colorClass: 'border-purple-500/35 hover:border-purple-500 bg-purple-50/50 dark:bg-purple-950/25',
    iconBgClass: 'bg-purple-600 text-white shadow-purple-600/25',
  },
];

// Subcategories strictly grouped by Main Expense Category
const EXPENSE_SUBCATEGORIES: Record<
  MainExpenseCategory,
  Array<{ id: TransactionSubcategory; label: string; icon: any }>
> = {
  room: [
    { id: 'gas', label: 'Gas Expenses', icon: Flame },
    { id: 'grocery', label: 'Grocery Expenses', icon: ShoppingCart },
    { id: 'rent', label: 'Room Rent', icon: Home },
    { id: 'electricity', label: 'Electricity Bill', icon: Zap },
  ],
  food: [
    { id: 'restaurant', label: 'Restaurant', icon: Utensils },
    { id: 'snacks', label: 'Snacks', icon: Sparkles },
    { id: 'beverages', label: 'Beverages', icon: Coffee },
    { id: 'delivery', label: 'Food Delivery', icon: Truck },
    { id: 'mess_tiffin', label: 'Mess / Tiffin', icon: Utensils },
    { id: 'other_food', label: 'Other Food', icon: Tag },
  ],
  other: [
    { id: 'shopping', label: 'Shopping', icon: ShoppingBag },
    { id: 'travel', label: 'Travel', icon: Compass },
    { id: 'bills', label: 'Bills', icon: FileText },
    { id: 'health', label: 'Medical / Health', icon: Activity },
    { id: 'education', label: 'Education', icon: GraduationCap },
    { id: 'entertainment', label: 'Entertainment', icon: Gamepad2 },
    { id: 'personal_care', label: 'Personal Care', icon: Heart },
    { id: 'emi_loan', label: 'EMI / Loan', icon: Landmark },
    { id: 'other_expense', label: 'Other Expenses', icon: CreditCard },
  ],
};

const CUSTOM_SUGGESTIONS: Record<MainExpenseCategory | 'receive', string[]> = {
  room: ['Water Bill', 'WiFi / Broadband', 'Maid / Cleaning', 'Maintenance'],
  food: ['Tea & Coffee', 'Bakery', 'Street Food', 'Ice Cream'],
  other: ['Laundry', 'Gym', 'Parking', 'Temple / Donation', 'Pet Care'],
  receive: ['Rental Income', 'Dividend', 'Scholarship', 'Cashback', 'Bonus'],
};

const PAYMENT_OPTIONS: Array<{
  id: 'upi' | 'cash' | 'bank_transfer' | 'card' | 'wallet' | 'other';
  label: string;
  icon: any;
  hasUtr?: boolean;
}> = [
  { id: 'upi', label: 'UPI', icon: QrCode, hasUtr: true },
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'bank_transfer', label: 'Bank Transfer', icon: Building2, hasUtr: true },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'other', label: 'Other', icon: HelpCircle },
];

const createLineItem = (
  mainCategory: MainExpenseCategory = 'food',
  subcategory: TransactionSubcategory = 'restaurant',
  label = 'Restaurant',
  customLabel = ''
): BatchLineItem => ({
  id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  mainCategory,
  subcategory,
  label,
  customLabel,
  amount: '',
  description: '',
});

export const AddTransactionModal: React.FC<AddTransactionModalProps> = ({
  isOpen,
  onClose,
  initialCategory,
  initialSubcategory,
  initialPersonName,
  initialAmount,
  initialTitle,
  initialDate,
  onOpenReceiptScanner,
}) => {
  const { addTransaction, addTransactionBatch } = useExpense();
  const toast = useToast();

  // Navigation State
  const [mode, setMode] = useState<ModalMode>('select');
  const [expenseSubstep, setExpenseSubstep] = useState<ExpenseSubstep>('main');

  // Income State
  const [receiveCategory, setReceiveCategory] = useState<TransactionSubcategory>('salary');
  const [receiveLabel, setReceiveLabel] = useState<string>('Salary');
  const [isCustomReceive, setIsCustomReceive] = useState<boolean>(false);
  const [customReceiveText, setCustomReceiveText] = useState<string>('');
  const [isBorrowedUdhar, setIsBorrowedUdhar] = useState<boolean>(false);
  const [receivedFrom, setReceivedFrom] = useState<string>('');

  // Expense Category State
  const [mainExpenseCat, setMainExpenseCat] = useState<MainExpenseCategory>('room');
  const [expenseSubcategory, setExpenseSubcategory] = useState<TransactionSubcategory>('rent');
  const [expenseSubLabel, setExpenseSubLabel] = useState<string>('Room Rent');
  const [isCustomExpense, setIsCustomExpense] = useState<boolean>(false);
  const [customExpenseText, setCustomExpenseText] = useState<string>('');

  // Shared Form State (Single / Primary Item)
  const [amount, setAmount] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [txDate, setTxDate] = useState<string>(() => getCurrentISTDate());
  const [txTime, setTxTime] = useState<string>(() => getCurrentISTTime());
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'cash' | 'bank_transfer' | 'card' | 'wallet' | 'other'>('upi');
  const [utrRef, setUtrRef] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Contextual Fields (only shown for matching subcategory)
  const [billingMonth, setBillingMonth] = useState<string>('');
  const [paidTo, setPaidTo] = useState<string>('');
  const [paidBy, setPaidBy] = useState<string>('');
  const [gasProvider, setGasProvider] = useState<string>('');
  const [groceryItem, setGroceryItem] = useState<string>('');
  const [groceryQty, setGroceryQty] = useState<string>('');
  const [foodPlace, setFoodPlace] = useState<string>('');
  const [foodItem, setFoodItem] = useState<string>('');
  const [travelRoute, setTravelRoute] = useState<string>('');
  const [shopItem, setShopItem] = useState<string>('');
  const [shopStore, setShopStore] = useState<string>('');
  const [billName, setBillName] = useState<string>('');
  const [billProvider, setBillProvider] = useState<string>('');
  const [spentFor, setSpentFor] = useState<string>('');

  // Multi-Item Batch State (1–3 combined items)
  const [extraItems, setExtraItems] = useState<BatchLineItem[]>([]);
  const [receiveExtraItems, setReceiveExtraItems] = useState<Array<{ id: string; subcategory: TransactionSubcategory; label: string; amount: string; description: string }>>([]);

  // Attachment State
  const [attachment, setAttachment] = useState<AttachmentState | null>(null);
  const [isProcessingAttachment, setIsProcessingAttachment] = useState<boolean>(false);

  // Recent Shortcuts & Submission State
  const [recentShortcuts, setRecentShortcuts] = useState<RecentShortcut[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<{ type: 'receive' | 'expense'; amount: number; count: number } | null>(null);

  const amountInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Load recent shortcuts
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_SHORTCUTS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setRecentShortcuts(parsed);
      }
    } catch {
      // ignore storage errors
    }
  }, [isOpen]);

  const recordShortcut = (shortcut: RecentShortcut) => {
    try {
      const filtered = recentShortcuts.filter(
        (s) => !(s.mode === shortcut.mode && s.mainCategory === shortcut.mainCategory && s.subcategory === shortcut.subcategory && s.label === shortcut.label)
      );
      const updated = [shortcut, ...filtered].slice(0, 6);
      setRecentShortcuts(updated);
      localStorage.setItem(RECENT_SHORTCUTS_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const resetContextualFields = () => {
    setBillingMonth('');
    setPaidTo('');
    setPaidBy('');
    setGasProvider('');
    setGroceryItem('');
    setGroceryQty('');
    setFoodPlace('');
    setFoodItem('');
    setTravelRoute('');
    setShopItem('');
    setShopStore('');
    setBillName('');
    setBillProvider('');
    setSpentFor('');
  };

  // Initialize modal state on open
  useEffect(() => {
    if (!isOpen) return;

    setSaveSuccess(null);
    setExtraItems([]);
    setReceiveExtraItems([]);
    setAttachment(null);
    setIsCustomReceive(false);
    setCustomReceiveText('');
    setIsCustomExpense(false);
    setCustomExpenseText('');
    setIsBorrowedUdhar(false);
    setPaymentMethod('upi');
    setUtrRef('');
    setNotes('');
    resetContextualFields();

    setTxDate(initialDate || getCurrentISTDate());
    setTxTime(getCurrentISTTime());
    setAmount(initialAmount !== undefined && initialAmount !== null ? String(initialAmount) : '');
    setDescription(initialTitle || '');
    setReceivedFrom(initialPersonName || '');

    if (initialCategory === 'home' || initialCategory === 'received') {
      setMode('receive');
      const found = RECEIVE_CATEGORIES.find((c) => c.subcategory === initialSubcategory);
      if (initialSubcategory === 'udhar_received') {
        setReceiveCategory('family');
        setReceiveLabel('Received from Person');
        setIsBorrowedUdhar(true);
      } else if (found) {
        setReceiveCategory(found.subcategory);
        setReceiveLabel(found.label);
      } else {
        setReceiveCategory('salary');
        setReceiveLabel('Salary');
      }
    } else if (initialCategory === 'room' || initialCategory === 'food' || initialCategory === 'other') {
      setMode('expense');
      const mainCat: MainExpenseCategory = initialCategory;
      setMainExpenseCat(mainCat);
      if (initialSubcategory) {
        const subMatch = EXPENSE_SUBCATEGORIES[mainCat].find((s) => s.id === initialSubcategory);
        if (subMatch) {
          setExpenseSubcategory(subMatch.id);
          setExpenseSubLabel(subMatch.label);
          setExpenseSubstep('form');
        } else {
          setExpenseSubstep('sub');
        }
      } else {
        setExpenseSubstep('sub');
      }
    } else {
      setMode('select');
      setExpenseSubstep('main');
    }
  }, [isOpen, initialCategory, initialSubcategory, initialPersonName, initialAmount, initialTitle, initialDate]);

  // Auto-focus amount input when entering a form view
  useEffect(() => {
    if (!isOpen) return;
    if (mode === 'receive' || (mode === 'expense' && expenseSubstep === 'form')) {
      const timer = setTimeout(() => {
        amountInputRef.current?.focus();
      }, 90);
      return () => clearTimeout(timer);
    }
  }, [isOpen, mode, expenseSubstep]);

  // Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, isSubmitting, onClose]);

  const recentReceiveShortcuts = useMemo(
    () => recentShortcuts.filter((s) => s.mode === 'receive').slice(0, 4),
    [recentShortcuts]
  );

  const recentExpenseShortcuts = useMemo(
    () => recentShortcuts.filter((s) => s.mode === 'expense').slice(0, 4),
    [recentShortcuts]
  );

  // Combined batch totals (paise-safe)
  const expenseBatchTotal = useMemo(() => {
    const primary = parseFloat(amount) || 0;
    const extras = extraItems.reduce((acc, it) => acc + (parseFloat(it.amount) || 0), 0);
    return roundMoney(primary + extras);
  }, [amount, extraItems]);

  const receiveBatchTotal = useMemo(() => {
    const primary = parseFloat(amount) || 0;
    const extras = receiveExtraItems.reduce((acc, it) => acc + (parseFloat(it.amount) || 0), 0);
    return roundMoney(primary + extras);
  }, [amount, receiveExtraItems]);

  if (!isOpen) return null;

  const handleAttachmentFile = async (file?: File | null) => {
    if (!file) return;
    setIsProcessingAttachment(true);
    try {
      const res = await processImageAttachment(file);
      if (!res.valid || !res.dataUrl) {
        toast.error('Invalid Attachment', res.error || 'Please pick a valid JPEG, PNG, or WEBP image under 5 MB.');
        return;
      }
      setAttachment({
        dataUrl: res.dataUrl,
        fileName: res.fileName || 'receipt.jpg',
        mimeType: res.mimeType || 'image/jpeg',
        sizeBytes: res.sizeBytes || 0,
      });
    } finally {
      setIsProcessingAttachment(false);
    }
  };

  const handleQuickAddAmount = (delta: number) => {
    const current = parseFloat(amount) || 0;
    setAmount(String(roundMoney(current + delta)));
  };

  const handleSelectExpenseMain = (cat: MainExpenseCategory) => {
    setMainExpenseCat(cat);
    setIsCustomExpense(false);
    setCustomExpenseText('');
    setExpenseSubstep('sub');
  };

  const handleSelectExpenseSub = (subId: TransactionSubcategory, label: string) => {
    setExpenseSubcategory(subId);
    setExpenseSubLabel(label);
    setIsCustomExpense(false);
    setCustomExpenseText('');
    resetContextualFields();
    setExpenseSubstep('form');
  };

  const handleConfirmCustomExpense = () => {
    const trimmed = customExpenseText.trim();
    if (!trimmed) {
      toast.error('Custom Category Required', 'Please enter a category name.');
      return;
    }
    const fallbackSub: TransactionSubcategory =
      mainExpenseCat === 'food' ? 'other_food' : 'other_expense';
    setExpenseSubcategory(fallbackSub);
    setExpenseSubLabel(trimmed);
    resetContextualFields();
    setExpenseSubstep('form');
  };

  const handleConfirmCustomReceive = () => {
    const trimmed = customReceiveText.trim();
    if (!trimmed) {
      toast.error('Custom Source Required', 'Please enter an income source name.');
      return;
    }
    setReceiveCategory('other_income');
    setReceiveLabel(trimmed);
  };

  const handleAddExtraExpenseItem = () => {
    if (extraItems.length >= 2) return; // Primary + max 2 extras = 3 items
    const defaultSub = EXPENSE_SUBCATEGORIES[mainExpenseCat][0];
    setExtraItems((prev) => [
      ...prev,
      createLineItem(
        mainExpenseCat,
        defaultSub?.id || 'other_expense',
        defaultSub?.label || 'Other Expenses'
      ),
    ]);
  };

  const handleAddExtraReceiveItem = () => {
    if (receiveExtraItems.length >= 2) return;
    setReceiveExtraItems((prev) => [
      ...prev,
      {
        id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        subcategory: 'other_income',
        label: 'Other Income',
        amount: '',
        description: '',
      },
    ]);
  };

  const handleBackNavigation = () => {
    if (mode === 'receive') {
      setMode('select');
      return;
    }
    if (mode === 'expense') {
      if (expenseSubstep === 'form') {
        setExpenseSubstep('sub');
      } else if (expenseSubstep === 'sub') {
        setExpenseSubstep('main');
      } else {
        setMode('select');
      }
    }
  };

  const buildContextualMetadata = (
    cat: MainExpenseCategory,
    sub: TransactionSubcategory,
    label: string,
    isCustom: boolean
  ): TransactionMetadata => {
    const meta: TransactionMetadata = {
      source: 'unified_add_transaction_v2',
      category_label: label,
      payment_method: paymentMethod,
    };
    if (isCustom) meta.custom_category_label = label;
    if ((paymentMethod === 'upi' || paymentMethod === 'bank_transfer') && utrRef.trim()) {
      meta.utr = utrRef.trim();
    }
    if (attachment && isSafeAttachmentUrl(attachment.dataUrl)) {
      meta.attachment_url = attachment.dataUrl;
      meta.attachment_name = attachment.fileName;
      meta.attachment_mime = attachment.mimeType;
      meta.attachment_size = attachment.sizeBytes;
    }

    if (sub === 'rent') {
      if (billingMonth.trim()) meta.month = billingMonth.trim();
      if (paidTo.trim()) meta.paid_to = paidTo.trim();
    } else if (sub === 'grocery') {
      if (groceryItem.trim()) meta.grocery_item = groceryItem.trim();
      if (groceryQty.trim()) meta.quantity = groceryQty.trim();
    } else if (sub === 'electricity') {
      if (billingMonth.trim()) meta.billing_month = billingMonth.trim();
    } else if (sub === 'gas') {
      if (paidBy.trim()) meta.paid_by = paidBy.trim();
      if (gasProvider.trim()) meta.gas_provider = gasProvider.trim();
    } else if (cat === 'food') {
      if (foodPlace.trim()) meta.restaurant_name = foodPlace.trim();
      if (foodItem.trim()) meta.food_item = foodItem.trim();
    } else if (sub === 'travel') {
      if (travelRoute.trim()) meta.spent_for = travelRoute.trim();
    } else if (sub === 'shopping') {
      if (shopItem.trim()) meta.spent_for = shopItem.trim();
      if (shopStore.trim()) meta.spent_at = shopStore.trim();
    } else if (sub === 'bills' || sub === 'emi_loan') {
      if (billName.trim()) meta.spent_for = billName.trim();
      if (billProvider.trim()) meta.paid_to = billProvider.trim();
    } else {
      if (spentFor.trim()) meta.spent_for = spentFor.trim();
      if (paidTo.trim()) meta.paid_to = paidTo.trim();
    }
    return meta;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const primaryAmount = parseFloat(amount);
    if (isNaN(primaryAmount) || primaryAmount <= 0) {
      toast.error('Invalid Amount', 'Please enter a valid amount greater than ₹0.');
      amountInputRef.current?.focus();
      return;
    }

    const cleanDate = txDate || getCurrentISTDate();
    const cleanTime = txTime || getCurrentISTTime();

    if (mode === 'receive') {
      // Validate extra income items if any
      for (let i = 0; i < receiveExtraItems.length; i++) {
        const ex = parseFloat(receiveExtraItems[i].amount);
        if (isNaN(ex) || ex <= 0) {
          toast.error('Invalid Item Amount', `Please enter a valid amount for Item ${i + 2}.`);
          return;
        }
      }

      setIsSubmitting(true);
      try {
        const resolvedSub: TransactionSubcategory =
          receiveCategory === 'family' && isBorrowedUdhar ? 'udhar_received' : receiveCategory;
        const resolvedLabel =
          isCustomReceive && customReceiveText.trim()
            ? customReceiveText.trim()
            : resolvedSub === 'udhar_received'
            ? 'Borrowed Money (Udhar)'
            : receiveLabel;

        const baseMeta: TransactionMetadata = {
          source: 'unified_add_transaction_v2',
          category_label: resolvedLabel,
          payment_method: paymentMethod,
        };
        if (isCustomReceive && customReceiveText.trim()) {
          baseMeta.custom_category_label = customReceiveText.trim();
        }
        if (resolvedSub === 'udhar_received') {
          baseMeta.financial_classification = 'borrowed';
        }
        if (receivedFrom.trim()) baseMeta.received_from = receivedFrom.trim();
        if ((paymentMethod === 'upi' || paymentMethod === 'bank_transfer') && utrRef.trim()) {
          baseMeta.utr = utrRef.trim();
        }
        if (attachment && isSafeAttachmentUrl(attachment.dataUrl)) {
          baseMeta.attachment_url = attachment.dataUrl;
          baseMeta.attachment_name = attachment.fileName;
          baseMeta.attachment_mime = attachment.mimeType;
          baseMeta.attachment_size = attachment.sizeBytes;
        }

        const payloads: NewTransactionPayload[] = [
          {
            category: 'home',
            subcategory: resolvedSub,
            transaction_type: 'income',
            amount: roundMoney(primaryAmount),
            title: description.trim() || resolvedLabel,
            description: description.trim() || undefined,
            person_name: receivedFrom.trim() || initialPersonName || undefined,
            transaction_date: cleanDate,
            transaction_time: cleanTime,
            notes: notes.trim() || undefined,
            metadata: baseMeta,
          },
          ...receiveExtraItems.map((it) => ({
            category: 'home' as TransactionCategory,
            subcategory: it.subcategory,
            transaction_type: 'income' as const,
            amount: roundMoney(parseFloat(it.amount)),
            title: it.description.trim() || it.label,
            description: it.description.trim() || undefined,
            person_name: receivedFrom.trim() || initialPersonName || undefined,
            transaction_date: cleanDate,
            transaction_time: cleanTime,
            notes: notes.trim() || undefined,
            metadata: {
              source: 'unified_add_transaction_v2',
              category_label: it.label,
              payment_method: paymentMethod,
              ...(receivedFrom.trim() ? { received_from: receivedFrom.trim() } : {}),
            },
          })),
        ];

        if (payloads.length > 1) {
          await addTransactionBatch(payloads);
        } else {
          await addTransaction(payloads[0]);
        }

        recordShortcut({
          mode: 'receive',
          mainCategory: 'home',
          subcategory: resolvedSub,
          label: resolvedLabel,
        });

        setSaveSuccess({
          type: 'receive',
          amount: receiveBatchTotal,
          count: payloads.length,
        });
        toast.success(
          payloads.length > 1 ? `${payloads.length} Credits Saved!` : 'Money Received!',
          `₹${receiveBatchTotal.toLocaleString('en-IN')} added to your balance.`
        );
        setTimeout(() => onClose(), 850);
      } catch (err: any) {
        toast.error('Failed to save', err?.message || 'Please try again.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Expense mode
    for (let i = 0; i < extraItems.length; i++) {
      const ex = parseFloat(extraItems[i].amount);
      if (isNaN(ex) || ex <= 0) {
        toast.error('Invalid Item Amount', `Please enter a valid amount for Item ${i + 2}.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const primaryLabel =
        isCustomExpense && customExpenseText.trim() ? customExpenseText.trim() : expenseSubLabel;
      const primaryMeta = buildContextualMetadata(
        mainExpenseCat,
        expenseSubcategory,
        primaryLabel,
        Boolean(isCustomExpense && customExpenseText.trim())
      );

      const primaryTitle =
        description.trim() ||
        groceryItem.trim() ||
        foodItem.trim() ||
        shopItem.trim() ||
        billName.trim() ||
        spentFor.trim() ||
        primaryLabel;

      const payloads: NewTransactionPayload[] = [
        {
          category: mainExpenseCat,
          subcategory: expenseSubcategory,
          transaction_type: 'expense',
          amount: roundMoney(primaryAmount),
          title: primaryTitle,
          description: description.trim() || undefined,
          person_name: initialPersonName || undefined,
          transaction_date: cleanDate,
          transaction_time: cleanTime,
          notes: notes.trim() || undefined,
          metadata: primaryMeta,
        },
        ...extraItems.map((item) => {
          const itemLabel = item.customLabel.trim() || item.label;
          return {
            category: item.mainCategory,
            subcategory: item.subcategory,
            transaction_type: 'expense' as const,
            amount: roundMoney(parseFloat(item.amount)),
            title: item.description.trim() || itemLabel,
            description: item.description.trim() || undefined,
            person_name: initialPersonName || undefined,
            transaction_date: cleanDate,
            transaction_time: cleanTime,
            notes: notes.trim() || undefined,
            metadata: {
              source: 'unified_add_transaction_v2',
              category_label: itemLabel,
              payment_method: paymentMethod,
              ...(item.customLabel.trim() ? { custom_category_label: item.customLabel.trim() } : {}),
              ...(attachment && isSafeAttachmentUrl(attachment.dataUrl)
                ? {
                    attachment_url: attachment.dataUrl,
                    attachment_name: attachment.fileName,
                    attachment_mime: attachment.mimeType,
                    attachment_size: attachment.sizeBytes,
                  }
                : {}),
            },
          };
        }),
      ];

      if (payloads.length > 1) {
        await addTransactionBatch(payloads);
      } else {
        await addTransaction(payloads[0]);
      }

      recordShortcut({
        mode: 'expense',
        mainCategory: mainExpenseCat,
        subcategory: expenseSubcategory,
        label: primaryLabel,
      });

      setSaveSuccess({
        type: 'expense',
        amount: expenseBatchTotal,
        count: payloads.length,
      });
      toast.success(
        payloads.length > 1 ? `${payloads.length} Expenses Saved!` : 'Expense Saved!',
        `₹${expenseBatchTotal.toLocaleString('en-IN')} deducted from your balance.`
      );
      setTimeout(() => onClose(), 850);
    } catch (err: any) {
      toast.error('Failed to save', err?.message || 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderContextualFields = () => {
    if (expenseSubcategory === 'rent') {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/70 dark:border-blue-900/50">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Rent Month (Optional)
            </label>
            <input
              type="text"
              value={billingMonth}
              onChange={(e) => setBillingMonth(e.target.value)}
              placeholder="e.g. November 2026"
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Paid To Landlord (Optional)
            </label>
            <input
              type="text"
              value={paidTo}
              onChange={(e) => setPaidTo(e.target.value)}
              placeholder="e.g. Sharma Ji / Owner"
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
            />
          </div>
        </div>
      );
    }

    if (expenseSubcategory === 'grocery') {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-900/50">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Grocery Item(s) (Optional)
            </label>
            <input
              type="text"
              value={groceryItem}
              onChange={(e) => setGroceryItem(e.target.value)}
              placeholder="e.g. Milk, Vegetables, Rice"
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Quantity (Optional)
            </label>
            <input
              type="text"
              value={groceryQty}
              onChange={(e) => setGroceryQty(e.target.value)}
              placeholder="e.g. 2 kg / 3 packs"
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      );
    }

    if (expenseSubcategory === 'electricity') {
      return (
        <div className="p-3.5 rounded-xl bg-amber-50/40 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/50">
          <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Billing Month (Optional)
          </label>
          <input
            type="text"
            value={billingMonth}
            onChange={(e) => setBillingMonth(e.target.value)}
            placeholder="e.g. October–November 2026"
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-amber-500"
          />
        </div>
      );
    }

    if (expenseSubcategory === 'gas') {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-orange-50/40 dark:bg-orange-950/20 border border-orange-200/70 dark:border-orange-900/50">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Paid By (Optional)
            </label>
            <input
              type="text"
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              placeholder="e.g. Self / Roommate Split"
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-orange-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Gas Provider (Optional)
            </label>
            <input
              type="text"
              value={gasProvider}
              onChange={(e) => setGasProvider(e.target.value)}
              placeholder="e.g. Indane / HP Gas / Bharat"
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-orange-500"
            />
          </div>
        </div>
      );
    }

    if (mainExpenseCat === 'food') {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-orange-50/40 dark:bg-orange-950/20 border border-orange-200/70 dark:border-orange-900/50">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Place / Restaurant / App (Optional)
            </label>
            <input
              type="text"
              value={foodPlace}
              onChange={(e) => setFoodPlace(e.target.value)}
              placeholder="e.g. Zomato, Swiggy, Udupi Cafe"
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-orange-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Food / Drink Item (Optional)
            </label>
            <input
              type="text"
              value={foodItem}
              onChange={(e) => setFoodItem(e.target.value)}
              placeholder="e.g. Lunch Thali, Chai & Samosa"
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-orange-500"
            />
          </div>
        </div>
      );
    }

    if (expenseSubcategory === 'travel') {
      return (
        <div className="p-3.5 rounded-xl bg-sky-50/40 dark:bg-sky-950/20 border border-sky-200/70 dark:border-sky-900/50">
          <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Route / Travel Purpose (Optional)
          </label>
          <input
            type="text"
            value={travelRoute}
            onChange={(e) => setTravelRoute(e.target.value)}
            placeholder="e.g. Office Metro, Uber to Station, Petrol"
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-sky-500"
          />
        </div>
      );
    }

    if (expenseSubcategory === 'shopping') {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-purple-50/40 dark:bg-purple-950/20 border border-purple-200/70 dark:border-purple-900/50">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Item Bought (Optional)
            </label>
            <input
              type="text"
              value={shopItem}
              onChange={(e) => setShopItem(e.target.value)}
              placeholder="e.g. Shoes, Earphones, Shirt"
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Store / Platform (Optional)
            </label>
            <input
              type="text"
              value={shopStore}
              onChange={(e) => setShopStore(e.target.value)}
              placeholder="e.g. Amazon, Flipkart, Local Mall"
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-purple-500"
            />
          </div>
        </div>
      );
    }

    if (expenseSubcategory === 'bills' || expenseSubcategory === 'emi_loan') {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/70">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {expenseSubcategory === 'emi_loan' ? 'Loan / EMI Name' : 'Bill Name'} (Optional)
            </label>
            <input
              type="text"
              value={billName}
              onChange={(e) => setBillName(e.target.value)}
              placeholder={expenseSubcategory === 'emi_loan' ? 'e.g. Bike EMI, Phone EMI' : 'e.g. Jio Recharge, WiFi Bill'}
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-slate-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Provider / Bank (Optional)
            </label>
            <input
              type="text"
              value={billProvider}
              onChange={(e) => setBillProvider(e.target.value)}
              placeholder="e.g. HDFC Bank, Airtel, Tata Play"
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-slate-500"
            />
          </div>
        </div>
      );
    }

    // Health, Education, Entertainment, Personal Care, Other / Custom
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/70">
        <div>
          <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Spent For (Optional)
          </label>
          <input
            type="text"
            value={spentFor}
            onChange={(e) => setSpentFor(e.target.value)}
            placeholder="e.g. Medicine, Book, Salon, Ticket"
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-slate-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Paid To / Store (Optional)
          </label>
          <input
            type="text"
            value={paidTo}
            onChange={(e) => setPaidTo(e.target.value)}
            placeholder="e.g. Apollo Pharmacy, Book Store"
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-slate-500"
          />
        </div>
      </div>
    );
  };

  const renderDateTimePaymentAttachment = () => (
    <>
      {/* Editable IST Date & Time */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            <span>Date (IST)</span>
          </label>
          <input
            type="date"
            value={txDate}
            onChange={(e) => setTxDate(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:border-slate-400"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>Time (IST)</span>
          </label>
          <input
            type="time"
            step="1"
            value={txTime}
            onChange={(e) => setTxTime(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:border-slate-400"
          />
        </div>
      </div>

      {/* Payment Method */}
      <div>
        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
          Payment Method
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {PAYMENT_OPTIONS.map((pm) => {
            const Icon = pm.icon;
            const active = paymentMethod === pm.id;
            return (
              <button
                key={pm.id}
                type="button"
                onClick={() => setPaymentMethod(pm.id)}
                className={`min-h-[38px] flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                  active
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                    : 'bg-white dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{pm.label}</span>
              </button>
            );
          })}
        </div>

        {(paymentMethod === 'upi' || paymentMethod === 'bank_transfer') && (
          <input
            type="text"
            maxLength={64}
            value={utrRef}
            onChange={(e) => setUtrRef(e.target.value)}
            placeholder={paymentMethod === 'upi' ? 'UTR / UPI Reference No. (Optional)' : 'Bank Transaction Reference (Optional)'}
            className="mt-2 w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-slate-400"
          />
        )}
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="tx-notes-input" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
          Notes <span className="text-slate-400 font-normal">(Optional)</span>
        </label>
        <input
          id="tx-notes-input"
          type="text"
          maxLength={200}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any extra remark or split details..."
          className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-slate-400"
        />
      </div>

      {/* Photo / Screenshot Attachment */}
      <div>
        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
          Receipt / Screenshot <span className="text-slate-400 font-normal">(Optional)</span>
        </label>

        {/* Hidden native inputs */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            void handleAttachmentFile(f);
          }}
        />
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            void handleAttachmentFile(f);
          }}
        />

        {attachment && isSafeAttachmentUrl(attachment.dataUrl) ? (
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
            <img
              src={attachment.dataUrl}
              alt="Receipt preview"
              className="w-14 h-14 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                {attachment.fileName}
              </p>
              <p className="text-[11px] text-slate-500">
                {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB · Verified image
              </p>
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Replace
                </button>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isProcessingAttachment}
              onClick={() => cameraInputRef.current?.click()}
              className="min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isProcessingAttachment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
              <span>Take Photo</span>
            </button>
            <button
              type="button"
              disabled={isProcessingAttachment}
              onClick={() => uploadInputRef.current?.click()}
              className="min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isProcessingAttachment ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
              <span>Upload Screenshot</span>
            </button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/65 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div
        className="w-full sm:max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh] sm:max-h-[90vh] animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-label="Add Transaction"
      >
        {saveSuccess ? (
          <div className="p-10 flex flex-col items-center justify-center text-center space-y-3 animate-pop">
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg ${
                saveSuccess.type === 'receive'
                  ? 'bg-emerald-600 text-white shadow-emerald-600/30'
                  : 'bg-rose-600 text-white shadow-rose-600/30'
              }`}
            >
              <CheckCircle2 className="w-9 h-9 stroke-[2.2]" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {saveSuccess.count > 1
                ? `${saveSuccess.count} ${saveSuccess.type === 'receive' ? 'Entries' : 'Expenses'} Saved!`
                : saveSuccess.type === 'receive'
                ? 'Money Received!'
                : 'Expense Saved!'}
            </h3>
            <p
              className={`text-2xl font-black tabular-nums ${
                saveSuccess.type === 'receive'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {saveSuccess.type === 'receive' ? '+' : '-'}₹{saveSuccess.amount.toLocaleString('en-IN')}
            </p>
          </div>
        ) : (
          <>
            {/* ================= STEP 1: TYPE SELECTION SCREEN ================= */}
            {mode === 'select' && (
              <div className="p-5 sm:p-7 space-y-5">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      + Add Transaction
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Select transaction type to continue
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    aria-label="Close modal"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3.5">
                  {/* Receive Money Card */}
                  <button
                    type="button"
                    onClick={() => setMode('receive')}
                    className="group relative flex items-center gap-4 p-4 sm:p-5 rounded-2xl bg-emerald-50/75 hover:bg-emerald-100/75 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 border-2 border-emerald-500/40 hover:border-emerald-600 dark:border-emerald-500/30 dark:hover:border-emerald-400 text-left transition-all active:scale-[0.99] cursor-pointer shadow-xs"
                  >
                    <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/30 shrink-0 group-hover:scale-105 transition-transform">
                      <ArrowDown className="w-7 h-7 stroke-[2.5]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                          Receive Money
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300">
                          Income (+)
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        Money received by you.
                      </p>
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium mt-1 truncate">
                        Salary · Business · Person · Freelance · Gift · Refund
                      </p>
                    </div>
                  </button>

                  {/* Expense Money Card */}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('expense');
                      setExpenseSubstep('main');
                    }}
                    className="group relative flex items-center gap-4 p-4 sm:p-5 rounded-2xl bg-rose-50/75 hover:bg-rose-100/75 dark:bg-rose-950/30 dark:hover:bg-rose-950/50 border-2 border-rose-500/40 hover:border-rose-600 dark:border-rose-500/30 dark:hover:border-rose-400 text-left transition-all active:scale-[0.99] cursor-pointer shadow-xs"
                  >
                    <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-md shadow-rose-600/30 shrink-0 group-hover:scale-105 transition-transform">
                      <ArrowUp className="w-7 h-7 stroke-[2.5]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                          Expense Money
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300">
                          Expense (-)
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        Money spent by you.
                      </p>
                      <p className="text-[11px] text-rose-700 dark:text-rose-400 font-medium mt-1 truncate">
                        Room · Food &amp; Dining · Other Expenses
                      </p>
                    </div>
                  </button>
                </div>

                {onOpenReceiptScanner && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenReceiptScanner();
                    }}
                    className="w-full min-h-[42px] flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    <ScanLine className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Scan Receipt Automatically (OCR)</span>
                  </button>
                )}
              </div>
            )}

            {/* ================= STEP 2A: RECEIVE MONEY FORM ================= */}
            {mode === 'receive' && (
              <form onSubmit={handleSubmit} className="flex flex-col h-full max-h-[94vh] sm:max-h-[90vh]">
                {/* Header */}
                <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleBackNavigation}
                    className="min-h-[36px] flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back</span>
                  </button>

                  <div className="flex p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-emerald-600 text-white shadow-xs cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Receive</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('expense');
                        setExpenseSubstep('main');
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Expense</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    aria-label="Close modal"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
                  {/* Recently Used Receive Shortcuts */}
                  {recentReceiveShortcuts.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                        <Clock className="w-3 h-3" />
                        <span>Recently used:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {recentReceiveShortcuts.map((sc) => (
                          <button
                            key={`${sc.subcategory}_${sc.label}`}
                            type="button"
                            onClick={() => {
                              setReceiveCategory(sc.subcategory === 'udhar_received' ? 'family' : sc.subcategory);
                              setReceiveLabel(sc.label);
                              setIsBorrowedUdhar(sc.subcategory === 'udhar_received');
                              setIsCustomReceive(false);
                            }}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:border-emerald-400 cursor-pointer"
                          >
                            {sc.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 7 Income Categories */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        Income Category
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsCustomReceive((p) => !p)}
                        className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        {isCustomReceive ? 'Use Standard List' : '+ Not Listed? Add Your Own'}
                      </button>
                    </div>

                    {isCustomReceive ? (
                      <div className="p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            maxLength={40}
                            value={customReceiveText}
                            onChange={(e) => setCustomReceiveText(e.target.value)}
                            placeholder="e.g. Rental, Dividend, Scholarship"
                            className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500"
                          />
                          <button
                            type="button"
                            onClick={handleConfirmCustomReceive}
                            className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                          >
                            Apply
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {CUSTOM_SUGGESTIONS.receive.map((sug) => (
                            <button
                              key={sug}
                              type="button"
                              onClick={() => {
                                setCustomReceiveText(sug);
                                setReceiveCategory('other_income');
                                setReceiveLabel(sug);
                              }}
                              className="px-2 py-0.5 rounded-md text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                            >
                              + {sug}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {RECEIVE_CATEGORIES.map((cat) => {
                          const Icon = cat.icon;
                          const active = !isCustomReceive && receiveCategory === cat.subcategory;
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => {
                                setReceiveCategory(cat.subcategory);
                                setReceiveLabel(cat.label);
                                if (cat.subcategory !== 'family') setIsBorrowedUdhar(false);
                              }}
                              className={`min-h-[42px] flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                                active
                                  ? 'bg-emerald-50 dark:bg-emerald-950/45 border-emerald-500 text-emerald-900 dark:text-emerald-200 ring-1 ring-emerald-500/30'
                                  : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-slate-300 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                                <Icon className="w-3.5 h-3.5" />
                              </div>
                              <span className="text-xs font-semibold truncate flex-1">{cat.label}</span>
                              {active && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Optional Borrowed (Udhar) checkbox for Received from Person */}
                    {receiveCategory === 'family' && !isCustomReceive && (
                      <label className="mt-2.5 flex items-center gap-2.5 p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-900/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isBorrowedUdhar}
                          onChange={(e) => setIsBorrowedUdhar(e.target.checked)}
                          className="w-4 h-4 rounded accent-amber-600"
                        />
                        <div className="text-xs">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            Is this borrowed money (Udhar)?
                          </span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Marks it as borrowed cash rather than earned income.
                          </p>
                        </div>
                      </label>
                    )}
                  </div>

                  {/* Amount */}
                  <div>
                    <label htmlFor="tx-receive-amount" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      Amount <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative flex items-center rounded-2xl border-2 border-emerald-500/40 focus-within:border-emerald-600 bg-emerald-50/20 dark:bg-emerald-950/10">
                      <span className="pl-4 text-2xl sm:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 select-none">₹</span>
                      <input
                        ref={amountInputRef}
                        id="tx-receive-amount"
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]*"
                        autoComplete="off"
                        value={amount}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9.]/g, '');
                          if (val.split('.').length > 2) return;
                          setAmount(val);
                        }}
                        placeholder="0"
                        className="w-full py-3 px-3 text-2xl sm:text-3xl font-bold bg-transparent text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 outline-none tabular-nums"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 no-scrollbar">
                      {[100, 500, 1000, 2000, 5000].map((delta) => (
                        <button
                          key={delta}
                          type="button"
                          onClick={() => handleQuickAddAmount(delta)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60 cursor-pointer shrink-0"
                        >
                          +₹{delta >= 1000 ? `${delta / 1000}k` : delta}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Description & Received From */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Description <span className="text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        maxLength={120}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="e.g. Monthly Salary, Project Milestone"
                        className="w-full py-2.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Received From <span className="text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        maxLength={80}
                        value={receivedFrom}
                        onChange={(e) => setReceivedFrom(e.target.value)}
                        placeholder="e.g. Employer, Client, Amit"
                        className="w-full py-2.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  {/* Optional Multi-Item Income Entries (max 3 total) */}
                  {receiveExtraItems.map((it, idx) => (
                    <div key={it.id} className="p-3 rounded-xl bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                          Item {idx + 2}
                        </span>
                        <button
                          type="button"
                          onClick={() => setReceiveExtraItems((prev) => prev.filter((x) => x.id !== it.id))}
                          className="flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:underline cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Remove Item</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={it.subcategory}
                          onChange={(e) => {
                            const found = RECEIVE_CATEGORIES.find((c) => c.subcategory === e.target.value);
                            setReceiveExtraItems((prev) =>
                              prev.map((x) =>
                                x.id === it.id
                                  ? { ...x, subcategory: e.target.value as TransactionSubcategory, label: found?.label || 'Other Income' }
                                  : x
                              )
                            );
                          }}
                          className="px-2.5 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                        >
                          {RECEIVE_CATEGORIES.map((c) => (
                            <option key={c.id} value={c.subcategory}>{c.label}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={it.amount}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9.]/g, '');
                            if (val.split('.').length > 2) return;
                            setReceiveExtraItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, amount: val } : x)));
                          }}
                          placeholder="Amount (₹)"
                          className="px-2.5 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100"
                        />
                      </div>
                      <input
                        type="text"
                        value={it.description}
                        onChange={(e) =>
                          setReceiveExtraItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, description: e.target.value } : x)))
                        }
                        placeholder="Item description (Optional)"
                        className="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  ))}

                  {receiveExtraItems.length < 2 && (
                    <button
                      type="button"
                      onClick={handleAddExtraReceiveItem}
                      className="w-full min-h-[38px] flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-dashed border-emerald-400/70 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Another Item ({receiveExtraItems.length + 1}/3)</span>
                    </button>
                  )}

                  {receiveExtraItems.length > 0 && (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Combined Total ({receiveExtraItems.length + 1} items)
                      </span>
                      <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        +₹{receiveBatchTotal.toLocaleString('en-IN')}
                      </span>
                    </div>
                  )}

                  {renderDateTimePaymentAttachment()}
                </div>

                <div className="p-4 bg-slate-50/90 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 shrink-0">
                  <button
                    type="submit"
                    disabled={isSubmitting || !amount || parseFloat(amount) <= 0}
                    className="w-full min-h-[46px] py-3 px-4 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>
                        {receiveExtraItems.length > 0
                          ? `Save ${receiveExtraItems.length + 1} Entries (+₹${receiveBatchTotal.toLocaleString('en-IN')})`
                          : 'Save Money'}
                      </span>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* ================= STEP 2B: EXPENSE MONEY (2-STEP CATEGORY HIERARCHY) ================= */}
            {mode === 'expense' && (
              <div className="flex flex-col h-full max-h-[94vh] sm:max-h-[90vh]">
                {/* Header */}
                <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleBackNavigation}
                    className="min-h-[36px] flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back</span>
                  </button>

                  <div className="flex p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80">
                    <button
                      type="button"
                      onClick={() => setMode('receive')}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Receive</span>
                    </button>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-rose-600 text-white shadow-xs cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Expense</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    aria-label="Close modal"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* LEVEL 1: 3 MAIN EXPENSE CATEGORY CARDS ONLY */}
                {expenseSubstep === 'main' && (
                  <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        Select Expense Category
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Choose a main category to see its subcategories
                      </p>
                    </div>

                    {recentExpenseShortcuts.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                          <Clock className="w-3 h-3" />
                          <span>Recently used:</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {recentExpenseShortcuts.map((sc) => (
                            <button
                              key={`${sc.mainCategory}_${sc.subcategory}_${sc.label}`}
                              type="button"
                              onClick={() => {
                                const mc: MainExpenseCategory =
                                  sc.mainCategory === 'room' || sc.mainCategory === 'food' ? sc.mainCategory : 'other';
                                setMainExpenseCat(mc);
                                setExpenseSubcategory(sc.subcategory);
                                setExpenseSubLabel(sc.label);
                                setIsCustomExpense(false);
                                resetContextualFields();
                                setExpenseSubstep('form');
                              }}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-50 dark:bg-rose-950/35 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:border-rose-400 cursor-pointer"
                            >
                              {sc.mainCategory.toUpperCase()} · {sc.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-3">
                      {EXPENSE_MAIN_CATEGORIES.map((cat) => {
                        const Icon = cat.icon;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => handleSelectExpenseMain(cat.id)}
                            className={`min-h-[72px] flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all active:scale-[0.99] cursor-pointer ${cat.colorClass}`}
                          >
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-md shrink-0 ${cat.iconBgClass}`}>
                              <Icon className="w-6 h-6 stroke-[2]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-base font-bold text-slate-900 dark:text-slate-100 block">
                                {cat.label}
                              </span>
                              <span className="text-xs text-slate-600 dark:text-slate-400 block mt-0.5">
                                {cat.subtitle}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* LEVEL 2: SUBCATEGORIES FOR CHOSEN MAIN CATEGORY */}
                {expenseSubstep === 'sub' && (
                  <div className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                          {EXPENSE_MAIN_CATEGORIES.find((c) => c.id === mainExpenseCat)?.label}
                        </span>
                        <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
                          Choose Subcategory
                        </h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpenseSubstep('main')}
                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Change Main Category
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      {EXPENSE_SUBCATEGORIES[mainExpenseCat].map((sub) => {
                        const Icon = sub.icon;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => handleSelectExpenseSub(sub.id, sub.label)}
                            className="min-h-[52px] flex items-center gap-2.5 p-3 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:border-rose-500 hover:bg-rose-50/40 dark:hover:bg-rose-950/25 text-left transition-all active:scale-[0.98] cursor-pointer"
                          >
                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0">
                              <Icon className="w-4 h-4" />
                            </div>
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight">
                              {sub.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* + Not Listed? Add Your Own */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                      {!isCustomExpense ? (
                        <button
                          type="button"
                          onClick={() => setIsCustomExpense(true)}
                          className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:border-rose-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>+ Not Listed? Add Your Own</span>
                        </button>
                      ) : (
                        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2.5">
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                            Custom Category Name
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              maxLength={40}
                              value={customExpenseText}
                              onChange={(e) => setCustomExpenseText(e.target.value)}
                              placeholder="e.g. WiFi Bill, Laundry, Gym..."
                              className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-rose-500"
                            />
                            <button
                              type="button"
                              onClick={handleConfirmCustomExpense}
                              className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                            >
                              Continue
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {CUSTOM_SUGGESTIONS[mainExpenseCat].map((sug) => (
                              <button
                                key={sug}
                                type="button"
                                onClick={() => setCustomExpenseText(sug)}
                                className="px-2 py-1 rounded-md text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                + {sug}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* LEVEL 3: EXPENSE ENTRY FORM (SINGLE OR 1–3 ITEMS) */}
                {expenseSubstep === 'form' && (
                  <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                    <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
                      {/* Selected Category Breadcrumb Pill */}
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/70 dark:border-rose-900/50">
                        <div className="text-xs font-semibold text-rose-900 dark:text-rose-200 truncate">
                          <span className="capitalize">{mainExpenseCat === 'other' ? 'Other Expenses' : mainExpenseCat === 'food' ? 'Food & Dining' : 'Room'}</span>
                          <span className="mx-1.5 text-rose-400">&gt;</span>
                          <span>{isCustomExpense && customExpenseText.trim() ? customExpenseText.trim() : expenseSubLabel}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpenseSubstep('sub')}
                          className="text-[11px] font-bold text-rose-700 dark:text-rose-300 hover:underline shrink-0 ml-2 cursor-pointer"
                        >
                          Change
                        </button>
                      </div>

                      {/* Primary Item Amount */}
                      <div>
                        <label htmlFor="tx-expense-amount" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                          {extraItems.length > 0 ? 'Item 1 Amount' : 'Amount'} <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative flex items-center rounded-2xl border-2 border-rose-500/40 focus-within:border-rose-600 bg-rose-50/20 dark:bg-rose-950/10">
                          <span className="pl-4 text-2xl sm:text-3xl font-extrabold text-rose-600 dark:text-rose-400 select-none">₹</span>
                          <input
                            ref={amountInputRef}
                            id="tx-expense-amount"
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9]*[.,]?[0-9]*"
                            autoComplete="off"
                            value={amount}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9.]/g, '');
                              if (val.split('.').length > 2) return;
                              setAmount(val);
                            }}
                            placeholder="0"
                            className="w-full py-3 px-3 text-2xl sm:text-3xl font-bold bg-transparent text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 outline-none tabular-nums"
                          />
                        </div>
                        <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 no-scrollbar">
                          {[50, 100, 200, 500, 1000].map((delta) => (
                            <button
                              key={delta}
                              type="button"
                              onClick={() => handleQuickAddAmount(delta)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60 cursor-pointer shrink-0"
                            >
                              +₹{delta >= 1000 ? `${delta / 1000}k` : delta}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Description */}
                      <div>
                        <label htmlFor="tx-expense-desc" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          Description / Title <span className="text-slate-400 font-normal">(Optional)</span>
                        </label>
                        <input
                          id="tx-expense-desc"
                          type="text"
                          maxLength={120}
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder={`What was this ${expenseSubLabel.toLowerCase()} for?`}
                          className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-rose-500"
                        />
                      </div>

                      {/* Contextual Subcategory-Specific Fields */}
                      {renderContextualFields()}

                      {/* Multi-Item Combined Entry (Items 2 & 3) */}
                      {extraItems.map((item, idx) => (
                        <div
                          key={item.id}
                          className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                              Item {idx + 2}
                            </span>
                            <button
                              type="button"
                              onClick={() => setExtraItems((prev) => prev.filter((x) => x.id !== item.id))}
                              className="flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Remove Item</span>
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={item.mainCategory}
                              onChange={(e) => {
                                const nextMain = e.target.value as MainExpenseCategory;
                                const firstSub = EXPENSE_SUBCATEGORIES[nextMain][0];
                                setExtraItems((prev) =>
                                  prev.map((x) =>
                                    x.id === item.id
                                      ? {
                                          ...x,
                                          mainCategory: nextMain,
                                          subcategory: firstSub.id,
                                          label: firstSub.label,
                                          customLabel: '',
                                        }
                                      : x
                                  )
                                );
                              }}
                              className="px-2.5 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                            >
                              <option value="room">Room</option>
                              <option value="food">Food &amp; Dining</option>
                              <option value="other">Other Expenses</option>
                            </select>

                            <select
                              value={item.subcategory}
                              onChange={(e) => {
                                const subId = e.target.value as TransactionSubcategory;
                                const match = EXPENSE_SUBCATEGORIES[item.mainCategory].find((s) => s.id === subId);
                                setExtraItems((prev) =>
                                  prev.map((x) =>
                                    x.id === item.id
                                      ? { ...x, subcategory: subId, label: match?.label || 'Other' }
                                      : x
                                  )
                                );
                              }}
                              className="px-2.5 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                            >
                              {EXPENSE_SUBCATEGORIES[item.mainCategory].map((s) => (
                                <option key={s.id} value={s.id}>{s.label}</option>
                              ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={item.description}
                              onChange={(e) =>
                                setExtraItems((prev) =>
                                  prev.map((x) => (x.id === item.id ? { ...x, description: e.target.value } : x))
                                )
                              }
                              placeholder="Item description (Optional)"
                              className="px-2.5 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                            />
                            <input
                              type="text"
                              inputMode="decimal"
                              value={item.amount}
                              onChange={(e) => {
                                const val = e.target.value.replace(/[^0-9.]/g, '');
                                if (val.split('.').length > 2) return;
                                setExtraItems((prev) =>
                                  prev.map((x) => (x.id === item.id ? { ...x, amount: val } : x))
                                );
                              }}
                              placeholder="Amount (₹)"
                              className="px-2.5 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100"
                            />
                          </div>
                        </div>
                      ))}

                      {extraItems.length < 2 && (
                        <button
                          type="button"
                          onClick={handleAddExtraExpenseItem}
                          className="w-full min-h-[40px] flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-dashed border-rose-300 dark:border-rose-800 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-50/60 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Another Item ({extraItems.length + 1}/3)</span>
                        </button>
                      )}

                      {extraItems.length > 0 && (
                        <div className="flex items-center justify-between p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            Combined Total ({extraItems.length + 1} items)
                          </span>
                          <span className="text-base font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                            -₹{expenseBatchTotal.toLocaleString('en-IN')}
                          </span>
                        </div>
                      )}

                      {renderDateTimePaymentAttachment()}
                    </div>

                    <div className="p-4 bg-slate-50/90 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 shrink-0">
                      <button
                        type="submit"
                        disabled={isSubmitting || !amount || parseFloat(amount) <= 0}
                        className="w-full min-h-[46px] py-3 px-4 rounded-xl font-bold text-sm bg-rose-600 hover:bg-rose-500 active:scale-[0.99] text-white shadow-md shadow-rose-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Saving Transaction...</span>
                          </>
                        ) : (
                          <span>
                            {extraItems.length > 0
                              ? `Save ${extraItems.length + 1} Transactions (₹${expenseBatchTotal.toLocaleString('en-IN')})`
                              : 'Save Transaction'}
                          </span>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
