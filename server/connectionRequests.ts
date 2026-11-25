import { query, isDatabaseAvailable } from './db';
import { checkRateLimit, logSecurityEvent } from './security';
import { createNotification } from './notificationService';
import {
  maskEmailForPrivacy,
  maskPhoneForPrivacy,
  parseQrPayload,
  normalizeSearchQuery,
} from '../src/lib/sharedUdharEngine';

/**
 * Consent-based Udhar account pairing.
 *
 * Two accounts are only connected after the target user explicitly accepts a
 * pending request. Nothing about the target's private profile is returned to
 * the requester before that acceptance.
 */

export const CONNECTION_CONSENT_VERSION = 'udhar-connection-consent-v1';
export const CONNECTION_CONSENT_TEXT =
  'I want to connect with this My Money Manager account for two-way Udhar. My display name and avatar will be shared with them for review.';

type ApiResult = { status: number; body: any };

interface AuthUserLike {
  id: string;
  full_name?: string | null;
  email?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeRelationship(value: any): string {
  const raw = String(value || 'Friend').trim();
  const allowed = ['Friend', 'Family', 'Roommate', 'Colleague', 'Business', 'Other'];
  return allowed.includes(raw) ? raw : 'Friend';
}

function normalizeSource(value: any): 'qr' | 'search' | 'manual' {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'qr') return 'qr';
  if (raw === 'manual') return 'manual';
  return 'search';
}

function pairingUnavailable(): ApiResult {
  return {
    status: 503,
    body: {
      success: false,
      code: 'PAIRING_UNAVAILABLE',
      message:
        'Account pairing is temporarily unavailable on this server. No data was changed. Please try again shortly.',
    },
  };
}

function isMissingTableError(err: any): boolean {
  const code = err?.code || '';
  const msg = String(err?.message || '');
  return (
    code === '42P01' ||
    /relation .*udhar_connection_requests.* does not exist/i.test(msg) ||
    /relation .*qr_pairing_tokens.* does not exist/i.test(msg)
  );
}

async function loadEligibleUser(userId: string) {
  const res = await query(
    `SELECT id, full_name, email, phone, avatar_url, status,
            COALESCE(deletion_status, 'none') AS deletion_status
     FROM public.app_users WHERE id = $1`,
    [userId]
  );
  return res.rows[0] || null;
}

async function getConnectionState(userA: string, userB: string) {
  const res = await query(
    `SELECT status FROM public.user_connections
     WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)`,
    [userA, userB]
  );
  const statuses = res.rows.map((r: any) => r.status);
  return {
    blocked: statuses.includes('blocked'),
    connected: statuses.includes('connected'),
  };
}

async function ensureActiveConnection(
  requesterId: string,
  targetId: string,
  relationshipType: string,
  acceptedAtIso: string
) {
  await query(
    `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
     VALUES ($1, $2, 'connected')
     ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
    [requesterId, targetId]
  );
  await query(
    `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
     VALUES ($1, $2, 'connected')
     ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
    [targetId, requesterId]
  ).catch(() => {});

  const requester = await loadEligibleUser(requesterId);
  const target = await loadEligibleUser(targetId);

  if (requester) {
    const requesterName = (requester.full_name || requester.email?.split('@')[0] || 'Friend').trim();
    await query(
      `INSERT INTO public.udhar_contacts
         (user_id, name, email, phone, photo_url, relationship_type, linked_user_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id, name) DO UPDATE
       SET linked_user_id = EXCLUDED.linked_user_id,
           email = COALESCE(EXCLUDED.email, public.udhar_contacts.email),
           phone = COALESCE(EXCLUDED.phone, public.udhar_contacts.phone),
           photo_url = COALESCE(EXCLUDED.photo_url, public.udhar_contacts.photo_url),
           updated_at = NOW()`,
      [
        targetId,
        requesterName,
        requester.email,
        requester.phone,
        requester.avatar_url,
        relationshipType,
        requesterId,
      ]
    ).catch((e) => console.warn('[Connection] reciprocal contact upsert notice:', e?.message));
  }

  if (target) {
    const targetName = (target.full_name || target.email?.split('@')[0] || 'Friend').trim();
    const existing = await query(
      `SELECT id FROM public.udhar_contacts WHERE user_id = $1 AND linked_user_id = $2 LIMIT 1`,
      [requesterId, targetId]
    );
    if (existing.rows.length > 0) {
      await query(
        `UPDATE public.udhar_contacts
         SET name = $1, email = COALESCE($2, email), phone = COALESCE($3, phone),
             photo_url = COALESCE($4, photo_url), relationship_type = $5, updated_at = NOW()
         WHERE id = $6`,
        [targetName, target.email, target.phone, target.avatar_url, relationshipType, existing.rows[0].id]
      );
    } else {
      await query(
        `INSERT INTO public.udhar_contacts
           (user_id, name, email, phone, photo_url, relationship_type, linked_user_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id, name) DO UPDATE
         SET linked_user_id = EXCLUDED.linked_user_id, updated_at = NOW()`,
        [requesterId, targetName, target.email, target.phone, target.avatar_url, relationshipType, targetId]
      ).catch((e) => console.warn('[Connection] contact upsert notice:', e?.message));
    }
  }

  await logSecurityEvent('UDHAR_CONNECTION_ACTIVATED', {
    userId: requesterId,
    details: { targetUserId: targetId, acceptedAt: acceptedAtIso, relationshipType },
  }).catch(() => {});
}

async function acceptRequestRow(row: any): Promise<ApiResult> {
  const respondedAt = new Date().toISOString();
  await query(
    `UPDATE public.udhar_connection_requests
     SET status = 'accepted', responded_at = $1, consent_version = $2
     WHERE id = $3`,
    [respondedAt, CONNECTION_CONSENT_VERSION, row.id]
  );
  await ensureActiveConnection(
    row.requester_user_id,
    row.target_user_id,
    normalizeRelationship(row.relationship_type),
    respondedAt
  );

  await createNotification({
    userId: row.requester_user_id,
    title: 'Udhar connection accepted',
    message: `${row.target_name || 'Your contact'} accepted your Udhar connection request. You can now record shared Udhar together.`,
    category: 'udhar',
    type: 'success',
    deepLink: '#people',
    dedupeKey: `udhar-conn-accepted:${row.id}`,
  }).catch(() => {});

  return {
    status: 200,
    body: {
      success: true,
      status: 'connected',
      message: `You are now connected with ${row.requester_name || 'this user'} for two-way Udhar.`,
      connection: {
        id: row.requester_user_id,
        displayName: row.requester_name || 'My Money User',
        emailMasked: maskEmailForPrivacy(row.requester_email),
        phoneMasked: maskPhoneForPrivacy(row.requester_phone),
        avatarUrl: row.requester_avatar || null,
      },
    },
  };
}

/**
 * Create (or deduplicate) a pending connection request for a target account.
 */
export async function submitConnectionRequest(
  authUser: AuthUserLike,
  rawTargetId: string,
  rawRelationshipType: string,
  rawSource: string
): Promise<ApiResult> {
  const targetUserId = String(rawTargetId || '').trim();
  const relationshipType = normalizeRelationship(rawRelationshipType);
  const source = normalizeSource(rawSource);

  if (!isDatabaseAvailable()) return pairingUnavailable();

  if (!targetUserId || !UUID_RE.test(targetUserId)) {
    return { status: 400, body: { success: false, code: 'INVALID_TARGET', message: 'A valid user account is required.' } };
  }
  if (targetUserId === authUser.id) {
    return {
      status: 400,
      body: { success: false, code: 'SELF_CONNECTION', message: 'You cannot connect with your own account.' },
    };
  }

  const rate = checkRateLimit(`udhar_conn_req:${authUser.id}`, 20, 60 * 60 * 1000);
  if (!rate.allowed) {
    return {
      status: 429,
      body: {
        success: false,
        code: 'RATE_LIMITED',
        message: 'Too many connection requests. Please try again later.',
      },
    };
  }

  const target = await loadEligibleUser(targetUserId);
  if (!target) {
    return {
      status: 404,
      body: { success: false, code: 'NOT_FOUND', message: 'That account could not be found.' },
    };
  }
  if (target.status !== 'active' || target.deletion_status !== 'none') {
    return {
      status: 403,
      body: {
        success: false,
        code: 'ACCOUNT_UNAVAILABLE',
        message: 'This account is currently unavailable for new connections.',
      },
    };
  }

  const state = await getConnectionState(authUser.id, targetUserId);
  if (state.blocked) {
    return {
      status: 403,
      body: { success: false, code: 'BLOCKED', message: 'A connection cannot be made between these accounts.' },
    };
  }
  if (state.connected) {
    return {
      status: 200,
      body: {
        success: true,
        status: 'connected',
        alreadyConnected: true,
        message: 'You are already connected with this person.',
        connection: {
          id: target.id,
          displayName: target.full_name || target.email?.split('@')[0] || 'My Money User',
          emailMasked: maskEmailForPrivacy(target.email),
          phoneMasked: maskPhoneForPrivacy(target.phone),
          avatarUrl: target.avatar_url || null,
        },
      },
    };
  }

  let pendingRows: any[] = [];
  try {
    const pendingRes = await query(
      `SELECT r.*, ru.full_name AS requester_name, ru.email AS requester_email,
              ru.phone AS requester_phone, ru.avatar_url AS requester_avatar,
              tu.full_name AS target_name
       FROM public.udhar_connection_requests r
       JOIN public.app_users ru ON ru.id = r.requester_user_id
       JOIN public.app_users tu ON tu.id = r.target_user_id
       WHERE r.status = 'pending' AND r.expires_at > NOW()
         AND (
           (r.requester_user_id = $1 AND r.target_user_id = $2) OR
           (r.requester_user_id = $2 AND r.target_user_id = $1)
         )
       ORDER BY r.created_at DESC`,
      [authUser.id, targetUserId]
    );
    pendingRows = pendingRes.rows;
  } catch (err) {
    if (isMissingTableError(err)) return pairingUnavailable();
    throw err;
  }

  // Mutual pending requests mean both users already consented: connect directly.
  const incoming = pendingRows.find((r) => r.target_user_id === authUser.id);
  if (incoming) {
    return acceptRequestRow(incoming);
  }

  const outgoing = pendingRows.find((r) => r.requester_user_id === authUser.id);
  if (outgoing) {
    return {
      status: 200,
      body: {
        success: true,
        status: 'pending',
        deduplicated: true,
        requestId: outgoing.id,
        message: 'Your connection request is already pending approval.',
        target: {
          id: targetUserId,
          displayName: target.full_name || target.email?.split('@')[0] || 'My Money User',
          avatarUrl: target.avatar_url || null,
        },
      },
    };
  }

  let inserted: any;
  try {
    const insertRes = await query(
      `INSERT INTO public.udhar_connection_requests
         (requester_user_id, target_user_id, relationship_type, source, status,
          consent_text, consent_version, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, NOW() + INTERVAL '14 days')
       RETURNING *`,
      [authUser.id, targetUserId, relationshipType, source, CONNECTION_CONSENT_TEXT, CONNECTION_CONSENT_VERSION]
    );
    inserted = insertRes.rows[0];
  } catch (err: any) {
    if (err?.code === '23505') {
      return {
        status: 200,
        body: {
          success: true,
          status: 'pending',
          deduplicated: true,
          message: 'Your connection request is already pending approval.',
        },
      };
    }
    if (isMissingTableError(err)) return pairingUnavailable();
    throw err;
  }

  const requesterName =
    authUser.full_name || authUser.email?.split('@')[0] || 'A My Money Manager user';

  await createNotification({
    userId: targetUserId,
    title: 'New Udhar connection request',
    message: `${requesterName} wants to connect with you on My Money Manager Udhar.`,
    category: 'udhar',
    type: 'info',
    relatedEntityType: 'udhar_connection_request',
    relatedEntityId: inserted?.id,
    deepLink: '#people',
    dedupeKey: `udhar-conn-req:${inserted?.id || targetUserId}`,
  }).catch(() => {});

  await logSecurityEvent('UDHAR_CONNECTION_REQUESTED', {
    userId: authUser.id,
    details: { targetUserId, source, requestId: inserted?.id },
  }).catch(() => {});

  return {
    status: 201,
    body: {
      success: true,
      status: 'pending',
      requestId: inserted?.id,
      message: `Connection request sent. ${target.full_name || 'This user'} will see it in their notifications and must approve it before any profile details are shared.`,
      target: {
        id: targetUserId,
        displayName: target.full_name || target.email?.split('@')[0] || 'My Money User',
        avatarUrl: target.avatar_url || null,
      },
    },
  };
}

/**
 * List the signed-in user's pending incoming and outgoing requests.
 * Only masked profile data is returned before acceptance.
 */
export async function listConnectionRequests(authUser: AuthUserLike): Promise<ApiResult> {
  if (!isDatabaseAvailable()) return pairingUnavailable();

  try {
    const res = await query(
      `SELECT r.id, r.status, r.relationship_type, r.source, r.created_at, r.expires_at,
              r.requester_user_id, r.target_user_id,
              ru.full_name AS requester_name, ru.email AS requester_email,
              ru.phone AS requester_phone, ru.avatar_url AS requester_avatar,
              tu.full_name AS target_name, tu.email AS target_email,
              tu.phone AS target_phone, tu.avatar_url AS target_avatar
       FROM public.udhar_connection_requests r
       JOIN public.app_users ru ON ru.id = r.requester_user_id
       JOIN public.app_users tu ON tu.id = r.target_user_id
       WHERE (r.requester_user_id = $1 OR r.target_user_id = $1)
         AND r.status = 'pending'
         AND r.expires_at > NOW()
       ORDER BY r.created_at DESC
       LIMIT 50`,
      [authUser.id]
    );

    const incoming: any[] = [];
    const outgoing: any[] = [];

    for (const row of res.rows) {
      const isIncoming = row.target_user_id === authUser.id;
      const otherName = isIncoming ? row.requester_name : row.target_name;
      const otherEmail = isIncoming ? row.requester_email : row.target_email;
      const otherPhone = isIncoming ? row.requester_phone : row.target_phone;
      const otherAvatar = isIncoming ? row.requester_avatar : row.target_avatar;

      const item = {
        id: row.id,
        direction: isIncoming ? 'incoming' : 'outgoing',
        status: row.status,
        relationshipType: row.relationship_type,
        source: row.source,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        displayName: otherName || otherEmail?.split('@')[0] || 'My Money User',
        emailMasked: maskEmailForPrivacy(otherEmail),
        phoneMasked: maskPhoneForPrivacy(otherPhone),
        avatarUrl: otherAvatar || null,
      };

      if (isIncoming) incoming.push(item);
      else outgoing.push(item);
    }

    return { status: 200, body: { success: true, incoming, outgoing } };
  } catch (err) {
    if (isMissingTableError(err)) return { status: 200, body: { success: true, incoming: [], outgoing: [] } };
    throw err;
  }
}

/**
 * Accept or reject an incoming request. Only the target user may respond.
 */
export async function respondToConnectionRequest(
  authUser: AuthUserLike,
  requestId: string,
  action: 'accept' | 'reject'
): Promise<ApiResult> {
  if (!isDatabaseAvailable()) return pairingUnavailable();
  if (!requestId || !UUID_RE.test(requestId)) {
    return { status: 400, body: { success: false, code: 'INVALID_REQUEST', message: 'Invalid request reference.' } };
  }

  const rate = checkRateLimit(`udhar_conn_resp:${authUser.id}`, 60, 60 * 1000);
  if (!rate.allowed) {
    return {
      status: 429,
      body: { success: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a moment.' },
    };
  }

  let row: any;
  try {
    const res = await query(
      `SELECT r.*, ru.full_name AS requester_name, ru.email AS requester_email,
              ru.phone AS requester_phone, ru.avatar_url AS requester_avatar,
              tu.full_name AS target_name
       FROM public.udhar_connection_requests r
       JOIN public.app_users ru ON ru.id = r.requester_user_id
       JOIN public.app_users tu ON tu.id = r.target_user_id
       WHERE r.id = $1 AND r.target_user_id = $2
       LIMIT 1`,
      [requestId, authUser.id]
    );
    row = res.rows[0];
  } catch (err) {
    if (isMissingTableError(err)) return pairingUnavailable();
    throw err;
  }

  if (!row) {
    return {
      status: 404,
      body: { success: false, code: 'NOT_FOUND', message: 'This connection request no longer exists.' },
    };
  }
  if (row.status !== 'pending') {
    return {
      status: 409,
      body: {
        success: false,
        code: 'ALREADY_HANDLED',
        message: `This request was already ${row.status}.`,
      },
    };
  }
  if (new Date(row.expires_at) <= new Date()) {
    await query(`UPDATE public.udhar_connection_requests SET status = 'expired' WHERE id = $1`, [row.id]).catch(
      () => {}
    );
    return {
      status: 410,
      body: {
        success: false,
        code: 'REQUEST_EXPIRED',
        message: 'This connection request has expired. Ask the person to send a new request.',
      },
    };
  }

  const state = await getConnectionState(authUser.id, row.requester_user_id);
  if (state.blocked) {
    return {
      status: 403,
      body: { success: false, code: 'BLOCKED', message: 'This connection cannot be made.' },
    };
  }

  if (action === 'accept') {
    return acceptRequestRow(row);
  }

  await query(
    `UPDATE public.udhar_connection_requests
     SET status = 'rejected', responded_at = NOW()
     WHERE id = $1`,
    [row.id]
  );

  await createNotification({
    userId: row.requester_user_id,
    title: 'Udhar connection request declined',
    message: `${row.target_name || 'The user'} declined your Udhar connection request. No profile information was shared.`,
    category: 'udhar',
    type: 'info',
    dedupeKey: `udhar-conn-rejected:${row.id}`,
  }).catch(() => {});

  await logSecurityEvent('UDHAR_CONNECTION_REJECTED', {
    userId: authUser.id,
    details: { requesterId: row.requester_user_id, requestId: row.id },
  }).catch(() => {});

  return {
    status: 200,
    body: { success: true, status: 'rejected', message: 'Connection request declined.' },
  };
}

/**
 * Disconnect / unpair. Ledger history is preserved; only the connection link is removed.
 */
export async function disconnectConnection(
  authUser: AuthUserLike,
  rawTargetId: string
): Promise<ApiResult> {
  const targetUserId = String(rawTargetId || '').trim();
  if (!isDatabaseAvailable()) return pairingUnavailable();
  if (!targetUserId || !UUID_RE.test(targetUserId)) {
    return { status: 400, body: { success: false, code: 'INVALID_TARGET', message: 'A valid user account is required.' } };
  }
  if (targetUserId === authUser.id) {
    return { status: 400, body: { success: false, code: 'SELF_CONNECTION', message: 'Invalid connection target.' } };
  }

  const target = await loadEligibleUser(targetUserId);
  const targetName = target?.full_name || 'This user';

  await query(
    `DELETE FROM public.user_connections
     WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)`,
    [authUser.id, targetUserId]
  );

  // Unlink contacts but keep both accounts' Udhar history intact.
  await query(
    `UPDATE public.udhar_contacts SET linked_user_id = NULL, updated_at = NOW()
     WHERE user_id = $1 AND linked_user_id = $2`,
    [authUser.id, targetUserId]
  ).catch(() => {});

  await query(
    `UPDATE public.udhar_connection_requests
     SET status = 'cancelled', responded_at = NOW()
     WHERE status IN ('pending', 'accepted')
       AND ((requester_user_id = $1 AND target_user_id = $2) OR (requester_user_id = $2 AND target_user_id = $1))`,
    [authUser.id, targetUserId]
  ).catch(() => {});

  await createNotification({
    userId: targetUserId,
    title: 'Udhar connection removed',
    message: `${authUser.full_name || 'A My Money Manager user'} disconnected the Udhar pairing. Existing ledger records were kept.`,
    category: 'udhar',
    type: 'info',
    dedupeKey: `udhar-conn-disconnect:${authUser.id}:${Date.now()}`,
  }).catch(() => {});

  await logSecurityEvent('UDHAR_CONNECTION_DISCONNECTED', {
    userId: authUser.id,
    details: { targetUserId },
  }).catch(() => {});

  return {
    status: 200,
    body: {
      success: true,
      status: 'disconnected',
      message: `Disconnected from ${targetName}. Your Udhar records were preserved.`,
    },
  };
}

/**
 * Validate a pairing QR payload / pairing code and return only the
 * information permitted while a connection is still pending.
 */
export async function resolvePairingTarget(authUser: AuthUserLike, body: any): Promise<ApiResult> {
  if (!isDatabaseAvailable()) return pairingUnavailable();

  const rate = checkRateLimit(`udhar_qr_resolve:${authUser.id}`, 30, 60 * 1000);
  if (!rate.allowed) {
    return {
      status: 429,
      body: {
        success: false,
        code: 'RATE_LIMITED',
        message: 'Too many QR verification attempts. Please wait a minute and try again.',
      },
    };
  }

  let targetToken = String(body?.pairingToken || '').trim();
  let targetCode = String(body?.pairingCode || '').trim().toUpperCase();
  const rawData = String(body?.qrData || '').trim();

  if (rawData) {
    const parsed = parseQrPayload(rawData);
    if (!parsed.valid) {
      return {
        status: 400,
        body: {
          success: false,
          code: 'INVALID_QR',
          message:
            parsed.error ||
            'This QR code is not a valid My Money Manager pairing QR. Ask your friend to open My QR and share their current code.',
        },
      };
    }
    if (parsed.token) targetToken = parsed.token;
    if (parsed.code) targetCode = parsed.code;
  }

  // Accept bare codes, pairing links and full JSON payloads in one field.
  if (!rawData && (targetCode || targetToken) && !targetCode.startsWith('MM-') && !/^[a-f0-9]{32,}$/i.test(targetToken)) {
    const parsed = parseQrPayload(targetCode || targetToken);
    if (parsed.valid) {
      if (parsed.token) targetToken = parsed.token;
      if (parsed.code) targetCode = parsed.code;
    }
  }

  if (!normalizeSearchQuery(targetCode) && !targetToken) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'INVALID_QR',
        message: 'Enter a pairing code such as MM-AB12CD, or scan the QR again.',
      },
    };
  }

  if (targetCode && !/^MM-[A-Z0-9]{4,12}$/.test(targetCode)) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'INVALID_CODE_FORMAT',
        message: 'Pairing codes look like MM-AB12CD. Check the code and try again.',
      },
    };
  }

  let record: any;
  try {
    const res = await query(
      `SELECT t.id, t.user_id, t.pairing_token, t.pairing_code, t.expires_at, t.used,
              u.full_name, u.email, u.phone, u.avatar_url, u.status,
              COALESCE(u.deletion_status, 'none') AS deletion_status
       FROM public.qr_pairing_tokens t
       JOIN public.app_users u ON t.user_id = u.id
       WHERE ($1 <> '' AND t.pairing_token = $1) OR ($2 <> '' AND UPPER(t.pairing_code) = $2)
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [targetToken, targetCode]
    );
    record = res.rows[0];
  } catch (err) {
    if (isMissingTableError(err)) return pairingUnavailable();
    throw err;
  }

  if (!record) {
    return {
      status: 404,
      body: {
        success: false,
        code: 'NOT_FOUND',
        message:
          'This pairing code is not linked to an active My Money Manager account. Ask your friend to open My QR and share their current code.',
      },
    };
  }

  if (record.used) {
    return {
      status: 410,
      body: {
        success: false,
        code: 'QR_REVOKED',
        message: 'This QR code was replaced by a newer one. Ask your friend to show their latest My QR.',
      },
    };
  }
  if (new Date(record.expires_at) <= new Date()) {
    return {
      status: 410,
      body: {
        success: false,
        code: 'QR_EXPIRED',
        message: 'This QR code has expired. Ask your friend to tap "Reset QR" to generate a new code.',
      },
    };
  }
  if (record.status !== 'active' || record.deletion_status !== 'none') {
    return {
      status: 403,
      body: {
        success: false,
        code: 'ACCOUNT_UNAVAILABLE',
        message: 'This account is currently deactivated or unavailable.',
      },
    };
  }
  if (record.user_id === authUser.id) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'SELF_CONNECTION',
        message: 'This is your own QR code. You cannot connect with yourself.',
      },
    };
  }

  const state = await getConnectionState(authUser.id, record.user_id);
  if (state.blocked) {
    return {
      status: 403,
      body: { success: false, code: 'BLOCKED', message: 'You cannot connect with this account.' },
    };
  }

  const displayName = record.full_name || record.email?.split('@')[0] || 'My Money User';

  return {
    status: 200,
    body: {
      success: true,
      status: state.connected ? 'connected' : 'pending',
      owner: {
        id: record.user_id,
        displayName,
        fullName: displayName,
        emailMasked: maskEmailForPrivacy(record.email),
        phoneMasked: maskPhoneForPrivacy(record.phone),
        avatarUrl: record.avatar_url || null,
        isVerified: true,
      },
      pairingToken: record.pairing_token,
      pairingCode: record.pairing_code,
      isAlreadyConnected: state.connected,
      consentVersion: CONNECTION_CONSENT_VERSION,
      consentText: CONNECTION_CONSENT_TEXT,
    },
  };
}

/** Short, server-validated profile summary for an accepted connection. */
export function buildConnectionSummary(target: any) {
  const displayName = target.full_name || target.email?.split('@')[0] || 'My Money User';
  return {
    id: target.id,
    displayName,
    fullName: displayName,
    emailMasked: maskEmailForPrivacy(target.email),
    phoneMasked: maskPhoneForPrivacy(target.phone),
    avatarUrl: target.avatar_url || null,
  };
}
