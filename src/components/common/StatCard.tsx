import React from 'react';
import { LucideIcon } from 'lucide-react';
import { formatINR } from '../../lib/dateUtils';

interface StatCardProps {
  title: string;
  amount: number;
  subtitle?: string;
  icon: LucideIcon;
  variant: 'income' | 'expense' | 'balance' | 'neutral' | 'amber';
  badge?: string;
  onClick?: () => void;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  amount,
  subtitle,
  icon: Icon,
  variant,
  badge,
  onClick,
}) => {
  const styles = {
    income: {
      card: 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800/80 hover:border-emerald-500/30 dark:hover:border-emerald-500/30',
      iconBg: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-500/15',
      amount: 'text-emerald-600 dark:text-emerald-400',
      badge: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60',
    },
    expense: {
      card: 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800/80 hover:border-rose-500/30 dark:hover:border-rose-500/30',
      iconBg: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-500/15',
      amount: 'text-rose-600 dark:text-rose-400',
      badge: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60',
    },
    balance: {
      card: 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800/80 hover:border-teal-500/30 dark:hover:border-teal-500/30',
      iconBg: 'bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 border border-teal-500/15',
      amount: 'text-slate-900 dark:text-slate-100',
      badge: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60',
    },
    amber: {
      card: 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800/80 hover:border-amber-500/30 dark:hover:border-amber-500/30',
      iconBg: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-500/15',
      amount: 'text-amber-600 dark:text-amber-400',
      badge: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60',
    },
    neutral: {
      card: 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60',
      amount: 'text-slate-900 dark:text-slate-100',
      badge: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60',
    },
  }[variant];

  return (
    <div
      onClick={onClick}
      className={`relative p-5 rounded-2xl border transition-colors duration-150 ${styles.card} ${
        onClick ? 'cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/30 active:scale-[0.99]' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
            {title}
          </p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <h3 className={`text-2xl sm:text-3xl font-semibold tracking-tight font-sans tabular-nums ${styles.amount}`}>
              {formatINR(amount)}
            </h3>
          </div>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">{subtitle}</p>
          )}
        </div>

        <div className={`p-2.5 rounded-xl shrink-0 ${styles.iconBg}`}>
          <Icon className="w-5 h-5 stroke-[1.75]" />
        </div>
      </div>

      {badge && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
            {badge}
          </span>
        </div>
      )}
    </div>
  );
};
