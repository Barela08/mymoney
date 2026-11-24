import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from './db';

// -------------------------------------------------------------
// PASSWORD POLICY ENFORCEMENT (Mandatory Rules from Section 7)
// - Min length: 12 characters
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

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long for enterprise security.');
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
  if (password.length < 16 && diversityScore < 2) {
    errors.push('Short passwords must include at least two types of characters (letters, numbers, symbols) or be 16+ characters long.');
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
// RATE LIMITING & BRUTE FORCE PROTECTION (In-memory + DB)
// -------------------------------------------------------------

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

export function checkRateLimit(key: string, maxAttempts: number, windowMs: number): { allowed: boolean; remaining: number; retryAfterSec?: number } {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1 };
  }

  if (record.count >= maxAttempts) {
    const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  record.count += 1;
  return { allowed: true, remaining: maxAttempts - record.count };
}

// Cleanup expired rate limit records periodically
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetAt) {
      rateLimitStore.delete(key);
    }
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
