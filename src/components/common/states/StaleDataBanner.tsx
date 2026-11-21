import React from 'react';
import { WifiOff, RefreshCw, AlertTriangle, CloudOff } from 'lucide-react';

export interface StaleDataBannerProps {
  isOffline: boolean;
  isReconnecting?: boolean;
  lastSyncedAt?: string;
  onRefresh: () => void;
  isRefreshing?: boolean;
  pendingSyncCount?: number;
}

export const StaleDataBanner: React.FC<StaleDataBannerProps> = ({
  isOffline,
  isReconnecting = false,
  lastSyncedAt,
  onRefresh,
  isRefreshing = false,
  pendingSyncCount = 0,
}) => {
  if (!isOffline && !isReconnecting && pendingSyncCount === 0) return null;

  return (
    <aside
      aria-label="Network status and synchronization"
      className="sticky top-0 z-40 px-4 py-2 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-slate-950 font-bold text-xs shadow-md flex items-center justify-between border-b border-amber-600/50 animate-fade-in"
    >
      <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
        {isOffline ? (
          <WifiOff className="w-4 h-4 shrink-0 text-slate-950" />
        ) : isReconnecting ? (
          <RefreshCw className="w-4 h-4 shrink-0 text-slate-950 animate-spin" />
        ) : (
          <CloudOff className="w-4 h-4 shrink-0 text-slate-950" />
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <span>
            {isOffline
              ? 'Offline Mode: Displaying saved local cache.'
              : isReconnecting
              ? 'Network Reconnecting: Retrying connection to cloud...'
              : 'Pending Cloud Sync:'}
          </span>

          {pendingSyncCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-slate-950 text-amber-300 font-extrabold text-[10px]">
              {pendingSyncCount} record{pendingSyncCount > 1 ? 's' : ''} queued
            </span>
          )}

          {lastSyncedAt && (
            <span className="hidden sm:inline font-normal opacity-90">
              (Last synced at {lastSyncedAt})
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="ml-auto px-3 py-1 bg-slate-950 hover:bg-slate-900 active:scale-95 disabled:opacity-50 text-white font-bold text-[11px] rounded-lg shadow-sm transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
        >
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'Connecting...' : 'Reconnect Now'}</span>
        </button>
      </div>
    </aside>
  );
};
