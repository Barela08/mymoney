import React from 'react';
import { ShieldAlert, ArrowLeft, Mail } from 'lucide-react';

export interface PermissionDeniedProps {
  requiredRole?: string;
  reason?: string;
  onGoHome?: () => void;
  adminContact?: string;
}

export const PermissionDeniedState: React.FC<PermissionDeniedProps> = ({
  requiredRole = 'Platform Administrator',
  reason = 'This section contains sensitive multi-user ledger settings and requires elevated administrator privileges.',
  onGoHome,
  adminContact = 'admin@mymoney.com',
}) => {
  return (
    <div
      role="alert"
      className="p-8 sm:p-12 text-center rounded-3xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 max-w-lg mx-auto my-8 backdrop-blur-sm"
    >
      <div className="p-4 bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 rounded-2xl w-fit mx-auto mb-4 shadow-sm">
        <ShieldAlert className="w-10 h-10" />
      </div>

      <span className="inline-block px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200 rounded-full mb-3">
        Access Restricted ({requiredRole})
      </span>

      <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
        Permission Denied
      </h3>

      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
        {reason}
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        {onGoHome && (
          <button
            type="button"
            onClick={onGoHome}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 font-bold text-xs sm:text-sm rounded-xl shadow-md transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Dashboard</span>
          </button>
        )}

        {adminContact && (
          <a
            href={`mailto:${adminContact}?subject=Access%20Request%20for%20My%20Money%20Admin`}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/60 dark:hover:bg-amber-900 text-amber-900 dark:text-amber-200 font-semibold text-xs sm:text-sm rounded-xl border border-amber-200 dark:border-amber-800 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none"
          >
            <Mail className="w-4 h-4" />
            <span>Contact Administrator</span>
          </a>
        )}
      </div>
    </div>
  );
};
