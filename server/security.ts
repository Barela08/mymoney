import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { IncomingMessage, ServerResponse } from 'http';
import { query, isDatabaseAvailable } from './db.js';

// -------------------------------------------------------------
// PASSWORD POLICY ENFORCEMENT
// -------------------------------------------------------------

const COMMON_PASSWORDS = new Set([
  'password1234',
  '123456789012',
  'qwerty123456',
  'administrator',
  'password12345',
  'admin12345678',
  'welcome123456',
  'iloveyou12345',
  'monkey1234567',
  'dragon1234567',
]);

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validatePasswordPolicy(password: string): ValidationResult {
  const errors: string[] = [];

  if (!password || typeof password !== 'string') {
    return { isValid: false, errors: ['Password is required.'] };
  }

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }

  if (password.length > 128) {
    errors.push('Password cannot exceed 128 characters.');
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('This password is too common and easily guessed. Please choose a more unique passphrase.');
  }

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  const diversityScore = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;
  if (password.length < 12 && diversityScore < 2) {
    errors.push('Short passwords must include at least two types of characters (letters, numbers, symbols) or be 12+ characters long.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;
  return re.test(email.trim()) && email.length <= 254;
}

export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

export function validatePhone(phone?: string): boolean {
  if (!phone) return true;
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  return /^\+?[0-9]{10,15}$/.test(cleaned);
}

// -------------------------------------------------------------
// CRYPTOGRAPHIC HASHING
// -------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateCryptoToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

// -------------------------------------------------------------
// TRUSTED PROXY IP EXTRACTION (IPv4 + IPv6)
// -------------------------------------------------------------

function normalizeIp(raw: string): string {
  let ip = (raw || '').trim();
  if (!ip) return '127.0.0.1';
  // Strip IPv6 mapped IPv4 prefix
  if (ip.toLowerCase().startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  // Strip port if accidentally included on IPv4 (e.g. 1.2.3.4:12345)
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.split(':')[0];
  }
  return ip.toLowerCase();
}

function isValidIpFormat(ip: string): boolean {
  if (!ip || ip.length > 64) return false;
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-f:]+$/i;
  return ipv4.test(ip) || (ip.includes(':') && ipv6.test(ip));
}

/**
 * Extracts real client IP behind trusted reverse proxies (Vercel, Cloudflare, Nginx)
 * without blindly trusting arbitrary client-spoofed X-Forwarded-For headers.
 */
export function extractClientIp(req: IncomingMessage): string {
  const vercelFwd = req.headers['x-vercel-forwarded-for'];
  if (typeof vercelFwd === 'string' && vercelFwd.trim()) {
    const candidate = normalizeIp(vercelFwd.split(',')[0]);
    if (isValidIpFormat(candidate)) return candidate;
  }

  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) {
    const candidate = normalizeIp(cfIp);
    if (isValidIpFormat(candidate)) return candidate;
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    const candidate = normalizeIp(realIp);
    if (isValidIpFormat(candidate)) return candidate;
  }

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const parts = forwarded.split(',').map((p) => normalizeIp(p)).filter(isValidIpFormat);
    if (parts.length > 0) {
      // On Vercel/trusted proxies, the edge appends/sets the client IP at index 0
      return parts[0];
    }
  }

  return normalizeIp(req.socket?.remoteAddress || '127.0.0.1');
}

// -------------------------------------------------------------
// SIGNED SERVER-ISSUED DEVICE IDENTIFIER (HttpOnly Cookie)
// -------------------------------------------------------------

const DEVICE_COOKIE_NAME = 'mmm_dev';
const EPHEMERAL_DEVICE_SECRET = crypto.randomBytes(32).toString('hex');

function getDeviceSigningSecret(): string {
  return (
    process.env.DEVICE_COOKIE_SECRET ||
    process.env.SESSION_SECRET ||
    EPHEMERAL_DEVICE_SECRET
  );
}

function signDeviceId(deviceId: string): string {
  const hmac = crypto
    .createHmac('sha256', getDeviceSigningSecret())
    .update(deviceId)
    .digest('hex')
    .slice(0, 32);
  return `${deviceId}.${hmac}`;
}

function verifySignedDeviceCookie(rawValue: string): string | null {
  const parts = rawValue.split('.');
  if (parts.length !== 2) return null;
  const [deviceId, sig] = parts;
  if (!/^[a-f0-9]{24,48}$/i.test(deviceId) || !/^[a-f0-9]{32}$/i.test(sig)) {
    return null;
  }
  const expected = signDeviceId(deviceId).split('.')[1];
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  return deviceId;
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * Returns a server-verified device ID from the HttpOnly signed `mmm_dev` cookie,
 * or issues a new signed cookie if missing or tampered.
 */
export function getOrIssueDeviceId(req: IncomingMessage, res?: ServerResponse): {
  deviceId: string;
  wasTampered: boolean;
  isNew: boolean;
} {
  const cookies = parseCookies(String(req.headers.cookie || ''));
  const raw = cookies[DEVICE_COOKIE_NAME];
  if (raw) {
    const verified = verifySignedDeviceCookie(raw);
    if (verified) {
      return { deviceId: verified, wasTampered: false, isNew: false };
    }
  }

  const newDeviceId = crypto.randomBytes(16).toString('hex');
  if (res && !res.writableEnded && !res.headersSent && typeof res.setHeader === 'function') {
    const isProd = process.env.NODE_ENV === 'production';
    const signed = signDeviceId(newDeviceId);
    const cookieStr = [
      `${DEVICE_COOKIE_NAME}=${encodeURIComponent(signed)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=31536000',
      isProd ? 'Secure' : '',
    ]
      .filter(Boolean)
      .join('; ');
    const existingSetCookie = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : undefined;
    if (Array.isArray(existingSetCookie)) {
      res.setHeader('Set-Cookie', [...existingSetCookie, cookieStr]);
    } else if (typeof existingSetCookie === 'string' && existingSetCookie) {
      res.setHeader('Set-Cookie', [existingSetCookie, cookieStr]);
    } else {
      res.setHeader('Set-Cookie', cookieStr);
    }
  }
  return { deviceId: newDeviceId, wasTampered: Boolean(raw), isNew: true };
}

// -------------------------------------------------------------
// TOKEN BUCKET RATE LIMITING + PROGRESSIVE COOLDOWN ENGINE
// -------------------------------------------------------------

export interface RateLimitConfig {
  max: number;          // Bucket capacity (max burst)
  windowMs: number;     // Refill window (tokens refill at max / (windowMs / 1000) per sec)
  op: string;
  cost?: number;        // Default request cost = 1
  category?: string;
}

export const RATE_LIMITS = {
  // A. Authentication
  LOGIN_IP: { max: 15, windowMs: 15 * 60 * 1000, op: 'auth.login.ip', category: 'auth' },
  LOGIN_ACCOUNT: { max: 5, windowMs: 15 * 60 * 1000, op: 'auth.login.account', category: 'auth' },
  ADMIN_LOGIN_IP: { max: 10, windowMs: 15 * 60 * 1000, op: 'auth.admin_login.ip', category: 'auth' },
  ADMIN_LOGIN_ACCOUNT: { max: 5, windowMs: 15 * 60 * 1000, op: 'auth.admin_login.account', category: 'auth' },
  FORGOT_PASSWORD_ACCOUNT: { max: 3, windowMs: 60 * 60 * 1000, op: 'auth.forgot_password.account', category: 'reset' },
  FORGOT_PASSWORD_IP: { max: 5, windowMs: 60 * 60 * 1000, op: 'auth.forgot_password.ip', category: 'reset' },
  PASSWORD_RESET_SUBMIT: { max: 5, windowMs: 15 * 60 * 1000, op: 'auth.reset_password.submit', category: 'reset' },
  PASSWORD_RESET_IP: { max: 10, windowMs: 15 * 60 * 1000, op: 'auth.reset_password.ip', category: 'reset' },
  VERIFY_RESET_TOKEN_IP: { max: 15, windowMs: 15 * 60 * 1000, op: 'auth.verify_reset_token.ip', category: 'reset' },
  SIGNUP_IP: { max: 5, windowMs: 60 * 60 * 1000, op: 'auth.signup', category: 'signup' },
  VERIFICATION_RESEND: { max: 3, windowMs: 60 * 60 * 1000, op: 'auth.verification.resend', category: 'auth' },
  SESSION_REFRESH: { max: 120, windowMs: 60 * 1000, op: 'auth.session.refresh', category: 'auth' },

  // B. Udhar
  PEOPLE_SEARCH: { max: 30, windowMs: 60 * 1000, op: 'udhar.people_search', category: 'search' },
  QR_GENERATION: { max: 20, windowMs: 15 * 60 * 1000, op: 'udhar.qr_generate', category: 'qr' },
  QR_SCAN_VALIDATE: { max: 30, windowMs: 15 * 60 * 1000, op: 'udhar.qr_validate', category: 'qr' },
  CONNECTION_REQUEST: { max: 10, windowMs: 60 * 60 * 1000, op: 'udhar.connection_request', category: 'connection' },
  UDHAR_CREATE: { max: 30, windowMs: 15 * 60 * 1000, op: 'udhar.entry_create', category: 'finance' },
  UDHAR_SETTLE: { max: 20, windowMs: 15 * 60 * 1000, op: 'udhar.settle', category: 'finance' },
  UDHAR_DELETE: { max: 20, windowMs: 15 * 60 * 1000, op: 'udhar.delete', category: 'finance' },
  TRANSACTION_DETAILS: { max: 60, windowMs: 60 * 1000, op: 'udhar.details', category: 'read' },

  // C. Financial Operations & General API
  TX_MUTATE: { max: 40, windowMs: 60 * 1000, op: 'finance.transaction_mutate', category: 'finance' },
  UPI_QR_GENERATE: { max: 20, windowMs: 15 * 60 * 1000, op: 'finance.upi_qr', category: 'qr' },
  FINANCE_EXPORT: { max: 5, windowMs: 15 * 60 * 1000, op: 'finance.export', category: 'export' },
  BULK_ACTIONS: { max: 10, windowMs: 15 * 60 * 1000, op: 'finance.bulk', category: 'finance' },
  REMINDER_CREATE: { max: 20, windowMs: 15 * 60 * 1000, op: 'finance.reminder', category: 'notification' },
  NOTIFICATION_SEND: { max: 10, windowMs: 15 * 60 * 1000, op: 'finance.notification', category: 'notification' },
  GENERAL_READ_IP: { max: 180, windowMs: 60 * 1000, op: 'api.read.ip', category: 'read' },
  GENERAL_READ_DEVICE: { max: 140, windowMs: 60 * 1000, op: 'api.read.device', category: 'read' },

  // D. Admin Operations
  ADMIN_USER_SEARCH: { max: 30, windowMs: 60 * 1000, op: 'admin.user_search', category: 'admin' },
  ADMIN_DATA_EXPORT: { max: 5, windowMs: 15 * 60 * 1000, op: 'admin.export', category: 'admin' },
  ADMIN_ROLE_CHANGE: { max: 10, windowMs: 15 * 60 * 1000, op: 'admin.role_change', category: 'admin' },
  ADMIN_SENSITIVE_ACCOUNT: { max: 10, windowMs: 15 * 60 * 1000, op: 'admin.sensitive_account', category: 'admin' },
  ADMIN_BULK_MODIFY: { max: 10, windowMs: 15 * 60 * 1000, op: 'admin.bulk_modify', category: 'admin' },
};

interface TokenBucketState {
  tokens: number;
  lastRefillAt: number;
  capacity: number;
  refillPerMs: number;
}

const tokenBucketStore = new Map<string, TokenBucketState>();

// Progressive Cooldown Schedule:
// Level 1: 5 min | Level 2: 10 min | Level 3: 20 min | Level 4: 30 min | Level 5+: 30 min max
export const PROGRESSIVE_COOLDOWN_MS = [
  5 * 60 * 1000,
  10 * 60 * 1000,
  20 * 60 * 1000,
  30 * 60 * 1000,
];
const OBSERVATION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface SecurityRestrictionRecord {
  restrictionKey: string;
  dimension: 'ip' | 'device' | 'account' | 'ip_device';
  identifier: string;
  violationLevel: number;
  violationCount: number;
  reason: string;
  lastViolationAt: number;
  restrictedUntil: number | null;
  releasedAt?: number | null;
  releasedBy?: string | null;
  metadata?: Record<string, any>;
}

const restrictionStore = new Map<string, SecurityRestrictionRecord>();
const recentRateLimitViolations: Array<{
  timestamp: string;
  key: string;
  operation: string;
  dimension: string;
  identifier: string;
  retryAfterSec: number;
  violationLevel?: number;
}> = [];

let rateLimitsTableEnsured = false;
async function ensureSecurityTables(): Promise<void> {
  if (rateLimitsTableEnsured || !isDatabaseAvailable()) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS public.rate_limits (
        key TEXT PRIMARY KEY,
        count INT NOT NULL DEFAULT 1,
        tokens DOUBLE PRECISION,
        last_refill_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reset_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE public.rate_limits
        ADD COLUMN IF NOT EXISTS tokens DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS last_refill_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON public.rate_limits(reset_at);

      CREATE TABLE IF NOT EXISTS public.security_restrictions (
        restriction_key TEXT PRIMARY KEY,
        dimension TEXT NOT NULL,
        identifier TEXT NOT NULL,
        violation_level INT NOT NULL DEFAULT 1,
        violation_count INT NOT NULL DEFAULT 1,
        reason TEXT NOT NULL,
        last_violation_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        restricted_until TIMESTAMPTZ,
        released_at TIMESTAMPTZ,
        released_by TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_security_restrictions_until ON public.security_restrictions(restricted_until) WHERE released_at IS NULL;
    `);
    rateLimitsTableEnsured = true;
  } catch (err: any) {
    console.warn('[Security Tables Init Notice]:', err?.message);
  }
}

function getSupabaseRestCreds(): { url: string; key: string } | null {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  if (!url || !key) return null;
  return { url, key };
}

let lastRestSyncAt = 0;
async function syncRestrictionsToRest(): Promise<void> {
  const creds = getSupabaseRestCreds();
  if (!creds) return;
  try {
    const active = Array.from(restrictionStore.values()).filter(
      (r) => !r.releasedAt && (Date.now() - r.lastViolationAt) < OBSERVATION_WINDOW_MS
    );
    await fetch(`${creds.url}/rest/v1/app_settings?on_conflict=key`, {
      method: 'POST',
      headers: {
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        key: 'security_restrictions_v1',
        value: active.slice(0, 200),
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Non-fatal
  }
}

async function hydrateRestrictionsFromRestIfNeeded(): Promise<void> {
  if (isDatabaseAvailable()) return;
  const now = Date.now();
  if (now - lastRestSyncAt < 15_000) return;
  lastRestSyncAt = now;
  const creds = getSupabaseRestCreds();
  if (!creds) return;
  try {
    const res = await fetch(`${creds.url}/rest/v1/app_settings?key=eq.security_restrictions_v1&select=value&limit=1`, {
      headers: { apikey: creds.key, Authorization: `Bearer ${creds.key}` },
    });
    if (!res.ok) return;
    const data: any = await res.json();
    const list = Array.isArray(data?.[0]?.value) ? data[0].value : [];
    for (const item of list) {
      if (item?.restrictionKey && !restrictionStore.has(item.restrictionKey)) {
        restrictionStore.set(item.restrictionKey, item);
      }
    }
  } catch {
    // Non-fatal
  }
}

export function resetRateLimit(key: string): void {
  tokenBucketStore.delete(key);
}

/**
 * Synchronous in-memory Token Bucket check.
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
  cost: number = 1
): { allowed: boolean; remaining: number; retryAfterSec?: number } {
  const now = Date.now();
  const capacity = Math.max(1, maxAttempts);
  const refillPerMs = capacity / Math.max(50, windowMs);

  let bucket = tokenBucketStore.get(key);
  if (!bucket || bucket.capacity !== capacity) {
    bucket = {
      tokens: capacity,
      lastRefillAt: now,
      capacity,
      refillPerMs,
    };
  } else {
    const elapsed = Math.max(0, now - bucket.lastRefillAt);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
    bucket.lastRefillAt = now;
  }

  if (bucket.tokens < cost) {
    tokenBucketStore.set(key, bucket);
    const deficit = cost - bucket.tokens;
    const retryAfterSec = Math.max(1, Math.ceil(deficit / refillPerMs / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  bucket.tokens -= cost;
  tokenBucketStore.set(key, bucket);
  return { allowed: true, remaining: Math.floor(bucket.tokens) };
}

/**
 * Atomic Server-Side Token Bucket Rate Limiter.
 * Uses PostgreSQL Token Bucket UPSERT when DB is available, with memory + Supabase REST fallback.
 */
export async function checkRateLimitAsync(
  key: string,
  maxAttempts: number,
  windowMs: number,
  operation?: string,
  cost: number = 1
): Promise<{ allowed: boolean; remaining: number; retryAfterSec?: number; operation?: string }> {
  const capacity = Math.max(1, maxAttempts);
  const refillPerSec = capacity / Math.max(0.05, windowMs / 1000);

  if (isDatabaseAvailable()) {
    try {
      if (!rateLimitsTableEnsured) {
        await ensureSecurityTables();
      }
      const res = await query(
        `INSERT INTO public.rate_limits (key, count, tokens, last_refill_at, reset_at, updated_at)
         VALUES ($1, 1, GREATEST(0, $2::double precision - $4::double precision), NOW(), NOW() + ($5 || ' milliseconds')::interval, NOW())
         ON CONFLICT (key) DO UPDATE
         SET
           tokens = CASE
             WHEN LEAST($2::double precision, COALESCE(public.rate_limits.tokens, $2::double precision) + EXTRACT(EPOCH FROM (NOW() - COALESCE(public.rate_limits.last_refill_at, NOW()))) * $3::double precision) >= $4::double precision
             THEN LEAST($2::double precision, COALESCE(public.rate_limits.tokens, $2::double precision) + EXTRACT(EPOCH FROM (NOW() - COALESCE(public.rate_limits.last_refill_at, NOW()))) * $3::double precision) - $4::double precision
             ELSE LEAST($2::double precision, COALESCE(public.rate_limits.tokens, $2::double precision) + EXTRACT(EPOCH FROM (NOW() - COALESCE(public.rate_limits.last_refill_at, NOW()))) * $3::double precision)
           END,
           count = CASE
             WHEN LEAST($2::double precision, COALESCE(public.rate_limits.tokens, $2::double precision) + EXTRACT(EPOCH FROM (NOW() - COALESCE(public.rate_limits.last_refill_at, NOW()))) * $3::double precision) >= $4::double precision
             THEN 1 ELSE 0
           END,
           last_refill_at = NOW(),
           reset_at = NOW() + ($5 || ' milliseconds')::interval,
           updated_at = NOW()
         RETURNING tokens, count`,
        [key, capacity, refillPerSec, cost, windowMs]
      );
      if (res.rows.length > 0) {
        const tokensAfter = Number(res.rows[0].tokens);
        const allowed = Number(res.rows[0].count) >= 1;
        const remaining = Math.max(0, Math.floor(tokensAfter));
        const retryAfterSec = allowed
          ? undefined
          : Math.max(1, Math.ceil((cost - tokensAfter) / refillPerSec));
        tokenBucketStore.set(key, {
          tokens: tokensAfter,
          lastRefillAt: Date.now(),
          capacity,
          refillPerMs: capacity / Math.max(1000, windowMs),
        });
        if (!allowed) {
          recordViolationMetrics(key, operation || 'rate_limit', retryAfterSec || 60);
        }
        return { allowed, remaining, retryAfterSec, operation };
      }
    } catch (e: any) {
      console.warn('[Token Bucket DB Notice]:', e?.message);
    }
  }

  const mem = checkRateLimit(key, maxAttempts, windowMs, cost);
  if (!mem.allowed) {
    recordViolationMetrics(key, operation || 'rate_limit', mem.retryAfterSec || 60);
  }
  return { ...mem, operation };
}

function recordViolationMetrics(key: string, operation: string, retryAfterSec: number, violationLevel?: number) {
  const parts = key.split(':');
  recentRateLimitViolations.unshift({
    timestamp: new Date().toISOString(),
    key,
    operation,
    dimension: parts[1] || parts[0] || 'unknown',
    identifier: parts.slice(2).join(':') || key,
    retryAfterSec,
    violationLevel,
  });
  if (recentRateLimitViolations.length > 200) {
    recentRateLimitViolations.length = 200;
  }
}

export async function resetRateLimitAsync(key: string): Promise<void> {
  resetRateLimit(key);
  if (isDatabaseAvailable()) {
    try {
      await query('DELETE FROM public.rate_limits WHERE key = $1', [key]);
    } catch {}
  }
}

/**
 * Checks whether an IP, Device, Account, or IP+Device pair is currently in an active cooldown.
 */
export async function checkActiveRestrictionsAsync(keys: string[]): Promise<SecurityRestrictionRecord | null> {
  await hydrateRestrictionsFromRestIfNeeded();
  const now = Date.now();

  for (const k of keys) {
    const mem = restrictionStore.get(k);
    if (mem && !mem.releasedAt && mem.restrictedUntil && mem.restrictedUntil > now) {
      return mem;
    }
  }

  if (isDatabaseAvailable() && keys.length > 0) {
    try {
      await ensureSecurityTables();
      const res = await query(
        `SELECT * FROM public.security_restrictions
         WHERE restriction_key = ANY($1) AND released_at IS NULL AND restricted_until > NOW()
         ORDER BY restricted_until DESC LIMIT 1`,
        [keys]
      );
      if (res.rows.length > 0) {
        const r = res.rows[0];
        const rec: SecurityRestrictionRecord = {
          restrictionKey: r.restriction_key,
          dimension: r.dimension,
          identifier: r.identifier,
          violationLevel: Number(r.violation_level),
          violationCount: Number(r.violation_count),
          reason: r.reason,
          lastViolationAt: new Date(r.last_violation_at).getTime(),
          restrictedUntil: r.restricted_until ? new Date(r.restricted_until).getTime() : null,
          releasedAt: null,
          metadata: r.metadata || {},
        };
        restrictionStore.set(rec.restrictionKey, rec);
        return rec;
      }
    } catch {}
  }

  return null;
}

/**
 * Records a qualifying security violation and triggers progressive cooldown escalation:
 * Level 1: 5m -> Level 2: 10m -> Level 3: 20m -> Level 4: 30m -> Level 5+: 30m max.
 */
export async function recordViolationAndMaybeRestrictAsync(params: {
  dimension: 'ip' | 'device' | 'account' | 'ip_device';
  identifier: string;
  reason: string;
  threshold?: number;
  metadata?: Record<string, any>;
}): Promise<SecurityRestrictionRecord | null> {
  const threshold = Math.max(1, params.threshold ?? 3);
  const restrictionKey = `${params.dimension}:${params.identifier}`;
  const now = Date.now();

  let rec = restrictionStore.get(restrictionKey);
  if (!rec || (now - rec.lastViolationAt) > OBSERVATION_WINDOW_MS || rec.releasedAt) {
    rec = {
      restrictionKey,
      dimension: params.dimension,
      identifier: params.identifier,
      violationLevel: 0,
      violationCount: 0,
      reason: params.reason,
      lastViolationAt: now,
      restrictedUntil: null,
      releasedAt: null,
      metadata: params.metadata || {},
    };
  }

  rec.violationCount += 1;
  rec.lastViolationAt = now;
  rec.reason = params.reason;
  if (params.metadata) {
    rec.metadata = { ...(rec.metadata || {}), ...params.metadata };
  }

  if (rec.violationCount >= threshold && (!rec.restrictedUntil || rec.restrictedUntil <= now)) {
    rec.violationLevel += 1;
    const durationIdx = Math.min(rec.violationLevel - 1, PROGRESSIVE_COOLDOWN_MS.length - 1);
    const durationMs = PROGRESSIVE_COOLDOWN_MS[durationIdx];
    rec.restrictedUntil = now + durationMs;
    recordViolationMetrics(
      restrictionKey,
      params.reason,
      Math.ceil(durationMs / 1000),
      rec.violationLevel
    );
  }

  restrictionStore.set(restrictionKey, rec);

  if (isDatabaseAvailable()) {
    try {
      await ensureSecurityTables();
      await query(
        `INSERT INTO public.security_restrictions
          (restriction_key, dimension, identifier, violation_level, violation_count, reason, last_violation_at, restricted_until, released_at, metadata, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, TO_TIMESTAMP($7 / 1000.0), $8, NULL, $9::jsonb, NOW())
         ON CONFLICT (restriction_key) DO UPDATE SET
           violation_level = EXCLUDED.violation_level,
           violation_count = EXCLUDED.violation_count,
           reason = EXCLUDED.reason,
           last_violation_at = EXCLUDED.last_violation_at,
           restricted_until = EXCLUDED.restricted_until,
           released_at = NULL,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        [
          rec.restrictionKey,
          rec.dimension,
          rec.identifier,
          rec.violationLevel,
          rec.violationCount,
          rec.reason,
          rec.lastViolationAt,
          rec.restrictedUntil ? new Date(rec.restrictedUntil).toISOString() : null,
          JSON.stringify(rec.metadata || {}),
        ]
      );
    } catch {}
  } else {
    void syncRestrictionsToRest();
  }

  return rec.restrictedUntil && rec.restrictedUntil > now ? rec : null;
}

export async function releaseSecurityRestrictionAsync(
  restrictionKey: string,
  adminActor: string
): Promise<boolean> {
  const existing = restrictionStore.get(restrictionKey);
  if (existing) {
    existing.releasedAt = Date.now();
    existing.releasedBy = adminActor;
    existing.restrictedUntil = null;
    restrictionStore.set(restrictionKey, existing);
  }
  if (isDatabaseAvailable()) {
    try {
      await ensureSecurityTables();
      await query(
        `UPDATE public.security_restrictions
         SET released_at = NOW(), released_by = $2, restricted_until = NULL, updated_at = NOW()
         WHERE restriction_key = $1`,
        [restrictionKey, adminActor]
      );
    } catch {}
  } else {
    await syncRestrictionsToRest();
  }
  return true;
}

export async function getSecurityRestrictionsSnapshotAsync() {
  await hydrateRestrictionsFromRestIfNeeded();
  const now = Date.now();
  const restrictions: SecurityRestrictionRecord[] = [];

  if (isDatabaseAvailable()) {
    try {
      await ensureSecurityTables();
      const res = await query(
        `SELECT * FROM public.security_restrictions
         WHERE released_at IS NULL AND (restricted_until > NOW() OR last_violation_at > NOW() - INTERVAL '2 hours')
         ORDER BY last_violation_at DESC LIMIT 100`
      );
      for (const r of res.rows) {
        const rec: SecurityRestrictionRecord = {
          restrictionKey: r.restriction_key,
          dimension: r.dimension,
          identifier: r.identifier,
          violationLevel: Number(r.violation_level),
          violationCount: Number(r.violation_count),
          reason: r.reason,
          lastViolationAt: new Date(r.last_violation_at).getTime(),
          restrictedUntil: r.restricted_until ? new Date(r.restricted_until).getTime() : null,
          releasedAt: r.released_at ? new Date(r.released_at).getTime() : null,
          metadata: r.metadata || {},
        };
        restrictionStore.set(rec.restrictionKey, rec);
      }
    } catch {}
  }

  for (const rec of restrictionStore.values()) {
    if (!rec.releasedAt && ((rec.restrictedUntil && rec.restrictedUntil > now) || (now - rec.lastViolationAt) < OBSERVATION_WINDOW_MS)) {
      restrictions.push(rec);
    }
  }

  return {
    activeCooldowns: restrictions.filter((r) => r.restrictedUntil && r.restrictedUntil > now),
    watchedEntities: restrictions,
    recentViolations: recentRateLimitViolations.slice(0, 50),
    activeBucketCount: tokenBucketStore.size,
  };
}

/**
 * Standardized HTTP 429 Too Many Requests response handler
 */
export function sendRateLimitExceeded(
  res: any,
  rateResult: { retryAfterSec?: number; operation?: string; violationLevel?: number },
  customMessage?: string
): boolean {
  if (res.writableEnded || res.headersSent) return true;
  const retryAfter = rateResult.retryAfterSec || 60;
  const payload = {
    success: false,
    code: 'TOO_MANY_REQUESTS',
    message: customMessage || 'You have made too many attempts. Please try again after some time.',
    retryAfter,
    operation: rateResult.operation || 'request',
    ...(rateResult.violationLevel ? { violationLevel: rateResult.violationLevel } : {}),
  };

  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Retry-After', String(retryAfter));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(429).json(payload);
    return true;
  }

  res.writeHead(429, {
    'Content-Type': 'application/json; charset=utf-8',
    'Retry-After': String(retryAfter),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  });
  res.end(JSON.stringify(payload));
  return true;
}

// Cleanup expired rate limit records periodically
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of tokenBucketStore.entries()) {
    if (now - bucket.lastRefillAt > 30 * 60 * 1000) {
      tokenBucketStore.delete(key);
    }
  }
  for (const [key, rec] of restrictionStore.entries()) {
    if (rec.releasedAt || (now - rec.lastViolationAt > OBSERVATION_WINDOW_MS && (!rec.restrictedUntil || rec.restrictedUntil < now))) {
      restrictionStore.delete(key);
    }
  }
  if (isDatabaseAvailable()) {
    query("DELETE FROM public.rate_limits WHERE reset_at < NOW() - INTERVAL '30 minutes'").catch(() => {});
  }
}, 60000);
if (typeof cleanupTimer?.unref === 'function') {
  cleanupTimer.unref();
}

// -------------------------------------------------------------
// SECURITY AUDIT LOGGING
// -------------------------------------------------------------

export async function logSecurityEvent(
  eventType: string,
  opts: {
    userId?: string | null;
    userEmail?: string | null;
    actorRole?: string;
    ipAddress?: string | null;
    details?: Record<string, any>;
  } = {}
) {
  if (!isDatabaseAvailable()) return;
  try {
    await query(
      `INSERT INTO public.security_audit_logs (event_type, user_id, user_email, actor_role, ip_address, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        eventType,
        opts.userId || null,
        opts.userEmail || null,
        opts.actorRole || 'user',
        opts.ipAddress || null,
        JSON.stringify(opts.details || {}),
      ]
    );
  } catch (err: any) {
    console.warn('[Audit Log Notice]:', err?.message);
  }
}
