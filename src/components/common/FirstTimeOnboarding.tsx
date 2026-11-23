import React, { useState } from 'react';
import { CheckCircle2, ArrowRight, X, ArrowDownLeft, Utensils, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useExpense } from '../../context/ExpenseContext';

interface FirstTimeOnboardingProps {
  onOpenAddModal: (category?: any, subcategory?: any) => void;
}

/**
 * First-Time User Onboarding Guide (State 24 from UI/UX Guide)
 * Shown on the Dashboard when user has 0 transactions recorded.
 * Guides user through 3 bite-sized activation steps with a skip option.
 */
export const FirstTimeOnboarding: React.FC<FirstTimeOnboardingProps> = ({ onOpenAddModal }) => {
  const { user } = useAuth();
  const { summary } = useExpense();
  const [isDismissed, setIsDismissed] = useState(() => {
    return localStorage.getItem('onboarding_dismissed_' + (user?.uid || 'guest')) === 'true';
  });

  // Only show if user has 0 total transactions
  if (summary.totalTransactionsCount > 0 || isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    if (user) {
      localStorage.setItem('onboarding_dismissed_' + user.uid, 'true');
    }
  };

  const steps = [
    {
      num: 1,
      title: 'Record Starting Balance / Received Money',
      desc: 'Add salary, freelancing earnings, business income, or family support.',
      category: 'home',
      subcategory: 'salary',
      icon: ArrowDownLeft,
    },
    {
      num: 2,
      title: 'Track Your First Expense',
      desc: 'Log room rent, groceries, food delivery, or tea & snacks.',
      category: 'food',
      subcategory: 'snacks',
      icon: Utensils,
    },
    {
      num: 3,
      title: 'Manage Udhar / Money Given',
      desc: 'Keep track of money lent to friends or received back.',
      category: 'people',
      subcategory: 'money_given',
      icon: Users,
    },
  ];

  return (
    <div className="bg-slate-900 rounded-2xl p-5 sm:p-6 text-white border border-slate-800 shadow-sm animate-fade-in space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <span>Setup guide</span>
          </span>
          <h3 className="text-lg sm:text-xl font-semibold mt-1 tracking-tight text-white">
            Getting started with your ledger
          </h3>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl">
            Complete these 3 simple steps to get complete control over your daily money, expenses, and Udhar records.
          </p>
        </div>

        <button
          onClick={handleDismiss}
          className="text-xs text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          title="Dismiss onboarding guide"
          aria-label="Dismiss onboarding guide"
        >
          <X className="w-4 h-4 stroke-[1.75]" />
        </button>
      </div>

      {/* 3 Steps */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mt-6">
        {steps.map((st) => {
          const Icon = st.icon;
          return (
            <div
              key={st.num}
              onClick={() => onOpenAddModal(st.category, st.subcategory)}
              className="group p-4 bg-white/10 hover:bg-white/15 backdrop-blur-md rounded-2xl border border-white/10 transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="w-6 h-6 rounded-full bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center">
                    {st.num}
                  </span>
                  <div className="p-1.5 rounded-xl bg-white/10 text-emerald-300 group-hover:scale-110 transition-transform">
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
                <h4 className="font-bold text-sm text-white group-hover:text-emerald-200 transition-colors">
                  {st.title}
                </h4>
                <p className="text-xs text-emerald-100/80 mt-1 leading-relaxed">
                  {st.desc}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-white/10">
                <div className="w-full py-2 px-3 bg-white/15 hover:bg-white/25 rounded-xl font-medium text-xs text-white transition-colors flex items-center justify-between">
                  <span>Start Step {st.num}</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Guidance */}
      <div className="mt-6 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
        <p className="text-xs text-emerald-100/80">
          Tip: Setting your starting balance gives you accurate net calculations across all sections.
        </p>
        <button
          onClick={() => onOpenAddModal('home', 'salary')}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-xl transition-colors cursor-pointer inline-flex items-center gap-1.5 shrink-0"
        >
          <span>Start with Step 1</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
