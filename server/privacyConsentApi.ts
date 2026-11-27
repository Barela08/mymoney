import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { authenticateRequest, type AuthenticatedUser } from './auth.js';
import { query, isDatabaseAvailable } from './db.js';
import { logSecurityEvent } from './security.js';
import {
  getPrivacyConsentsRest,
  recordPrivacyConsentRest,
  recordPrivacyConsentBatchRest,
} from './supabaseRestUdhar.js';
import { updateUserNotificationPreferences } from './notificationService.js';
import {
  OPTIONAL_CONSENT_CATEGORIES,
  PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_LAST_UPDATED,
  createEmptyOptionalChoices,
  isValidOptionalConsentCategory,
  type OptionalConsentCategory,
  type OptionalConsentChoices,
  type ConsentStatusValue,
} from '../src/lib/privacyConsent.js';

const LEGACY_ALLOWED_PURPOSES = new Set<string>([
  ...OPTIONAL_CONSENT_CATEGORIES,
  'optional_feedback_support',
]);

const ALLOWED_SOURCES = new Set<string>([
  'privacy_choices_modal',
  'settings_manage_consent',
  'ai_assistant_prompt',
  'receipt_scanner_prompt',
  'udhar_sharing_prompt',
  'upi_qr_setup',
  'notification_preferences',
  'help_support',
]);

// Server-side in-memory idempotency guard for rapid repeated clicks (5 min TTL)
const recentIdempotencyCache = new Map<string, { expiresAt: number; payload: any }>();

function pruneIdempotencyCache() {
  const now = Date.now();
  for (const [k, v] of recentIdempotencyCache.entries()) {
    if (v.expiresAt <= now) recentIdempotencyCache.delete(k);
  }
}

function sendJson(res: ServerResponse, status: number, payload: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function parseJsonBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<any> {
  const preParsed = (req as any).body;
  if (preParsed !== undefined && preParsed !== null) {
    if (typeof preParsed === 'object') return preParsed;
    if (typeof preParsed === 'string') {
      try {
        return JSON.parse(preParsed);
      } catch {
        throw new Error('INVALID_JSON');
      }
    }
  }
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeSource(raw: unknown): string {
  const s = String(raw || '').trim();
  return ALLOWED_SOURCES.has(s) ? s : 'privacy_choices_modal';
}

function sanitizeAuditMetadata(raw: unknown, language?: string): Record<string, string | boolean | number> {
  const out: Record<string, string | boolean | number> = {};
  if (language && ['en', 'hi', 'mr'].includes(language)) {
    out.language = language;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.via_select_all === 'boolean') out.via_select_all = obj.via_select_all;
    if (typeof obj.via_withdraw_all === 'boolean') out.via_withdraw_all = obj.via_withdraw_all;
    if (typeof obj.batch_id === 'string' && obj.batch_id.length <= 64) {
      out.batch_id = obj.batch_id.replace(/[^a-zA-Z0-9_-]/g, '');
    }
    if (typeof obj.interface_version === 'string' && obj.interface_version.length <= 32) {
      out.interface_version = obj.interface_version.replace(/[^a-zA-Z0-9._-]/g, '');
    }
  }
  return out;
}

function sanitizeIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 96);
  return cleaned.length >= 6 ? cleaned : null;
}

export function buildConsentSnapshotFromHistory(rows: any[]): {
  hasSavedChoices: boolean;
  consents: Record<string, any>;
  choices: OptionalConsentChoices;
  lastUpdatedAt: string | null;
} {
  const latestByCategory: Record<string, any> = {};
  const choices = createEmptyOptionalChoices();
  let hasOptionalHistory = false;
  let lastUpdatedAt: string | null = null;

  for (const row of rows) {
    const purpose = String(row.purpose || '').trim();
    if (!purpose) continue;
    const effectiveStatus = (row.consent_status || row.status || 'not_granted') as ConsentStatusValue;
    const createdAt = row.created_at || row.updated_at || null;

    if (!latestByCategory[purpose]) {
      latestByCategory[purpose] = {
        purpose,
        category: purpose,
        status: effectiveStatus,
        consent_status: effectiveStatus,
        granted: effectiveStatus === 'granted',
        policyVersion: row.policy_version || PRIVACY_POLICY_VERSION,
        grantedAt: row.granted_at || (effectiveStatus === 'granted' ? createdAt : null),
        withdrawnAt: row.withdrawn_at || (effectiveStatus === 'withdrawn' ? createdAt : null),
        updatedAt: createdAt,
        source: row.source || null,
      };

      if (isValidOptionalConsentCategory(purpose)) {
        hasOptionalHistory = true;
        choices[purpose] = effectiveStatus === 'granted';
        if (createdAt && (!lastUpdatedAt || createdAt > lastUpdatedAt)) {
          lastUpdatedAt = createdAt;
        }
      }
    }
  }

  return {
    hasSavedChoices: hasOptionalHistory,
    consents: latestByCategory,
    choices,
    lastUpdatedAt,
  };
}

/**
 * Inserts one append-only consent record into PostgreSQL, gracefully handling
 * both upgraded and pre-migration schemas without losing history.
 */
async function insertConsentRowPg(params: {
  authUser: AuthenticatedUser;
  purpose: string;
  status: 'granted' | 'withdrawn';
  policyVersion: string;
  wording: string;
  source: string;
  auditMetadata: Record<string, string | boolean | number>;
  idempotencyKey: string | null;
  clientIp: string;
  userAgent: string;
}) {
  const {
    authUser,
    purpose,
    status,
    policyVersion,
    wording,
    source,
    auditMetadata,
    idempotencyKey,
    clientIp,
    userAgent,
  } = params;

  const grantedAt = status === 'granted' ? new Date().toISOString() : null;
  const withdrawnAt = status === 'withdrawn' ? new Date().toISOString() : null;

  try {
    // Check idempotency key first so double-clicks never create duplicate rows
    if (idempotencyKey) {
      const existing = await query(
        `SELECT * FROM public.user_consents
         WHERE user_id = $1 AND purpose = $2 AND idempotency_key = $3
         LIMIT 1`,
        [authUser.id, purpose, idempotencyKey]
      );
      if (existing.rows.length > 0) {
        return { row: existing.rows[0], deduplicated: true };
      }
    }

    const ins = await query(
      `INSERT INTO public.user_consents (
         user_id, user_email, purpose, status, consent_status, action,
         policy_version, consent_wording, granted_at, withdrawn_at,
         source, audit_metadata, idempotency_key, ip_address, user_agent,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $4, $4,
         $5, $6, $7, $8,
         $9, $10::jsonb, $11, $12, $13,
         NOW(), NOW()
       )
       RETURNING *`,
      [
        authUser.id,
        authUser.email,
        purpose,
        status,
        policyVersion,
        wording,
        grantedAt,
        withdrawnAt,
        source,
        JSON.stringify(auditMetadata),
        idempotencyKey,
        clientIp,
        userAgent,
      ]
    );
    return { row: ins.rows[0], deduplicated: false };
  } catch (err: any) {
    const msg = String(err?.message || '');
    // Backwards compatibility if optional audit columns haven't been migrated on DB yet
    if (msg.includes('column') && msg.includes('does not exist')) {
      const insLegacy = await query(
        `INSERT INTO public.user_consents (
           user_id, user_email, purpose, status, action,
           policy_version, consent_wording, ip_address, user_agent,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, NOW(), NOW())
         RETURNING *`,
        [authUser.id, authUser.email, purpose, status, policyVersion, wording, clientIp, userAgent]
      );
      return { row: insLegacy.rows[0], deduplicated: false };
    }
    throw err;
  }
}

async function fetchUserConsentsPg(userId: string) {
  try {
    const res = await query(
      `SELECT id, user_id, purpose, status, consent_status, action, policy_version,
              consent_wording, granted_at, withdrawn_at, source, audit_metadata,
              created_at, updated_at
       FROM public.user_consents
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [userId]
    );
    return res.rows;
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('column') && msg.includes('does not exist')) {
      const legacy = await query(
        `SELECT id, user_id, purpose, status, action, policy_version, consent_wording, created_at, updated_at
         FROM public.user_consents
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 200`,
        [userId]
      );
      return legacy.rows;
    }
    throw err;
  }
}

/**
 * Server-side check used by AI and sharing endpoints to verify whether an
 * authenticated user has an active ('granted') consent for a specific purpose.
 * Strictly defaults to FALSE if no active consent record exists.
 */
export async function hasServerUserConsent(
  authUser: AuthenticatedUser,
  purpose: OptionalConsentCategory
): Promise<boolean> {
  if (!authUser?.id || !isValidOptionalConsentCategory(purpose)) return false;

  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `SELECT status FROM public.user_consents
         WHERE user_id = $1 AND purpose = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [authUser.id, purpose]
      );
      if (res.rows.length > 0) {
        return res.rows[0].status === 'granted';
      }
      return false;
    } catch {
      // Fall through to Supabase REST lookup
    }
  }

  try {
    const restRes = await getPrivacyConsentsRest(authUser);
    if (restRes.status === 200 && restRes.body?.success) {
      const entry = restRes.body.consents?.[purpose];
      return entry?.status === 'granted';
    }
  } catch {
    // Fail closed — never infer consent on error
  }

  return false;
}

export async function handlePrivacyConsentApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  meta: { clientIp: string; userAgent: string }
): Promise<boolean> {
  if (
    pathname !== '/api/privacy/consents' &&
    pathname !== '/api/privacy/consents/batch' &&
    pathname !== '/api/privacy/consents/withdraw-all'
  ) {
    return false;
  }

  // Strict server-side authentication on every consent endpoint
  const authUser = await authenticateRequest(req);
  if (!authUser) {
    sendJson(res, 401, {
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Please sign in to view or update your privacy choices.',
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // 1. GET /api/privacy/consents — Strictly scoped to authUser.id
  // -------------------------------------------------------------------------
  if (pathname === '/api/privacy/consents' && method === 'GET') {
    if (isDatabaseAvailable()) {
      try {
        const rows = await fetchUserConsentsPg(authUser.id);
        const snapshot = buildConsentSnapshotFromHistory(rows);
        sendJson(res, 200, {
          success: true,
          userId: authUser.id,
          hasSavedChoices: snapshot.hasSavedChoices,
          consents: snapshot.consents,
          choices: snapshot.choices,
          history: rows,
          policyVersion: PRIVACY_POLICY_VERSION,
          policyLastUpdated: PRIVACY_POLICY_LAST_UPDATED,
          lastUpdatedAt: snapshot.lastUpdatedAt,
        });
        return true;
      } catch (err: any) {
        console.warn('[PrivacyConsent] PG fetch error, trying Supabase REST:', err?.message);
      }
    }

    const restRes = await getPrivacyConsentsRest(authUser);
    if (restRes.status !== 200 || !restRes.body?.success) {
      sendJson(res, restRes.status || 503, {
        success: false,
        code: 'STORAGE_UNAVAILABLE',
        message: restRes.body?.message || 'Unable to load saved privacy choices right now.',
      });
      return true;
    }

    const rows = Array.isArray(restRes.body.history) ? restRes.body.history : [];
    const snapshot = buildConsentSnapshotFromHistory(rows);
    sendJson(res, 200, {
      success: true,
      userId: authUser.id,
      hasSavedChoices: snapshot.hasSavedChoices,
      consents: snapshot.consents,
      choices: snapshot.choices,
      history: rows,
      policyVersion: PRIVACY_POLICY_VERSION,
      policyLastUpdated: PRIVACY_POLICY_LAST_UPDATED,
      lastUpdatedAt: snapshot.lastUpdatedAt,
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // 2. POST /api/privacy/consents — Single category grant or withdrawal
  // -------------------------------------------------------------------------
  if (pathname === '/api/privacy/consents' && method === 'POST') {
    let body: any;
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, { success: false, message: 'Invalid JSON request body.' });
      return true;
    }

    const purpose = String(body.category || body.purpose || '').trim();
    if (!purpose || !LEGACY_ALLOWED_PURPOSES.has(purpose)) {
      sendJson(res, 400, {
        success: false,
        code: 'INVALID_PURPOSE',
        message: 'Invalid or unsupported consent category. Essential processing is not an optional consent toggle.',
      });
      return true;
    }

    if (body.status !== 'granted' && body.status !== 'withdrawn') {
      sendJson(res, 400, {
        success: false,
        code: 'INVALID_STATUS',
        message: 'Consent status must be explicitly "granted" or "withdrawn".',
      });
      return true;
    }

    const status: 'granted' | 'withdrawn' = body.status;
    const policyVersion = String(body.policyVersion || PRIVACY_POLICY_VERSION).trim().slice(0, 80);
    const source = sanitizeSource(body.source);
    const language = typeof body.language === 'string' ? body.language.trim() : 'en';
    const auditMetadata = sanitizeAuditMetadata(body.auditMetadata, language);
    const idempotencyKey = sanitizeIdempotencyKey(body.idempotencyKey);
    const wording = String(
      body.wording ||
        `User explicitly ${status} optional consent for ${purpose} via ${source} (${policyVersion}).`
    )
      .trim()
      .slice(0, 500);

    // Server-side in-memory duplicate click guard
    pruneIdempotencyCache();
    const cacheKey = idempotencyKey ? `${authUser.id}:${purpose}:${idempotencyKey}` : null;
    if (cacheKey && recentIdempotencyCache.has(cacheKey)) {
      sendJson(res, 200, recentIdempotencyCache.get(cacheKey)!.payload);
      return true;
    }

    let savedRecord: any = null;
    let persisted = false;
    let lastError = 'Could not save consent preference to database.';

    if (isDatabaseAvailable()) {
      try {
        const result = await insertConsentRowPg({
          authUser,
          purpose,
          status,
          policyVersion,
          wording,
          source,
          auditMetadata,
          idempotencyKey,
          clientIp: meta.clientIp,
          userAgent: meta.userAgent,
        });
        savedRecord = result.row;
        persisted = true;
      } catch (err: any) {
        lastError = err?.message || lastError;
        console.warn('[PrivacyConsent] PG insert failed, trying Supabase REST:', lastError);
      }
    }

    if (!persisted) {
      const restRes = await recordPrivacyConsentRest(authUser, {
        category: purpose,
        status,
        wording,
        policyVersion,
        source,
        auditMetadata,
        idempotencyKey: idempotencyKey || undefined,
      });
      if (restRes.status === 200 && restRes.body?.success) {
        savedRecord = restRes.body.consent;
        persisted = true;
      } else {
        lastError = restRes.body?.message || lastError;
      }
    }

    if (!persisted) {
      sendJson(res, 503, {
        success: false,
        code: 'PERSISTENCE_FAILED',
        message: lastError,
      });
      return true;
    }

    // Keep notification preferences synchronized when marketing_updates changes
    if (purpose === 'marketing_updates') {
      updateUserNotificationPreferences(authUser.id, { notify_offers: status === 'granted' }).catch(() => {});
    }

    logSecurityEvent(status === 'granted' ? 'USER_GRANTED_CONSENT' : 'USER_WITHDREW_CONSENT', {
      userId: authUser.id,
      userEmail: authUser.email,
      details: { purpose, status, policyVersion, source },
    }).catch(() => {});

    const responsePayload = {
      success: true,
      category: purpose,
      purpose,
      status,
      consent_status: status,
      policyVersion,
      consent: savedRecord,
    };

    if (cacheKey) {
      recentIdempotencyCache.set(cacheKey, {
        expiresAt: Date.now() + 5 * 60 * 1000,
        payload: responsePayload,
      });
    }

    sendJson(res, 200, responsePayload);
    return true;
  }

  // -------------------------------------------------------------------------
  // 3. POST /api/privacy/consents/batch — Save My Choices (separate record per category)
  // -------------------------------------------------------------------------
  if (pathname === '/api/privacy/consents/batch' && method === 'POST') {
    let body: any;
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, { success: false, message: 'Invalid JSON request body.' });
      return true;
    }

    const rawEntries: Array<{ purpose: string; status: string }> = Array.isArray(body.entries)
      ? body.entries
      : body.choices && typeof body.choices === 'object'
      ? Object.entries(body.choices).map(([purpose, val]) => ({
          purpose,
          status: val === true ? 'granted' : 'withdrawn',
        }))
      : [];

    if (rawEntries.length === 0) {
      sendJson(res, 400, {
        success: false,
        code: 'EMPTY_CHOICES',
        message: 'At least one explicit optional consent category is required.',
      });
      return true;
    }

    // Strict allowlist validation: reject any invalid or essential category
    const validatedEntries: Array<{ purpose: OptionalConsentCategory; status: 'granted' | 'withdrawn' }> = [];
    const seenPurposes = new Set<string>();
    for (const item of rawEntries) {
      const purpose = String(item.purpose || '').trim();
      if (!isValidOptionalConsentCategory(purpose)) {
        sendJson(res, 400, {
          success: false,
          code: 'INVALID_PURPOSE',
          message: `Unsupported optional consent category: "${purpose}". Essential financial processing cannot be submitted as optional consent.`,
        });
        return true;
      }
      if (item.status !== 'granted' && item.status !== 'withdrawn') {
        sendJson(res, 400, {
          success: false,
          code: 'INVALID_STATUS',
          message: `Invalid status for "${purpose}". Expected "granted" or "withdrawn".`,
        });
        return true;
      }
      if (!seenPurposes.has(purpose)) {
        seenPurposes.add(purpose);
        validatedEntries.push({ purpose, status: item.status });
      }
    }

    const policyVersion = String(body.policyVersion || PRIVACY_POLICY_VERSION).trim().slice(0, 80);
    const source = sanitizeSource(body.source);
    const language = typeof body.language === 'string' ? body.language.trim() : 'en';
    const batchId =
      sanitizeIdempotencyKey(body.idempotencyKey) ||
      `batch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const auditMetadata = sanitizeAuditMetadata(
      { ...(body.auditMetadata || {}), batch_id: batchId },
      language
    );

    pruneIdempotencyCache();
    const batchCacheKey = `${authUser.id}:batch:${batchId}`;
    if (recentIdempotencyCache.has(batchCacheKey)) {
      sendJson(res, 200, recentIdempotencyCache.get(batchCacheKey)!.payload);
      return true;
    }

    let savedRecords: any[] = [];
    let persisted = false;
    let lastError = 'Could not save your privacy choices to Supabase. Please retry.';

    if (isDatabaseAvailable()) {
      try {
        for (const entry of validatedEntries) {
          const itemKey = `${batchId}:${entry.purpose}`;
          const wording = `User explicitly ${entry.status} optional consent for ${entry.purpose} via ${source} (${policyVersion}).`;
          const ins = await insertConsentRowPg({
            authUser,
            purpose: entry.purpose,
            status: entry.status,
            policyVersion,
            wording,
            source,
            auditMetadata,
            idempotencyKey: itemKey,
            clientIp: meta.clientIp,
            userAgent: meta.userAgent,
          });
          savedRecords.push(ins.row);
        }
        persisted = true;
      } catch (err: any) {
        lastError = err?.message || lastError;
        savedRecords = [];
        console.warn('[PrivacyConsent] Batch PG save failed, trying Supabase REST:', lastError);
      }
    }

    if (!persisted) {
      const restRes = await recordPrivacyConsentBatchRest(
        authUser,
        validatedEntries.map((entry) => ({
          purpose: entry.purpose,
          status: entry.status,
          policyVersion,
          source,
          auditMetadata,
          idempotencyKey: `${batchId}:${entry.purpose}`,
          wording: `User explicitly ${entry.status} optional consent for ${entry.purpose} via ${source} (${policyVersion}).`,
        }))
      );
      if (restRes.status === 200 && restRes.body?.success) {
        savedRecords = restRes.body.records || [];
        persisted = true;
      } else {
        lastError = restRes.body?.message || lastError;
      }
    }

    if (!persisted) {
      sendJson(res, 503, {
        success: false,
        code: 'PERSISTENCE_FAILED',
        message: lastError,
      });
      return true;
    }

    // Sync marketing_updates with notification preferences
    const marketingEntry = validatedEntries.find((e) => e.purpose === 'marketing_updates');
    if (marketingEntry) {
      updateUserNotificationPreferences(authUser.id, {
        notify_offers: marketingEntry.status === 'granted',
      }).catch(() => {});
    }

    logSecurityEvent('USER_SAVED_PRIVACY_CHOICES', {
      userId: authUser.id,
      userEmail: authUser.email,
      details: {
        source,
        policyVersion,
        granted: validatedEntries.filter((e) => e.status === 'granted').map((e) => e.purpose),
        withdrawn: validatedEntries.filter((e) => e.status === 'withdrawn').map((e) => e.purpose),
      },
    }).catch(() => {});

    // Fetch updated snapshot to return authoritative state
    let latestRows = savedRecords;
    if (isDatabaseAvailable()) {
      try {
        latestRows = await fetchUserConsentsPg(authUser.id);
      } catch {
        // keep savedRecords
      }
    } else {
      const refreshed = await getPrivacyConsentsRest(authUser);
      if (refreshed.status === 200 && Array.isArray(refreshed.body?.history)) {
        latestRows = refreshed.body.history;
      }
    }

    const snapshot = buildConsentSnapshotFromHistory(latestRows);
    const responsePayload = {
      success: true,
      message: 'Your privacy choices have been saved.',
      userId: authUser.id,
      savedCount: savedRecords.length,
      hasSavedChoices: true,
      consents: snapshot.consents,
      choices: snapshot.choices,
      history: latestRows,
      policyVersion,
      policyLastUpdated: PRIVACY_POLICY_LAST_UPDATED,
      lastUpdatedAt: snapshot.lastUpdatedAt || new Date().toISOString(),
    };

    recentIdempotencyCache.set(batchCacheKey, {
      expiresAt: Date.now() + 5 * 60 * 1000,
      payload: responsePayload,
    });

    sendJson(res, 200, responsePayload);
    return true;
  }

  // -------------------------------------------------------------------------
  // 4. POST /api/privacy/consents/withdraw-all — Withdraw all optional consents
  // -------------------------------------------------------------------------
  if (pathname === '/api/privacy/consents/withdraw-all' && method === 'POST') {
    let body: any = {};
    try {
      body = await parseJsonBody(req);
    } catch {
      body = {};
    }

    const policyVersion = String(body.policyVersion || PRIVACY_POLICY_VERSION).trim().slice(0, 80);
    const source = sanitizeSource(body.source || 'settings_manage_consent');
    const language = typeof body.language === 'string' ? body.language.trim() : 'en';
    const batchId =
      sanitizeIdempotencyKey(body.idempotencyKey) ||
      `withdraw_all_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const auditMetadata = sanitizeAuditMetadata(
      { ...(body.auditMetadata || {}), via_withdraw_all: true, batch_id: batchId },
      language
    );

    const entries = OPTIONAL_CONSENT_CATEGORIES.map((purpose) => ({
      purpose,
      status: 'withdrawn' as const,
      policyVersion,
      source,
      auditMetadata,
      idempotencyKey: `${batchId}:${purpose}`,
      wording: `User explicitly withdrew optional consent for ${purpose} via Withdraw All Optional (${policyVersion}). Core account and financial ledger preserved.`,
    }));

    let persisted = false;
    let lastError = 'Could not withdraw optional consents right now. Please retry.';

    if (isDatabaseAvailable()) {
      try {
        for (const entry of entries) {
          await insertConsentRowPg({
            authUser,
            purpose: entry.purpose,
            status: 'withdrawn',
            policyVersion: entry.policyVersion,
            wording: entry.wording,
            source: entry.source,
            auditMetadata: entry.auditMetadata,
            idempotencyKey: entry.idempotencyKey,
            clientIp: meta.clientIp,
            userAgent: meta.userAgent,
          });
        }
        persisted = true;
      } catch (err: any) {
        lastError = err?.message || lastError;
      }
    }

    if (!persisted) {
      const restRes = await recordPrivacyConsentBatchRest(authUser, entries);
      if (restRes.status === 200 && restRes.body?.success) {
        persisted = true;
      } else {
        lastError = restRes.body?.message || lastError;
      }
    }

    if (!persisted) {
      sendJson(res, 503, {
        success: false,
        code: 'PERSISTENCE_FAILED',
        message: lastError,
      });
      return true;
    }

    updateUserNotificationPreferences(authUser.id, { notify_offers: false }).catch(() => {});

    logSecurityEvent('USER_WITHDREW_ALL_OPTIONAL_CONSENTS', {
      userId: authUser.id,
      userEmail: authUser.email,
      details: { source, policyVersion },
    }).catch(() => {});

    let latestRows: any[] = [];
    if (isDatabaseAvailable()) {
      try {
        latestRows = await fetchUserConsentsPg(authUser.id);
      } catch {}
    } else {
      const refreshed = await getPrivacyConsentsRest(authUser);
      if (refreshed.status === 200 && Array.isArray(refreshed.body?.history)) {
        latestRows = refreshed.body.history;
      }
    }

    const snapshot = buildConsentSnapshotFromHistory(latestRows);
    sendJson(res, 200, {
      success: true,
      message: 'All optional consents have been withdrawn. Your core financial records remain intact.',
      userId: authUser.id,
      hasSavedChoices: true,
      consents: snapshot.consents,
      choices: createEmptyOptionalChoices(),
      history: latestRows,
      policyVersion,
      policyLastUpdated: PRIVACY_POLICY_LAST_UPDATED,
      lastUpdatedAt: snapshot.lastUpdatedAt || new Date().toISOString(),
    });
    return true;
  }

  return false;
}
