/**
 * Firebase Cloud Firestore Secondary Database Adapter (Zero Extra Dependencies)
 *
 * Uses Google OAuth2 Service Account JWT + Firestore v1 REST API when
 * FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 * (or FIREBASE_SERVICE_ACCOUNT_JSON) are configured.
 *
 * Features:
 * - Idempotent version-checked upserts and tombstone deletions across all business collections.
 * - Distributed failover lease storage (`failover_state/primary_lease`).
 * - Independent live health checks for Firestore, Firebase Auth, and Firebase Storage.
 * - Bounded local staging mirror when service-account credentials are absent, while
 *   honestly reporting `configured: false` (never faking a healthy cloud connection).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface FirebaseServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface SecondaryRecordEnvelope {
  id: string;
  collection: string;
  data: Record<string, any>;
  sync_version: number;
  source_db: 'supabase' | 'firebase';
  idempotency_key: string;
  updated_at: string;
  created_at?: string;
  deleted_at?: string | null;
}

export const SYNCED_BUSINESS_COLLECTIONS = [
  'app_users',
  'transactions',
  'sections',
  'udhar_transactions',
  'udhar_repayments',
  'udhar_contacts',
  'user_connections',
  'user_notifications',
  'app_settings',
] as const;

let cachedAccessToken: { token: string; expiresAt: number } | null = null;
const localMirrorStore = new Map<string, Map<string, SecondaryRecordEnvelope>>();
const MIRROR_FILE = path.resolve(process.cwd(), '.runtime-firebase-mirror.json');
let mirrorLoaded = false;

function loadLocalMirrorOnce() {
  if (mirrorLoaded) return;
  mirrorLoaded = true;
  try {
    if (fs.existsSync(MIRROR_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MIRROR_FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        for (const [col, docs] of Object.entries(raw)) {
          const map = new Map<string, SecondaryRecordEnvelope>();
          for (const [id, env] of Object.entries(docs as Record<string, SecondaryRecordEnvelope>)) {
            map.set(id, env);
          }
          localMirrorStore.set(col, map);
        }
      }
    }
  } catch {
    // Ignore corrupt mirror file
  }
}

function persistLocalMirrorBestEffort() {
  if (process.env.VERCEL) return;
  try {
    const out: Record<string, Record<string, SecondaryRecordEnvelope>> = {};
    for (const [col, map] of localMirrorStore.entries()) {
      out[col] = Object.fromEntries(map.entries());
    }
    fs.writeFileSync(MIRROR_FILE, JSON.stringify(out), 'utf8');
  } catch {
    // Non-fatal in read-only environments
  }
}

export function getFirebaseServiceAccount(): FirebaseServiceAccount | null {
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: String(parsed.project_id).trim(),
          clientEmail: String(parsed.client_email).trim(),
          privateKey: String(parsed.private_key).replace(/\\n/g, '\n'),
        };
      }
    } catch {}
  }

  const projectId = (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    ''
  ).trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }
  return null;
}

export function isFirebaseDbConfigured(): boolean {
  return Boolean(getFirebaseServiceAccount());
}

async function getGoogleOAuthToken(sa: FirebaseServiceAccount, scope = 'https://www.googleapis.com/auth/datastore'): Promise<string> {
  if (scope === 'https://www.googleapis.com/auth/datastore' && cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 60_000) {
    return cachedAccessToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(
    JSON.stringify({
      iss: sa.clientEmail,
      scope,
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })
  ).toString('base64url');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = signer.sign(sa.privateKey, 'base64url');
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(assertion)}`,
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firebase OAuth2 token failed (${res.status}): ${text.slice(0, 120)}`);
  }
  const json: any = await res.json();
  if (scope === 'https://www.googleapis.com/auth/datastore') {
    cachedAccessToken = {
      token: json.access_token,
      expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    };
  }
  return json.access_token;
}

function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { nullValue: null };
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function fromFirestoreValue(v: any): any {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return String(v.stringValue);
  if ('timestampValue' in v) return String(v.timestampValue);
  if ('arrayValue' in v) {
    return Array.isArray(v.arrayValue?.values) ? v.arrayValue.values.map(fromFirestoreValue) : [];
  }
  if ('mapValue' in v) {
    const out: Record<string, any> = {};
    for (const [k, fv] of Object.entries(v.mapValue?.fields || {})) {
      out[k] = fromFirestoreValue(fv);
    }
    return out;
  }
  return null;
}

function parseFirestoreDocument(collection: string, doc: any): SecondaryRecordEnvelope {
  const id = String(doc.name || '').split('/').pop() || '';
  const dataObj: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc.fields || {})) {
    dataObj[k] = fromFirestoreValue(v);
  }
  return {
    id,
    collection,
    data: dataObj,
    sync_version: Number(dataObj._sync_version || 1),
    source_db: (dataObj._source_db === 'firebase' ? 'firebase' : 'supabase') as 'supabase' | 'firebase',
    idempotency_key: String(dataObj._idempotency_key || id),
    updated_at: String(dataObj._updated_at || doc.updateTime || new Date().toISOString()),
    created_at: String(dataObj._created_at || doc.createTime || dataObj.created_at || new Date().toISOString()),
    deleted_at: dataObj._deleted_at || null,
  };
}

export async function checkFirebaseHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  configured: boolean;
  responseTimeMs: number;
  message: string;
}> {
  const t0 = Date.now();
  const sa = getFirebaseServiceAccount();
  if (!sa) {
    return {
      status: 'unknown',
      configured: false,
      responseTimeMs: Date.now() - t0,
      message: 'Firebase Service Account credentials not configured (FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY required; local mirror staging active).',
    };
  }
  try {
    const token = await getGoogleOAuthToken(sa);
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/databases/(default)/documents/failover_state/primary_lease`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      }
    );
    const ms = Date.now() - t0;
    if (res.ok || res.status === 404) {
      return { status: 'healthy', configured: true, responseTimeMs: ms, message: `Cloud Firestore reachable (project: ${sa.projectId})` };
    }
    const errText = await res.text().catch(() => '');
    return {
      status: res.status >= 500 ? 'unhealthy' : 'degraded',
      configured: true,
      responseTimeMs: ms,
      message: `Firestore HTTP ${res.status}${errText ? `: ${errText.slice(0, 100)}` : ''}`,
    };
  } catch (err: any) {
    return {
      status: 'unhealthy',
      configured: true,
      responseTimeMs: Date.now() - t0,
      message: err?.message || 'Firestore connection failed',
    };
  }
}

export async function checkFirebaseAuthHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  configured: boolean;
  responseTimeMs: number;
  message: string;
}> {
  const t0 = Date.now();
  const projectId = (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  const webApiKey = (process.env.VITE_FIREBASE_API_KEY || '').trim();
  if (!projectId) {
    return {
      status: 'unknown',
      configured: false,
      responseTimeMs: Date.now() - t0,
      message: 'Firebase Auth project ID not configured (FIREBASE_PROJECT_ID / VITE_FIREBASE_PROJECT_ID).',
    };
  }
  try {
    // Verify Google SecureToken public certificates endpoint used for RS256 ID token verification
    const res = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
      { signal: AbortSignal.timeout(4500) }
    );
    const ms = Date.now() - t0;
    if (!res.ok) {
      return {
        status: res.status >= 500 ? 'unhealthy' : 'degraded',
        configured: true,
        responseTimeMs: ms,
        message: `Firebase SecureToken certs HTTP ${res.status}`,
      };
    }
    return {
      status: webApiKey ? 'healthy' : 'degraded',
      configured: true,
      responseTimeMs: ms,
      message: webApiKey
        ? `Firebase Auth token verification ready (project: ${projectId})`
        : `Server token verification ready (project: ${projectId}); VITE_FIREBASE_API_KEY unset for browser popup`,
    };
  } catch (err: any) {
    return {
      status: 'unhealthy',
      configured: true,
      responseTimeMs: Date.now() - t0,
      message: err?.message || 'Firebase Auth verification endpoint unreachable',
    };
  }
}

export async function checkFirebaseStorageHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  configured: boolean;
  responseTimeMs: number;
  message: string;
}> {
  const t0 = Date.now();
  const sa = getFirebaseServiceAccount();
  const bucket = (
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    (sa?.projectId ? `${sa.projectId}.firebasestorage.app` : '')
  ).trim();
  if (!sa || !bucket) {
    return {
      status: 'unknown',
      configured: false,
      responseTimeMs: Date.now() - t0,
      message: 'Firebase Storage bucket / service account not configured.',
    };
  }
  try {
    const token = await getGoogleOAuthToken(sa, 'https://www.googleapis.com/auth/devstorage.read_only');
    const res = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}?fields=name,location`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(4500),
      }
    );
    const ms = Date.now() - t0;
    if (res.ok) {
      return { status: 'healthy', configured: true, responseTimeMs: ms, message: `Firebase Storage bucket reachable (${bucket})` };
    }
    if (res.status === 404) {
      return { status: 'unknown', configured: false, responseTimeMs: ms, message: `Firebase Storage bucket not provisioned (${bucket})` };
    }
    return {
      status: res.status >= 500 ? 'unhealthy' : 'degraded',
      configured: true,
      responseTimeMs: ms,
      message: `Firebase Storage HTTP ${res.status}`,
    };
  } catch (err: any) {
    return {
      status: 'unhealthy',
      configured: true,
      responseTimeMs: Date.now() - t0,
      message: err?.message || 'Firebase Storage probe failed',
    };
  }
}

export async function getSecondaryRecord(
  collection: string,
  id: string
): Promise<SecondaryRecordEnvelope | null> {
  const sa = getFirebaseServiceAccount();
  if (sa) {
    try {
      const token = await getGoogleOAuthToken(sa);
      const res = await fetch(
        `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/databases/(default)/documents/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (res.ok) {
        const doc = await res.json();
        return parseFirestoreDocument(collection, doc);
      }
      if (res.status === 404) return null;
    } catch {
      // Fall through to local mirror
    }
  }

  loadLocalMirrorOnce();
  return localMirrorStore.get(collection)?.get(id) || null;
}

export async function upsertSecondaryRecord(envelope: SecondaryRecordEnvelope): Promise<{
  ok: boolean;
  mode: 'firestore' | 'local_mirror';
  skippedStale?: boolean;
  error?: string;
}> {
  // Always keep local mirror updated with monotonic sync_version guard (idempotent & stale-safe)
  loadLocalMirrorOnce();
  let colMap = localMirrorStore.get(envelope.collection);
  if (!colMap) {
    colMap = new Map();
    localMirrorStore.set(envelope.collection, colMap);
  }
  const existing = colMap.get(envelope.id);
  if (existing && existing.sync_version > envelope.sync_version) {
    return { ok: true, mode: getFirebaseServiceAccount() ? 'firestore' : 'local_mirror', skippedStale: true };
  }
  if (!existing || existing.sync_version <= envelope.sync_version) {
    colMap.set(envelope.id, {
      ...envelope,
      created_at: existing?.created_at || envelope.created_at || envelope.updated_at,
    });
    persistLocalMirrorBestEffort();
  }

  const sa = getFirebaseServiceAccount();
  if (!sa) {
    return { ok: true, mode: 'local_mirror' };
  }

  try {
    const token = await getGoogleOAuthToken(sa);
    const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/databases/(default)/documents/${encodeURIComponent(envelope.collection)}/${encodeURIComponent(envelope.id)}`;

    // Check existing remote version to avoid regressing newer revisions
    const remoteExisting = await getSecondaryRecord(envelope.collection, envelope.id).catch(() => null);
    if (remoteExisting && remoteExisting.sync_version > envelope.sync_version) {
      return { ok: true, mode: 'firestore', skippedStale: true };
    }

    const fields: Record<string, any> = {};
    const merged = {
      ...envelope.data,
      _sync_version: envelope.sync_version,
      _source_db: envelope.source_db,
      _idempotency_key: envelope.idempotency_key,
      _created_at: remoteExisting?.created_at || envelope.created_at || envelope.updated_at,
      _updated_at: envelope.updated_at,
      _deleted_at: envelope.deleted_at || null,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }

    const res = await fetch(docUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, mode: 'firestore', error: `Firestore write ${res.status}: ${txt.slice(0, 140)}` };
    }
    return { ok: true, mode: 'firestore' };
  } catch (err: any) {
    return { ok: false, mode: 'firestore', error: err?.message || 'Firestore write failed' };
  }
}

export async function listSecondaryCollection(
  collection: string,
  userIdFilter?: string,
  includeDeleted: boolean = false
): Promise<SecondaryRecordEnvelope[]> {
  const sa = getFirebaseServiceAccount();
  if (sa) {
    try {
      const token = await getGoogleOAuthToken(sa);
      const allDocs: SecondaryRecordEnvelope[] = [];
      let pageToken = '';
      for (let page = 0; page < 5; page++) {
        const qs = new URLSearchParams({ pageSize: '200' });
        if (pageToken) qs.set('pageToken', pageToken);
        const res = await fetch(
          `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/databases/(default)/documents/${encodeURIComponent(collection)}?${qs.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(6000),
          }
        );
        if (!res.ok) break;
        const json: any = await res.json();
        const docs: any[] = Array.isArray(json?.documents) ? json.documents : [];
        for (const d of docs) {
          allDocs.push(parseFirestoreDocument(collection, d));
        }
        if (!json?.nextPageToken) break;
        pageToken = String(json.nextPageToken);
      }
      return allDocs
        .filter((env) => includeDeleted || !env.deleted_at)
        .filter(
          (env) =>
            !userIdFilter ||
            env.data.user_id === userIdFilter ||
            env.data.user_a_id === userIdFilter ||
            env.data.user_b_id === userIdFilter ||
            env.id === userIdFilter
        );
    } catch {
      // Fall back to local mirror when cloud read fails
    }
  }

  loadLocalMirrorOnce();
  const map = localMirrorStore.get(collection);
  if (!map) return [];
  return Array.from(map.values())
    .filter((env) => includeDeleted || !env.deleted_at)
    .filter(
      (env) =>
        !userIdFilter ||
        env.data.user_id === userIdFilter ||
        env.data.user_a_id === userIdFilter ||
        env.data.user_b_id === userIdFilter ||
        env.id === userIdFilter
    );
}

export async function writeFailoverLeaseToSecondary(lease: {
  activeProvider: string;
  providerEpoch: number;
  leaseUntil: number | null;
  lastFailoverAt: string | null;
  lastRecoveryAt: string | null;
  reason: string;
}): Promise<void> {
  await upsertSecondaryRecord({
    id: 'primary_lease',
    collection: 'failover_state',
    data: lease,
    sync_version: lease.providerEpoch,
    source_db: lease.activeProvider === 'firebase' ? 'firebase' : 'supabase',
    idempotency_key: `lease_epoch_${lease.providerEpoch}`,
    updated_at: new Date().toISOString(),
  }).catch(() => {});
}

export function getLocalMirrorStats() {
  loadLocalMirrorOnce();
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [col, map] of localMirrorStore.entries()) {
    counts[col] = map.size;
    total += map.size;
  }
  return {
    configured: isFirebaseDbConfigured(),
    mode: isFirebaseDbConfigured() ? 'cloud_firestore' : 'local_mirror_staging',
    totalRecords: total,
    collections: counts,
  };
}
