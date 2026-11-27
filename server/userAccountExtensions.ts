/**
 * User Account Extensions — UPI QR Profiles (DPDP Consent-Gated),
 * Three-Method Unified Auth (Firebase Google + WebAuthn Passkeys + Email),
 * and Mandatory First-Time Profile Completion.
 *
 * My Money Manager by HackifyPro
 *
 * Persistence Strategy:
 * - Primary: Dedicated PostgreSQL / Supabase tables (`user_upi_profiles`, `user_auth_identities`, `user_passkeys`)
 * - Seamless Resilience: If the remote Supabase REST instance has not yet executed the latest
 *   `RLS_POLICIES.sql` migration (`404 PGRST205`), stores user-isolated private records inside
 *   `app_users.custom_permissions` (strictly authenticated to `authUser.id` and NEVER exposed in
 *   `sanitizeUserOutput` or People Search).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { query, isDatabaseAvailable } from './db.js';
import {
  authenticateRequest,
  createSession,
  sanitizeUserOutput,
  SessionLimitError,
  type AuthenticatedUser,
} from './auth.js';
import { sendWelcomeEmail } from './email.js';
import {
  dispatchNewUserWelcomeNotification,
  recordAdminNotification,
} from './notificationService.js';
import {
  logSecurityEvent,
  normalizeEmail,
  validatePhone,
  checkRateLimitAsync,
  RATE_LIMITS,
} from './security.js';
import { recordPrivacyConsentRest, getPrivacyConsentsRest } from './supabaseRestUdhar.js';
import {
  UPI_CONSENT_PURPOSE,
  UPI_CONSENT_POLICY_VERSION,
  UPI_CONSENT_WORDING,
  validateUpiId,
  sanitizeUpiText,
  type UpiProfileRecord,
} from '../src/lib/upiQrUtils.js';
import {
  issueWebAuthnChallenge,
  consumeWebAuthnChallenge,
  extractCredentialFromAttestation,
  verifyPasskeyAssertion,
  resolveRpContext,
  bufferToBase64Url,
} from './webauthn.js';
import { verifyFirebaseIdToken } from './firebaseVerify.js';

function getSbConfig(): { url: string; key: string } {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'https://frgrfajnrzqwnevhlrio.supabase.co'
  ).replace(/\/+$/, '');
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    'sb_publishable_RHVRSE_Z4R1Qit3djpOfCA_L93zsRjg';
  return { url, key };
}

async function sbRest<T = any>(
  path: string,
  opts: { method?: string; body?: any; prefer?: string } = {}
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const { url, key } = getSbConfig();
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.prefer) headers['Prefer'] = opts.prefer;
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: null,
        error: typeof parsed === 'object' && parsed ? parsed.message || parsed.error || text : String(parsed || res.status),
      };
    }
    return { ok: true, status: res.status, data: parsed as T };
  } catch (err: any) {
    return { ok: false, status: 503, data: null, error: err?.message || 'Supabase network error' };
  }
}

function sendJson(res: ServerResponse, status: number, payload: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function setSessionCookie(res: ServerResponse, sessionToken: string, expiresAt: Date) {
  const isProd = process.env.NODE_ENV === 'production';
  const secureFlag = isProd ? '; Secure' : '';
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  res.setHeader(
    'Set-Cookie',
    `session_token=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`
  );
}

async function parseJsonBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<any> {
  const preParsed = (req as any).body;
  if (preParsed !== undefined && preParsed !== null) {
    if (typeof preParsed === 'object') return preParsed;
    if (typeof preParsed === 'string') return JSON.parse(preParsed);
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

// ============================================================================
// INTERNAL PRIVATE METADATA HELPERS (FALLBACK WHEN DEDICATED TABLES ARE UNMIGRATED)
// ============================================================================
async function getUserPrivateMeta(userId: string): Promise<Record<string, any>> {
  if (isDatabaseAvailable()) {
    try {
      const r = await query('SELECT custom_permissions FROM public.app_users WHERE id = $1', [userId]);
      const meta = r.rows[0]?.custom_permissions;
      if (meta && typeof meta === 'object' && !Array.isArray(meta)) return { ...meta };
    } catch {}
  }
  const rest = await sbRest<any[]>(`app_users?id=eq.${encodeURIComponent(userId)}&select=custom_permissions&limit=1`);
  const meta = rest.data?.[0]?.custom_permissions;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) return { ...meta };
  return {};
}

async function setUserPrivateMeta(userId: string, updater: (prev: Record<string, any>) => Record<string, any>): Promise<boolean> {
  const current = await getUserPrivateMeta(userId);
  const next = updater({ ...current });
  const nowIso = new Date().toISOString();

  if (isDatabaseAvailable()) {
    try {
      await query(
        'UPDATE public.app_users SET custom_permissions = $1::jsonb, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(next), userId]
      );
      return true;
    } catch {}
  }
  const res = await sbRest(`app_users?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: { custom_permissions: next, updated_at: nowIso },
  });
  return res.ok;
}

// ============================================================================
// 1. UPI PROFILE PERSISTENCE (USER-ONLY, DPDP CONSENT-GATED)
// ============================================================================
export async function getSavedUpiProfileForUser(userId: string): Promise<UpiProfileRecord | null> {
  // 1. Try dedicated PG table
  if (isDatabaseAvailable()) {
    try {
      const r = await query(
        `SELECT id, user_id, upi_id, payee_name, payment_note, created_at, updated_at
         FROM public.user_upi_profiles WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      if (r.rows[0]) {
        const row = r.rows[0];
        return {
          id: row.id,
          userId: row.user_id,
          upiId: row.upi_id,
          payeeName: row.payee_name || '',
          paymentNote: row.payment_note || '',
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      }
      return null;
    } catch {}
  }

  // 2. Try dedicated Supabase REST table
  const rest = await sbRest<any[]>(
    `user_upi_profiles?user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,upi_id,payee_name,payment_note,created_at,updated_at&limit=1`
  );
  if (rest.ok) {
    const row = rest.data?.[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      upiId: row.upi_id,
      payeeName: row.payee_name || '',
      paymentNote: row.payment_note || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // 3. Resilient fallback when remote Supabase hasn't migrated user_upi_profiles yet
  const meta = await getUserPrivateMeta(userId);
  const saved = meta.__upi_profile;
  if (saved && typeof saved === 'object' && saved.upiId) {
    return {
      id: saved.id || `upi_${userId.slice(0, 8)}`,
      userId,
      upiId: String(saved.upiId),
      payeeName: String(saved.payeeName || ''),
      paymentNote: String(saved.paymentNote || ''),
      createdAt: saved.createdAt || null,
      updatedAt: saved.updatedAt || null,
    };
  }
  return null;
}

async function upsertSavedUpiProfileForUser(
  userId: string,
  payload: { upiId: string; payeeName: string; paymentNote: string }
): Promise<UpiProfileRecord> {
  const nowIso = new Date().toISOString();

  // 1. Primary PG table
  if (isDatabaseAvailable()) {
    try {
      const r = await query(
        `INSERT INTO public.user_upi_profiles (user_id, upi_id, payee_name, payment_note, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET upi_id = EXCLUDED.upi_id,
               payee_name = EXCLUDED.payee_name,
               payment_note = EXCLUDED.payment_note,
               updated_at = NOW()
         RETURNING id, user_id, upi_id, payee_name, payment_note, created_at, updated_at`,
        [userId, payload.upiId, payload.payeeName || null, payload.paymentNote || null]
      );
      if (r.rows[0]) {
        const row = r.rows[0];
        return {
          id: row.id,
          userId: row.user_id,
          upiId: row.upi_id,
          payeeName: row.payee_name || '',
          paymentNote: row.payment_note || '',
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      }
    } catch {}
  }

  // 2. Primary Supabase REST table
  const rest = await sbRest<any[]>('user_upi_profiles?on_conflict=user_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      user_id: userId,
      upi_id: payload.upiId,
      payee_name: payload.payeeName || null,
      payment_note: payload.paymentNote || null,
      updated_at: nowIso,
    },
  });
  if (rest.ok && rest.data?.[0]) {
    const row = rest.data[0];
    return {
      id: row.id,
      userId: row.user_id,
      upiId: row.upi_id,
      payeeName: row.payee_name || '',
      paymentNote: row.payment_note || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // 3. Fallback when remote user_upi_profiles table is not yet migrated
  let savedRecord: UpiProfileRecord = {
    id: crypto.randomUUID(),
    userId,
    upiId: payload.upiId,
    payeeName: payload.payeeName,
    paymentNote: payload.paymentNote,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await setUserPrivateMeta(userId, (prev) => {
    const existing = prev.__upi_profile;
    savedRecord = {
      id: existing?.id || crypto.randomUUID(),
      userId,
      upiId: payload.upiId,
      payeeName: payload.payeeName,
      paymentNote: payload.paymentNote,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    return { ...prev, __upi_profile: savedRecord };
  });
  return savedRecord;
}

export async function clearSavedUpiProfileForUser(userId: string): Promise<void> {
  if (isDatabaseAvailable()) {
    try {
      await query('DELETE FROM public.user_upi_profiles WHERE user_id = $1', [userId]);
    } catch {}
  }
  await sbRest(`user_upi_profiles?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await setUserPrivateMeta(userId, (prev) => {
    const next = { ...prev };
    delete next.__upi_profile;
    return next;
  }).catch(() => {});
}

async function recordUpiConsentEvent(
  authUser: AuthenticatedUser,
  status: 'granted' | 'withdrawn',
  source: string,
  clientIp: string,
  userAgent: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (isDatabaseAvailable()) {
    try {
      await query(
        `INSERT INTO public.user_consents (
          user_id, user_email, purpose, status, consent_status, action,
          policy_version, consent_wording, granted_at, withdrawn_at, source, audit_metadata, ip_address, user_agent
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
        [
          authUser.id,
          authUser.email,
          UPI_CONSENT_PURPOSE,
          status,
          status,
          status,
          UPI_CONSENT_POLICY_VERSION,
          UPI_CONSENT_WORDING,
          status === 'granted' ? nowIso : null,
          status === 'withdrawn' ? nowIso : null,
          source,
          JSON.stringify({ feature: 'upi_qr_storage' }),
          clientIp,
          userAgent,
        ]
      );
      return;
    } catch {}
  }

  await recordPrivacyConsentRest(authUser, {
    category: UPI_CONSENT_PURPOSE,
    status,
    wording: UPI_CONSENT_WORDING,
    policyVersion: UPI_CONSENT_POLICY_VERSION,
    source,
    auditMetadata: { feature: 'upi_qr_storage' },
  }).catch(() => {});
}

interface UpiConsentInfo {
  status: 'granted' | 'withdrawn' | 'not_granted';
  policyVersion: string | null;
}

async function getLatestUpiConsentInfo(authUser: AuthenticatedUser): Promise<UpiConsentInfo> {
  if (isDatabaseAvailable()) {
    try {
      const r = await query(
        `SELECT COALESCE(consent_status, status) AS st, policy_version
         FROM public.user_consents
         WHERE user_id = $1 AND purpose = $2
         ORDER BY created_at DESC LIMIT 1`,
        [authUser.id, UPI_CONSENT_PURPOSE]
      );
      const row = r.rows[0];
      const st = row?.st;
      const pv = row?.policy_version ? String(row.policy_version) : null;
      if (st === 'withdrawn') {
        return { status: 'withdrawn', policyVersion: pv };
      }
      if (st === 'granted') {
        if (pv && pv !== UPI_CONSENT_POLICY_VERSION) {
          return { status: 'not_granted', policyVersion: pv };
        }
        return { status: 'granted', policyVersion: pv || UPI_CONSENT_POLICY_VERSION };
      }
    } catch {}
  }
  const restRes = await getPrivacyConsentsRest(authUser);
  const rows: any[] = restRes.status === 200 && Array.isArray(restRes.body?.history) ? restRes.body.history : [];
  const latest = rows.find((r) => r.purpose === UPI_CONSENT_PURPOSE);
  if (latest) {
    const st = latest.consent_status || latest.status;
    const pv = latest.policy_version ? String(latest.policy_version) : null;
    if (st === 'withdrawn') {
      return { status: 'withdrawn', policyVersion: pv };
    }
    if (st === 'granted') {
      if (pv && pv !== UPI_CONSENT_POLICY_VERSION) {
        return { status: 'not_granted', policyVersion: pv };
      }
      return { status: 'granted', policyVersion: pv || UPI_CONSENT_POLICY_VERSION };
    }
  }
  return { status: 'not_granted', policyVersion: null };
}

async function getLatestUpiConsentStatus(authUser: AuthenticatedUser): Promise<'granted' | 'withdrawn' | 'not_granted'> {
  const info = await getLatestUpiConsentInfo(authUser);
  return info.status;
}

// ============================================================================
// 2. UNIFIED AUTH IDENTITIES & PASSKEY STORAGE (PG + REST + PRIVATE FALLBACK)
// ============================================================================
interface StoredPasskey {
  id: string;
  userId: string;
  credentialId: string;
  publicKeySpki: string;
  algorithm: number;
  counter: number;
  transports: string[];
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface StoredIdentity {
  id: string;
  userId: string;
  provider: 'google_firebase' | 'passkey' | 'email';
  providerUid: string;
  providerEmail: string | null;
  isVerified: boolean;
  linkedAt: string;
}

async function findIdentityByProviderUid(
  provider: 'google_firebase',
  providerUid: string
): Promise<StoredIdentity | null> {
  if (isDatabaseAvailable()) {
    try {
      const r = await query(
        `SELECT id, user_id, provider, provider_uid, provider_email, is_verified, linked_at
         FROM public.user_auth_identities WHERE provider = $1 AND provider_uid = $2 LIMIT 1`,
        [provider, providerUid]
      );
      if (r.rows[0]) {
        const row = r.rows[0];
        return {
          id: row.id,
          userId: row.user_id,
          provider: row.provider,
          providerUid: row.provider_uid,
          providerEmail: row.provider_email,
          isVerified: Boolean(row.is_verified),
          linkedAt: row.linked_at,
        };
      }
      return null;
    } catch {}
  }

  const rest = await sbRest<any[]>(
    `user_auth_identities?provider=eq.${encodeURIComponent(provider)}&provider_uid=eq.${encodeURIComponent(providerUid)}&limit=1`
  );
  if (rest.ok) {
    const row = rest.data?.[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      providerUid: row.provider_uid,
      providerEmail: row.provider_email,
      isVerified: Boolean(row.is_verified),
      linkedAt: row.linked_at,
    };
  }

  // Fallback scan across app_users when user_auth_identities is not yet migrated
  const scan = await sbRest<any[]>('app_users?select=id,custom_permissions&limit=1000');
  if (scan.ok && Array.isArray(scan.data)) {
    for (const u of scan.data) {
      const list: StoredIdentity[] = Array.isArray(u.custom_permissions?.__auth_identities)
        ? u.custom_permissions.__auth_identities
        : [];
      const found = list.find((it) => it.provider === provider && it.providerUid === providerUid);
      if (found) return { ...found, userId: u.id };
    }
  }
  return null;
}

async function listIdentitiesForUser(userId: string): Promise<StoredIdentity[]> {
  if (isDatabaseAvailable()) {
    try {
      const r = await query(
        `SELECT id, user_id, provider, provider_uid, provider_email, is_verified, linked_at
         FROM public.user_auth_identities WHERE user_id = $1 ORDER BY linked_at DESC`,
        [userId]
      );
      return r.rows.map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        provider: row.provider,
        providerUid: row.provider_uid,
        providerEmail: row.provider_email,
        isVerified: Boolean(row.is_verified),
        linkedAt: row.linked_at,
      }));
    } catch {}
  }

  const rest = await sbRest<any[]>(
    `user_auth_identities?user_id=eq.${encodeURIComponent(userId)}&order=linked_at.desc`
  );
  if (rest.ok && Array.isArray(rest.data)) {
    return rest.data.map((row) => ({
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      providerUid: row.provider_uid,
      providerEmail: row.provider_email,
      isVerified: Boolean(row.is_verified),
      linkedAt: row.linked_at,
    }));
  }

  const meta = await getUserPrivateMeta(userId);
  return Array.isArray(meta.__auth_identities) ? meta.__auth_identities : [];
}

async function saveIdentityForUser(
  userId: string,
  provider: 'google_firebase',
  providerUid: string,
  providerEmail: string | null,
  isVerified: boolean
): Promise<StoredIdentity> {
  const nowIso = new Date().toISOString();
  if (isDatabaseAvailable()) {
    try {
      const r = await query(
        `INSERT INTO public.user_auth_identities (user_id, provider, provider_uid, provider_email, is_verified, linked_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (provider, provider_uid) DO NOTHING
         RETURNING id, user_id, provider, provider_uid, provider_email, is_verified, linked_at`,
        [userId, provider, providerUid, providerEmail, isVerified]
      );
      if (r.rows[0]) {
        const row = r.rows[0];
        return {
          id: row.id,
          userId: row.user_id,
          provider: row.provider,
          providerUid: row.provider_uid,
          providerEmail: row.provider_email,
          isVerified: Boolean(row.is_verified),
          linkedAt: row.linked_at,
        };
      }
    } catch {}
  }

  const rest = await sbRest<any[]>('user_auth_identities', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      user_id: userId,
      provider,
      provider_uid: providerUid,
      provider_email: providerEmail,
      is_verified: isVerified,
      linked_at: nowIso,
    },
  });
  if (rest.ok && rest.data?.[0]) {
    const row = rest.data[0];
    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      providerUid: row.provider_uid,
      providerEmail: row.provider_email,
      isVerified: Boolean(row.is_verified),
      linkedAt: row.linked_at,
    };
  }

  const record: StoredIdentity = {
    id: crypto.randomUUID(),
    userId,
    provider,
    providerUid,
    providerEmail,
    isVerified,
    linkedAt: nowIso,
  };
  await setUserPrivateMeta(userId, (prev) => {
    const existing: StoredIdentity[] = Array.isArray(prev.__auth_identities) ? prev.__auth_identities : [];
    const filtered = existing.filter((it) => !(it.provider === provider && it.providerUid === providerUid));
    return { ...prev, __auth_identities: [...filtered, record] };
  });
  return record;
}

async function deleteGoogleIdentityForUser(userId: string): Promise<void> {
  if (isDatabaseAvailable()) {
    try {
      await query(
        `DELETE FROM public.user_auth_identities WHERE user_id = $1 AND provider = 'google_firebase'`,
        [userId]
      );
    } catch {}
  }
  await sbRest(
    `user_auth_identities?user_id=eq.${encodeURIComponent(userId)}&provider=eq.google_firebase`,
    { method: 'DELETE' }
  ).catch(() => {});
  await setUserPrivateMeta(userId, (prev) => {
    const existing: StoredIdentity[] = Array.isArray(prev.__auth_identities) ? prev.__auth_identities : [];
    return {
      ...prev,
      __auth_identities: existing.filter((it) => it.provider !== 'google_firebase'),
    };
  }).catch(() => {});
}

async function listPasskeysForUser(userId: string): Promise<StoredPasskey[]> {
  if (isDatabaseAvailable()) {
    try {
      const r = await query(
        `SELECT id, user_id, credential_id, public_key_spki, algorithm, counter, transports, device_name, created_at, last_used_at
         FROM public.user_passkeys WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );
      return r.rows.map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        credentialId: row.credential_id,
        publicKeySpki: row.public_key_spki,
        algorithm: Number(row.algorithm || -7),
        counter: Number(row.counter || 0),
        transports: Array.isArray(row.transports) ? row.transports : [],
        deviceName: row.device_name || 'Passkey Device',
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at || null,
      }));
    } catch {}
  }

  const rest = await sbRest<any[]>(
    `user_passkeys?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`
  );
  if (rest.ok && Array.isArray(rest.data)) {
    return rest.data.map((row) => ({
      id: row.id,
      userId: row.user_id,
      credentialId: row.credential_id,
      publicKeySpki: row.public_key_spki,
      algorithm: Number(row.algorithm || -7),
      counter: Number(row.counter || 0),
      transports: Array.isArray(row.transports) ? row.transports : [],
      deviceName: row.device_name || 'Passkey Device',
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at || null,
    }));
  }

  const meta = await getUserPrivateMeta(userId);
  return Array.isArray(meta.__passkeys) ? meta.__passkeys : [];
}

async function findPasskeyByCredentialId(credentialId: string): Promise<StoredPasskey | null> {
  if (isDatabaseAvailable()) {
    try {
      const r = await query(
        `SELECT id, user_id, credential_id, public_key_spki, algorithm, counter, transports, device_name, created_at, last_used_at
         FROM public.user_passkeys WHERE credential_id = $1 LIMIT 1`,
        [credentialId]
      );
      if (r.rows[0]) {
        const row = r.rows[0];
        return {
          id: row.id,
          userId: row.user_id,
          credentialId: row.credential_id,
          publicKeySpki: row.public_key_spki,
          algorithm: Number(row.algorithm || -7),
          counter: Number(row.counter || 0),
          transports: Array.isArray(row.transports) ? row.transports : [],
          deviceName: row.device_name || 'Passkey Device',
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at || null,
        };
      }
      return null;
    } catch {}
  }

  const rest = await sbRest<any[]>(
    `user_passkeys?credential_id=eq.${encodeURIComponent(credentialId)}&limit=1`
  );
  if (rest.ok) {
    const row = rest.data?.[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      credentialId: row.credential_id,
      publicKeySpki: row.public_key_spki,
      algorithm: Number(row.algorithm || -7),
      counter: Number(row.counter || 0),
      transports: Array.isArray(row.transports) ? row.transports : [],
      deviceName: row.device_name || 'Passkey Device',
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at || null,
    };
  }

  // Fallback scan when user_passkeys table is not yet migrated
  const scan = await sbRest<any[]>('app_users?select=id,custom_permissions&limit=1000');
  if (scan.ok && Array.isArray(scan.data)) {
    for (const u of scan.data) {
      const list: StoredPasskey[] = Array.isArray(u.custom_permissions?.__passkeys)
        ? u.custom_permissions.__passkeys
        : [];
      const found = list.find((p) => p.credentialId === credentialId);
      if (found) return { ...found, userId: u.id };
    }
  }
  return null;
}

async function savePasskeyForUser(pk: Omit<StoredPasskey, 'id' | 'createdAt' | 'lastUsedAt'>): Promise<StoredPasskey> {
  const nowIso = new Date().toISOString();
  if (isDatabaseAvailable()) {
    try {
      const r = await query(
        `INSERT INTO public.user_passkeys (user_id, credential_id, public_key_spki, algorithm, counter, transports, device_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, user_id, credential_id, public_key_spki, algorithm, counter, transports, device_name, created_at, last_used_at`,
        [pk.userId, pk.credentialId, pk.publicKeySpki, pk.algorithm, pk.counter, pk.transports, pk.deviceName]
      );
      if (r.rows[0]) {
        const row = r.rows[0];
        return {
          id: row.id,
          userId: row.user_id,
          credentialId: row.credential_id,
          publicKeySpki: row.public_key_spki,
          algorithm: Number(row.algorithm || -7),
          counter: Number(row.counter || 0),
          transports: Array.isArray(row.transports) ? row.transports : [],
          deviceName: row.device_name || 'Passkey Device',
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at || null,
        };
      }
    } catch {}
  }

  const rest = await sbRest<any[]>('user_passkeys', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      user_id: pk.userId,
      credential_id: pk.credentialId,
      public_key_spki: pk.publicKeySpki,
      algorithm: pk.algorithm,
      counter: pk.counter,
      transports: pk.transports,
      device_name: pk.deviceName,
    },
  });
  if (rest.ok && rest.data?.[0]) {
    const row = rest.data[0];
    return {
      id: row.id,
      userId: row.user_id,
      credentialId: row.credential_id,
      publicKeySpki: row.public_key_spki,
      algorithm: Number(row.algorithm || -7),
      counter: Number(row.counter || 0),
      transports: Array.isArray(row.transports) ? row.transports : [],
      deviceName: row.device_name || 'Passkey Device',
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at || null,
    };
  }

  const created: StoredPasskey = {
    ...pk,
    id: crypto.randomUUID(),
    createdAt: nowIso,
    lastUsedAt: null,
  };
  await setUserPrivateMeta(pk.userId, (prev) => {
    const list: StoredPasskey[] = Array.isArray(prev.__passkeys) ? prev.__passkeys : [];
    return { ...prev, __passkeys: [created, ...list.filter((p) => p.credentialId !== pk.credentialId)] };
  });
  return created;
}

async function updatePasskeyUsage(passkey: StoredPasskey, newCounter: number): Promise<void> {
  const nowIso = new Date().toISOString();
  if (isDatabaseAvailable()) {
    try {
      await query(
        `UPDATE public.user_passkeys SET counter = $1, last_used_at = NOW() WHERE credential_id = $2`,
        [newCounter, passkey.credentialId]
      );
      return;
    } catch {}
  }
  const rest = await sbRest(`user_passkeys?credential_id=eq.${encodeURIComponent(passkey.credentialId)}`, {
    method: 'PATCH',
    body: { counter: newCounter, last_used_at: nowIso },
  });
  if (rest.ok) return;

  await setUserPrivateMeta(passkey.userId, (prev) => {
    const list: StoredPasskey[] = Array.isArray(prev.__passkeys) ? prev.__passkeys : [];
    return {
      ...prev,
      __passkeys: list.map((p) =>
        p.credentialId === passkey.credentialId ? { ...p, counter: newCounter, lastUsedAt: nowIso } : p
      ),
    };
  }).catch(() => {});
}

async function deletePasskeyForUser(userId: string, passkeyId: string): Promise<boolean> {
  let deleted = false;
  if (isDatabaseAvailable()) {
    try {
      const r = await query(
        `DELETE FROM public.user_passkeys WHERE id = $1 AND user_id = $2 RETURNING id`,
        [passkeyId, userId]
      );
      if ((r.rowCount ?? 0) > 0) deleted = true;
    } catch {}
  }
  const rest = await sbRest(
    `user_passkeys?id=eq.${encodeURIComponent(passkeyId)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'DELETE', prefer: 'return=representation' }
  );
  if (rest.ok && Array.isArray(rest.data) && rest.data.length > 0) deleted = true;

  await setUserPrivateMeta(userId, (prev) => {
    const list: StoredPasskey[] = Array.isArray(prev.__passkeys) ? prev.__passkeys : [];
    const next = list.filter((p) => p.id !== passkeyId);
    if (next.length !== list.length) deleted = true;
    return { ...prev, __passkeys: next };
  }).catch(() => {});

  return deleted;
}

async function fetchUserRowById(userId: string): Promise<any | null> {
  if (isDatabaseAvailable()) {
    try {
      const r = await query('SELECT * FROM public.app_users WHERE id = $1 LIMIT 1', [userId]);
      if (r.rows[0]) return r.rows[0];
    } catch {}
  }
  const rest = await sbRest<any[]>(`app_users?id=eq.${encodeURIComponent(userId)}&select=*&limit=1`);
  return rest.ok && rest.data?.[0] ? rest.data[0] : null;
}

async function fetchUserRowByEmail(email: string): Promise<any | null> {
  const norm = normalizeEmail(email);
  if (isDatabaseAvailable()) {
    try {
      const r = await query('SELECT * FROM public.app_users WHERE LOWER(email) = $1 LIMIT 1', [norm]);
      if (r.rows[0]) return r.rows[0];
    } catch {}
  }
  const rest = await sbRest<any[]>(`app_users?email=ilike.${encodeURIComponent(norm)}&select=*&limit=1`);
  return rest.ok && rest.data?.[0] ? rest.data[0] : null;
}

async function userHasPasswordAuth(userRow: any): Promise<boolean> {
  const hash = String(userRow?.password_hash || '');
  return Boolean(hash && !hash.startsWith('OAUTH_NO_PASSWORD_'));
}

// ============================================================================
// MAIN ROUTER FOR NEW ACCOUNT EXTENSION ENDPOINTS
// ============================================================================
export async function handleUserAccountExtensions(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  clientIp: string,
  userAgent: string
): Promise<boolean> {
  // --------------------------------------------------------------------------
  // A. UPI PROFILE ENDPOINTS (STRICT USER ISOLATION + DPDP CONSENT GATE)
  // --------------------------------------------------------------------------
  if (pathname === '/api/upi/profile' && method === 'GET') {
    const authUser = await authenticateRequest(req);
    if (!authUser) {
      sendJson(res, 401, { success: false, message: 'Authentication required.' });
      return true;
    }
    const [rawProfile, consentInfo] = await Promise.all([
      getSavedUpiProfileForUser(authUser.id),
      getLatestUpiConsentInfo(authUser),
    ]);
    // Strict ownership & consent withdrawal enforcement
    const ownedProfile =
      rawProfile && (!rawProfile.userId || rawProfile.userId === authUser.id)
        ? rawProfile
        : null;
    const profile = consentInfo.status === 'withdrawn' ? null : ownedProfile;
    sendJson(res, 200, {
      success: true,
      profile,
      consentStatus: consentInfo.status,
      consentVersion: consentInfo.policyVersion,
    });
    return true;
  }

  if (pathname === '/api/upi/profile' && (method === 'POST' || method === 'PUT')) {
    const authUser = await authenticateRequest(req);
    if (!authUser) {
      sendJson(res, 401, { success: false, message: 'Authentication required.' });
      return true;
    }
    let body: any = {};
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, { success: false, message: 'Invalid JSON request payload.' });
      return true;
    }

    const validation = validateUpiId(body.upiId || body.upi_id || '');
    if (!validation.isValid) {
      sendJson(res, 400, { success: false, code: 'INVALID_UPI_ID', message: validation.error });
      return true;
    }

    const consentAccepted = body.consentAccepted === true;
    const consentInfo = await getLatestUpiConsentInfo(authUser);
    const existingConsent = consentInfo.status;
    const existingProfile = await getSavedUpiProfileForUser(authUser.id);

    // Require explicit consent checkbox acceptance on first save, when consent was previously withdrawn/not granted/outdated version, or whenever caller provides consentAccepted: false
    if (!consentAccepted && (existingConsent !== 'granted' || !existingProfile || body.consentAccepted === false)) {
      sendJson(res, 400, {
        success: false,
        code: 'CONSENT_REQUIRED',
        message: 'You must explicitly agree to the UPI QR consent notice before saving your UPI ID.',
      });
      return true;
    }

    const payeeName = sanitizeUpiText(body.payeeName ?? body.payee_name ?? authUser.full_name, 80);
    const paymentNote = sanitizeUpiText(body.paymentNote ?? body.payment_note ?? '', 80);
    const source = body.source === 'settings_upi_qr' ? 'settings_upi_qr' : 'upi_qr_setup';

    if (consentAccepted) {
      await recordUpiConsentEvent(authUser, 'granted', source, clientIp, userAgent);
    }

    const saved = await upsertSavedUpiProfileForUser(authUser.id, {
      upiId: validation.normalized,
      payeeName,
      paymentNote,
    });

    await logSecurityEvent('UPI_PROFILE_SAVED', {
      userId: authUser.id,
      userEmail: authUser.email,
      ipAddress: clientIp,
      metadata: { source, consentGranted: consentAccepted || existingConsent === 'granted' },
    }).catch(() => {});

    sendJson(res, 200, {
      success: true,
      message: 'Your UPI QR details have been securely saved.',
      profile: saved,
      consentStatus: 'granted',
      consentVersion: UPI_CONSENT_POLICY_VERSION,
    });
    return true;
  }

  if (pathname === '/api/upi/profile' && method === 'DELETE') {
    const authUser = await authenticateRequest(req);
    if (!authUser) {
      sendJson(res, 401, { success: false, message: 'Authentication required.' });
      return true;
    }
    let body: any = {};
    try {
      body = await parseJsonBody(req);
    } catch {}

    await clearSavedUpiProfileForUser(authUser.id);

    const withdrawConsent = body?.withdrawConsent !== false;
    const source = body?.source === 'settings_upi_qr' ? 'settings_upi_qr' : 'upi_qr_setup';
    if (withdrawConsent) {
      await recordUpiConsentEvent(authUser, 'withdrawn', source, clientIp, userAgent);
    }

    await logSecurityEvent('UPI_PROFILE_REMOVED', {
      userId: authUser.id,
      userEmail: authUser.email,
      ipAddress: clientIp,
      metadata: { withdrawConsent },
    }).catch(() => {});

    sendJson(res, 200, {
      success: true,
      message: 'Saved UPI details removed and UPI QR consent withdrawn.',
      profile: null,
      consentStatus: withdrawConsent ? 'withdrawn' : await getLatestUpiConsentStatus(authUser),
    });
    return true;
  }

  // --------------------------------------------------------------------------
  // B. MANDATORY COMPLETE YOUR PROFILE: POST /api/profile/complete
  // --------------------------------------------------------------------------
  if (pathname === '/api/profile/complete' && method === 'POST') {
    const authUser = await authenticateRequest(req);
    if (!authUser) {
      sendJson(res, 401, { success: false, message: 'Authentication required.' });
      return true;
    }
    let body: any = {};
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, { success: false, message: 'Invalid request body.' });
      return true;
    }

    const fullName = String(body.fullName || body.full_name || '').trim();
    const phone = String(body.phone || '').trim();
    const rawUsername = body.username !== undefined ? String(body.username || '').trim().toLowerCase() : undefined;

    if (!fullName || fullName.length < 2 || fullName.length > 80) {
      sendJson(res, 400, { success: false, message: 'Please enter your full name (2 to 80 characters).' });
      return true;
    }
    if (phone && !validatePhone(phone)) {
      sendJson(res, 400, { success: false, message: 'Please enter a valid mobile number (10-15 digits).' });
      return true;
    }
    if (rawUsername) {
      if (!/^[a-z0-9_]{3,30}$/.test(rawUsername)) {
        sendJson(res, 400, {
          success: false,
          message: 'Username must be 3-30 characters using lowercase letters, numbers, or underscores.',
        });
        return true;
      }
      // Check uniqueness
      const dupRest = await sbRest<any[]>(
        `app_users?username=eq.${encodeURIComponent(rawUsername)}&id=neq.${encodeURIComponent(authUser.id)}&select=id&limit=1`
      );
      if (dupRest.ok && Array.isArray(dupRest.data) && dupRest.data.length > 0) {
        sendJson(res, 409, { success: false, message: 'That username is already taken. Please choose another.' });
        return true;
      }
    }

    // Update profile fields + mark profile_completed = true (both column when present & custom_permissions fallback)
    const meta = await getUserPrivateMeta(authUser.id);
    const updatedMeta = { ...meta, __profile_completed: true };
    let updatedRow: any = null;

    if (isDatabaseAvailable()) {
      try {
        const r = await query(
          `UPDATE public.app_users
           SET full_name = $1,
               phone = COALESCE($2, phone),
               username = COALESCE($3, username),
               custom_permissions = $4::jsonb,
               updated_at = NOW()
           WHERE id = $5
           RETURNING *`,
          [fullName, phone || null, rawUsername || null, JSON.stringify(updatedMeta), authUser.id]
        );
        updatedRow = r.rows[0] || null;
        await query('UPDATE public.app_users SET profile_completed = TRUE WHERE id = $1', [authUser.id]).catch(() => {});
      } catch {}
    }

    if (!updatedRow) {
      const patchPayload: Record<string, any> = {
        full_name: fullName,
        custom_permissions: updatedMeta,
        updated_at: new Date().toISOString(),
      };
      if (phone) patchPayload.phone = phone;
      if (rawUsername) patchPayload.username = rawUsername;

      const restUpd = await sbRest<any[]>(`app_users?id=eq.${encodeURIComponent(authUser.id)}`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: patchPayload,
      });
      if (!restUpd.ok || !restUpd.data?.[0]) {
        sendJson(res, 503, { success: false, message: restUpd.error || 'Could not complete profile right now.' });
        return true;
      }
      updatedRow = restUpd.data[0];
    }

    sendJson(res, 200, {
      success: true,
      message: 'Profile completed! Welcome to My Money Manager.',
      user: sanitizeUserOutput({ ...authUser, ...updatedRow, profile_completed: true }),
    });
    return true;
  }

  // --------------------------------------------------------------------------
  // C. PROFILE SECURITY METHODS: GET /api/profile/security-methods
  // --------------------------------------------------------------------------
  if (pathname === '/api/profile/security-methods' && method === 'GET') {
    const authUser = await authenticateRequest(req);
    if (!authUser) {
      sendJson(res, 401, { success: false, message: 'Authentication required.' });
      return true;
    }
    const [userRow, identities, passkeys] = await Promise.all([
      fetchUserRowById(authUser.id),
      listIdentitiesForUser(authUser.id),
      listPasskeysForUser(authUser.id),
    ]);
    const googleIdentity = identities.find((i) => i.provider === 'google_firebase') || null;
    const hasPassword = await userHasPasswordAuth(userRow);

    sendJson(res, 200, {
      success: true,
      security: {
        email: {
          address: authUser.email,
          verified: Boolean(authUser.email_verified),
          hasPassword,
        },
        google: googleIdentity
          ? {
              linked: true,
              email: googleIdentity.providerEmail,
              linkedAt: googleIdentity.linkedAt,
            }
          : { linked: false, email: null, linkedAt: null },
        passkeys: passkeys.map((p) => ({
          id: p.id,
          deviceName: p.deviceName,
          transports: p.transports,
          createdAt: p.createdAt,
          lastUsedAt: p.lastUsedAt,
        })),
      },
    });
    return true;
  }

  // --------------------------------------------------------------------------
  // D. GOOGLE AUTHENTICATION (FIREBASE ID TOKEN -> CANONICAL app_users.id)
  // --------------------------------------------------------------------------
  if (pathname === '/api/auth/google' && method === 'POST') {
    const rate = await checkRateLimitAsync(
      `login:ip:${clientIp}`,
      RATE_LIMITS.LOGIN_IP.max,
      RATE_LIMITS.LOGIN_IP.windowMs,
      RATE_LIMITS.LOGIN_IP.op
    );
    if (!rate.allowed) {
      sendJson(res, 429, { success: false, message: 'Too many authentication attempts. Please try again later.' });
      return true;
    }

    let body: any = {};
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, { success: false, message: 'Invalid JSON request.' });
      return true;
    }
    const idToken = String(body.idToken || '').trim();
    if (!idToken) {
      sendJson(res, 400, { success: false, message: 'Firebase Google ID token is required.' });
      return true;
    }

    let verified;
    try {
      verified = await verifyFirebaseIdToken(idToken);
    } catch (err: any) {
      sendJson(res, 401, { success: false, message: err?.message || 'Google token verification failed.' });
      return true;
    }

    // 1. Check existing linked identity (provider = 'google_firebase', provider_uid = verified.uid)
    const existingIdentity = await findIdentityByProviderUid('google_firebase', verified.uid);
    if (existingIdentity) {
      const userRow = await fetchUserRowById(existingIdentity.userId);
      if (!userRow || userRow.status !== 'active') {
        sendJson(res, 403, { success: false, message: 'Your account is not active. Please contact support.' });
        return true;
      }
      const replaceSessionId =
        typeof body.replaceSessionId === 'string' && body.replaceSessionId.trim()
          ? body.replaceSessionId.trim()
          : undefined;

      let session;
      try {
        session = await createSession(userRow.id, {
          rememberMe: true,
          userAgent,
          ipAddress: clientIp,
          user: { role: userRow.role, email: userRow.email },
          replaceSessionId,
        });
      } catch (sessionErr: any) {
        if (sessionErr instanceof SessionLimitError) {
          await logSecurityEvent('GOOGLE_LOGIN_BLOCKED_MAX_SESSIONS', {
            userId: userRow.id,
            userEmail: userRow.email,
            ipAddress: clientIp,
          }).catch(() => {});
          sendJson(res, 409, {
            success: false,
            code: sessionErr.code,
            message: sessionErr.message,
            maxSessions: sessionErr.maxSessions,
            activeSessions: sessionErr.activeSessions,
          });
          return true;
        }
        throw sessionErr;
      }
      setSessionCookie(res, session.sessionToken, session.expiresAt);
      const outUser = sanitizeUserOutput(userRow);
      sendJson(res, 200, {
        success: true,
        isNewUser: false,
        requiresProfileCompletion: outUser.profile_completed === false,
        user: outUser,
        sessionToken: session.sessionToken,
      });
      return true;
    }

    // 2. Security rule: NEVER auto-merge based solely on matching email!
    const existingByEmail = await fetchUserRowByEmail(verified.email);
    if (existingByEmail) {
      sendJson(res, 409, {
        success: false,
        code: 'ACCOUNT_LINK_REQUIRED',
        message:
          'An account with this email already exists. For your security, sign in with your existing password or passkey first, then link your Google account in Profile → Security.',
      });
      return true;
    }

    // 3. Brand-new canonical app_users UUID (NEVER reuse Firebase UID as Supabase UUID!)
    const placeholderPasswordHash = `OAUTH_NO_PASSWORD_${crypto.randomBytes(24).toString('hex')}`;
    const initialName = verified.name || verified.email.split('@')[0] || 'User';
    const initialMeta = { __profile_completed: false };

    let createdUser: any = null;
    if (isDatabaseAvailable()) {
      try {
        const r = await query(
          `INSERT INTO public.app_users (
            full_name, email, password_hash, role, status, email_verified, avatar_url, custom_permissions
          ) VALUES ($1, $2, $3, 'user', 'active', $4, $5, $6::jsonb)
          RETURNING *`,
          [
            initialName,
            verified.email,
            placeholderPasswordHash,
            verified.emailVerified,
            verified.picture,
            JSON.stringify(initialMeta),
          ]
        );
        createdUser = r.rows[0] || null;
      } catch {}
    }
    if (!createdUser) {
      const ins = await sbRest<any[]>('app_users', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          full_name: initialName,
          email: verified.email,
          password_hash: placeholderPasswordHash,
          role: 'user',
          status: 'active',
          email_verified: verified.emailVerified,
          avatar_url: verified.picture,
          custom_permissions: initialMeta,
        },
      });
      if (!ins.ok || !ins.data?.[0]) {
        sendJson(res, 503, { success: false, message: ins.error || 'Could not create Google account right now.' });
        return true;
      }
      createdUser = ins.data[0];
    }

    await saveIdentityForUser(createdUser.id, 'google_firebase', verified.uid, verified.email, verified.emailVerified);

    const session = await createSession(createdUser.id, {
      rememberMe: true,
      userAgent,
      ipAddress: clientIp,
      user: { role: 'user', email: createdUser.email },
    });
    setSessionCookie(res, session.sessionToken, session.expiresAt);

    // Immediately deliver in-app welcome notification, SMTP welcome email, and admin alert
    await dispatchNewUserWelcomeNotification({
      userId: createdUser.id,
      fullName: createdUser.full_name,
      email: createdUser.email,
      provider: 'google',
    }).catch((err) => {
      console.error('[Google Welcome In-App Notification Error]:', err);
    });

    sendWelcomeEmail(createdUser.email, createdUser.full_name, createdUser.id).catch((err) => {
      console.error('[Google Welcome Email Error]:', err);
    });

    recordAdminNotification({
      eventId: `new_user:${createdUser.id}`,
      eventType: 'new_user',
      priority: 'normal',
      title: 'New User Registered (Google)',
      message: `${createdUser.full_name} (${createdUser.email}) signed up via Google.`,
      userId: createdUser.id,
      userEmail: createdUser.email,
      deepLink: `admin:users:${createdUser.id}`,
      relatedEntityType: 'user',
      relatedEntityId: createdUser.id,
      metadata: {
        role: 'user',
        provider: 'google',
        verificationStatus: Boolean(createdUser.email_verified),
        registeredAt: createdUser.created_at || new Date().toISOString(),
      },
    }).catch(() => {});

    await logSecurityEvent('GOOGLE_USER_REGISTERED', {
      userId: createdUser.id,
      userEmail: createdUser.email,
      ipAddress: clientIp,
    }).catch(() => {});

    const outUser = sanitizeUserOutput({ ...createdUser, profile_completed: false });
    sendJson(res, 201, {
      success: true,
      isNewUser: true,
      requiresProfileCompletion: true,
      message: 'Google account connected! Please complete your profile to continue.',
      user: outUser,
      sessionToken: session.sessionToken,
    });
    return true;
  }

  if (pathname === '/api/auth/google/link' && method === 'POST') {
    const authUser = await authenticateRequest(req);
    if (!authUser) {
      sendJson(res, 401, { success: false, message: 'Authentication required.' });
      return true;
    }
    let body: any = {};
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, { success: false, message: 'Invalid JSON request.' });
      return true;
    }
    const idToken = String(body.idToken || '').trim();
    if (!idToken) {
      sendJson(res, 400, { success: false, message: 'Firebase Google ID token is required.' });
      return true;
    }

    let verified;
    try {
      verified = await verifyFirebaseIdToken(idToken);
    } catch (err: any) {
      sendJson(res, 401, { success: false, message: err?.message || 'Google token verification failed.' });
      return true;
    }

    const existing = await findIdentityByProviderUid('google_firebase', verified.uid);
    if (existing && existing.userId !== authUser.id) {
      sendJson(res, 409, {
        success: false,
        message: 'This Google account is already linked to a different My Money Manager user.',
      });
      return true;
    }

    await saveIdentityForUser(authUser.id, 'google_firebase', verified.uid, verified.email, verified.emailVerified);
    sendJson(res, 200, {
      success: true,
      message: `Linked Google account (${verified.email}) to your profile.`,
      google: { linked: true, email: verified.email },
    });
    return true;
  }

  if (pathname === '/api/auth/google/link' && method === 'DELETE') {
    const authUser = await authenticateRequest(req);
    if (!authUser) {
      sendJson(res, 401, { success: false, message: 'Authentication required.' });
      return true;
    }
    const [userRow, passkeys] = await Promise.all([
      fetchUserRowById(authUser.id),
      listPasskeysForUser(authUser.id),
    ]);
    const hasPassword = await userHasPasswordAuth(userRow);
    if (!hasPassword && passkeys.length === 0) {
      sendJson(res, 400, {
        success: false,
        message: 'Set a password or register a passkey before unlinking Google so you are not locked out.',
      });
      return true;
    }

    await deleteGoogleIdentityForUser(authUser.id);
    sendJson(res, 200, { success: true, message: 'Google account unlinked from your profile.' });
    return true;
  }

  // --------------------------------------------------------------------------
  // E. PASSKEY (WEBAUTHN) REGISTRATION & LOGIN ENDPOINTS
  // --------------------------------------------------------------------------
  if (pathname === '/api/auth/passkey/register/options' && method === 'POST') {
    const authUser = await authenticateRequest(req);
    if (!authUser) {
      sendJson(res, 401, { success: false, message: 'Authentication required to register a passkey.' });
      return true;
    }

    const { rpId, origin } = resolveRpContext(req.headers);
    const issued = issueWebAuthnChallenge({ type: 'register', userId: authUser.id, rpId, origin });
    const existing = await listPasskeysForUser(authUser.id);

    sendJson(res, 200, {
      success: true,
      challengeId: issued.challengeId,
      options: {
        challenge: issued.challenge,
        rp: {
          name: 'My Money Manager by HackifyPro',
          id: rpId,
        },
        user: {
          id: bufferToBase64Url(Buffer.from(authUser.id, 'utf8')),
          name: authUser.email,
          displayName: authUser.full_name || authUser.email,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256 (P-256)
          { type: 'public-key', alg: -257 }, // RS256
        ],
        timeout: 60000,
        attestation: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        excludeCredentials: existing.map((p) => ({
          id: p.credentialId,
          type: 'public-key',
          transports: p.transports.length ? p.transports : ['internal', 'hybrid'],
        })),
      },
    });
    return true;
  }

  if (pathname === '/api/auth/passkey/register/verify' && method === 'POST') {
    const authUser = await authenticateRequest(req);
    if (!authUser) {
      sendJson(res, 401, { success: false, message: 'Authentication required.' });
      return true;
    }

    let body: any = {};
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, { success: false, message: 'Invalid JSON request.' });
      return true;
    }

    const challengeRecord = consumeWebAuthnChallenge(String(body.challengeId || ''), 'register', authUser.id);
    if (!challengeRecord) {
      sendJson(res, 400, { success: false, message: 'Passkey registration challenge expired or invalid. Please try again.' });
      return true;
    }

    try {
      const extracted = extractCredentialFromAttestation({
        clientDataJSON: String(body.response?.clientDataJSON || ''),
        attestationObject: String(body.response?.attestationObject || ''),
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: challengeRecord.origin,
        expectedRpId: challengeRecord.rpId,
        publicKeySpkiBase64: body.response?.publicKeySpkiBase64
          ? String(body.response.publicKeySpkiBase64)
          : undefined,
      });

      const duplicate = await findPasskeyByCredentialId(extracted.credentialId);
      if (duplicate) {
        sendJson(res, 409, { success: false, message: 'This passkey is already registered.' });
        return true;
      }

      const deviceName =
        String(body.deviceName || '').trim().slice(0, 60) ||
        (userAgent.includes('iPhone')
          ? 'iPhone Passkey'
          : userAgent.includes('Android')
          ? 'Android Passkey'
          : userAgent.includes('Mac')
          ? 'Mac Passkey'
          : userAgent.includes('Windows')
          ? 'Windows Hello Passkey'
          : 'My Device Passkey');

      const transports = Array.isArray(body.response?.transports)
        ? body.response.transports.map((t: any) => String(t)).slice(0, 6)
        : ['internal'];

      const saved = await savePasskeyForUser({
        userId: authUser.id,
        credentialId: extracted.credentialId,
        publicKeySpki: extracted.publicKeySpki,
        algorithm: extracted.algorithm,
        counter: extracted.counter,
        transports,
        deviceName,
      });

      await logSecurityEvent('PASSKEY_REGISTERED', {
        userId: authUser.id,
        userEmail: authUser.email,
        ipAddress: clientIp,
        metadata: { deviceName },
      }).catch(() => {});

      sendJson(res, 201, {
        success: true,
        message: `Passkey "${saved.deviceName}" registered successfully.`,
        passkey: {
          id: saved.id,
          deviceName: saved.deviceName,
          createdAt: saved.createdAt,
          lastUsedAt: saved.lastUsedAt,
        },
      });
    } catch (err: any) {
      sendJson(res, 400, { success: false, message: err?.message || 'Passkey verification failed.' });
    }
    return true;
  }

  if (pathname === '/api/auth/passkey/login/options' && method === 'POST') {
    let body: any = {};
    try {
      body = await parseJsonBody(req);
    } catch {}

    const { rpId, origin } = resolveRpContext(req.headers);
    const issued = issueWebAuthnChallenge({ type: 'login', rpId, origin });

    let allowCredentials: Array<{ id: string; type: 'public-key'; transports?: string[] }> = [];
    const email = body?.email ? normalizeEmail(String(body.email)) : '';
    if (email) {
      const userRow = await fetchUserRowByEmail(email);
      if (userRow) {
        const keys = await listPasskeysForUser(userRow.id);
        allowCredentials = keys.map((k) => ({
          id: k.credentialId,
          type: 'public-key',
          transports: k.transports.length ? k.transports : ['internal', 'hybrid'],
        }));
      }
    }

    sendJson(res, 200, {
      success: true,
      challengeId: issued.challengeId,
      options: {
        challenge: issued.challenge,
        rpId,
        timeout: 60000,
        userVerification: 'preferred',
        allowCredentials,
      },
    });
    return true;
  }

  if (pathname === '/api/auth/passkey/login/verify' && method === 'POST') {
    const rate = await checkRateLimitAsync(
      `login:ip:${clientIp}`,
      RATE_LIMITS.LOGIN_IP.max,
      RATE_LIMITS.LOGIN_IP.windowMs,
      RATE_LIMITS.LOGIN_IP.op
    );
    if (!rate.allowed) {
      sendJson(res, 429, { success: false, message: 'Too many login attempts. Please wait and try again.' });
      return true;
    }

    let body: any = {};
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, { success: false, message: 'Invalid JSON request.' });
      return true;
    }

    const challengeRecord = consumeWebAuthnChallenge(String(body.challengeId || ''), 'login');
    if (!challengeRecord) {
      sendJson(res, 400, { success: false, message: 'Passkey login challenge expired or invalid. Please try again.' });
      return true;
    }

    const credentialId = String(body.id || body.rawId || '').trim();
    if (!credentialId) {
      sendJson(res, 400, { success: false, message: 'Missing passkey credential ID.' });
      return true;
    }

    const stored = await findPasskeyByCredentialId(credentialId);
    if (!stored) {
      sendJson(res, 401, {
        success: false,
        message: 'No account found for this passkey. Register a passkey in Profile → Security first.',
      });
      return true;
    }

    const check = verifyPasskeyAssertion({
      clientDataJSON: String(body.response?.clientDataJSON || ''),
      authenticatorData: String(body.response?.authenticatorData || ''),
      signature: String(body.response?.signature || ''),
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: challengeRecord.origin,
      expectedRpId: challengeRecord.rpId,
      publicKeySpki: stored.publicKeySpki,
      previousCounter: stored.counter,
    });

    if (!check.valid) {
      sendJson(res, 401, { success: false, message: check.error || 'Passkey verification failed.' });
      return true;
    }

    const userRow = await fetchUserRowById(stored.userId);
    if (!userRow || userRow.status !== 'active') {
      sendJson(res, 403, { success: false, message: 'This account is not active.' });
      return true;
    }

    await updatePasskeyUsage(stored, check.newCounter);

    const replaceSessionId =
      typeof body.replaceSessionId === 'string' && body.replaceSessionId.trim()
        ? body.replaceSessionId.trim()
        : undefined;

    let session;
    try {
      session = await createSession(userRow.id, {
        rememberMe: true,
        userAgent,
        ipAddress: clientIp,
        user: { role: userRow.role, email: userRow.email },
        replaceSessionId,
      });
    } catch (sessionErr: any) {
      if (sessionErr instanceof SessionLimitError) {
        await logSecurityEvent('PASSKEY_LOGIN_BLOCKED_MAX_SESSIONS', {
          userId: userRow.id,
          userEmail: userRow.email,
          ipAddress: clientIp,
        }).catch(() => {});
        sendJson(res, 409, {
          success: false,
          code: sessionErr.code,
          message: sessionErr.message,
          maxSessions: sessionErr.maxSessions,
          activeSessions: sessionErr.activeSessions,
        });
        return true;
      }
      throw sessionErr;
    }
    setSessionCookie(res, session.sessionToken, session.expiresAt);

    await logSecurityEvent('PASSKEY_LOGIN_SUCCESS', {
      userId: userRow.id,
      userEmail: userRow.email,
      ipAddress: clientIp,
    }).catch(() => {});

    const outUser = sanitizeUserOutput(userRow);
    sendJson(res, 200, {
      success: true,
      message: 'Signed in with Passkey.',
      requiresProfileCompletion: outUser.profile_completed === false,
      user: outUser,
      sessionToken: session.sessionToken,
    });
    return true;
  }

  if (pathname.startsWith('/api/auth/passkeys/') && method === 'DELETE') {
    const authUser = await authenticateRequest(req);
    if (!authUser) {
      sendJson(res, 401, { success: false, message: 'Authentication required.' });
      return true;
    }
    const passkeyId = decodeURIComponent(pathname.slice('/api/auth/passkeys/'.length)).trim();
    if (!passkeyId) {
      sendJson(res, 400, { success: false, message: 'Passkey ID is required.' });
      return true;
    }

    const [userRow, identities, passkeys] = await Promise.all([
      fetchUserRowById(authUser.id),
      listIdentitiesForUser(authUser.id),
      listPasskeysForUser(authUser.id),
    ]);
    const hasPassword = await userHasPasswordAuth(userRow);
    const hasGoogle = identities.some((i) => i.provider === 'google_firebase');
    if (passkeys.length <= 1 && !hasPassword && !hasGoogle) {
      sendJson(res, 400, {
        success: false,
        message: 'Cannot remove your last sign-in method. Set a password or link Google first.',
      });
      return true;
    }

    const ok = await deletePasskeyForUser(authUser.id, passkeyId);
    if (!ok) {
      sendJson(res, 404, { success: false, message: 'Passkey not found.' });
      return true;
    }
    sendJson(res, 200, { success: true, message: 'Passkey removed from your account.' });
    return true;
  }

  return false;
}
