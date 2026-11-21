import React, { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, CloudCheck, CloudOff, AlertCircle } from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';

/**
 * Offline & Cloud Sync Status (States 11, 12, 32 from UI/UX Guide)
 * Shows persistent non-intrusive banner when offline, reassuring that cached records are safe,
 * and provides one-tap reconnection.
 */
export const OfflineBanner: React.FC = () => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const { refreshTransactions, isSyncing } = useExpense();

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setIsReconnecting(true);
      refreshTransactions().finally(() => setIsReconnecting(false));
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refreshTransactions]);

  const handleRetry = async () => {
    setIsReconnecting(true);
    try {
      await refreshTransactions();
    } finally {
      setIsReconnecting(false);
    }
  };

  if (isOnline && !isReconnecting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full py-2 px-4 text-xs font-semibold flex items-center justify-between transition-colors z-40 ${
        !isOnline
          ? 'bg-amber-500 text-slate-950 border-b border-amber-600 shadow-sm'
          : 'bg-emerald-600 text-white border-b border-emerald-700'
      }`}
    >
      <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
        {!isOnline ? (
          <>
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              You are offline. Showing saved local copy. Your drafts and records are safe and will sync once reconnected.
            </span>
          </>
        ) : (
          <>
            <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            <span>Connection restored. Syncing latest records with cloud...</span>
          </>
        )}

        <button
          onClick={handleRetry}
          disabled={isReconnecting}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20 active:scale-95 rounded-lg text-xs font-bold transition-all cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-3 h-3 ${isReconnecting ? 'animate-spin' : ''}`} />
          <span>{isReconnecting ? 'Reconnecting...' : 'Retry Now'}</span>
        </button>
      </div>
    </div>
  );
};
