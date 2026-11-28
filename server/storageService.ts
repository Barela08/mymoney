/**
 * Controlled Object Storage Service (Supabase Storage Private Buckets + Path-Confined Local Fallback)
 *
 * Security Rules:
 * - Private buckets (`quarantine-vault`, `branding-originals`, `private-attachments`) are NEVER publicly readable.
 * - Object paths contain ZERO PII (uses SHA-256 user hash + UUID/timestamp).
 * - Private files are served only via short-lived HMAC signed tokens or verified Supabase Storage signed URLs.
 * - `branding-optimized` stores only scan-verified lightweight display variants.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type StorageBucket =
  | 'quarantine-vault'
  | 'branding-originals'
  | 'branding-optimized'
  | 'private-attachments';

const LOCAL_STORAGE_ROOT = path.resolve(process.cwd(), '.data', 'storage');

function getSigningSecret(): string {
  const configured =
    process.env.DEVICE_COOKIE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    '';
  if (configured) return configured;
  const g = globalThis as any;
  if (!g.__mmLocalStorageSignSecret) {
    g.__mmLocalStorageSignSecret = crypto.randomBytes(32).toString('hex');
  }
  return g.__mmLocalStorageSignSecret;
}

function getSupabaseStorageConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
  return { url, serviceKey, enabled: Boolean(url && serviceKey) };
}

export function hashOwnerId(userId: string): string {
  return crypto.createHash('sha256').update(String(userId || 'anon')).digest('hex').slice(0, 24);
}

function resolveLocalBucketPath(bucket: StorageBucket, objectKey: string): string {
  const safeKey = String(objectKey || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!safeKey || safeKey.includes('..') || !/^[a-zA-Z0-9/_.\-]+$/.test(safeKey)) {
    throw new Error('INVALID_STORAGE_KEY');
  }
  const bucketDir = path.resolve(LOCAL_STORAGE_ROOT, bucket);
  const fullPath = path.resolve(bucketDir, safeKey);
  if (!fullPath.startsWith(bucketDir + path.sep)) {
    throw new Error('PATH_CONFINEMENT_VIOLATION');
  }
  return fullPath;
}

export async function putObjectInStorage(params: {
  bucket: StorageBucket;
  objectKey: string;
  data: Buffer;
  contentType: string;
}): Promise<{
  stored: boolean;
  provider: 'supabase_storage' | 'local_private_vault';
  bucket: StorageBucket;
  objectKey: string;
  error?: string;
}> {
  const { url, serviceKey, enabled } = getSupabaseStorageConfig();

  // Always write to local fallback vault if local dev/test or if Supabase fails cleanly
  try {
    const localPath = resolveLocalBucketPath(params.bucket, params.objectKey);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, params.data);
  } catch (err: any) {
    return {
      stored: false,
      provider: 'local_private_vault',
      bucket: params.bucket,
      objectKey: params.objectKey,
      error: err?.message || 'Failed to persist object locally.',
    };
  }

  if (enabled) {
    try {
      const uploadRes = await fetch(
        `${url}/storage/v1/object/${encodeURIComponent(params.bucket)}/${params.objectKey}`,
        {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': params.contentType,
            'x-upsert': 'true',
          },
          body: new Uint8Array(params.data),
          signal: AbortSignal.timeout(15000),
        }
      );
      if (uploadRes.ok) {
        return {
          stored: true,
          provider: 'supabase_storage',
          bucket: params.bucket,
          objectKey: params.objectKey,
        };
      }
    } catch {
      // Fallback safely to local private vault when cloud bucket isn't provisioned yet
    }
  }

  return {
    stored: true,
    provider: 'local_private_vault',
    bucket: params.bucket,
    objectKey: params.objectKey,
  };
}

export async function getObjectFromStorage(
  bucket: StorageBucket,
  objectKey: string
): Promise<{ data: Buffer; source: 'local_private_vault' | 'supabase_storage' } | null> {
  try {
    const localPath = resolveLocalBucketPath(bucket, objectKey);
    if (fs.existsSync(localPath)) {
      return { data: fs.readFileSync(localPath), source: 'local_private_vault' };
    }
  } catch {
    return null;
  }

  const { url, serviceKey, enabled } = getSupabaseStorageConfig();
  if (enabled) {
    try {
      const res = await fetch(
        `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey}`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          signal: AbortSignal.timeout(10000),
        }
      );
      if (res.ok) {
        const ab = await res.arrayBuffer();
        return { data: Buffer.from(ab), source: 'supabase_storage' };
      }
    } catch {}
  }
  return null;
}

export async function deleteObjectFromStorage(bucket: StorageBucket, objectKey: string): Promise<boolean> {
  let deleted = false;
  try {
    const localPath = resolveLocalBucketPath(bucket, objectKey);
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      deleted = true;
    }
  } catch {}

  const { url, serviceKey, enabled } = getSupabaseStorageConfig();
  if (enabled) {
    try {
      const res = await fetch(
        `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey}`,
        {
          method: 'DELETE',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (res.ok) deleted = true;
    } catch {}
  }

  return deleted;
}

export async function createSignedPrivateUrl(params: {
  bucket: StorageBucket;
  objectKey: string;
  ownerUserId: string;
  mimeType: string;
  ttlSeconds?: number;
}): Promise<{ url: string; expiresAt: string; mode: 'supabase_signed' | 'app_hmac_signed' }> {
  const ttl = Math.max(30, Math.min(900, params.ttlSeconds ?? 180));
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + ttl;

  const { url, serviceKey, enabled } = getSupabaseStorageConfig();
  if (enabled && params.bucket !== 'quarantine-vault') {
    try {
      const signRes = await fetch(
        `${url}/storage/v1/object/sign/${encodeURIComponent(params.bucket)}/${params.objectKey}`,
        {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expiresIn: ttl }),
          signal: AbortSignal.timeout(8000),
        }
      );
      if (signRes.ok) {
        const body: any = await signRes.json().catch(() => null);
        if (body?.signedURL) {
          const signedFull = body.signedURL.startsWith('http')
            ? body.signedURL
            : `${url}/storage/v1${body.signedURL}`;
          return {
            url: signedFull,
            expiresAt: new Date(expiresAtEpoch * 1000).toISOString(),
            mode: 'supabase_signed',
          };
        }
      }
    } catch {}
  }

  // Fallback: HMAC-SHA256 signed endpoint verified against current session owner
  const payload = `${params.bucket}|${params.objectKey}|${params.ownerUserId}|${params.mimeType}|${expiresAtEpoch}`;
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('hex');
  const qs = new URLSearchParams({
    bucket: params.bucket,
    key: params.objectKey,
    exp: String(expiresAtEpoch),
    mime: params.mimeType,
    sig,
  });
  return {
    url: `/api/uploads/private?${qs.toString()}`,
    expiresAt: new Date(expiresAtEpoch * 1000).toISOString(),
    mode: 'app_hmac_signed',
  };
}

export function verifySignedPrivateParams(params: {
  bucket: string;
  objectKey: string;
  ownerUserId: string;
  mimeType: string;
  exp: string;
  sig: string;
}): boolean {
  const expNum = Number(params.exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const payload = `${params.bucket}|${params.objectKey}|${params.ownerUserId}|${params.mimeType}|${expNum}`;
  const expected = crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('hex');
  try {
    const a = Buffer.from(params.sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function getStorageUtilizationStats() {
  const stats: Record<StorageBucket, { files: number; bytes: number }> = {
    'quarantine-vault': { files: 0, bytes: 0 },
    'branding-originals': { files: 0, bytes: 0 },
    'branding-optimized': { files: 0, bytes: 0 },
    'private-attachments': { files: 0, bytes: 0 },
  };

  const walk = (dir: string, bucket: StorageBucket) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, bucket);
      else if (entry.isFile()) {
        try {
          const st = fs.statSync(full);
          stats[bucket].files += 1;
          stats[bucket].bytes += st.size;
        } catch {}
      }
    }
  };

  for (const bucket of Object.keys(stats) as StorageBucket[]) {
    walk(path.join(LOCAL_STORAGE_ROOT, bucket), bucket);
  }

  const totalBytes = Object.values(stats).reduce((sum, s) => sum + s.bytes, 0);
  const { enabled, url } = getSupabaseStorageConfig();
  return {
    supabaseStorageConfigured: enabled,
    supabaseUrl: enabled ? url : null,
    buckets: stats,
    totalBytes,
  };
}
