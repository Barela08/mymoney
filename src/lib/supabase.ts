import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import {
  Transaction,
  DynamicSection,
  MaintenanceSettings,
  AppBrandingSettings,
  BroadcastNotification,
  FeedbackItem,
  FeedbackStatus,
} from '../types';

const STORAGE_KEY_URL = 'my_money_supabase_url';
const STORAGE_KEY_KEY = 'my_money_supabase_key';

const DEFAULT_SUPABASE_URL = 'https://frgrfajnrzqwnevhlrio.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_RHVRSE_Z4R1Qit3djpOfCA_L93zsRjg';

export function normalizeValidSupabaseUrl(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  let candidate = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!candidate) return '';

  // Allow bare Supabase domain without scheme (e.g. "xyz.supabase.co")
  if (!/^https?:\/\//i.test(candidate)) {
    if (/^[a-z0-9-]+\.supabase\.co(\/.*)?$/i.test(candidate)) {
      candidate = `https://${candidate}`;
    } else {
      return '';
    }
  }

  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.hostname &&
      (parsed.hostname.includes('.') || parsed.hostname === 'localhost')
    ) {
      return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''));
    }
  } catch {
    return '';
  }
  return '';
}

function normalizeValidSupabaseKey(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const candidate = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!candidate) return '';
  // Reject URLs accidentally pasted into the key field
  if (/^(https?|postgres(ql)?):\/\//i.test(candidate)) return '';
  return candidate;
}

export function getSavedSupabaseConfig(): { url: string; key: string } {
  const envUrl = normalizeValidSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
  const envKey = normalizeValidSupabaseKey(import.meta.env.VITE_SUPABASE_ANON_KEY);

  let rawLocalUrl = '';
  let rawLocalKey = '';
  try {
    rawLocalUrl = localStorage.getItem(STORAGE_KEY_URL) || '';
    rawLocalKey = localStorage.getItem(STORAGE_KEY_KEY) || '';
  } catch {}

  const localUrl = normalizeValidSupabaseUrl(rawLocalUrl);
  const localKey = normalizeValidSupabaseKey(rawLocalKey);

  // Self-heal corrupted localStorage values so invalid URLs don't persist
  if (rawLocalUrl && !localUrl) {
    try {
      localStorage.removeItem(STORAGE_KEY_URL);
    } catch {}
  }
  if (rawLocalKey && !localKey) {
    try {
      localStorage.removeItem(STORAGE_KEY_KEY);
    } catch {}
  }

  return {
    url: localUrl || envUrl || DEFAULT_SUPABASE_URL,
    key: localKey || envKey || DEFAULT_SUPABASE_KEY,
  };
}

export function saveSupabaseConfig(url: string, key: string) {
  const validUrl = normalizeValidSupabaseUrl(url);
  if (validUrl) localStorage.setItem(STORAGE_KEY_URL, validUrl);
  else localStorage.removeItem(STORAGE_KEY_URL);

  const validKey = normalizeValidSupabaseKey(key);
  if (validKey) localStorage.setItem(STORAGE_KEY_KEY, validKey);
  else localStorage.removeItem(STORAGE_KEY_KEY);

  resetSupabaseClient();
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const { url, key } = getSavedSupabaseConfig();
  const safeUrl = normalizeValidSupabaseUrl(url);
  if (!safeUrl || !key) {
    return null;
  }
  if (!supabaseInstance) {
    try {
      supabaseInstance = createClient(safeUrl, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
        realtime: {
          params: {
            eventsPerSecond: 40,
          },
        },
      });
    } catch (e) {
      console.warn('Failed to initialize Supabase client:', e);
      return null;
    }
  }
  return supabaseInstance;
}

export function resetSupabaseClient() {
  supabaseInstance = null;
  return getSupabaseClient();
}

export async function testSupabaseConnection(
  url: string,
  key: string
): Promise<{ success: boolean; message: string; user?: User | null }> {
  try {
    const safeUrl = normalizeValidSupabaseUrl(url);
    if (!safeUrl) {
      return {
        success: false,
        message: 'Invalid Supabase URL. Please enter a valid https:// project URL.',
      };
    }
    const client = createClient(safeUrl, key.trim());
    // Test auth session first
    const { data: authData } = await client.auth.getSession();

    // Test transactions table query
    const { data, error } = await client.from('transactions').select('id').limit(1);
    if (error) {
      if (
        error.message.includes('relation "public.transactions" does not exist') ||
        error.code === '42P01'
      ) {
        return {
          success: false,
          message:
            'Connected to Supabase, but "transactions" table was not found. Please run the SQL schema in Supabase SQL editor.',
        };
      }
      // If error is code PGRST116 or permission error from RLS, it means table exists
      if (error.code !== 'PGRST116' && !error.message.includes('row-level security')) {
        console.warn('Supabase test query warning:', error.message);
      }
    }

    return {
      success: true,
      message: 'Successfully connected to Supabase Database!',
      user: authData.session?.user || null,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Could not connect to Supabase. Please verify URL and Anon Key.',
    };
  }
}

// ==========================================
// SUPABASE TRANSACTION DATABASE OPERATIONS
// ==========================================

export async function fetchTransactionsFromSupabase(
  userId?: string,
  includeDeleted: boolean = false
): Promise<Transaction[]> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  let query = client
    .from('transactions')
    .select('*')
    .order('transaction_date', { ascending: false })
    .order('transaction_time', { ascending: false });

  if (userId) {
    query = query.eq('user_id', userId);
  }

  if (!includeDeleted) {
    // Exclude soft-deleted records for normal views
    query = query.or('is_deleted.is.null,is_deleted.eq.false');
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching transactions from Supabase:', error);
    throw error;
  }

  return (data || []).map(mapRowToTransaction);
}

export function mapRowToTransaction(row: any): Transaction {
  return {
    id: row.id,
    user_id: row.user_id,
    user_email: row.user_email || undefined,
    category: row.category,
    subcategory: row.subcategory,
    transaction_type: row.transaction_type,
    amount: Number(row.amount),
    title: row.title,
    description: row.description || undefined,
    person_name: row.person_name || undefined,
    transaction_date: row.transaction_date,
    transaction_time: row.transaction_time,
    notes: row.notes || undefined,
    metadata: row.metadata || {},
    is_deleted: Boolean(row.is_deleted),
    deleted_at: row.deleted_at || undefined,
    deleted_by: row.deleted_by || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function saveTransactionToSupabase(tx: Transaction): Promise<Transaction> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  // Validate UUID or let Postgres gen_random_uuid() generate it
  const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tx.id);

  const payload: Record<string, any> = {
    ...(isValidUuid ? { id: tx.id } : {}),
    user_id: tx.user_id,
    user_email: tx.user_email || null,
    category: tx.category,
    subcategory: tx.subcategory,
    transaction_type: tx.transaction_type,
    amount: tx.amount,
    title: tx.title,
    description: tx.description || null,
    person_name: tx.person_name || null,
    transaction_date: tx.transaction_date,
    transaction_time: tx.transaction_time,
    notes: tx.notes || null,
    metadata: tx.metadata || {},
    is_deleted: Boolean(tx.is_deleted),
    deleted_at: tx.deleted_at || null,
    deleted_by: tx.deleted_by || null,
    created_at: tx.created_at || new Date().toISOString(),
    updated_at: tx.updated_at || new Date().toISOString(),
  };

  const { data, error } = await client.from('transactions').upsert(payload).select().single();
  if (error) {
    console.error('Error saving transaction to Supabase:', error);
    throw error;
  }

  // Trigger automated in-app, external push & email transaction notification
  if (!tx.is_deleted) {
    try {
      const { getStoredSessionToken } = await import('./authApi');
      const token = getStoredSessionToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      fetch('/api/notifications/events/transaction-created', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          id: data?.id || tx.id,
          title: tx.title,
          amount: tx.amount,
          type: tx.transaction_type,
          category: tx.subcategory,
          section: tx.category,
        }),
      })
        .then(() => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('mymoney:notifications-refresh'));
          }
        })
        .catch(() => {});
    } catch {}
  }

  return {
    ...tx,
    id: data?.id || tx.id,
    user_email: data?.user_email || tx.user_email,
    created_at: data?.created_at || tx.created_at,
    updated_at: data?.updated_at || tx.updated_at,
  };
}

export async function updateTransactionInSupabase(
  id: string,
  updates: Partial<Transaction>
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  const payload: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.category !== undefined) payload.category = updates.category;
  if (updates.subcategory !== undefined) payload.subcategory = updates.subcategory;
  if (updates.transaction_type !== undefined) payload.transaction_type = updates.transaction_type;
  if (updates.amount !== undefined) payload.amount = updates.amount;
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.description !== undefined) payload.description = updates.description || null;
  if (updates.person_name !== undefined) payload.person_name = updates.person_name || null;
  if (updates.transaction_date !== undefined) payload.transaction_date = updates.transaction_date;
  if (updates.transaction_time !== undefined) payload.transaction_time = updates.transaction_time;
  if (updates.notes !== undefined) payload.notes = updates.notes || null;
  if (updates.metadata !== undefined) payload.metadata = updates.metadata;
  if (updates.is_deleted !== undefined) payload.is_deleted = updates.is_deleted;
  if (updates.deleted_at !== undefined) payload.deleted_at = updates.deleted_at || null;
  if (updates.deleted_by !== undefined) payload.deleted_by = updates.deleted_by || null;

  const { error } = await client.from('transactions').update(payload).eq('id', id);
  if (error) {
    console.error('Error updating transaction in Supabase:', error);
    throw error;
  }
}

/**
 * Soft delete: Move transaction to Recycle Bin
 */
export async function softDeleteTransactionFromSupabase(id: string, deletedBy?: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  const { error } = await client
    .from('transactions')
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Error soft-deleting transaction from Supabase:', error);
    throw error;
  }
}

/**
 * Restore transaction from Recycle Bin
 */
export async function restoreTransactionInSupabase(id: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  const { error } = await client
    .from('transactions')
    .update({
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Error restoring transaction in Supabase:', error);
    throw error;
  }
}

/**
 * Permanent hard delete: Irreversibly delete transaction
 */
export async function permanentDeleteTransactionFromSupabase(id: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  const { error } = await client.from('transactions').delete().eq('id', id);
  if (error) {
    console.error('Error permanently deleting transaction from Supabase:', error);
    throw error;
  }
}

/**
 * Permanent hard delete for multiple transactions: Irreversibly delete transactions
 */
export async function permanentDeleteTransactionsFromSupabase(ids: string[]): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');
  if (!ids || ids.length === 0) return;

  const { error } = await client.from('transactions').delete().in('id', ids);
  if (error) {
    console.error('Error permanently deleting transactions from Supabase:', error);
    throw error;
  }
}

// ==========================================
// DYNAMIC SECTIONS OPERATIONS
// ==========================================

export async function fetchSectionsFromSupabase(): Promise<DynamicSection[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('sections')
      .select('*')
      .order('display_order', { ascending: true });

    if (error) {
      console.warn('Error fetching sections from Supabase:', error.message);
      return [];
    }
    return data || [];
  } catch {
    return [];
  }
}

export async function saveSectionToSupabase(section: DynamicSection): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  const { error } = await client.from('sections').upsert({
    id: section.id,
    name: section.name,
    icon: section.icon,
    description: section.description || null,
    display_order: section.display_order,
    is_enabled: section.is_enabled,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Error saving section in Supabase:', error);
    throw error;
  }
}

export async function deleteSectionFromSupabase(id: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  const { error } = await client.from('sections').delete().eq('id', id);
  if (error) {
    console.error('Error deleting section from Supabase:', error);
    throw error;
  }
}

// ==========================================
// APP SETTINGS & MAINTENANCE MODE
// ==========================================

export async function fetchAppSettingFromSupabase<T>(key: string): Promise<T | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .single();

    if (error || !data) return null;
    return data.value as T;
  } catch {
    return null;
  }
}

export async function saveAppSettingToSupabase(key: string, value: any, updatedBy?: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  const { error } = await client.from('app_settings').upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy || null,
  });

  if (error) {
    console.error(`Error saving app setting '${key}' to Supabase:`, error);
    throw error;
  }
}

// ==========================================
// NOTIFICATIONS & ANNOUNCEMENTS
// ==========================================

export async function fetchNotificationsFromSupabase(): Promise<BroadcastNotification[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('notifications')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

export async function saveNotificationToSupabase(notif: Partial<BroadcastNotification>): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  const { error } = await client.from('notifications').insert({
    title: notif.title,
    message: notif.message,
    type: notif.type || 'info',
    target_user_id: notif.target_user_id || 'all',
    is_active: true,
  });

  if (error) throw error;
}

export async function deactivateNotificationInSupabase(id: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  await client.from('notifications').update({ is_active: false }).eq('id', id);
}

// ==========================================
// REAL-TIME LISTENER
// ==========================================

export type RealtimeTransactionEvent = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRecord?: Transaction;
  oldId?: string;
  rawPayload: any;
};

export function subscribeToSupabaseTransactions(
  onChanged: (event?: RealtimeTransactionEvent) => void
): () => void {
  const client = getSupabaseClient();
  if (!client) return () => {};

  const channel = client
    .channel('realtime_transactions_' + Math.random().toString(36).substring(2, 7))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'transactions' },
      (payload) => {
        try {
          const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
          const newRecord = payload.new && Object.keys(payload.new).length > 0
            ? mapRowToTransaction(payload.new)
            : undefined;
          const oldId = (payload.old as any)?.id || (payload.new as any)?.id;

          onChanged({
            eventType,
            newRecord,
            oldId,
            rawPayload: payload,
          });
        } catch (err) {
          console.warn('Realtime event parse warning:', err);
          onChanged();
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[Realtime] Fast connection established for transactions');
      }
    });

  return () => {
    try {
      client.removeChannel(channel);
    } catch {}
  };
}

// ==========================================
// FEEDBACK & COMPLAINTS DATABASE OPERATIONS
// ==========================================

export async function fetchFeedbacksFromSupabase(userId?: string): Promise<FeedbackItem[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    let query = client
      .from('feedbacks')
      .select('*')
      .order('created_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('Error fetching feedbacks from Supabase:', error.message);
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      user_name: row.user_name,
      user_email: row.user_email,
      user_phone: row.user_phone || undefined,
      type: row.type,
      category: row.category || undefined,
      subject: row.subject,
      message: row.message,
      rating: row.rating ? Number(row.rating) : undefined,
      urgency: row.urgency || 'normal',
      dpdp_consent: Boolean(row.dpdp_consent),
      dpdp_consent_at: row.dpdp_consent_at || undefined,
      status: row.status,
      admin_notes: row.admin_notes || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  } catch (err: any) {
    console.warn('fetchFeedbacksFromSupabase failed:', err.message);
    return [];
  }
}

export async function submitFeedbackToSupabase(
  payload: Omit<FeedbackItem, 'id' | 'created_at' | 'updated_at'>
): Promise<FeedbackItem | null> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  const nowIso = new Date().toISOString();
  const insertPayload = {
    user_id: payload.user_id || null,
    user_name: payload.user_name,
    user_email: payload.user_email,
    user_phone: payload.user_phone || null,
    type: payload.type,
    category: payload.category || null,
    subject: payload.subject,
    message: payload.message,
    rating: payload.rating || null,
    urgency: payload.urgency || 'normal',
    dpdp_consent: Boolean(payload.dpdp_consent),
    dpdp_consent_at: payload.dpdp_consent ? (payload.dpdp_consent_at || nowIso) : null,
    status: 'pending',
    admin_notes: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { data, error } = await client
    .from('feedbacks')
    .insert([insertPayload])
    .select()
    .single();

  if (error) {
    console.error('Error submitting feedback to Supabase:', error);
    throw error;
  }

  return data as FeedbackItem;
}

export async function updateFeedbackStatusInSupabase(
  id: string,
  status: FeedbackStatus,
  adminNotes?: string
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  const updates: Record<string, any> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (adminNotes !== undefined) {
    updates.admin_notes = adminNotes;
  }

  const { error } = await client.from('feedbacks').update(updates).eq('id', id);
  if (error) {
    console.error('Error updating feedback in Supabase:', error);
    throw error;
  }
}

export async function deleteFeedbackFromSupabase(id: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');

  const { error } = await client.from('feedbacks').delete().eq('id', id);
  if (error) {
    console.error('Error deleting feedback from Supabase:', error);
    throw error;
  }
}

export function subscribeToSupabaseFeedbacks(onChanged: () => void): () => void {
  const client = getSupabaseClient();
  if (!client) return () => {};

  const channel = client
    .channel('realtime_feedbacks_' + Math.random().toString(36).substring(2, 7))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'feedbacks' },
      () => {
        onChanged();
      }
    )
    .subscribe();

  return () => {
    try {
      client.removeChannel(channel);
    } catch {}
  };
}

export function subscribeToSupabaseUdharRealtime(
  onChanged: (table: 'udhar_transactions' | 'udhar_repayments' | 'udhar_contacts' | 'user_connections') => void
): () => void {
  const client = getSupabaseClient();
  if (!client) return () => {};

  const channel = client
    .channel('realtime_shared_udhar_' + Math.random().toString(36).substring(2, 7))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'udhar_transactions' }, () => {
      onChanged('udhar_transactions');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'udhar_repayments' }, () => {
      onChanged('udhar_repayments');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'udhar_contacts' }, () => {
      onChanged('udhar_contacts');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_connections' }, () => {
      onChanged('user_connections');
    })
    .subscribe();

  return () => {
    try {
      client.removeChannel(channel);
    } catch {}
  };
}

