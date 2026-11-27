import crypto from 'crypto';
import { query, isDatabaseAvailable } from './db.js';
import { generateCryptoToken, hashToken } from './security.js';
import type { IncomingMessage } from 'http';

export interface AuthenticatedUser {
  id: string;
  full_name: string;
  email: string;
  username?: string | null;
  phone?: string | null;
  role: 'user' | 'admin' | 'superadmin';
  status: 'active' | 'suspended' | 'deactivated';
  email_verified: boolean;
  avatar_url?: string | null;
  force_password_reset: boolean;
  profile_completed?: boolean;
  created_at: string;
  last_login_at?: string | null;
  password_changed_at: string;
}

export interface SessionInfo {
  sessionId: string;
  sessionToken: string;
  userId: string;
  expiresAt: Date;
}

export const MAX_ACTIVE_SESSIONS = 3;

export interface ActiveSessionDisplay {
  id: string;
  deviceName: string;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  browser: string;
  os: string;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  expiresAt: string;
  isCurrent: boolean;
}

export class SessionLimitError extends Error {
  public readonly code = 'MAX_SESSIONS_REACHED';
  public readonly status = 409;
  public readonly maxSessions: number;
  public readonly activeSessions: ActiveSessionDisplay[];

  constructor(activeSessions: ActiveSessionDisplay[], maxSessions: number = MAX_ACTIVE_SESSIONS) {
    super(
      `Maximum ${maxSessions} concurrent logins allowed per account. Please log out from one of your active devices to continue.`
    );
    this.name = 'SessionLimitError';
    this.maxSessions = maxSessions;
    this.activeSessions = activeSessions;
  }
}

export function parseUserAgentSummary(userAgent?: string | null): {
  deviceName: string;
  browser: string;
  os: string;
  deviceType: 'mobile' | 'tablet' | 'desktop';
} {
  const ua = String(userAgent || '').trim();
  if (!ua) {
    return {
      deviceName: 'Unknown Browser',
      browser: 'Unknown Browser',
      os: 'Unknown OS',
      deviceType: 'desktop',
    };
  }

  let browser = 'Web Browser';
  if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS\//i.test(ua)) browser = 'Firefox';
  else if (/CriOS\/|Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\/|CriOS\//i.test(ua)) browser = 'Safari';
  else if (/node|undici|curl|playwright|vitest/i.test(ua)) browser = 'API / App Client';

  let os = 'Unknown OS';
  let deviceType: 'mobile' | 'tablet' | 'desktop' = 'desktop';

  if (/iPad/i.test(ua)) {
    os = 'iPadOS';
    deviceType = 'tablet';
  } else if (/iPhone|iPod/i.test(ua)) {
    os = 'iOS (iPhone)';
    deviceType = 'mobile';
  } else if (/Android/i.test(ua)) {
    os = 'Android';
    deviceType = /Mobile/i.test(ua) ? 'mobile' : 'tablet';
  } else if (/Windows NT/i.test(ua)) {
    os = 'Windows';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = 'macOS';
  } else if (/CrOS/i.test(ua)) {
    os = 'ChromeOS';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
  }

  const deviceName = os === 'Unknown OS' ? browser : `${browser} on ${os}`;
  return { deviceName, browser, os, deviceType };
}

const MASTER_ADMIN_EMAILS = new Set(['hackifypro@gmail.com', 'admin@mymoney.com']);
const NON_DISCOVERABLE_ROLES = new Set(['admin', 'superadmin', 'support', 'analyst']);

export function isMasterAdminAccountEmail(email?: string | null): boolean {
  if (!email) return false;
  return MASTER_ADMIN_EMAILS.has(String(email).toLowerCase().trim());
}

/**
 * Determines whether an account is eligible to appear in Udhar People Search / QR discovery.
 * Admin, superadmin, support, analyst, and master admin accounts are STRICTLY excluded.
 */
export function isDiscoverableNormalUser(user: {
  role?: string | null;
  email?: string | null;
  status?: string | null;
  deletion_status?: string | null;
}): boolean {
  if (!user) return false;
  if (user.status && String(user.status).toLowerCase().trim() !== 'active') return false;
  if (user.deletion_status && String(user.deletion_status).toLowerCase().trim() !== 'none') return false;
  if (isMasterAdminAccountEmail(user.email)) return false;
  const normalizedRole = String(user.role || 'user').toLowerCase().trim();
  if (NON_DISCOVERABLE_ROLES.has(normalizedRole) || normalizedRole !== 'user') return false;
  return true;
}

// Per-process ephemeral fallback secret if SESSION_SECRET is unset (never guessable by clients)
const EPHEMERAL_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

function getFallbackTokenSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.API_KEY_ENCRYPTION_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    EPHEMERAL_FALLBACK_SECRET
  );
}

function getAuthSupabaseRestConfig(): { url: string; key: string } {
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

/**
 * Issues a cryptographically signed HMAC-SHA256 stateless token ONLY when the database
 * session store is temporarily unreachable during a verified server-side login.
 */
export function signFallbackSessionToken(
  user: { id: string; role: string; email: string },
  expiresAtMs: number
): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      role: user.role,
      email: String(user.email || '').toLowerCase().trim(),
      exp: expiresAtMs,
    }),
    'utf8'
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getFallbackTokenSecret())
    .update(`mmf1.${payload}`)
    .digest('base64url');
  return `mmf1.${payload}.${sig}`;
}

export function verifyFallbackSessionToken(
  token: string
): { userId: string; role: string; email: string; exp: number } | null {
  if (!token || !token.startsWith('mmf1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, providedSig] = parts;
  if (!payloadB64 || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getFallbackTokenSecret())
    .update(`mmf1.${payloadB64}`)
    .digest('base64url');

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!parsed?.sub || typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) {
      return null;
    }
    return {
      userId: String(parsed.sub),
      role: String(parsed.role || 'user'),
      email: String(parsed.email || ''),
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

// Session Lifetime: 7 days default, 30 days for remember me
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const REMEMBER_ME_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export async function listActiveSessionsForUser(
  userId: string,
  currentSessionToken?: string | null
): Promise<ActiveSessionDisplay[]> {
  if (!userId) return [];
  const currentHash =
    currentSessionToken && !currentSessionToken.startsWith('mmf1.') && !currentSessionToken.startsWith('direct_')
      ? hashToken(currentSessionToken)
      : null;

  const mapRows = (rows: any[]): ActiveSessionDisplay[] => {
    const nowMs = Date.now();
    return rows
      .filter((r) => !r.is_revoked && r.expires_at && new Date(r.expires_at).getTime() > nowMs)
      .sort((a, b) => {
        const aTime = new Date(a.last_active_at || a.created_at || 0).getTime();
        const bTime = new Date(b.last_active_at || b.created_at || 0).getTime();
        return bTime - aTime;
      })
      .map((r) => {
        const parsed = parseUserAgentSummary(r.user_agent);
        return {
          id: String(r.id),
          deviceName: parsed.deviceName,
          deviceType: parsed.deviceType,
          browser: parsed.browser,
          os: parsed.os,
          ipAddress: r.ip_address ? String(r.ip_address) : null,
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
          lastActiveAt: r.last_active_at ? new Date(r.last_active_at).toISOString() : null,
          expiresAt: new Date(r.expires_at).toISOString(),
          isCurrent: Boolean(currentHash && r.session_token_hash === currentHash),
        };
      });
  };

  if (isDatabaseAvailable()) {
    try {
      // Opportunistically mark expired sessions revoked so they never linger
      await query(
        `UPDATE public.user_sessions SET is_revoked = TRUE
         WHERE user_id = $1 AND is_revoked = FALSE AND expires_at <= NOW()`,
        [userId]
      ).catch(() => {});

      const res = await query(
        `SELECT id, session_token_hash, user_agent, ip_address, expires_at, is_revoked, created_at, last_active_at
         FROM public.user_sessions
         WHERE user_id = $1 AND is_revoked = FALSE AND expires_at > NOW()
         ORDER BY COALESCE(last_active_at, created_at) DESC`,
        [userId]
      );
      return mapRows(res.rows || []);
    } catch (err: any) {
      console.warn('listActiveSessionsForUser PG query failed, attempting Supabase REST:', err?.message);
    }
  }

  try {
    const { url, key } = getAuthSupabaseRestConfig();
    const restRes = await fetch(
      `${url}/rest/v1/user_sessions?user_id=eq.${encodeURIComponent(userId)}&is_revoked=eq.false&select=id,session_token_hash,user_agent,ip_address,expires_at,is_revoked,created_at,last_active_at&order=created_at.desc&limit=20`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
        },
      }
    );
    if (restRes.ok) {
      const rows = await restRes.json().catch(() => []);
      if (Array.isArray(rows)) {
        const nowMs = Date.now();
        for (const r of rows) {
          if (r?.id && r?.expires_at && new Date(r.expires_at).getTime() <= nowMs) {
            fetch(`${url}/rest/v1/user_sessions?id=eq.${encodeURIComponent(r.id)}`, {
              method: 'PATCH',
              headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ is_revoked: true }),
            }).catch(() => {});
          }
        }
        return mapRows(rows);
      }
    }
  } catch (err: any) {
    console.warn('listActiveSessionsForUser Supabase REST notice:', err?.message);
  }

  return [];
}

export async function revokeUserSessionById(userId: string, sessionId: string): Promise<boolean> {
  if (!userId || !sessionId) return false;

  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `UPDATE public.user_sessions
         SET is_revoked = TRUE
         WHERE id = $1 AND user_id = $2 AND is_revoked = FALSE
         RETURNING id`,
        [sessionId, userId]
      );
      return (res.rowCount ?? 0) > 0;
    } catch (err: any) {
      console.warn('revokeUserSessionById PG update failed, attempting Supabase REST:', err?.message);
    }
  }

  try {
    const { url, key } = getAuthSupabaseRestConfig();
    const restRes = await fetch(
      `${url}/rest/v1/user_sessions?id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(userId)}&is_revoked=eq.false`,
      {
        method: 'PATCH',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ is_revoked: true }),
      }
    );
    if (restRes.ok) {
      const rows = await restRes.json().catch(() => []);
      return Array.isArray(rows) && rows.length > 0;
    }
  } catch (err: any) {
    console.warn('revokeUserSessionById Supabase REST notice:', err?.message);
  }

  return false;
}

export async function createSession(
  userId: string,
  opts: {
    rememberMe?: boolean;
    userAgent?: string;
    ipAddress?: string;
    user?: { role?: string; email?: string };
    replaceSessionId?: string;
  } = {}
): Promise<SessionInfo> {
  if (opts.replaceSessionId) {
    await revokeUserSessionById(userId, opts.replaceSessionId);
  }

  const activeSessions = await listActiveSessionsForUser(userId);
  if (activeSessions.length >= MAX_ACTIVE_SESSIONS) {
    throw new SessionLimitError(activeSessions, MAX_ACTIVE_SESSIONS);
  }

  const sessionToken = generateCryptoToken(32);
  const sessionTokenHash = hashToken(sessionToken);
  const duration = opts.rememberMe ? REMEMBER_ME_LIFETIME_MS : SESSION_LIFETIME_MS;
  const expiresAt = new Date(Date.now() + duration);

  // 1. Primary path: direct PostgreSQL session persistence
  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `INSERT INTO public.user_sessions (user_id, session_token_hash, user_agent, ip_address, expires_at, last_active_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        [userId, sessionTokenHash, opts.userAgent || null, opts.ipAddress || null, expiresAt]
      );

      if (res.rows[0]?.id) {
        return {
          sessionId: res.rows[0].id,
          sessionToken,
          userId,
          expiresAt,
        };
      }
    } catch (err: any) {
      console.warn('createSession PG insert failed, attempting Supabase REST:', err?.message);
    }
  }

  // 2. Secondary path: Supabase HTTPS REST persistence into user_sessions
  try {
    const { url, key } = getAuthSupabaseRestConfig();
    const nowIso = new Date().toISOString();
    const restRes = await fetch(`${url}/rest/v1/user_sessions`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: userId,
        session_token_hash: sessionTokenHash,
        user_agent: opts.userAgent || null,
        ip_address: opts.ipAddress || null,
        expires_at: expiresAt.toISOString(),
        last_active_at: nowIso,
        is_revoked: false,
      }),
    });

    if (restRes.ok) {
      const rows = await restRes.json().catch(() => []);
      const createdId = Array.isArray(rows) && rows[0]?.id ? String(rows[0].id) : sessionTokenHash.slice(0, 16);
      return {
        sessionId: createdId,
        sessionToken,
        userId,
        expiresAt,
      };
    }
  } catch (err: any) {
    console.warn('createSession Supabase REST insert notice:', err?.message);
  }

  // 3. Cryptographic fallback: server-signed HMAC-SHA256 stateless token (never unsigned)
  const signedToken = signFallbackSessionToken(
    {
      id: userId,
      role: opts.user?.role || 'user',
      email: opts.user?.email || '',
    },
    expiresAt.getTime()
  );
  return {
    sessionId: `hmac_${sessionTokenHash.slice(0, 16)}`,
    sessionToken: signedToken,
    userId,
    expiresAt,
  };
}

export async function revokeSession(sessionToken: string): Promise<boolean> {
  if (!sessionToken || sessionToken.startsWith('direct_') || sessionToken.startsWith('mmf1.')) {
    return false;
  }
  const tokenHash = hashToken(sessionToken);

  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `UPDATE public.user_sessions SET is_revoked = TRUE WHERE session_token_hash = $1`,
        [tokenHash]
      );
      return (res.rowCount ?? 0) > 0;
    } catch (err: any) {
      console.warn('revokeSession PG update failed, attempting Supabase REST:', err?.message);
    }
  }

  try {
    const { url, key } = getAuthSupabaseRestConfig();
    const restRes = await fetch(
      `${url}/rest/v1/user_sessions?session_token_hash=eq.${encodeURIComponent(tokenHash)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ is_revoked: true }),
      }
    );
    return restRes.ok;
  } catch {
    return false;
  }
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `UPDATE public.user_sessions SET is_revoked = TRUE WHERE user_id = $1 AND is_revoked = FALSE`,
        [userId]
      );
      return res.rowCount ?? 0;
    } catch (err: any) {
      console.warn('revokeAllUserSessions PG update failed, attempting Supabase REST:', err?.message);
    }
  }

  try {
    const { url, key } = getAuthSupabaseRestConfig();
    const restRes = await fetch(
      `${url}/rest/v1/user_sessions?user_id=eq.${encodeURIComponent(userId)}&is_revoked=eq.false`,
      {
        method: 'PATCH',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ is_revoked: true }),
      }
    );
    if (restRes.ok) {
      const rows = await restRes.json().catch(() => []);
      return Array.isArray(rows) ? rows.length : 1;
    }
  } catch {}
  return 0;
}

// Extract session token from Authorization header or Cookie header
export function extractSessionToken(req: IncomingMessage): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith('session_token=')) {
        return decodeURIComponent(cookie.slice('session_token='.length).trim());
      }
    }
  }

  return null;
}

function mapRowToAuthenticatedUser(row: any): AuthenticatedUser {
  const isMasterAdmin = isMasterAdminAccountEmail(row.email);
  const metaCompleted =
    row?.custom_permissions && typeof row.custom_permissions === 'object'
      ? row.custom_permissions.__profile_completed
      : undefined;
  const profileCompleted =
    typeof row.profile_completed === 'boolean'
      ? row.profile_completed
      : typeof metaCompleted === 'boolean'
      ? metaCompleted
      : true;

  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    username: row.username || null,
    phone: row.phone,
    role: isMasterAdmin ? 'superadmin' : (row.role || 'user'),
    status: row.status,
    email_verified: row.email_verified,
    avatar_url: row.avatar_url,
    force_password_reset: row.force_password_reset,
    profile_completed: profileCompleted,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    password_changed_at: row.password_changed_at,
  };
}

// Helper: fallback to Supabase REST for user resolution (called ONLY after cryptographic token verification)
async function resolveUserViaSupabaseRest(userId: string): Promise<AuthenticatedUser | null> {
  try {
    const { url: supabaseUrl, key: supabaseKey } = getAuthSupabaseRestConfig();
    const res = await fetch(`${supabaseUrl}/rest/v1/app_users?id=eq.${encodeURIComponent(userId)}&select=*`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: 'application/json',
      },
    });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0 && rows[0].status === 'active') {
        return mapRowToAuthenticatedUser(rows[0]);
      }
    }
  } catch (err) {
    console.warn('resolveUserViaSupabaseRest error:', err);
  }
  return null;
}

// Helper: verify a Supabase Auth JWT by validating it directly with Supabase Auth /auth/v1/user
async function verifySupabaseAccessToken(jwtToken: string): Promise<{ id: string; email?: string } | null> {
  try {
    const { url: supabaseUrl, key: supabaseKey } = getAuthSupabaseRestConfig();
    if (!supabaseUrl || !supabaseKey) {
      return null;
    }

    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${jwtToken}`,
        Accept: 'application/json',
      },
    });
    if (!verifyRes.ok) {
      return null;
    }
    const authUser = await verifyRes.json();
    if (!authUser || typeof authUser.id !== 'string' || !authUser.id.trim()) {
      return null;
    }
    return {
      id: authUser.id.trim(),
      email: typeof authUser.email === 'string' ? authUser.email.toLowerCase().trim() : undefined,
    };
  } catch {
    return null;
  }
}

async function resolveUserByEmailViaSupabaseRest(email: string): Promise<AuthenticatedUser | null> {
  try {
    const { url: supabaseUrl, key: supabaseKey } = getAuthSupabaseRestConfig();
    const res = await fetch(
      `${supabaseUrl}/rest/v1/app_users?email=ilike.${encodeURIComponent(email)}&select=*&limit=1`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Accept: 'application/json',
        },
      }
    );
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0 && rows[0].status === 'active') {
        return mapRowToAuthenticatedUser(rows[0]);
      }
    }
  } catch (err) {
    console.warn('resolveUserByEmailViaSupabaseRest error:', err);
  }
  return null;
}

async function resolveActiveUserById(userId: string): Promise<AuthenticatedUser | null> {
  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `SELECT id, full_name, email, phone, role, status, email_verified, avatar_url, force_password_reset, created_at, last_login_at, password_changed_at
         FROM public.app_users WHERE id = $1`,
        [userId]
      );
      if (res.rows.length > 0 && res.rows[0].status === 'active') {
        return mapRowToAuthenticatedUser(res.rows[0]);
      }
      return null;
    } catch (err) {
      console.warn('resolveActiveUserById DB query failed, attempting Supabase REST fallback:', err);
    }
  }
  return await resolveUserViaSupabaseRest(userId);
}

// Authenticate current request
export async function authenticateRequest(req: IncomingMessage): Promise<AuthenticatedUser | null> {
  const token = extractSessionToken(req);
  if (!token) return null;

  // Explicitly reject legacy unsigned direct_ tokens (security hardening)
  if (token.startsWith('direct_')) {
    return null;
  }

  // Server-issued HMAC-SHA256 signed fallback token (issued only on verified server login when DB is unreachable)
  if (token.startsWith('mmf1.')) {
    const verified = verifyFallbackSessionToken(token);
    if (!verified) return null;
    const resolved = await resolveActiveUserById(verified.userId);
    if (resolved) return resolved;
    return null;
  }

  // Supabase JWT Access Token: MUST be verified against Supabase Auth API (never trust unsigned base64 payloads)
  if (token.includes('.') && token.split('.').length === 3) {
    const verified = await verifySupabaseAccessToken(token);
    if (!verified) return null;
    const byId = await resolveActiveUserById(verified.id);
    if (byId) return byId;
    if (verified.email) {
      if (isDatabaseAvailable()) {
        try {
          const byEmailRes = await query(
            `SELECT id, full_name, email, phone, role, status, email_verified, avatar_url, force_password_reset, created_at, last_login_at, password_changed_at
             FROM public.app_users WHERE LOWER(email) = $1 LIMIT 1`,
            [verified.email]
          );
          if (byEmailRes.rows.length > 0 && byEmailRes.rows[0].status === 'active') {
            return mapRowToAuthenticatedUser(byEmailRes.rows[0]);
          }
        } catch {}
      }
      return await resolveUserByEmailViaSupabaseRest(verified.email);
    }
    return null;
  }

  const tokenHash = hashToken(token);

  async function resolveSessionViaSupabaseRest(): Promise<AuthenticatedUser | null> {
    try {
      const { url: supabaseUrl, key: supabaseKey } = getAuthSupabaseRestConfig();
      const sessRes = await fetch(
        `${supabaseUrl}/rest/v1/user_sessions?session_token_hash=eq.${encodeURIComponent(tokenHash)}&is_revoked=eq.false&select=id,user_id,expires_at`,
        {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Accept: 'application/json' },
        }
      );
      if (sessRes.ok) {
        const sessRows = await sessRes.json();
        if (Array.isArray(sessRows) && sessRows.length > 0) {
          const s = sessRows[0];
          if (new Date(s.expires_at) >= new Date()) {
            const user = await resolveUserViaSupabaseRest(s.user_id);
            if (user && s.id) {
              fetch(`${supabaseUrl}/rest/v1/user_sessions?id=eq.${encodeURIComponent(s.id)}`, {
                method: 'PATCH',
                headers: {
                  apikey: supabaseKey,
                  Authorization: `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ last_active_at: new Date().toISOString() }),
              }).catch(() => {});
            }
            return user;
          }
          if (s.id) {
            fetch(`${supabaseUrl}/rest/v1/user_sessions?id=eq.${encodeURIComponent(s.id)}`, {
              method: 'PATCH',
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ is_revoked: true }),
            }).catch(() => {});
          }
        }
      }
    } catch {}
    return null;
  }

  if (!isDatabaseAvailable()) {
    return await resolveSessionViaSupabaseRest();
  }

  try {
    // Query active session and join with app_users
    const res = await query(
      `SELECT 
          s.id AS session_id,
          s.expires_at,
          s.is_revoked,
          u.id,
          u.full_name,
          u.email,
          u.phone,
          u.role,
          u.status,
          u.email_verified,
          u.avatar_url,
          u.force_password_reset,
          u.created_at,
          u.last_login_at,
          u.password_changed_at
       FROM public.user_sessions s
       JOIN public.app_users u ON s.user_id = u.id
       WHERE s.session_token_hash = $1`,
      [tokenHash]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    // Session checks
    if (row.is_revoked) return null;
    if (new Date(row.expires_at) < new Date()) {
      // Expired
      await query(`UPDATE public.user_sessions SET is_revoked = TRUE WHERE id = $1`, [row.session_id]).catch(() => {});
      return null;
    }

    // Account status check
    if (row.status !== 'active') {
      // Account suspended or deactivated - revoke session
      await query(`UPDATE public.user_sessions SET is_revoked = TRUE WHERE id = $1`, [row.session_id]).catch(() => {});
      return null;
    }

    // Update session last active time
    query(`UPDATE public.user_sessions SET last_active_at = NOW() WHERE id = $1`, [row.session_id]).catch(() => {});

    const isMasterAdmin = Boolean(
      row.email &&
      (row.email.toLowerCase().trim() === 'hackifypro@gmail.com' ||
       row.email.toLowerCase().trim() === 'admin@mymoney.com')
    );

    return {
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      role: isMasterAdmin ? 'superadmin' : (row.role || 'user'),
      status: row.status,
      email_verified: row.email_verified,
      avatar_url: row.avatar_url,
      force_password_reset: row.force_password_reset,
      created_at: row.created_at,
      last_login_at: row.last_login_at,
      password_changed_at: row.password_changed_at,
    };
  } catch (err: any) {
    console.warn('authenticateRequest query failed, attempting Supabase REST fallback:', err.message);
    return await resolveSessionViaSupabaseRest();
  }
}

export function sanitizeUserOutput(user: AuthenticatedUser & { custom_permissions?: any }) {
  const metaCompleted =
    user?.custom_permissions && typeof user.custom_permissions === 'object'
      ? user.custom_permissions.__profile_completed
      : undefined;
  const profileCompleted =
    typeof user.profile_completed === 'boolean'
      ? user.profile_completed
      : typeof metaCompleted === 'boolean'
      ? metaCompleted
      : true;

  return {
    id: user.id,
    uid: user.id, // compatibility alias
    full_name: user.full_name,
    displayName: user.full_name, // compatibility alias
    email: user.email,
    username: user.username || null,
    phone: user.phone || null,
    role: user.role,
    status: user.status,
    email_verified: user.email_verified,
    avatar_url: user.avatar_url || null,
    force_password_reset: user.force_password_reset,
    profile_completed: profileCompleted,
    profileCompleted, // compatibility alias
    created_at: user.created_at,
    createdAt: user.created_at, // compatibility alias
    last_login_at: user.last_login_at || null,
    password_changed_at: user.password_changed_at,
  };
}
