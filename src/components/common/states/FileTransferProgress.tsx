import React from 'react';
import { UploadCloud, DownloadCloud, X, CheckCircle2, AlertCircle } from 'lucide-react';

export interface FileTransferProgressProps {
  isOpen: boolean;
  type: 'upload' | 'download';
  fileName: string;
  fileSizeStr?: string;
  progressPercent: number; // 0 to 100
  itemsProcessed?: number;
  totalItems?: number;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  errorMessage?: string;
  onCancel?: () => void;
  onClose?: () => void;
}

export const FileTransferProgress: React.FC<FileTransferProgressProps> = ({
  isOpen,
  type,
  fileName,
  fileSizeStr,
  progressPercent,
  itemsProcessed,
  totalItems,
  status,
  errorMessage,
  onCancel,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 overflow-hidden">
        {status !== 'active' && onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center gap-3.5 mb-4">
          <div className="p-3 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-2xl shrink-0">
            {type === 'upload' ? <UploadCloud className="w-6 h-6" /> : <DownloadCloud className="w-6 h-6" />}
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
              {type === 'upload' ? 'Importing Financial Records' : 'Exporting Financial Ledger'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">{fileName}</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5 my-4">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-600 dark:text-slate-400">
              {itemsProcessed !== undefined && totalItems !== undefined
                ? `${itemsProcessed} of ${totalItems} records`
                : fileSizeStr || `${progressPercent}%`}
            </span>
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">{progressPercent}%</span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                status === 'failed' ? 'bg-rose-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
            />
          </div>
        </div>

        {/* Status Messages */}
        {status === 'completed' && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Transfer finished successfully!</span>
          </div>
        )}

        {status === 'failed' && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 flex items-center gap-2 text-xs text-rose-800 dark:text-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage || 'File transfer failed.'}</span>
          </div>
        )}

        {/* Cancel Action */}
        {status === 'active' && onCancel && (
          <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950 rounded-xl transition-colors"
            >
              Cancel Transfer
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
