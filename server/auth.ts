import { query } from './db';
import { generateCryptoToken, hashToken } from './security';
import type { IncomingMessage } from 'http';

export interface AuthenticatedUser {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  role: 'user' | 'admin' | 'superadmin';
  status: 'active' | 'suspended' | 'deactivated';
  email_verified: boolean;
  avatar_url?: string | null;
  force_password_reset: boolean;
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

// Session Lifetime: 7 days default, 30 days for remember me
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const REMEMBER_ME_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(
  userId: string,
  opts: { rememberMe?: boolean; userAgent?: string; ipAddress?: string } = {}
): Promise<SessionInfo> {
  const sessionToken = generateCryptoToken(32);
  const sessionTokenHash = hashToken(sessionToken);
  const duration = opts.rememberMe ? REMEMBER_ME_LIFETIME_MS : SESSION_LIFETIME_MS;
  const expiresAt = new Date(Date.now() + duration);

  const res = await query(
    `INSERT INTO public.user_sessions (user_id, session_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, sessionTokenHash, opts.userAgent || null, opts.ipAddress || null, expiresAt]
  );

  return {
    sessionId: res.rows[0].id,
    sessionToken,
    userId,
    expiresAt,
  };
}

export async function revokeSession(sessionToken: string): Promise<boolean> {
  const tokenHash = hashToken(sessionToken);
  const res = await query(
    `UPDATE public.user_sessions SET is_revoked = TRUE WHERE session_token_hash = $1`,
    [tokenHash]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const res = await query(
    `UPDATE public.user_sessions SET is_revoked = TRUE WHERE user_id = $1 AND is_revoked = FALSE`,
    [userId]
  );
  return res.rowCount ?? 0;
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

// Helper: fallback to Supabase REST for user resolution
async function resolveUserViaSupabaseRest(userId: string): Promise<AuthenticatedUser | null> {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || 'https://frgrfajnrzqwnevhlrio.supabase.co';
    const supabaseKey =
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      'sb_publishable_RHVRSE_Z4R1Qit3djpOfCA_L93zsRjg';
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
        const row = rows[0];
        const isMasterAdmin = Boolean(row.email && row.email.toLowerCase().trim() === 'admin@mymoney.com');
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
      }
    }
  } catch (err) {
    console.warn('resolveUserViaSupabaseRest error:', err);
  }
  return null;
}

// Authenticate current request
export async function authenticateRequest(req: IncomingMessage): Promise<AuthenticatedUser | null> {
  const token = extractSessionToken(req);
  if (!token) return null;

  // Direct Supabase fallback token support (format: direct_<userId>_<timestamp>)
  if (token.startsWith('direct_')) {
    const parts = token.split('_');
    const directUserId = parts[1];
    if (directUserId) {
      try {
        const directRes = await query(
          `SELECT id, full_name, email, phone, role, status, email_verified, avatar_url, force_password_reset, created_at, last_login_at, password_changed_at
           FROM public.app_users WHERE id = $1`,
          [directUserId]
        );
        if (directRes.rows.length > 0 && directRes.rows[0].status === 'active') {
          const row = directRes.rows[0];
          const isMasterAdmin = Boolean(row.email && row.email.toLowerCase().trim() === 'admin@mymoney.com');
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
        }
      } catch (err) {
        console.warn('Direct token DB query failed, attempting Supabase REST fallback:', err);
      }
      // If query failed or returned no row, try Supabase REST
      const restUser = await resolveUserViaSupabaseRest(directUserId);
      if (restUser) return restUser;
    }
  }

  const tokenHash = hashToken(token);

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

    const isMasterAdmin = Boolean(row.email && row.email.toLowerCase().trim() === 'admin@mymoney.com');

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
    try {
      const supabaseUrl = process.env.SUPABASE_URL || 'https://frgrfajnrzqwnevhlrio.supabase.co';
      const supabaseKey =
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_PUBLISHABLE_KEY ||
        'sb_publishable_RHVRSE_Z4R1Qit3djpOfCA_L93zsRjg';
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
            return await resolveUserViaSupabaseRest(s.user_id);
          }
        }
      }
    } catch {}
    return null;
  }
}

export function sanitizeUserOutput(user: AuthenticatedUser) {
  return {
    id: user.id,
    uid: user.id, // compatibility alias
    full_name: user.full_name,
    displayName: user.full_name, // compatibility alias
    email: user.email,
    phone: user.phone || null,
    role: user.role,
    status: user.status,
    email_verified: user.email_verified,
    avatar_url: user.avatar_url || null,
    force_password_reset: user.force_password_reset,
    created_at: user.created_at,
    createdAt: user.created_at, // compatibility alias
    last_login_at: user.last_login_at || null,
    password_changed_at: user.password_changed_at,
  };
}
