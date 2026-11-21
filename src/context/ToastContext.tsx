import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X, RotateCcw } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'undo' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
  countdownSeconds?: number;
}

interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  action?: ToastAction;
  duration?: number;
}

interface ToastContextType {
  showToast: (title: string, message?: string, type?: ToastType, action?: ToastAction, duration?: number) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  showUndoToast: (title: string, message: string, onUndo: () => void, countdownSeconds?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Individual Toast Item with internal countdown timer for Undo State (Page 28 of UI/UX Guide)
const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(toast.action?.countdownSeconds || 6);

  useEffect(() => {
    if (!toast.action?.countdownSeconds) return;

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onDismiss(toast.id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [toast, onDismiss]);

  const handleActionClick = () => {
    if (toast.action) {
      toast.action.onClick();
      onDismiss(toast.id);
    }
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`pointer-events-auto flex items-start gap-3 p-4 rounded-2xl shadow-2xl border backdrop-blur-md transition-all duration-300 animate-slide-up ${
        toast.type === 'undo'
          ? 'bg-slate-900/95 dark:bg-slate-950/95 border-emerald-500/50 text-white shadow-emerald-950/30 ring-1 ring-emerald-500/30'
          : toast.type === 'success'
          ? 'bg-emerald-50/95 dark:bg-emerald-950/90 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100 shadow-emerald-900/10'
          : toast.type === 'error'
          ? 'bg-rose-50/95 dark:bg-rose-950/90 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-100 shadow-rose-900/10'
          : toast.type === 'warning'
          ? 'bg-amber-50/95 dark:bg-amber-950/90 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100 shadow-amber-900/10'
          : 'bg-slate-50/95 dark:bg-slate-900/90 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100'
      }`}
    >
      {toast.type === 'undo' && (
        <div className="p-1 bg-emerald-500/20 text-emerald-400 rounded-lg shrink-0 mt-0.5">
          <RotateCcw className="w-4 h-4 animate-spin-reverse" />
        </div>
      )}
      {toast.type === 'success' && (
        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
      )}
      {toast.type === 'error' && (
        <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
      )}
      {toast.type === 'warning' && (
        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      )}
      {toast.type === 'info' && (
        <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
      )}

      <div className="flex-1 text-xs sm:text-sm min-w-0">
        <p className="font-bold leading-snug">{toast.title}</p>
        {toast.message && (
          <p className="text-xs mt-0.5 opacity-90 line-clamp-2">{toast.message}</p>
        )}

        {/* Action Button (e.g. Undo State with countdown) */}
        {toast.action && (
          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={handleActionClick}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-extrabold text-xs rounded-xl shadow-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>
                {toast.action.label} ({secondsLeft}s)
              </span>
            </button>
          </div>
        )}
      </div>

      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (
      title: string,
      message?: string,
      type: ToastType = 'info',
      action?: ToastAction,
      duration: number = 4000
    ) => {
      const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      setToasts((prev) => [...prev, { id, type, title, message, action, duration }]);

      // Only auto-dismiss if not an action toast with custom countdown
      if (!action?.countdownSeconds) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast]
  );

  const success = useCallback((title: string, message?: string) => showToast(title, message, 'success'), [showToast]);
  const error = useCallback((title: string, message?: string) => showToast(title, message, 'error'), [showToast]);
  const info = useCallback((title: string, message?: string) => showToast(title, message, 'info'), [showToast]);
  const warning = useCallback((title: string, message?: string) => showToast(title, message, 'warning'), [showToast]);

  const showUndoToast = useCallback(
    (title: string, message: string, onUndo: () => void, countdownSeconds: number = 6) => {
      showToast(title, message, 'undo', { label: 'Undo', onClick: onUndo, countdownSeconds }, countdownSeconds * 1000);
    },
    [showToast]
  );

  return (
    <ToastContext.Provider value={{ showToast, success, error, info, warning, showUndoToast }}>
      {children}
      {/* Toast container floating bottom-right with high z-index */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
