import React from 'react';
import { useExpense } from '../../context/ExpenseContext';
import { StaleDataBanner } from './states/StaleDataBanner';

/**
 * Offline & Cloud Sync Status (States 11, 12, 31, 32 from Universal UI/UX Guide)
 * Shows persistent non-intrusive banner when offline, during network reconnection,
 * or when unsynced local records are queued for cloud upload.
 */
export const OfflineBanner: React.FC = () => {
  const {
    isOffline,
    isReconnecting,
    lastSyncedAt,
    pendingSyncCount,
    refreshTransactions,
    isSyncing,
  } = useExpense();

  return (
    <StaleDataBanner
      isOffline={isOffline}
      isReconnecting={isReconnecting}
      lastSyncedAt={lastSyncedAt}
      pendingSyncCount={pendingSyncCount}
      isRefreshing={isSyncing}
      onRefresh={refreshTransactions}
    />
  );
};
