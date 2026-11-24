import React, { useState, useEffect } from 'react';
import {
  Target,
  Plus,
  TrendingUp,
  Calendar,
  CheckCircle2,
  Trash2,
  Edit3,
  Sparkles,
  ArrowDownLeft,
  ArrowUpRight,
  X,
  Award,
  Zap,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { savingsGoalsApi, SavingsGoal } from '../../lib/financialFeaturesApi';
import { formatINR, formatDisplayDate, getCurrentISTDate } from '../../lib/dateUtils';

export const SavingsGoalsSection: React.FC = () => {
  const toast = useToast();

  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Add / Edit Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [title, setTitle] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [initialAmount, setInitialAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [category, setCategory] = useState('emergency');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Contribute / Withdraw Modal
  const [contributeGoal, setContributeGoal] = useState<SavingsGoal | null>(null);
  const [contributeAction, setContributeAction] = useState<'add' | 'withdraw'>('add');
  const [contributeAmount, setContributeAmount] = useState('');
  const [isProcessingContribute, setIsProcessingContribute] = useState(false);

  // Celebration Modal
  const [celebrationGoal, setCelebrationGoal] = useState<SavingsGoal | null>(null);

  const loadGoals = async () => {
    try {
      setIsLoading(true);
      const res = await savingsGoalsApi.getGoals();
      if (res.success) {
        setGoals(res.goals || []);
      }
    } catch (err: any) {
      toast.error('Could not load savings goals', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadGoals();
  }, []);

  // Nielsen Heuristic: User Control & Freedom — Escape key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (contributeGoal && !isProcessingContribute) setContributeGoal(null);
        else if (isModalOpen && !isSaving) setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, contributeGoal, isSaving, isProcessingContribute]);

  const totalSavedAllGoals = goals.reduce((sum, g) => sum + Number(g.current_amount), 0);
  const totalTargetAllGoals = goals.reduce((sum, g) => sum + Number(g.target_amount), 0);
  const completedGoalsCount = goals.filter((g) => g.is_completed || Number(g.current_amount) >= Number(g.target_amount)).length;

  const handleOpenAdd = () => {
    setEditingGoal(null);
    setTitle('');
    setTargetAmount('');
    setInitialAmount('0');
    setTargetDate('');
    setCategory('emergency');
    setNotes('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (goal: SavingsGoal) => {
    setEditingGoal(goal);
    setTitle(goal.title);
    setTargetAmount(String(goal.target_amount));
    setInitialAmount(String(goal.current_amount));
    setTargetDate(goal.target_date || '');
    setCategory(goal.category || 'emergency');
    setNotes(goal.notes || '');
    setIsModalOpen(true);
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    const numTarget = Number(targetAmount);
    const numCurrent = Number(initialAmount) || 0;

    if (!title.trim() || title.trim().length < 2) {
      toast.error('Validation Error', 'Please enter a goal title (min 2 characters).');
      return;
    }
    if (numTarget <= 0) {
      toast.error('Validation Error', 'Target amount must be greater than ₹0.');
      return;
    }

    try {
      setIsSaving(true);
      const res = await savingsGoalsApi.saveGoal({
        id: editingGoal?.id,
        title: title.trim(),
        target_amount: numTarget,
        current_amount: numCurrent,
        target_date: targetDate || null,
        category,
        notes: notes.trim() || null,
      });

      if (res.success) {
        toast.success('Savings Goal Saved', res.message);
        setIsModalOpen(false);
        loadGoals();
      }
    } catch (err: any) {
      toast.error('Failed to save goal', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleContributeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contributeGoal) return;
    const amountNum = Number(contributeAmount);
    if (!amountNum || amountNum <= 0) {
      toast.error('Validation Error', 'Please enter an amount greater than ₹0.');
      return;
    }

    try {
      setIsProcessingContribute(true);
      const res = await savingsGoalsApi.contributeToGoal(contributeGoal.id, amountNum, contributeAction);
      if (res.success) {
        toast.success(
          contributeAction === 'add' ? 'Savings Added' : 'Withdrawn',
          `₹${amountNum.toLocaleString('en-IN')} ${contributeAction === 'add' ? 'added to' : 'withdrawn from'} ${contributeGoal.title}.`
        );
        setContributeGoal(null);
        setContributeAmount('');
        loadGoals();

        // Trigger celebration if goal reached 100% on this contribution!
        if (contributeAction === 'add' && res.goal && Number(res.goal.current_amount) >= Number(res.goal.target_amount)) {
          setCelebrationGoal(res.goal);
        }
      }
    } catch (err: any) {
      toast.error('Action failed', err.message);
    } finally {
      setIsProcessingContribute(false);
    }
  };

  const handleDeleteGoal = async (id: string, goalTitle: string) => {
    if (!confirm(`Are you sure you want to delete savings goal "${goalTitle}"?`)) return;
    try {
      await savingsGoalsApi.deleteGoal(id);
      toast.success('Goal Deleted', `Goal "${goalTitle}" was removed.`);
      loadGoals();
    } catch (err: any) {
      toast.error('Failed to delete', err.message);
    }
  };

  return (
    <div className="space-y-6 pb-20 max-w-5xl mx-auto animate-fade-in">
      {/* Top Banner */}
      <div className="bg-gradient-to-br from-teal-600 via-emerald-700 to-emerald-950 rounded-3xl p-6 sm:p-8 text-white shadow-xl shadow-emerald-950/10 relative overflow-hidden">
        <div className="relative z-10 space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-bold tracking-wide uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Savings Goals · Financial Freedom</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-xs text-emerald-100 font-medium">Total Saved Across Goals</p>
              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight mt-0.5">
                {formatINR(totalSavedAllGoals)}
              </h1>
              <p className="text-xs text-emerald-200 mt-1">
                Target: {formatINR(totalTargetAllGoals)} · {completedGoalsCount} of {goals.length} Goals Completed
              </p>
            </div>

            <button
              onClick={handleOpenAdd}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-white text-emerald-800 hover:bg-emerald-50 active:scale-95 rounded-2xl text-xs sm:text-sm font-bold shadow-lg transition-all cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Create New Goal</span>
            </button>
          </div>
        </div>
      </div>

      {/* Goals List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              Active Savings Targets
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Contribute regularly to reach your financial milestones
            </p>
          </div>
        </div>

        {goals.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center mx-auto">
              <Target className="w-7 h-7" />
            </div>
            <h4 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              No savings goals yet
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Set a goal for emergency funds, travel, gadgets, or investments and watch your savings grow.
            </p>
            <button
              onClick={handleOpenAdd}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition-colors shadow-md cursor-pointer"
            >
              Create Your First Goal
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {goals.map((goal) => {
              const current = Number(goal.current_amount);
              const target = Number(goal.target_amount);
              const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
              const isCompleted = goal.is_completed || current >= target;

              return (
                <div
                  key={goal.id}
                  className={`bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border ${
                    isCompleted
                      ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/20 dark:bg-emerald-950/20'
                      : 'border-slate-200 dark:border-slate-800'
                  } shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-4`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                            isCompleted
                              ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600'
                              : 'bg-teal-50 dark:bg-teal-950 text-teal-600'
                          }`}
                        >
                          {isCompleted ? <Award className="w-5 h-5" /> : <Target className="w-5 h-5" />}
                        </div>
                        <div>
                          <h4 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                            {goal.title}
                          </h4>
                          <span className="text-[10px] uppercase font-bold text-slate-400">
                            {goal.category}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenEdit(goal)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Edit Goal"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteGoal(goal.id, goal.title)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Delete Goal"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Progress Info */}
                    <div>
                      <div className="flex items-baseline justify-between text-xs mb-1.5">
                        <span className="font-extrabold text-base text-emerald-600 dark:text-emerald-400 font-sans">
                          {formatINR(current)}
                        </span>
                        <span className="text-slate-400 text-xs">
                          Target: <strong className="text-slate-700 dark:text-slate-300">{formatINR(target)}</strong>
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isCompleted ? 'bg-emerald-500' : 'bg-gradient-to-r from-teal-500 to-emerald-500'
                          }`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5">
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">{percent}% saved</span>
                        <span>
                          {isCompleted
                            ? 'Goal Achieved! 🎉'
                            : `Left: ${formatINR(Math.max(0, target - current))}`}
                        </span>
                      </div>
                    </div>

                    {goal.target_date && (
                      <p className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Target Date: {formatDisplayDate(goal.target_date)}</span>
                      </p>
                    )}

                    {goal.notes && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl line-clamp-2">
                        {goal.notes}
                      </p>
                    )}
                  </div>

                  {/* Contribution Actions */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={() => {
                        setContributeGoal(goal);
                        setContributeAction('add');
                        setContributeAmount('');
                      }}
                      className="py-2 px-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" />
                      <span>+ Deposit</span>
                    </button>

                    <button
                      onClick={() => {
                        setContributeGoal(goal);
                        setContributeAction('withdraw');
                        setContributeAmount('');
                      }}
                      className="py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5 text-rose-500" />
                      <span>Withdraw</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Goal Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
                  <Target className="w-5 h-5" />
                </div>
                <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                  {editingGoal ? 'Edit Savings Goal' : 'Create Savings Goal'}
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveGoal} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Goal Title *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Emergency Fund, New Bike, Goa Trip"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-bold focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Target Amount (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    placeholder="e.g. 50000"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-bold focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Current Saved (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={initialAmount}
                    onChange={(e) => setInitialAmount(e.target.value)}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-bold focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Target Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Category Tag
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="emergency">Emergency Fund</option>
                    <option value="gadget">Gadget / Tech</option>
                    <option value="travel">Travel / Holiday</option>
                    <option value="vehicle">Bike / Car</option>
                    <option value="education">Education / Books</option>
                    <option value="investment">Investments</option>
                    <option value="other">Other Goal</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Notes & Motivation (Optional)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Save ₹2,000 every week from salary"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold shadow-md shadow-emerald-600/30 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Goal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Contribute / Withdraw Modal */}
      {contributeGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                {contributeAction === 'add' ? 'Add Deposit to Goal' : 'Withdraw from Goal'}
              </h3>
              <button
                onClick={() => setContributeGoal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-slate-900 dark:text-slate-100">{contributeGoal.title}</p>
              <p className="text-slate-500">
                Current: <strong className="text-emerald-600">{formatINR(contributeGoal.current_amount)}</strong> of {formatINR(contributeGoal.target_amount)}
              </p>
            </div>

            <form onSubmit={handleContributeSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Amount to {contributeAction === 'add' ? 'Deposit' : 'Withdraw'} (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  autoFocus
                  value={contributeAmount}
                  onChange={(e) => setContributeAmount(e.target.value)}
                  placeholder="e.g. 1000"
                  className="w-full px-3.5 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-base font-extrabold focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setContributeGoal(null)}
                  className="px-4 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessingContribute}
                  className={`px-5 py-2.5 rounded-xl text-white font-bold shadow-md transition-all cursor-pointer ${
                    contributeAction === 'add'
                      ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30'
                      : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/30'
                  }`}
                >
                  {isProcessingContribute ? 'Processing...' : contributeAction === 'add' ? 'Confirm Deposit' : 'Confirm Withdraw'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Goal Celebration Modal */}
      {celebrationGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-sm bg-gradient-to-br from-emerald-600 via-teal-700 to-emerald-900 text-white rounded-3xl p-7 shadow-2xl text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-white/20 text-amber-300 flex items-center justify-center mx-auto text-3xl animate-bounce">
              🏆
            </div>
            <div>
              <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-white/20 tracking-wider">
                Goal Achieved!
              </span>
              <h3 className="text-xl font-extrabold mt-2">
                Congratulations!
              </h3>
              <p className="text-xs text-emerald-100 mt-1">
                You have reached 100% of your savings target for <strong>"{celebrationGoal.title}"</strong> ({formatINR(celebrationGoal.target_amount)})!
              </p>
            </div>

            <button
              onClick={() => setCelebrationGoal(null)}
              className="w-full py-3 bg-white text-emerald-900 rounded-2xl font-black text-xs shadow-lg hover:bg-emerald-50 active:scale-95 transition-all cursor-pointer"
            >
              Celebrate &amp; Continue 🎉
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
