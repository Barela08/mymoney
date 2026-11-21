import React, { useState } from 'react';
import { Sparkles, CheckCircle2, ArrowRight, X, Home, Utensils, Users } from 'lucide-react';
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
      title: 'Record Starting Balance / Home Money',
      desc: 'Add money received from parents, allowance, or salary in Home Section.',
      category: 'home',
      subcategory: 'received_home',
      icon: Home,
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
    <div className="relative bg-gradient-to-br from-emerald-600 via-teal-700 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl shadow-emerald-950/20 overflow-hidden animate-fade-in border border-emerald-500/30">
      {/* Background Glow */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-400/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/15 backdrop-blur-md rounded-full text-xs font-bold tracking-wider uppercase text-emerald-200">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Welcome Aboard</span>
          </span>
          <h3 className="text-xl sm:text-2xl font-black mt-2 tracking-tight">
            Welcome, {user?.displayName || 'Friend'}! 👋
          </h3>
          <p className="text-xs sm:text-sm text-emerald-100/90 mt-1 max-w-xl">
            Complete these 3 simple steps to get complete control over your daily money, expenses, and Udhar records.
          </p>
        </div>

        <button
          onClick={handleDismiss}
          className="text-xs text-emerald-200 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          title="Skip guide"
          aria-label="Skip guide"
        >
          <X className="w-5 h-5" />
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

              <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs font-bold text-emerald-300 group-hover:text-white transition-colors">
                <span>Start Step {st.num}</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom CTA & Skip */}
      <div className="mt-6 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
        <button
          onClick={() => onOpenAddModal('home', 'received_home')}
          className="px-5 py-2.5 bg-white text-emerald-950 hover:bg-emerald-50 active:scale-95 rounded-xl font-extrabold shadow-lg transition-all cursor-pointer inline-flex items-center gap-2"
        >
          <span>+ Add First Transaction</span>
          <ArrowRight className="w-4 h-4" />
        </button>

        <button
          onClick={handleDismiss}
          className="text-emerald-200 hover:text-white underline cursor-pointer"
        >
          Skip for now and explore freely
        </button>
      </div>
    </div>
  );
};
