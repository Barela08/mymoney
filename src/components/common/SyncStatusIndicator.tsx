import React, { useState, useRef, useEffect } from 'react';
import { Cloud, CloudOff, RefreshCw, CheckCircle2, AlertCircle, WifiOff } from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';

interface SyncStatusIndicatorProps {
  compact?: boolean;
  className?: string;
}

export const SyncStatusIndicator: React.FC<SyncStatusIndicatorProps> = ({
  compact = false,
  className = '',
}) => {
  const {
    isOffline,
    isReconnecting,
    isSyncing,
    isSupabaseConnected,
    lastSyncedAt,
    pendingSyncCount,
    error,
    refreshTransactions,
  } = useExpense();

  const [isOpen, setIsOpen] = useState(false);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Escape key closes popover
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleManualSync = async () => {
    try {
      setIsManualSyncing(true);
      await refreshTransactions();
    } finally {
      setIsManualSyncing(false);
    }
  };

  // Determine current status configuration
  let statusText = 'Synced';
  let badgeColor = 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
  let dotColor = 'bg-emerald-500';
  let IconComponent = CheckCircle2;

  if (isOffline) {
    statusText = 'Offline';
    badgeColor = 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30';
    dotColor = 'bg-slate-400';
    IconComponent = WifiOff;
  } else if (isReconnecting || isSyncing || isManualSyncing) {
    statusText = 'Syncing...';
    badgeColor = 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30';
    dotColor = 'bg-blue-500 animate-pulse';
    IconComponent = RefreshCw;
  } else if (pendingSyncCount > 0) {
    statusText = `${pendingSyncCount} Pending`;
    badgeColor = 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30';
    dotColor = 'bg-amber-500';
    IconComponent = Cloud;
  } else if (error && !isSupabaseConnected) {
    statusText = 'Sync Issue';
    badgeColor = 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30';
    dotColor = 'bg-rose-500';
    IconComponent = AlertCircle;
  }

  return (
    <div className={`relative inline-block ${className}`} ref={popoverRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`System Status: ${statusText}. Click to view synchronization details`}
        aria-expanded={isOpen}
        className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${badgeColor}`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
        <IconComponent className={`w-3.5 h-3.5 shrink-0 ${isSyncing || isManualSyncing ? 'animate-spin' : ''}`} />
        {!compact && <span className="hidden sm:inline font-mono tracking-tight">{statusText}</span>}
      </button>

      {/* Sync Status Details Popover */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Cloud Synchronization Status"
          className="absolute right-0 mt-2 w-72 sm:w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-4 z-50 animate-fade-in text-xs"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h4 className="font-bold text-slate-900 dark:text-slate-100">System & Cloud Status</h4>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeColor}`}>
              {statusText}
            </span>
          </div>

          <div className="py-3 space-y-2.5 text-slate-600 dark:text-slate-300">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Network Connection:</span>
              <span className="font-medium">
                {isOffline ? (
                  <span className="text-rose-600 dark:text-rose-400 font-bold">Offline (Local cache)</span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">Online & Active</span>
                )}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Cloud Storage:</span>
              <span className="font-medium">
                {isSupabaseConnected ? (
                  <span className="text-emerald-600 dark:text-emerald-400">Connected (Supabase PG)</span>
                ) : isOffline ? (
                  <span className="text-slate-400">Disconnected (Offline)</span>
                ) : (
                  <span className="text-amber-500 font-semibold">Local Storage Fallback</span>
                )}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Pending Uploads:</span>
              <span className="font-medium font-mono">
                {pendingSyncCount > 0 ? (
                  <span className="text-amber-600 dark:text-amber-400 font-bold">{pendingSyncCount} record(s) queued</span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">0 queued (All synced)</span>
                )}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Last Successful Sync:</span>
              <span className="font-medium font-mono text-slate-700 dark:text-slate-200">
                {lastSyncedAt ? `${lastSyncedAt} IST` : 'Just now'}
              </span>
            </div>

            {error && (
              <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-[11px] leading-relaxed">
                <span className="font-bold">Sync notice:</span> {error}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-400">Realtime sync active</span>
            <button
              type="button"
              onClick={handleManualSync}
              disabled={isSyncing || isManualSyncing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 disabled:opacity-50 text-white font-bold rounded-xl transition-all cursor-pointer shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing || isManualSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing || isManualSyncing ? 'Syncing...' : 'Sync Now'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
