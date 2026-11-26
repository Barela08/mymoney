import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useAuth } from './AuthContext';
import { useExpense } from './ExpenseContext';
import { useToast } from './ToastContext';
import {
  getDefaultDetectionSettings,
  parseUpiNotification,
  deduplicateDetectedTransaction,
  mapUpiCategoryToExpensePayload,
  type DetectedTransaction,
  type DetectionRuntimePlatform,
  type ExpenseDetectionSettings,
  type NotificationAccessStatus,
  type RawNotificationInput,
  type UpiExpenseCategoryId,
} from '../lib/upiDetectionEngine';
import {
  detectRuntimePlatform,
  verifyNotificationAccessStatus,
  openAndroidNotificationSettings,
  syncConfigToNativeBridge,
  drainNativePendingQueue,
  acknowledgeNativeQueueItem,
  subscribeToAppResume,
} from '../lib/upiNativeBridge';
import {
  upiDetectionApi,
  loadOfflineNotificationQueue,
  saveOfflineNotificationQueue,
  enqueueOfflineNotification,
} from '../lib/upiDetectionApi';

const SETTINGS_CACHE_PREFIX = 'mmm_upi_settings_v1_';
const DETECTED_CACHE_PREFIX = 'mmm_upi_detected_v1_';
const ONBOARDING_DISMISSED_PREFIX = 'mmm_upi_onboarding_seen_v1_';

interface UpiDetectionContextValue {
  platform: DetectionRuntimePlatform;
  permissionStatus: NotificationAccessStatus;
  serviceStatus: 'running' | 'paused' | 'stopped' | 'unavailable';
  settings: ExpenseDetectionSettings;
  pendingTransactions: DetectedTransaction[];
  categorizedTransactions: DetectedTransaction[];
  dismissedTransactions: DetectedTransaction[];
  activePopupTransaction: DetectedTransaction | null;
  offlineQueueCount: number;
  isLoading: boolean;
  isOnboardingOpen: boolean;
  openOnboarding: () => void;
  closeOnboarding: (markCompleted?: boolean) => Promise<void>;
  refreshPermissionStatus: () => NotificationAccessStatus;
  openNotificationSettings: () => { opened: boolean; reason?: string };
  updateSettings: (patch: Partial<ExpenseDetectionSettings>) => Promise<void>;
  toggleDetectionEnabled: (enabled: boolean) => Promise<void>;
  toggleSupportedApp: (appId: string, enabled: boolean) => Promise<void>;
  toggleAutoPopup: (enabled: boolean) => Promise<void>;
  ingestNotification: (input: RawNotificationInput) => Promise<{
    accepted: boolean;
    deduplicated: boolean;
    rejectionReason?: string | null;
    transaction?: DetectedTransaction | null;
  }>;
  runSanitizedParserTest: (sample: RawNotificationInput) => Promise<{
    accepted: boolean;
    deduplicated: boolean;
    rejectionReason?: string | null;
    transaction?: DetectedTransaction | null;
  }>;
  openPopupForDetected: (tx: DetectedTransaction) => void;
  closeActivePopup: () => void;
  saveCategorizedExpense: (
    detected: DetectedTransaction,
    category: UpiExpenseCategoryId,
    description?: string
  ) => Promise<boolean>;
  dismissDetectedTransaction: (detectedId: string) => Promise<void>;
  remindLaterDetectedTransaction: (detectedId: string) => Promise<void>;
  editDetectedTransaction: (
    detected: DetectedTransaction,
    category: UpiExpenseCategoryId,
    description: string
  ) => Promise<boolean>;
  resetDetectionConfiguration: (clearHistory?: boolean) => Promise<void>;
  flushOfflineQueue: () => Promise<number>;
}

const UpiDetectionContext = createContext<UpiDetectionContextValue | undefined>(undefined);

function loadCachedJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveCachedJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage quota errors
  }
}

export const UpiDetectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { addTransaction, editTransaction, transactions } = useExpense();
  const toast = useToast();

  const [platform] = useState<DetectionRuntimePlatform>(() => detectRuntimePlatform());
  const [settings, setSettings] = useState<ExpenseDetectionSettings>(() =>
    getDefaultDetectionSettings()
  );
  const [permissionStatus, setPermissionStatus] = useState<NotificationAccessStatus>(() =>
    verifyNotificationAccessStatus(false)
  );
  const [detectedList, setDetectedList] = useState<DetectedTransaction[]>([]);
  const [activePopupTransaction, setActivePopupTransaction] = useState<DetectedTransaction | null>(
    null
  );
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const detectedRef = useRef(detectedList);
  detectedRef.current = detectedList;
  const prevPermissionRef = useRef<NotificationAccessStatus>(permissionStatus);

  const userId = user?.id || '';

  const refreshPermissionStatus = useCallback((): NotificationAccessStatus => {
    const next = verifyNotificationAccessStatus(settingsRef.current.enabled);
    const prev = prevPermissionRef.current;
    prevPermissionRef.current = next;
    setPermissionStatus(next);

    // If Android user revoked Notification Access in system settings, reflect immediately
    if (prev === 'granted' && (next === 'not_granted' || next === 'restricted')) {
      toast.warning(
        'Notification Access Revoked',
        'Automatic UPI detection paused because Android Notification Access was disabled in system settings.'
      );
    }
    return next;
  }, [toast]);

  // Persist local cache whenever detectedList changes
  useEffect(() => {
    if (!userId) return;
    saveCachedJson(`${DETECTED_CACHE_PREFIX}${userId}`, detectedList.slice(0, 150));
  }, [userId, detectedList]);

  const upsertLocalDetected = useCallback((tx: DetectedTransaction) => {
    setDetectedList((prev) => {
      const idx = prev.findIndex((item) => item.id === tx.id);
      if (idx >= 0) {
        const clone = [...prev];
        clone[idx] = tx;
        return clone;
      }
      return [tx, ...prev];
    });
  }, []);

  const ingestNotification = useCallback(
    async (input: RawNotificationInput) => {
      if (!userId) {
        return { accepted: false, deduplicated: false, rejectionReason: 'not_authenticated', transaction: null };
      }

      // Local parser validation first for instant UX & offline resilience
      const localParsed = parseUpiNotification(
        input,
        input.isTestSample ? undefined : settingsRef.current.supportedApps
      );

      if (!localParsed.accepted || !localParsed.transaction) {
        // Still attempt backend audit log when online (best-effort)
        if (typeof navigator === 'undefined' || navigator.onLine) {
          upiDetectionApi.ingestNotification(input).catch(() => {});
        }
        return {
          accepted: false,
          deduplicated: false,
          rejectionReason: localParsed.rejectionReason,
          transaction: null,
        };
      }

      // Try server ingestion when online; fall back cleanly to offline queue on network failure
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const res = await upiDetectionApi.ingestNotification(input);
          if (res.accepted && res.transaction) {
            upsertLocalDetected(res.transaction);
            setSettings((prev) => ({
              ...prev,
              lastDetectionAt: new Date().toISOString(),
            }));
            if (res.shouldShowPopup) {
              setActivePopupTransaction(res.transaction);
            }
            return {
              accepted: true,
              deduplicated: Boolean(res.deduplicated),
              rejectionReason: null,
              transaction: res.transaction,
            };
          }
          return {
            accepted: false,
            deduplicated: false,
            rejectionReason: res.rejectionReason || res.reason || 'rejected',
            transaction: null,
          };
        } catch {
          // Network or server unavailable -> preserve locally + enqueue for retry
          const queued = enqueueOfflineNotification(userId, input);
          setOfflineQueueCount(queued.length);
        }
      } else {
        const queued = enqueueOfflineNotification(userId, input);
        setOfflineQueueCount(queued.length);
      }

      // Offline local deduplication & immediate popup so user never loses a detected UPI payment
      const dedup = deduplicateDetectedTransaction(localParsed.transaction, detectedRef.current);
      upsertLocalDetected(dedup.mergedRecord);
      setSettings((prev) => ({
        ...prev,
        lastDetectionAt: new Date().toISOString(),
      }));

      if (!dedup.isDuplicate && (input.isTestSample || settingsRef.current.autoPopupEnabled)) {
        setActivePopupTransaction(dedup.mergedRecord);
      }

      return {
        accepted: true,
        deduplicated: dedup.isDuplicate,
        rejectionReason: null,
        transaction: dedup.mergedRecord,
      };
    },
    [userId, upsertLocalDetected]
  );

  const flushOfflineQueue = useCallback(async (): Promise<number> => {
    if (!userId || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0;
    const queue = loadOfflineNotificationQueue(userId);
    if (queue.length === 0) {
      setOfflineQueueCount(0);
      return 0;
    }

    const remaining = [];
    let syncedCount = 0;

    for (const item of queue) {
      try {
        const res = await upiDetectionApi.ingestNotification(item.input);
        if (res.accepted && res.transaction) {
          upsertLocalDetected(res.transaction);
        }
        syncedCount += 1;
      } catch {
        remaining.push({ ...item, attempts: item.attempts + 1 });
      }
    }

    saveOfflineNotificationQueue(userId, remaining);
    setOfflineQueueCount(remaining.length);
    return syncedCount;
  }, [userId, upsertLocalDetected]);

  // Initial load for authenticated user
  useEffect(() => {
    if (!userId) {
      setDetectedList([]);
      setActivePopupTransaction(null);
      setIsOnboardingOpen(false);
      return;
    }

    const cachedSettings = loadCachedJson<ExpenseDetectionSettings>(
      `${SETTINGS_CACHE_PREFIX}${userId}`,
      getDefaultDetectionSettings()
    );
    const cachedDetected = loadCachedJson<DetectedTransaction[]>(
      `${DETECTED_CACHE_PREFIX}${userId}`,
      []
    );
    setSettings(cachedSettings);
    setDetectedList(cachedDetected);
    setOfflineQueueCount(loadOfflineNotificationQueue(userId).length);

    const status = verifyNotificationAccessStatus(cachedSettings.enabled);
    prevPermissionRef.current = status;
    setPermissionStatus(status);
    syncConfigToNativeBridge(cachedSettings);

    let cancelled = false;
    setIsLoading(true);

    Promise.all([
      upiDetectionApi.getSettings().catch(() => cachedSettings),
      upiDetectionApi.listPending().catch(() => null),
    ])
      .then(([remoteSettings, remoteLists]) => {
        if (cancelled) return;
        const safeSettings: ExpenseDetectionSettings =
          remoteSettings && typeof remoteSettings === 'object'
            ? { ...getDefaultDetectionSettings(), ...remoteSettings }
            : cachedSettings;
        setSettings(safeSettings);
        saveCachedJson(`${SETTINGS_CACHE_PREFIX}${userId}`, safeSettings);
        syncConfigToNativeBridge(safeSettings);

        const nextStatus = verifyNotificationAccessStatus(Boolean(safeSettings.enabled));
        prevPermissionRef.current = nextStatus;
        setPermissionStatus(nextStatus);

        if (remoteLists && typeof remoteLists === 'object') {
          const merged = [
            ...(Array.isArray(remoteLists.pending) ? remoteLists.pending : []),
            ...(Array.isArray(remoteLists.categorized) ? remoteLists.categorized : []),
            ...(Array.isArray(remoteLists.dismissed) ? remoteLists.dismissed : []),
          ];
          if (merged.length > 0 || cachedDetected.length === 0) {
            setDetectedList(merged);
          }
        }

        // Show first-launch Automatic Expense Detection onboarding once per user if not completed
        const seenLocal =
          typeof window !== 'undefined' &&
          localStorage.getItem(`${ONBOARDING_DISMISSED_PREFIX}${userId}`) === '1';
        if (!safeSettings.onboardingCompleted && !seenLocal && platform === 'android_native_bridge') {
          setIsOnboardingOpen(true);
        }

        // Drain any native Android offline detections accumulated while app was closed
        const nativeItems = drainNativePendingQueue();
        for (const item of nativeItems) {
          ingestNotification(item).then(() => {
            if (item.id) acknowledgeNativeQueueItem(item.id);
          });
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, platform, ingestNotification]);

  // Listen to native Android live broadcast events & app resume / network reconnect
  useEffect(() => {
    if (!userId || typeof window === 'undefined') return;

    const handleNativeEvent = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      if (!detail || typeof detail !== 'object') return;
      const raw: RawNotificationInput = {
        packageName: String(detail.sourcePackage || detail.packageName || ''),
        title: String(detail.title || `Paid ₹${detail.amountRupees || (Number(detail.amountPaise || 0) / 100)}`),
        text: String(
          detail.text ||
            [
              `Paid ₹${detail.amountRupees || (Number(detail.amountPaise || 0) / 100)}`,
              detail.merchantName ? `to ${detail.merchantName}` : '',
              detail.utrNumber ? `UTR: ${detail.utrNumber}` : '',
              detail.upiTransactionId ? `Txn ID: ${detail.upiTransactionId}` : '',
              detail.rrn ? `RRN: ${detail.rrn}` : '',
            ]
              .filter(Boolean)
              .join(' ')
        ),
        notificationTimestamp: detail.notificationTimestamp || Date.now(),
      };
      ingestNotification(raw).then(() => {
        if (detail.id) acknowledgeNativeQueueItem(String(detail.id));
      });
    };

    const handleOnline = () => {
      flushOfflineQueue();
    };

    window.addEventListener('hackifypro:upi-detected', handleNativeEvent);
    window.addEventListener('online', handleOnline);
    const unsubResume = subscribeToAppResume(() => {
      refreshPermissionStatus();
      flushOfflineQueue();
    });

    return () => {
      window.removeEventListener('hackifypro:upi-detected', handleNativeEvent);
      window.removeEventListener('online', handleOnline);
      unsubResume();
    };
  }, [userId, ingestNotification, flushOfflineQueue, refreshPermissionStatus]);

  const updateSettings = useCallback(
    async (patch: Partial<ExpenseDetectionSettings>) => {
      const optimistic: ExpenseDetectionSettings = {
        ...settingsRef.current,
        ...patch,
        supportedApps: patch.supportedApps
          ? { ...settingsRef.current.supportedApps, ...patch.supportedApps }
          : settingsRef.current.supportedApps,
        updatedAt: new Date().toISOString(),
      };
      setSettings(optimistic);
      if (userId) saveCachedJson(`${SETTINGS_CACHE_PREFIX}${userId}`, optimistic);
      syncConfigToNativeBridge(optimistic);

      const nextStatus = verifyNotificationAccessStatus(optimistic.enabled);
      prevPermissionRef.current = nextStatus;
      setPermissionStatus(nextStatus);

      try {
        const saved = await upiDetectionApi.updateSettings(optimistic);
        setSettings(saved);
        if (userId) saveCachedJson(`${SETTINGS_CACHE_PREFIX}${userId}`, saved);
      } catch {
        // Keep optimistic local preference synced when offline
      }
    },
    [userId]
  );

  const toggleDetectionEnabled = useCallback(
    async (enabled: boolean) => {
      await updateSettings({ enabled });
      toast.info(
        enabled ? 'Automatic Detection Enabled' : 'Automatic Detection Disabled',
        enabled
          ? platform === 'android_native_bridge'
            ? 'Outgoing UPI payment notifications will be processed according to your app preferences.'
            : 'Preference saved. Live capture runs automatically on Android devices with Notification Access granted.'
          : 'Background UPI notification processing is stopped.'
      );
    },
    [updateSettings, toast, platform]
  );

  const toggleSupportedApp = useCallback(
    async (appId: string, enabled: boolean) => {
      await updateSettings({
        supportedApps: {
          ...settingsRef.current.supportedApps,
          [appId]: enabled,
        },
      });
    },
    [updateSettings]
  );

  const toggleAutoPopup = useCallback(
    async (enabled: boolean) => {
      await updateSettings({ autoPopupEnabled: enabled });
    },
    [updateSettings]
  );

  const closeOnboarding = useCallback(
    async (markCompleted = true) => {
      setIsOnboardingOpen(false);
      if (markCompleted && userId) {
        if (typeof window !== 'undefined') {
          localStorage.setItem(`${ONBOARDING_DISMISSED_PREFIX}${userId}`, '1');
        }
        await updateSettings({ onboardingCompleted: true });
      }
    },
    [userId, updateSettings]
  );

  const runSanitizedParserTest = useCallback(
    async (sample: RawNotificationInput) => {
      return ingestNotification({
        ...sample,
        notificationTimestamp: new Date().toISOString(),
        isTestSample: true,
      });
    },
    [ingestNotification]
  );

  const saveCategorizedExpense = useCallback(
    async (
      detected: DetectedTransaction,
      category: UpiExpenseCategoryId,
      description?: string
    ): Promise<boolean> => {
      // Prevent duplicate ledger expenses if already categorized
      const alreadyLinked = transactions.find(
        (t) => t.metadata?.detected_transaction_id === detected.id
      );
      if (alreadyLinked || detected.categorizationStatus === 'categorized') {
        toast.info('Already Saved', 'This detected UPI payment is already recorded in your ledger.');
        setActivePopupTransaction((curr) => (curr?.id === detected.id ? null : curr));
        return true;
      }

      const payload = mapUpiCategoryToExpensePayload(detected, category, description);
      await addTransaction(payload);

      // Find the freshly inserted transaction ID if available, else deterministic link reference
      const linkedExpenseId = `upi_exp_${detected.id}`;
      const updatedLocal: DetectedTransaction = {
        ...detected,
        categorizationStatus: 'categorized',
        selectedCategory: category,
        description: (description || '').trim() || null,
        linkedExpenseId,
        updatedAt: new Date().toISOString(),
      };
      upsertLocalDetected(updatedLocal);
      setActivePopupTransaction((curr) => (curr?.id === detected.id ? null : curr));

      upiDetectionApi
        .categorize(detected.id, {
          category,
          description: (description || '').trim(),
          linkedExpenseId,
        })
        .catch(() => {});

      toast.success(
        'Expense Saved',
        `₹${detected.amountRupees.toLocaleString('en-IN')} (${category}) added to your ledger.`
      );
      return true;
    },
    [transactions, addTransaction, upsertLocalDetected, toast]
  );

  const dismissDetectedTransaction = useCallback(
    async (detectedId: string) => {
      const target = detectedRef.current.find((d) => d.id === detectedId);
      if (target) {
        upsertLocalDetected({
          ...target,
          categorizationStatus: 'dismissed',
          updatedAt: new Date().toISOString(),
        });
      }
      setActivePopupTransaction((curr) => (curr?.id === detectedId ? null : curr));
      upiDetectionApi.dismiss(detectedId).catch(() => {});
    },
    [upsertLocalDetected]
  );

  const remindLaterDetectedTransaction = useCallback(
    async (detectedId: string) => {
      const target = detectedRef.current.find((d) => d.id === detectedId);
      if (target) {
        upsertLocalDetected({
          ...target,
          categorizationStatus: 'remind_later',
          updatedAt: new Date().toISOString(),
        });
      }
      setActivePopupTransaction((curr) => (curr?.id === detectedId ? null : curr));
      upiDetectionApi.remindLater(detectedId).catch(() => {});
      toast.info(
        'Saved to Pending Expenses',
        'You can categorize this UPI payment later from Dashboard or Settings.'
      );
    },
    [upsertLocalDetected, toast]
  );

  const editDetectedTransaction = useCallback(
    async (
      detected: DetectedTransaction,
      category: UpiExpenseCategoryId,
      description: string
    ): Promise<boolean> => {
      const updatedLocal: DetectedTransaction = {
        ...detected,
        selectedCategory: category,
        description: description.trim() || null,
        updatedAt: new Date().toISOString(),
      };
      upsertLocalDetected(updatedLocal);

      // Update linked expense in ExpenseContext while preserving original UPI payment metadata
      const linkedTx = transactions.find(
        (t) => t.metadata?.detected_transaction_id === detected.id
      );
      if (linkedTx) {
        const mapped = mapUpiCategoryToExpensePayload(detected, category, description);
        await editTransaction(linkedTx.id, {
          category: mapped.category,
          subcategory: mapped.subcategory,
          description: mapped.description,
          metadata: {
            ...(linkedTx.metadata || {}),
            ...(mapped.metadata || {}),
            upi_popup_category: category,
          },
        });
      }

      upiDetectionApi
        .editDetected(detected.id, { category, description: description.trim() })
        .catch(() => {});
      toast.success('Expense Updated', 'Category and description updated while preserving payment metadata.');
      return true;
    },
    [transactions, editTransaction, upsertLocalDetected, toast]
  );

  const resetDetectionConfiguration = useCallback(
    async (clearHistory = true) => {
      const defaults = getDefaultDetectionSettings();
      setSettings(defaults);
      if (clearHistory) {
        setDetectedList([]);
        setActivePopupTransaction(null);
      }
      if (userId && typeof window !== 'undefined') {
        localStorage.removeItem(`${ONBOARDING_DISMISSED_PREFIX}${userId}`);
        saveCachedJson(`${SETTINGS_CACHE_PREFIX}${userId}`, defaults);
        if (clearHistory) {
          saveCachedJson(`${DETECTED_CACHE_PREFIX}${userId}`, []);
          saveOfflineNotificationQueue(userId, []);
          setOfflineQueueCount(0);
        }
      }
      syncConfigToNativeBridge(defaults);
      const nextStatus = verifyNotificationAccessStatus(false);
      prevPermissionRef.current = nextStatus;
      setPermissionStatus(nextStatus);

      upiDetectionApi.resetConfiguration(clearHistory).catch(() => {});
      toast.success(
        'Detection Configuration Reset',
        clearHistory
          ? 'Automatic UPI detection preferences and pending detection history were cleared.'
          : 'Automatic UPI detection preferences were restored to defaults.'
      );
    },
    [userId, toast]
  );

  const pendingTransactions = detectedList.filter(
    (tx) => tx.categorizationStatus === 'pending' || tx.categorizationStatus === 'remind_later'
  );
  const categorizedTransactions = detectedList.filter(
    (tx) => tx.categorizationStatus === 'categorized'
  );
  const dismissedTransactions = detectedList.filter(
    (tx) => tx.categorizationStatus === 'dismissed'
  );

  const serviceStatus: 'running' | 'paused' | 'stopped' | 'unavailable' =
    platform !== 'android_native_bridge'
      ? 'unavailable'
      : !settings.enabled
        ? 'stopped'
        : permissionStatus === 'granted'
          ? 'running'
          : 'paused';

  return (
    <UpiDetectionContext.Provider
      value={{
        platform,
        permissionStatus,
        serviceStatus,
        settings,
        pendingTransactions,
        categorizedTransactions,
        dismissedTransactions,
        activePopupTransaction,
        offlineQueueCount,
        isLoading,
        isOnboardingOpen,
        openOnboarding: () => setIsOnboardingOpen(true),
        closeOnboarding,
        refreshPermissionStatus,
        openNotificationSettings: openAndroidNotificationSettings,
        updateSettings,
        toggleDetectionEnabled,
        toggleSupportedApp,
        toggleAutoPopup,
        ingestNotification,
        runSanitizedParserTest,
        openPopupForDetected: (tx) => setActivePopupTransaction(tx),
        closeActivePopup: () => setActivePopupTransaction(null),
        saveCategorizedExpense,
        dismissDetectedTransaction,
        remindLaterDetectedTransaction,
        editDetectedTransaction,
        resetDetectionConfiguration,
        flushOfflineQueue,
      }}
    >
      {children}
    </UpiDetectionContext.Provider>
  );
};

export function useUpiDetection(): UpiDetectionContextValue {
  const ctx = useContext(UpiDetectionContext);
  if (!ctx) {
    throw new Error('useUpiDetection must be used inside UpiDetectionProvider');
  }
  return ctx;
}
