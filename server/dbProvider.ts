/**
 * Centralized Database Provider Abstraction Layer
 * My Money Manager by HackifyPro
 *
 * Routes reads and writes cleanly through the authoritative active provider:
 * - Normal operation (`supabase`): reads & writes against PostgreSQL / Supabase REST,
 *   then enqueues an idempotent outbox event for Firebase secondary replication.
 * - Controlled failover (`firebase`): reads & supported writes execute against Firebase
 *   with fencing-epoch enforcement and enqueue reverse-reconciliation outbox events
 *   (`sourceDb: 'firebase', targetDb: 'supabase'`) for safe switchback on recovery.
 * - Both unavailable (`degraded_readonly`): allows safe cached/mirror reads where safe,
 *   and strictly REJECTS financial writes (HTTP 503) — never displaying fake success.
 */

import crypto from 'crypto';
import { query, isDatabaseAvailable } from './db.js';
import { sbRestRequest } from './supabaseRestFallback.js';
import {
  listSecondaryCollection,
  upsertSecondaryRecord,
  getSecondaryRecord,
} from './firebaseDb.js';
import {
  getFailoverState,
  assertAuthoritativeWriteEpoch,
  enqueueOutboxEvent,
  processOutboxQueue,
  type DbProvider,
} from './dbFailover.js';

export interface ProviderOperationResult<T = any> {
  ok: boolean;
  provider: DbProvider;
  epoch: number;
  data?: T;
  status: number;
  code?: string;
  error?: string;
}

export interface TransactionRecordInput {
  id?: string;
  user_id: string;
  user_email?: string | null;
  category: string;
  subcategory: string;
  transaction_type: 'income' | 'expense' | 'transfer';
  amount: number;
  title: string;
  description?: string | null;
  person_name?: string | null;
  transaction_date: string;
  transaction_time: string;
  notes?: string | null;
  metadata?: Record<string, any>;
  is_deleted?: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

function normalizeTxRow(row: any): Record<string, any> {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    user_email: row.user_email || null,
    category: String(row.category || 'other'),
    subcategory: String(row.subcategory || 'General'),
    transaction_type: row.transaction_type || 'expense',
    amount: Number(row.amount || 0),
    title: String(row.title || ''),
    description: row.description || null,
    person_name: row.person_name || null,
    transaction_date: String(row.transaction_date || new Date().toISOString().slice(0, 10)),
    transaction_time: String(row.transaction_time || '00:00'),
    notes: row.notes || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    is_deleted: Boolean(row.is_deleted),
    deleted_at: row.deleted_at || null,
    deleted_by: row.deleted_by || null,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

/**
 * Helper to mirror any primary-committed business entity (profiles, udhar, contacts,
 * connections, notifications, settings) into the transactional outbox & Firebase secondary.
 */
export async function syncBusinessRecordToSecondary(params: {
  collection: string;
  recordId: string;
  payload: Record<string, any>;
  operation?: 'upsert' | 'delete';
  idempotencyKey?: string;
  syncVersion?: number;
}): Promise<void> {
  if (!params.recordId) return;
  const version = params.syncVersion || Date.now();
  const key =
    params.idempotencyKey ||
    `sync_${params.collection}_${params.recordId}_${params.operation || 'upsert'}_${version}`;

  await enqueueOutboxEvent({
    idempotencyKey: key,
    collection: params.collection,
    recordId: params.recordId,
    operation: params.operation || 'upsert',
    payload: params.payload,
    syncVersion: version,
    sourceDb: 'supabase',
    targetDb: 'firebase',
  }).catch(() => {});

  // Best-effort bounded background drain (never blocks the primary response)
  void processOutboxQueue(10).catch(() => {});
}

/**
 * Lists transactions for a user (or all for admin) via the active provider.
 */
export async function listUserTransactionsViaProvider(params: {
  userId?: string;
  includeDeleted?: boolean;
  limit?: number;
}): Promise<ProviderOperationResult<any[]>> {
  const failover = getFailoverState();
  const limit = Math.max(1, Math.min(params.limit || 1500, 2000));

  // Failover read path: Firebase secondary
  if (failover.activeProvider === 'firebase' || failover.activeProvider === 'degraded_readonly') {
    try {
      const docs = await listSecondaryCollection('transactions', params.userId, Boolean(params.includeDeleted));
      const rows = docs
        .map((d) => normalizeTxRow({ id: d.id, ...d.data }))
        .filter((r) => params.includeDeleted || !r.is_deleted)
        .sort((a, b) => {
          const da = `${a.transaction_date}T${a.transaction_time}`;
          const db = `${b.transaction_date}T${b.transaction_time}`;
          return db.localeCompare(da);
        })
        .slice(0, limit);
      return { ok: true, provider: failover.activeProvider, epoch: failover.providerEpoch, status: 200, data: rows };
    } catch (err: any) {
      return {
        ok: false,
        provider: failover.activeProvider,
        epoch: failover.providerEpoch,
        status: 503,
        code: 'SECONDARY_READ_UNAVAILABLE',
        error: err?.message || 'Secondary database unavailable.',
      };
    }
  }

  // Primary read path: PostgreSQL -> Supabase PostgREST -> Firebase read fallback
  if (isDatabaseAvailable()) {
    try {
      const whereParts: string[] = [];
      const values: any[] = [];
      if (params.userId) {
        values.push(params.userId);
        whereParts.push(`user_id = $${values.length}`);
      }
      if (!params.includeDeleted) {
        whereParts.push(`COALESCE(is_deleted, FALSE) = FALSE`);
      }
      values.push(limit);
      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
      const res = await query(
        `SELECT * FROM public.transactions
         ${whereClause}
         ORDER BY transaction_date DESC, transaction_time DESC
         LIMIT $${values.length}`,
        values
      );
      return {
        ok: true,
        provider: 'supabase',
        epoch: failover.providerEpoch,
        status: 200,
        data: (res.rows || []).map(normalizeTxRow),
      };
    } catch {
      // Fall through to Supabase PostgREST
    }
  }

  const qsParts = ['select=*', 'order=transaction_date.desc,transaction_time.desc', `limit=${limit}`];
  if (params.userId) qsParts.push(`user_id=eq.${encodeURIComponent(params.userId)}`);
  if (!params.includeDeleted) qsParts.push('or=(is_deleted.is.null,is_deleted.eq.false)');

  const restRes = await sbRestRequest<any[]>(`transactions?${qsParts.join('&')}`, { timeoutMs: 6500 });
  if (restRes.ok && Array.isArray(restRes.data)) {
    return {
      ok: true,
      provider: 'supabase',
      epoch: failover.providerEpoch,
      status: 200,
      data: restRes.data.map(normalizeTxRow),
    };
  }

  // Controlled read fallback to Firebase secondary when primary transient error occurs
  try {
    const docs = await listSecondaryCollection('transactions', params.userId, Boolean(params.includeDeleted));
    const rows = docs
      .map((d) => normalizeTxRow({ id: d.id, ...d.data }))
      .filter((r) => params.includeDeleted || !r.is_deleted);
    return {
      ok: true,
      provider: 'firebase',
      epoch: failover.providerEpoch,
      status: 200,
      data: rows,
    };
  } catch {
    return {
      ok: false,
      provider: 'supabase',
      epoch: failover.providerEpoch,
      status: 503,
      code: 'DATABASE_UNAVAILABLE',
      error: restRes.error || 'Unable to load transactions from primary or secondary database.',
    };
  }
}

/**
 * Authoritative write for creating/updating a financial transaction with split-brain fencing
 * and idempotent outbox synchronization.
 */
export async function upsertUserTransactionViaProvider(params: {
  tx: TransactionRecordInput;
  idempotencyKey?: string;
}): Promise<ProviderOperationResult<Record<string, any>>> {
  const failover = getFailoverState();
  const guard = assertAuthoritativeWriteEpoch(failover.providerEpoch, failover.activeProvider);
  if (!guard.allowed) {
    return {
      ok: false,
      provider: failover.activeProvider,
      epoch: failover.providerEpoch,
      status: 503,
      code: 'WRITE_BLOCKED_DEGRADED_MODE',
      error: guard.reason || 'Financial writes are temporarily paused while databases recover.',
    };
  }

  const nowIso = new Date().toISOString();
  const txId =
    params.tx.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.tx.id)
      ? params.tx.id
      : crypto.randomUUID();
  const syncVersion = Date.now();
  const idempotencyKey = params.idempotencyKey || `tx_upsert_${txId}_${syncVersion}`;

  const record = normalizeTxRow({
    ...params.tx,
    id: txId,
    created_at: params.tx.created_at || nowIso,
    updated_at: nowIso,
  });

  // 1. Active provider is Firebase (controlled failover write)
  if (failover.activeProvider === 'firebase') {
    const fbRes = await upsertSecondaryRecord({
      id: record.id,
      collection: 'transactions',
      data: record,
      sync_version: syncVersion,
      source_db: 'firebase',
      idempotency_key: idempotencyKey,
      updated_at: nowIso,
      created_at: record.created_at,
      deleted_at: record.is_deleted ? record.deleted_at || nowIso : null,
    });
    if (!fbRes.ok) {
      return {
        ok: false,
        provider: 'firebase',
        epoch: failover.providerEpoch,
        status: 503,
        code: 'FAILOVER_WRITE_FAILED',
        error: fbRes.error || 'Could not durably record transaction in secondary database.',
      };
    }

    // Queue reverse reconciliation back to Supabase once primary recovers
    await enqueueOutboxEvent({
      idempotencyKey,
      collection: 'transactions',
      recordId: record.id,
      operation: record.is_deleted ? 'delete' : 'upsert',
      payload: record,
      syncVersion,
      sourceDb: 'firebase',
      targetDb: 'supabase',
    });

    return { ok: true, provider: 'firebase', epoch: failover.providerEpoch, status: 200, data: record };
  }

  // 2. Active provider is Supabase (normal primary write)
  let savedRow: Record<string, any> | null = null;
  let primaryError: string | undefined;

  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `INSERT INTO public.transactions (
           id, user_id, user_email, category, subcategory, transaction_type, amount, title,
           description, person_name, transaction_date, transaction_time, notes, metadata,
           is_deleted, deleted_at, deleted_by, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10, $11, $12, $13, $14::jsonb,
           $15, $16, $17, $18::timestamptz, $19::timestamptz
         )
         ON CONFLICT (id) DO UPDATE SET
           category = EXCLUDED.category,
           subcategory = EXCLUDED.subcategory,
           transaction_type = EXCLUDED.transaction_type,
           amount = EXCLUDED.amount,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           person_name = EXCLUDED.person_name,
           transaction_date = EXCLUDED.transaction_date,
           transaction_time = EXCLUDED.transaction_time,
           notes = EXCLUDED.notes,
           metadata = EXCLUDED.metadata,
           is_deleted = EXCLUDED.is_deleted,
           deleted_at = EXCLUDED.deleted_at,
           deleted_by = EXCLUDED.deleted_by,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          record.id,
          record.user_id,
          record.user_email,
          record.category,
          record.subcategory,
          record.transaction_type,
          record.amount,
          record.title,
          record.description,
          record.person_name,
          record.transaction_date,
          record.transaction_time,
          record.notes,
          JSON.stringify(record.metadata || {}),
          record.is_deleted,
          record.deleted_at,
          record.deleted_by,
          record.created_at,
          record.updated_at,
        ]
      );
      if (res.rows[0]) {
        savedRow = normalizeTxRow(res.rows[0]);
      }
    } catch (err: any) {
      primaryError = err?.message || 'Primary PostgreSQL write failed';
    }
  }

  if (!savedRow) {
    const restRes = await sbRestRequest<any[]>('transactions', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: record,
      timeoutMs: 6500,
    });
    if (restRes.ok) {
      savedRow = Array.isArray(restRes.data) && restRes.data[0] ? normalizeTxRow(restRes.data[0]) : record;
    } else {
      primaryError = restRes.error || primaryError || `Supabase REST HTTP ${restRes.status}`;
    }
  }

  if (!savedRow) {
    // Do NOT silently accept or fake success when primary write fails while activeProvider is still supabase
    return {
      ok: false,
      provider: 'supabase',
      epoch: failover.providerEpoch,
      status: 503,
      code: 'PRIMARY_WRITE_FAILED',
      error: primaryError || 'Primary database could not durably commit transaction.',
    };
  }

  // Enqueue idempotent outbox replication to Firebase secondary
  await enqueueOutboxEvent({
    idempotencyKey,
    collection: 'transactions',
    recordId: savedRow.id,
    operation: savedRow.is_deleted ? 'delete' : 'upsert',
    payload: savedRow,
    syncVersion,
    sourceDb: 'supabase',
    targetDb: 'firebase',
  });
  void processOutboxQueue(10).catch(() => {});

  return { ok: true, provider: 'supabase', epoch: failover.providerEpoch, status: 200, data: savedRow };
}

/**
 * Authoritative soft-delete, restore, or permanent delete for a user transaction.
 */
export async function mutateUserTransactionDeleteStateViaProvider(params: {
  id: string;
  userId: string;
  isAdmin: boolean;
  action: 'soft_delete' | 'restore' | 'permanent_delete';
  deletedBy?: string;
}): Promise<ProviderOperationResult<{ id: string; action: string }>> {
  const failover = getFailoverState();
  const guard = assertAuthoritativeWriteEpoch(failover.providerEpoch, failover.activeProvider);
  if (!guard.allowed) {
    return {
      ok: false,
      provider: failover.activeProvider,
      epoch: failover.providerEpoch,
      status: 503,
      code: 'WRITE_BLOCKED_DEGRADED_MODE',
      error: guard.reason,
    };
  }

  const nowIso = new Date().toISOString();
  const syncVersion = Date.now();
  const idempotencyKey = `tx_${params.action}_${params.id}_${syncVersion}`;

  if (failover.activeProvider === 'firebase') {
    const existing = await getSecondaryRecord('transactions', params.id);
    if (!existing || (!params.isAdmin && existing.data?.user_id !== params.userId)) {
      return {
        ok: false,
        provider: 'firebase',
        epoch: failover.providerEpoch,
        status: 404,
        code: 'NOT_FOUND',
        error: 'Transaction not found or unauthorized.',
      };
    }

    const updatedData = {
      ...existing.data,
      is_deleted: params.action !== 'restore',
      deleted_at: params.action === 'restore' ? null : nowIso,
      deleted_by: params.action === 'restore' ? null : params.deletedBy || params.userId,
      updated_at: nowIso,
    };

    const fbRes = await upsertSecondaryRecord({
      id: params.id,
      collection: 'transactions',
      data: updatedData,
      sync_version: syncVersion,
      source_db: 'firebase',
      idempotency_key: idempotencyKey,
      updated_at: nowIso,
      deleted_at: params.action === 'permanent_delete' ? nowIso : null,
    });
    if (!fbRes.ok) {
      return {
        ok: false,
        provider: 'firebase',
        epoch: failover.providerEpoch,
        status: 503,
        error: fbRes.error || 'Failover delete failed.',
      };
    }

    await enqueueOutboxEvent({
      idempotencyKey,
      collection: 'transactions',
      recordId: params.id,
      operation: params.action === 'restore' ? 'upsert' : 'delete',
      payload: updatedData,
      syncVersion,
      sourceDb: 'firebase',
      targetDb: 'supabase',
    });

    return { ok: true, provider: 'firebase', epoch: failover.providerEpoch, status: 200, data: { id: params.id, action: params.action } };
  }

  // Primary Supabase path
  let committed = false;
  if (isDatabaseAvailable()) {
    try {
      const ownerFilter = params.isAdmin ? '' : ' AND user_id = $2';
      const ownerParams = params.isAdmin ? [params.id] : [params.id, params.userId];
      if (params.action === 'permanent_delete') {
        await query(`DELETE FROM public.transactions WHERE id = $1${ownerFilter}`, ownerParams);
      } else if (params.action === 'soft_delete') {
        await query(
          `UPDATE public.transactions SET is_deleted = TRUE, deleted_at = NOW(), deleted_by = $${ownerParams.length + 1}, updated_at = NOW() WHERE id = $1${ownerFilter}`,
          [...ownerParams, params.deletedBy || params.userId]
        );
      } else {
        await query(
          `UPDATE public.transactions SET is_deleted = FALSE, deleted_at = NULL, deleted_by = NULL, updated_at = NOW() WHERE id = $1${ownerFilter}`,
          ownerParams
        );
      }
      committed = true;
    } catch {}
  }

  if (!committed) {
    const ownerQuery = params.isAdmin ? '' : `&user_id=eq.${encodeURIComponent(params.userId)}`;
    const pathUrl = `transactions?id=eq.${encodeURIComponent(params.id)}${ownerQuery}`;
    const restRes =
      params.action === 'permanent_delete'
        ? await sbRestRequest(pathUrl, { method: 'DELETE', timeoutMs: 6500 })
        : await sbRestRequest(pathUrl, {
            method: 'PATCH',
            body:
              params.action === 'soft_delete'
                ? { is_deleted: true, deleted_at: nowIso, deleted_by: params.deletedBy || params.userId, updated_at: nowIso }
                : { is_deleted: false, deleted_at: null, deleted_by: null, updated_at: nowIso },
            timeoutMs: 6500,
          });
    if (!restRes.ok) {
      return {
        ok: false,
        provider: 'supabase',
        epoch: failover.providerEpoch,
        status: 503,
        error: restRes.error || 'Primary transaction mutation failed.',
      };
    }
  }

  await enqueueOutboxEvent({
    idempotencyKey,
    collection: 'transactions',
    recordId: params.id,
    operation: params.action === 'restore' ? 'upsert' : 'delete',
    payload: {
      id: params.id,
      user_id: params.userId,
      is_deleted: params.action !== 'restore',
      deleted_at: params.action === 'restore' ? null : nowIso,
      updated_at: nowIso,
    },
    syncVersion,
    sourceDb: 'supabase',
    targetDb: 'firebase',
  });
  void processOutboxQueue(10).catch(() => {});

  return { ok: true, provider: 'supabase', epoch: failover.providerEpoch, status: 200, data: { id: params.id, action: params.action } };
}
