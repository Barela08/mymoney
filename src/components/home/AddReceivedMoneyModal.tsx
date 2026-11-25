import React, { useState, useEffect } from 'react';
import {
  X,
  Calendar,
  Clock,
  ArrowDownLeft,
  ChevronDown,
  ChevronUp,
  Check,
  Sparkles,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import {
  RECEIVED_CATEGORIES,
  PAYMENT_METHODS,
  getReceivedCategoryConfig,
  classifyFinancialTransaction,
} from '../../lib/receivedMoneyCategories';
import { getCurrentISTDate, getCurrentISTTime, formatINR } from '../../lib/dateUtils';
import { TransactionSubcategory } from '../../types';

interface AddReceivedMoneyModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSubcategory?: TransactionSubcategory;
}

export const AddReceivedMoneyModal: React.FC<AddReceivedMoneyModalProps> = ({
  isOpen,
  onClose,
  initialSubcategory = 'salary',
}) => {
  const { addTransaction } = useExpense();
  const toast = useToast();

  const [amount, setAmount] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<TransactionSubcategory>(initialSubcategory);
  const [showAllCategories, setShowAllCategories] = useState<boolean>(false);
  const [source, setSource] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi' | 'bank_transfer' | 'card' | 'wallet' | 'other'>('upi');
  const [utrReference, setUtrReference] = useState<string>('');
  const [accountReference, setAccountReference] = useState<string>('');
  const [date, setDate] = useState<string>(getCurrentISTDate());
  const [time, setTime] = useState<string>(getCurrentISTTime());
  const [notes, setNotes] = useState<string>('');
  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Sync category config
  const currentCategoryConfig = getReceivedCategoryConfig(selectedCategory);

  useEffect(() => {
    if (isOpen) {
      setAmount('');
      setSelectedCategory(initialSubcategory || 'salary');
      setShowAllCategories(false);
      setSource('');
      setDescription('');
      setPaymentMethod('upi');
      setUtrReference('');
      setAccountReference('');
      setDate(getCurrentISTDate());
      setTime(getCurrentISTTime());
      setNotes('');
      setIsMoreOptionsOpen(false);
      setIsSubmitting(false);
    }
  }, [isOpen, initialSubcategory]);

  if (!isOpen) return null;

  const popularCategories = RECEIVED_CATEGORIES.filter((c) => c.isPopular);
  const moreCategories = RECEIVED_CATEGORIES.filter((c) => !c.isPopular);
  const displayedCategories = showAllCategories ? RECEIVED_CATEGORIES : popularCategories;

  const handleApplySuggestion = (text: string) => {
    setDescription(text);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      toast.error('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }

    const classification = classifyFinancialTransaction(selectedCategory);
    const finalTitle = description.trim() || `${currentCategoryConfig.label} Received`;
    const finalDescription = source.trim() ? `From: ${source.trim()}` : currentCategoryConfig.label;

    try {
      setIsSubmitting(true);
      await addTransaction({
        category: 'home', // Map to core received category for seamless data compatibility
        subcategory: selectedCategory,
        transaction_type: 'income',
        amount: numAmount,
        title: finalTitle,
        description: finalDescription,
        person_name: source.trim() || undefined,
        transaction_date: date,
        transaction_time: time,
        notes: notes.trim() || undefined,
        metadata: {
          received_from: source.trim() || undefined,
          payment_method: paymentMethod,
          utr: utrReference.trim() || undefined,
          account_reference: accountReference.trim() || undefined,
          financial_classification: classification,
        },
      });

      toast.success('Money Received Added', `Recorded ${formatINR(numAmount)} under ${currentCategoryConfig.label}.`);
      onClose();
    } catch (err: any) {
      toast.error('Failed to Record', err.message || 'Could not save received money entry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-received-money-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
    >
      <div
        className="w-full sm:max-w-lg bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animate-slide-up sm:animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/20">
              <ArrowDownLeft className="w-5 h-5 stroke-[2.25]" />
            </div>
            <div>
              <h2 id="add-received-money-title" className="text-base font-bold text-slate-900 dark:text-white">
                Add Received Money
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Record income, salary, business, gift, or loan
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* 1. Large Amount Input (Primary Focus) */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2">
              Amount Received <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-emerald-600 dark:text-emerald-400 select-none">
                ₹
              </span>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                autoFocus
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-11 pr-4 py-3.5 text-2xl sm:text-3xl font-black text-slate-900 dark:text-white bg-emerald-50/40 dark:bg-emerald-950/20 border-2 border-emerald-500/30 dark:border-emerald-500/30 rounded-2xl focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 placeholder-slate-300 dark:placeholder-slate-600 transition-all"
              />
            </div>
          </div>

          {/* 2. Category Selection Chips */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                Category <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowAllCategories(!showAllCategories)}
                className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>{showAllCategories ? 'Show Less' : `More Categories (${moreCategories.length})`}</span>
                {showAllCategories ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {displayedCategories.map((cat) => {
                const Icon = cat.icon;
                const isSelected = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? `${cat.color.bg} ${cat.color.border} ${cat.color.text} font-bold ring-2 ring-emerald-500/30 shadow-xs`
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium'
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected ? cat.color.iconBg : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                      }`}
                    >
                      <Icon className="w-4 h-4 stroke-[2]" />
                    </div>
                    <span className="text-xs truncate">{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Dynamic "Received From / Source" Field */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              {currentCategoryConfig.sourceField.label}{' '}
              <span className="text-[10px] text-slate-400 font-normal lowercase">(optional)</span>
            </label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={currentCategoryConfig.sourceField.placeholder}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all placeholder-slate-400"
            />
          </div>

          {/* 4. Dynamic "Description / Purpose" Field with Suggestions */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              {currentCategoryConfig.descriptionField.label}{' '}
              <span className="text-[10px] text-slate-400 font-normal lowercase">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={currentCategoryConfig.descriptionField.placeholder}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all placeholder-slate-400"
            />

            {/* Quick Suggestions */}
            {currentCategoryConfig.descriptionField.suggestions.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                <span className="text-[11px] text-slate-400 flex items-center gap-1 font-medium">
                  <Sparkles className="w-3 h-3 text-amber-500" /> Suggestions:
                </span>
                {currentCategoryConfig.descriptionField.suggestions.slice(0, 4).map((sugg) => (
                  <button
                    key={sugg}
                    type="button"
                    onClick={() => handleApplySuggestion(sugg)}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300 text-slate-600 dark:text-slate-400 transition-colors cursor-pointer border border-slate-200/60 dark:border-slate-700/60"
                  >
                    {sugg}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 5. Payment Method Selection Chips */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2">
              Payment Method
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {PAYMENT_METHODS.map((pm) => {
                const Icon = pm.icon;
                const isSelected = paymentMethod === pm.id;
                return (
                  <button
                    key={pm.id}
                    type="button"
                    onClick={() => setPaymentMethod(pm.id)}
                    className={`flex flex-col items-center justify-center p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold shadow-xs'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium'
                    }`}
                  >
                    <Icon className="w-4 h-4 mb-1" />
                    <span className="text-[11px] truncate w-full">{pm.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Conditional fields for UPI & Bank Transfer */}
            {paymentMethod === 'upi' && (
              <div className="mt-2.5 animate-fade-in">
                <input
                  type="text"
                  value={utrReference}
                  onChange={(e) => setUtrReference(e.target.value)}
                  placeholder="Optional UTR / UPI Transaction Reference (e.g. 41258900124)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}

            {paymentMethod === 'bank_transfer' && (
              <div className="mt-2.5 animate-fade-in">
                <input
                  type="text"
                  value={accountReference}
                  onChange={(e) => setAccountReference(e.target.value)}
                  placeholder="Optional Bank Account / Reference (e.g. HDFC Salary A/c - 8920)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}
          </div>

          {/* 6. More Options Accordion (Date, Time, Notes) */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setIsMoreOptionsOpen(!isMoreOptionsOpen)}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              <span>Date, Time & Notes</span>
              {isMoreOptionsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {isMoreOptionsOpen && (
              <div className="p-4 space-y-3 bg-white dark:bg-slate-900 animate-fade-in">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Date</label>
                    <div className="relative">
                      <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Time</label>
                    <div className="relative">
                      <Clock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Private Notes</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any additional notes or reminders..."
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <span>Recording...</span>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Save Received Money</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
