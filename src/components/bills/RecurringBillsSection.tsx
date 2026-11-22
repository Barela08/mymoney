import React, { useState, useEffect } from 'react';
import {
  CalendarClock,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Trash2,
  Edit3,
  Sparkles,
  Wifi,
  Zap,
  Home,
  Tv,
  CreditCard,
  Bell,
  BellOff,
  Check,
  X,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { recurringBillsApi, RecurringBill } from '../../lib/financialFeaturesApi';
import { formatINR, formatDisplayDate, getCurrentISTDate } from '../../lib/dateUtils';

const BILL_CATEGORY_ICONS: Record<string, any> = {
  rent: Home,
  electricity: Zap,
  internet: Wifi,
  subscription: Tv,
  other: CreditCard,
};

export const RecurringBillsSection: React.FC = () => {
  const toast = useToast();

  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<RecurringBill | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('electricity');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [dueDay, setDueDay] = useState(1);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadBills = async () => {
    try {
      setIsLoading(true);
      const res = await recurringBillsApi.getBills();
      if (res.success) {
        setBills(res.bills || []);
      }
    } catch (err: any) {
      toast.error('Could not load recurring bills', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBills();
  }, []);

  const totalMonthlyBills = bills
    .filter((b) => b.is_active)
    .reduce((sum, b) => sum + Number(b.amount), 0);

  const currentYearMonth = getCurrentISTDate().slice(0, 7); // YYYY-MM
  const paidThisMonthCount = bills.filter(
    (b) => b.last_paid_date && b.last_paid_date.startsWith(currentYearMonth)
  ).length;

  const handleOpenAdd = () => {
    setEditingBill(null);
    setTitle('');
    setCategory('electricity');
    setAmount('');
    setFrequency('monthly');
    setDueDay(5);
    setReminderEnabled(true);
    setIsActive(true);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (bill: RecurringBill) => {
    setEditingBill(bill);
    setTitle(bill.title);
    setCategory(bill.category);
    setAmount(String(bill.amount));
    setFrequency(bill.frequency);
    setDueDay(bill.due_day);
    setReminderEnabled(bill.reminder_enabled);
    setIsActive(bill.is_active);
    setIsModalOpen(true);
  };

  const handleSaveBill = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = Number(amount);
    if (!title.trim() || title.trim().length < 2) {
      toast.error('Validation Error', 'Please enter a bill title.');
      return;
    }
    if (!numAmount || numAmount <= 0) {
      toast.error('Validation Error', 'Please enter an amount greater than ₹0.');
      return;
    }

    try {
      setIsSaving(true);
      const res = await recurringBillsApi.saveBill({
        id: editingBill?.id,
        title: title.trim(),
        category,
        amount: numAmount,
        frequency,
        due_day: dueDay,
        reminder_enabled: reminderEnabled,
        is_active: isActive,
      });

      if (res.success) {
        toast.success('Bill Saved', res.message);
        setIsModalOpen(false);
        loadBills();
      }
    } catch (err: any) {
      toast.error('Failed to save bill', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleMarkPaid = async (bill: RecurringBill) => {
    try {
      const today = getCurrentISTDate();
      const res = await recurringBillsApi.markBillPaid(bill.id, today);
      if (res.success) {
        toast.success('Bill Paid', `"${bill.title}" marked as paid for this month.`);
        loadBills();
      }
    } catch (err: any) {
      toast.error('Could not mark as paid', err.message);
    }
  };

  const handleDeleteBill = async (id: string, billTitle: string) => {
    if (!confirm(`Are you sure you want to delete recurring bill "${billTitle}"?`)) return;
    try {
      await recurringBillsApi.deleteBill(id);
      toast.success('Bill Removed', `"${billTitle}" deleted.`);
      loadBills();
    } catch (err: any) {
      toast.error('Failed to delete', err.message);
    }
  };

  return (
    <div className="space-y-6 pb-20 max-w-5xl mx-auto animate-fade-in">
      {/* Top Banner */}
      <div className="bg-gradient-to-br from-indigo-700 via-blue-800 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl shadow-blue-950/10 relative overflow-hidden">
        <div className="relative z-10 space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-bold tracking-wide uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Recurring Bills &amp; Subscriptions</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-xs text-blue-100 font-medium">Estimated Monthly Fixed Bills</p>
              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight mt-0.5">
                {formatINR(totalMonthlyBills)}
              </h1>
              <p className="text-xs text-blue-200 mt-1">
                {paidThisMonthCount} of {bills.length} Bills Paid This Cycle
              </p>
            </div>

            <button
              onClick={handleOpenAdd}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-white text-indigo-900 hover:bg-blue-50 active:scale-95 rounded-2xl text-xs sm:text-sm font-bold shadow-lg transition-all cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Add Recurring Bill</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bills List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              Your Scheduled Bills
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Never miss a rent, electricity, WiFi, or subscription payment
            </p>
          </div>
        </div>

        {bills.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-950 text-indigo-600 flex items-center justify-center mx-auto">
              <CalendarClock className="w-7 h-7" />
            </div>
            <h4 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              No recurring bills configured
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Add your room rent, power bill, mobile recharge, and subscriptions to track due dates easily.
            </p>
            <button
              onClick={handleOpenAdd}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition-colors shadow-md cursor-pointer"
            >
              Add First Recurring Bill
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bills.map((bill) => {
              const Icon = BILL_CATEGORY_ICONS[bill.category] || CreditCard;
              const isPaid = bill.last_paid_date && bill.last_paid_date.startsWith(currentYearMonth);

              return (
                <div
                  key={bill.id}
                  className={`bg-white dark:bg-slate-900 rounded-3xl p-5 border ${
                    isPaid
                      ? 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/10'
                      : 'border-slate-200 dark:border-slate-800'
                  } shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-4`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                            {bill.title}
                          </h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                              {bill.category}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              Due: Day {bill.due_day} of every month
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenEdit(bill)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Edit Bill"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteBill(bill.id, bill.title)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Delete Bill"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40">
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                          Amount Payable
                        </span>
                        <span className="text-lg font-black text-slate-900 dark:text-slate-100 font-sans">
                          {formatINR(bill.amount)}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                          Status This Month
                        </span>
                        {isPaid ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Paid ({formatDisplayDate(bill.last_paid_date!)})</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Unpaid</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                    <span className="text-slate-400 flex items-center gap-1 text-[11px]">
                      {bill.reminder_enabled ? (
                        <>
                          <Bell className="w-3.5 h-3.5 text-emerald-500" /> Reminder On
                        </>
                      ) : (
                        <>
                          <BellOff className="w-3.5 h-3.5 text-slate-400" /> Reminder Off
                        </>
                      )}
                    </span>

                    {!isPaid ? (
                      <button
                        onClick={() => handleMarkPaid(bill)}
                        className="py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold transition-all shadow-sm shadow-emerald-600/30 flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Mark as Paid</span>
                      </button>
                    ) : (
                      <span className="text-[11px] font-bold text-emerald-600">
                        Cleared for this cycle ✓
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Bill Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 flex items-center justify-center">
                  <CalendarClock className="w-5 h-5" />
                </div>
                <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                  {editingBill ? 'Edit Recurring Bill' : 'Add Recurring Bill'}
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBill} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Bill Title *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Room Rent, Electricity, Jio Fiber, Netflix"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-bold focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-medium focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="rent">Rent (कमरे का किराया)</option>
                    <option value="electricity">Electricity (बिजली बिल)</option>
                    <option value="internet">Internet / WiFi</option>
                    <option value="subscription">Subscriptions / OTT</option>
                    <option value="other">Other Recurring Bill</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Amount (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 2500"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-bold focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Due Day of Month (1–31)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    required
                    value={dueDay}
                    onChange={(e) => setDueDay(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-medium focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Frequency
                  </label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-medium focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reminderEnabled}
                    onChange={(e) => setReminderEnabled(e.target.checked)}
                    className="rounded accent-indigo-600"
                  />
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Send reminder notifications
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold shadow-md shadow-indigo-600/30 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Bill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
