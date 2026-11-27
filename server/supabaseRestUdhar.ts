import crypto from 'crypto';
import { isDiscoverableNormalUser, type AuthenticatedUser } from './auth.js';
import { purgeUdharNotificationsFallback } from './supabaseRestFallback.js';
import { getSavedUpiProfileForUser, getLatestUpiConsentInfo } from './userAccountExtensions.js';
import {
  createNotification,
  notifyQrConnected,
  updateConnectionRequestNotificationsState,
} from './notificationService.js';
import {
  normalizeSearchQuery,
  classifyLiveSearchQuery,
  maskEmailForPrivacy,
  maskPhoneForPrivacy,
  parseQrPayload,
  calculateRepaymentApplication,
  validateUdharEdit,
  canCancelUdhar,
  canAcceptUdhar,
  canRejectUdhar,
  canSenderCancelUdhar,
  canDeleteRepayment,
  isActiveRepayment,
  recalculateUdharFromRepayments,
  calculatePeopleDashboardSummary,
  normalizeUdharLifecycleStatus,
  packStructuredNote,
  unpackStructuredNote,
  roundMoney,
  parseConnectionRequestKey,
  type UdharCreationMethod,
} from '../src/lib/sharedUdharEngine.js';

const DEFAULT_SUPABASE_URL = 'https://frgrfajnrzqwnevhlrio.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_RHVRSE_Z4R1Qit3djpOfCA_L93zsRjg';

function getRestConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_KEY;
  return { url, key };
}

async function sbRest<T = any>(
  path: string,
  options: {
    method?: string;
    body?: any;
    prefer?: string;
  } = {}
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const { url, key } = getRestConfig();
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.prefer) {
    headers['Prefer'] = options.prefer;
  }

  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const errMsg =
      (parsed && typeof parsed === 'object' && (parsed.message || parsed.error || parsed.details)) ||
      (typeof parsed === 'string' && parsed) ||
      `Supabase REST HTTP ${response.status}`;
    return { ok: false, status: response.status, data: null, error: errMsg };
  }

  return { ok: true, status: response.status, data: parsed as T };
}

function enrichTransactionRow(
  row: any,
  userMap: Map<string, any>,
  repayments: any[],
  editHistory: any[]
) {
  const orig = parseFloat(row.original_amount) || 0;
  const cur = parseFloat(row.current_balance) || 0;
  const computedPaid = Math.max(0, roundMoney(orig - cur));
  const { note, meta } = unpackStructuredNote(row.notes);
  const counterpart = row.counterpart_user_id ? userMap.get(row.counterpart_user_id) : null;
  const lifecycleStatus = normalizeUdharLifecycleStatus(row);

  return {
    ...row,
    status: lifecycleStatus,
    creation_method: (row.creation_method || meta.creation_method || 'manual') as UdharCreationMethod,
    accepted_by: row.accepted_by || meta.accepted_by || null,
    rejected_by: row.rejected_by || meta.rejected_by || null,
    cancelled_by: row.cancelled_by || meta.cancelled_by || null,
    responded_at: row.responded_at || meta.responded_at || null,
    cancelled_at: row.cancelled_at || meta.cancelled_at || null,
    rejection_reason: row.rejection_reason || meta.rejection_reason || null,
    counterpart_registered_name: counterpart?.full_name || row.counterpart_registered_name || null,
    counterpart_email: counterpart?.email || row.counterpart_email || null,
    counterpart_avatar: counterpart?.avatar_url || row.counterpart_avatar || null,
    paid_amount:
      row.paid_amount !== null && row.paid_amount !== undefined
        ? parseFloat(row.paid_amount)
        : computedPaid,
    category: row.category || meta.category || 'Personal Loan',
    payment_method: row.payment_method || meta.payment_method || 'UPI',
    description: row.description || meta.description || null,
    clean_notes: note || null,
    notes: note || null,
    attachment_url: row.attachment_url || meta.attachment_url || null,
    repayments: repayments.filter((rep) => isActiveRepayment(rep)).map((rep) => {
      const { note: repNote, meta: repMeta } = unpackStructuredNote(rep.notes);
      const recorder = rep.recorded_by_user_id ? userMap.get(rep.recorded_by_user_id) : null;
      return {
        ...rep,
        recorded_by_name: recorder?.full_name || rep.recorded_by_name || null,
        notes: repNote || null,
        transaction_ref: rep.transaction_ref || repMeta.transaction_ref || null,
        repayment_time: rep.repayment_time || repMeta.repayment_time || null,
        attachment_url: rep.attachment_url || repMeta.attachment_url || null,
      };
    }),
    edit_history: editHistory.map((h) => {
      const editor = h.edited_by_user_id ? userMap.get(h.edited_by_user_id) : null;
      return {
        ...h,
        edited_by_name: editor?.full_name || h.edited_by_name || null,
      };
    }),
  };
}

async function fetchUsersByIds(ids: string[]): Promise<Map<string, any>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, any>();
  if (uniqueIds.length === 0) return map;
  const inList = uniqueIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
  let res = await sbRest<any[]>(
    `app_users?id=in.(${encodeURIComponent(inList)})&select=id,full_name,email,phone,avatar_url,status,deletion_status,role,is_verified,username`
  );
  if (!res.ok && res.status === 400) {
    res = await sbRest<any[]>(
      `app_users?id=in.(${encodeURIComponent(inList)})&select=id,full_name,email,phone,avatar_url,status,deletion_status,role`
    );
  }
  if (res.ok && Array.isArray(res.data)) {
    for (const u of res.data) {
      map.set(u.id, u);
    }
  }
  return map;
}

async function isBlockedBetween(userAId: string, userBId: string): Promise<boolean> {
  const res = await sbRest<any[]>(
    `user_connections?or=(and(user_a_id.eq.${encodeURIComponent(userAId)},user_b_id.eq.${encodeURIComponent(userBId)}),and(user_a_id.eq.${encodeURIComponent(userBId)},user_b_id.eq.${encodeURIComponent(userAId)}))&select=status`
  );
  if (!res.ok || !Array.isArray(res.data)) return false;
  return res.data.some((c) => c.status === 'blocked');
}

async function upsertUserConnectionRest(
  userAId: string,
  userBId: string,
  status: 'pending' | 'connected' | 'rejected' | 'cancelled' | 'deleted',
  meta?: {
    relationship_type?: string;
    requested_via?: string;
    connection_method?: string;
    consented_at?: string | null;
    responded_at?: string | null;
    cancelled_at?: string | null;
    deleted_at?: string | null;
    deleted_by?: string | null;
  }
): Promise<{ ok: boolean; status: number; data: any[] | null; error?: string }> {
  const nowIso = new Date().toISOString();
  const baseBody = { user_a_id: userAId, user_b_id: userBId, status };
  const cleanMeta: Record<string, any> = {};
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v !== undefined) cleanMeta[k] = v;
    }
    cleanMeta.updated_at = nowIso;
  }
  const fullBody = { ...baseBody, ...cleanMeta };

  let res = await sbRest<any[]>('user_connections?on_conflict=user_a_id,user_b_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: fullBody,
  });
  if (!res.ok && res.status === 400 && Object.keys(cleanMeta).length > 0 && !String(res.error || '').includes('23514')) {
    res = await sbRest<any[]>('user_connections?on_conflict=user_a_id,user_b_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: baseBody,
    });
  }
  if (res.ok) return res;

  const errText = String(res.error || '');
  // If database rejects status via check constraint, let caller handle cleanly
  if (errText.includes('user_connections_status_check') || errText.includes('23514')) {
    return res;
  }

  // Fallback for missing unique constraint (42P10) or duplicate key (23505)
  const existing = await sbRest<any[]>(
    `user_connections?user_a_id=eq.${encodeURIComponent(userAId)}&user_b_id=eq.${encodeURIComponent(userBId)}&select=id,status&limit=1`
  );
  if (existing.ok && existing.data && existing.data.length > 0) {
    let patchRes = await sbRest<any[]>(`user_connections?id=eq.${encodeURIComponent(existing.data[0].id)}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: { status, ...cleanMeta },
    });
    if (!patchRes.ok && patchRes.status === 400 && Object.keys(cleanMeta).length > 0 && !String(patchRes.error || '').includes('23514')) {
      patchRes = await sbRest<any[]>(`user_connections?id=eq.${encodeURIComponent(existing.data[0].id)}`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { status },
      });
    }
    return patchRes;
  }

  let insRes = await sbRest<any[]>('user_connections', {
    method: 'POST',
    prefer: 'return=representation',
    body: fullBody,
  });
  if (!insRes.ok && insRes.status === 400 && Object.keys(cleanMeta).length > 0 && !String(insRes.error || '').includes('23514')) {
    insRes = await sbRest<any[]>('user_connections', {
      method: 'POST',
      prefer: 'return=representation',
      body: baseBody,
    });
  }
  return insRes;
}

async function upsertUdharContactRest(payload: {
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
  relationship_type: string;
  notes?: string | null;
  linked_user_id: string | null;
  updated_at: string;
}): Promise<{ ok: boolean; status: number; data: any[] | null; error?: string }> {
  const cleanName = payload.name.trim();
  const normalizedName = cleanName.toLowerCase();
  const cleanPayload = { ...payload, name: cleanName };

  // 1. Deduplicate by linked_user_id first (prevents duplicate rows when user renames or connects)
  if (cleanPayload.linked_user_id) {
    const byLink = await sbRest<any[]>(
      `udhar_contacts?user_id=eq.${encodeURIComponent(cleanPayload.user_id)}&linked_user_id=eq.${encodeURIComponent(cleanPayload.linked_user_id)}&limit=1`
    );
    if (byLink.ok && byLink.data && byLink.data.length > 0) {
      const existing = byLink.data[0];
      return sbRest<any[]>(`udhar_contacts?id=eq.${encodeURIComponent(existing.id)}`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: {
          ...cleanPayload,
          email: cleanPayload.email ?? existing.email ?? null,
          phone: cleanPayload.phone ?? existing.phone ?? null,
          photo_url: cleanPayload.photo_url ?? existing.photo_url ?? null,
          notes: cleanPayload.notes ?? existing.notes ?? null,
        },
      });
    }
  }

  // 2. Deduplicate case-insensitively by trimmed name so "Rahul" and "rahul" never duplicate
  const allForUser = await sbRest<any[]>(
    `udhar_contacts?user_id=eq.${encodeURIComponent(cleanPayload.user_id)}&select=id,name,email,phone,photo_url,notes,linked_user_id`
  );
  if (allForUser.ok && Array.isArray(allForUser.data)) {
    const matchedByName = allForUser.data.find(
      (c) =>
        (c.name || '').trim().toLowerCase() === normalizedName &&
        (!cleanPayload.linked_user_id || !c.linked_user_id || c.linked_user_id === cleanPayload.linked_user_id)
    );
    if (matchedByName) {
      return sbRest<any[]>(`udhar_contacts?id=eq.${encodeURIComponent(matchedByName.id)}`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: {
          ...cleanPayload,
          email: cleanPayload.email ?? matchedByName.email ?? null,
          phone: cleanPayload.phone ?? matchedByName.phone ?? null,
          photo_url: cleanPayload.photo_url ?? matchedByName.photo_url ?? null,
          notes: cleanPayload.notes ?? matchedByName.notes ?? null,
          linked_user_id: cleanPayload.linked_user_id || matchedByName.linked_user_id || null,
        },
      });
    }
  }

  // 3. Insert / merge on unique constraint fallback
  const res = await sbRest<any[]>('udhar_contacts?on_conflict=user_id,name', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: cleanPayload,
  });
  if (res.ok && res.data && res.data.length > 0) {
    return res;
  }

  return sbRest<any[]>('udhar_contacts', {
    method: 'POST',
    prefer: 'return=representation',
    body: cleanPayload,
  });
}

async function ensureConnectionAndReciprocalContactsRest(
  authUser: AuthenticatedUser,
  targetUser: { id: string; full_name: string; email?: string | null; phone?: string | null; avatar_url?: string | null },
  relationshipType: string = 'Friend',
  opts?: { connectionMethod?: 'SEARCH' | 'QR_CODE' | 'CONFIRMATION_CODE' | 'LINK'; requestedVia?: string }
): Promise<{ ok: boolean; error?: string; connectionId?: string | null }> {
  const nowIso = new Date().toISOString();
  const connMeta = {
    relationship_type: relationshipType || 'Friend',
    requested_via: opts?.requestedVia || 'search',
    connection_method: opts?.connectionMethod || 'SEARCH',
    consented_at: nowIso,
    responded_at: nowIso,
    deleted_at: null,
    deleted_by: null,
    cancelled_at: null,
  };
  // 1. Bidirectional user_connections
  const [connAB, connBA] = await Promise.all([
    upsertUserConnectionRest(authUser.id, targetUser.id, 'connected', connMeta),
    upsertUserConnectionRest(targetUser.id, authUser.id, 'connected', connMeta),
  ]);
  if (!connAB.ok && !connBA.ok) {
    return {
      ok: false,
      error: connAB.error || connBA.error || 'Failed to establish connection record.',
    };
  }
  const connectionId = connAB.data?.[0]?.id || connBA.data?.[0]?.id || null;
  const targetName = (targetUser.full_name || targetUser.email?.split('@')[0] || 'User').trim();
  const myName = (authUser.full_name || authUser.email?.split('@')[0] || 'User').trim();

  // 2. Ensure target is in authUser's udhar_contacts
  const existingMine = await sbRest<any[]>(
    `udhar_contacts?user_id=eq.${encodeURIComponent(authUser.id)}&linked_user_id=eq.${encodeURIComponent(targetUser.id)}&limit=1`
  );
  let mineRes: { ok: boolean; error?: string };
  if (existingMine.ok && existingMine.data && existingMine.data.length > 0) {
    mineRes = await sbRest(`udhar_contacts?id=eq.${encodeURIComponent(existingMine.data[0].id)}`, {
      method: 'PATCH',
      body: {
        name: targetName,
        email: targetUser.email || existingMine.data[0].email || null,
        phone: targetUser.phone || existingMine.data[0].phone || null,
        photo_url: targetUser.avatar_url || existingMine.data[0].photo_url || null,
        relationship_type: relationshipType || existingMine.data[0].relationship_type || 'Friend',
        updated_at: nowIso,
      },
    });
  } else {
    mineRes = await upsertUdharContactRest({
      user_id: authUser.id,
      name: targetName,
      email: targetUser.email || null,
      phone: targetUser.phone || null,
      photo_url: targetUser.avatar_url || null,
      relationship_type: relationshipType || 'Friend',
      linked_user_id: targetUser.id,
      updated_at: nowIso,
    });
  }

  if (!mineRes.ok) {
    return {
      ok: false,
      error: mineRes.error || 'Failed to save connected contact.',
    };
  }

  // 3. Reciprocally ensure authUser is in targetUser's udhar_contacts
  const existingTheirs = await sbRest<any[]>(
    `udhar_contacts?user_id=eq.${encodeURIComponent(targetUser.id)}&linked_user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (existingTheirs.ok && existingTheirs.data && existingTheirs.data.length > 0) {
    await sbRest(`udhar_contacts?id=eq.${encodeURIComponent(existingTheirs.data[0].id)}`, {
      method: 'PATCH',
      body: {
        name: myName,
        email: authUser.email || existingTheirs.data[0].email || null,
        phone: authUser.phone || existingTheirs.data[0].phone || null,
        photo_url: authUser.avatar_url || existingTheirs.data[0].photo_url || null,
        updated_at: nowIso,
      },
    }).catch(() => {});
  } else {
    await upsertUdharContactRest({
      user_id: targetUser.id,
      name: myName,
      email: authUser.email || null,
      phone: authUser.phone || null,
      photo_url: authUser.avatar_url || null,
      relationship_type: relationshipType || 'Friend',
      linked_user_id: authUser.id,
      updated_at: nowIso,
    }).catch(() => {});
  }

  return { ok: true, connectionId };
}

async function createTargetedNotificationRest(params: {
  targetUserId: string;
  actorUserId: string;
  title: string;
  message: string;
  type: string;
  category?: string;
  deepLink?: string;
  relatedEntityId?: string;
  dedupeKey?: string;
  metadata?: Record<string, any>;
}) {
  if (!params.targetUserId || params.targetUserId === 'all') return;
  const notifType =
    params.type === 'udhar_connection_request' || params.type === 'udhar_request' || params.type === 'repayment_pending'
      ? 'info'
      : params.type === 'udhar_rejected' || params.type === 'repayment_rejected' || params.type === 'udhar_request_cancelled' || params.type === 'udhar_deleted'
        ? 'warning'
        : 'success';

  await Promise.all([
    sbRest('notifications', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        title: params.title,
        message: params.message,
        type: params.type,
        target_user_id: params.targetUserId,
        actor_user_id: params.actorUserId,
        related_entity_id: params.relatedEntityId || null,
        is_active: true,
      },
    }).catch(() => {}),
    createNotification({
      userId: params.targetUserId,
      title: params.title,
      message: params.message,
      category: (params.category as any) || 'udhar',
      type: notifType,
      relatedEntityType: 'udhar',
      relatedEntityId: params.relatedEntityId || undefined,
      deepLink: params.deepLink || 'people',
      dedupeKey: params.dedupeKey,
      metadata: {
        actionType: params.type,
        relatedEntityId: params.relatedEntityId || null,
        linkId: params.relatedEntityId || null,
        actorUserId: params.actorUserId,
        ...(params.metadata || {}),
      },
      channels: ['in_app', 'push'],
    }).catch(() => {}),
  ]);
}

async function deactivateUdharNotificationsRest(linkId: string, txId?: string) {
  if (!linkId && !txId) return;
  const nowIso = new Date().toISOString();
  const tasks: Promise<any>[] = [];

  if (linkId) {
    tasks.push(
      sbRest(`notifications?related_entity_id=eq.${encodeURIComponent(linkId)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { is_active: false },
      }).catch(() => {}),
      sbRest(`user_notifications?related_entity_id=eq.${encodeURIComponent(linkId)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { is_deleted: true, deleted_at: nowIso },
      }).catch(() => {}),
      sbRest(`user_notifications?metadata->>relatedEntityId=eq.${encodeURIComponent(linkId)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { is_deleted: true, deleted_at: nowIso },
      }).catch(() => {}),
      sbRest(`user_notifications?metadata->>linkId=eq.${encodeURIComponent(linkId)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { is_deleted: true, deleted_at: nowIso },
      }).catch(() => {})
    );
  }

  if (txId) {
    tasks.push(
      sbRest(`notifications?related_entity_id=eq.${encodeURIComponent(txId)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { is_active: false },
      }).catch(() => {}),
      sbRest(`user_notifications?related_entity_id=eq.${encodeURIComponent(txId)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { is_deleted: true, deleted_at: nowIso },
      }).catch(() => {})
    );
  }

  tasks.push(purgeUdharNotificationsFallback(linkId, txId).catch(() => {}));
  await Promise.all(tasks);
}

// ============================================================================
// 1. LIVE USER SEARCH (Privacy-Safe, Unicode-Safe, Enumeration-Resistant)
// ============================================================================
export async function searchUsersRest(authUser: AuthenticatedUser, rawQuery: string) {
  const classified = classifyLiveSearchQuery(rawQuery);
  if (classified.mode === 'too_short') {
    return { status: 200, body: { success: true, users: [], searchMode: 'too_short' } };
  }

  // Prevent partial email/phone enumeration — require complete valid email or 10+ digit phone
  if (classified.mode === 'email_incomplete') {
    return {
      status: 200,
      body: {
        success: true,
        users: [],
        searchMode: 'email_incomplete',
        hint: 'Enter the complete email address to find a user.',
      },
    };
  }
  if (classified.mode === 'phone_incomplete') {
    return {
      status: 200,
      body: {
        success: true,
        users: [],
        searchMode: 'phone_incomplete',
        hint: 'Enter a complete 10-digit mobile number to search.',
      },
    };
  }

  const escaped = classified.normalized.replace(/[%*,()]/g, '');
  const buildQueryPath = (includeOptionalCols: boolean) => {
    const selectCols = includeOptionalCols
      ? 'id,full_name,email,phone,avatar_url,status,deletion_status,is_verified,username,role'
      : 'id,full_name,email,phone,avatar_url,status,deletion_status,role';
    if (classified.mode === 'email_exact') {
      return `app_users?status=eq.active&email=ilike.${encodeURIComponent(escaped)}&select=${selectCols}&limit=5`;
    }
    if (classified.mode === 'phone_exact') {
      const tail = classified.last10Digits;
      return `app_users?status=eq.active&or=(phone.ilike.*${encodeURIComponent(tail)}*,phone.ilike.*${encodeURIComponent(classified.digitsOnly)}*)&select=${selectCols}&limit=15`;
    }
    const orClauses = includeOptionalCols
      ? [`full_name.ilike.*${escaped}*`, `username.ilike.*${escaped}*`]
      : [`full_name.ilike.*${escaped}*`];
    return `app_users?status=eq.active&or=(${encodeURIComponent(orClauses.join(','))})&select=${selectCols}&order=full_name.asc&limit=20`;
  };

  let usersRes = await sbRest<any[]>(buildQueryPath(true));
  if (!usersRes.ok && usersRes.status === 400) {
    usersRes = await sbRest<any[]>(buildQueryPath(false));
  }

  if (!usersRes.ok) {
    return {
      status: 503,
      body: {
        success: false,
        code: 'DIRECTORY_UNAVAILABLE',
        message: 'Unable to reach user directory right now. Please retry.',
      },
    };
  }

  let activeUsers = (usersRes.data || []).filter((u) => isDiscoverableNormalUser(u));

  // Also check Supabase Auth display names (user_metadata.full_name/name) when searching by name
  if (classified.mode === 'name_or_username') {
    const { url, key } = getRestConfig();
    const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (serviceKey && key === serviceKey) {
      try {
        const authListRes = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        });
        if (authListRes.ok) {
          const authJson: any = await authListRes.json().catch(() => null);
          const authUsers: any[] = Array.isArray(authJson?.users) ? authJson.users : [];
          const needle = classified.normalized.toLowerCase();
          const matchedAuthUsers = authUsers.filter((au) => {
            const metaName = String(
              au.user_metadata?.full_name || au.user_metadata?.name || au.user_metadata?.display_name || ''
            )
              .trim()
              .toLowerCase();
            return metaName.includes(needle);
          });
          const existingIds = new Set(activeUsers.map((u) => u.id));
          const missingIds = matchedAuthUsers.map((au) => au.id).filter((id) => id && !existingIds.has(id));
          if (missingIds.length > 0) {
            const fetchedMap = await fetchUsersByIds(missingIds);
            for (const au of matchedAuthUsers) {
              const appRow = fetchedMap.get(au.id);
              if (appRow && isDiscoverableNormalUser(appRow) && !existingIds.has(appRow.id)) {
                const authDisplay = String(
                  au.user_metadata?.full_name || au.user_metadata?.name || au.user_metadata?.display_name || ''
                ).trim();
                activeUsers.push({
                  ...appRow,
                  full_name: authDisplay || appRow.full_name,
                });
                existingIds.add(appRow.id);
              }
            }
          }
        }
      } catch {
        // Non-fatal fallback
      }
    }
  }

  // Strict post-filter for exact email / exact normalized phone match
  if (classified.mode === 'email_exact') {
    activeUsers = activeUsers.filter(
      (u) => (u.email || '').trim().toLowerCase() === classified.normalized
    );
  } else if (classified.mode === 'phone_exact') {
    activeUsers = activeUsers.filter((u) => {
      const userDigits = String(u.phone || '').replace(/\D/g, '');
      if (userDigits.length < 10) return false;
      return userDigits === classified.digitsOnly || userDigits.slice(-10) === classified.last10Digits;
    });
  }

  // Fetch current user's connections and saved contacts to determine statuses & exclude blocked users
  const [connRes, contactsRes] = await Promise.all([
    sbRest<any[]>(
      `user_connections?or=(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(authUser.id)})&select=id,user_a_id,user_b_id,status`
    ),
    sbRest<any[]>(
      `udhar_contacts?user_id=eq.${encodeURIComponent(authUser.id)}&select=linked_user_id`
    ),
  ]);

  const statusByUserId = new Map<string, { status: string; requestId?: string }>();
  if (connRes.ok && Array.isArray(connRes.data)) {
    for (const c of connRes.data) {
      const isOutgoing = c.user_a_id === authUser.id;
      const otherId = isOutgoing ? c.user_b_id : c.user_a_id;
      if (!otherId) continue;
      const prev = statusByUserId.get(otherId)?.status;
      if (c.status === 'blocked' || prev === 'blocked') {
        statusByUserId.set(otherId, { status: 'blocked', requestId: c.id });
      } else if (c.status === 'connected' || prev === 'connected') {
        statusByUserId.set(otherId, { status: 'connected', requestId: c.id });
      } else if (c.status === 'pending') {
        statusByUserId.set(otherId, {
          status: isOutgoing ? 'pending' : 'incoming_pending',
          requestId: c.id,
        });
      }
    }
  }
  for (const fb of fallbackPendingRequests.values()) {
    if (fb.user_a_id === authUser.id || fb.user_b_id === authUser.id) {
      const isOutgoing = fb.user_a_id === authUser.id;
      const otherId = isOutgoing ? fb.user_b_id : fb.user_a_id;
      if (!statusByUserId.has(otherId)) {
        statusByUserId.set(otherId, {
          status: isOutgoing ? 'pending' : 'incoming_pending',
          requestId: fb.id,
        });
      }
    }
  }

  const linkedContactSet = new Set<string>();
  if (contactsRes.ok && Array.isArray(contactsRes.data)) {
    for (const ct of contactsRes.data) {
      if (ct.linked_user_id) linkedContactSet.add(ct.linked_user_id);
    }
  }

  const sanitized = activeUsers
    .filter((u) => statusByUserId.get(u.id)?.status !== 'blocked')
    .slice(0, 15)
    .map((u) => {
      const isSelf = u.id === authUser.id;
      const connEntry = statusByUserId.get(u.id);
      const isConnected = !isSelf && (connEntry?.status === 'connected' || linkedContactSet.has(u.id));
      const connectionStatus = isSelf
        ? 'self'
        : isConnected
          ? 'connected'
          : connEntry?.status === 'pending'
            ? 'pending'
            : connEntry?.status === 'incoming_pending'
              ? 'incoming_pending'
              : 'none';

      // Privacy Rule: Partial name matches NEVER expose email or phone (not even masked) before consent!
      const showContactHint = isConnected || isSelf;
      return {
        id: u.id,
        displayName: u.full_name || u.username || 'My Money User',
        fullName: u.full_name || u.username || 'My Money User',
        username: u.username || null,
        accountIndicator: 'My Money Manager Account',
        emailMasked: showContactHint ? maskEmailForPrivacy(u.email) : undefined,
        phoneMasked: showContactHint ? maskPhoneForPrivacy(u.phone) : null,
        avatarUrl: u.avatar_url || null,
        isSelf,
        isVerified: Boolean(u.is_verified ?? true),
        connectionStatus,
        requestId: connEntry?.requestId || null,
        isAlreadyConnected: isConnected,
        isSavedContact: linkedContactSet.has(u.id),
      };
    });

  return { status: 200, body: { success: true, users: sanitized, searchMode: classified.mode } };
}

// ============================================================================
// 2. CONSENT-BASED TWO-WAY PAIRING & CONNECTION REQUESTS
// ============================================================================
interface FallbackPendingRequest {
  id: string;
  user_a_id: string;
  user_b_id: string;
  relationship_type: string;
  requested_via: string;
  connection_method: string;
  created_at: string;
}
const fallbackPendingRequests = new Map<string, FallbackPendingRequest>();

async function fetchPersistedPendingRequestsRest(authUserId: string): Promise<FallbackPendingRequest[]> {
  const res = await sbRest<any[]>(
    `user_notifications?type=eq.udhar_connection_request&is_deleted=eq.false&or=(user_id.eq.${encodeURIComponent(authUserId)},metadata->>requesterId.eq.${encodeURIComponent(authUserId)})&select=id,user_id,related_entity_id,metadata,created_at&order=created_at.desc`
  ).catch(() => ({ ok: false, data: null as any[] | null }));

  if (!res.ok || !Array.isArray(res.data)) return [];
  const results: FallbackPendingRequest[] = [];
  const seenPairs = new Set<string>();
  for (const row of res.data) {
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const reqStatus = String(meta.requestStatus || 'pending').toLowerCase();
    if (reqStatus !== 'pending') continue;
    const requesterId = String(meta.requesterId || meta.requesterUserId || '').trim();
    const receiverId = String(meta.receiverId || row.user_id || '').trim();
    if (!requesterId || !receiverId || requesterId === receiverId) continue;
    const pairKey = `${requesterId}:${receiverId}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    results.push({
      id: String(meta.requestId || row.related_entity_id || pairKey),
      user_a_id: requesterId,
      user_b_id: receiverId,
      relationship_type: String(meta.relationshipType || 'Friend'),
      requested_via: String(meta.requestedVia || 'search'),
      connection_method: String(meta.connectionMethod || 'SEARCH'),
      created_at: row.created_at || new Date().toISOString(),
    });
  }
  return results;
}

export async function connectUserRest(
  authUser: AuthenticatedUser,
  body: { targetUserId?: string; target_user_id?: string; relationshipType?: string; relationship_type?: string; requestedVia?: string; source?: string }
) {
  const targetUserId = (body.targetUserId || body.target_user_id || '').trim();
  const relationshipType = (body.relationshipType || body.relationship_type || 'Friend').trim();
  const requestedVia = (body.requestedVia || body.source || 'search').trim();

  if (!targetUserId) {
    return { status: 400, body: { success: false, code: 'MISSING_TARGET', message: 'Target user ID is required.' } };
  }
  if (targetUserId === authUser.id) {
    return { status: 400, body: { success: false, code: 'SELF_CONNECTION', message: 'You cannot connect with your own account.' } };
  }

  let targetRes = await sbRest<any[]>(
    `app_users?id=eq.${encodeURIComponent(targetUserId)}&select=id,full_name,email,phone,avatar_url,role,status,deletion_status,is_verified`
  );
  if (!targetRes.ok && targetRes.status === 400) {
    targetRes = await sbRest<any[]>(
      `app_users?id=eq.${encodeURIComponent(targetUserId)}&select=id,full_name,email,phone,avatar_url,role,status,deletion_status`
    );
  }
  if (!targetRes.ok) {
    return { status: 503, body: { success: false, code: 'DIRECTORY_UNAVAILABLE', message: 'Unable to verify target account right now. Please retry.' } };
  }
  if (!targetRes.data || targetRes.data.length === 0) {
    return { status: 404, body: { success: false, code: 'NOT_FOUND', message: 'User account not found.' } };
  }

  const target = targetRes.data[0];
  if (!isDiscoverableNormalUser(target)) {
    return { status: 403, body: { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'This user account is not eligible for Udhar connections.' } };
  }

  if (await isBlockedBetween(authUser.id, targetUserId)) {
    return { status: 403, body: { success: false, code: 'BLOCKED', message: 'Connection is blocked between these accounts.' } };
  }

  const pairRes = await sbRest<any[]>(
    `user_connections?or=(and(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(targetUserId)}),and(user_a_id.eq.${encodeURIComponent(targetUserId)},user_b_id.eq.${encodeURIComponent(authUser.id)}))&select=id,user_a_id,user_b_id,status`
  );
  if (!pairRes.ok) {
    return { status: 503, body: { success: false, code: 'REQUEST_FAILED', message: 'Unable to inspect connection state right now. Please retry.' } };
  }
  const pairRows = Array.isArray(pairRes.data) ? pairRes.data : [];

  const targetName = (target.full_name || target.email?.split('@')[0] || 'User').trim();
  const requesterName = (authUser.full_name || authUser.email?.split('@')[0] || 'A user').trim();

  // Case 1: Already connected
  if (pairRows.some((r) => r.status === 'connected')) {
    return {
      status: 200,
      body: {
        success: true,
        status: 'connected',
        alreadyConnected: true,
        message: `You are already connected with ${targetName}.`,
        connectedUser: {
          id: target.id,
          name: targetName,
          displayName: targetName,
          fullName: targetName,
          avatarUrl: target.avatar_url || null,
          isVerified: Boolean(target.is_verified ?? true),
        },
      },
    };
  }

  // Case 2: Target already sent a pending request to authUser -> mutual consent -> accept!
  const persistedPending = await fetchPersistedPendingRequestsRest(authUser.id);
  const incomingFallback =
    fallbackPendingRequests.get(`${targetUserId}:${authUser.id}`) ||
    persistedPending.find((p) => p.user_a_id === targetUserId && p.user_b_id === authUser.id);
  const incomingPending =
    pairRows.find(
      (r) => r.user_a_id === targetUserId && r.user_b_id === authUser.id && r.status === 'pending'
    ) || (incomingFallback ? { id: incomingFallback.id } : undefined);
  if (incomingPending) {
    return acceptConnectionRequestRest(authUser, incomingPending.id || targetUserId);
  }

  // Case 3: Duplicate outgoing pending request -> prevent duplicates
  const outgoingFallback =
    fallbackPendingRequests.get(`${authUser.id}:${targetUserId}`) ||
    persistedPending.find((p) => p.user_a_id === authUser.id && p.user_b_id === targetUserId);
  const outgoingPending =
    pairRows.find(
      (r) => r.user_a_id === authUser.id && r.user_b_id === targetUserId && r.status === 'pending'
    ) || (outgoingFallback ? { id: outgoingFallback.id } : undefined);
  if (outgoingPending) {
    return {
      status: 200,
      body: {
        success: true,
        status: 'pending',
        alreadyPending: true,
        deduplicated: true,
        requestId: outgoingPending.id || `${authUser.id}:${targetUserId}`,
        message: `Connection request already sent to ${targetName}. Waiting for their approval.`,
        connectedUser: {
          id: target.id,
          name: targetName,
          displayName: targetName,
          fullName: targetName,
          avatarUrl: target.avatar_url || null,
          isVerified: Boolean(target.is_verified ?? true),
        },
      },
    };
  }

  // Case 4: Remove any stale non-active rows in either direction, then create a NEW pending connection request
  await sbRest(
    `user_connections?or=(and(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(targetUserId)}),and(user_a_id.eq.${encodeURIComponent(targetUserId)},user_b_id.eq.${encodeURIComponent(authUser.id)}))&status=in.(deleted,rejected,cancelled)`,
    { method: 'DELETE' }
  ).catch(() => {});

  const insRes = await upsertUserConnectionRest(authUser.id, targetUserId, 'pending', {
    relationship_type: relationshipType,
    requested_via: requestedVia,
    connection_method: 'SEARCH',
    responded_at: null,
    consented_at: null,
    cancelled_at: null,
    deleted_at: null,
    deleted_by: null,
  });

  let requestId: string;
  if (!insRes.ok) {
    const errText = String(insRes.error || '');
    if (errText.includes('user_connections_status_check') || errText.includes('23514')) {
      const fallbackId = `${authUser.id}:${targetUserId}`;
      fallbackPendingRequests.set(fallbackId, {
        id: fallbackId,
        user_a_id: authUser.id,
        user_b_id: targetUserId,
        relationship_type: relationshipType,
        requested_via: requestedVia,
        connection_method: 'SEARCH',
        created_at: new Date().toISOString(),
      });
      requestId = fallbackId;
    } else {
      console.error('[connectUserRest failed]:', insRes.status, errText);
      return {
        status: 503,
        body: {
          success: false,
          code: 'REQUEST_FAILED',
          message: 'Unable to send connection request right now. Please try again.',
        },
      };
    }
  } else {
    requestId = insRes.data?.[0]?.id || `${authUser.id}:${targetUserId}`;
  }

  await createTargetedNotificationRest({
    targetUserId: target.id,
    actorUserId: authUser.id,
    title: 'Udhar Connection Request',
    message: `${requesterName} wants to connect with you on My Money Manager Udhar.`,
    type: 'udhar_connection_request',
    category: 'udhar',
    deepLink: 'people',
    relatedEntityId: String(requestId),
    metadata: {
      actionType: 'udhar_connection_request',
      requestId: String(requestId),
      connectionId: String(requestId),
      requesterId: authUser.id,
      requesterUserId: authUser.id,
      receiverId: target.id,
      requesterName,
      requesterAvatar: authUser.avatar_url || null,
      requestedVia,
      connectionMethod: 'SEARCH',
      relationshipType,
      requestStatus: 'pending',
    },
  });

  return {
    status: 200,
    body: {
      success: true,
      status: 'pending',
      connectionMethod: 'SEARCH',
      alreadyConnected: false,
      alreadyPending: false,
      requestId: String(requestId),
      message: `Connection request sent to ${targetName}. You'll be connected once they accept.`,
      connectedUser: {
        id: target.id,
        name: targetName,
        displayName: targetName,
        fullName: targetName,
        avatarUrl: target.avatar_url || null,
        isVerified: Boolean(target.is_verified ?? true),
      },
    },
  };
}

export async function getConnectionRequestsRest(authUser: AuthenticatedUser) {
  let connRes = await sbRest<any[]>(
    `user_connections?or=(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(authUser.id)})&select=id,user_a_id,user_b_id,status,relationship_type,requested_via,connection_method,created_at,updated_at,responded_at&order=created_at.desc`
  );
  if (!connRes.ok && connRes.status === 400) {
    connRes = await sbRest<any[]>(
      `user_connections?or=(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(authUser.id)})&select=id,user_a_id,user_b_id,status,created_at&order=created_at.desc`
    );
  }
  if (!connRes.ok) {
    return { status: 503, body: { success: false, message: 'Unable to load connection requests right now.' } };
  }

  const rows = [...(connRes.data || [])];
  const persistedPending = await fetchPersistedPendingRequestsRest(authUser.id);
  const existingPairStatuses = new Set(
    rows
      .filter((r) => r.status === 'pending' || r.status === 'connected')
      .map((r) => `${r.user_a_id}:${r.user_b_id}`)
  );
  for (const fb of [...fallbackPendingRequests.values(), ...persistedPending]) {
    if (fb.user_a_id !== authUser.id && fb.user_b_id !== authUser.id) continue;
    const pairKey = `${fb.user_a_id}:${fb.user_b_id}`;
    const reversePairKey = `${fb.user_b_id}:${fb.user_a_id}`;
    if (!existingPairStatuses.has(pairKey) && !existingPairStatuses.has(reversePairKey)) {
      existingPairStatuses.add(pairKey);
      rows.push({ ...fb, status: 'pending' });
    }
  }
  const otherIds = rows
    .map((r) => (r.user_a_id === authUser.id ? r.user_b_id : r.user_a_id))
    .filter(Boolean);
  const userMap = await fetchUsersByIds(otherIds);

  const incoming: any[] = [];
  const outgoing: any[] = [];
  const seenIncomingUsers = new Set<string>();
  const seenOutgoingUsers = new Set<string>();
  const connectedMap = new Map<string, any>();

  for (const r of rows) {
    if (r.status === 'pending') {
      if (r.user_b_id === authUser.id) {
        if (seenIncomingUsers.has(r.user_a_id)) continue;
        seenIncomingUsers.add(r.user_a_id);
        const u = userMap.get(r.user_a_id);
        incoming.push({
          id: r.id,
          direction: 'incoming',
          requesterUserId: r.user_a_id,
          displayName: u?.full_name || 'My Money User',
          avatarUrl: u?.avatar_url || null,
          isVerified: Boolean(u?.is_verified ?? true),
          status: 'pending',
          relationshipType: r.relationship_type || 'Friend',
          requestedVia: r.requested_via || 'search',
          connectionMethod: r.connection_method || 'SEARCH',
          createdAt: r.created_at,
        });
      } else if (r.user_a_id === authUser.id) {
        if (seenOutgoingUsers.has(r.user_b_id)) continue;
        seenOutgoingUsers.add(r.user_b_id);
        const u = userMap.get(r.user_b_id);
        outgoing.push({
          id: r.id,
          direction: 'outgoing',
          targetUserId: r.user_b_id,
          displayName: u?.full_name || 'My Money User',
          avatarUrl: u?.avatar_url || null,
          isVerified: Boolean(u?.is_verified ?? true),
          status: 'pending',
          relationshipType: r.relationship_type || 'Friend',
          requestedVia: r.requested_via || 'search',
          connectionMethod: r.connection_method || 'SEARCH',
          createdAt: r.created_at,
        });
      }
    } else if (r.status === 'connected') {
      const otherId = r.user_a_id === authUser.id ? r.user_b_id : r.user_a_id;
      if (otherId && !connectedMap.has(otherId)) {
        const u = userMap.get(otherId);
        connectedMap.set(otherId, {
          id: r.id,
          userId: otherId,
          displayName: u?.full_name || 'My Money User',
          avatarUrl: u?.avatar_url || null,
          isVerified: Boolean(u?.is_verified ?? true),
          status: 'connected',
          relationshipType: r.relationship_type || 'Friend',
          connectionMethod: r.connection_method || 'SEARCH',
          createdAt: r.created_at,
        });
      }
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      incoming,
      outgoing,
      connected: Array.from(connectedMap.values()),
    },
  };
}

export async function acceptConnectionRequestRest(authUser: AuthenticatedUser, requestIdOrUserId: string) {
  const parsedKey = parseConnectionRequestKey(requestIdOrUserId);
  if (!parsedKey.valid) {
    return { status: 400, body: { success: false, message: 'Valid connection request ID is required.' } };
  }

  let queryPath = '';
  if (parsedKey.kind === 'uuid' && parsedKey.uuid) {
    const encoded = encodeURIComponent(parsedKey.uuid);
    queryPath = `user_connections?user_b_id=eq.${encodeURIComponent(authUser.id)}&status=eq.pending&or=(id.eq.${encoded},user_a_id.eq.${encoded})&limit=1`;
  } else if (parsedKey.kind === 'composite' && parsedKey.requesterUserId) {
    queryPath = `user_connections?user_a_id=eq.${encodeURIComponent(parsedKey.requesterUserId)}&user_b_id=eq.${encodeURIComponent(authUser.id)}&status=eq.pending&limit=1`;
  }

  const reqRes = await sbRest<any[]>(queryPath);
  if (!reqRes.ok) {
    return { status: 503, body: { success: false, code: 'REQUEST_FAILED', message: 'Unable to verify connection request right now.' } };
  }
  let pendingRow = reqRes.data?.[0];
  if (!pendingRow) {
    const persisted = await fetchPersistedPendingRequestsRest(authUser.id);
    for (const fb of [...fallbackPendingRequests.values(), ...persisted]) {
      if (
        fb.user_b_id === authUser.id &&
        (fb.id === requestIdOrUserId ||
          (parsedKey.kind === 'composite' && fb.user_a_id === parsedKey.requesterUserId) ||
          (parsedKey.kind === 'uuid' && fb.user_a_id === parsedKey.uuid))
      ) {
        pendingRow = { ...fb, status: 'pending' };
        break;
      }
    }
  }
  if (!pendingRow) {
    return { status: 404, body: { success: false, code: 'REQUEST_NOT_FOUND', message: 'Pending connection request not found.' } };
  }
  fallbackPendingRequests.delete(`${pendingRow.user_a_id}:${authUser.id}`);
  const requesterId = pendingRow.user_a_id;
  const userMap = await fetchUsersByIds([requesterId]);
  const requester = userMap.get(requesterId);
  if (!requester || requester.status !== 'active') {
    return { status: 404, body: { success: false, message: 'Requester account is no longer active.' } };
  }

  const syncRes = await ensureConnectionAndReciprocalContactsRest(
    authUser,
    requester,
    pendingRow.relationship_type || 'Friend',
    {
      connectionMethod: pendingRow.connection_method || 'SEARCH',
      requestedVia: pendingRow.requested_via || 'search',
    }
  );
  if (!syncRes.ok) {
    return { status: 503, body: { success: false, code: 'REQUEST_FAILED', message: syncRes.error || 'Failed to finalize connection.' } };
  }

  await updateConnectionRequestNotificationsState({
    requestId: String(pendingRow.id),
    requesterId: requester.id,
    receiverId: authUser.id,
    status: 'accepted',
  }).catch(() => {});

  const acceptorName = (authUser.full_name || authUser.email?.split('@')[0] || 'User').trim();
  const requesterName = (requester.full_name || requester.email?.split('@')[0] || 'Friend').trim();

  await createTargetedNotificationRest({
    targetUserId: requester.id,
    actorUserId: authUser.id,
    title: 'Connection Request Accepted',
    message: `${acceptorName} accepted your connection request. Added to your Saved People.`,
    type: 'connection_accepted',
    category: 'udhar',
    deepLink: 'people',
    relatedEntityId: authUser.id,
    metadata: {
      actionType: 'udhar_connection_accepted',
      acceptorId: authUser.id,
      acceptorName,
      acceptorAvatar: authUser.avatar_url || null,
      connectionId: syncRes.connectionId || String(pendingRow.id),
    },
  });

  return {
    status: 200,
    body: {
      success: true,
      status: 'connected',
      message: `Connected with ${requesterName}! Added to your Saved People.`,
      connectedUser: {
        id: requester.id,
        name: requesterName,
        displayName: requesterName,
        fullName: requesterName,
        avatarUrl: requester.avatar_url || null,
        isVerified: Boolean(requester.is_verified ?? true),
      },
    },
  };
}

export async function rejectConnectionRequestRest(authUser: AuthenticatedUser, requestIdOrUserId: string) {
  const parsedKey = parseConnectionRequestKey(requestIdOrUserId);
  if (!parsedKey.valid) {
    return { status: 400, body: { success: false, message: 'Valid connection request ID is required.' } };
  }

  let queryPath = '';
  if (parsedKey.kind === 'uuid' && parsedKey.uuid) {
    const encoded = encodeURIComponent(parsedKey.uuid);
    queryPath = `user_connections?user_b_id=eq.${encodeURIComponent(authUser.id)}&status=eq.pending&or=(id.eq.${encoded},user_a_id.eq.${encoded})&limit=1`;
  } else if (parsedKey.kind === 'composite' && parsedKey.requesterUserId) {
    queryPath = `user_connections?user_a_id=eq.${encodeURIComponent(parsedKey.requesterUserId)}&user_b_id=eq.${encodeURIComponent(authUser.id)}&status=eq.pending&limit=1`;
  }

  const reqRes = await sbRest<any[]>(queryPath);
  if (!reqRes.ok) {
    return { status: 503, body: { success: false, code: 'REQUEST_FAILED', message: 'Unable to verify connection request right now.' } };
  }
  let pendingRow = reqRes.data?.[0];
  let isFallbackOnly = false;
  if (!pendingRow) {
    const persisted = await fetchPersistedPendingRequestsRest(authUser.id);
    for (const fb of [...fallbackPendingRequests.values(), ...persisted]) {
      if (
        fb.user_b_id === authUser.id &&
        (fb.id === requestIdOrUserId ||
          (parsedKey.kind === 'composite' && fb.user_a_id === parsedKey.requesterUserId) ||
          (parsedKey.kind === 'uuid' && fb.user_a_id === parsedKey.uuid))
      ) {
        pendingRow = { ...fb, status: 'pending' };
        isFallbackOnly = true;
        break;
      }
    }
  }
  if (!pendingRow) {
    return { status: 404, body: { success: false, code: 'REQUEST_NOT_FOUND', message: 'Pending connection request not found.' } };
  }
  fallbackPendingRequests.delete(`${pendingRow.user_a_id}:${authUser.id}`);
  if (!isFallbackOnly) {
    const nowIso = new Date().toISOString();
    let patchRes = await sbRest(`user_connections?id=eq.${encodeURIComponent(pendingRow.id)}`, {
      method: 'PATCH',
      body: { status: 'rejected', responded_at: nowIso, updated_at: nowIso },
    });
    if (!patchRes.ok && patchRes.status === 400 && !String(patchRes.error || '').includes('23514')) {
      patchRes = await sbRest(`user_connections?id=eq.${encodeURIComponent(pendingRow.id)}`, {
        method: 'PATCH',
        body: { status: 'rejected' },
      });
    }
    if (!patchRes.ok && (String(patchRes.error || '').includes('user_connections_status_check') || String(patchRes.error || '').includes('23514'))) {
      patchRes = await sbRest(`user_connections?id=eq.${encodeURIComponent(pendingRow.id)}`, {
        method: 'DELETE',
      });
    }
    if (!patchRes.ok) {
      return { status: 503, body: { success: false, code: 'REQUEST_FAILED', message: 'Unable to decline request right now.' } };
    }
  }

  await updateConnectionRequestNotificationsState({
    requestId: String(pendingRow.id),
    requesterId: pendingRow.user_a_id,
    receiverId: authUser.id,
    status: 'rejected',
  }).catch(() => {});

  const rejectorName = (authUser.full_name || authUser.email?.split('@')[0] || 'User').trim();
  await createTargetedNotificationRest({
    targetUserId: pendingRow.user_a_id,
    actorUserId: authUser.id,
    title: 'Connection Request Declined',
    message: `${rejectorName} declined your My Money Manager Udhar connection request.`,
    type: 'connection_rejected',
    category: 'udhar',
    deepLink: 'people',
    relatedEntityId: String(pendingRow.id),
  });

  return {
    status: 200,
    body: {
      success: true,
      status: 'rejected',
      message: 'Connection request declined. No active connection was created.',
    },
  };
}

export async function cancelConnectionRequestRest(authUser: AuthenticatedUser, requestIdOrUserId: string) {
  const parsedKey = parseConnectionRequestKey(requestIdOrUserId);
  if (!parsedKey.valid) {
    return { status: 400, body: { success: false, message: 'Valid connection request ID is required.' } };
  }

  let queryPath = '';
  if (parsedKey.kind === 'uuid' && parsedKey.uuid) {
    const encoded = encodeURIComponent(parsedKey.uuid);
    queryPath = `user_connections?user_a_id=eq.${encodeURIComponent(authUser.id)}&status=eq.pending&or=(id.eq.${encoded},user_b_id.eq.${encoded})&limit=1`;
  } else if (parsedKey.kind === 'composite' && parsedKey.targetUserId) {
    queryPath = `user_connections?user_a_id=eq.${encodeURIComponent(authUser.id)}&user_b_id=eq.${encodeURIComponent(parsedKey.targetUserId)}&status=eq.pending&limit=1`;
  } else {
    queryPath = `user_connections?user_a_id=eq.${encodeURIComponent(authUser.id)}&status=eq.pending&id=eq.${encodeURIComponent(requestIdOrUserId.trim())}&limit=1`;
  }

  const reqRes = await sbRest<any[]>(queryPath);
  if (!reqRes.ok) {
    return { status: 503, body: { success: false, code: 'REQUEST_FAILED', message: 'Unable to verify pending request right now.' } };
  }
  let pendingRow = reqRes.data?.[0];
  let isFallbackOnly = false;
  if (!pendingRow) {
    const persisted = await fetchPersistedPendingRequestsRest(authUser.id);
    for (const fb of [...fallbackPendingRequests.values(), ...persisted]) {
      if (
        fb.user_a_id === authUser.id &&
        (fb.id === requestIdOrUserId ||
          (parsedKey.kind === 'composite' && fb.user_b_id === parsedKey.targetUserId) ||
          (parsedKey.kind === 'uuid' && fb.user_b_id === parsedKey.uuid))
      ) {
        pendingRow = { ...fb, status: 'pending' };
        isFallbackOnly = true;
        break;
      }
    }
  }
  if (!pendingRow) {
    // Check if this request was already cancelled/rejected or already connected
    let anyStatusPath = '';
    if (parsedKey.kind === 'uuid' && parsedKey.uuid) {
      const encoded = encodeURIComponent(parsedKey.uuid);
      anyStatusPath = `user_connections?user_a_id=eq.${encodeURIComponent(authUser.id)}&or=(id.eq.${encoded},user_b_id.eq.${encoded})&select=id,status,user_b_id&limit=1`;
    } else if (parsedKey.kind === 'composite' && parsedKey.targetUserId) {
      anyStatusPath = `user_connections?user_a_id=eq.${encodeURIComponent(authUser.id)}&user_b_id=eq.${encodeURIComponent(parsedKey.targetUserId)}&select=id,status,user_b_id&limit=1`;
    }
    if (anyStatusPath) {
      const existingRes = await sbRest<any[]>(anyStatusPath).catch(() => ({ ok: false, data: null as any[] | null }));
      const existingRow = existingRes.ok ? existingRes.data?.[0] : null;
      if (existingRow?.status === 'connected') {
        return {
          status: 409,
          body: {
            success: false,
            code: 'ALREADY_CONNECTED',
            message: 'This connection request was already accepted and cannot be cancelled.',
          },
        };
      }
      if (existingRow && (existingRow.status === 'cancelled' || existingRow.status === 'rejected')) {
        return {
          status: 200,
          body: {
            success: true,
            alreadyCancelled: true,
            status: 'cancelled',
            requestId: String(existingRow.id),
            message: 'Connection request was already cancelled.',
          },
        };
      }
    }
    // Also check if a notification for this request was already cancelled
    const notifLookup = await sbRest<any[]>(
      `user_notifications?type=eq.udhar_connection_request&metadata->>requesterId=eq.${encodeURIComponent(authUser.id)}&or=(related_entity_id.eq.${encodeURIComponent(requestIdOrUserId)},metadata->>requestId.eq.${encodeURIComponent(requestIdOrUserId)})&select=id,metadata&limit=1`
    ).catch(() => ({ ok: false, data: null as any[] | null }));
    const notifRow = notifLookup.ok ? notifLookup.data?.[0] : null;
    if (notifRow) {
      const nStatus = String(notifRow.metadata?.requestStatus || '').toLowerCase();
      if (nStatus === 'cancelled' || nStatus === 'rejected') {
        return {
          status: 200,
          body: {
            success: true,
            alreadyCancelled: true,
            status: 'cancelled',
            requestId: requestIdOrUserId,
            message: 'Connection request was already cancelled.',
          },
        };
      }
      if (nStatus === 'accepted') {
        return {
          status: 409,
          body: {
            success: false,
            code: 'ALREADY_CONNECTED',
            message: 'This connection request was already accepted and cannot be cancelled.',
          },
        };
      }
    }
    return { status: 404, body: { success: false, code: 'REQUEST_NOT_FOUND', message: 'Pending outgoing connection request not found.' } };
  }
  fallbackPendingRequests.delete(`${authUser.id}:${pendingRow.user_b_id}`);

  if (!isFallbackOnly) {
    const nowIso = new Date().toISOString();
    let patchRes = await sbRest(`user_connections?id=eq.${encodeURIComponent(pendingRow.id)}`, {
      method: 'PATCH',
      body: { status: 'cancelled', cancelled_at: nowIso, updated_at: nowIso },
    });
    if (!patchRes.ok && patchRes.status === 400 && !String(patchRes.error || '').includes('23514')) {
      patchRes = await sbRest(`user_connections?id=eq.${encodeURIComponent(pendingRow.id)}`, {
        method: 'PATCH',
        body: { status: 'cancelled' },
      });
    }
    if (!patchRes.ok && (String(patchRes.error || '').includes('user_connections_status_check') || String(patchRes.error || '').includes('23514'))) {
      patchRes = await sbRest(`user_connections?id=eq.${encodeURIComponent(pendingRow.id)}`, {
        method: 'DELETE',
      });
    }
    if (!patchRes.ok) {
      return { status: 503, body: { success: false, code: 'REQUEST_FAILED', message: 'Unable to cancel connection request right now.' } };
    }
  }

  await updateConnectionRequestNotificationsState({
    requestId: String(pendingRow.id),
    requesterId: authUser.id,
    receiverId: pendingRow.user_b_id,
    status: 'cancelled',
  }).catch(() => {});

  return {
    status: 200,
    body: {
      success: true,
      status: 'cancelled',
      requestId: String(pendingRow.id),
      message: 'Connection request cancelled.',
    },
  };
}

export async function removeSavedConnectionRest(authUser: AuthenticatedUser, targetOrContactId: string) {
  const rawId = (targetOrContactId || '').trim();
  if (!rawId) {
    return { status: 400, body: { success: false, message: 'Contact or peer user ID is required.' } };
  }

  let contactRow: any = null;
  let peerUserId: string | null = null;

  if (rawId.startsWith('conn_')) {
    peerUserId = rawId.slice(5).trim() || null;
  } else {
    const ownedContactRes = await sbRest<any[]>(
      `udhar_contacts?id=eq.${encodeURIComponent(rawId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
    );
    if (ownedContactRes.ok && ownedContactRes.data && ownedContactRes.data.length > 0) {
      contactRow = ownedContactRes.data[0];
      peerUserId = contactRow.linked_user_id || null;
    } else {
      peerUserId = rawId;
    }
  }

  if (!contactRow && !peerUserId) {
    return { status: 404, body: { success: false, message: 'Saved connection not found.' } };
  }

  // Ownership / participation check when rawId wasn't a direct owned contact ID
  if (!contactRow && peerUserId) {
    const [peerContactsRes, peerConnsRes] = await Promise.all([
      sbRest<any[]>(
        `udhar_contacts?user_id=eq.${encodeURIComponent(authUser.id)}&linked_user_id=eq.${encodeURIComponent(peerUserId)}&limit=1`
      ),
      sbRest<any[]>(
        `user_connections?or=(and(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(peerUserId)}),and(user_a_id.eq.${encodeURIComponent(peerUserId)},user_b_id.eq.${encodeURIComponent(authUser.id)}))&select=id,status`
      ),
    ]);
    const hasContact = Boolean(peerContactsRes.ok && peerContactsRes.data && peerContactsRes.data.length > 0);
    const hasConnection = Boolean(
      peerConnsRes.ok &&
        peerConnsRes.data &&
        peerConnsRes.data.some((c) => c.status !== 'deleted')
    );
    if (!hasContact && !hasConnection) {
      return { status: 404, body: { success: false, message: 'Saved connection not found.' } };
    }
  }

  // Delete explicit contact row if found
  if (contactRow?.id) {
    const delOwn = await sbRest(
      `udhar_contacts?id=eq.${encodeURIComponent(contactRow.id)}&user_id=eq.${encodeURIComponent(authUser.id)}`,
      { method: 'DELETE' }
    );
    if (!delOwn.ok) {
      return { status: 500, body: { success: false, message: delOwn.error || 'Failed to remove saved contact.' } };
    }
  }

  // Instant two-sided removal of reciprocal Saved People entries + user_connections
  if (peerUserId && peerUserId !== authUser.id) {
    const nowIso = new Date().toISOString();
    await Promise.all([
      sbRest(
        `udhar_contacts?user_id=eq.${encodeURIComponent(authUser.id)}&linked_user_id=eq.${encodeURIComponent(peerUserId)}`,
        { method: 'DELETE' }
      ).catch(() => {}),
      sbRest(
        `udhar_contacts?user_id=eq.${encodeURIComponent(peerUserId)}&linked_user_id=eq.${encodeURIComponent(authUser.id)}`,
        { method: 'DELETE' }
      ).catch(() => {}),
    ]);

    const isStatusConstraintErr = (msg: string) =>
      msg.includes('user_connections_status_check') || msg.includes('23514');

    const connPatchFilter = `user_connections?or=(and(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(peerUserId)}),and(user_a_id.eq.${encodeURIComponent(peerUserId)},user_b_id.eq.${encodeURIComponent(authUser.id)}))`;
    let connDelRes = await sbRest(connPatchFilter, {
      method: 'PATCH',
      body: { status: 'deleted', deleted_at: nowIso, deleted_by: authUser.id, updated_at: nowIso },
    });
    if (!connDelRes.ok && connDelRes.status === 400 && !isStatusConstraintErr(String(connDelRes.error || ''))) {
      connDelRes = await sbRest(connPatchFilter, {
        method: 'PATCH',
        body: { status: 'deleted' },
      });
    }
    if (!connDelRes.ok && isStatusConstraintErr(String(connDelRes.error || ''))) {
      await sbRest(connPatchFilter, { method: 'DELETE' }).catch(() => {});
    }

    await Promise.all([
      updateConnectionRequestNotificationsState({
        requesterId: authUser.id,
        receiverId: peerUserId,
        status: 'cancelled',
      }).catch(() => {}),
      updateConnectionRequestNotificationsState({
        requesterId: peerUserId,
        receiverId: authUser.id,
        status: 'cancelled',
      }).catch(() => {}),
    ]);
  }

  return {
    status: 200,
    body: {
      success: true,
      removed: true,
      twoSided: Boolean(peerUserId && peerUserId !== authUser.id),
      peerUserId,
      preservedTransactions: true,
      message: 'Connection removed from Saved People. Existing Udhaar history remains preserved.',
    },
  };
}

export async function disconnectUserRest(authUser: AuthenticatedUser, targetUserId: string) {
  const targetId = (targetUserId || '').trim();
  if (!targetId) {
    return { status: 400, body: { success: false, message: 'Target user ID is required.' } };
  }
  const removal = await removeSavedConnectionRest(authUser, targetId);
  if (removal.status !== 200) {
    return removal;
  }

  return {
    status: 200,
    body: {
      success: true,
      status: 'disconnected',
      twoSided: true,
      preservedTransactions: true,
      message: 'Connection removed from both Saved People lists. Existing Udhar transaction history has been preserved.',
    },
  };
}

export async function getPrivacyConsentsRest(authUser: AuthenticatedUser) {
  let res = await sbRest<any[]>(
    `user_consents?user_id=eq.${encodeURIComponent(authUser.id)}&select=id,user_id,purpose,status,consent_status,action,policy_version,consent_wording,granted_at,withdrawn_at,source,audit_metadata,created_at,updated_at&order=created_at.desc&limit=200`
  );
  if (!res.ok && res.status === 400) {
    // Graceful fallback if optional audit columns are not yet migrated on remote Supabase
    res = await sbRest<any[]>(
      `user_consents?user_id=eq.${encodeURIComponent(authUser.id)}&select=id,user_id,purpose,status,action,policy_version,consent_wording,created_at,updated_at&order=created_at.desc&limit=200`
    );
  }
  if (!res.ok) {
    return {
      status: 503,
      body: {
        success: false,
        message: res.error || 'Could not load saved privacy choices from Supabase.',
      },
    };
  }
  const history = res.data || [];
  const latestByCategory: Record<string, any> = {};
  for (const row of history) {
    if (!latestByCategory[row.purpose]) {
      const effectiveStatus = row.consent_status || row.status;
      latestByCategory[row.purpose] = {
        category: row.purpose,
        purpose: row.purpose,
        status: effectiveStatus,
        consent_status: effectiveStatus,
        policyVersion: row.policy_version,
        consentedAt: row.granted_at || (effectiveStatus === 'granted' ? row.created_at : null),
        grantedAt: row.granted_at || (effectiveStatus === 'granted' ? row.created_at : null),
        revokedAt: row.withdrawn_at || (effectiveStatus === 'withdrawn' ? row.created_at : null),
        withdrawnAt: row.withdrawn_at || (effectiveStatus === 'withdrawn' ? row.created_at : null),
        source: row.source || null,
        updatedAt: row.created_at,
      };
    }
  }
  return {
    status: 200,
    body: {
      success: true,
      consents: latestByCategory,
      history,
      policyVersion: 'v2.1 — DPDP Act 2023 & Rules 2025',
    },
  };
}

export async function recordPrivacyConsentRest(
  authUser: AuthenticatedUser,
  body: {
    category?: string;
    purpose?: string;
    status?: 'granted' | 'withdrawn';
    wording?: string;
    policyVersion?: string;
    source?: string;
    auditMetadata?: Record<string, unknown>;
    idempotencyKey?: string;
  }
) {
  const purpose = (body.category || body.purpose || '').trim();
  const status = body.status === 'withdrawn' ? 'withdrawn' : 'granted';
  if (!purpose) {
    return { status: 400, body: { success: false, message: 'Consent category is required.' } };
  }
  const policyVersion = (body.policyVersion || 'v2.1 — DPDP Act 2023 & Rules 2025').trim();
  const wording = (body.wording || `User explicitly ${status} consent for ${purpose}.`).trim();
  const nowIso = new Date().toISOString();

  const extendedRow: Record<string, any> = {
    user_id: authUser.id,
    user_email: authUser.email,
    purpose,
    status,
    consent_status: status,
    action: status,
    policy_version: policyVersion,
    consent_wording: wording,
    granted_at: status === 'granted' ? nowIso : null,
    withdrawn_at: status === 'withdrawn' ? nowIso : null,
    source: body.source || 'privacy_choices_modal',
    audit_metadata: body.auditMetadata || {},
    idempotency_key: body.idempotencyKey || null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  let ins = await sbRest<any[]>('user_consents', {
    method: 'POST',
    prefer: 'return=representation',
    body: extendedRow,
  });

  // Fallback to legacy columns if remote Supabase table hasn't added the new audit columns yet
  if (!ins.ok && ins.status === 400) {
    ins = await sbRest<any[]>('user_consents', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        user_id: authUser.id,
        user_email: authUser.email,
        purpose,
        status,
        action: status,
        policy_version: policyVersion,
        consent_wording: wording,
        created_at: nowIso,
        updated_at: nowIso,
      },
    });
  }

  // Handle idempotent duplicate conflict (409) cleanly
  if (!ins.ok && ins.status === 409 && body.idempotencyKey) {
    return {
      status: 200,
      body: {
        success: true,
        category: purpose,
        status,
        deduplicated: true,
        consent: { purpose, status, policy_version: policyVersion, created_at: nowIso },
      },
    };
  }

  if (!ins.ok) {
    return {
      status: 503,
      body: {
        success: false,
        message: ins.error || 'Could not save consent preference to Supabase right now.',
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      category: purpose,
      status,
      consent: ins.data?.[0] || { purpose, status, policy_version: policyVersion, created_at: nowIso },
    },
  };
}

export async function recordPrivacyConsentBatchRest(
  authUser: AuthenticatedUser,
  entries: Array<{
    purpose: string;
    status: 'granted' | 'withdrawn';
    policyVersion: string;
    source: string;
    auditMetadata: Record<string, unknown>;
    idempotencyKey: string;
    wording: string;
  }>
) {
  const nowIso = new Date().toISOString();
  const extendedRows = entries.map((e) => ({
    user_id: authUser.id,
    user_email: authUser.email,
    purpose: e.purpose,
    status: e.status,
    consent_status: e.status,
    action: e.status,
    policy_version: e.policyVersion,
    consent_wording: e.wording,
    granted_at: e.status === 'granted' ? nowIso : null,
    withdrawn_at: e.status === 'withdrawn' ? nowIso : null,
    source: e.source,
    audit_metadata: e.auditMetadata || {},
    idempotency_key: e.idempotencyKey,
    created_at: nowIso,
    updated_at: nowIso,
  }));

  let ins = await sbRest<any[]>('user_consents', {
    method: 'POST',
    prefer: 'return=representation',
    body: extendedRows,
  });

  if (!ins.ok && ins.status === 400) {
    const legacyRows = entries.map((e) => ({
      user_id: authUser.id,
      user_email: authUser.email,
      purpose: e.purpose,
      status: e.status,
      action: e.status,
      policy_version: e.policyVersion,
      consent_wording: e.wording,
      created_at: nowIso,
      updated_at: nowIso,
    }));
    ins = await sbRest<any[]>('user_consents', {
      method: 'POST',
      prefer: 'return=representation',
      body: legacyRows,
    });
  }

  if (!ins.ok && ins.status === 409) {
    return {
      status: 200,
      body: {
        success: true,
        deduplicated: true,
        records: extendedRows,
      },
    };
  }

  if (!ins.ok) {
    return {
      status: 503,
      body: {
        success: false,
        message: ins.error || 'Could not save your privacy choices to Supabase right now.',
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      records: ins.data || extendedRows,
    },
  };
}

// ============================================================================
// 3. CONTACTS (Manual Local vs Explicitly Linked Registered)
// ============================================================================
async function buildMergedDirectoryForUserRest(
  authUser: AuthenticatedUser,
  activeTxs: any[] = []
) {
  const [contactsRes, connsRes] = await Promise.all([
    sbRest<any[]>(`udhar_contacts?user_id=eq.${encodeURIComponent(authUser.id)}&order=name.asc`),
    sbRest<any[]>(
      `user_connections?or=(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(authUser.id)})&status=eq.connected`
    ),
  ]);

  if (!contactsRes.ok) {
    return { ok: false as const, error: contactsRes.error || 'Failed to load contacts.' };
  }

  const rawContacts = contactsRes.data || [];
  const connectedPeerIds = new Set<string>();
  if (connsRes.ok && Array.isArray(connsRes.data)) {
    for (const conn of connsRes.data) {
      const peerId = conn.user_a_id === authUser.id ? conn.user_b_id : conn.user_a_id;
      if (peerId && peerId !== authUser.id) {
        connectedPeerIds.add(peerId);
      }
    }
  }

  const allUserIds = Array.from(
    new Set([
      ...rawContacts.map((r) => r.linked_user_id).filter(Boolean),
      ...Array.from(connectedPeerIds),
    ])
  );
  const userMap = await fetchUsersByIds(allUserIds);

  const deduped: any[] = [];
  const seenLinkedIds = new Set<string>();
  const seenUnlinkedNames = new Set<string>();

  for (const c of rawContacts) {
    const linkedId = c.linked_user_id || null;
    const normName = (c.name || '').trim().toLowerCase();
    if (linkedId) {
      if (seenLinkedIds.has(linkedId)) continue;
      seenLinkedIds.add(linkedId);
    } else if (normName) {
      if (seenUnlinkedNames.has(normName)) continue;
      seenUnlinkedNames.add(normName);
    }
    deduped.push(c);
  }

  // Synthesize missing entries for accepted user_connections
  for (const peerId of connectedPeerIds) {
    if (seenLinkedIds.has(peerId)) continue;
    const u = userMap.get(peerId);
    if (!u || !isDiscoverableNormalUser(u)) continue;
    seenLinkedIds.add(peerId);
    deduped.push({
      id: `conn_${peerId}`,
      user_id: authUser.id,
      name: (u.full_name || u.email?.split('@')[0] || 'Connected User').trim(),
      email: u.email ? maskEmailForPrivacy(u.email) : null,
      phone: null,
      photo_url: u.avatar_url || null,
      relationship_type: 'Friend',
      notes: null,
      linked_user_id: peerId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  deduped.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return { ok: true as const, contacts: deduped, userMap };
}

export async function getContactsRest(authUser: AuthenticatedUser) {
  const txRes = await sbRest<any[]>(
    `udhar_transactions?user_id=eq.${encodeURIComponent(authUser.id)}`
  );
  const activeTxs = (txRes.ok && Array.isArray(txRes.data))
    ? txRes.data.filter((t) => normalizeUdharLifecycleStatus(t) !== 'deleted')
    : [];

  const merged = await buildMergedDirectoryForUserRest(authUser, activeTxs);
  if (!merged.ok) {
    return { status: 503, body: { success: false, message: 'Failed to load contacts.' } };
  }

  const contacts = merged.contacts.map((c) => {
    const u = c.linked_user_id ? merged.userMap.get(c.linked_user_id) : null;
    return {
      ...c,
      linked_user_name: u?.full_name || null,
      linked_user_email: u?.email ? maskEmailForPrivacy(u.email) : null,
      linked_user_avatar: u?.avatar_url || null,
      is_registered: Boolean(c.linked_user_id),
    };
  });

  return { status: 200, body: { success: true, contacts } };
}

export async function getContactsWithBalancesRest(authUser: AuthenticatedUser) {
  const txRes = await sbRest<any[]>(`udhar_transactions?user_id=eq.${encodeURIComponent(authUser.id)}`);
  const activeTxs = (txRes.ok && Array.isArray(txRes.data))
    ? txRes.data.filter((t) => normalizeUdharLifecycleStatus(t) !== 'deleted')
    : [];

  const merged = await buildMergedDirectoryForUserRest(authUser, activeTxs);
  if (!merged.ok) {
    return { status: 503, body: { success: false, message: 'Failed to load people contacts.' } };
  }

  const parsedContacts = merged.contacts.map((c) => {
    const u = c.linked_user_id ? merged.userMap.get(c.linked_user_id) : null;
    const matchingTxs = activeTxs.filter((t) => {
      if (c.linked_user_id && t.counterpart_user_id === c.linked_user_id) return true;
      if (!c.linked_user_id && !t.counterpart_user_id && (t.counterpart_name || '').trim().toLowerCase() === (c.name || '').trim().toLowerCase()) {
        return true;
      }
      return false;
    });

    let totalGiven = 0;
    let totalTaken = 0;
    let receivable = 0;
    let payable = 0;
    let lastDate: string | null = null;
    let pendingCount = 0;
    let pendingRequestsCount = 0;
    let pendingRequestsAmount = 0;
    let pendingGivenAmount = 0;
    let pendingReceivedAmount = 0;
    let rejectedCount = 0;

    for (const t of matchingTxs) {
      const lifecycle = normalizeUdharLifecycleStatus(t);
      if (lifecycle === 'deleted') continue;

      if (t.transaction_date && (!lastDate || t.transaction_date > lastDate)) {
        lastDate = t.transaction_date;
      }

      if (lifecycle === 'rejected') {
        rejectedCount += 1;
        continue;
      }
      if (lifecycle === 'cancelled') continue;

      const orig = parseFloat(t.original_amount) || 0;
      if (lifecycle === 'pending_confirmation') {
        pendingRequestsCount += 1;
        pendingRequestsAmount += orig;
        if (t.direction === 'gave') pendingGivenAmount += orig;
        else pendingReceivedAmount += orig;
        continue;
      }

      const cur = parseFloat(t.current_balance) || 0;
      const isSettled = lifecycle === 'settled' || cur <= 0.01;
      if (t.direction === 'gave') {
        totalGiven += orig;
        if (!isSettled) receivable += cur;
      } else {
        totalTaken += orig;
        if (!isSettled) payable += cur;
      }
      if (!isSettled && cur > 0.01) pendingCount += 1;
    }

    return {
      ...c,
      linked_user_name: u?.full_name || null,
      linked_user_email: u?.email ? maskEmailForPrivacy(u.email) : null,
      linked_user_avatar: u?.avatar_url || null,
      total_given: roundMoney(totalGiven),
      total_taken: roundMoney(totalTaken),
      outstanding_receivable: roundMoney(receivable),
      outstanding_payable: roundMoney(payable),
      net_balance: roundMoney(receivable - payable),
      last_transaction_date: lastDate,
      total_transactions_count: matchingTxs.length,
      pending_transactions_count: pendingCount,
      pending_requests_count: pendingRequestsCount,
      pending_requests_amount: roundMoney(pendingRequestsAmount),
      pending_given_amount: roundMoney(pendingGivenAmount),
      pending_received_amount: roundMoney(pendingReceivedAmount),
      rejected_count: rejectedCount,
      is_registered: Boolean(c.linked_user_id),
    };
  });

  return { status: 200, body: { success: true, contacts: parsedContacts } };
}

export async function saveContactRest(authUser: AuthenticatedUser, body: any) {
  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const phone = (body.phone || '').trim();
  const relationshipType = (body.relationship_type || body.relationshipType || 'Friend').trim();
  const notes = (body.notes || '').trim();
  const photoUrl = (body.photo_url || body.photoUrl || '').trim() || null;
  const requestedLinkedUserId = (body.linked_user_id || body.linkedUserId || '').trim() || null;

  if (!name) {
    return { status: 400, body: { success: false, message: "Person's name is required." } };
  }

  // IMPORTANT SECURITY RULE: NEVER silently auto-link manual contacts by name match,
  // and NEVER create an active connected entry for a searched registered user without Method A acceptance!
  if (requestedLinkedUserId) {
    if (requestedLinkedUserId === authUser.id) {
      return { status: 400, body: { success: false, message: 'You cannot add yourself as a contact.' } };
    }
    const pairRes = await sbRest<any[]>(
      `user_connections?or=(and(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(requestedLinkedUserId)}),and(user_a_id.eq.${encodeURIComponent(requestedLinkedUserId)},user_b_id.eq.${encodeURIComponent(authUser.id)}))&select=id,status`
    );
    const isAlreadyConnected = Boolean(
      pairRes.ok && pairRes.data && pairRes.data.some((r) => r.status === 'connected')
    );

    if (!isAlreadyConnected) {
      return connectUserRest(authUser, {
        targetUserId: requestedLinkedUserId,
        relationshipType,
        requestedVia: 'search',
      });
    }

    const targetRes = await sbRest<any[]>(
      `app_users?id=eq.${encodeURIComponent(requestedLinkedUserId)}&status=eq.active&select=id,full_name,email,phone,avatar_url,role,status,deletion_status`
    );
    if (!targetRes.ok || !targetRes.data || targetRes.data.length === 0) {
      return { status: 404, body: { success: false, message: 'Selected user account was not found.' } };
    }
    const target = targetRes.data[0];
    const nowIso = new Date().toISOString();
    const upsertRes = await upsertUdharContactRest({
      user_id: authUser.id,
      name: target.full_name || name,
      email: target.email || null,
      phone: target.phone || null,
      photo_url: target.avatar_url || photoUrl,
      relationship_type: relationshipType,
      notes: notes || null,
      linked_user_id: target.id,
      updated_at: nowIso,
    });
    if (!upsertRes.ok || !upsertRes.data || upsertRes.data.length === 0) {
      return { status: 500, body: { success: false, message: upsertRes.error || 'Failed to save contact.' } };
    }
    return {
      status: 200,
      body: {
        success: true,
        status: 'connected',
        contact: upsertRes.data[0],
        reciprocallyLinked: true,
      },
    };
  }

  // If user entered an exact email or 10-digit phone manually without picking from search,
  // check if a registered user matches and route through two-sided connection flow.
  if (!requestedLinkedUserId && (email || phone.replace(/\D/g, '').length >= 10)) {
    let matchedUser: any = null;
    if (email) {
      const emailRes = await sbRest<any[]>(
        `app_users?status=eq.active&email=ilike.${encodeURIComponent(email)}&select=id,full_name,email,phone,avatar_url,role,status,deletion_status&limit=1`
      );
      if (emailRes.ok && emailRes.data?.[0] && isDiscoverableNormalUser(emailRes.data[0])) {
        matchedUser = emailRes.data[0];
      }
    }
    if (!matchedUser) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= 10) {
        const tail = digits.slice(-10);
        const phoneRes = await sbRest<any[]>(
          `app_users?status=eq.active&phone=ilike.*${encodeURIComponent(tail)}*&select=id,full_name,email,phone,avatar_url,role,status,deletion_status&limit=5`
        );
        if (phoneRes.ok && Array.isArray(phoneRes.data)) {
          matchedUser = phoneRes.data.find((u) => {
            const uDigits = String(u.phone || '').replace(/\D/g, '');
            return uDigits.length >= 10 && uDigits.slice(-10) === tail && isDiscoverableNormalUser(u);
          });
        }
      }
    }
    if (matchedUser && matchedUser.id !== authUser.id) {
      return connectUserRest(authUser, {
        targetUserId: matchedUser.id,
        relationshipType,
        requestedVia: 'manual',
      });
    }
  }

  const nowIso = new Date().toISOString();
  const payload = {
    user_id: authUser.id,
    name,
    email: email || null,
    phone: phone || null,
    photo_url: photoUrl,
    relationship_type: relationshipType,
    notes: notes || null,
    linked_user_id: null,
    updated_at: nowIso,
  };

  const upsertRes = await upsertUdharContactRest(payload);
  if (!upsertRes.ok || !upsertRes.data || upsertRes.data.length === 0) {
    return { status: 500, body: { success: false, message: upsertRes.error || 'Failed to save contact.' } };
  }

  return {
    status: 200,
    body: {
      success: true,
      contact: upsertRes.data[0],
      reciprocallyLinked: false,
    },
  };
}

export async function updateContactRest(authUser: AuthenticatedUser, contactId: string, body: any) {
  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const phone = (body.phone || '').trim();
  const relationshipType = (body.relationship_type || body.relationshipType || 'Friend').trim();
  const notes = (body.notes || '').trim();
  const photoUrl = body.photo_url !== undefined ? (body.photo_url || null) : undefined;

  if (!name) {
    return { status: 400, body: { success: false, message: "Person's name is required." } };
  }

  // Handle synthetic conn_<peerUserId> contacts for 2-way connected users
  if (contactId.startsWith('conn_')) {
    const peerUserId = contactId.slice(5).trim();
    if (!peerUserId || peerUserId === authUser.id) {
      return { status: 400, body: { success: false, message: 'Invalid connected user identifier.' } };
    }
    const connRes = await sbRest<any[]>(
      `user_connections?or=(and(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(peerUserId)}),and(user_a_id.eq.${encodeURIComponent(peerUserId)},user_b_id.eq.${encodeURIComponent(authUser.id)}))&status=eq.connected&select=id&limit=1`
    );
    if (!connRes.ok || !connRes.data || connRes.data.length === 0) {
      return { status: 404, body: { success: false, message: 'Active connection not found.' } };
    }

    // Check if an udhar_contacts row already exists for this linked_user_id
    const existingByPeer = await sbRest<any[]>(
      `udhar_contacts?user_id=eq.${encodeURIComponent(authUser.id)}&linked_user_id=eq.${encodeURIComponent(peerUserId)}&limit=1`
    );
    if (existingByPeer.ok && existingByPeer.data && existingByPeer.data.length > 0) {
      const existingRow = existingByPeer.data[0];
      const updRes = await sbRest<any[]>(
        `udhar_contacts?id=eq.${encodeURIComponent(existingRow.id)}&user_id=eq.${encodeURIComponent(authUser.id)}`,
        {
          method: 'PATCH',
          prefer: 'return=representation',
          body: {
            name,
            relationship_type: relationshipType,
            notes: notes || null,
            updated_at: new Date().toISOString(),
          },
        }
      );
      if (!updRes.ok || !updRes.data || updRes.data.length === 0) {
        return { status: 500, body: { success: false, message: updRes.error || 'Failed to update contact.' } };
      }
      return { status: 200, body: { success: true, contact: updRes.data[0], reciprocallyLinked: true } };
    }

    const insRes = await sbRest<any[]>('udhar_contacts', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        user_id: authUser.id,
        name,
        relationship_type: relationshipType,
        notes: notes || null,
        linked_user_id: peerUserId,
      },
    });
    if (!insRes.ok || !insRes.data || insRes.data.length === 0) {
      return { status: 500, body: { success: false, message: insRes.error || 'Failed to save contact nickname.' } };
    }
    return { status: 200, body: { success: true, contact: insRes.data[0], reciprocallyLinked: true } };
  }

  const existingRes = await sbRest<any[]>(
    `udhar_contacts?id=eq.${encodeURIComponent(contactId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!existingRes.ok || !existingRes.data || existingRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Contact not found.' } };
  }

  const existing = existingRes.data[0];
  const isLinked = Boolean(existing.linked_user_id);
  // Ownership & privacy rule: for 2-way linked users, only allow editing local contact nickname, relationship, and notes.
  const patchBody: Record<string, any> = {
    name,
    relationship_type: relationshipType,
    notes: notes || null,
    updated_at: new Date().toISOString(),
  };
  if (!isLinked) {
    patchBody.email = email || null;
    patchBody.phone = phone || null;
    if (photoUrl !== undefined) patchBody.photo_url = photoUrl;
  }

  const updRes = await sbRest<any[]>(
    `udhar_contacts?id=eq.${encodeURIComponent(contactId)}&user_id=eq.${encodeURIComponent(authUser.id)}`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: patchBody,
    }
  );

  if (!updRes.ok || !updRes.data || updRes.data.length === 0) {
    return { status: 500, body: { success: false, message: updRes.error || 'Failed to update contact.' } };
  }

  return {
    status: 200,
    body: {
      success: true,
      contact: updRes.data[0],
      reciprocallyLinked: isLinked,
    },
  };
}

export async function deleteContactRest(authUser: AuthenticatedUser, contactId: string) {
  return removeSavedConnectionRest(authUser, contactId);
}

export async function linkContactRest(authUser: AuthenticatedUser, contactId: string, registeredUserId: string) {
  if (!registeredUserId) {
    return { status: 400, body: { success: false, message: 'Target registered user ID is required.' } };
  }
  if (registeredUserId === authUser.id) {
    return { status: 400, body: { success: false, message: 'You cannot link a contact to your own account.' } };
  }

  const [contactRes, targetRes, pairRes] = await Promise.all([
    sbRest<any[]>(`udhar_contacts?id=eq.${encodeURIComponent(contactId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`),
    sbRest<any[]>(`app_users?id=eq.${encodeURIComponent(registeredUserId)}&status=eq.active&select=id,full_name,email,phone,avatar_url,role,status,deletion_status&limit=1`),
    sbRest<any[]>(
      `user_connections?or=(and(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(registeredUserId)}),and(user_a_id.eq.${encodeURIComponent(registeredUserId)},user_b_id.eq.${encodeURIComponent(authUser.id)}))&select=id,status`
    ),
  ]);

  if (!contactRes.ok || !contactRes.data || contactRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Contact not found.' } };
  }
  if (!targetRes.ok || !targetRes.data || targetRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Registered user not found.' } };
  }
  const contact = contactRes.data[0];
  const target = targetRes.data[0];

  if (!isDiscoverableNormalUser(target)) {
    return { status: 403, body: { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'Target user account is not eligible for Udhar connections.' } };
  }
  if (await isBlockedBetween(authUser.id, target.id)) {
    return { status: 403, body: { success: false, message: 'Cannot link with a blocked account.' } };
  }

  const isAlreadyConnected = Boolean(
    pairRes.ok && pairRes.data && pairRes.data.some((c) => c.status === 'connected')
  );

  if (!isAlreadyConnected) {
    // Linking a manual contact to a registered account requires consent (Method A request)
    const reqResult = await connectUserRest(authUser, {
      targetUserId: target.id,
      relationshipType: contact.relationship_type || 'Friend',
      requestedVia: 'search',
    });
    return {
      status: reqResult.status,
      body: {
        ...reqResult.body,
        pendingApproval: reqResult.body.status === 'pending',
      },
    };
  }

  await sbRest(`udhar_contacts?id=eq.${encodeURIComponent(contactId)}&user_id=eq.${encodeURIComponent(authUser.id)}`, {
    method: 'PATCH',
    body: {
      linked_user_id: target.id,
      email: target.email || contact.email || null,
      phone: target.phone || contact.phone || null,
      photo_url: target.avatar_url || contact.photo_url || null,
      updated_at: new Date().toISOString(),
    },
  });

  await ensureConnectionAndReciprocalContactsRest(authUser, target, contact.relationship_type || 'Friend', {
    connectionMethod: 'SEARCH',
    requestedVia: 'search',
  });

  return {
    status: 200,
    body: {
      success: true,
      status: 'connected',
      message: `Successfully linked ${contact.name} with verified account ${target.full_name}.`,
    },
  };
}

// ============================================================================
// 4. MY QR, REGENERATE QR, RESOLVE QR & CONNECT VIA QR (Server-Backed Unique)
// ============================================================================
export async function getMyQrRest(authUser: AuthenticatedUser) {
  const nowIso = new Date().toISOString();
  const existing = await sbRest<any[]>(
    `qr_pairing_tokens?user_id=eq.${encodeURIComponent(authUser.id)}&used=eq.false&expires_at=gt.${encodeURIComponent(nowIso)}&order=created_at.desc&limit=1`
  );

  let pairingToken = '';
  let pairingCode = '';
  let expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  if (existing.ok && existing.data && existing.data.length > 0) {
    pairingToken = existing.data[0].pairing_token;
    pairingCode = existing.data[0].pairing_code;
    expiresAt = existing.data[0].expires_at || expiresAt;
  } else {
    pairingToken = crypto.randomBytes(32).toString('hex');
    pairingCode = `MM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const ins = await sbRest<any[]>('qr_pairing_tokens', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        user_id: authUser.id,
        pairing_token: pairingToken,
        pairing_code: pairingCode,
        is_single_use: false,
        used: false,
        expires_at: expiresAt,
      },
    });
    if (!ins.ok) {
      return {
        status: 503,
        body: { success: false, message: 'Unable to persist your unique QR identity right now. Please retry.' },
      };
    }
  }

  const qrPayload = JSON.stringify({
    app: 'my-money',
    v: 2,
    type: 'udhar-pair',
    token: pairingToken,
    code: pairingCode,
    exp: new Date(expiresAt).getTime(),
  });

  return {
    status: 200,
    body: {
      success: true,
      pairingToken,
      pairingCode,
      publicName: authUser.full_name || authUser.email?.split('@')[0] || 'User',
      avatarUrl: authUser.avatar_url || null,
      qrData: qrPayload,
      expiresAt,
    },
  };
}

export async function regenerateQrRest(authUser: AuthenticatedUser) {
  // Revoke all old QR tokens for this user
  await sbRest(`qr_pairing_tokens?user_id=eq.${encodeURIComponent(authUser.id)}&used=eq.false`, {
    method: 'PATCH',
    body: { used: true },
  });

  const pairingToken = crypto.randomBytes(32).toString('hex');
  const pairingCode = `MM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const ins = await sbRest<any[]>('qr_pairing_tokens', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      user_id: authUser.id,
      pairing_token: pairingToken,
      pairing_code: pairingCode,
      is_single_use: false,
      used: false,
      expires_at: expiresAt,
    },
  });

  if (!ins.ok) {
    return {
      status: 503,
      body: { success: false, message: 'Could not regenerate QR code right now. Please try again.' },
    };
  }

  const qrPayload = JSON.stringify({
    app: 'my-money',
    v: 2,
    type: 'udhar-pair',
    token: pairingToken,
    code: pairingCode,
    exp: new Date(expiresAt).getTime(),
  });

  return {
    status: 200,
    body: {
      success: true,
      message: 'Fresh QR code generated successfully. Previous codes have been revoked.',
      pairingToken,
      pairingCode,
      publicName: authUser.full_name || authUser.email?.split('@')[0] || 'User',
      avatarUrl: authUser.avatar_url || null,
      qrData: qrPayload,
      expiresAt,
    },
  };
}

export async function resolveQrRest(authUser: AuthenticatedUser, body: any) {
  let targetToken = (body.pairingToken || '').trim();
  let targetCode = (body.pairingCode || '').replace(/\s+/g, '').trim().toUpperCase();
  const rawData = (body.qrData || '').trim();

  if (rawData) {
    const parsed = parseQrPayload(rawData);
    if (!parsed.valid) {
      return {
        status: 400,
        body: {
          success: false,
          code: parsed.errorCode || 'INVALID_QR',
          message: parsed.error || 'Invalid QR format.',
        },
      };
    }
    if (parsed.token) targetToken = parsed.token;
    if (parsed.code) targetCode = parsed.code;
  }

  if (!targetToken && !targetCode) {
    return {
      status: 400,
      body: { success: false, code: 'INVALID_QR', message: 'No valid QR pairing token or code provided.' },
    };
  }

  const filter = targetToken && targetCode
    ? `or=(pairing_token.eq.${encodeURIComponent(targetToken)},pairing_code.eq.${encodeURIComponent(targetCode)})`
    : targetToken
      ? `pairing_token=eq.${encodeURIComponent(targetToken)}`
      : `pairing_code=eq.${encodeURIComponent(targetCode)}`;

  const tokRes = await sbRest<any[]>(`qr_pairing_tokens?${filter}&order=created_at.desc&limit=1`);
  if (!tokRes.ok) {
    return { status: 503, body: { success: false, code: 'SERVICE_UNAVAILABLE', message: 'Unable to verify QR code right now. Please retry.' } };
  }
  if (!tokRes.data || tokRes.data.length === 0) {
    return {
      status: 404,
      body: {
        success: false,
        code: 'NOT_FOUND',
        message: 'Pairing code or QR not recognized. Ask your friend to share their latest My Money Manager Udhar Pairing QR.',
      },
    };
  }

  const qrRecord = tokRes.data[0];
  if (qrRecord.used || (qrRecord.is_single_use && qrRecord.used_at)) {
    return {
      status: 410,
      body: {
        success: false,
        code: 'QR_REVOKED',
        message: 'This pairing QR has already been used or revoked. Ask your friend to share their new Udhar Pairing QR.',
      },
    };
  }
  if (qrRecord.expires_at && new Date(qrRecord.expires_at) <= new Date()) {
    return {
      status: 410,
      body: {
        success: false,
        code: 'QR_EXPIRED',
        message: 'This pairing QR has expired. Ask your friend to tap Reset QR to generate a fresh code.',
      },
    };
  }
  if (qrRecord.user_id === authUser.id) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'SELF_CONNECTION',
        message: 'This is your own Udhar pairing QR. You cannot pair with yourself.',
      },
    };
  }

  const userRes = await sbRest<any[]>(
    `app_users?id=eq.${encodeURIComponent(qrRecord.user_id)}&select=id,full_name,email,phone,avatar_url,role,status,deletion_status,is_verified&limit=1`
  );
  if (!userRes.ok || !userRes.data || userRes.data.length === 0) {
    return {
      status: 404,
      body: { success: false, code: 'NOT_FOUND', message: 'Account not found.' },
    };
  }
  const owner = userRes.data[0];
  if (!isDiscoverableNormalUser(owner)) {
    return {
      status: 403,
      body: { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'This user account is unavailable for Udhar connections.' },
    };
  }
  if (await isBlockedBetween(authUser.id, owner.id)) {
    return {
      status: 403,
      body: { success: false, code: 'BLOCKED', message: 'You cannot connect with this account.' },
    };
  }

  const connRes = await sbRest<any[]>(
    `user_connections?or=(and(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(owner.id)}),and(user_a_id.eq.${encodeURIComponent(owner.id)},user_b_id.eq.${encodeURIComponent(authUser.id)}))&select=id,user_a_id,user_b_id,status`
  );
  const connRows = (connRes.ok && Array.isArray(connRes.data)) ? connRes.data : [];
  const isAlreadyConnected = connRows.some((c) => c.status === 'connected');
  const outgoingPending = connRows.find((c) => c.user_a_id === authUser.id && c.status === 'pending');
  const incomingPending = connRows.find((c) => c.user_b_id === authUser.id && c.status === 'pending');
  const connectionStatus = isAlreadyConnected
    ? 'connected'
    : outgoingPending
      ? 'pending'
      : incomingPending
        ? 'incoming_pending'
        : 'none';

  // Pending-state confirmation returns ONLY minimal permitted account info (no unmasked email/phone or financial data)
  return {
    status: 200,
    body: {
      success: true,
      owner: {
        id: owner.id,
        displayName: owner.full_name || 'My Money User',
        fullName: owner.full_name || 'My Money User',
        accountIndicator: 'My Money Manager Account',
        emailMasked: isAlreadyConnected ? maskEmailForPrivacy(owner.email) : undefined,
        phoneMasked: isAlreadyConnected ? maskPhoneForPrivacy(owner.phone) : null,
        avatarUrl: owner.avatar_url || null,
        isVerified: Boolean(owner.is_verified ?? true),
      },
      pairingToken: qrRecord.pairing_token,
      pairingCode: qrRecord.pairing_code,
      isAlreadyConnected,
      connectionStatus,
      requestId: outgoingPending?.id || incomingPending?.id || null,
    },
  };
}

export async function connectQrRest(authUser: AuthenticatedUser, body: any) {
  const resolved = await resolveQrRest(authUser, body);
  if (resolved.status !== 200 || !resolved.body.success) {
    return resolved;
  }

  const rawMethod = String(body.connectionMethod || body.entryMethod || '').trim().toUpperCase();
  const connectionMethod: 'QR_CODE' | 'CONFIRMATION_CODE' =
    rawMethod === 'CONFIRMATION_CODE' ||
    rawMethod === 'CODE' ||
    (!body.qrData && !body.pairingToken && Boolean(body.pairingCode))
      ? 'CONFIRMATION_CODE'
      : 'QR_CODE';

  const owner = resolved.body.owner;
  const targetId = owner.id;
  const targetName = (owner.fullName || owner.displayName || 'User').trim();
  const relationshipType = (body.relationshipType || 'Friend').trim();

  // Fetch full target profile for reciprocal udhar_contacts sync
  const targetRes = await sbRest<any[]>(
    `app_users?id=eq.${encodeURIComponent(targetId)}&status=eq.active&select=id,full_name,email,phone,avatar_url,is_verified&limit=1`
  );
  const targetUser = (targetRes.ok && targetRes.data && targetRes.data[0]) || {
    id: targetId,
    full_name: targetName,
    email: null,
    phone: null,
    avatar_url: owner.avatarUrl || null,
    is_verified: owner.isVerified,
  };

  if (resolved.body.isAlreadyConnected) {
    // Ensure both users have their udhar_contacts entries without sending duplicate notifications
    await ensureConnectionAndReciprocalContactsRest(authUser, targetUser, relationshipType, {
      connectionMethod,
      requestedVia: connectionMethod === 'CONFIRMATION_CODE' ? 'confirmation_code' : 'qr',
    }).catch(() => {});

    return {
      status: 200,
      body: {
        success: true,
        status: 'connected',
        alreadyConnected: true,
        connectionMethod,
        title: 'Already Connected',
        message: 'Already Connected',
        connectedUser: {
          id: targetUser.id,
          name: targetName,
          displayName: targetName,
          fullName: targetName,
          avatarUrl: targetUser.avatar_url || null,
          isVerified: Boolean(targetUser.is_verified ?? true),
        },
      },
    };
  }

  // Method B: Direct Connection immediately after backend QR/Code verification — NO pending request, NO Accept/Reject
  const syncRes = await ensureConnectionAndReciprocalContactsRest(authUser, targetUser, relationshipType, {
    connectionMethod,
    requestedVia: connectionMethod === 'CONFIRMATION_CODE' ? 'confirmation_code' : 'qr',
  });
  if (!syncRes.ok) {
    return {
      status: 503,
      body: {
        success: false,
        code: 'REQUEST_FAILED',
        message: syncRes.error || 'Unable to save connection right now. Please retry.',
      },
    };
  }

  // If a pending Method A search request previously existed in either direction, mark its notification resolved
  await Promise.all([
    updateConnectionRequestNotificationsState({
      requestId: resolved.body.requestId || null,
      requesterId: authUser.id,
      receiverId: targetId,
      status: 'accepted',
    }).catch(() => {}),
    updateConnectionRequestNotificationsState({
      requestId: resolved.body.requestId || null,
      requesterId: targetId,
      receiverId: authUser.id,
      status: 'accepted',
    }).catch(() => {}),
  ]);

  // Mark single-use QR token consumed if applicable
  if (resolved.body.pairingToken) {
    await sbRest(
      `qr_pairing_tokens?pairing_token=eq.${encodeURIComponent(resolved.body.pairingToken)}&is_single_use=eq.true`,
      {
        method: 'PATCH',
        body: { used: true, used_at: new Date().toISOString() },
      }
    ).catch(() => {});
  }

  const actorName = (authUser.full_name || authUser.email?.split('@')[0] || 'User').trim();
  await notifyQrConnected({
    userAId: authUser.id,
    userAName: actorName,
    userAAvatar: authUser.avatar_url || null,
    userBId: targetUser.id,
    userBName: targetName,
    connectionMethod,
    connectionId: syncRes.connectionId || null,
  }).catch(() => {});

  return {
    status: 200,
    body: {
      success: true,
      status: 'connected',
      alreadyConnected: false,
      connectionMethod,
      title: 'Connection Added Successfully',
      message: `${targetName} has been added to your Saved People.`,
      connectionId: syncRes.connectionId || null,
      connectedUser: {
        id: targetUser.id,
        name: targetName,
        displayName: targetName,
        fullName: targetName,
        avatarUrl: targetUser.avatar_url || null,
        isVerified: Boolean(targetUser.is_verified ?? true),
      },
    },
  };
}

// ============================================================================
// 5. SHARED CANONICAL UDHAR TRANSACTIONS, REPAYMENTS, EDITS, SETTLEMENT, CANCEL
// ============================================================================
export async function getUdharTransactionsRest(authUser: AuthenticatedUser) {
  const [txRes, contactsRes] = await Promise.all([
    sbRest<any[]>(
      `udhar_transactions?user_id=eq.${encodeURIComponent(authUser.id)}&order=transaction_date.desc,created_at.desc`
    ),
    sbRest<any[]>(
      `udhar_contacts?user_id=eq.${encodeURIComponent(authUser.id)}&select=name,linked_user_id`
    ),
  ]);

  if (!txRes.ok) {
    return { status: 503, body: { success: false, message: 'Unable to load Udhar ledger right now.' } };
  }

  // Keep rejected and sender-cancelled visible in request history; exclude permanently deleted records
  const rawTxs = (txRes.data || []).filter((t) => normalizeUdharLifecycleStatus(t) !== 'deleted');
  const linkIds = Array.from(new Set(rawTxs.map((t) => t.link_id).filter(Boolean)));
  const txIds = rawTxs.map((t) => t.id).filter(Boolean);

  let repaymentsRows: any[] = [];
  let historyRows: any[] = [];

  if (linkIds.length > 0) {
    const inLinks = linkIds.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',');
    const [repRes, histRes] = await Promise.all([
      sbRest<any[]>(
        `udhar_repayments?link_id=in.(${encodeURIComponent(inLinks)})&order=repayment_date.desc,created_at.desc`
      ),
      sbRest<any[]>(
        `udhar_edit_history?link_id=in.(${encodeURIComponent(inLinks)})&order=created_at.desc`
      ),
    ]);
    if (repRes.ok && Array.isArray(repRes.data)) repaymentsRows = repRes.data.filter((r) => isActiveRepayment(r));
    if (histRes.ok && Array.isArray(histRes.data)) historyRows = histRes.data;
  }

  const allUserIds = [
    ...rawTxs.map((t) => t.counterpart_user_id),
    ...repaymentsRows.map((r) => r.recorded_by_user_id),
    ...historyRows.map((h) => h.edited_by_user_id),
  ].filter(Boolean);
  const userMap = await fetchUsersByIds(allUserIds);

  const repByLink = new Map<string, any[]>();
  const repByTx = new Map<string, any[]>();
  for (const r of repaymentsRows) {
    if (r.link_id) {
      if (!repByLink.has(r.link_id)) repByLink.set(r.link_id, []);
      repByLink.get(r.link_id)!.push(r);
    }
    if (r.udhar_id) {
      if (!repByTx.has(r.udhar_id)) repByTx.set(r.udhar_id, []);
      repByTx.get(r.udhar_id)!.push(r);
    }
  }

  const histByLink = new Map<string, any[]>();
  for (const h of historyRows) {
    if (!histByLink.has(h.link_id)) histByLink.set(h.link_id, []);
    histByLink.get(h.link_id)!.push(h);
  }

  const transactions = rawTxs.map((row) => {
    const reps = (row.link_id && repByLink.get(row.link_id)) || repByTx.get(row.id) || [];
    const hist = (row.link_id && histByLink.get(row.link_id)) || [];
    return enrichTransactionRow(row, userMap, reps, hist);
  });

  const contacts = (contactsRes.ok && Array.isArray(contactsRes.data)) ? contactsRes.data : [];
  const summary = calculatePeopleDashboardSummary(transactions, contacts);

  return {
    status: 200,
    body: {
      success: true,
      transactions,
      summary,
      count: txIds.length,
    },
  };
}

export async function createUdharTransactionRest(authUser: AuthenticatedUser, body: any) {
  let counterpartName = (body.counterpart_name || body.person_name || '').trim();
  const counterpartUserId = (body.counterpart_user_id || body.counterpartUserId || '').trim() || null;
  const qrToken = (body.qr_token || body.qrToken || body.pairingToken || '').trim();
  const pairingCode = (body.pairing_code || body.pairingCode || '').replace(/\s+/g, '').trim().toUpperCase();
  const qrDataRaw = (body.qrData || body.qr_data || '').trim();
  const direction = body.direction;
  const amount = roundMoney(parseFloat(body.amount));
  const txDate = body.transaction_date || body.date || new Date().toISOString().split('T')[0];
  const dueDate = body.due_date || body.dueDate || null;
  const plainNotes = (body.notes || '').trim();
  const category = (body.category || 'Personal Loan').trim();
  const paymentMethod = (body.payment_method || body.paymentMethod || 'UPI').trim();
  const description = (body.description || '').trim();
  const attachmentUrl = body.attachment_url || null;
  const idempotencyKey = (body.idempotency_key || body.idempotencyKey || '').trim() || null;

  if (!['gave', 'took'].includes(direction)) {
    return { status: 400, body: { success: false, message: "Direction must be 'gave' or 'took'." } };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { status: 400, body: { success: false, message: 'Amount must be greater than ₹0.' } };
  }

  // Idempotency guard against duplicate submissions
  if (idempotencyKey) {
    const dupCheck = await sbRest<any[]>(
      `udhar_transactions?user_id=eq.${encodeURIComponent(authUser.id)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`
    );
    if (dupCheck.ok && dupCheck.data && dupCheck.data.length > 0) {
      const existing = dupCheck.data[0];
      return {
        status: 200,
        body: {
          success: true,
          deduplicated: true,
          message: 'Udhar already recorded.',
          transaction: enrichTransactionRow(existing, new Map(), [], []),
          isLinked: Boolean(existing.counterpart_user_id),
        },
      };
    }
  }

  let registeredUser: any = null;
  let verifiedCreationMethod: UdharCreationMethod = 'manual';
  let singleUseTokenRecordId: string | null = null;

  // METHOD B: Valid QR or Confirmation Code resolves owner server-side & bypasses manual confirmation
  if (qrToken || pairingCode || qrDataRaw) {
    const resolved = await resolveQrRest(authUser, {
      qrData: qrDataRaw || undefined,
      pairingToken: qrToken || undefined,
      pairingCode: pairingCode || undefined,
    });
    if (resolved.status !== 200 || !resolved.body?.success || !resolved.body?.owner?.id) {
      return resolved;
    }

    const ownerId = resolved.body.owner.id;
    const uRes = await sbRest<any[]>(
      `app_users?id=eq.${encodeURIComponent(ownerId)}&status=eq.active&select=id,full_name,email,phone,avatar_url,role,status,deletion_status&limit=1`
    );
    if (!uRes.ok || !uRes.data || uRes.data.length === 0) {
      return { status: 404, body: { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'Target user account not found.' } };
    }
    registeredUser = uRes.data[0];
    if (!isDiscoverableNormalUser(registeredUser)) {
      return { status: 403, body: { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'Target user account is unavailable for shared Udhar.' } };
    }
    if (await isBlockedBetween(authUser.id, registeredUser.id)) {
      return { status: 403, body: { success: false, code: 'BLOCKED', message: 'Cannot create shared Udhar with a blocked user.' } };
    }
    counterpartName = registeredUser.full_name || resolved.body.owner.fullName || counterpartName || 'Friend';
    verifiedCreationMethod = qrToken || (qrDataRaw && qrDataRaw.startsWith('{')) ? 'qr' : 'code';

    // Check if the resolved token was single-use so we can mark it consumed after insert
    const resolvedToken = resolved.body.pairingToken;
    if (resolvedToken) {
      const tokCheck = await sbRest<any[]>(
        `qr_pairing_tokens?pairing_token=eq.${encodeURIComponent(resolvedToken)}&select=id,is_single_use&limit=1`
      );
      if (tokCheck.ok && tokCheck.data?.[0]?.is_single_use) {
        singleUseTokenRecordId = tokCheck.data[0].id;
      }
    }
  } else if (counterpartUserId && counterpartUserId !== authUser.id) {
    // METHOD A: Manual addition with a registered user -> ALWAYS requires recipient confirmation!
    const uRes = await sbRest<any[]>(
      `app_users?id=eq.${encodeURIComponent(counterpartUserId)}&status=eq.active&select=id,full_name,email,phone,avatar_url,role,status,deletion_status&limit=1`
    );
    if (uRes.ok && uRes.data && uRes.data.length > 0) {
      const u = uRes.data[0];
      if (!isDiscoverableNormalUser(u)) {
        return { status: 403, body: { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'Selected user account is not eligible for shared Udhar connections.' } };
      }
      if (await isBlockedBetween(authUser.id, u.id)) {
        return { status: 403, body: { success: false, message: 'Cannot create shared Udhar with a blocked user.' } };
      }
      registeredUser = u;
      counterpartName = counterpartName || registeredUser.full_name;
    }
  }

  if (!counterpartName) {
    return { status: 400, body: { success: false, message: "Person's name is required." } };
  }

  const linkId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  if (registeredUser) {
    const isInstantQr = verifiedCreationMethod === 'qr' || verifiedCreationMethod === 'code';
    const initialLifecycle = isInstantQr ? 'confirmed' : 'pending_confirmation';
    const initialConfirmStatus = isInstantQr ? 'confirmed' : 'pending';

    const packedNotes = packStructuredNote(plainNotes, {
      category,
      payment_method: paymentMethod,
      description: description || undefined,
      attachment_url: attachmentUrl || undefined,
      creation_method: verifiedCreationMethod,
      lifecycle_status: initialLifecycle,
      accepted_by: isInstantQr ? registeredUser.id : undefined,
      responded_at: isInstantQr ? nowIso : undefined,
    });

    const counterpartDirection = direction === 'gave' ? 'took' : 'gave';
    const userARow = {
      link_id: linkId,
      user_id: authUser.id,
      counterpart_user_id: registeredUser.id,
      counterpart_name: registeredUser.full_name,
      direction,
      original_amount: amount,
      current_balance: amount,
      paid_amount: 0,
      transaction_date: txDate,
      due_date: dueDate || null,
      notes: packedNotes,
      attachment_url: attachmentUrl,
      status: initialLifecycle,
      confirmation_status: initialConfirmStatus,
      is_initiator: true,
      idempotency_key: idempotencyKey,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const userBRow = {
      link_id: linkId,
      user_id: registeredUser.id,
      counterpart_user_id: authUser.id,
      counterpart_name: authUser.full_name,
      direction: counterpartDirection,
      original_amount: amount,
      current_balance: amount,
      paid_amount: 0,
      transaction_date: txDate,
      due_date: dueDate || null,
      notes: packedNotes,
      attachment_url: attachmentUrl,
      status: initialLifecycle,
      confirmation_status: initialConfirmStatus,
      is_initiator: false,
      idempotency_key: idempotencyKey ? `${idempotencyKey}:counterpart` : null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const insertRes = await sbRest<any[]>('udhar_transactions', {
      method: 'POST',
      prefer: 'return=representation',
      body: [userARow, userBRow],
    });

    if (!insertRes.ok || !insertRes.data || insertRes.data.length === 0) {
      return { status: 500, body: { success: false, message: insertRes.error || 'Failed to create shared Udhar.' } };
    }

    if (singleUseTokenRecordId) {
      await sbRest(`qr_pairing_tokens?id=eq.${encodeURIComponent(singleUseTokenRecordId)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { used: true, used_by_user_id: authUser.id, used_at: nowIso },
      }).catch(() => {});
    }

    const createdUserA = insertRes.data.find((r) => r.user_id === authUser.id) || insertRes.data[0];

    await ensureConnectionAndReciprocalContactsRest(authUser, registeredUser, 'Friend');

    if (isInstantQr) {
      // Method B: Notify BOTH participants immediately upon QR/code instant confirmation
      const viaLabel = verifiedCreationMethod === 'qr' ? 'QR code' : 'confirmation code';
      await Promise.all([
        createTargetedNotificationRest({
          targetUserId: registeredUser.id,
          actorUserId: authUser.id,
          title: `Instant Udhar Confirmed via ${viaLabel}`,
          message: `${authUser.full_name} added a confirmed Udhar of ₹${amount.toLocaleString('en-IN')} (${direction === 'gave' ? "You'll Pay" : "You'll Receive"}) via your ${viaLabel}.`,
          type: 'udhar_qr_confirmed',
          relatedEntityId: linkId,
          dedupeKey: `udhar_qr_rec_${linkId}`,
          metadata: {
            actionType: 'udhar_qr_confirmed',
            linkId,
            udharId: createdUserA.id,
            senderName: authUser.full_name,
            amount,
            direction: counterpartDirection,
            creationMethod: verifiedCreationMethod,
          },
        }),
        createTargetedNotificationRest({
          targetUserId: authUser.id,
          actorUserId: authUser.id,
          title: `Udhar Added via ${viaLabel}`,
          message: `Your Udhar of ₹${amount.toLocaleString('en-IN')} with ${registeredUser.full_name} was confirmed immediately.`,
          type: 'udhar_qr_confirmed',
          relatedEntityId: linkId,
          dedupeKey: `udhar_qr_init_${linkId}`,
          metadata: {
            actionType: 'udhar_qr_confirmed',
            linkId,
            udharId: createdUserA.id,
            counterpartName: registeredUser.full_name,
            amount,
            direction,
            creationMethod: verifiedCreationMethod,
          },
        }),
      ]);
    } else {
      // Method A: Notify User B ONLY that confirmation is requested
      const dirHuman = direction === 'gave' ? 'gave you (You Borrowed)' : 'borrowed from you (You Gave)';
      await createTargetedNotificationRest({
        targetUserId: registeredUser.id,
        actorUserId: authUser.id,
        title: 'New Udhaar Confirmation Request',
        message: `${authUser.full_name} added an Udhaar request of ₹${amount.toLocaleString('en-IN')} (${dirHuman}). Please review and confirm.`,
        type: 'udhar_request',
        relatedEntityId: linkId,
        dedupeKey: `udhar_req_${linkId}`,
        metadata: {
          actionType: 'udhar_confirmation_request',
          linkId,
          udharId: createdUserA.id,
          requesterUserId: authUser.id,
          requesterName: authUser.full_name,
          requesterAvatar: authUser.avatar_url || null,
          amount,
          direction: counterpartDirection,
          description: description || plainNotes || null,
          transactionDate: txDate,
          creationMethod: 'manual',
        },
      });
    }

    const userMap = new Map<string, any>([[registeredUser.id, registeredUser]]);
    return {
      status: 201,
      body: {
        success: true,
        requiresConfirmation: !isInstantQr,
        creationMethod: verifiedCreationMethod,
        message: isInstantQr
          ? `Udhaar added successfully.`
          : `Udhaar request sent to ${registeredUser.full_name}. Waiting for recipient confirmation.`,
        transaction: enrichTransactionRow(createdUserA, userMap, [], []),
        isLinked: true,
      },
    };
  } else {
    // Manual / Local Contact Udhar (unlinked local record)
    const packedNotes = packStructuredNote(plainNotes, {
      category,
      payment_method: paymentMethod,
      description: description || undefined,
      attachment_url: attachmentUrl || undefined,
      creation_method: 'manual',
      lifecycle_status: 'confirmed',
    });

    const singleRow = {
      link_id: linkId,
      user_id: authUser.id,
      counterpart_user_id: null,
      counterpart_name: counterpartName,
      direction,
      original_amount: amount,
      current_balance: amount,
      paid_amount: 0,
      transaction_date: txDate,
      due_date: dueDate || null,
      notes: packedNotes,
      attachment_url: attachmentUrl,
      status: 'confirmed',
      confirmation_status: 'confirmed',
      is_initiator: true,
      idempotency_key: idempotencyKey,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const insertRes = await sbRest<any[]>('udhar_transactions', {
      method: 'POST',
      prefer: 'return=representation',
      body: singleRow,
    });

    if (!insertRes.ok || !insertRes.data || insertRes.data.length === 0) {
      return { status: 500, body: { success: false, message: insertRes.error || 'Failed to record local Udhar.' } };
    }

    // Ensure local contact exists (explicitly unlinked)
    await sbRest('udhar_contacts?on_conflict=user_id,name', {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=minimal',
      body: {
        user_id: authUser.id,
        name: counterpartName,
        relationship_type: 'Friend',
        linked_user_id: null,
        updated_at: nowIso,
      },
    }).catch(() => {});

    return {
      status: 201,
      body: {
        success: true,
        requiresConfirmation: false,
        creationMethod: 'manual',
        message: `Local Udhar recorded for ${counterpartName}.`,
        transaction: enrichTransactionRow(insertRes.data[0], new Map(), [], []),
        isLinked: false,
      },
    };
  }
}

export async function createUdharViaQrRest(authUser: AuthenticatedUser, body: any) {
  const qrToken = (body.qr_token || body.qrToken || body.pairingToken || '').trim();
  const pairingCode = (body.pairing_code || body.pairingCode || '').replace(/\s+/g, '').trim().toUpperCase();
  const qrDataRaw = (body.qrData || body.qr_data || '').trim();
  if (!qrToken && !pairingCode && !qrDataRaw) {
    return {
      status: 400,
      body: { success: false, code: 'QR_OR_CODE_REQUIRED', message: 'A valid QR token or confirmation code is required.' },
    };
  }
  return createUdharTransactionRest(authUser, body);
}

export async function confirmUdharTransactionRest(authUser: AuthenticatedUser, txId: string) {
  const txRes = await sbRest<any[]>(
    `udhar_transactions?id=eq.${encodeURIComponent(txId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Transaction not found.' } };
  }
  const tx = txRes.data[0];
  const guard = canAcceptUdhar(tx, authUser.id);
  if (!guard.allowed) {
    return { status: guard.httpStatus || 403, body: { success: false, code: guard.code, message: guard.reason } };
  }

  const nowIso = new Date().toISOString();
  const { note, meta } = unpackStructuredNote(tx.notes);
  const updatedPackedNotes = packStructuredNote(note, {
    ...meta,
    lifecycle_status: 'confirmed',
    accepted_by: authUser.id,
    responded_at: nowIso,
  });

  // Atomic conditional update: only transition pending_confirmation -> confirmed once
  const patchRes = await sbRest<any[]>(
    `udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}&status=eq.pending_confirmation`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        status: 'confirmed',
        confirmation_status: 'confirmed',
        notes: updatedPackedNotes,
        updated_at: nowIso,
      },
    }
  );

  if (!patchRes.ok || !Array.isArray(patchRes.data) || patchRes.data.length === 0) {
    return {
      status: 409,
      body: { success: false, code: 'CONCURRENT_MODIFICATION', message: 'This Udhar request has already been accepted, rejected, or cancelled.' },
    };
  }

  // Deactivate the pending request notification and notify sender
  await deactivateUdharNotificationsRest(tx.link_id, tx.id).catch(() => {});
  if (tx.counterpart_user_id) {
    await createTargetedNotificationRest({
      targetUserId: tx.counterpart_user_id,
      actorUserId: authUser.id,
      title: 'Udhaar Request Accepted',
      message: `${authUser.full_name} accepted your Udhaar request of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')}. Both balances are now updated.`,
      type: 'udhar_accepted',
      relatedEntityId: tx.link_id,
      dedupeKey: `udhar_acc_${tx.link_id}`,
      metadata: {
        actionType: 'udhar_accepted',
        linkId: tx.link_id,
        udharId: tx.id,
        acceptedBy: authUser.id,
        amount: parseFloat(tx.original_amount) || 0,
      },
    });
  }

  return {
    status: 200,
    body: {
      success: true,
      message: 'Udhaar request accepted successfully.',
      status: 'confirmed',
    },
  };
}

export async function rejectUdharTransactionRest(authUser: AuthenticatedUser, txId: string, reason?: string) {
  const txRes = await sbRest<any[]>(
    `udhar_transactions?id=eq.${encodeURIComponent(txId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Transaction not found.' } };
  }
  const tx = txRes.data[0];
  const guard = canRejectUdhar(tx, authUser.id);
  if (!guard.allowed) {
    return { status: guard.httpStatus || 403, body: { success: false, code: guard.code, message: guard.reason } };
  }

  const nowIso = new Date().toISOString();
  const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 400) : 'Rejected by recipient';
  const { note, meta } = unpackStructuredNote(tx.notes);
  const updatedPackedNotes = packStructuredNote(note, {
    ...meta,
    lifecycle_status: 'rejected',
    rejected_by: authUser.id,
    responded_at: nowIso,
    rejection_reason: cleanReason,
  });

  // Try native 'rejected' status first, fall back to 'cancelled' + MM_META lifecycle_status:'rejected' (NEVER set deleted_at)
  let patchRes = await sbRest<any[]>(
    `udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}&status=eq.pending_confirmation`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        status: 'rejected',
        confirmation_status: 'rejected',
        current_balance: 0,
        paid_amount: 0,
        notes: updatedPackedNotes,
        updated_at: nowIso,
      },
    }
  );

  if (!patchRes.ok && (patchRes.status === 400 || String(patchRes.error || '').includes('23514'))) {
    patchRes = await sbRest<any[]>(
      `udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}&status=eq.pending_confirmation`,
      {
        method: 'PATCH',
        prefer: 'return=representation',
        body: {
          status: 'cancelled',
          current_balance: 0,
          paid_amount: 0,
          notes: updatedPackedNotes,
          updated_at: nowIso,
        },
      }
    );
  }

  if (!patchRes.ok || !Array.isArray(patchRes.data) || patchRes.data.length === 0) {
    return {
      status: 409,
      body: { success: false, code: 'CONCURRENT_MODIFICATION', message: 'This Udhar request has already been handled.' },
    };
  }

  await deactivateUdharNotificationsRest(tx.link_id, tx.id).catch(() => {});
  if (tx.counterpart_user_id) {
    await createTargetedNotificationRest({
      targetUserId: tx.counterpart_user_id,
      actorUserId: authUser.id,
      title: 'Udhaar Request Rejected',
      message: `${authUser.full_name} rejected your Udhaar request of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')}.`,
      type: 'udhar_rejected',
      relatedEntityId: tx.link_id,
      dedupeKey: `udhar_rej_${tx.link_id}`,
      metadata: {
        actionType: 'udhar_rejected',
        linkId: tx.link_id,
        udharId: tx.id,
        rejectedBy: authUser.id,
        reason: cleanReason,
      },
    });
  }

  return {
    status: 200,
    body: {
      success: true,
      status: 'rejected',
      message: 'You rejected this Udhaar request.',
    },
  };
}

export async function cancelUdharRequestRest(authUser: AuthenticatedUser, txId: string, reason?: string) {
  const txRes = await sbRest<any[]>(
    `udhar_transactions?id=eq.${encodeURIComponent(txId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Transaction not found.' } };
  }
  const tx = txRes.data[0];
  const guard = canSenderCancelUdhar(tx, authUser.id);
  if (!guard.allowed) {
    return { status: guard.httpStatus || 403, body: { success: false, code: guard.code, message: guard.reason } };
  }

  const nowIso = new Date().toISOString();
  const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 400) : 'Cancelled by sender';
  const { note, meta } = unpackStructuredNote(tx.notes);
  const updatedPackedNotes = packStructuredNote(note, {
    ...meta,
    lifecycle_status: 'cancelled',
    cancelled_by: authUser.id,
    cancelled_at: nowIso,
    rejection_reason: cleanReason,
  });

  const patchRes = await sbRest<any[]>(
    `udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}&status=eq.pending_confirmation`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        status: 'cancelled',
        current_balance: 0,
        paid_amount: 0,
        notes: updatedPackedNotes,
        updated_at: nowIso,
      },
    }
  );

  if (!patchRes.ok || !Array.isArray(patchRes.data) || patchRes.data.length === 0) {
    return {
      status: 409,
      body: { success: false, code: 'CONCURRENT_MODIFICATION', message: 'This Udhar request has already been responded to or cancelled.' },
    };
  }

  await deactivateUdharNotificationsRest(tx.link_id, tx.id).catch(() => {});
  if (tx.counterpart_user_id) {
    await createTargetedNotificationRest({
      targetUserId: tx.counterpart_user_id,
      actorUserId: authUser.id,
      title: 'Udhaar Request Cancelled',
      message: `${authUser.full_name} cancelled their pending Udhaar request of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')}.`,
      type: 'udhar_request_cancelled',
      relatedEntityId: tx.link_id,
      dedupeKey: `udhar_canc_${tx.link_id}`,
      metadata: {
        actionType: 'udhar_request_cancelled',
        linkId: tx.link_id,
        udharId: tx.id,
        cancelledBy: authUser.id,
      },
    });
  }

  return {
    status: 200,
    body: {
      success: true,
      status: 'cancelled',
      message: 'Pending Udhaar request cancelled.',
    },
  };
}

export async function disputeUdharTransactionRest(authUser: AuthenticatedUser, txId: string, reason: string) {
  const txRes = await sbRest<any[]>(
    `udhar_transactions?id=eq.${encodeURIComponent(txId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Transaction not found.' } };
  }
  const tx = txRes.data[0];
  const nowIso = new Date().toISOString();

  await sbRest(`udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}`, {
    method: 'PATCH',
    body: {
      status: 'disputed',
      confirmation_status: 'disputed',
      dispute_reason: reason,
      disputed_at: nowIso,
      disputed_by: authUser.id,
      updated_at: nowIso,
    },
  });

  if (tx.counterpart_user_id) {
    await createTargetedNotificationRest({
      targetUserId: tx.counterpart_user_id,
      actorUserId: authUser.id,
      title: `Udhar Disputed by ${authUser.full_name}`,
      message: `${authUser.full_name} flagged an Udhar of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')}: "${reason}"`,
      type: 'udhar_disputed',
      relatedEntityId: tx.link_id,
    });
  }

  return { status: 200, body: { success: true, message: 'Transaction marked as disputed.' } };
}

export async function repayUdharRest(authUser: AuthenticatedUser, txId: string, body: any) {
  const repayAmount = roundMoney(parseFloat(body.amount));
  const repayDate = body.repayment_date || body.date || new Date().toISOString().split('T')[0];
  const repayTime = (body.repayment_time || body.repaymentTime || '').trim();
  const paymentMethod = (body.payment_method || body.paymentMethod || 'UPI').trim();
  const transactionRef = (body.transaction_ref || body.transactionRef || '').trim();
  const attachmentUrl = (body.attachment_url || body.attachmentUrl || '').trim();
  const plainNotes = (body.notes || '').trim();
  const idempotencyKey = (body.idempotency_key || body.idempotencyKey || '').trim() || null;

  const txRes = await sbRest<any[]>(
    `udhar_transactions?id=eq.${encodeURIComponent(txId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Transaction not found.' } };
  }
  const tx = txRes.data[0];

  if (idempotencyKey) {
    const dupRep = await sbRest<any[]>(
      `udhar_repayments?link_id=eq.${encodeURIComponent(tx.link_id)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`
    );
    if (dupRep.ok && dupRep.data && dupRep.data.length > 0) {
      return {
        status: 200,
        body: {
          success: true,
          deduplicated: true,
          repayment: dupRep.data[0],
          isPendingConfirmation: dupRep.data[0].status === 'pending_confirmation',
          remainingBalance: parseFloat(tx.current_balance) || 0,
          isSettled: tx.status === 'settled',
          message: 'Repayment already recorded.',
        },
      };
    }
  }

  const existingRepsRes = await sbRest<any[]>(
    `udhar_repayments?link_id=eq.${encodeURIComponent(tx.link_id)}`
  );
  const existingReps = (existingRepsRes.ok && Array.isArray(existingRepsRes.data))
    ? existingRepsRes.data.filter((r) => isActiveRepayment(r))
    : [];

  const confirmedPaid = roundMoney(
    existingReps.filter((r) => r.status === 'confirmed').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  );
  const pendingRepayments = roundMoney(
    existingReps.filter((r) => r.status === 'pending_confirmation').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  );

  const lifecycle = normalizeUdharLifecycleStatus(tx);

  const calc = calculateRepaymentApplication({
    originalAmount: parseFloat(tx.original_amount) || 0,
    confirmedPaidAmount: confirmedPaid,
    pendingRepaymentsAmount: pendingRepayments,
    repayAmount,
    isShared: Boolean(tx.counterpart_user_id),
    actorRole: tx.direction === 'gave' ? 'lender' : 'borrower',
    udharStatus: lifecycle,
  });

  if (!calc.valid) {
    return { status: 400, body: { success: false, message: calc.error || 'Invalid repayment.' } };
  }

  const packedNote = packStructuredNote(plainNotes, {
    transaction_ref: transactionRef || undefined,
    repayment_time: repayTime || undefined,
    attachment_url: attachmentUrl || undefined,
  });
  const nowIso = new Date().toISOString();

  const insertRep = await sbRest<any[]>('udhar_repayments', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      link_id: tx.link_id,
      udhar_id: tx.id,
      recorded_by_user_id: authUser.id,
      amount: repayAmount,
      repayment_date: repayDate,
      payment_method: paymentMethod,
      notes: packedNote,
      status: calc.repaymentStatus,
      idempotency_key: idempotencyKey,
      confirmed_at: calc.repaymentStatus === 'confirmed' ? nowIso : null,
      confirmed_by: calc.repaymentStatus === 'confirmed' ? authUser.id : null,
    },
  });

  if (!insertRep.ok || !insertRep.data || insertRep.data.length === 0) {
    return { status: 500, body: { success: false, message: insertRep.error || 'Failed to record repayment.' } };
  }

  if (calc.repaymentStatus === 'confirmed') {
    await sbRest(`udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}`, {
      method: 'PATCH',
      body: {
        current_balance: calc.nextRemainingAmount,
        paid_amount: calc.nextPaidAmount,
        status: calc.nextUdharStatus,
        settled_at: calc.isSettled ? nowIso : tx.settled_at,
        updated_at: nowIso,
      },
    });
  }

  if (tx.counterpart_user_id) {
    if (calc.repaymentStatus === 'pending_confirmation') {
      await createTargetedNotificationRest({
        targetUserId: tx.counterpart_user_id,
        actorUserId: authUser.id,
        title: `Repayment Confirmation Needed: ${authUser.full_name}`,
        message: `${authUser.full_name} reported a repayment of ₹${repayAmount.toLocaleString('en-IN')} via ${paymentMethod}. Please confirm receipt.`,
        type: 'repayment_pending',
        relatedEntityId: tx.link_id,
      });
    } else {
      await createTargetedNotificationRest({
        targetUserId: tx.counterpart_user_id,
        actorUserId: authUser.id,
        title: calc.isSettled
          ? `Udhar Settled with ${authUser.full_name}`
          : `Repayment Recorded by ${authUser.full_name}`,
        message: `${authUser.full_name} confirmed a repayment of ₹${repayAmount.toLocaleString('en-IN')}. Remaining balance: ₹${(calc.nextRemainingAmount ?? 0).toLocaleString('en-IN')}.`,
        type: calc.isSettled ? 'settlement' : 'repayment',
        relatedEntityId: tx.link_id,
      });
    }
  }

  // Merge any in-memory fallback pending requests
  for (const r of fallbackPendingRequests.values()) {
    if (r.user_b_id === authUser.id) {
      const u = userMap.get(r.user_a_id);
      incoming.push({
        id: r.id,
        direction: 'incoming',
        requesterUserId: r.user_a_id,
        displayName: u?.full_name || 'My Money User',
        avatarUrl: u?.avatar_url || null,
        isVerified: Boolean(u?.is_verified ?? true),
        status: 'pending',
        relationshipType: r.relationship_type || 'Friend',
        requestedVia: r.requested_via || 'search',
        connectionMethod: r.connection_method || 'SEARCH',
        createdAt: r.created_at,
      });
    } else if (r.user_a_id === authUser.id) {
      const u = userMap.get(r.user_b_id);
      outgoing.push({
        id: r.id,
        direction: 'outgoing',
        targetUserId: r.user_b_id,
        displayName: u?.full_name || 'My Money User',
        avatarUrl: u?.avatar_url || null,
        isVerified: Boolean(u?.is_verified ?? true),
        status: 'pending',
        relationshipType: r.relationship_type || 'Friend',
        requestedVia: r.requested_via || 'search',
        connectionMethod: r.connection_method || 'SEARCH',
        createdAt: r.created_at,
      });
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      repayment: insertRep.data[0],
      isPendingConfirmation: calc.repaymentStatus === 'pending_confirmation',
      remainingBalance: calc.nextRemainingAmount,
      isSettled: calc.isSettled,
      message:
        calc.repaymentStatus === 'pending_confirmation'
          ? `Payment of ₹${repayAmount.toLocaleString('en-IN')} submitted! Waiting for ${tx.counterpart_name} to confirm receipt.`
          : calc.isSettled
            ? 'Full repayment recorded! Udhar is now completely settled.'
            : `Repayment of ₹${repayAmount.toLocaleString('en-IN')} recorded. Remaining: ₹${(calc.nextRemainingAmount ?? 0).toLocaleString('en-IN')}.`,
    },
  };
}

export async function confirmRepaymentRest(authUser: AuthenticatedUser, repaymentId: string) {
  const repRes = await sbRest<any[]>(`udhar_repayments?id=eq.${encodeURIComponent(repaymentId)}&limit=1`);
  if (!repRes.ok || !repRes.data || repRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Repayment record not found.' } };
  }
  const rep = repRes.data[0];
  if (!isActiveRepayment(rep)) {
    return { status: 404, body: { success: false, message: 'Repayment record not found.' } };
  }
  if (rep.status === 'confirmed') {
    return { status: 400, body: { success: false, message: 'This repayment is already confirmed.' } };
  }

  const txRes = await sbRest<any[]>(
    `udhar_transactions?link_id=eq.${encodeURIComponent(rep.link_id)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Associated Udhar not found.' } };
  }
  const tx = txRes.data[0];
  if (tx.direction !== 'gave') {
    return { status: 403, body: { success: false, message: 'Only the lender can confirm receipt of repayment.' } };
  }

  const nowIso = new Date().toISOString();
  await sbRest(`udhar_repayments?id=eq.${encodeURIComponent(repaymentId)}`, {
    method: 'PATCH',
    body: { status: 'confirmed', confirmed_at: nowIso, confirmed_by: authUser.id, rejection_reason: null },
  });

  const allRepsRes = await sbRest<any[]>(
    `udhar_repayments?link_id=eq.${encodeURIComponent(tx.link_id)}&status=eq.confirmed`
  );
  const activeConfirmedReps = (allRepsRes.data || []).filter((r) => isActiveRepayment(r));
  const totalConfirmed = roundMoney(
    activeConfirmedReps.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  );
  const origAmt = parseFloat(tx.original_amount) || 0;
  const newBalance = roundMoney(Math.max(0, origAmt - totalConfirmed));
  const isSettled = newBalance <= 0.01;

  await sbRest(`udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}`, {
    method: 'PATCH',
    body: {
      current_balance: isSettled ? 0 : newBalance,
      paid_amount: isSettled ? origAmt : totalConfirmed,
      status: isSettled ? 'settled' : 'confirmed',
      settled_at: isSettled ? nowIso : tx.settled_at,
      updated_at: nowIso,
    },
  });

  if (rep.recorded_by_user_id && rep.recorded_by_user_id !== authUser.id) {
    await createTargetedNotificationRest({
      targetUserId: rep.recorded_by_user_id,
      actorUserId: authUser.id,
      title: `Repayment Confirmed by ${authUser.full_name}`,
      message: `${authUser.full_name} confirmed receiving ₹${parseFloat(rep.amount).toLocaleString('en-IN')}. Remaining balance: ₹${(isSettled ? 0 : newBalance).toLocaleString('en-IN')}.`,
      type: 'repayment_confirmed',
      relatedEntityId: tx.link_id,
    });
  }

  return {
    status: 200,
    body: {
      success: true,
      message: `Repayment of ₹${parseFloat(rep.amount).toLocaleString('en-IN')} confirmed!`,
      remainingBalance: isSettled ? 0 : newBalance,
      isSettled,
    },
  };
}

export async function rejectRepaymentRest(authUser: AuthenticatedUser, repaymentId: string, reason: string) {
  const repRes = await sbRest<any[]>(`udhar_repayments?id=eq.${encodeURIComponent(repaymentId)}&limit=1`);
  if (!repRes.ok || !repRes.data || repRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Repayment record not found.' } };
  }
  const rep = repRes.data[0];
  if (!isActiveRepayment(rep)) {
    return { status: 404, body: { success: false, message: 'Repayment record not found.' } };
  }

  const txRes = await sbRest<any[]>(
    `udhar_transactions?link_id=eq.${encodeURIComponent(rep.link_id)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Associated Udhar not found.' } };
  }
  const tx = txRes.data[0];
  if (tx.direction !== 'gave') {
    return { status: 403, body: { success: false, message: 'Only the lender can reject a repayment claim.' } };
  }

  await sbRest(`udhar_repayments?id=eq.${encodeURIComponent(repaymentId)}`, {
    method: 'PATCH',
    body: {
      status: 'rejected',
      rejection_reason: reason,
      confirmed_at: new Date().toISOString(),
      confirmed_by: authUser.id,
    },
  });

  if (rep.recorded_by_user_id && rep.recorded_by_user_id !== authUser.id) {
    await createTargetedNotificationRest({
      targetUserId: rep.recorded_by_user_id,
      actorUserId: authUser.id,
      title: 'Repayment Claim Rejected',
      message: `${authUser.full_name} rejected your payment claim of ₹${parseFloat(rep.amount).toLocaleString('en-IN')}: "${reason}".`,
      type: 'repayment_rejected',
      relatedEntityId: tx.link_id,
    });
  }

  return { status: 200, body: { success: true, message: 'Repayment claim rejected.', rejectionReason: reason } };
}

export async function editUdharRest(authUser: AuthenticatedUser, txId: string, body: any) {
  const txRes = await sbRest<any[]>(
    `udhar_transactions?id=eq.${encodeURIComponent(txId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Transaction not found.' } };
  }
  const tx = txRes.data[0];
  if (tx.counterpart_user_id && tx.direction === 'took') {
    return {
      status: 403,
      body: {
        success: false,
        message: 'Only the lender who gave the money can edit this Udhar transaction.',
      },
    };
  }

  const repsRes = await sbRest<any[]>(
    `udhar_repayments?link_id=eq.${encodeURIComponent(tx.link_id)}&status=eq.confirmed`
  );
  const activeConfirmedReps = (repsRes.data || []).filter((r) => isActiveRepayment(r));
  const confirmedPaid = roundMoney(
    activeConfirmedReps.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  );

  const { note: prevPlainNote, meta: prevMeta } = unpackStructuredNote(tx.notes);
  const lifecycle = normalizeUdharLifecycleStatus(tx);
  const editReason = (body.reason_for_edit || body.reason || body.edit_reason || '').trim();

  const validation = validateUdharEdit(
    {
      original_amount: parseFloat(tx.original_amount) || 0,
      paid_amount: confirmedPaid,
      status: lifecycle,
      notes: prevPlainNote,
      transaction_date: tx.transaction_date,
      due_date: tx.due_date,
      category: prevMeta.category || 'Personal Loan',
      payment_method: prevMeta.payment_method || 'UPI',
      description: prevMeta.description || null,
    },
    {
      amount: body.amount !== undefined ? parseFloat(body.amount) : undefined,
      notes: body.notes !== undefined ? (body.notes || '').trim() : undefined,
      transaction_date: body.transaction_date || body.date || undefined,
      due_date: body.due_date !== undefined ? body.due_date : (body.dueDate !== undefined ? body.dueDate : undefined),
      category: body.category !== undefined ? body.category : undefined,
      payment_method: body.payment_method !== undefined ? body.payment_method : undefined,
      description: body.description !== undefined ? body.description : undefined,
      reason_for_edit: editReason,
    }
  );

  if (!validation.valid) {
    return { status: 400, body: { success: false, message: validation.error || 'Invalid edit.' } };
  }

  const nextPlainNote = body.notes !== undefined ? (body.notes || '').trim() : prevPlainNote;
  const nextPackedNotes = packStructuredNote(nextPlainNote, {
    ...prevMeta,
    category: body.category !== undefined ? body.category : prevMeta.category,
    payment_method: body.payment_method !== undefined ? body.payment_method : prevMeta.payment_method,
    description: body.description !== undefined ? body.description : prevMeta.description,
    attachment_url: body.attachment_url !== undefined ? body.attachment_url : prevMeta.attachment_url,
    lifecycle_status: lifecycle === 'pending_confirmation' ? 'pending_confirmation' : validation.nextStatus,
  });

  const nextDate = body.transaction_date || body.date || tx.transaction_date;
  const nextDueDate =
    body.due_date !== undefined
      ? body.due_date || null
      : body.dueDate !== undefined
        ? body.dueDate || null
        : tx.due_date;
  const nowIso = new Date().toISOString();

  await sbRest('udhar_edit_history', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      udhar_id: tx.id,
      link_id: tx.link_id,
      edited_by_user_id: authUser.id,
      previous_amount: parseFloat(tx.original_amount) || 0,
      new_amount: validation.nextOriginalAmount,
      previous_notes: prevPlainNote || null,
      new_notes: nextPlainNote || null,
      previous_date: tx.transaction_date,
      new_date: nextDate,
      previous_due_date: tx.due_date || null,
      new_due_date: nextDueDate,
      reason_for_edit: editReason,
    },
  });

  await sbRest(`udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}`, {
    method: 'PATCH',
    body: {
      original_amount: validation.nextOriginalAmount,
      current_balance: validation.nextRemainingAmount,
      paid_amount: confirmedPaid,
      status: lifecycle === 'pending_confirmation' ? 'pending_confirmation' : validation.nextStatus,
      notes: nextPackedNotes,
      transaction_date: nextDate,
      due_date: nextDueDate,
      last_edited_at: nowIso,
      last_edited_by: authUser.id,
      edit_reason: editReason,
      updated_at: nowIso,
    },
  });

  if (tx.counterpart_user_id) {
    const targetUserId = tx.user_id === authUser.id ? tx.counterpart_user_id : tx.user_id;
    await createTargetedNotificationRest({
      targetUserId,
      actorUserId: authUser.id,
      title: `Udhar Edited by ${authUser.full_name}`,
      message: `${authUser.full_name} updated Udhar details (${editReason}). Remaining balance: ₹${(validation.nextRemainingAmount ?? 0).toLocaleString('en-IN')}.`,
      type: 'udhar_edited',
      relatedEntityId: tx.link_id,
    });
  }

  return {
    status: 200,
    body: {
      success: true,
      message: `Udhar updated across both accounts. Remaining balance: ₹${(validation.nextRemainingAmount ?? 0).toLocaleString('en-IN')}.`,
      remainingBalance: validation.nextRemainingAmount,
      isSettled: validation.isSettled,
      changes: validation.changes,
    },
  };
}

export async function settleUdharRest(authUser: AuthenticatedUser, txId: string, body: any) {
  const txRes = await sbRest<any[]>(
    `udhar_transactions?id=eq.${encodeURIComponent(txId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Transaction not found.' } };
  }
  const tx = txRes.data[0];

  if (tx.counterpart_user_id && tx.direction === 'took') {
    return {
      status: 403,
      body: {
        success: false,
        message: 'Only the lender can mark a shared Udhar as settled. As the borrower, record a repayment for lender confirmation.',
      },
    };
  }

  const lifecycle = normalizeUdharLifecycleStatus(tx);
  const currentBal = roundMoney(parseFloat(tx.current_balance) || 0);
  if (lifecycle === 'pending_confirmation') {
    return { status: 409, body: { success: false, message: 'Waiting for recipient confirmation before settling.' } };
  }
  if (lifecycle === 'settled' || currentBal <= 0.01) {
    return { status: 400, body: { success: false, message: 'This transaction is already settled.' } };
  }
  if (lifecycle === 'rejected' || lifecycle === 'cancelled' || lifecycle === 'deleted') {
    return { status: 400, body: { success: false, message: 'Cannot settle a rejected, cancelled, or deleted transaction.' } };
  }
  if (lifecycle === 'disputed') {
    return { status: 409, body: { success: false, message: 'Cannot settle a disputed transaction. Resolve the dispute first.' } };
  }

  const settleDate = body.settlement_date || body.date || new Date().toISOString().split('T')[0];
  const paymentMethod = (body.payment_method || 'UPI').trim();
  const notes = (body.notes || 'Settled in full').trim();
  const nowIso = new Date().toISOString();

  let patchRes = await sbRest<any[]>(
    `udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}&status=not.in.(settled,cancelled,disputed,rejected,pending_confirmation)`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        current_balance: 0,
        paid_amount: parseFloat(tx.original_amount) || 0,
        status: 'settled',
        settled_at: nowIso,
        settled_by: authUser.id,
        updated_at: nowIso,
      },
    }
  );
  if (!patchRes.ok && patchRes.status === 400) {
    patchRes = await sbRest<any[]>(
      `udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}&status=not.in.(settled,cancelled,disputed,pending_confirmation)`,
      {
        method: 'PATCH',
        prefer: 'return=representation',
        body: {
          current_balance: 0,
          paid_amount: parseFloat(tx.original_amount) || 0,
          status: 'settled',
          settled_at: nowIso,
          updated_at: nowIso,
        },
      }
    );
  }
  if (!patchRes.ok) {
    return { status: 503, body: { success: false, message: patchRes.error || 'Failed to settle transaction.' } };
  }
  if (!Array.isArray(patchRes.data) || patchRes.data.length === 0) {
    return { status: 409, body: { success: false, message: 'This transaction has already been settled or modified.' } };
  }

  await sbRest('udhar_repayments', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      link_id: tx.link_id,
      udhar_id: tx.id,
      recorded_by_user_id: authUser.id,
      amount: currentBal,
      repayment_date: settleDate,
      payment_method: paymentMethod,
      notes,
      status: 'confirmed',
      confirmed_at: nowIso,
      confirmed_by: authUser.id,
    },
  });

  if (tx.counterpart_user_id) {
    await createTargetedNotificationRest({
      targetUserId: tx.counterpart_user_id,
      actorUserId: authUser.id,
      title: `Udhar Settled with ${authUser.full_name}`,
      message: `${authUser.full_name} marked the Udhar of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')} as fully settled.`,
      type: 'settlement',
      relatedEntityId: tx.link_id,
    });
  }

  return {
    status: 200,
    body: {
      success: true,
      message: `Udhar with ${tx.counterpart_name} settled in full.`,
      isSettled: true,
      settledAt: nowIso,
      settledBy: authUser.id,
    },
  };
}

export async function cancelUdharRest(authUser: AuthenticatedUser, txId: string, reason?: string) {
  const txRes = await sbRest<any[]>(
    `udhar_transactions?id=eq.${encodeURIComponent(txId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Transaction not found.' } };
  }
  const tx = txRes.data[0];

  const repsRes = await sbRest<any[]>(`udhar_repayments?link_id=eq.${encodeURIComponent(tx.link_id)}`);
  const repayments = (repsRes.ok && Array.isArray(repsRes.data))
    ? repsRes.data.filter((r) => isActiveRepayment(r))
    : [];

  // Recompute authoritative settlement status strictly on backend from persisted repayments
  const recalc = recalculateUdharFromRepayments({
    originalAmount: tx.original_amount,
    repayments,
    currentStatus: tx.status,
  });

  const baseLifecycle = normalizeUdharLifecycleStatus(tx);
  const effectiveStatus = baseLifecycle === 'deleted' || baseLifecycle === 'cancelled' || baseLifecycle === 'rejected'
    ? baseLifecycle
    : baseLifecycle === 'disputed'
      ? 'disputed'
      : baseLifecycle === 'pending_confirmation'
        ? 'pending_confirmation'
        : (repayments.length > 0 ? recalc.nextStatus : baseLifecycle);

  const guard = canCancelUdhar({
    status: effectiveStatus,
    deleted_at: tx.deleted_at,
    notes: tx.notes,
    direction: tx.direction,
    is_shared: Boolean(tx.counterpart_user_id),
    counterpart_user_id: tx.counterpart_user_id,
    original_amount: tx.original_amount,
    paid_amount: repayments.length > 0 ? recalc.paidAmount : tx.paid_amount,
    current_balance: repayments.length > 0 ? recalc.remainingBalance : tx.current_balance,
    settled_at: tx.settled_at,
    repayments,
  });

  if (!guard.allowed) {
    return {
      status: guard.httpStatus || 409,
      body: { success: false, code: guard.code, message: guard.reason },
    };
  }

  const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;
  const nowIso = new Date().toISOString();
  const { note: prevNote, meta: prevMeta } = unpackStructuredNote(tx.notes);
  const deletedPackedNotes = packStructuredNote(prevNote, {
    ...prevMeta,
    lifecycle_status: 'deleted',
    cancelled_at: nowIso,
    cancelled_by: authUser.id,
  });

  // Atomic conditional soft-delete across both linked user rows (prevents replay/concurrent delete)
  let softDelRes = await sbRest<any[]>(
    `udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}&deleted_at=is.null&status=not.in.(disputed)`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        status: 'cancelled',
        current_balance: 0,
        paid_amount: 0,
        notes: deletedPackedNotes,
        deleted_at: nowIso,
        deleted_by: authUser.id,
        deletion_reason: cleanReason,
        updated_at: nowIso,
      },
    }
  );

  if (!softDelRes.ok && softDelRes.status === 400) {
    softDelRes = await sbRest<any[]>(
      `udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}&status=not.in.(disputed)`,
      {
        method: 'PATCH',
        prefer: 'return=representation',
        body: {
          status: 'cancelled',
          current_balance: 0,
          paid_amount: 0,
          notes: deletedPackedNotes,
          updated_at: nowIso,
        },
      }
    );
  }

  if (!softDelRes.ok) {
    return { status: 503, body: { success: false, message: softDelRes.error || 'Failed to delete transaction.' } };
  }
  if (!Array.isArray(softDelRes.data) || softDelRes.data.length === 0) {
    return { status: 409, body: { success: false, message: 'This transaction has already been deleted or cannot be deleted in its current state.' } };
  }

  // Cascade soft-delete to all repayments linked to this Udhar
  if (repayments.length > 0) {
    const repDelRes = await sbRest<any[]>(
      `udhar_repayments?link_id=eq.${encodeURIComponent(tx.link_id)}`,
      {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          status: 'deleted',
          deleted_at: nowIso,
          deleted_by: authUser.id,
          deletion_reason: cleanReason || 'Parent Udhar deleted',
        },
      }
    );
    if (!repDelRes.ok && repDelRes.status === 400) {
      await sbRest(`udhar_repayments?link_id=eq.${encodeURIComponent(tx.link_id)}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      });
    }
  }

  // Purge stale action/reminder notifications tied to this deleted Udhar, then notify counterpart
  await deactivateUdharNotificationsRest(tx.link_id, tx.id);
  if (tx.counterpart_user_id) {
    await createTargetedNotificationRest({
      targetUserId: tx.counterpart_user_id,
      actorUserId: authUser.id,
      title: `Udhar Deleted by ${authUser.full_name}`,
      message: `${authUser.full_name} permanently deleted the shared Udhar entry of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')}. Both accounts have been updated.`,
      type: 'udhar_deleted',
      dedupeKey: `udhar_del_${tx.link_id}`,
      metadata: {
        actionType: 'udhar_deleted',
        deletedLinkId: tx.link_id,
        deletedTxId: tx.id,
        amount: parseFloat(tx.original_amount) || 0,
      },
    }).catch(() => {});
  }

  return {
    status: 200,
    body: {
      success: true,
      deletedTransactionId: tx.id,
      linkId: tx.link_id,
      originalAmount: tx.original_amount,
      direction: tx.direction,
      counterpartUserId: tx.counterpart_user_id || null,
      deletionReason: cleanReason,
      deletedAt: nowIso,
      deletedBy: authUser.id,
      message: 'Udhar entry deleted successfully for both participants. Totals have been recalculated.',
    },
  };
}

export async function deleteRepaymentRest(authUser: AuthenticatedUser, repaymentId: string, reason?: string) {
  const repRes = await sbRest<any[]>(`udhar_repayments?id=eq.${encodeURIComponent(repaymentId)}&limit=1`);
  if (!repRes.ok || !repRes.data || repRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Repayment record not found.' } };
  }
  const rep = repRes.data[0];

  const txRes = await sbRest<any[]>(
    `udhar_transactions?link_id=eq.${encodeURIComponent(rep.link_id)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Associated Udhar transaction not found.' } };
  }
  const tx = txRes.data[0];

  if (tx.status === 'cancelled' || tx.deleted_at) {
    return { status: 409, body: { success: false, message: 'Associated Udhar has already been deleted.' } };
  }
  if (tx.status === 'disputed') {
    return { status: 409, body: { success: false, message: 'Cannot delete repayments on a disputed Udhar. Resolve the dispute first.' } };
  }

  const guard = canDeleteRepayment({
    isShared: Boolean(tx.counterpart_user_id),
    direction: tx.direction,
    actorUserId: authUser.id,
    repayment: rep,
  });
  if (!guard.allowed) {
    return { status: guard.httpStatus || 403, body: { success: false, message: guard.reason || 'Not authorized to delete this repayment.' } };
  }

  const nowIso = new Date().toISOString();
  const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;

  let repDelRes = await sbRest<any[]>(
    `udhar_repayments?id=eq.${encodeURIComponent(repaymentId)}`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        status: 'deleted',
        deleted_at: nowIso,
        deleted_by: authUser.id,
        deletion_reason: cleanReason,
      },
    }
  );
  if (!repDelRes.ok && repDelRes.status === 400) {
    repDelRes = await sbRest<any[]>(
      `udhar_repayments?id=eq.${encodeURIComponent(repaymentId)}`,
      {
        method: 'DELETE',
        prefer: 'return=representation',
      }
    );
  }
  if (!repDelRes.ok) {
    return { status: 503, body: { success: false, message: repDelRes.error || 'Failed to delete repayment.' } };
  }

  const remainingRepsRes = await sbRest<any[]>(
    `udhar_repayments?link_id=eq.${encodeURIComponent(tx.link_id)}`
  );
  const remainingReps = (remainingRepsRes.ok && Array.isArray(remainingRepsRes.data))
    ? remainingRepsRes.data.filter((r) => r.id !== repaymentId && isActiveRepayment(r))
    : [];

  const recalc = recalculateUdharFromRepayments({
    originalAmount: tx.original_amount,
    repayments: remainingReps,
    currentStatus: tx.status,
  });

  let parentUpdateRes = await sbRest<any[]>(
    `udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}&status=neq.cancelled`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        paid_amount: recalc.paidAmount,
        current_balance: recalc.remainingBalance,
        status: recalc.nextStatus,
        settled_at: recalc.isSettled ? (tx.settled_at || nowIso) : null,
        settled_by: recalc.isSettled ? (tx.settled_by || authUser.id) : null,
        updated_at: nowIso,
      },
    }
  );

  if (!parentUpdateRes.ok && parentUpdateRes.status === 400) {
    parentUpdateRes = await sbRest<any[]>(
      `udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}&status=neq.cancelled`,
      {
        method: 'PATCH',
        prefer: 'return=representation',
        body: {
          paid_amount: recalc.paidAmount,
          current_balance: recalc.remainingBalance,
          status: recalc.nextStatus,
          settled_at: recalc.isSettled ? (tx.settled_at || nowIso) : null,
          updated_at: nowIso,
        },
      }
    );
  }

  if (!parentUpdateRes.ok) {
    return { status: 503, body: { success: false, message: parentUpdateRes.error || 'Failed to recalculate Udhar balance.' } };
  }

  if (tx.counterpart_user_id) {
    await createTargetedNotificationRest({
      targetUserId: tx.counterpart_user_id,
      actorUserId: authUser.id,
      title: `Repayment Deleted by ${authUser.full_name}`,
      message: `${authUser.full_name} deleted a repayment of ₹${parseFloat(rep.amount).toLocaleString('en-IN')}. Updated balance: ₹${recalc.remainingBalance.toLocaleString('en-IN')}.`,
      type: 'repayment_deleted',
      relatedEntityId: tx.link_id,
    });
  }

  return {
    status: 200,
    body: {
      success: true,
      deletedRepaymentId: repaymentId,
      transactionId: tx.id,
      linkId: tx.link_id,
      paidAmount: recalc.paidAmount,
      remainingBalance: recalc.remainingBalance,
      udharStatus: recalc.nextStatus,
      isSettled: recalc.isSettled,
      message: `Repayment of ₹${parseFloat(rep.amount).toLocaleString('en-IN')} deleted. Remaining balance: ₹${recalc.remainingBalance.toLocaleString('en-IN')}.`,
    },
  };
}

export async function getUdharHistoryRest(authUser: AuthenticatedUser, txId: string) {
  const txRes = await sbRest<any[]>(
    `udhar_transactions?id=eq.${encodeURIComponent(txId)}&or=(user_id.eq.${encodeURIComponent(authUser.id)},counterpart_user_id.eq.${encodeURIComponent(authUser.id)})&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Transaction not found.' } };
  }
  const tx = txRes.data[0];
  if (tx.status === 'cancelled' || Boolean(tx.deleted_at)) {
    return { status: 404, body: { success: false, message: 'Transaction not found.' } };
  }

  const [repsRes, histRes] = await Promise.all([
    sbRest<any[]>(`udhar_repayments?link_id=eq.${encodeURIComponent(tx.link_id)}&order=repayment_date.desc,created_at.desc`),
    sbRest<any[]>(`udhar_edit_history?link_id=eq.${encodeURIComponent(tx.link_id)}&order=created_at.desc`),
  ]);

  const reps = (repsRes.data || []).filter((r) => isActiveRepayment(r));
  const hist = histRes.data || [];
  const userIds = [
    tx.counterpart_user_id,
    ...reps.map((r) => r.recorded_by_user_id),
    ...hist.map((h) => h.edited_by_user_id),
  ].filter(Boolean);
  const userMap = await fetchUsersByIds(userIds);
  const enriched = enrichTransactionRow(tx, userMap, reps, hist);

  return {
    status: 200,
    body: {
      success: true,
      transaction: enriched,
      editHistory: enriched.edit_history,
      repayments: enriched.repayments,
    },
  };
}

/**
 * Resolves a person's verified UPI profile for Udhar payment.
 * Identifier can be a linked user ID, contact ID, or person name.
 * Security rules:
 * - Never returns currently logged-in user's own profile.
 * - Respects DPDP UPI consent (if withdrawn, returns hasUpi: false).
 * - Validates UPI ID format.
 * - Never generates fake or placeholder UPI IDs.
 */
export async function getPersonUpiProfileRest(authUser: AuthenticatedUser, identifier: string) {
  const cleanId = (identifier || '').trim();
  if (!cleanId) {
    return { status: 400, body: { success: false, message: 'Person identifier is required.' } };
  }

  let targetUserId: string | null = null;
  let targetUserName: string | null = null;
  let targetUserAvatar: string | null = null;

  // 1. Check if cleanId is directly a user ID
  if (cleanId !== authUser.id) {
    const directUsers = await fetchUsersByIds([cleanId]);
    if (directUsers.has(cleanId)) {
      const u = directUsers.get(cleanId);
      targetUserId = u.id;
      targetUserName = u.full_name || u.displayName || u.email?.split('@')[0] || 'Recipient';
      targetUserAvatar = u.avatar_url || null;
    }
  }

  // 2. Check if cleanId is an udhar_contacts ID or contact name owned by authUser
  if (!targetUserId) {
    const contactRes = await sbRest<any[]>(
      `udhar_contacts?user_id=eq.${encodeURIComponent(authUser.id)}&or=(id.eq.${encodeURIComponent(cleanId)},name.eq.${encodeURIComponent(cleanId)})&select=id,name,linked_user_id,photo_url&limit=1`
    );
    if (contactRes.ok && contactRes.data && contactRes.data.length > 0) {
      const contact = contactRes.data[0];
      targetUserName = contact.name;
      targetUserAvatar = contact.photo_url || null;
      if (contact.linked_user_id && contact.linked_user_id !== authUser.id) {
        targetUserId = contact.linked_user_id;
        const linkedUsers = await fetchUsersByIds([contact.linked_user_id]);
        if (linkedUsers.has(contact.linked_user_id)) {
          const lu = linkedUsers.get(contact.linked_user_id);
          targetUserName = lu.full_name || contact.name;
          targetUserAvatar = lu.avatar_url || contact.photo_url || null;
        }
      }
    }
  }

  // 3. Check counterpart in udhar_transactions if still not resolved
  if (!targetUserId) {
    const txRes = await sbRest<any[]>(
      `udhar_transactions?user_id=eq.${encodeURIComponent(authUser.id)}&counterpart_name=eq.${encodeURIComponent(cleanId)}&counterpart_user_id=not.is.null&select=counterpart_user_id,counterpart_name&limit=1`
    );
    if (txRes.ok && txRes.data && txRes.data.length > 0) {
      const cpId = txRes.data[0].counterpart_user_id;
      if (cpId && cpId !== authUser.id) {
        targetUserId = cpId;
        targetUserName = txRes.data[0].counterpart_name;
      }
    }
  }

  // If no registered target user could be resolved (purely manual contact)
  if (!targetUserId) {
    return {
      status: 200,
      body: {
        success: true,
        hasUpi: false,
        message: 'UPI ID not available.',
        recipientName: targetUserName || cleanId,
        isManualContact: true,
      },
    };
  }

  // Security: Never show logged-in user's own UPI QR by mistake!
  if (targetUserId === authUser.id) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'Cannot view recipient UPI QR for your own account.',
      },
    };
  }

  // Fetch target user's verified UPI profile from backend
  const targetUserObj = { id: targetUserId };
  const [upiProfile, consentInfo] = await Promise.all([
    getSavedUpiProfileForUser(targetUserId),
    getLatestUpiConsentInfo(targetUserObj).catch(() => ({ status: 'granted' })),
  ]);

  if (consentInfo && (consentInfo as any).status === 'withdrawn') {
    return {
      status: 200,
      body: {
        success: true,
        hasUpi: false,
        message: 'UPI ID not available.',
        recipientName: targetUserName,
        targetUserId,
      },
    };
  }

  if (!upiProfile || !upiProfile.upiId || !upiProfile.upiId.trim()) {
    return {
      status: 200,
      body: {
        success: true,
        hasUpi: false,
        message: 'UPI ID not available.',
        recipientName: targetUserName,
        targetUserId,
      },
    };
  }

  const upiIdTrimmed = upiProfile.upiId.trim();
  const payeeName = (upiProfile.payeeName || targetUserName || 'Recipient').trim();

  return {
    status: 200,
    body: {
      success: true,
      hasUpi: true,
      upiId: upiIdTrimmed,
      payeeName,
      paymentNote: upiProfile.paymentNote || '',
      targetUserId,
      recipientName: targetUserName,
      avatarUrl: targetUserAvatar,
    },
  };
}
