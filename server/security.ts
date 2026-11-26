import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, isDatabaseAvailable } from './db.js';

// -------------------------------------------------------------
// PASSWORD POLICY ENFORCEMENT (Mandatory Rules from Section 7)
// - Min length: 8 characters
// - Max length: 128 characters
// - Reject common compromised passwords
// - Bcrypt 12 rounds
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

  // Check character diversity (encourage secure passphrase or mixed characters)
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
  if (!phone) return true; // Phone is optional in some contexts
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  return /^\+?[0-9]{10,15}$/.test(cleaned);
}

// -------------------------------------------------------------
// CRYPTOGRAPHIC HASHING (Argon2 / Bcrypt)
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
// RATE LIMITING & BRUTE FORCE PROTECTION (Atomic DB + Memory Store)
// -------------------------------------------------------------

export interface RateLimitConfig {
  max: number;
  windowMs: number;
  op: string;
}

export const RATE_LIMITS = {
  // A. Authentication
  LOGIN_IP: { max: 15, windowMs: 15 * 60 * 1000, op: 'auth.login.ip' },
  LOGIN_ACCOUNT: { max: 5, windowMs: 15 * 60 * 1000, op: 'auth.login.account' },
  ADMIN_LOGIN_IP: { max: 10, windowMs: 15 * 60 * 1000, op: 'auth.admin_login.ip' },
  ADMIN_LOGIN_ACCOUNT: { max: 5, windowMs: 15 * 60 * 1000, op: 'auth.admin_login.account' },
  FORGOT_PASSWORD_ACCOUNT: { max: 3, windowMs: 60 * 60 * 1000, op: 'auth.forgot_password.account' },
  FORGOT_PASSWORD_IP: { max: 5, windowMs: 60 * 60 * 1000, op: 'auth.forgot_password.ip' },
  PASSWORD_RESET_SUBMIT: { max: 5, windowMs: 15 * 60 * 1000, op: 'auth.reset_password.submit' },
  PASSWORD_RESET_IP: { max: 10, windowMs: 15 * 60 * 1000, op: 'auth.reset_password.ip' },
  VERIFY_RESET_TOKEN_IP: { max: 15, windowMs: 15 * 60 * 1000, op: 'auth.verify_reset_token.ip' },
  SIGNUP_IP: { max: 5, windowMs: 60 * 60 * 1000, op: 'auth.signup' },
  VERIFICATION_RESEND: { max: 3, windowMs: 60 * 60 * 1000, op: 'auth.verification.resend' },
  SESSION_REFRESH: { max: 120, windowMs: 60 * 1000, op: 'auth.session.refresh' },

  // B. Udhar
  PEOPLE_SEARCH: { max: 30, windowMs: 60 * 1000, op: 'udhar.people_search' },
  QR_GENERATION: { max: 20, windowMs: 15 * 60 * 1000, op: 'udhar.qr_generate' },
  QR_SCAN_VALIDATE: { max: 30, windowMs: 15 * 60 * 1000, op: 'udhar.qr_validate' },
  CONNECTION_REQUEST: { max: 10, windowMs: 60 * 60 * 1000, op: 'udhar.connection_request' },
  UDHAR_CREATE: { max: 30, windowMs: 15 * 60 * 1000, op: 'udhar.entry_create' },
  UDHAR_SETTLE: { max: 20, windowMs: 15 * 60 * 1000, op: 'udhar.settle' },
  UDHAR_DELETE: { max: 20, windowMs: 15 * 60 * 1000, op: 'udhar.delete' },
  TRANSACTION_DETAILS: { max: 60, windowMs: 60 * 1000, op: 'udhar.details' },

  // C. Financial Operations
  TX_MUTATE: { max: 30, windowMs: 60 * 1000, op: 'finance.transaction_mutate' },
  UPI_QR_GENERATE: { max: 20, windowMs: 15 * 60 * 1000, op: 'finance.upi_qr' },
  FINANCE_EXPORT: { max: 5, windowMs: 15 * 60 * 1000, op: 'finance.export' },
  BULK_ACTIONS: { max: 10, windowMs: 15 * 60 * 1000, op: 'finance.bulk' },
  REMINDER_CREATE: { max: 20, windowMs: 15 * 60 * 1000, op: 'finance.reminder' },
  NOTIFICATION_SEND: { max: 10, windowMs: 15 * 60 * 1000, op: 'finance.notification' },

  // D. Admin Operations
  ADMIN_USER_SEARCH: { max: 30, windowMs: 60 * 1000, op: 'admin.user_search' },
  ADMIN_DATA_EXPORT: { max: 5, windowMs: 15 * 60 * 1000, op: 'admin.export' },
  ADMIN_ROLE_CHANGE: { max: 10, windowMs: 15 * 60 * 1000, op: 'admin.role_change' },
  ADMIN_SENSITIVE_ACCOUNT: { max: 10, windowMs: 15 * 60 * 1000, op: 'admin.sensitive_account' },
  ADMIN_BULK_MODIFY: { max: 10, windowMs: 15 * 60 * 1000, op: 'admin.bulk_modify' },
};

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

let rateLimitsTableEnsured = false;
async function ensureRateLimitsTable(): Promise<void> {
  if (rateLimitsTableEnsured || !isDatabaseAvailable()) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS public.rate_limits (
        key TEXT PRIMARY KEY,
        count INT NOT NULL DEFAULT 1,
        reset_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON public.rate_limits(reset_at);
    `);
    rateLimitsTableEnsured = true;
  } catch (err: any) {
    console.warn('[Rate Limit Table Init Notice]:', err?.message);
  }
}

export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): { allowed: boolean; remaining: number; retryAfterSec?: number } {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1 };
  }

  if (record.count >= maxAttempts) {
    const retryAfterSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  record.count += 1;
  return { allowed: true, remaining: maxAttempts - record.count };
}

/**
 * Atomic Server-Side Rate Limiter
 * Uses PostgreSQL UPSERT with atomic counter increment when available,
 * with seamless atomic memory fallback.
 */
export async function checkRateLimitAsync(
  key: string,
  maxAttempts: number,
  windowMs: number,
  operation?: string
): Promise<{ allowed: boolean; remaining: number; retryAfterSec?: number; operation?: string }> {
  if (isDatabaseAvailable()) {
    try {
      if (!rateLimitsTableEnsured) {
        await ensureRateLimitsTable();
      }
      const res = await query(
        `INSERT INTO public.rate_limits (key, count, reset_at, updated_at)
         VALUES ($1, 1, NOW() + ($2 || ' milliseconds')::interval, NOW())
         ON CONFLICT (key) DO UPDATE
         SET 
           count = CASE 
             WHEN public.rate_limits.reset_at <= NOW() THEN 1 
             ELSE public.rate_limits.count + 1 
           END,
           reset_at = CASE 
             WHEN public.rate_limits.reset_at <= NOW() THEN NOW() + ($2 || ' milliseconds')::interval 
             ELSE public.rate_limits.reset_at 
           END,
           updated_at = NOW()
         RETURNING count, reset_at`,
        [key, windowMs]
      );
      if (res.rows.length > 0) {
        const count = Number(res.rows[0].count);
        const resetAt = new Date(res.rows[0].reset_at).getTime();
        const now = Date.now();
        const retryAfterSec = Math.max(1, Math.ceil((resetAt - now) / 1000));
        const allowed = count <= maxAttempts;
        const remaining = Math.max(0, maxAttempts - count);
        rateLimitStore.set(key, { count, resetAt });
        return { allowed, remaining, retryAfterSec, operation };
      }
    } catch (e: any) {
      console.warn('[Rate Limit DB Notice]:', e?.message);
    }
  }

  const mem = checkRateLimit(key, maxAttempts, windowMs);
  return { ...mem, operation };
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
 * Standardized HTTP 429 Too Many Requests response handler
 */
export function sendRateLimitExceeded(
  res: any,
  rateResult: { retryAfterSec?: number; operation?: string },
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
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetAt) {
      rateLimitStore.delete(key);
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
// SECURITY AUDIT LOGGING (PostgreSQL Immutable Ledger)
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
    console.error('[Audit Log Error]', err.message);
  }
}
