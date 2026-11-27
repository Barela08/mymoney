import crypto from 'crypto';
import type { AuthenticatedUser } from './auth.js';
import {
  normalizeSearchQuery,
  classifyLiveSearchQuery,
  maskEmailForPrivacy,
  maskPhoneForPrivacy,
  parseQrPayload,
  calculateRepaymentApplication,
  validateUdharEdit,
  canCancelUdhar,
  calculatePeopleDashboardSummary,
  packStructuredNote,
  unpackStructuredNote,
  roundMoney,
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

  return {
    ...row,
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
    repayments: repayments.map((rep) => {
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
  const res = await sbRest<any[]>(
    `app_users?id=in.(${encodeURIComponent(inList)})&select=id,full_name,email,phone,avatar_url,status,deletion_status,email_verified`
  );
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

async function ensureConnectionAndReciprocalContactsRest(
  authUser: AuthenticatedUser,
  targetUser: { id: string; full_name: string; email?: string | null; phone?: string | null; avatar_url?: string | null },
  relationshipType: string = 'Friend'
) {
  // 1. Bidirectional user_connections
  await sbRest('user_connections?on_conflict=user_a_id,user_b_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { user_a_id: authUser.id, user_b_id: targetUser.id, status: 'connected' },
  }).catch(() => {});
  await sbRest('user_connections?on_conflict=user_a_id,user_b_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { user_a_id: targetUser.id, user_b_id: authUser.id, status: 'connected' },
  }).catch(() => {});

  const nowIso = new Date().toISOString();
  const targetName = (targetUser.full_name || targetUser.email?.split('@')[0] || 'User').trim();
  const myName = (authUser.full_name || authUser.email?.split('@')[0] || 'User').trim();

  // 2. Ensure target is in authUser's udhar_contacts
  const existingMine = await sbRest<any[]>(
    `udhar_contacts?user_id=eq.${encodeURIComponent(authUser.id)}&linked_user_id=eq.${encodeURIComponent(targetUser.id)}&limit=1`
  );
  if (existingMine.ok && existingMine.data && existingMine.data.length > 0) {
    await sbRest(`udhar_contacts?id=eq.${encodeURIComponent(existingMine.data[0].id)}`, {
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
    await sbRest('udhar_contacts?on_conflict=user_id,name', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        user_id: authUser.id,
        name: targetName,
        email: targetUser.email || null,
        phone: targetUser.phone || null,
        photo_url: targetUser.avatar_url || null,
        relationship_type: relationshipType || 'Friend',
        linked_user_id: targetUser.id,
        updated_at: nowIso,
      },
    });
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
    });
  } else {
    await sbRest('udhar_contacts?on_conflict=user_id,name', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        user_id: targetUser.id,
        name: myName,
        email: authUser.email || null,
        phone: authUser.phone || null,
        photo_url: authUser.avatar_url || null,
        relationship_type: relationshipType || 'Friend',
        linked_user_id: authUser.id,
        updated_at: nowIso,
      },
    });
  }
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
  metadata?: Record<string, any>;
}) {
  if (!params.targetUserId || params.targetUserId === 'all') return;
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
    sbRest('user_notifications', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        user_id: params.targetUserId,
        title: params.title,
        message: params.message,
        category: params.category || 'udhar',
        type: params.type === 'udhar_connection_request' ? 'info' : 'success',
        deep_link: params.deepLink || 'people',
        is_read: false,
        is_deleted: false,
        metadata: params.metadata || {
          actionType: params.type,
          relatedEntityId: params.relatedEntityId || null,
          actorUserId: params.actorUserId,
        },
      },
    }).catch(() => {}),
  ]);
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
  let queryPath = '';

  if (classified.mode === 'email_exact') {
    queryPath = `app_users?status=eq.active&email=ilike.${encodeURIComponent(escaped)}&select=id,full_name,email,phone,avatar_url,status,deletion_status,email_verified,role&limit=5`;
  } else if (classified.mode === 'phone_exact') {
    const tail = classified.last10Digits;
    queryPath = `app_users?status=eq.active&or=(phone.ilike.*${encodeURIComponent(tail)}*,phone.ilike.*${encodeURIComponent(classified.digitsOnly)}*)&select=id,full_name,email,phone,avatar_url,status,deletion_status,email_verified,role&limit=15`;
  } else {
    const orClauses = [`full_name.ilike.*${escaped}*`, `email.ilike.*${escaped}*`];
    queryPath = `app_users?status=eq.active&or=(${encodeURIComponent(orClauses.join(','))})&select=id,full_name,email,phone,avatar_url,status,deletion_status,email_verified,role&order=full_name.asc&limit=20`;
  }

  const usersRes = await sbRest<any[]>(queryPath);

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

  let activeUsers = (usersRes.data || []).filter(
  (u) =>
  (!u.deletion_status || u.deletion_status === 'none') &&
  String(u.role || '').toLowerCase() !== 'admin' &&
  String(u.email || '').toLowerCase().trim() !== 'admin@mymoney.com'
  );

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
        displayName: u.full_name || (u.email ? u.email.split('@')[0] : 'My Money User'),
        fullName: u.full_name || (u.email ? u.email.split('@')[0] : 'My Money User'),
        username: u.email ? u.email.split('@')[0] : null,
        accountIndicator: 'My Money Manager Account',
        emailMasked: showContactHint ? maskEmailForPrivacy(u.email) : undefined,
        phoneMasked: showContactHint ? maskPhoneForPrivacy(u.phone) : null,
        avatarUrl: u.avatar_url || null,
        isSelf,
        isVerified: Boolean(u.email_verified ?? true),
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
export async function connectUserRest(
  authUser: AuthenticatedUser,
  body: { targetUserId?: string; relationshipType?: string; requestedVia?: string }
) {
  const targetUserId = (body.targetUserId || '').trim();
  const relationshipType = (body.relationshipType || 'Friend').trim();
  const requestedVia = (body.requestedVia || 'search').trim();

  if (!targetUserId) {
    return { status: 400, body: { success: false, code: 'MISSING_TARGET', message: 'Target user ID is required.' } };
  }
  if (targetUserId === authUser.id) {
    return { status: 400, body: { success: false, code: 'SELF_CONNECTION', message: 'You cannot connect with your own account.' } };
  }

  const targetRes = await sbRest<any[]>(
    `app_users?id=eq.${encodeURIComponent(targetUserId)}&select=id,full_name,email,phone,avatar_url,status,deletion_status,email_verified`
  );
  if (!targetRes.ok || !targetRes.data || targetRes.data.length === 0) {
    return { status: 404, body: { success: false, code: 'NOT_FOUND', message: 'User account not found.' } };
  }

  const target = targetRes.data[0];
  if (target.status !== 'active' || (target.deletion_status && target.deletion_status !== 'none')) {
    return { status: 403, body: { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'This user account is no longer active.' } };
  }

  if (await isBlockedBetween(authUser.id, targetUserId)) {
    return { status: 403, body: { success: false, code: 'BLOCKED', message: 'Connection is blocked between these accounts.' } };
  }

  const pairRes = await sbRest<any[]>(
    `user_connections?or=(and(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(targetUserId)}),and(user_a_id.eq.${encodeURIComponent(targetUserId)},user_b_id.eq.${encodeURIComponent(authUser.id)}))&select=id,user_a_id,user_b_id,status`
  );
  const pairRows = (pairRes.ok && Array.isArray(pairRes.data)) ? pairRes.data : [];

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
  const incomingPending = pairRows.find(
    (r) => r.user_a_id === targetUserId && r.user_b_id === authUser.id && r.status === 'pending'
  );
  if (incomingPending) {
    return acceptConnectionRequestRest(authUser, incomingPending.id);
  }

  // Case 3: Duplicate outgoing pending request -> prevent duplicates
  const outgoingPending = pairRows.find(
    (r) => r.user_a_id === authUser.id && r.user_b_id === targetUserId && r.status === 'pending'
  );
  if (outgoingPending) {
    return {
      status: 200,
      body: {
        success: true,
        status: 'pending',
        alreadyPending: true,
        requestId: outgoingPending.id,
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

  // Case 4: Create a NEW pending connection request (requires explicit target user acceptance)
  const insRes = await sbRest<any[]>('user_connections?on_conflict=user_a_id,user_b_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      user_a_id: authUser.id,
      user_b_id: targetUserId,
      status: 'pending',
    },
  });

  if (!insRes.ok) {
    return {
      status: 503,
      body: { success: false, code: 'REQUEST_FAILED', message: 'Unable to send connection request right now. Please try again.' },
    };
  }

  const requestId = insRes.data?.[0]?.id || `${authUser.id}:${targetUserId}`;

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
      requesterUserId: authUser.id,
      requesterName,
      requestedVia,
      relationshipType,
    },
  });

  return {
    status: 200,
    body: {
      success: true,
      status: 'pending',
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
  const connRes = await sbRest<any[]>(
    `user_connections?or=(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(authUser.id)})&select=id,user_a_id,user_b_id,status,created_at&order=created_at.desc`
  );
  if (!connRes.ok) {
    return { status: 503, body: { success: false, message: 'Unable to load connection requests right now.' } };
  }

  const rows = connRes.data || [];
  const otherIds = rows
    .map((r) => (r.user_a_id === authUser.id ? r.user_b_id : r.user_a_id))
    .filter(Boolean);
  const userMap = await fetchUsersByIds(otherIds);

  const incoming: any[] = [];
  const outgoing: any[] = [];
  const connectedMap = new Map<string, any>();

  for (const r of rows) {
    if (r.status === 'pending') {
      if (r.user_b_id === authUser.id) {
        const u = userMap.get(r.user_a_id);
        incoming.push({
          id: r.id,
          requesterUserId: r.user_a_id,
          displayName: u?.full_name || 'My Money User',
          avatarUrl: u?.avatar_url || null,
          isVerified: Boolean(u?.is_verified ?? true),
          status: 'pending',
          createdAt: r.created_at,
        });
      } else if (r.user_a_id === authUser.id) {
        const u = userMap.get(r.user_b_id);
        outgoing.push({
          id: r.id,
          targetUserId: r.user_b_id,
          displayName: u?.full_name || 'My Money User',
          avatarUrl: u?.avatar_url || null,
          isVerified: Boolean(u?.is_verified ?? true),
          status: 'pending',
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
  const key = (requestIdOrUserId || '').trim();
  if (!key) {
    return { status: 400, body: { success: false, message: 'Connection request ID is required.' } };
  }

  const reqRes = await sbRest<any[]>(
    `user_connections?user_b_id=eq.${encodeURIComponent(authUser.id)}&status=eq.pending&or=(id.eq.${encodeURIComponent(key)},user_a_id.eq.${encodeURIComponent(key)})&limit=1`
  );
  if (!reqRes.ok || !reqRes.data || reqRes.data.length === 0) {
    return { status: 404, body: { success: false, code: 'REQUEST_NOT_FOUND', message: 'Pending connection request not found.' } };
  }

  const pendingRow = reqRes.data[0];
  const requesterId = pendingRow.user_a_id;
  const userMap = await fetchUsersByIds([requesterId]);
  const requester = userMap.get(requesterId);
  if (!requester || requester.status !== 'active') {
    return { status: 404, body: { success: false, message: 'Requester account is no longer active.' } };
  }

  await ensureConnectionAndReciprocalContactsRest(authUser, requester, 'Friend');

  const acceptorName = (authUser.full_name || authUser.email?.split('@')[0] || 'User').trim();
  const requesterName = (requester.full_name || requester.email?.split('@')[0] || 'Friend').trim();

  await createTargetedNotificationRest({
    targetUserId: requester.id,
    actorUserId: authUser.id,
    title: 'Udhar Connection Accepted',
    message: `${acceptorName} accepted your Udhar connection request. You can now track shared Udhar together.`,
    type: 'connection_accepted',
    category: 'udhar',
    deepLink: 'people',
    relatedEntityId: authUser.id,
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
  const key = (requestIdOrUserId || '').trim();
  if (!key) {
    return { status: 400, body: { success: false, message: 'Connection request ID is required.' } };
  }

  const reqRes = await sbRest<any[]>(
    `user_connections?user_b_id=eq.${encodeURIComponent(authUser.id)}&status=eq.pending&or=(id.eq.${encodeURIComponent(key)},user_a_id.eq.${encodeURIComponent(key)})&limit=1`
  );
  if (!reqRes.ok || !reqRes.data || reqRes.data.length === 0) {
    return { status: 404, body: { success: false, code: 'REQUEST_NOT_FOUND', message: 'Pending connection request not found.' } };
  }

  const pendingRow = reqRes.data[0];
  await sbRest(`user_connections?id=eq.${encodeURIComponent(pendingRow.id)}`, {
    method: 'PATCH',
    body: { status: 'rejected' },
  });

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

export async function disconnectUserRest(authUser: AuthenticatedUser, targetUserId: string) {
  const targetId = (targetUserId || '').trim();
  if (!targetId) {
    return { status: 400, body: { success: false, message: 'Target user ID is required.' } };
  }

  // Mark connection rows disconnected/deleted in both directions
  await sbRest(
    `user_connections?or=(and(user_a_id.eq.${encodeURIComponent(authUser.id)},user_b_id.eq.${encodeURIComponent(targetId)}),and(user_a_id.eq.${encodeURIComponent(targetId)},user_b_id.eq.${encodeURIComponent(authUser.id)}))`,
    { method: 'DELETE' }
  );

  // Unlink linked_user_id on contacts while preserving past Udhar records
  const nowIso = new Date().toISOString();
  await Promise.all([
    sbRest(`udhar_contacts?user_id=eq.${encodeURIComponent(authUser.id)}&linked_user_id=eq.${encodeURIComponent(targetId)}`, {
      method: 'PATCH',
      body: { linked_user_id: null, updated_at: nowIso },
    }).catch(() => {}),
    sbRest(`udhar_contacts?user_id=eq.${encodeURIComponent(targetId)}&linked_user_id=eq.${encodeURIComponent(authUser.id)}`, {
      method: 'PATCH',
      body: { linked_user_id: null, updated_at: nowIso },
    }).catch(() => {}),
  ]);

  const actorName = (authUser.full_name || authUser.email?.split('@')[0] || 'User').trim();
  await createTargetedNotificationRest({
    targetUserId: targetId,
    actorUserId: authUser.id,
    title: 'Udhar Connection Disconnected',
    message: `${actorName} disconnected their Udhar pairing with you. Your existing Udhar history remains preserved.`,
    type: 'connection_disconnected',
    category: 'udhar',
    deepLink: 'people',
    relatedEntityId: authUser.id,
  });

  return {
    status: 200,
    body: {
      success: true,
      status: 'disconnected',
      message: 'Disconnected successfully. Existing Udhar transaction history has been preserved.',
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
export async function getContactsRest(authUser: AuthenticatedUser) {
  const res = await sbRest<any[]>(
    `udhar_contacts?user_id=eq.${encodeURIComponent(authUser.id)}&order=name.asc`
  );
  if (!res.ok) {
    return { status: 503, body: { success: false, message: 'Failed to load contacts.' } };
  }
  const rows = res.data || [];
  const linkedIds = rows.map((r) => r.linked_user_id).filter(Boolean);
  const userMap = await fetchUsersByIds(linkedIds);

  const contacts = rows.map((c) => {
    const u = c.linked_user_id ? userMap.get(c.linked_user_id) : null;
    return {
      ...c,
      linked_user_name: u?.full_name || null,
      linked_user_email: u?.email ? maskEmailForPrivacy(u.email) : null,
      linked_user_avatar: u?.avatar_url || null,
    };
  });

  return { status: 200, body: { success: true, contacts } };
}

export async function getContactsWithBalancesRest(authUser: AuthenticatedUser) {
  const [contactsRes, txRes] = await Promise.all([
    sbRest<any[]>(`udhar_contacts?user_id=eq.${encodeURIComponent(authUser.id)}&order=name.asc`),
    sbRest<any[]>(`udhar_transactions?user_id=eq.${encodeURIComponent(authUser.id)}`),
  ]);

  if (!contactsRes.ok) {
    return { status: 503, body: { success: false, message: 'Failed to load people contacts.' } };
  }

  const contacts = contactsRes.data || [];
  const txs = (txRes.ok && Array.isArray(txRes.data)) ? txRes.data : [];
  const linkedIds = contacts.map((c) => c.linked_user_id).filter(Boolean);
  const userMap = await fetchUsersByIds(linkedIds);

  const parsedContacts = contacts.map((c) => {
    const u = c.linked_user_id ? userMap.get(c.linked_user_id) : null;
    const matchingTxs = txs.filter((t) => {
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

    for (const t of matchingTxs) {
      if (t.status === 'cancelled') continue;
      const orig = parseFloat(t.original_amount) || 0;
      const cur = parseFloat(t.current_balance) || 0;
      const isSettled = t.status === 'settled' || cur <= 0.01;
      if (t.direction === 'gave') {
        totalGiven += orig;
        if (!isSettled) receivable += cur;
      } else {
        totalTaken += orig;
        if (!isSettled) payable += cur;
      }
      if (!isSettled && cur > 0.01) pendingCount += 1;
      if (t.transaction_date && (!lastDate || t.transaction_date > lastDate)) {
        lastDate = t.transaction_date;
      }
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
      total_transactions_count: matchingTxs.filter((t) => t.status !== 'cancelled').length,
      pending_transactions_count: pendingCount,
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

  // IMPORTANT SECURITY RULE: NEVER silently auto-link manual contacts by name match!
  // Only link if an explicit verified linked_user_id was selected via Search/QR/Link flow.
  let verifiedTarget: any = null;
  if (requestedLinkedUserId) {
    if (requestedLinkedUserId === authUser.id) {
      return { status: 400, body: { success: false, message: 'You cannot add yourself as a contact.' } };
    }
    const targetRes = await sbRest<any[]>(
      `app_users?id=eq.${encodeURIComponent(requestedLinkedUserId)}&status=eq.active&select=id,full_name,email,phone,avatar_url,deletion_status`
    );
    if (!targetRes.ok || !targetRes.data || targetRes.data.length === 0) {
      return { status: 404, body: { success: false, message: 'Selected user account was not found.' } };
    }
    const target = targetRes.data[0];
    if (target.deletion_status && target.deletion_status !== 'none') {
      return { status: 403, body: { success: false, message: 'Selected user account is unavailable.' } };
    }
    if (await isBlockedBetween(authUser.id, target.id)) {
      return { status: 403, body: { success: false, message: 'Cannot connect with a blocked account.' } };
    }
    verifiedTarget = target;
  }

  const nowIso = new Date().toISOString();
  const payload = {
    user_id: authUser.id,
    name: verifiedTarget ? verifiedTarget.full_name : name,
    email: verifiedTarget ? verifiedTarget.email : (email || null),
    phone: verifiedTarget ? verifiedTarget.phone : (phone || null),
    photo_url: verifiedTarget ? (verifiedTarget.avatar_url || photoUrl) : photoUrl,
    relationship_type: relationshipType,
    notes: notes || null,
    linked_user_id: verifiedTarget ? verifiedTarget.id : null,
    updated_at: nowIso,
  };

  const upsertRes = await sbRest<any[]>('udhar_contacts?on_conflict=user_id,name', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: payload,
  });

  if (!upsertRes.ok || !upsertRes.data || upsertRes.data.length === 0) {
    return { status: 500, body: { success: false, message: upsertRes.error || 'Failed to save contact.' } };
  }

  if (verifiedTarget) {
    await ensureConnectionAndReciprocalContactsRest(authUser, verifiedTarget, relationshipType);
  }

  return {
    status: 200,
    body: {
      success: true,
      contact: upsertRes.data[0],
      reciprocallyLinked: Boolean(verifiedTarget),
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

  const existingRes = await sbRest<any[]>(
    `udhar_contacts?id=eq.${encodeURIComponent(contactId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!existingRes.ok || !existingRes.data || existingRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Contact not found.' } };
  }

  const existing = existingRes.data[0];
  const patchBody: Record<string, any> = {
    name,
    email: email || null,
    phone: phone || null,
    relationship_type: relationshipType,
    notes: notes || null,
    updated_at: new Date().toISOString(),
  };
  if (photoUrl !== undefined) patchBody.photo_url = photoUrl;

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
      reciprocallyLinked: Boolean(existing.linked_user_id),
    },
  };
}

export async function deleteContactRest(authUser: AuthenticatedUser, contactId: string) {
  const res = await sbRest(
    `udhar_contacts?id=eq.${encodeURIComponent(contactId)}&user_id=eq.${encodeURIComponent(authUser.id)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    return { status: 500, body: { success: false, message: res.error || 'Failed to remove contact.' } };
  }
  return { status: 200, body: { success: true, message: 'Saved contact removed.' } };
}

export async function linkContactRest(authUser: AuthenticatedUser, contactId: string, registeredUserId: string) {
  if (!registeredUserId) {
    return { status: 400, body: { success: false, message: 'Target registered user ID is required.' } };
  }
  if (registeredUserId === authUser.id) {
    return { status: 400, body: { success: false, message: 'You cannot link a contact to your own account.' } };
  }

  const [contactRes, targetRes] = await Promise.all([
    sbRest<any[]>(`udhar_contacts?id=eq.${encodeURIComponent(contactId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`),
    sbRest<any[]>(`app_users?id=eq.${encodeURIComponent(registeredUserId)}&status=eq.active&select=id,full_name,email,phone,avatar_url,deletion_status&limit=1`),
  ]);

  if (!contactRes.ok || !contactRes.data || contactRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Contact not found.' } };
  }
  if (!targetRes.ok || !targetRes.data || targetRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Registered user not found.' } };
  }
  const contact = contactRes.data[0];
  const target = targetRes.data[0];

  if (target.deletion_status && target.deletion_status !== 'none') {
    return { status: 403, body: { success: false, message: 'Target user account is unavailable.' } };
  }
  if (await isBlockedBetween(authUser.id, target.id)) {
    return { status: 403, body: { success: false, message: 'Cannot link with a blocked account.' } };
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

  await ensureConnectionAndReciprocalContactsRest(authUser, target, contact.relationship_type || 'Friend');

  return {
    status: 200,
    body: {
      success: true,
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
  if (qrRecord.used) {
    return {
      status: 410,
      body: {
        success: false,
        code: 'QR_REVOKED',
        message: 'This pairing QR has been revoked. Ask your friend to share their new Udhar Pairing QR.',
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
    `app_users?id=eq.${encodeURIComponent(qrRecord.user_id)}&select=id,full_name,email,phone,avatar_url,status,deletion_status,is_verified&limit=1`
  );
  if (!userRes.ok || !userRes.data || userRes.data.length === 0) {
    return {
      status: 404,
      body: { success: false, code: 'NOT_FOUND', message: 'Account not found.' },
    };
  }
  const owner = userRes.data[0];
  if (owner.status !== 'active' || (owner.deletion_status && owner.deletion_status !== 'none')) {
    return {
      status: 403,
      body: { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'This user account is deactivated or unavailable.' },
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
  const targetId = resolved.body.owner.id;
  const relationshipType = (body.relationshipType || 'Friend').trim();
  const connResult = await connectUserRest(authUser, {
    targetUserId: targetId,
    relationshipType,
    requestedVia: 'qr',
  });
  return connResult;
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

  const rawTxs = txRes.data || [];
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
    if (repRes.ok && Array.isArray(repRes.data)) repaymentsRows = repRes.data;
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
  const counterpartName = (body.counterpart_name || body.person_name || '').trim();
  const counterpartUserId = (body.counterpart_user_id || body.counterpartUserId || '').trim() || null;
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

  if (!counterpartName) {
    return { status: 400, body: { success: false, message: "Person's name is required." } };
  }
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
  if (counterpartUserId && counterpartUserId !== authUser.id) {
    const uRes = await sbRest<any[]>(
      `app_users?id=eq.${encodeURIComponent(counterpartUserId)}&status=eq.active&select=id,full_name,email,phone,avatar_url,deletion_status&limit=1`
    );
    if (uRes.ok && uRes.data && uRes.data.length > 0) {
      const u = uRes.data[0];
      if (!u.deletion_status || u.deletion_status === 'none') {
        if (await isBlockedBetween(authUser.id, u.id)) {
          return { status: 403, body: { success: false, message: 'Cannot create shared Udhar with a blocked user.' } };
        }
        registeredUser = u;
      }
    }
  }

  const packedNotes = packStructuredNote(plainNotes, {
    category,
    payment_method: paymentMethod,
    description: description || undefined,
    attachment_url: attachmentUrl || undefined,
  });

  const linkId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  if (registeredUser) {
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
      status: 'confirmed',
      confirmation_status: 'confirmed',
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
      status: 'confirmed',
      confirmation_status: 'confirmed',
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

    const createdUserA = insertRes.data.find((r) => r.user_id === authUser.id) || insertRes.data[0];

    await ensureConnectionAndReciprocalContactsRest(authUser, registeredUser, 'Friend');

    // Private targeted notification for User B ONLY (never target_user_id='all')
    await createTargetedNotificationRest({
      targetUserId: registeredUser.id,
      actorUserId: authUser.id,
      title: `New Shared Udhar from ${authUser.full_name}`,
      message: `${authUser.full_name} recorded an Udhar of ₹${amount.toLocaleString('en-IN')} (${direction === 'gave' ? "You'll Pay" : "You'll Receive"}).`,
      type: 'udhar_created',
      relatedEntityId: linkId,
    });

    const userMap = new Map<string, any>([[registeredUser.id, registeredUser]]);
    return {
      status: 201,
      body: {
        success: true,
        message: `Shared Udhar recorded with ${registeredUser.full_name}. Synced to both accounts.`,
        transaction: enrichTransactionRow(createdUserA, userMap, [], []),
        isLinked: true,
      },
    };
  } else {
    // Manual / Local Contact Udhar (NO 2-way sync)
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
        message: `Local Udhar recorded for ${counterpartName}.`,
        transaction: enrichTransactionRow(insertRes.data[0], new Map(), [], []),
        isLinked: false,
      },
    };
  }
}

export async function confirmUdharTransactionRest(authUser: AuthenticatedUser, txId: string) {
  const txRes = await sbRest<any[]>(
    `udhar_transactions?id=eq.${encodeURIComponent(txId)}&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Transaction not found.' } };
  }
  const tx = txRes.data[0];

  await sbRest(`udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}`, {
    method: 'PATCH',
    body: { status: 'confirmed', confirmation_status: 'confirmed', updated_at: new Date().toISOString() },
  });

  return { status: 200, body: { success: true, message: 'Transaction confirmed on both accounts.' } };
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
  const existingReps = (existingRepsRes.ok && Array.isArray(existingRepsRes.data)) ? existingRepsRes.data : [];

  const confirmedPaid = roundMoney(
    existingReps.filter((r) => r.status === 'confirmed').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  );
  const pendingRepayments = roundMoney(
    existingReps.filter((r) => r.status === 'pending_confirmation').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  );

  const calc = calculateRepaymentApplication({
    originalAmount: parseFloat(tx.original_amount) || 0,
    confirmedPaidAmount: confirmedPaid,
    pendingRepaymentsAmount: pendingRepayments,
    repayAmount,
    isShared: Boolean(tx.counterpart_user_id),
    actorRole: tx.direction === 'gave' ? 'lender' : 'borrower',
    udharStatus: tx.status,
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
  const totalConfirmed = roundMoney(
    (allRepsRes.data || []).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
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
    `udhar_transactions?id=eq.${encodeURIComponent(txId)}&or=(user_id.eq.${encodeURIComponent(authUser.id)},counterpart_user_id.eq.${encodeURIComponent(authUser.id)})&limit=1`
  );
  if (!txRes.ok || !txRes.data || txRes.data.length === 0) {
    return { status: 404, body: { success: false, message: 'Transaction not found.' } };
  }
  const tx = txRes.data[0];

  const repsRes = await sbRest<any[]>(
    `udhar_repayments?link_id=eq.${encodeURIComponent(tx.link_id)}&status=eq.confirmed`
  );
  const confirmedPaid = roundMoney(
    (repsRes.data || []).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  );

  const { note: prevPlainNote, meta: prevMeta } = unpackStructuredNote(tx.notes);
  const editReason = (body.reason_for_edit || body.reason || body.edit_reason || '').trim();

  const validation = validateUdharEdit(
    {
      original_amount: parseFloat(tx.original_amount) || 0,
      paid_amount: confirmedPaid,
      status: tx.status,
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
    category: body.category !== undefined ? body.category : prevMeta.category,
    payment_method: body.payment_method !== undefined ? body.payment_method : prevMeta.payment_method,
    description: body.description !== undefined ? body.description : prevMeta.description,
    attachment_url: body.attachment_url !== undefined ? body.attachment_url : prevMeta.attachment_url,
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
      status: validation.nextStatus,
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

  const currentBal = roundMoney(parseFloat(tx.current_balance) || 0);
  if (tx.status === 'settled' || currentBal <= 0.01) {
    return { status: 400, body: { success: false, message: 'This transaction is already settled.' } };
  }
  if (tx.status === 'cancelled') {
    return { status: 400, body: { success: false, message: 'Cannot settle a cancelled transaction.' } };
  }

  const settleDate = body.settlement_date || body.date || new Date().toISOString().split('T')[0];
  const paymentMethod = (body.payment_method || 'UPI').trim();
  const notes = (body.notes || 'Settled in full').trim();
  const nowIso = new Date().toISOString();

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

  await sbRest(`udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}`, {
    method: 'PATCH',
    body: {
      current_balance: 0,
      paid_amount: parseFloat(tx.original_amount) || 0,
      status: 'settled',
      settled_at: nowIso,
      updated_at: nowIso,
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
    },
  };
}

export async function cancelUdharRest(authUser: AuthenticatedUser, txId: string) {
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
  message: 'Only the lender who gave the money can delete or cancel an Udhar transaction. Borrowers cannot delete transactions.',
  },
  };
  }

  const repsRes = await sbRest<any[]>(`udhar_repayments?link_id=eq.${encodeURIComponent(tx.link_id)}&select=status`);
  const repayments = (repsRes.ok && Array.isArray(repsRes.data)) ? repsRes.data : [];

  const guard = canCancelUdhar({
    status: tx.status,
    paid_amount: tx.paid_amount,
    repayments,
  });

  if (!guard.allowed) {
    return { status: 409, body: { success: false, message: guard.reason } };
  }

  await sbRest(`udhar_transactions?link_id=eq.${encodeURIComponent(tx.link_id)}`, {
    method: 'PATCH',
    body: { status: 'cancelled', current_balance: 0, updated_at: new Date().toISOString() },
  });

  if (tx.counterpart_user_id) {
    await createTargetedNotificationRest({
      targetUserId: tx.counterpart_user_id,
      actorUserId: authUser.id,
      title: `Udhar Cancelled by ${authUser.full_name}`,
      message: `${authUser.full_name} cancelled the Udhar of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')}.`,
      type: 'udhar_cancelled',
      relatedEntityId: tx.link_id,
    });
  }

  return {
    status: 200,
    body: { success: true, message: 'Udhar cancelled successfully across connected accounts.' },
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

  const [repsRes, histRes] = await Promise.all([
    sbRest<any[]>(`udhar_repayments?link_id=eq.${encodeURIComponent(tx.link_id)}&order=repayment_date.desc,created_at.desc`),
    sbRest<any[]>(`udhar_edit_history?link_id=eq.${encodeURIComponent(tx.link_id)}&order=created_at.desc`),
  ]);

  const reps = repsRes.data || [];
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
