import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import {
  Transaction,
  NewTransactionPayload,
  FinancialSummary,
  PersonSummary,
  FilterOptions,
  DynamicSection,
  MaintenanceSettings,
  AppBrandingSettings,
  BroadcastNotification,
} from '../types';
import {
  getSupabaseClient,
  fetchTransactionsFromSupabase,
  saveTransactionToSupabase,
  updateTransactionInSupabase,
  subscribeToSupabaseTransactions,
  RealtimeTransactionEvent,
  softDeleteTransactionFromSupabase,
  restoreTransactionInSupabase,
  permanentDeleteTransactionFromSupabase,
  permanentDeleteTransactionsFromSupabase,
  fetchSectionsFromSupabase,
  saveSectionToSupabase,
  deleteSectionFromSupabase,
  fetchAppSettingFromSupabase,
  saveAppSettingToSupabase,
  fetchNotificationsFromSupabase,
  saveNotificationToSupabase,
  deactivateNotificationInSupabase,
} from '../lib/supabase';
import { getCurrentISTDate, getCurrentISTTime, getPresetDateRange } from '../lib/dateUtils';
import { useAuth } from './AuthContext';
import {
  validateTransactionPayload,
  validateAmount,
  assertResourceOwnership,
  SecurityAuthorizationError,
} from '../lib/security';

interface ExpenseContextType {
  transactions: Transaction[];
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  summary: FinancialSummary;
  peopleSummaries: PersonSummary[];
  filterOptions: FilterOptions;
  setFilterOptions: React.Dispatch<React.SetStateAction<FilterOptions>>;
  filteredTransactions: Transaction[];
  addTransaction: (payload: NewTransactionPayload) => Promise<Transaction>;
  editTransaction: (id: string, updates: Partial<NewTransactionPayload>) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<boolean>;
  clearAllTransactions: () => Promise<void>;
  refreshTransactions: () => Promise<void>;
  isSupabaseConnected: boolean;

  // Udhar & People Settlement
  settlePersonUdhar: (personName: string, notes?: string) => Promise<Transaction>;
  clearPersonTransactions: (personName: string) => Promise<boolean>;
  permanentDeletePersonTransactions: (personName: string) => Promise<boolean>;
  permanentDeleteMultipleTransactions: (ids: string[]) => Promise<boolean>;

  // Recycle Bin & Recovery
  recycleBinTransactions: Transaction[];
  restoreTransaction: (id: string) => Promise<boolean>;
  permanentDeleteTransaction: (id: string) => Promise<boolean>;

  // Dynamic Sections Management
  dynamicSections: DynamicSection[];
  refreshSections: () => Promise<void>;
  addSection: (section: DynamicSection) => Promise<boolean>;
  updateSection: (id: string, updates: Partial<DynamicSection>) => Promise<boolean>;
  deleteSection: (id: string) => Promise<boolean>;

  // App Settings & Maintenance Mode
  maintenanceSettings: MaintenanceSettings;
  updateMaintenanceSettings: (settings: Partial<MaintenanceSettings>) => Promise<boolean>;
  appBranding: AppBrandingSettings;
  updateAppBranding: (settings: Partial<AppBrandingSettings>) => Promise<boolean>;

  // Notifications & Announcements
  notifications: BroadcastNotification[];
  refreshNotifications: () => Promise<void>;
  createNotification: (notif: Partial<BroadcastNotification>) => Promise<boolean>;
  deactivateNotification: (id: string) => Promise<boolean>;

  // Admin Global Financial Queries
  allGlobalTransactions: Transaction[];
}

const ExpenseContext = createContext<ExpenseContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'my_money_transactions_real';
const LOCAL_SECTIONS_KEY = 'my_money_sections_cache';
const LOCAL_MAINTENANCE_KEY = 'my_money_maintenance_cache';
const LOCAL_BRANDING_KEY = 'my_money_branding_cache';

const DEFAULT_SECTIONS: DynamicSection[] = [
  { id: 'home', name: 'Home Money', icon: 'Home', description: 'Money received & spent for home', display_order: 1, is_enabled: true },
  { id: 'room', name: 'Room Expenses', icon: 'DoorOpen', description: 'Gas, grocery, room rent & power bill', display_order: 2, is_enabled: true },
  { id: 'food', name: 'Food & Dining', icon: 'Utensils', description: 'Restaurant, fast food, snacks, tea, coffee & delivery', display_order: 3, is_enabled: true },
  { id: 'other', name: 'Other Expenses', icon: 'ShoppingBag', description: 'Shopping, travel, bills & personal spending', display_order: 4, is_enabled: true },
  { id: 'people', name: 'People (Udhar)', icon: 'Users', description: 'Money given & received from people', display_order: 5, is_enabled: true },
];

const DEFAULT_MAINTENANCE: MaintenanceSettings = {
  isEnabled: false,
  title: 'My Money Manager is Under Scheduled Maintenance',
  message: 'We are upgrading our secure financial infrastructure to deliver better performance and security. Normal services will resume shortly.',
  expectedRestoration: 'Within 2 hours',
};

const DEFAULT_BRANDING: AppBrandingSettings = {
  appName: 'My Money Manager',
  subTitle: 'by HackifyPro',
  logoUrl: '/logo.jpg',
  currencySymbol: '₹',
  currencyCode: 'INR',
  timezone: 'Asia/Kolkata',
  allowRegistration: true,
  allowLogin: true,
};

// RFC 4122 compliant UUID v4 generator
function generateSecureUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const ExpenseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAdmin } = useAuth();

  // All transactions loaded from persistent store / Supabase (including deleted for admin)
  const [allTransactions, setAllTransactions] = useState<Transaction[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [dynamicSections, setDynamicSections] = useState<DynamicSection[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_SECTIONS_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_SECTIONS;
    } catch {
      return DEFAULT_SECTIONS;
    }
  });

  const [maintenanceSettings, setMaintenanceSettings] = useState<MaintenanceSettings>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_MAINTENANCE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_MAINTENANCE;
    } catch {
      return DEFAULT_MAINTENANCE;
    }
  });

  const [appBranding, setAppBranding] = useState<AppBrandingSettings>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_BRANDING_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_BRANDING;
    } catch {
      return DEFAULT_BRANDING;
    }
  });

  const [notifications, setNotifications] = useState<BroadcastNotification[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupabaseConnected, setIsSupabaseConnected] = useState<boolean>(false);

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    searchQuery: '',
    category: 'all',
    subcategory: 'all',
    type: 'all',
    dateFilter: { preset: 'all' },
    sortBy: 'newest',
  });

  // User-scoped storage keys to prevent multi-device / multi-user cache contamination
  const getUserTxStorageKey = useCallback((uid?: string) => {
    return uid ? `my_money_transactions_${uid}` : LOCAL_STORAGE_KEY;
  }, []);

  const getUserPendingQueueKey = useCallback((uid?: string) => {
    return `my_money_pending_queue_${uid || 'guest'}`;
  }, []);

  const getPendingQueue = useCallback((uid?: string): Transaction[] => {
    try {
      const q = localStorage.getItem(getUserPendingQueueKey(uid));
      return q ? JSON.parse(q) : [];
    } catch {
      return [];
    }
  }, [getUserPendingQueueKey]);

  const savePendingQueue = useCallback((uid: string | undefined, queue: Transaction[]) => {
    try {
      const key = getUserPendingQueueKey(uid);
      if (queue.length === 0) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(queue));
      }
    } catch {}
  }, [getUserPendingQueueKey]);

  // Local storage persistence helper (strictly scoped to authenticated user)
  const persistLocally = useCallback((newList: Transaction[]) => {
    try {
      const key = getUserTxStorageKey(user?.uid);
      localStorage.setItem(key, JSON.stringify(newList));
    } catch (e) {
      console.error('Failed to persist locally:', e);
    }
  }, [user?.uid, getUserTxStorageKey]);

  // When user switches or logs in/out, immediately load only this user's data
  useEffect(() => {
    if (user) {
      const key = getUserTxStorageKey(user.uid);
      const saved = localStorage.getItem(key);
      if (saved) {
        try {
          setAllTransactions(JSON.parse(saved));
        } catch {
          setAllTransactions([]);
        }
      } else {
        // Fallback check legacy key once
        const legacy = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (legacy) {
          try {
            const parsed: Transaction[] = JSON.parse(legacy);
            const userOwned = parsed.filter(
              (t) => t.user_id === user.uid || (t.user_email && t.user_email.toLowerCase() === user.email.toLowerCase())
            );
            if (userOwned.length > 0) {
              setAllTransactions(userOwned);
              localStorage.setItem(key, JSON.stringify(userOwned));
            }
          } catch {}
        }
      }
    } else {
      setAllTransactions([]);
    }
  }, [user?.uid, getUserTxStorageKey]);

  // Primary database sync: SUPABASE with high-speed parallel fetching & Postgres Realtime
  const syncWithDatabase = useCallback(async (silent: boolean = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    setIsSyncing(true);
    setError(null);

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const targetUserId = isAdmin ? undefined : user?.uid;

        // Run all public metadata and transactions fetches in PARALLEL for maximum speed
        const [sectionsData, maint, brand, notifs, supaData] = await Promise.all([
          fetchSectionsFromSupabase().catch(() => null),
          fetchAppSettingFromSupabase<MaintenanceSettings>('maintenance_mode').catch(() => null),
          fetchAppSettingFromSupabase<AppBrandingSettings>('app_branding').catch(() => null),
          fetchNotificationsFromSupabase().catch(() => []),
          user
            ? fetchTransactionsFromSupabase(targetUserId, true).catch((err) => {
                console.warn('Supabase fetchTransactions error:', err.message);
                return null;
              })
            : Promise.resolve(null),
        ]);

        if (sectionsData && sectionsData.length > 0) {
          setDynamicSections(sectionsData);
          localStorage.setItem(LOCAL_SECTIONS_KEY, JSON.stringify(sectionsData));
        }

        if (maint) {
          setMaintenanceSettings(maint);
          localStorage.setItem(LOCAL_MAINTENANCE_KEY, JSON.stringify(maint));
        }

        if (brand) {
          setAppBranding(brand);
          localStorage.setItem(LOCAL_BRANDING_KEY, JSON.stringify(brand));
        }

        if (notifs) {
          setNotifications(notifs);
        }

        // TRANSACTION SYNC: Only proceed if user session is loaded
        if (!user) {
          setIsLoading(false);
          setIsSyncing(false);
          return;
        }

        if (Array.isArray(supaData)) {
          // Process offline pending queue (ONLY items that explicitly failed to upload)
          const pendingQueue = getPendingQueue(user.uid);
          if (pendingQueue.length > 0) {
            const remainingQueue: Transaction[] = [];
            for (const pendingTx of pendingQueue) {
              try {
                const saved = await saveTransactionToSupabase(pendingTx);
                const idx = supaData.findIndex((t) => t.id === pendingTx.id);
                if (idx >= 0) supaData[idx] = saved;
                else supaData.unshift(saved);
              } catch (e) {
                console.warn('Could not sync pending tx from queue:', e);
                remainingQueue.push(pendingTx);
              }
            }
            savePendingQueue(user.uid, remainingQueue);
          }

          setAllTransactions(supaData);
          persistLocally(supaData);
          setIsSupabaseConnected(true);
        }

        setIsLoading(false);
        setIsSyncing(false);
        return;
      } catch (supaErr: any) {
        console.warn('Supabase fetch notice, using local cache:', supaErr.message);
      }
    }

    // Fallback to cached local storage
    if (user) {
      const saved = localStorage.getItem(getUserTxStorageKey(user.uid));
      if (saved) {
        try {
          setAllTransactions(JSON.parse(saved));
        } catch {}
      }
    }
    setIsLoading(false);
    setIsSyncing(false);
  }, [user, isAdmin, getPendingQueue, savePendingQueue, persistLocally, getUserTxStorageKey]);

  // Initial load, multi-device Realtime subscription, and mobile tab wake/focus listener
  useEffect(() => {
    if (!user) return;

    // 1. Initial sync
    syncWithDatabase(false);

    // 2. High-speed real-time updates via WebSocket (instant UI reflection without manual reload)
    const unsubscribeSupabase = subscribeToSupabaseTransactions((event?: RealtimeTransactionEvent) => {
      setIsSupabaseConnected(true);

      if (!event || !event.eventType) {
        syncWithDatabase(true);
        return;
      }

      const { eventType, newRecord, oldId } = event;

      // In multi-user system, only process if belongs to current user (or if admin)
      if (!isAdmin && newRecord && newRecord.user_id && newRecord.user_id !== user.uid) {
        return;
      }

      if (eventType === 'INSERT' && newRecord) {
        setAllTransactions((prev) => {
          const exists = prev.some((t) => t.id === newRecord.id);
          const next = exists
            ? prev.map((t) => (t.id === newRecord.id ? newRecord : t))
            : [newRecord, ...prev];
          persistLocally(next);
          return next;
        });
      } else if (eventType === 'UPDATE' && newRecord) {
        setAllTransactions((prev) => {
          const exists = prev.some((t) => t.id === newRecord.id);
          const next = exists
            ? prev.map((t) => (t.id === newRecord.id ? newRecord : t))
            : [newRecord, ...prev];
          persistLocally(next);
          return next;
        });
      } else if (eventType === 'DELETE' && oldId) {
        setAllTransactions((prev) => {
          const next = prev.filter((t) => t.id !== oldId);
          persistLocally(next);
          return next;
        });
      } else {
        syncWithDatabase(true);
      }
    });

    // 3. Mobile screen wake / Tab focus / Reconnect listener
    const handleSyncTrigger = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        syncWithDatabase(true);
      }
    };

    document.addEventListener('visibilitychange', handleSyncTrigger);
    window.addEventListener('focus', handleSyncTrigger);
    window.addEventListener('online', handleSyncTrigger);

    // 4. Polling fallback every 20 seconds when screen is visible
    const pollInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        syncWithDatabase(true);
      }
    }, 20000);

    return () => {
      unsubscribeSupabase();
      document.removeEventListener('visibilitychange', handleSyncTrigger);
      window.removeEventListener('focus', handleSyncTrigger);
      window.removeEventListener('online', handleSyncTrigger);
      clearInterval(pollInterval);
    };
  }, [user, isAdmin, syncWithDatabase, persistLocally]);

  const refreshTransactions = async () => {
    await syncWithDatabase();
  };

  // -------------------------------------------------------------
  // STRICT MULTI-USER DATA ISOLATION (USER DASHBOARD VIEW)
  // -------------------------------------------------------------
  // User sees ONLY their own records, and only NON-DELETED records
  const userTransactions: Transaction[] = useMemo(() => {
    if (!user) return [];

    return allTransactions.filter(
      (t) =>
        (t.user_id === user.uid || (t.user_email && t.user_email.toLowerCase() === user.email.toLowerCase())) &&
        !t.is_deleted
    );
  }, [allTransactions, user]);

  // Recycle Bin transactions (User sees their deleted; Admin sees all deleted)
  const recycleBinTransactions: Transaction[] = useMemo(() => {
    if (!user) return [];
    if (isAdmin) {
      return allTransactions.filter((t) => Boolean(t.is_deleted));
    }
    return allTransactions.filter(
      (t) =>
        (t.user_id === user.uid || (t.user_email && t.user_email.toLowerCase() === user.email.toLowerCase())) &&
        Boolean(t.is_deleted)
    );
  }, [allTransactions, user, isAdmin]);

  // Global transactions for admin overview and management
  const allGlobalTransactions: Transaction[] = useMemo(() => {
    return allTransactions.filter((t) => !t.is_deleted);
  }, [allTransactions]);

  // Add transaction
  const addTransaction = async (payload: NewTransactionPayload): Promise<Transaction> => {
    if (!user) {
      throw new SecurityAuthorizationError('Authentication required: You must be logged in to record transactions.');
    }

    const validation = validateTransactionPayload(payload, user.uid);
    if (!validation.isValid || !validation.sanitizedPayload) {
      throw new Error(`Validation Error: ${validation.errors.join(' ')}`);
    }

    const clean = validation.sanitizedPayload;
    const nowIso = new Date().toISOString();
    const newId = generateSecureUUID();

    const newTx: Transaction = {
      id: newId,
      user_id: user.uid,
      user_email: user.email,
      category: clean.category,
      subcategory: clean.subcategory,
      transaction_type: clean.transaction_type,
      amount: clean.amount,
      title: clean.title,
      description: clean.description,
      person_name: clean.person_name,
      transaction_date: clean.transaction_date || getCurrentISTDate(),
      transaction_time: clean.transaction_time || getCurrentISTTime(),
      notes: clean.notes,
      metadata: clean.metadata || {},
      is_deleted: false,
      created_at: nowIso,
      updated_at: nowIso,
    };

    setAllTransactions((prev) => {
      const updated = [newTx, ...prev];
      persistLocally(updated);
      return updated;
    });

    const supabase = getSupabaseClient();
    if (supabase) {
      saveTransactionToSupabase(newTx)
        .then((saved) => {
          setIsSupabaseConnected(true);
          setAllTransactions((prev) => {
            const updated = prev.map((t) => (t.id === newTx.id ? { ...saved, user_email: user.email } : t));
            persistLocally(updated);
            return updated;
          });
        })
        .catch((err: any) => {
          console.warn('Supabase save notice, queued locally:', err.message);
          const q = getPendingQueue(user.uid);
          savePendingQueue(user.uid, [...q.filter((t) => t.id !== newTx.id), newTx]);
        });
    }

    return newTx;
  };

  // Edit transaction
  const editTransaction = async (id: string, updates: Partial<NewTransactionPayload>): Promise<Transaction> => {
    if (!user) {
      throw new SecurityAuthorizationError('Authentication required.');
    }

    const existing = allTransactions.find((t) => t.id === id);
    if (!existing) {
      throw new Error(`Transaction with ID "${id}" not found.`);
    }

    // ANTI-IDOR SECURITY CHECK: Ensure requesting user owns this transaction unless Admin
    if (!isAdmin && existing.user_id && existing.user_id !== user.uid) {
      assertResourceOwnership(user.uid, existing.user_id);
    }

    let cleanAmount = existing.amount;
    if (updates.amount !== undefined) {
      const amtCheck = validateAmount(updates.amount);
      if (!amtCheck.isValid) {
        throw new Error(amtCheck.error || 'Invalid amount.');
      }
      cleanAmount = amtCheck.value;
    }

    const updatedTx: Transaction = {
      ...existing,
      category: updates.category || existing.category,
      subcategory: updates.subcategory || existing.subcategory,
      transaction_type: updates.transaction_type || existing.transaction_type,
      amount: cleanAmount,
      title: updates.title !== undefined ? updates.title.trim() : existing.title,
      description: updates.description !== undefined ? updates.description : existing.description,
      person_name: updates.person_name !== undefined ? updates.person_name : existing.person_name,
      transaction_date: updates.transaction_date || existing.transaction_date,
      transaction_time: updates.transaction_time || existing.transaction_time,
      notes: updates.notes !== undefined ? updates.notes : existing.notes,
      metadata: updates.metadata ? { ...existing.metadata, ...updates.metadata } : existing.metadata,
      updated_at: new Date().toISOString(),
    };

    setAllTransactions((prev) => {
      const updated = prev.map((t) => (t.id === id ? updatedTx : t));
      persistLocally(updated);
      return updated;
    });

    const supabase = getSupabaseClient();
    if (supabase) {
      updateTransactionInSupabase(id, updatedTx)
        .then(() => setIsSupabaseConnected(true))
        .catch((err: any) => {
          console.warn('Supabase update notice, queued locally:', err.message);
          const q = getPendingQueue(user.uid);
          savePendingQueue(user.uid, [...q.filter((t) => t.id !== id), updatedTx]);
        });
    }

    return updatedTx;
  };

  // Delete transaction: Soft delete (Move to Recycle Bin)
  const deleteTransaction = async (id: string): Promise<boolean> => {
    if (!user) return false;

    const existing = allTransactions.find((t) => t.id === id);
    if (!existing) return false;

    if (!isAdmin && existing.user_id && existing.user_id !== user.uid) {
      assertResourceOwnership(user.uid, existing.user_id);
    }

    const nowIso = new Date().toISOString();
    setAllTransactions((prev) => {
      const updated = prev.map((t) =>
        t.id === id ? { ...t, is_deleted: true, deleted_at: nowIso, deleted_by: user.uid } : t
      );
      persistLocally(updated);
      return updated;
    });

    const supabase = getSupabaseClient();
    if (supabase) {
      softDeleteTransactionFromSupabase(id, user.uid)
        .then(() => setIsSupabaseConnected(true))
        .catch((err: any) => {
          console.warn('Supabase soft delete notice, queued locally:', err.message);
          const q = getPendingQueue(user.uid);
          const delTx = { ...existing, is_deleted: true, deleted_at: nowIso, deleted_by: user.uid };
          savePendingQueue(user.uid, [...q.filter((t) => t.id !== id), delTx]);
        });
    }

    return true;
  };

  // Restore transaction from Recycle Bin
  const restoreTransaction = async (id: string): Promise<boolean> => {
    if (!user) return false;

    setAllTransactions((prev) => {
      const updated = prev.map((t) =>
        t.id === id ? { ...t, is_deleted: false, deleted_at: undefined, deleted_by: undefined } : t
      );
      persistLocally(updated);
      return updated;
    });

    const supabase = getSupabaseClient();
    if (supabase) {
      restoreTransactionInSupabase(id)
        .then(() => setIsSupabaseConnected(true))
        .catch((err: any) => {
          console.warn('Supabase restore notice:', err.message);
        });
    }

    return true;
  };

  // Permanent Delete transaction (Irreversible)
  const permanentDeleteTransaction = async (id: string): Promise<boolean> => {
    if (!user) return false;

    setAllTransactions((prev) => {
      const updated = prev.filter((t) => t.id !== id);
      persistLocally(updated);
      return updated;
    });

    const supabase = getSupabaseClient();
    if (supabase) {
      permanentDeleteTransactionFromSupabase(id)
        .then(() => setIsSupabaseConnected(true))
        .catch((err: any) => {
          console.warn('Supabase permanent delete notice:', err.message);
        });
    }

    return true;
  };

  const clearAllTransactions = async () => {
    for (const t of userTransactions) {
      await deleteTransaction(t.id);
    }
  };

  // -------------------------------------------------------------
  // SETTLE & CLEAR PERSON UDHAR (उधार चुकता / FULL SETTLEMENT)
  // -------------------------------------------------------------
  const settlePersonUdhar = async (personName: string, customNotes?: string): Promise<Transaction> => {
    if (!user) {
      throw new SecurityAuthorizationError('Authentication required to settle transactions.');
    }

    const cleanName = personName.trim();
    const person = peopleSummaries.find((p) => p.name.toLowerCase() === cleanName.toLowerCase());
    if (!person) {
      throw new Error(`Person "${cleanName}" not found in your people ledger.`);
    }

    const balance = person.outstandingBalance;
    if (Math.abs(balance) < 0.01) {
      throw new Error(`Udhar with ${cleanName} is already completely cleared (Balance is ₹0).`);
    }

    const isOwed = balance > 0; // We gave money, person is returning it (Income/Received)
    const amountToSettle = Math.abs(balance);
    const subcategory = isOwed ? 'money_received' : 'money_given';
    const type = isOwed ? 'income' : 'expense';
    const title = isOwed
      ? `Full Udhar Cleared by ${cleanName}`
      : `Full Udhar Cleared to ${cleanName}`;
    const description = `Account settled in full. Balance cleared to ₹0.`;

    const tx = await addTransaction({
      category: 'people',
      subcategory,
      transaction_type: type,
      amount: amountToSettle,
      title,
      description,
      person_name: cleanName,
      transaction_date: getCurrentISTDate(),
      transaction_time: getCurrentISTTime(),
      notes: customNotes || 'Udhar Complete / Cleared (हिसाब चुकता)',
    });

    return tx;
  };

  // Clear / remove all records for a person from active directory (Soft-delete to Recycle Bin)
  const clearPersonTransactions = async (personName: string): Promise<boolean> => {
    if (!user) return false;
    const cleanName = personName.trim().toLowerCase();
    const personTxs = userTransactions.filter(
      (t) => t.category === 'people' && t.person_name && t.person_name.trim().toLowerCase() === cleanName
    );

    if (personTxs.length === 0) return true;

    for (const tx of personTxs) {
      await deleteTransaction(tx.id);
    }
    return true;
  };

  // Permanently delete multiple transactions (Irreversible - never goes to Recycle Bin)
  const permanentDeleteMultipleTransactions = async (ids: string[]): Promise<boolean> => {
    if (!user || ids.length === 0) return false;

    const idSet = new Set(ids);
    setAllTransactions((prev) => {
      const updated = prev.filter((t) => !idSet.has(t.id));
      persistLocally(updated);
      return updated;
    });

    const supabase = getSupabaseClient();
    if (supabase) {
      permanentDeleteTransactionsFromSupabase(ids)
        .then(() => setIsSupabaseConnected(true))
        .catch((err: any) => {
          console.warn('Supabase permanent delete notice:', err.message);
        });
    }

    return true;
  };

  // Permanently delete all records for a person (उधार पूरा होने पर परमानेंट डिलीट - Recycle Bin में भी नहीं दिखेगा)
  const permanentDeletePersonTransactions = async (personName: string): Promise<boolean> => {
    if (!user) return false;
    const cleanName = personName.trim().toLowerCase();
    const targetTxs = allTransactions.filter(
      (t) =>
        t.category === 'people' &&
        t.person_name &&
        t.person_name.trim().toLowerCase() === cleanName &&
        (isAdmin || t.user_id === user.uid)
    );

    if (targetTxs.length === 0) return true;

    const ids = targetTxs.map((t) => t.id);
    return permanentDeleteMultipleTransactions(ids);
  };

  // Dynamic Section Management
  const refreshSections = async () => {
    const sec = await fetchSectionsFromSupabase();
    if (sec && sec.length > 0) {
      setDynamicSections(sec);
      localStorage.setItem(LOCAL_SECTIONS_KEY, JSON.stringify(sec));
    }
  };

  const addSection = async (section: DynamicSection): Promise<boolean> => {
    setDynamicSections((prev) => [...prev, section]);
    try {
      await saveSectionToSupabase(section);
      return true;
    } catch {
      return false;
    }
  };

  const updateSection = async (id: string, updates: Partial<DynamicSection>): Promise<boolean> => {
    setDynamicSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
    const existing = dynamicSections.find((s) => s.id === id);
    if (!existing) return false;
    try {
      await saveSectionToSupabase({ ...existing, ...updates });
      return true;
    } catch {
      return false;
    }
  };

  const deleteSection = async (id: string): Promise<boolean> => {
    setDynamicSections((prev) => prev.filter((s) => s.id !== id));
    try {
      await deleteSectionFromSupabase(id);
      return true;
    } catch {
      return false;
    }
  };

  // App Settings & Maintenance Mode
  const updateMaintenanceSettings = async (settings: Partial<MaintenanceSettings>): Promise<boolean> => {
    const updated = { ...maintenanceSettings, ...settings };
    setMaintenanceSettings(updated);
    localStorage.setItem(LOCAL_MAINTENANCE_KEY, JSON.stringify(updated));
    try {
      await saveAppSettingToSupabase('maintenance_mode', updated, user?.uid);
      return true;
    } catch {
      return false;
    }
  };

  const updateAppBranding = async (settings: Partial<AppBrandingSettings>): Promise<boolean> => {
    const updated = { ...appBranding, ...settings };
    setAppBranding(updated);
    localStorage.setItem(LOCAL_BRANDING_KEY, JSON.stringify(updated));
    try {
      await saveAppSettingToSupabase('app_branding', updated, user?.uid);
      return true;
    } catch {
      return false;
    }
  };

  // Notifications
  const refreshNotifications = async () => {
    const notifs = await fetchNotificationsFromSupabase();
    setNotifications(notifs);
  };

  const createNotification = async (notif: Partial<BroadcastNotification>): Promise<boolean> => {
    try {
      await saveNotificationToSupabase(notif);
      await refreshNotifications();
      return true;
    } catch {
      return false;
    }
  };

  const deactivateNotification = async (id: string): Promise<boolean> => {
    try {
      await deactivateNotificationInSupabase(id);
      await refreshNotifications();
      return true;
    } catch {
      return false;
    }
  };

  // Summary calculated exclusively from the current user's visible transactions
  const summary: FinancialSummary = useMemo(() => {
    let totalHomeReceived = 0;
    let totalHomeSpent = 0;
    let totalGas = 0;
    let totalGrocery = 0;
    let totalRent = 0;
    let totalElectricity = 0;
    let totalFoodExpenses = 0;
    let totalOtherExpenses = 0;
    let totalMoneyGiven = 0;
    let totalMoneyReceived = 0;

    for (const tx of userTransactions) {
      const amt = Number(tx.amount) || 0;

      if (tx.category === 'home') {
        if (tx.subcategory === 'received_home' || tx.transaction_type === 'income') {
          totalHomeReceived += amt;
        } else {
          totalHomeSpent += amt;
        }
      }

      if (tx.category === 'room') {
        if (tx.subcategory === 'gas') totalGas += amt;
        else if (tx.subcategory === 'grocery') totalGrocery += amt;
        else if (tx.subcategory === 'rent') totalRent += amt;
        else if (tx.subcategory === 'electricity') totalElectricity += amt;
      }

      if (tx.category === 'food') {
        totalFoodExpenses += amt;
      }

      if (tx.category === 'other') {
        totalOtherExpenses += amt;
      }

      if (tx.category === 'people') {
        if (tx.subcategory === 'money_given') {
          totalMoneyGiven += amt;
        } else if (tx.subcategory === 'money_received') {
          totalMoneyReceived += amt;
        }
      }
    }

    const totalRoomExpenses = totalGas + totalGrocery + totalRent + totalElectricity;
    const remainingHomeBalance = totalHomeReceived - totalHomeSpent;
    const netPeopleBalance = totalMoneyGiven - totalMoneyReceived;

    const totalExpenses = totalHomeSpent + totalRoomExpenses + totalFoodExpenses + totalOtherExpenses;
    const totalIncome = totalHomeReceived;
    const availableBalance = totalIncome - totalExpenses;

    return {
      totalIncome,
      totalExpenses,
      availableBalance,
      totalHomeReceived,
      totalHomeSpent,
      remainingHomeBalance,
      totalGas,
      totalGrocery,
      totalRent,
      totalElectricity,
      totalRoomExpenses,
      totalFoodExpenses,
      totalOtherExpenses,
      totalMoneyGiven,
      totalMoneyReceived,
      netPeopleBalance,
      totalTransactionsCount: userTransactions.length,
    };
  }, [userTransactions]);

  // People summaries for current user
  const peopleSummaries: PersonSummary[] = useMemo(() => {
    const map = new Map<string, { given: number; received: number; txs: Transaction[]; lastDate: string }>();

    for (const tx of userTransactions) {
      if (tx.category === 'people' && tx.person_name) {
        const nameKey = tx.person_name.trim();
        if (!map.has(nameKey)) {
          map.set(nameKey, { given: 0, received: 0, txs: [], lastDate: tx.transaction_date });
        }
        const data = map.get(nameKey)!;
        data.txs.push(tx);
        if (tx.transaction_date > data.lastDate) {
          data.lastDate = tx.transaction_date;
        }
        if (tx.subcategory === 'money_given') {
          data.given += Number(tx.amount) || 0;
        } else {
          data.received += Number(tx.amount) || 0;
        }
      }
    }

    const list: PersonSummary[] = [];
    map.forEach((val, name) => {
      const balance = Math.round((val.given - val.received) * 100) / 100;
      list.push({
        name,
        totalGiven: val.given,
        totalReceived: val.received,
        outstandingBalance: balance,
        isSettled: Math.abs(balance) < 0.01,
        transactionCount: val.txs.length,
        lastTransactionDate: val.lastDate,
        transactions: val.txs.sort((a, b) =>
          (b.transaction_date + b.transaction_time).localeCompare(a.transaction_date + a.transaction_time)
        ),
      });
    });

    return list.sort((a, b) => Math.abs(b.outstandingBalance) - Math.abs(a.outstandingBalance));
  }, [userTransactions]);

  // Filtered and sorted transactions for current user
  const filteredTransactions = useMemo(() => {
    let list = [...userTransactions];

    if (filterOptions.searchQuery.trim()) {
      const q = filterOptions.searchQuery.toLowerCase().trim();
      list = list.filter((t) => {
        return (
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)) ||
          (t.person_name && t.person_name.toLowerCase().includes(q)) ||
          (t.notes && t.notes.toLowerCase().includes(q)) ||
          (t.metadata?.grocery_item && t.metadata.grocery_item.toLowerCase().includes(q)) ||
          (t.metadata?.spent_at && t.metadata.spent_at.toLowerCase().includes(q)) ||
          (t.metadata?.spent_for && t.metadata.spent_for.toLowerCase().includes(q)) ||
          String(t.amount).includes(q)
        );
      });
    }

    if (filterOptions.category && filterOptions.category !== 'all') {
      list = list.filter((t) => t.category === filterOptions.category);
    }

    if (filterOptions.subcategory && filterOptions.subcategory !== 'all') {
      list = list.filter((t) => t.subcategory === filterOptions.subcategory);
    }

    if (filterOptions.type && filterOptions.type !== 'all') {
      list = list.filter((t) => t.transaction_type === filterOptions.type);
    }

    if (filterOptions.personName) {
      list = list.filter((t) => t.person_name?.toLowerCase() === filterOptions.personName?.toLowerCase());
    }

    const { preset, startDate, endDate } = filterOptions.dateFilter;
    if (preset === 'custom' && startDate && endDate) {
      list = list.filter((t) => t.transaction_date >= startDate && t.transaction_date <= endDate);
    } else if (preset !== 'all') {
      const range = getPresetDateRange(preset);
      if (range.start && range.end) {
        list = list.filter((t) => t.transaction_date >= range.start && t.transaction_date <= range.end);
      }
    }

    if (filterOptions.minAmount !== undefined && !isNaN(filterOptions.minAmount)) {
      list = list.filter((t) => t.amount >= filterOptions.minAmount!);
    }
    if (filterOptions.maxAmount !== undefined && !isNaN(filterOptions.maxAmount)) {
      list = list.filter((t) => t.amount <= filterOptions.maxAmount!);
    }

    list.sort((a, b) => {
      switch (filterOptions.sortBy) {
        case 'newest':
          return (b.transaction_date + ' ' + b.transaction_time).localeCompare(a.transaction_date + ' ' + a.transaction_time);
        case 'oldest':
          return (a.transaction_date + ' ' + a.transaction_time).localeCompare(b.transaction_date + ' ' + b.transaction_time);
        case 'highest_amount':
          return b.amount - a.amount;
        case 'lowest_amount':
          return a.amount - b.amount;
        default:
          return 0;
      }
    });

    return list;
  }, [userTransactions, filterOptions]);

  return (
    <ExpenseContext.Provider
      value={{
        transactions: userTransactions,
        isLoading,
        isSyncing,
        error,
        summary,
        peopleSummaries,
        filterOptions,
        setFilterOptions,
        filteredTransactions,
        addTransaction,
        editTransaction,
        deleteTransaction,
        clearAllTransactions,
        settlePersonUdhar,
        clearPersonTransactions,
        permanentDeletePersonTransactions,
        permanentDeleteMultipleTransactions,
        refreshTransactions,
        isSupabaseConnected,
        recycleBinTransactions,
        restoreTransaction,
        permanentDeleteTransaction,
        dynamicSections,
        refreshSections,
        addSection,
        updateSection,
        deleteSection,
        maintenanceSettings,
        updateMaintenanceSettings,
        appBranding,
        updateAppBranding,
        notifications,
        refreshNotifications,
        createNotification,
        deactivateNotification,
        allGlobalTransactions,
      }}
    >
      {children}
    </ExpenseContext.Provider>
  );
};

export const useExpense = () => {
  const context = useContext(ExpenseContext);
  if (!context) {
    throw new Error('useExpense must be used within an ExpenseProvider');
  }
  return context;
};
