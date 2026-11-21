import React, { useState } from 'react';
import {
  Utensils,
  PlusCircle,
  Search,
  Filter,
  Calendar,
  Clock,
  Trash2,
  Edit3,
  MapPin,
  Tag,
  Coffee,
  Sparkles,
  TrendingDown,
  ShoppingBag,
} from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { StatCard } from '../common/StatCard';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { EditTransactionModal } from '../modals/EditTransactionModal';
import { Transaction, SortOrder, TransactionSubcategory } from '../../types';
import {
  formatINR,
  formatDisplayDate,
  formatDisplayTime,
  getCurrentISTDate,
  getCurrentISTTime,
} from '../../lib/dateUtils';

interface FoodSectionProps {
  onOpenAddModal: (category?: any, subcategory?: any) => void;
}

const FOOD_SUBCATEGORIES = [
  { id: 'all', label: 'All Food' },
  { id: 'restaurant', label: 'Restaurant / Dining' },
  { id: 'snacks', label: 'Fast Food & Snacks' },
  { id: 'beverages', label: 'Chai & Drinks' },
  { id: 'delivery', label: 'Swiggy / Zomato' },
  { id: 'mess_tiffin', label: 'Mess & Tiffin' },
  { id: 'other_food', label: 'Other Food' },
];

const POPULAR_FOOD_ITEMS = [
  'Evening Chai & Samosa',
  'Pizza',
  'Burger & Fries',
  'Lunch Thali',
  'Biryani',
  'Morning Tea & Poha',
  'Coffee',
  'Cold Drink / Juice',
  'Dosa / South Indian',
  'Street Food / Chaat',
  'Monthly Mess Fee',
];

const POPULAR_FOOD_PLACES = [
  'Swiggy',
  'Zomato',
  'Office Canteen',
  'Local Dhaba',
  'Cafe / CCD',
  'Street Stall / Tapri',
  'Hostel Mess',
  'Haldiram',
];

export const FoodSection: React.FC<FoodSectionProps> = ({ onOpenAddModal }) => {
  const { transactions, summary, addTransaction, deleteTransaction, restoreTransaction } = useExpense();
  const toast = useToast();

  // In-line Add Form state
  const [amount, setAmount] = useState('');
  const [subcategory, setSubcategory] = useState<string>('snacks');
  const [foodItem, setFoodItem] = useState('');
  const [place, setPlace] = useState('');
  const [date, setDate] = useState(getCurrentISTDate());
  const [time, setTime] = useState(getCurrentISTTime());
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search and filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubcategoryFilter, setSelectedSubcategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState<SortOrder>('newest');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Modals
  const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filter only food transactions
  const foodTransactions = transactions.filter((t) => t.category === 'food');

  // Breakdown metrics
  const totalFoodSpent = summary.totalFoodExpenses || 0;
  const restaurantSpent = foodTransactions
    .filter((t) => t.subcategory === 'restaurant')
    .reduce((acc, t) => acc + t.amount, 0);
  const snacksSpent = foodTransactions
    .filter((t) => t.subcategory === 'snacks')
    .reduce((acc, t) => acc + t.amount, 0);
  const drinksSpent = foodTransactions
    .filter((t) => t.subcategory === 'beverages')
    .reduce((acc, t) => acc + t.amount, 0);
  const deliverySpent = foodTransactions
    .filter((t) => t.subcategory === 'delivery')
    .reduce((acc, t) => acc + t.amount, 0);
  const messSpent = foodTransactions
    .filter((t) => t.subcategory === 'mess_tiffin')
    .reduce((acc, t) => acc + t.amount, 0);

  // Filtered and sorted list
  const filteredFoodTransactions = foodTransactions
    .filter((tx) => {
      if (selectedSubcategoryFilter !== 'all' && tx.subcategory !== selectedSubcategoryFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match =
          tx.title.toLowerCase().includes(q) ||
          (tx.description && tx.description.toLowerCase().includes(q)) ||
          (tx.notes && tx.notes.toLowerCase().includes(q)) ||
          (tx.metadata?.food_item && tx.metadata.food_item.toLowerCase().includes(q)) ||
          (tx.metadata?.restaurant_name && tx.metadata.restaurant_name.toLowerCase().includes(q)) ||
          (tx.metadata?.platform && tx.metadata.platform.toLowerCase().includes(q)) ||
          String(tx.amount).includes(q);
        if (!match) return false;
      }

      if (startDate && tx.transaction_date < startDate) return false;
      if (endDate && tx.transaction_date > endDate) return false;

      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'newest') return (b.transaction_date + b.transaction_time).localeCompare(a.transaction_date + a.transaction_time);
      if (sortBy === 'oldest') return (a.transaction_date + a.transaction_time).localeCompare(b.transaction_date + b.transaction_time);
      if (sortBy === 'highest_amount') return b.amount - a.amount;
      if (sortBy === 'lowest_amount') return a.amount - b.amount;
      return 0;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return toast.error('Invalid Amount', 'Please enter a valid amount.');
    if (!foodItem.trim()) return toast.error('Food Item Required', 'What food or drink was ordered/purchased?');

    const cleanPlace = place.trim();
    const cleanItem = foodItem.trim();
    const finalDescription = cleanPlace ? `${cleanItem} at ${cleanPlace}` : cleanItem;

    try {
      setIsSubmitting(true);
      await addTransaction({
        category: 'food',
        subcategory,
        transaction_type: 'expense',
        amount: amt,
        title: cleanItem,
        description: finalDescription,
        transaction_date: date,
        transaction_time: time,
        notes: notes.trim() || undefined,
        metadata: {
          food_item: cleanItem,
          restaurant_name: cleanPlace,
          platform: cleanPlace,
        },
      });

      toast.success('Food Expense Added', `₹${amt.toLocaleString('en-IN')} recorded for ${cleanItem}.`);
      setAmount('');
      setFoodItem('');
      setPlace('');
      setNotes('');
      setDate(getCurrentISTDate());
      setTime(getCurrentISTTime());
    } catch (err: any) {
      toast.error('Failed to add expense', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!transactionToDelete) return;
    const target = transactionToDelete;
    try {
      setIsDeleting(true);
      await deleteTransaction(target.id);
      toast.showUndoToast(
        'Food Expense Moved to Recycle Bin',
        `"${target.title}" (₹${target.amount.toLocaleString('en-IN')}) was removed.`,
        async () => {
          await restoreTransaction(target.id);
          toast.success('Food Record Restored', `"${target.title}" restored.`);
        },
        6
      );
      setTransactionToDelete(null);
    } catch (err: any) {
      toast.error('Delete failed', err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const getSubcategoryBadge = (sub: string) => {
    switch (sub) {
      case 'restaurant':
        return { label: 'Dining', bg: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800' };
      case 'snacks':
        return { label: 'Fast Food', bg: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' };
      case 'beverages':
        return { label: 'Chai / Drinks', bg: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' };
      case 'delivery':
        return { label: 'Online Delivery', bg: 'bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800' };
      case 'mess_tiffin':
        return { label: 'Mess / Tiffin', bg: 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' };
      default:
        return { label: 'Food', bg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700' };
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-16 lg:pb-8">
      {/* Top Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Food & Dining"
          amount={totalFoodSpent}
          subtitle="All food, snacks, chai, online orders & mess"
          icon={Utensils}
          variant="expense"
          badge="Food & Diet"
        />

        <div className="sm:col-span-2 p-5 bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-yellow-500/10 dark:from-orange-950/30 dark:via-amber-950/30 dark:to-yellow-950/30 rounded-3xl border border-orange-200/60 dark:border-orange-900/40 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Utensils className="w-4 h-4 text-orange-600" />
                Food & Dining Expense Log
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
                Track daily food expenses: Swiggy/Zomato orders, evening snacks, tea/coffee, restaurant bills, and mess fees.
              </p>
            </div>
            <button
              onClick={() => onOpenAddModal('food')}
              className="px-3.5 py-2 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-600/20 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>+ Add Food Expense</span>
            </button>
          </div>

          {/* Quick Subcategory Spend Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4 pt-3 border-t border-orange-200/60 dark:border-orange-900/40 text-[11px]">
            <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-orange-200/40 dark:border-orange-900/40">
              <span className="text-slate-500 block">Dining Out</span>
              <span className="font-extrabold text-slate-900 dark:text-slate-100">{formatINR(restaurantSpent)}</span>
            </div>
            <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-orange-200/40 dark:border-orange-900/40">
              <span className="text-slate-500 block">Fast Food</span>
              <span className="font-extrabold text-slate-900 dark:text-slate-100">{formatINR(snacksSpent)}</span>
            </div>
            <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-orange-200/40 dark:border-orange-900/40">
              <span className="text-slate-500 block">Chai / Drinks</span>
              <span className="font-extrabold text-slate-900 dark:text-slate-100">{formatINR(drinksSpent)}</span>
            </div>
            <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-orange-200/40 dark:border-orange-900/40">
              <span className="text-slate-500 block">Delivery</span>
              <span className="font-extrabold text-slate-900 dark:text-slate-100">{formatINR(deliverySpent)}</span>
            </div>
            <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-orange-200/40 dark:border-orange-900/40 col-span-2 sm:col-span-1">
              <span className="text-slate-500 block">Mess / Tiffin</span>
              <span className="font-extrabold text-slate-900 dark:text-slate-100">{formatINR(messSpent)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* In-line Quick Add Food Form */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
        <div className="flex items-center gap-2 pb-3 mb-4 border-b border-slate-100 dark:border-slate-800">
          <Utensils className="w-4 h-4 text-orange-600" />
          <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100">
            Record Food or Drink Expense
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Subcategory Pills */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Select Food Type
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
              {[
                { id: 'snacks', label: 'Fast Food / Snacks' },
                { id: 'restaurant', label: 'Dining / Restaurant' },
                { id: 'beverages', label: 'Chai / Coffee' },
                { id: 'delivery', label: 'Delivery (Swiggy/Zomato)' },
                { id: 'mess_tiffin', label: 'Mess / Tiffin' },
                { id: 'other_food', label: 'Other Food' },
              ].map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setSubcategory(sub.id)}
                  className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer ${
                    subcategory === sub.id
                      ? 'bg-orange-600 text-white border-orange-600 shadow-md shadow-orange-600/20'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          </div>

          {/* Core inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Amount (₹ INR) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold">₹</span>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-3 py-2.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-bold focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

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
                className="w-full px-3 py-2.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-orange-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Restaurant / Platform / Location
              </label>
              <input
                type="text"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder="e.g. Swiggy, Zomato, Canteen, Dhaba"
                className="w-full px-3 py-2.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>

          {/* Quick Item Suggestion Chips */}
          <div>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-2">
              Quick Suggestions:
            </span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {POPULAR_FOOD_ITEMS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setFoodItem(item)}
                  className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-orange-50 dark:hover:bg-orange-950/40 text-slate-700 dark:text-slate-300 hover:text-orange-700 dark:hover:text-orange-300 rounded-lg text-[10px] font-medium border border-slate-200 dark:border-slate-700 cursor-pointer transition-colors"
                >
                  + {item}
                </button>
              ))}
            </div>
          </div>

          {/* Place Suggestion Chips */}
          <div>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-2">
              Popular Places:
            </span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {POPULAR_FOOD_PLACES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlace(p)}
                  className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-orange-50 dark:hover:bg-orange-950/40 text-slate-700 dark:text-slate-300 hover:text-orange-700 dark:hover:text-orange-300 rounded-lg text-[10px] font-medium border border-slate-200 dark:border-slate-700 cursor-pointer transition-colors"
                >
                  📍 {p}
                </button>
              ))}
            </div>
          </div>

          {/* Date, Time & Submit */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-600/20 transition-all flex items-center gap-1.5 cursor-pointer ml-auto"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Saving...' : 'Add Food Expense'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Filter and Transaction Ledger */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100">
              Food & Dining Transactions
            </h3>
            <p className="text-xs text-slate-500">
              Showing {filteredFoodTransactions.length} of {foodTransactions.length} records
            </p>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {FOOD_SUBCATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedSubcategoryFilter(cat.id)}
                className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  selectedSubcategoryFilter === cat.id
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search & Sort Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search food item, place, notes..."
              className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-2 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              title="Start Date"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-2 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              title="End Date"
            />
          </div>

          <div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOrder)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="highest_amount">Highest Amount</option>
              <option value="lowest_amount">Lowest Amount</option>
            </select>
          </div>
        </div>

        {/* Transaction Cards List */}
        {filteredFoodTransactions.length === 0 ? (
          <EmptyState
            isFiltered={searchQuery.trim().length > 0 || selectedSubcategoryFilter !== 'all' || Boolean(startDate) || Boolean(endDate)}
            searchQuery={searchQuery || (selectedSubcategoryFilter !== 'all' ? selectedSubcategoryFilter : undefined)}
            title="No Food Expenses Recorded Yet"
            description="Start tracking your daily meals, restaurant bills, evening chai, coffee, street snacks, and online deliveries!"
            actionLabel="+ Add Food Expense"
            onAction={() => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onClearFilters={() => {
              setSearchQuery('');
              setSelectedSubcategoryFilter('all');
              setStartDate('');
              setEndDate('');
            }}
            icon={Utensils}
          />
        ) : (
          <div className="space-y-2">
            {filteredFoodTransactions.map((tx) => {
              const badge = getSubcategoryBadge(tx.subcategory);
              return (
                <div
                  key={tx.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-950 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
                      <Utensils className="w-5 h-5" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                          {tx.title}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border uppercase ${badge.bg}`}>
                          {badge.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex-wrap">
                        {tx.description && tx.description !== tx.title && (
                          <span className="text-slate-600 dark:text-slate-300">
                            {tx.description}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          {formatDisplayDate(tx.transaction_date)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {formatDisplayTime(tx.transaction_time)}
                        </span>
                        {tx.notes && (
                          <span className="italic text-slate-400 text-[11px]">
                            "{tx.notes}"
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Amount & Actions */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                    <span className="font-extrabold text-base text-rose-600 dark:text-rose-400">
                      - {formatINR(tx.amount)}
                    </span>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setTransactionToEdit(tx)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 rounded-lg transition-colors cursor-pointer"
                        title="Edit Record"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setTransactionToDelete(tx)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950 rounded-lg transition-colors cursor-pointer"
                        title="Move to Recycle Bin"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {transactionToEdit && (
        <EditTransactionModal
          transaction={transactionToEdit}
          isOpen={Boolean(transactionToEdit)}
          onClose={() => setTransactionToEdit(null)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {transactionToDelete && (
        <ConfirmModal
          isOpen={Boolean(transactionToDelete)}
          title="Move Food Expense to Recycle Bin?"
          message={`Are you sure you want to delete "${transactionToDelete.title}" (₹${transactionToDelete.amount})? You can restore it later from the Recycle Bin.`}
          confirmLabel={isDeleting ? 'Deleting...' : 'Move to Recycle Bin'}
          cancelLabel="Cancel"
          isLoading={isDeleting}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setTransactionToDelete(null)}
        />
      )}
    </div>
  );
};
