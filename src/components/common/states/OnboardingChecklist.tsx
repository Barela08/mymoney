import React from 'react';
import { CheckCircle2, Circle, PlusCircle, ArrowRight, X, Sparkles, Trophy } from 'lucide-react';
import { NavTab } from '../Sidebar';

export interface OnboardingChecklistProps {
  userName?: string;
  totalTransactionsCount: number;
  hasHomeIncome: boolean;
  hasDailyExpense: boolean;
  hasPeopleUdhar: boolean;
  onOpenAddModal: (category?: any) => void;
  onNavigate: (tab: NavTab) => void;
  onDismiss: () => void;
}

export const OnboardingChecklist: React.FC<OnboardingChecklistProps> = ({
  userName = 'Friend',
  totalTransactionsCount,
  hasHomeIncome,
  hasDailyExpense,
  hasPeopleUdhar,
  onOpenAddModal,
  onNavigate,
  onDismiss,
}) => {
  const steps = [
    {
      id: 'home_income',
      title: 'Record Starting Balance or Received Money',
      description: 'Add salary, business earnings, freelancing, or initial balance.',
      completed: hasHomeIncome,
      action: () => onOpenAddModal('home'),
      actionLabel: 'Add Received',
    },
    {
      id: 'daily_expense',
      title: 'Record Your First Daily Expense',
      description: 'Log a room bill, groceries, gas, tea/coffee or shopping.',
      completed: hasDailyExpense,
      action: () => onOpenAddModal('room'),
      actionLabel: 'Log Expense',
    },
    {
      id: 'people_udhar',
      title: 'Set Up People Ledger (Udhar Given / Taken)',
      description: 'Track money given to or borrowed from roommates and friends.',
      completed: hasPeopleUdhar,
      action: () => onOpenAddModal('people'),
      actionLabel: 'Track Udhar',
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const isAllComplete = completedCount === steps.length;

  return (
    <div className="relative p-5 sm:p-6 rounded-3xl border border-emerald-300 dark:border-emerald-800 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-cyan-500/10 backdrop-blur-md shadow-lg overflow-hidden">
      {/* Dismiss button */}
      <button
        type="button"
        onClick={onDismiss}
        className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        title="Dismiss Onboarding Checklist"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Header */}
      <div className="flex items-start gap-3 mb-4 pr-8">
        <div className="p-3 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 rounded-2xl shrink-0">
          {isAllComplete ? <Trophy className="w-6 h-6 text-amber-500" /> : <Sparkles className="w-6 h-6" />}
        </div>
        <div>
          <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>{isAllComplete ? `Congratulations, ${userName}! 🎉` : `Welcome to My Money, ${userName}!`}</span>
          </h3>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            {isAllComplete
              ? "You've successfully completed all setup steps. Your financial dashboard is fully primed and active!"
              : 'Complete these 3 quick steps to initialize your personal expense and cashflow manager.'}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
          <span className="text-slate-600 dark:text-slate-400">Setup Progress</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-bold">{completedCount} of 3 completed</span>
        </div>
        <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-500 rounded-full"
            style={{ width: `${(completedCount / 3) * 100}%` }}
          />
        </div>
      </div>

      {/* Steps List */}
      <div className="space-y-2.5">
        {steps.map((step, idx) => (
          <div
            key={step.id}
            className={`p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              step.completed
                ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/80'
                : 'bg-white/90 dark:bg-slate-900/90 border-slate-200 dark:border-slate-800 shadow-sm'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                {step.completed ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600" />
                )}
              </div>
              <div>
                <h4
                  className={`text-xs sm:text-sm font-bold ${
                    step.completed ? 'text-emerald-900 dark:text-emerald-200 line-through opacity-80' : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {idx + 1}. {step.title}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{step.description}</p>
              </div>
            </div>

            {!step.completed && (
              <button
                type="button"
                onClick={step.action}
                className="self-end sm:self-center shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>{step.actionLabel}</span>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
