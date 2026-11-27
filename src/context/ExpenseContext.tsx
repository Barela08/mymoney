import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import {
  Transaction,
  NewTransactionPayload,
  FinancialSummary,
  PersonSummary,
  FilterOptions,
  DynamicSection,
  MaintenanceSettings,
  AppDownloadPopupSettings,
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
import { getCurrentISTDate, getCurrentISTTime, formatDisplayTime, getPresetDateRange } from '../lib/dateUtils';
import { computeCategoryTotalsAndCashflow } from '../lib/financialIntelligenceEngine';
import { useAuth } from './AuthContext';
import {
  validateTransactionPayload,
  validateAmount,
  assertResourceOwnership,
  SecurityAuthorizationError,
} from '../lib/security';
import { udharDeletionApi, UdharContact } from '../lib/udharDeletionApi';
import { adminClient } from '../lib/adminApi';

interface ExpenseContextType {
  transactions: Transaction[];
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  summary: FinancialSummary;
  peopleSummaries: PersonSummary[];
  savedContacts: UdharContact[];
  isLoadingContacts: boolean;
  contactsError: string | null;
  refreshContacts: () => Promise<void>;
  filterOptions: FilterOptions;
  setFilterOptions: React.Dispatch<React.SetStateAction<FilterOptions>>;
  filteredTransactions: Transaction[];
  addTransaction: (payload: NewTransactionPayload) => Promise<Transaction>;
  addTransactionBatch: (payloads: NewTransactionPayload[]) => Promise<Transaction[]>;
  editTransaction: (id: string, updates: Partial<NewTransactionPayload>) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<boolean>;
  clearAllTransactions: () => Promise<void>;
  refreshTransactions: () => Promise<void>;
  isSupabaseConnected: boolean;

  // Offline, Network & Sync States
  isOffline: boolean;
  isReconnecting: boolean;
  lastSyncedAt: string;
  pendingSyncCount: number;

  // Undo State
  undoLastDelete: () => Promise<boolean>;

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

  // App Settings, Maintenance Mode & App Download Popup
  maintenanceSettings: MaintenanceSettings;
  refreshSiteConfig: () => Promise<void>;
  updateMaintenanceSettings: (settings: Partial<MaintenanceSettings>) => Promise<boolean>;
  appPopupSettings: AppDownloadPopupSettings;
  updateAppPopupSettings: (settings: Partial<AppDownloadPopupSettings>) => Promise<boolean>;
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
const LOCAL_APP_POPUP_KEY = 'my_money_app_popup_cache';
const LOCAL_BRANDING_KEY = 'my_money_branding_cache';

const DEFAULT_SECTIONS: DynamicSection[] = [
  { id: 'home', name: 'Received Money', icon: 'ArrowDownLeft', description: 'Salary, business, freelancing & all money received', display_order: 1, is_enabled: true },
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

const DEFAULT_APP_POPUP: AppDownloadPopupSettings = {
  enabled: true,
  downloadUrl: '/#install',
  title: 'Install My Money Manager',
  description: 'Install the app for a faster experience and easy access from your home screen.',
  buttonLabel: 'Install Now',
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

export function sanitizeLogoUrl(raw?: string | null): string {
  const val = (raw || '').trim();
  if (!val) return '/logo.jpg';
  if (val.startsWith('/') && !val.startsWith('//')) return val;
  if (/^https:\/\//i.test(val)) return val;
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(val) && val.length <= 750000) {
    return val;
  }
  return '/logo.jpg';
}

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

// Client-side burst protection to prevent double clicks and duplicate entries
const clientMutationHistory: number[] = [];
export function checkClientFinancialRateLimit(maxPerMin = 30): boolean {
  const now = Date.now();
  while (clientMutationHistory.length > 0 && clientMutationHistory[0] < now - 60000) {
    clientMutationHistory.shift();
  }
  if (clientMutationHistory.length >= maxPerMin) {
    return false;
  }
  clientMutationHistory.push(now);
  return true;
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

  const [appPopupSettings, setAppPopupSettings] = useState<AppDownloadPopupSettings>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_APP_POPUP_KEY);
      return saved ? { ...DEFAULT_APP_POPUP, ...JSON.parse(saved) } : DEFAULT_APP_POPUP;
    } catch {
      return DEFAULT_APP_POPUP;
    }
  });

  const [appBranding, setAppBranding] = useState<AppBrandingSettings>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_BRANDING_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_BRANDING,
          ...parsed,
          logoUrl: sanitizeLogoUrl(parsed?.logoUrl),
        };
      }
      return DEFAULT_BRANDING;
    } catch {
      return DEFAULT_BRANDING;
    }
  });

  // Live-sync browser tab title and favicon whenever Admin updates App Branding or Logo
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const title = appBranding.appName?.trim() || 'My Money Manager';
    const sub = appBranding.subTitle?.trim() || 'by HackifyPro';
    document.title = sub ? `${title} — ${sub}` : title;
    const safeLogo = sanitizeLogoUrl(appBranding.logoUrl);
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) {
      favicon.href = safeLogo;
    }
  }, [appBranding.appName, appBranding.subTitle, appBranding.logoUrl]);

  const [notifications, setNotifications] = useState<BroadcastNotification[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupabaseConnected, setIsSupabaseConnected] = useState<boolean>(false);
  const [isOffline, setIsOffline] = useState<boolean>(typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>(() => {
    return formatDisplayTime(getCurrentISTTime());
  });
  const [lastDeletedTx, setLastDeletedTx] = useState<Transaction | null>(null);
  const [savedContacts, setSavedContacts] = useState<UdharContact[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState<boolean>(false);
  const [contactsError, setContactsError] = useState<string | null>(null);

  const refreshContacts = useCallback(async () => {
    if (!user) {
      setSavedContacts([]);
      setContactsError(null);
      setIsLoadingContacts(false);
      return;
    }
    setIsLoadingContacts(true);
    setContactsError(null);
    try {
      const res = await udharDeletionApi.getContactsWithBalances().catch(() => udharDeletionApi.getContacts());
      if (res && res.success) {
        setSavedContacts(res.contacts || []);
      } else {
        setContactsError('Unable to load saved people.');
      }
    } catch (e: any) {
      console.warn('[ExpenseContext] Failed to load contacts:', e);
      setContactsError(e?.message || 'Failed to load contacts. Please retry.');
    } finally {
      setIsLoadingContacts(false);
    }
  }, [user]);

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

  const getUserDeletedTombstonesKey = useCallback((uid?: string) => {
    return `my_money_deleted_tx_tombstones_${uid || 'guest'}`;
  }, []);

  const getDeletedTombstones = useCallback((uid?: string): Set<string> => {
    try {
      const raw = localStorage.getItem(getUserDeletedTombstonesKey(uid));
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch {
      return new Set();
    }
  }, [getUserDeletedTombstonesKey]);

  const addDeletedTombstones = useCallback((uid: string | undefined, ids: string[]) => {
    if (!ids.length) return;
    try {
      const set = getDeletedTombstones(uid);
      ids.forEach((id) => set.add(String(id)));
      const trimmed = Array.from(set).slice(-500);
      localStorage.setItem(getUserDeletedTombstonesKey(uid), JSON.stringify(trimmed));
    } catch {}
  }, [getDeletedTombstones, getUserDeletedTombstonesKey]);

  const removeDeletedTombstones = useCallback((uid: string | undefined, ids: string[]) => {
    if (!ids.length) return;
    try {
      const set = getDeletedTombstones(uid);
      ids.forEach((id) => set.delete(String(id)));
      localStorage.setItem(getUserDeletedTombstonesKey(uid), JSON.stringify(Array.from(set)));
    } catch {}
  }, [getDeletedTombstones, getUserDeletedTombstonesKey]);

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

        // Run all public metadata, server site-config, and transactions fetches in PARALLEL
        const [siteConfigRes, sectionsData, maint, popupCfg, brand, notifs, supaData] = await Promise.all([
          fetch('/api/public/site-config', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetchSectionsFromSupabase().catch(() => null),
          fetchAppSettingFromSupabase<MaintenanceSettings>('maintenance_mode').catch(() => null),
          fetchAppSettingFromSupabase<AppDownloadPopupSettings>('app_download_popup').catch(() => null),
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

        const serverMaint = siteConfigRes?.maintenance as MaintenanceSettings | undefined;
        const resolvedMaint = (() => {
          if (serverMaint && maint) {
            const sTs = serverMaint.updatedAt ? Date.parse(serverMaint.updatedAt) : 0;
            const dTs = maint.updatedAt ? Date.parse(maint.updatedAt) : 0;
            return sTs >= dTs ? serverMaint : maint;
          }
          return serverMaint || maint;
        })();

        if (resolvedMaint) {
          setMaintenanceSettings(resolvedMaint);
          localStorage.setItem(LOCAL_MAINTENANCE_KEY, JSON.stringify(resolvedMaint));
        }

        const serverPopup = siteConfigRes?.appPopup as AppDownloadPopupSettings | undefined;
        const resolvedPopup = (() => {
          if (serverPopup && popupCfg) {
            const sTs = serverPopup.updatedAt ? Date.parse(serverPopup.updatedAt) : 0;
            const dTs = popupCfg.updatedAt ? Date.parse(popupCfg.updatedAt) : 0;
            return sTs >= dTs ? serverPopup : popupCfg;
          }
          return serverPopup || popupCfg;
        })();

        if (resolvedPopup) {
          const normalizedPopup = { ...DEFAULT_APP_POPUP, ...resolvedPopup };
          setAppPopupSettings(normalizedPopup);
          localStorage.setItem(LOCAL_APP_POPUP_KEY, JSON.stringify(normalizedPopup));
        }

        if (brand) {
          const normalizedBrand: AppBrandingSettings = {
            ...DEFAULT_BRANDING,
            ...brand,
            logoUrl: sanitizeLogoUrl(brand.logoUrl),
          };
          setAppBranding(normalizedBrand);
          localStorage.setItem(LOCAL_BRANDING_KEY, JSON.stringify(normalizedBrand));
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
          const tombstones = getDeletedTombstones(user.uid);
          const cleanRemote = supaData.filter((t) => !tombstones.has(String(t.id)));

          // Process offline pending queue (ONLY items that explicitly failed to upload and were NOT deleted)
          const pendingQueue = getPendingQueue(user.uid).filter((t) => !tombstones.has(String(t.id)));
          if (pendingQueue.length > 0) {
            const remainingQueue: Transaction[] = [];
            for (const pendingTx of pendingQueue) {
              try {
                const saved = await saveTransactionToSupabase(pendingTx);
                const idx = cleanRemote.findIndex((t) => t.id === pendingTx.id);
                if (idx >= 0) cleanRemote[idx] = saved;
                else cleanRemote.unshift(saved);
              } catch (e) {
                console.warn('Could not sync pending tx from queue:', e);
                remainingQueue.push(pendingTx);
              }
            }
            savePendingQueue(user.uid, remainingQueue);
          } else if (getPendingQueue(user.uid).length > 0) {
            savePendingQueue(user.uid, []);
          }

          // Anti-Data Loss Protection: Ensure local transactions are not obliterated if remote fetch returned empty
          // while NEVER resurrecting tombstoned/deleted records
          const localSaved = localStorage.getItem(getUserTxStorageKey(user.uid));
          let localList: Transaction[] = [];
          try {
            const parsedLocal = localSaved ? JSON.parse(localSaved) : [];
            localList = Array.isArray(parsedLocal)
              ? parsedLocal.filter((t) => !tombstones.has(String(t.id)) && !t.is_deleted)
              : [];
          } catch {}

          let mergedData = cleanRemote;
          if (cleanRemote.length === 0 && localList.length > 0) {
            for (const localTx of localList) {
              saveTransactionToSupabase(localTx).catch(() => {});
            }
            mergedData = localList;
          } else if (cleanRemote.length > 0 && localList.length > 0) {
            const supaIds = new Set(cleanRemote.map((t) => t.id));
            const unsynced = localList.filter((t) => !supaIds.has(t.id));
            if (unsynced.length > 0) {
              for (const u of unsynced) {
                saveTransactionToSupabase(u).catch(() => {});
              }
              mergedData = [...unsynced, ...cleanRemote];
            }
          }

          setAllTransactions(mergedData);
          persistLocally(mergedData);
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

  // Load public site config (Maintenance Mode + App Download Popup + Branding) even for unauthenticated visitors
  const fetchPublicSiteConfig = useCallback(async () => {
    try {
      const [siteRes, maintSupa, popupSupa, brandSupa] = await Promise.all([
        fetch('/api/public/site-config', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetchAppSettingFromSupabase<MaintenanceSettings>('maintenance_mode').catch(() => null),
        fetchAppSettingFromSupabase<AppDownloadPopupSettings>('app_download_popup').catch(() => null),
        fetchAppSettingFromSupabase<AppBrandingSettings>('app_branding').catch(() => null),
      ]);

      const serverMaint = siteRes?.maintenance as MaintenanceSettings | undefined;
      const resolvedMaint = (() => {
        if (serverMaint && maintSupa) {
          const sTs = serverMaint.updatedAt ? Date.parse(serverMaint.updatedAt) : 0;
          const dTs = maintSupa.updatedAt ? Date.parse(maintSupa.updatedAt) : 0;
          return sTs >= dTs ? serverMaint : maintSupa;
        }
        return serverMaint || maintSupa;
      })();
      if (resolvedMaint) {
        setMaintenanceSettings(resolvedMaint);
        localStorage.setItem(LOCAL_MAINTENANCE_KEY, JSON.stringify(resolvedMaint));
      }

      const serverPopup = siteRes?.appPopup as AppDownloadPopupSettings | undefined;
      const resolvedPopup = (() => {
        if (serverPopup && popupSupa) {
          const sTs = serverPopup.updatedAt ? Date.parse(serverPopup.updatedAt) : 0;
          const dTs = popupSupa.updatedAt ? Date.parse(popupSupa.updatedAt) : 0;
          return sTs >= dTs ? serverPopup : popupSupa;
        }
        return serverPopup || popupSupa;
      })();
      if (resolvedPopup) {
        const normalizedPopup = { ...DEFAULT_APP_POPUP, ...resolvedPopup };
        setAppPopupSettings(normalizedPopup);
        localStorage.setItem(LOCAL_APP_POPUP_KEY, JSON.stringify(normalizedPopup));
      }

      if (brandSupa) {
        const normalizedBrand: AppBrandingSettings = {
          ...DEFAULT_BRANDING,
          ...brandSupa,
          logoUrl: sanitizeLogoUrl(brandSupa.logoUrl),
        };
        setAppBranding(normalizedBrand);
        localStorage.setItem(LOCAL_BRANDING_KEY, JSON.stringify(normalizedBrand));
      }
    } catch {
      // Keep cached values if offline
    }
  }, []);

  useEffect(() => {
    fetchPublicSiteConfig();
    const handleFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchPublicSiteConfig();
      }
    };
    const handleMaintenanceDetected = (ev: Event) => {
      const detail = (ev as CustomEvent<{ message?: string; expectedRestoration?: string }>).detail || {};
      setMaintenanceSettings((prev) => {
        const next: MaintenanceSettings = {
          ...prev,
          isEnabled: true,
          message: detail.message || prev.message,
          expectedRestoration: detail.expectedRestoration || prev.expectedRestoration,
          updatedAt: new Date().toISOString(),
        };
        try {
          localStorage.setItem(LOCAL_MAINTENANCE_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
      fetchPublicSiteConfig();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    window.addEventListener('mymoney:maintenance-detected', handleMaintenanceDetected);
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchPublicSiteConfig();
      }
    }, 30000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      window.removeEventListener('mymoney:maintenance-detected', handleMaintenanceDetected);
      clearInterval(interval);
    };
  }, [fetchPublicSiteConfig]);

  // Initial load, multi-device Realtime subscription, and mobile tab wake/focus listener
  useEffect(() => {
    if (!user) return;

    // 1. Initial sync
    syncWithDatabase(false);
    refreshContacts();

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
        refreshContacts();
      }
    };

    const handleOnline = () => {
      setIsOffline(false);
      setIsReconnecting(true);
      Promise.all([syncWithDatabase(true), refreshContacts()]).finally(() => setIsReconnecting(false));
    };
    const handleOffline = () => {
      setIsOffline(true);
    };

    const handleUdharUpdated = () => {
      refreshContacts();
    };

    document.addEventListener('visibilitychange', handleSyncTrigger);
    window.addEventListener('focus', handleSyncTrigger);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('mymoney:udhar-updated', handleUdharUpdated);

    // 4. Polling fallback every 20 seconds when screen is visible
    const pollInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        syncWithDatabase(true);
        refreshContacts();
      }
    }, 20000);

    return () => {
      unsubscribeSupabase();
      document.removeEventListener('visibilitychange', handleSyncTrigger);
      window.removeEventListener('focus', handleSyncTrigger);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('mymoney:udhar-updated', handleUdharUpdated);
      clearInterval(pollInterval);
    };
  }, [user, isAdmin, syncWithDatabase, persistLocally, refreshContacts]);

  const refreshTransactions = async () => {
    await Promise.all([syncWithDatabase(), refreshContacts()]);
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

    if (!checkClientFinancialRateLimit(30)) {
      throw new Error('You have made too many attempts. Please try again after some time.');
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

  // Add batch of 1-3 combined transaction items (each saved individually with shared batch_id)
  const addTransactionBatch = async (payloads: NewTransactionPayload[]): Promise<Transaction[]> => {
    if (!user) {
      throw new SecurityAuthorizationError('Authentication required: You must be logged in to record transactions.');
    }
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new Error('At least one transaction item is required.');
    }
    if (payloads.length > 3) {
      throw new Error('Maximum 3 combined items can be saved in one batch.');
    }
    if (!checkClientFinancialRateLimit(30)) {
      throw new Error('You have made too many attempts. Please try again after some time.');
    }

    const sanitizedList: NewTransactionPayload[] = [];
    for (let i = 0; i < payloads.length; i++) {
      const validation = validateTransactionPayload(payloads[i], user.uid);
      if (!validation.isValid || !validation.sanitizedPayload) {
        throw new Error(`Item ${i + 1}: ${validation.errors.join(' ')}`);
      }
      sanitizedList.push(validation.sanitizedPayload);
    }

    const batchId = payloads.length > 1 ? `batch_${generateSecureUUID()}` : undefined;
    const nowIso = new Date().toISOString();
    const combinedAmount = Math.round(sanitizedList.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;

    const newTxs: Transaction[] = sanitizedList.map((clean, idx) => ({
      id: generateSecureUUID(),
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
      metadata: {
        ...(clean.metadata || {}),
        ...(batchId
          ? {
              batch_id: batchId,
              batch_index: idx + 1,
              batch_total: sanitizedList.length,
              batch_combined_amount: combinedAmount,
            }
          : {}),
      },
      is_deleted: false,
      created_at: nowIso,
      updated_at: nowIso,
    }));

    setAllTransactions((prev) => {
      const updated = [...newTxs.slice().reverse(), ...prev];
      persistLocally(updated);
      return updated;
    });

    const supabase = getSupabaseClient();
    if (supabase) {
      for (const txItem of newTxs) {
        saveTransactionToSupabase(txItem)
          .then((saved) => {
            setIsSupabaseConnected(true);
            setAllTransactions((prev) => {
              const updated = prev.map((t) => (t.id === txItem.id ? { ...saved, user_email: user.email } : t));
              persistLocally(updated);
              return updated;
            });
          })
          .catch((err: any) => {
            console.warn('Supabase batch save notice, queued locally:', err.message);
            const q = getPendingQueue(user.uid);
            savePendingQueue(user.uid, [...q.filter((t) => t.id !== txItem.id), txItem]);
          });
      }
    }

    return newTxs;
  };

  // Edit transaction
  const editTransaction = async (id: string, updates: Partial<NewTransactionPayload>): Promise<Transaction> => {
    if (!user) {
      throw new SecurityAuthorizationError('Authentication required.');
    }

    if (!checkClientFinancialRateLimit(30)) {
      throw new Error('You have made too many attempts. Please try again after some time.');
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

    if (!checkClientFinancialRateLimit(30)) {
      console.warn('Financial rate limit reached for deletion.');
      return false;
    }

    const existing = allTransactions.find((t) => t.id === id);
    if (!existing) return false;

    if (!isAdmin && existing.user_id && existing.user_id !== user.uid) {
      assertResourceOwnership(user.uid, existing.user_id);
    }

    const nowIso = new Date().toISOString();
    setLastDeletedTx(existing);
    addDeletedTombstones(user.uid, [id]);
    savePendingQueue(user.uid, getPendingQueue(user.uid).filter((t) => t.id !== id));
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

    removeDeletedTombstones(user.uid, [id]);
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

  // Undo Last Delete (Reversible soft delete instant recovery)
  const undoLastDelete = useCallback(async (): Promise<boolean> => {
    if (!lastDeletedTx) return false;
    const res = await restoreTransaction(lastDeletedTx.id);
    setLastDeletedTx(null);
    return res;
  }, [lastDeletedTx, restoreTransaction]);

  // Permanent Delete transaction (Irreversible)
  const permanentDeleteTransaction = async (id: string): Promise<boolean> => {
    if (!user) return false;

    addDeletedTombstones(user.uid, [id]);
    savePendingQueue(user.uid, getPendingQueue(user.uid).filter((t) => t.id !== id));
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

    addDeletedTombstones(user.uid, ids);
    const idSet = new Set(ids);
    savePendingQueue(user.uid, getPendingQueue(user.uid).filter((t) => !idSet.has(t.id)));
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

  // App Settings, Maintenance Mode & App Download Popup
  const updateMaintenanceSettings = async (settings: Partial<MaintenanceSettings>): Promise<boolean> => {
    const updated: MaintenanceSettings = {
      ...maintenanceSettings,
      ...settings,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.email || undefined,
    };

    try {
      const res = await adminClient.saveMaintenanceSettings(updated);
      const saved = res?.settings ? { ...updated, ...res.settings } : updated;
      setMaintenanceSettings(saved);
      localStorage.setItem(LOCAL_MAINTENANCE_KEY, JSON.stringify(saved));
      saveAppSettingToSupabase('maintenance_mode', saved, user?.uid).catch(() => {});
      return true;
    } catch (err) {
      try {
        await saveAppSettingToSupabase('maintenance_mode', updated, user?.uid);
        setMaintenanceSettings(updated);
        localStorage.setItem(LOCAL_MAINTENANCE_KEY, JSON.stringify(updated));
        return true;
      } catch {
        throw err;
      }
    }
  };

  const updateAppPopupSettings = async (settings: Partial<AppDownloadPopupSettings>): Promise<boolean> => {
    const merged: AppDownloadPopupSettings = {
      ...appPopupSettings,
      ...settings,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.email || undefined,
    };

    try {
      const res = await adminClient.saveAppPopupSettings(merged);
      const saved = res?.settings ? { ...merged, ...res.settings } : merged;
      setAppPopupSettings(saved);
      localStorage.setItem(LOCAL_APP_POPUP_KEY, JSON.stringify(saved));
      saveAppSettingToSupabase('app_download_popup', saved, user?.uid).catch(() => {});
      return true;
    } catch (err) {
      try {
        await saveAppSettingToSupabase('app_download_popup', merged, user?.uid);
        setAppPopupSettings(merged);
        localStorage.setItem(LOCAL_APP_POPUP_KEY, JSON.stringify(merged));
        return true;
      } catch {
        throw err;
      }
    }
  };

  const updateAppBranding = async (settings: Partial<AppBrandingSettings>): Promise<boolean> => {
    const merged: AppBrandingSettings = {
      ...appBranding,
      ...settings,
    };
    merged.logoUrl = sanitizeLogoUrl(merged.logoUrl);
    if (settings.brandTitle && !settings.appName) {
      merged.appName = settings.brandTitle;
    }
    if (settings.appName && !settings.brandTitle) {
      merged.brandTitle = settings.appName;
    }
    setAppBranding(merged);
    localStorage.setItem(LOCAL_BRANDING_KEY, JSON.stringify(merged));
    try {
      await saveAppSettingToSupabase('app_branding', merged, user?.uid);
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

  // Summary calculated exclusively from the current user's visible transactions (paise-safe canonical engine)
  const summary: FinancialSummary = useMemo(() => {
    const calc = computeCategoryTotalsAndCashflow(userTransactions);
    const remainingHomeBalance = Math.round((calc.totalReceivedMoney - calc.totalHomeSpent) * 100) / 100;

    return {
      totalIncome: calc.totalIncome,
      totalExpenses: calc.totalExpenses,
      availableBalance: calc.availableBalance,
      totalReceivedMoney: calc.totalReceivedMoney,
      totalEarnedIncome: calc.totalEarnedIncome,
      totalOtherIncome: calc.totalOtherIncome,
      totalBorrowedReceived: calc.totalBorrowedReceived,
      totalHomeReceived: calc.totalReceivedMoney,
      totalHomeSpent: calc.totalHomeSpent,
      remainingHomeBalance,
      totalGas: calc.totalGas,
      totalGrocery: calc.totalGrocery,
      totalRent: calc.totalRent,
      totalElectricity: calc.totalElectricity,
      totalRoomExpenses: calc.totalRoomExpenses,
      totalFoodExpenses: calc.totalFoodExpenses,
      totalOtherExpenses: calc.totalOtherExpenses,
      totalMoneyGiven: calc.totalMoneyGiven,
      totalMoneyReceived: calc.totalMoneyReceived,
      netPeopleBalance: calc.netPeopleBalance,
      totalTransactionsCount: userTransactions.length,
    };
  }, [userTransactions]);

  // People summaries for current user (incorporating saved/connected contacts with live Udhar balances + manual ledger)
  const peopleSummaries: PersonSummary[] = useMemo(() => {
    const map = new Map<
      string,
      {
        displayName: string;
        given: number;
        received: number;
        udharNetBalance: number;
        udharHasBalances: boolean;
        udharTxCount: number;
        txs: Transaction[];
        lastDate: string;
        linkedUserId?: string | null;
        email?: string | null;
        phone?: string | null;
        avatarUrl?: string | null;
        relationshipType?: string | null;
        isRegisteredUser?: boolean;
      }
    >();
    const linkedToKey = new Map<string, string>();
    const nameToKey = new Map<string, string>();

    // 1. First seed map with all saved/connected contacts (including authoritative Udhar balance fields)
    for (const c of savedContacts) {
      const displayName = (c.name || '').trim();
      const normName = displayName.toLowerCase();
      const key = c.linked_user_id ? `uid:${c.linked_user_id}` : `name:${normName}`;
      if (!displayName && !c.linked_user_id) continue;

      if (c.linked_user_id) linkedToKey.set(c.linked_user_id, key);
      if (normName) nameToKey.set(normName, key);

      const udharGiven = Number(c.total_given) || 0;
      const udharTaken = Number(c.total_taken) || 0;
      const udharNet = Number(c.net_balance) || 0;
      const udharCount = Number(c.total_transactions_count) || 0;

      if (!map.has(key)) {
        map.set(key, {
          displayName: displayName || c.linked_user_name || 'Connected User',
          given: udharGiven,
          received: udharTaken,
          udharNetBalance: udharNet,
          udharHasBalances: udharCount > 0 || udharGiven > 0 || udharTaken > 0,
          udharTxCount: udharCount,
          txs: [],
          lastDate: c.last_transaction_date || c.created_at?.split('T')[0] || '',
          linkedUserId: c.linked_user_id,
          email: c.email || c.linked_user_email || null,
          phone: c.phone || null,
          avatarUrl: c.linked_user_avatar || c.photo_url || null,
          relationshipType: c.relationship_type,
          isRegisteredUser: Boolean(c.linked_user_id || c.is_registered),
        });
      }
    }

    // 2. Map local/personal ledger transactions onto contacts (deduped case-insensitively)
    for (const tx of userTransactions) {
      if (tx.category === 'people' && tx.person_name) {
        const displayName = tx.person_name.trim();
        const normName = displayName.toLowerCase();
        const metaLinked = (tx.metadata as any)?.linked_user_id || (tx.metadata as any)?.counterpart_user_id || null;
        const resolvedKey =
          (metaLinked && linkedToKey.get(String(metaLinked))) ||
          nameToKey.get(normName) ||
          `name:${normName}`;

        if (!map.has(resolvedKey)) {
          nameToKey.set(normName, resolvedKey);
          map.set(resolvedKey, {
            displayName,
            given: 0,
            received: 0,
            udharNetBalance: 0,
            udharHasBalances: false,
            udharTxCount: 0,
            txs: [],
            lastDate: tx.transaction_date,
            linkedUserId: metaLinked,
            isRegisteredUser: Boolean(metaLinked),
          });
        }

        const data = map.get(resolvedKey)!;
        data.txs.push(tx);
        if (tx.transaction_date > data.lastDate) {
          data.lastDate = tx.transaction_date;
        }
        // Only add local ledger amounts if this person does NOT already come from canonical Udhar totals
        if (!data.udharHasBalances) {
          if (tx.subcategory === 'money_given') {
            data.given += Number(tx.amount) || 0;
          } else {
            data.received += Number(tx.amount) || 0;
          }
        }
      }
    }

    const list: PersonSummary[] = [];
    map.forEach((val) => {
      const balance = val.udharHasBalances
        ? Math.round(val.udharNetBalance * 100) / 100
        : Math.round((val.given - val.received) * 100) / 100;
      const totalCount = val.udharHasBalances ? Math.max(val.udharTxCount, val.txs.length) : val.txs.length;
      list.push({
        name: val.displayName,
        totalGiven: val.given,
        totalReceived: val.received,
        outstandingBalance: balance,
        isSettled: totalCount === 0 || Math.abs(balance) < 0.01,
        transactionCount: totalCount,
        lastTransactionDate: val.lastDate,
        transactions: val.txs.sort((a, b) =>
          (b.transaction_date + b.transaction_time).localeCompare(a.transaction_date + a.transaction_time)
        ),
        linkedUserId: val.linkedUserId,
        email: val.email,
        phone: val.phone,
        avatarUrl: val.avatarUrl,
        relationshipType: val.relationshipType,
        isRegisteredUser: val.isRegisteredUser,
      });
    });

    return list.sort((a, b) => {
      if (Math.abs(b.outstandingBalance) !== Math.abs(a.outstandingBalance)) {
        return Math.abs(b.outstandingBalance) - Math.abs(a.outstandingBalance);
      }
      if (b.transactionCount !== a.transactionCount) {
        return b.transactionCount - a.transactionCount;
      }
      return a.name.localeCompare(b.name);
    });
  }, [userTransactions, savedContacts]);

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

  const pendingSyncCount = useMemo(() => {
    if (!user) return 0;
    return getPendingQueue(user.uid).length;
  }, [user, allTransactions, getPendingQueue]);

  return (
    <ExpenseContext.Provider
      value={{
        transactions: userTransactions,
        isLoading,
        isSyncing,
        error,
        summary,
        peopleSummaries,
        savedContacts,
        isLoadingContacts,
        contactsError,
        refreshContacts,
        filterOptions,
        setFilterOptions,
        filteredTransactions,
        addTransaction,
        addTransactionBatch,
        editTransaction,
        deleteTransaction,
        clearAllTransactions,
        settlePersonUdhar,
        clearPersonTransactions,
        permanentDeletePersonTransactions,
        permanentDeleteMultipleTransactions,
        refreshTransactions,
        isSupabaseConnected,
        isOffline,
        isReconnecting,
        lastSyncedAt,
        pendingSyncCount,
        undoLastDelete,
        recycleBinTransactions,
        restoreTransaction,
        permanentDeleteTransaction,
        dynamicSections,
        refreshSections,
        addSection,
        updateSection,
        deleteSection,
        maintenanceSettings,
        refreshSiteConfig: fetchPublicSiteConfig,
        updateMaintenanceSettings,
        appPopupSettings,
        updateAppPopupSettings,
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
