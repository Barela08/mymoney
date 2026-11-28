/**
 * Firebase Cloud Firestore Secondary Database Adapter (Zero Extra Dependencies)
 *
 * Uses Google OAuth2 Service Account JWT + Firestore v1 REST API when
 * FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 * (or FIREBASE_SERVICE_ACCOUNT_JSON) are configured.
 *
 * When credentials are not configured, provides a bounded local mirror store
 * for staging/testing while accurately reporting `configured: false`.
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
  deleted_at?: string | null;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;
const localMirrorStore = new Map<string, Map<string, SecondaryRecordEnvelope>>();
const MIRROR_FILE = path.resolve(process.cwd(), '.runtime-firebase-mirror.json');

function loadLocalMirrorOnce() {
  if (localMirrorStore.size > 0) return;
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

async function getGoogleOAuthToken(sa: FirebaseServiceAccount): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 60_000) {
    return cachedAccessToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(
    JSON.stringify({
      iss: sa.clientEmail,
      scope: 'https://www.googleapis.com/auth/datastore',
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
  cachedAccessToken = {
    token: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
  };
  return cachedAccessToken.token;
}

function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
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
      message: 'Firebase Service Account credentials not configured (local mirror fallback active).',
    };
  }
  try {
    const token = await getGoogleOAuthToken(sa);
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/databases/(default)/documents/app_settings?pageSize=1`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      }
    );
    const ms = Date.now() - t0;
    if (res.ok || res.status === 404) {
      return { status: 'healthy', configured: true, responseTimeMs: ms, message: 'Cloud Firestore reachable' };
    }
    return {
      status: res.status >= 500 ? 'unhealthy' : 'degraded',
      configured: true,
      responseTimeMs: ms,
      message: `Firestore HTTP ${res.status}`,
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

export async function upsertSecondaryRecord(envelope: SecondaryRecordEnvelope): Promise<{
  ok: boolean;
  mode: 'firestore' | 'local_mirror';
  error?: string;
}> {
  // Always keep local mirror updated in sync
  loadLocalMirrorOnce();
  let colMap = localMirrorStore.get(envelope.collection);
  if (!colMap) {
    colMap = new Map();
    localMirrorStore.set(envelope.collection, colMap);
  }
  const existing = colMap.get(envelope.id);
  if (!existing || existing.sync_version <= envelope.sync_version) {
    colMap.set(envelope.id, envelope);
    persistLocalMirrorBestEffort();
  }

  const sa = getFirebaseServiceAccount();
  if (!sa) {
    return { ok: true, mode: 'local_mirror' };
  }

  try {
    const token = await getGoogleOAuthToken(sa);
    const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/databases/(default)/documents/${encodeURIComponent(envelope.collection)}/${encodeURIComponent(envelope.id)}`;
    const fields: Record<string, any> = {};
    const merged = {
      ...envelope.data,
      _sync_version: envelope.sync_version,
      _source_db: envelope.source_db,
      _idempotency_key: envelope.idempotency_key,
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

export async function listSecondaryCollection(collection: string, userIdFilter?: string): Promise<SecondaryRecordEnvelope[]> {
  const sa = getFirebaseServiceAccount();
  if (sa) {
    try {
      const token = await getGoogleOAuthToken(sa);
      const res = await fetch(
        `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/databases/(default)/documents/${encodeURIComponent(collection)}?pageSize=200`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(6000),
        }
      );
      if (res.ok) {
        const json: any = await res.json();
        const docs: any[] = Array.isArray(json?.documents) ? json.documents : [];
        const parsed: SecondaryRecordEnvelope[] = docs
          .map((d) => {
            const id = String(d.name || '').split('/').pop() || '';
            const dataObj: Record<string, any> = {};
            for (const [k, v] of Object.entries(d.fields || {})) {
              dataObj[k] = fromFirestoreValue(v);
            }
            return {
              id,
              collection,
              data: dataObj,
              sync_version: Number(dataObj._sync_version || 1),
              source_db: (dataObj._source_db || 'supabase') as 'supabase' | 'firebase',
              idempotency_key: String(dataObj._idempotency_key || id),
              updated_at: String(dataObj._updated_at || d.updateTime || new Date().toISOString()),
              deleted_at: dataObj._deleted_at || null,
            };
          })
          .filter((env) => !env.deleted_at)
          .filter((env) => !userIdFilter || env.data.user_id === userIdFilter || env.data.user_a_id === userIdFilter || env.data.user_b_id === userIdFilter);
        return parsed;
      }
    } catch {}
  }

  loadLocalMirrorOnce();
  const map = localMirrorStore.get(collection);
  if (!map) return [];
  return Array.from(map.values())
    .filter((env) => !env.deleted_at)
    .filter((env) => !userIdFilter || env.data.user_id === userIdFilter || env.data.user_a_id === userIdFilter || env.data.user_b_id === userIdFilter);
}

export function getLocalMirrorStats() {
  loadLocalMirrorOnce();
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [col, map] of localMirrorStore.entries()) {
    counts[col] = map.size;
    total += map.size;
  }
  return { totalRecords: total, collections: counts };
}
