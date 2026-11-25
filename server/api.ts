import type { IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import crypto from 'crypto';
import { query, pool, isDatabaseConfigured, isDatabaseAvailable } from './db';
import {
  validatePasswordPolicy,
  validateEmail,
  normalizeEmail,
  validatePhone,
  hashPassword,
  verifyPassword,
  hashToken,
  generateCryptoToken,
  checkRateLimit,
  resetRateLimit,
  logSecurityEvent,
} from './security';
import {
  createSession,
  revokeSession,
  revokeAllUserSessions,
  authenticateRequest,
  sanitizeUserOutput,
} from './auth';
import {
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendWelcomeEmail,
  sendAccountStatusEmail,
  getWelcomeEmailDeliveryStatus,
  sendAccountDeletionRequestedEmail,
  sendAccountDeletionCancelledEmail,
  sendAccountDeletionCompletedEmail,
  sendFeedbackSubmissionEmails,
  sendUdharCreatedEmails,
  sendUdharSettledEmails,
  sendUdharUpdatedEmails,
  sendContactInvitationEmail,
  sendComplaintConfirmationEmail,
  sendSupportTicketConfirmationEmail,
} from './email';
import { APP_CONFIG } from './config';
import { handleAdminApiRequest } from './adminApi';
import { handleAiFinanceRequest } from './aiFinanceApi';
import {
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
  registerPushSubscription,
  listUserPushSubscriptions,
  removePushSubscriptionByEndpoint,
  removePushSubscriptionById,
  getPushDeliveryStatus,
  createNotification,
  notifyTransactionCreated,
  notifyFinancialAlert,
  notifyUdharCreated,
  notifyUdharRepayment,
  notifyQrConnected,
  notifyFeedbackSubmitted,
  notifyAdminNewFeedback,
  notifyComplaintSubmitted,
  processScheduledCampaigns,
  recordDeviceInstallation,
  recordAdminNotification,
} from './notificationService';
import {
  normalizeSearchQuery,
  maskEmailForPrivacy,
  maskPhoneForPrivacy,
  parseQrPayload,
  calculateRepaymentApplication,
  validateUdharEdit,
  canCancelUdhar,
  calculatePeopleDashboardSummary,
  packStructuredNote,
  unpackStructuredNote,
  roundMoney,
} from '../src/lib/sharedUdharEngine';
import {
  searchUsersRest,
  connectUserRest,
  getContactsRest,
  getContactsWithBalancesRest,
  saveContactRest,
  updateContactRest,
  deleteContactRest,
  linkContactRest,
  getMyQrRest,
  regenerateQrRest,
  resolveQrRest,
  connectQrRest,
  getUdharTransactionsRest,
  createUdharTransactionRest,
  confirmUdharTransactionRest,
  disputeUdharTransactionRest,
  repayUdharRest,
  confirmRepaymentRest,
  rejectRepaymentRest,
  editUdharRest,
  settleUdharRest,
  cancelUdharRest,
  getUdharHistoryRest,
} from './supabaseRestUdhar';

// Helper: parse JSON body from incoming request
async function parseJsonBody(req: IncomingMessage): Promise<any> {
  // If Vercel or middleware already consumed and parsed JSON body
  if ((req as any).body !== undefined && (req as any).body !== null) {
    if (typeof (req as any).body === 'object') {
      return (req as any).body;
    }
    if (typeof (req as any).body === 'string') {
      try {
        return JSON.parse((req as any).body);
      } catch {
        return {};
      }
    }
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      // Protect against request flooding: max 1MB
      if (body.length > 1024 * 1024) {
        reject(new Error('Request payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

// Helper: send standard JSON response
function sendJson(res: ServerResponse, statusCode: number, data: any, headers: Record<string, string> = {}) {
  // Support Vercel serverless response object
  if (typeof (res as any).status === 'function' && typeof (res as any).json === 'function') {
    for (const [k, v] of Object.entries(headers)) {
      res.setHeader(k, v);
    }
    return (res as any).status(statusCode).json(data);
  }

  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    ...headers,
  });
  res.end(payload);
}

// Helper: get client IP address
function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// Helper: set session cookie
function setSessionCookie(res: ServerResponse, sessionToken: string, expiresAt: Date) {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieVal = [
    `session_token=${encodeURIComponent(sessionToken)}`,
    `Expires=${expiresAt.toUTCString()}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isProd ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');

  res.setHeader('Set-Cookie', cookieVal);
}

// Helper: clear session cookie
function clearSessionCookie(res: ServerResponse) {
  res.setHeader('Set-Cookie', 'session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax');
}

// -----------------------------------------------------------------------------
// AUTOMATED 24-HOUR ACCOUNT DELETION BACKGROUND EXECUTION WORKER
// - Idempotent execution
// - Permanently deletes/anonymizes eligible user records after 24-hour countdown
// - Revokes all active sessions & authentication tokens
// - Retains only legally mandated audit logs
// -----------------------------------------------------------------------------
export async function processExpiredAccountDeletions(): Promise<number> {
  if (!isDatabaseAvailable()) return 0;
  let count = 0;
  try {
    const expiredRes = await query(
      `SELECT r.*, u.full_name, u.email 
       FROM public.account_deletion_requests r
       JOIN public.app_users u ON r.user_id = u.id
       WHERE r.status = 'pending' AND r.scheduled_for <= NOW()`
    );

    for (const req of expiredRes.rows) {
      count++;
      const userId = req.user_id;
      const userEmail = req.email;
      const userName = req.full_name;

      console.log(`[Account Deletion Worker] Purging account & records for user ${userId} (${userEmail})...`);

      // 1. Delete financial transactions
      await query('DELETE FROM public.transactions WHERE user_id = $1', [userId]).catch(() => {});
      // 2. Delete udhar repayments
      await query('DELETE FROM public.udhar_repayments WHERE recorded_by_user_id = $1', [userId]).catch(() => {});
      // 3. Delete udhar transactions
      await query('DELETE FROM public.udhar_transactions WHERE user_id = $1', [userId]).catch(() => {});
      // 4. Delete saved contacts
      await query('DELETE FROM public.udhar_contacts WHERE user_id = $1', [userId]).catch(() => {});
      // 5. Delete qr pairing tokens
      await query('DELETE FROM public.qr_pairing_tokens WHERE user_id = $1', [userId]).catch(() => {});
      // 6. Delete user connections
      await query('DELETE FROM public.user_connections WHERE user_a_id = $1 OR user_b_id = $1', [userId]).catch(() => {});
      // 7. Revoke and delete sessions
      await query('DELETE FROM public.user_sessions WHERE user_id = $1', [userId]).catch(() => {});
      // 8. Delete password resets
      await query('DELETE FROM public.password_resets WHERE user_id = $1', [userId]).catch(() => {});
      // 9. Mark request executed
      await query(
        `UPDATE public.account_deletion_requests 
         SET status = 'executed', executed_at = NOW() 
         WHERE id = $1`,
        [req.id]
      );
      // 10. Delete user record
      await query('DELETE FROM public.app_users WHERE id = $1', [userId]).catch(() => {});

      // Dispatch final completion email notification
      sendAccountDeletionCompletedEmail(userEmail, userName).catch(() => {});

      await logSecurityEvent('ACCOUNT_DELETION_EXECUTED_AUTO', {
        userId,
        userEmail,
        details: { requestId: req.id, scheduledFor: req.scheduled_for },
      });
    }
  } catch (err: any) {
    console.warn('[Account Deletion Worker Notice]:', err.message);
  }
  return count;
}

// Background timer: runs check every 60 seconds (only when PostgreSQL is connected and not running in Vercel serverless)
if (isDatabaseConfigured && !process.env.VERCEL && !(globalThis as any).__accountDeletionWorkerTimer) {
  const timer = setInterval(() => {
    processExpiredAccountDeletions().catch(() => {});
  }, 60000);
  if (typeof timer?.unref === 'function') timer.unref();
  (globalThis as any).__accountDeletionWorkerTimer = timer;
}

// Background timer: runs scheduled notification campaigns every 60 seconds (only when PostgreSQL is connected and not running in Vercel serverless)
if (isDatabaseConfigured && !process.env.VERCEL && !(globalThis as any).__scheduledCampaignsWorkerTimer) {
  const timer = setInterval(() => {
    processScheduledCampaigns().catch(() => {});
  }, 60000);
  if (typeof timer?.unref === 'function') timer.unref();
  (globalThis as any).__scheduledCampaignsWorkerTimer = timer;
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const parsed = parseUrl(req.url || '', true);
  let pathname = parsed.pathname || '';

  // Handle Vercel rewrite where pathname might be /api/[...all]
  if (pathname.includes('[...all]') || pathname.includes('[all]')) {
    const queryAll = (req as any).query?.all;
    if (queryAll) {
      const sub = Array.isArray(queryAll) ? queryAll.join('/') : queryAll;
      pathname = `/api/${sub}`;
    } else if (req.headers['x-forwarded-uri']) {
      pathname = parseUrl(req.headers['x-forwarded-uri'] as string, true).pathname || '';
    }
  }

  const method = req.method?.toUpperCase() || 'GET';

  // Only handle /api/* routes
  if (!pathname.startsWith('/api/')) {
    return false;
  }

  // When direct PostgreSQL is not configured or unavailable, return 503 on auth/profile/admin-users routes
  // so the client's built-in Supabase HTTPS fallback activates immediately instead of returning false 401s.
  if (
    !isDatabaseAvailable() &&
    (pathname.startsWith('/api/auth/') ||
      pathname.startsWith('/api/profile') ||
      pathname.startsWith('/api/admin/users'))
  ) {
    sendJson(res, 503, {
      success: false,
      message: 'PostgreSQL database is not connected in this preview environment.',
    });
    return true;
  }

  const clientIp = getClientIp(req);
  const userAgent = (req.headers['user-agent'] as string) || '';
  const requestOrigin = (req.headers['origin'] as string) || '';
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers['host'] || '').split(',')[0].trim();

  const isAllowedOrigin = (orig: string): boolean => {
    if (!orig) return false;
    try {
      const parsed = new URL(orig);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      if (hostHeader && parsed.host === hostHeader) return true;
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return true;
      if (parsed.hostname === 'mymoney-two-rho.vercel.app') return true;
      if (parsed.hostname.endsWith('.run.app')) return true;
      const configuredAppUrl = process.env.APP_URL || '';
      if (configuredAppUrl) {
        try {
          if (new URL(configuredAppUrl).origin === parsed.origin) return true;
        } catch {}
      }
      return false;
    } catch {
      return false;
    }
  };

  if (requestOrigin && isAllowedOrigin(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  // Lightweight health check (no secrets exposed)
  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, {
      success: true,
      status: 'ok',
      databaseAvailable: isDatabaseAvailable(),
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  try {
    // ---------------------------------------------------------
    // 0. ADMIN CONTROL CENTER DISPATCH (RBAC Protected)
    // ---------------------------------------------------------
    if (pathname.startsWith('/api/admin/')) {
      const handled = await handleAdminApiRequest(req, res, pathname, method);
      if (handled) return true;
    }

    // ---------------------------------------------------------
    // 0B. AI & FINANCIAL INTELLIGENCE DISPATCH (Auth Protected)
    // ---------------------------------------------------------
    if (pathname.startsWith('/api/ai/') || pathname.startsWith('/api/finance/')) {
      const handled = await handleAiFinanceRequest(req, res, pathname, method);
      if (handled) return true;
    }

    // ---------------------------------------------------------
    // 1. REGISTER: POST /api/auth/register
    // ---------------------------------------------------------
    if (pathname === '/api/auth/register' && method === 'POST') {
      const rate = checkRateLimit(`register:${clientIp}`, 10, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { success: false, message: 'Too many registration attempts. Please wait.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const fullName = (body.fullName || body.name || '').trim();
      const rawEmail = (body.email || '').trim();
      const phone = (body.phone || '').trim();
      const password = body.password || '';
      const confirmPassword = body.confirmPassword || '';

      // Validation
      const errors: string[] = [];
      if (!fullName || fullName.length < 2) errors.push('Full name must be at least 2 characters.');
      if (!validateEmail(rawEmail)) errors.push('Please enter a valid email address.');
      if (phone && !validatePhone(phone)) errors.push('Please enter a valid phone number (10-15 digits).');

      const passVal = validatePasswordPolicy(password);
      if (!passVal.isValid) errors.push(...passVal.errors);

      if (password !== confirmPassword) errors.push('Passwords do not match.');

      if (errors.length > 0) {
        sendJson(res, 400, { success: false, message: errors[0], errors });
        return true;
      }

      const email = normalizeEmail(rawEmail);

      // Duplicate email check
      const dup = await query('SELECT id FROM public.app_users WHERE LOWER(email) = $1', [email]);
      if (dup.rows.length > 0) {
        sendJson(res, 409, {
          success: false,
          message: 'An account with this email address already exists. Please log in or reset your password.',
        });
        return true;
      }

      // Hash password with bcrypt (12 rounds)
      const passwordHash = await hashPassword(password);

      // Default role is strictly 'user' from backend authority
      const userRes = await query(
        `INSERT INTO public.app_users (
          full_name, email, phone, password_hash, role, status, email_verified
        ) VALUES ($1, $2, $3, $4, 'user', 'active', FALSE)
        RETURNING *`,
        [fullName, email, phone || null, passwordHash]
      );

      const newUser = userRes.rows[0];

      // Create session
      const session = await createSession(newUser.id, { userAgent, ipAddress: clientIp });
      setSessionCookie(res, session.sessionToken, session.expiresAt);

      // Async send welcome email (non-blocking, trusted user record from DB, idempotent)
      sendWelcomeEmail(email, newUser.full_name, newUser.id).catch((err) => {
        console.error('[Welcome Email Background Error]:', err);
      });

      // Dispatch two-way notification to administrators
      recordAdminNotification({
        eventType: 'new_user',
        title: 'New User Registered',
        message: `${newUser.full_name} (${email}) created a new account.`,
        userId: newUser.id,
        userEmail: email,
        metadata: { role: 'user', registeredAt: new Date().toISOString() },
      }).catch(() => {});

      await logSecurityEvent('USER_REGISTER_SUCCESS', {
        userId: newUser.id,
        userEmail: email,
        actorRole: 'user',
        ipAddress: clientIp,
      });

      sendJson(res, 201, {
        success: true,
        message: 'Account created successfully!',
        user: sanitizeUserOutput(newUser),
        sessionToken: session.sessionToken,
      });
      return true;
    }

    // ---------------------------------------------------------
    // 2. LOGIN: POST /api/auth/login
    // ---------------------------------------------------------
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await parseJsonBody(req);
      const email = normalizeEmail(body.email || '');
      const password = body.password || '';
      const rememberMe = Boolean(body.rememberMe);

      // Rate limiting: 25 attempts per 5 minutes per IP
      const rate = checkRateLimit(`login_ip:${clientIp}`, 25, 5 * 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, {
          success: false,
          message: `Too many login attempts from this network. Try again in ${rate.retryAfterSec} seconds.`,
        });
        return true;
      }

      if (!email || !password) {
        sendJson(res, 400, { success: false, message: 'Email and password are required.' });
        return true;
      }

      // Query user
      const userRes = await query('SELECT * FROM public.app_users WHERE LOWER(email) = $1', [email]);
      if (userRes.rows.length === 0) {
        await logSecurityEvent('LOGIN_FAILED_UNKNOWN_EMAIL', { userEmail: email, ipAddress: clientIp });
        sendJson(res, 401, { success: false, message: 'Invalid email or password.' });
        return true;
      }

      const user = userRes.rows[0];

      // Check account lockout
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const remainingSec = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 1000);
        sendJson(res, 429, {
          success: false,
          message: `Account is temporarily locked due to multiple failed login attempts. Try again in ${Math.ceil(remainingSec / 60)} minute(s).`,
        });
        return true;
      }

      // Check account status
      if (user.status === 'suspended') {
        await logSecurityEvent('LOGIN_BLOCKED_SUSPENDED', { userId: user.id, userEmail: email, ipAddress: clientIp });
        sendJson(res, 403, {
          success: false,
          message: 'Your account has been suspended by an administrator. Please contact security support.',
        });
        return true;
      }

      if (user.status === 'deactivated') {
        sendJson(res, 403, {
          success: false,
          message: 'This account has been deactivated. Please contact support to reactivate.',
        });
        return true;
      }

      // Verify bcrypt password
      const isValid = await verifyPassword(password, user.password_hash);
      if (!isValid) {
        const attempts = (user.failed_login_attempts || 0) + 1;
        let lockSql = 'UPDATE public.app_users SET failed_login_attempts = $1 WHERE id = $2';
        let lockParams: any[] = [attempts, user.id];

        if (attempts >= 5) {
          // Lock account for 15 minutes
          lockSql = "UPDATE public.app_users SET failed_login_attempts = $1, locked_until = NOW() + INTERVAL '15 minutes' WHERE id = $2";
        }
        await query(lockSql, lockParams);

        await logSecurityEvent('LOGIN_FAILED_BAD_PASSWORD', { userId: user.id, userEmail: email, ipAddress: clientIp });
        sendJson(res, 401, { success: false, message: 'Invalid email or password.' });
        return true;
      }

      // Reset failed login attempts and update last login
      await query(
        `UPDATE public.app_users 
         SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW(), last_login_ip = $1 
         WHERE id = $2`,
        [clientIp, user.id]
      );

      // Create session
      const session = await createSession(user.id, { rememberMe, userAgent, ipAddress: clientIp });
      setSessionCookie(res, session.sessionToken, session.expiresAt);

      resetRateLimit(`login_ip:${clientIp}`);

      await logSecurityEvent('USER_LOGIN_SUCCESS', {
        userId: user.id,
        userEmail: email,
        actorRole: user.role,
        ipAddress: clientIp,
      });

      sendJson(res, 200, {
        success: true,
        message: 'Logged in successfully.',
        user: sanitizeUserOutput(user),
        sessionToken: session.sessionToken,
      });
      return true;
    }

    // ---------------------------------------------------------
    // 3. LOGOUT: POST /api/auth/logout
    // ---------------------------------------------------------
    if (pathname === '/api/auth/logout' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      const token = (req.headers['authorization']?.slice(7) || '').trim();
      if (token) {
        await revokeSession(token);
      }
      clearSessionCookie(res);

      if (authUser) {
        await logSecurityEvent('USER_LOGOUT', { userId: authUser.id, userEmail: authUser.email, ipAddress: clientIp });
      }

      sendJson(res, 200, { success: true, message: 'Logged out successfully.' });
      return true;
    }

    // ---------------------------------------------------------
    // 4. LOGOUT ALL DEVICES: POST /api/auth/logout-all-devices
    // ---------------------------------------------------------
    if (pathname === '/api/auth/logout-all-devices' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      await revokeAllUserSessions(authUser.id);
      clearSessionCookie(res);

      await logSecurityEvent('USER_LOGOUT_ALL_DEVICES', {
        userId: authUser.id,
        userEmail: authUser.email,
        ipAddress: clientIp,
      });

      sendJson(res, 200, { success: true, message: 'All active sessions on all devices have been revoked.' });
      return true;
    }

    // ---------------------------------------------------------
    // 5. CURRENT USER: GET /api/auth/me
    // ---------------------------------------------------------
    if (pathname === '/api/auth/me' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Not authenticated or session expired.' });
        return true;
      }

      sendJson(res, 200, {
        success: true,
        user: sanitizeUserOutput(authUser),
      });
      return true;
    }

    // ---------------------------------------------------------
    // 6. GET PROFILE: GET /api/profile
    // ---------------------------------------------------------
    if (pathname === '/api/profile' && method === 'GET') {
      try {
        const authUser = await authenticateRequest(req);
        if (!authUser) {
          sendJson(res, 401, { success: false, message: 'Authentication required.' });
          return true;
        }

        // Count active sessions with defensive catch
        let activeSessionsCount = 1;
        try {
          const sessRes = await query(
            `SELECT COUNT(*) as count FROM public.user_sessions 
             WHERE user_id = $1 AND is_revoked = FALSE AND expires_at > NOW()`,
            [authUser.id]
          );
          activeSessionsCount = parseInt(sessRes.rows[0]?.count || '1');
        } catch {
          activeSessionsCount = 1;
        }

        sendJson(res, 200, {
          success: true,
          profile: {
            ...sanitizeUserOutput(authUser),
            activeSessionsCount,
          },
        });
        return true;
      } catch (err: any) {
        console.error('Error in GET /api/profile:', err);
        sendJson(res, 500, { success: false, message: err.message || 'Failed to retrieve user profile.' });
        return true;
      }
    }

    // ---------------------------------------------------------
    // 7. UPDATE PROFILE: PUT /api/profile
    // ---------------------------------------------------------
    if (pathname === '/api/profile' && method === 'PUT') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const fullName = (body.fullName || body.full_name || authUser.full_name).trim();
      const phone = (body.phone !== undefined ? body.phone : authUser.phone || '').trim();
      const avatarUrl = body.avatarUrl !== undefined ? body.avatarUrl : authUser.avatar_url;

      if (!fullName || fullName.length < 2) {
        sendJson(res, 400, { success: false, message: 'Full name must be at least 2 characters.' });
        return true;
      }

      if (phone && !validatePhone(phone)) {
        sendJson(res, 400, { success: false, message: 'Please enter a valid phone number (10-15 digits).' });
        return true;
      }

      const updatedRes = await query(
        `UPDATE public.app_users 
         SET full_name = $1, phone = $2, avatar_url = $3, updated_at = NOW() 
         WHERE id = $4 
         RETURNING *`,
        [fullName, phone || null, avatarUrl || null, authUser.id]
      );

      await logSecurityEvent('PROFILE_UPDATED', {
        userId: authUser.id,
        userEmail: authUser.email,
        ipAddress: clientIp,
      });

      sendJson(res, 200, {
        success: true,
        message: 'Profile updated successfully.',
        user: sanitizeUserOutput(updatedRes.rows[0]),
      });
      return true;
    }

    // ---------------------------------------------------------
    // 8. CHANGE PASSWORD: POST /api/profile/change-password
    // ---------------------------------------------------------
    if (pathname === '/api/profile/change-password' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const currentPassword = body.currentPassword || '';
      const newPassword = body.newPassword || '';
      const confirmNewPassword = body.confirmNewPassword || '';

      if (!currentPassword) {
        sendJson(res, 400, { success: false, message: 'Current password is required.' });
        return true;
      }

      // Fetch user's current password hash
      const userRes = await query('SELECT password_hash FROM public.app_users WHERE id = $1', [authUser.id]);
      const currentHash = userRes.rows[0]?.password_hash;

      const isCurrentValid = await verifyPassword(currentPassword, currentHash);
      if (!isCurrentValid) {
        await logSecurityEvent('PASSWORD_CHANGE_FAILED_WRONG_CURRENT', {
          userId: authUser.id,
          userEmail: authUser.email,
          ipAddress: clientIp,
        });
        sendJson(res, 400, { success: false, message: 'Current password is incorrect.' });
        return true;
      }

      // Validate new password policy
      const passVal = validatePasswordPolicy(newPassword);
      if (!passVal.isValid) {
        sendJson(res, 400, { success: false, message: passVal.errors[0], errors: passVal.errors });
        return true;
      }

      if (newPassword !== confirmNewPassword) {
        sendJson(res, 400, { success: false, message: 'New password and confirm password do not match.' });
        return true;
      }

      if (newPassword === currentPassword) {
        sendJson(res, 400, { success: false, message: 'New password cannot be the same as your current password.' });
        return true;
      }

      // Hash new password
      const newHash = await hashPassword(newPassword);

      // Update password in DB
      await query(
        `UPDATE public.app_users 
         SET password_hash = $1, password_changed_at = NOW(), force_password_reset = FALSE, updated_at = NOW() 
         WHERE id = $2`,
        [newHash, authUser.id]
      );

      // Revoke all other sessions (keep current session active)
      const currentToken = (req.headers['authorization']?.slice(7) || '').trim();
      if (currentToken) {
        const curHash = hashToken(currentToken);
        await query(
          `UPDATE public.user_sessions 
           SET is_revoked = TRUE 
           WHERE user_id = $1 AND session_token_hash <> $2`,
          [authUser.id, curHash]
        );
      }

      // Async send password changed email
      sendPasswordChangedEmail(authUser.email, authUser.full_name, clientIp).catch(() => {});

      await logSecurityEvent('PASSWORD_CHANGED_SUCCESS', {
        userId: authUser.id,
        userEmail: authUser.email,
        ipAddress: clientIp,
      });

      sendJson(res, 200, {
        success: true,
        message: 'Your password was changed successfully. A security confirmation email was dispatched.',
      });
      return true;
    }

    // ---------------------------------------------------------
    // 9. DELETE ACCOUNT: DELETE /api/profile/delete-account
    // ---------------------------------------------------------
    if (pathname === '/api/profile/delete-account' && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const password = body.password || '';

      if (!password) {
        sendJson(res, 400, { success: false, message: 'Password confirmation is required to delete your account.' });
        return true;
      }

      const userRes = await query('SELECT password_hash FROM public.app_users WHERE id = $1', [authUser.id]);
      const currentHash = userRes.rows[0]?.password_hash;

      const isCurrentValid = await verifyPassword(password, currentHash);
      if (!isCurrentValid) {
        sendJson(res, 400, { success: false, message: 'Incorrect password. Account deletion aborted.' });
        return true;
      }

      // Delete transactions, sessions, user
      await query('DELETE FROM public.transactions WHERE user_id = $1', [authUser.id]).catch(() => {});
      await query('DELETE FROM public.user_sessions WHERE user_id = $1', [authUser.id]);
      await query('DELETE FROM public.password_resets WHERE user_id = $1', [authUser.id]);
      await query('DELETE FROM public.app_users WHERE id = $1', [authUser.id]);

      clearSessionCookie(res);

      await logSecurityEvent('ACCOUNT_DELETED_BY_USER', {
        userId: authUser.id,
        userEmail: authUser.email,
        ipAddress: clientIp,
      });

      sendJson(res, 200, { success: true, message: 'Your account and all associated data have been permanently deleted.' });
      return true;
    }

    // ---------------------------------------------------------
    // 10. FORGOT PASSWORD: POST /api/auth/forgot-password
    // ---------------------------------------------------------
    if (pathname === '/api/auth/forgot-password' && method === 'POST') {
      const rate = checkRateLimit(`forgot_pass:${clientIp}`, 5, 15 * 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, {
          success: false,
          message: 'Too many reset requests. Please wait a few minutes before trying again.',
        });
        return true;
      }

      const body = await parseJsonBody(req);
      const email = normalizeEmail(body.email || '');

      if (!validateEmail(email)) {
        sendJson(res, 400, { success: false, message: 'Please provide a valid email address.' });
        return true;
      }

      const userRes = await query('SELECT id, full_name, email, status FROM public.app_users WHERE LOWER(email) = $1', [email]);
      
      // Prevent Email Enumeration: Always return identical success response
      const standardResponse = {
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.',
      };

      if (userRes.rows.length === 0) {
        await logSecurityEvent('FORGOT_PASSWORD_UNKNOWN_EMAIL', { userEmail: email, ipAddress: clientIp });
        sendJson(res, 200, standardResponse);
        return true;
      }

      const user = userRes.rows[0];
      if (user.status !== 'active') {
        sendJson(res, 200, standardResponse);
        return true;
      }

      // Generate cryptographically secure random token (32 bytes = 64 hex chars)
      const rawToken = generateCryptoToken(32);
      const tokenHash = hashToken(rawToken);

      // Invalidate any previous unused reset tokens for this user
      await query('UPDATE public.password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE', [user.id]);

      // Set 15-minute expiration
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await query(
        `INSERT INTO public.password_resets (user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, tokenHash, expiresAt, clientIp, userAgent]
      );

      const appBase = process.env.APP_BASE_URL || 'https://mymoney.nileshbarela.site';
      const resetLink = `${appBase}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

      // Dispatch real email via Nodemailer
      await sendPasswordResetEmail(user.email, user.full_name, resetLink);

      await logSecurityEvent('FORGOT_PASSWORD_LINK_GENERATED', {
        userId: user.id,
        userEmail: user.email,
        ipAddress: clientIp,
      });

      sendJson(res, 200, {
        ...standardResponse,
        // In local dev, include resetLink for instant testing convenience
        resetLink: process.env.NODE_ENV !== 'production' ? resetLink : undefined,
      });
      return true;
    }

    // ---------------------------------------------------------
    // 11. VERIFY RESET TOKEN: POST /api/auth/verify-reset-token
    // ---------------------------------------------------------
    if (pathname === '/api/auth/verify-reset-token' && method === 'POST') {
      const body = await parseJsonBody(req);
      const rawToken = body.token || '';

      if (!rawToken) {
        sendJson(res, 400, { valid: false, message: 'Reset token is missing.' });
        return true;
      }

      const tokenHash = hashToken(rawToken);
      const resDb = await query(
        `SELECT pr.id, pr.expires_at, pr.used, u.email, u.full_name
         FROM public.password_resets pr
         JOIN public.app_users u ON pr.user_id = u.id
         WHERE pr.token_hash = $1`,
        [tokenHash]
      );

      if (resDb.rows.length === 0) {
        sendJson(res, 200, { valid: false, message: 'Invalid reset token.' });
        return true;
      }

      const record = resDb.rows[0];
      if (record.used) {
        sendJson(res, 200, { valid: false, message: 'This reset token has already been used.' });
        return true;
      }

      if (new Date(record.expires_at) < new Date()) {
        sendJson(res, 200, { valid: false, message: 'This password reset link has expired. Please request a new one.' });
        return true;
      }

      sendJson(res, 200, {
        valid: true,
        email: record.email,
        name: record.full_name,
      });
      return true;
    }

    // ---------------------------------------------------------
    // 12. RESET PASSWORD: POST /api/auth/reset-password
    // ---------------------------------------------------------
    if (pathname === '/api/auth/reset-password' && method === 'POST') {
      const body = await parseJsonBody(req);
      const rawToken = body.token || '';
      const newPassword = body.newPassword || '';
      const confirmPassword = body.confirmPassword || '';

      if (!rawToken) {
        sendJson(res, 400, { success: false, message: 'Reset token is required.' });
        return true;
      }

      const tokenHash = hashToken(rawToken);
      const resDb = await query(
        `SELECT pr.id, pr.user_id, pr.expires_at, pr.used, u.email, u.full_name
         FROM public.password_resets pr
         JOIN public.app_users u ON pr.user_id = u.id
         WHERE pr.token_hash = $1`,
        [tokenHash]
      );

      if (resDb.rows.length === 0 || resDb.rows[0].used || new Date(resDb.rows[0].expires_at) < new Date()) {
        sendJson(res, 400, {
          success: false,
          message: 'This reset link is invalid, expired, or has already been used. Please request a new one.',
        });
        return true;
      }

      const record = resDb.rows[0];

      // Validate new password policy
      const passVal = validatePasswordPolicy(newPassword);
      if (!passVal.isValid) {
        sendJson(res, 400, { success: false, message: passVal.errors[0], errors: passVal.errors });
        return true;
      }

      if (newPassword !== confirmPassword) {
        sendJson(res, 400, { success: false, message: 'Passwords do not match.' });
        return true;
      }

      // Hash with bcrypt
      const passwordHash = await hashPassword(newPassword);

      // Update user password and clear force_password_reset
      await query(
        `UPDATE public.app_users 
         SET password_hash = $1, password_changed_at = NOW(), force_password_reset = FALSE, failed_login_attempts = 0, locked_until = NULL 
         WHERE id = $2`,
        [passwordHash, record.user_id]
      );

      // Mark token permanently used
      await query(
        `UPDATE public.password_resets 
         SET used = TRUE, used_at = NOW() 
         WHERE id = $1`,
        [record.id]
      );

      // Invalidate all existing sessions
      await revokeAllUserSessions(record.user_id);

      // Dispatch confirmation email
      sendPasswordChangedEmail(record.email, record.full_name, clientIp).catch(() => {});

      await logSecurityEvent('PASSWORD_RESET_SUCCESSFUL', {
        userId: record.user_id,
        userEmail: record.email,
        ipAddress: clientIp,
      });

      sendJson(res, 200, {
        success: true,
        message: 'Password reset successful! You can now log in with your new password.',
      });
      return true;
    }

    // ---------------------------------------------------------
    // 13. ADMIN: GET USERS: GET /api/admin/users
    // ---------------------------------------------------------
    if (pathname === '/api/admin/users' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser || (authUser.role !== 'admin' && authUser.role !== 'superadmin')) {
        sendJson(res, 403, { success: false, message: 'Access Denied: Administrator role required.' });
        return true;
      }

      // Fetch users robustly: Direct SQL (profiles + app_users) with HTTPS Supabase REST API fallback
      let users: any[] = [];
      try {
        const usersRes = await query(
          `SELECT 
              COALESCE(u.id, p.id) AS id,
              COALESCE(u.full_name, split_part(p.email, '@', 1)) AS full_name,
              COALESCE(u.email, p.email) AS email,
              u.phone,
              COALESCE(u.role, p.role, 'user') AS role,
              COALESCE(u.status, p.status, 'active') AS status,
              COALESCE(u.email_verified, FALSE) AS email_verified,
              u.avatar_url,
              COALESCE(u.force_password_reset, FALSE) AS force_password_reset,
              COALESCE(u.failed_login_attempts, 0) AS failed_login_attempts,
              COALESCE(u.created_at, p.created_at, NOW()) AS created_at,
              u.last_login_at,
              COALESCE(u.password_changed_at, p.created_at, NOW()) AS password_changed_at,
              COUNT(s.id) FILTER (WHERE s.is_revoked = FALSE AND s.expires_at > NOW()) AS active_sessions_count
           FROM public.profiles p
           FULL OUTER JOIN public.app_users u ON LOWER(p.email) = LOWER(u.email)
           LEFT JOIN public.user_sessions s ON u.id = s.user_id
           GROUP BY u.id, p.id, p.email, p.role, p.status, p.created_at
           ORDER BY created_at DESC`
        );

        if (usersRes.rows && usersRes.rows.length > 0) {
          users = usersRes.rows.map((r: any) => ({
            id: r.id,
            uid: r.id,
            fullName: r.full_name,
            displayName: r.full_name,
            email: r.email,
            phone: r.phone || null,
            role: r.role,
            status: r.status,
            emailVerified: r.email_verified,
            forcePasswordReset: r.force_password_reset,
            failedLoginAttempts: r.failed_login_attempts,
            createdAt: r.created_at,
            lastLoginAt: r.last_login_at || null,
            passwordChangedAt: r.password_changed_at,
            passwordStatus: 'Set (Encrypted Bcrypt Hash)',
            activeSessionsCount: parseInt(r.active_sessions_count || '0'),
          }));
        }
      } catch (dbErr) {
        console.warn('PostgreSQL direct query notice in admin/users, using Supabase REST fallback:', dbErr);
      }

      // If SQL query returned empty or failed, fetch from Supabase REST API with Secret Key
      if (users.length === 0) {
        try {
          const supaUrl = process.env.SUPABASE_URL || 'https://frgrfajnrzqwnevhlrio.supabase.co';
          const supaKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
          if (supaKey) {
            const r = await fetch(`${supaUrl}/rest/v1/profiles?select=*&order=created_at.desc`, {
              headers: {
                apikey: supaKey,
                Authorization: `Bearer ${supaKey}`,
              },
            });
            if (r.ok) {
              const data = await r.json();
              if (Array.isArray(data) && data.length > 0) {
                users = data.map((p: any) => ({
                  id: p.id,
                  uid: p.id,
                  fullName: p.email ? p.email.split('@')[0] : 'User',
                  displayName: p.email ? p.email.split('@')[0] : 'User',
                  email: p.email,
                  phone: null,
                  role: p.role || 'user',
                  status: p.status || 'active',
                  emailVerified: true,
                  forcePasswordReset: false,
                  failedLoginAttempts: 0,
                  createdAt: p.created_at,
                  lastLoginAt: null,
                  passwordChangedAt: p.created_at,
                  passwordStatus: 'Protected (Bcrypt Encrypted)',
                  activeSessionsCount: 1,
                }));
              }
            }
          }
        } catch (apiErr) {
          console.error('Supabase REST fallback error:', apiErr);
        }
      }

      sendJson(res, 200, { success: true, users });
      return true;
    }

    // ---------------------------------------------------------
    // 14. ADMIN: TOGGLE USER STATUS: PUT /api/admin/users/:id/status
    // ---------------------------------------------------------
    const statusMatch = pathname.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)\/status$/);
    if (statusMatch && method === 'PUT') {
      const authUser = await authenticateRequest(req);
      if (!authUser || (authUser.role !== 'admin' && authUser.role !== 'superadmin')) {
        sendJson(res, 403, { success: false, message: 'Administrator authorization required.' });
        return true;
      }

      const targetUserId = statusMatch[1];
      const body = await parseJsonBody(req);
      const newStatus = body.status;

      if (!['active', 'suspended', 'deactivated'].includes(newStatus)) {
        sendJson(res, 400, { success: false, message: 'Invalid status. Must be active, suspended, or deactivated.' });
        return true;
      }

      if (targetUserId === authUser.id && newStatus !== 'active') {
        sendJson(res, 400, { success: false, message: 'Administrators cannot suspend or deactivate their own account.' });
        return true;
      }

      const userRes = await query('SELECT * FROM public.app_users WHERE id = $1', [targetUserId]);
      if (userRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'User not found.' });
        return true;
      }
      const targetUser = userRes.rows[0];

      await query('UPDATE public.app_users SET status = $1, updated_at = NOW() WHERE id = $2', [newStatus, targetUserId]);

      // If suspended or deactivated, immediately revoke all active sessions
      if (newStatus !== 'active') {
        await revokeAllUserSessions(targetUserId);
      }

      // Async send email alert
      sendAccountStatusEmail(targetUser.email, targetUser.full_name, newStatus).catch(() => {});

      await logSecurityEvent('ADMIN_USER_STATUS_CHANGE', {
        userId: authUser.id,
        userEmail: authUser.email,
        actorRole: authUser.role,
        ipAddress: clientIp,
        details: { targetUserId, newStatus, targetEmail: targetUser.email },
      });

      sendJson(res, 200, { success: true, message: `User status changed to ${newStatus}.` });
      return true;
    }

    // ---------------------------------------------------------
    // 15. ADMIN: CHANGE USER ROLE: PUT /api/admin/users/:id/role
    // ---------------------------------------------------------
    const roleMatch = pathname.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)\/role$/);
    if (roleMatch && method === 'PUT') {
      const authUser = await authenticateRequest(req);
      if (!authUser || (authUser.role !== 'admin' && authUser.role !== 'superadmin')) {
        sendJson(res, 403, { success: false, message: 'Administrator authorization required.' });
        return true;
      }

      const targetUserId = roleMatch[1];
      const body = await parseJsonBody(req);
      const newRole = body.role;

      if (!['user', 'admin'].includes(newRole)) {
        sendJson(res, 400, { success: false, message: 'Invalid role. Must be user or admin.' });
        return true;
      }

      if (targetUserId === authUser.id && newRole !== 'admin') {
        sendJson(res, 400, { success: false, message: 'You cannot demote yourself from admin.' });
        return true;
      }

      await query('UPDATE public.app_users SET role = $1, updated_at = NOW() WHERE id = $2', [newRole, targetUserId]);

      await logSecurityEvent('ADMIN_USER_ROLE_CHANGE', {
        userId: authUser.id,
        actorRole: authUser.role,
        ipAddress: clientIp,
        details: { targetUserId, newRole },
      });

      sendJson(res, 200, { success: true, message: `User role updated to ${newRole}.` });
      return true;
    }

    // ---------------------------------------------------------
    // 16. ADMIN: SEND PASSWORD RESET EMAIL: POST /api/admin/users/:id/send-reset-email
    // ---------------------------------------------------------
    const resetEmailMatch = pathname.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)\/send-reset-email$/);
    if (resetEmailMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser || (authUser.role !== 'admin' && authUser.role !== 'superadmin')) {
        sendJson(res, 403, { success: false, message: 'Administrator authorization required.' });
        return true;
      }

      const targetUserId = resetEmailMatch[1];
      const userRes = await query('SELECT id, full_name, email FROM public.app_users WHERE id = $1', [targetUserId]);
      if (userRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'User not found.' });
        return true;
      }
      const targetUser = userRes.rows[0];

      // Generate cryptographically secure reset token
      const rawToken = generateCryptoToken(32);
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await query('UPDATE public.password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE', [targetUserId]);
      await query(
        `INSERT INTO public.password_resets (user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [targetUserId, tokenHash, expiresAt, clientIp, 'Admin-Initiated-Dispatch']
      );

      const appBase = process.env.APP_BASE_URL || 'https://mymoney.nileshbarela.site';
      const resetLink = `${appBase}/reset-password?token=${rawToken}&email=${encodeURIComponent(targetUser.email)}`;

      // Dispatch email
      const sent = await sendPasswordResetEmail(targetUser.email, targetUser.full_name, resetLink);

      await logSecurityEvent('ADMIN_SENT_PASSWORD_RESET_EMAIL', {
        userId: authUser.id,
        actorRole: authUser.role,
        ipAddress: clientIp,
        details: { targetUserId, targetEmail: targetUser.email, emailDispatched: sent },
      });

      sendJson(res, 200, {
        success: true,
        message: `Password reset email dispatched to ${targetUser.email}.`,
        resetLink: process.env.NODE_ENV !== 'production' ? resetLink : undefined,
      });
      return true;
    }

    // ---------------------------------------------------------
    // 17. ADMIN: FORCE PASSWORD RESET: POST /api/admin/users/:id/force-password-reset
    // ---------------------------------------------------------
    const forceResetMatch = pathname.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)\/force-password-reset$/);
    if (forceResetMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser || (authUser.role !== 'admin' && authUser.role !== 'superadmin')) {
        sendJson(res, 403, { success: false, message: 'Administrator authorization required.' });
        return true;
      }

      const targetUserId = forceResetMatch[1];
      await query('UPDATE public.app_users SET force_password_reset = TRUE WHERE id = $1', [targetUserId]);
      await revokeAllUserSessions(targetUserId);

      await logSecurityEvent('ADMIN_FORCED_PASSWORD_RESET', {
        userId: authUser.id,
        actorRole: authUser.role,
        ipAddress: clientIp,
        details: { targetUserId },
      });

      sendJson(res, 200, {
        success: true,
        message: 'User account flagged to force password reset on next login. All active sessions revoked.',
      });
      return true;
    }

    // ---------------------------------------------------------
    // 18. ADMIN: REVOKE ALL SESSIONS: POST /api/admin/users/:id/revoke-sessions
    // ---------------------------------------------------------
    const revokeMatch = pathname.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)\/revoke-sessions$/);
    if (revokeMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser || (authUser.role !== 'admin' && authUser.role !== 'superadmin')) {
        sendJson(res, 403, { success: false, message: 'Administrator authorization required.' });
        return true;
      }

      const targetUserId = revokeMatch[1];
      const count = await revokeAllUserSessions(targetUserId);

      await logSecurityEvent('ADMIN_REVOKED_USER_SESSIONS', {
        userId: authUser.id,
        actorRole: authUser.role,
        ipAddress: clientIp,
        details: { targetUserId, revokedCount: count },
      });

      sendJson(res, 200, { success: true, message: `Revoked ${count} active session(s) for user.` });
      return true;
    }

    // ---------------------------------------------------------
    // 19. ADMIN: DELETE USER: DELETE /api/admin/users/:id
    // ---------------------------------------------------------
    const deleteMatch = pathname.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)$/);
    if (deleteMatch && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser || (authUser.role !== 'admin' && authUser.role !== 'superadmin')) {
        sendJson(res, 403, { success: false, message: 'Administrator authorization required.' });
        return true;
      }

      const targetUserId = deleteMatch[1];
      if (targetUserId === authUser.id) {
        sendJson(res, 400, { success: false, message: 'Administrators cannot delete their own account from admin panel.' });
        return true;
      }

      const userRes = await query('SELECT email FROM public.app_users WHERE id = $1', [targetUserId]);
      const targetEmail = userRes.rows[0]?.email;

      await query('DELETE FROM public.transactions WHERE user_id = $1', [targetUserId]).catch(() => {});
      await query('DELETE FROM public.user_sessions WHERE user_id = $1', [targetUserId]);
      await query('DELETE FROM public.password_resets WHERE user_id = $1', [targetUserId]);
      await query('DELETE FROM public.app_users WHERE id = $1', [targetUserId]);

      await logSecurityEvent('ADMIN_DELETED_USER', {
        userId: authUser.id,
        actorRole: authUser.role,
        ipAddress: clientIp,
        details: { targetUserId, targetEmail },
      });

      sendJson(res, 200, { success: true, message: 'User and all associated data permanently deleted.' });
      return true;
    }

    // ---------------------------------------------------------
    // 20. ADMIN: GET AUDIT LOGS: GET /api/admin/audit-logs
    // ---------------------------------------------------------
    if (pathname === '/api/admin/audit-logs' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser || (authUser.role !== 'admin' && authUser.role !== 'superadmin')) {
        sendJson(res, 403, { success: false, message: 'Administrator authorization required.' });
        return true;
      }

      const logsRes = await query(
        `SELECT id, event_type, user_id, user_email, actor_role, ip_address, details, created_at 
         FROM public.security_audit_logs 
         ORDER BY created_at DESC 
         LIMIT 100`
      );

      sendJson(res, 200, { success: true, logs: logsRes.rows });
      return true;
    }

    // ---------------------------------------------------------
    // 10. PUBLIC APP & BRANDING CONFIG: GET /api/config/public
    // ---------------------------------------------------------
    if (pathname === '/api/config/public' && method === 'GET') {
      sendJson(res, 200, {
        success: true,
        config: {
          appName: APP_CONFIG.appName,
          appTagline: APP_CONFIG.appTagline,
          companyName: APP_CONFIG.companyName,
          companyTagline: APP_CONFIG.companyTagline,
          supportEmail: APP_CONFIG.supportEmail,
          supportPhone: APP_CONFIG.supportPhone,
          appLoginUrl: APP_CONFIG.appLoginUrl,
          appLogoUrl: APP_CONFIG.appLogoUrl || '/logo.jpg',
          footerCopyright: APP_CONFIG.footerCopyright,
        },
      });
      return true;
    }

    // ---------------------------------------------------------
    // 11. WELCOME EMAIL STATUS: GET /api/auth/welcome-email-status
    // ---------------------------------------------------------
    if (pathname === '/api/auth/welcome-email-status' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      const queryEmail = parsed.query.email ? normalizeEmail(parsed.query.email as string) : '';
      
      // If queryEmail provided, only admin or the user themselves can inspect
      let targetLookup = authUser?.id || '';
      if (queryEmail) {
        if (!authUser || (authUser.role !== 'admin' && authUser.role !== 'superadmin' && authUser.email !== queryEmail)) {
          sendJson(res, 403, { success: false, message: 'Forbidden' });
          return true;
        }
        targetLookup = queryEmail;
      }

      if (!targetLookup) {
        sendJson(res, 400, { success: false, message: 'Target user ID or email required' });
        return true;
      }

      const statusRecord = await getWelcomeEmailDeliveryStatus(targetLookup);
      sendJson(res, 200, { success: true, delivery: statusRecord });
      return true;
    }

    // ---------------------------------------------------------
    // 12. RESEND WELCOME EMAIL: POST /api/auth/resend-welcome-email
    // ---------------------------------------------------------
    if (pathname === '/api/auth/resend-welcome-email' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      const body = await parseJsonBody(req);
      const targetEmail = normalizeEmail(body.email || authUser?.email || '');

      if (!targetEmail) {
        sendJson(res, 400, { success: false, message: 'Email is required' });
        return true;
      }

      // Check permission: either logged in as that user, or admin
      if (!authUser || (authUser.role !== 'admin' && authUser.role !== 'superadmin' && authUser.email !== targetEmail)) {
        sendJson(res, 403, { success: false, message: 'Forbidden' });
        return true;
      }

      // Query user
      const uRes = await query('SELECT id, full_name, email FROM public.app_users WHERE LOWER(email) = $1', [targetEmail]);
      if (uRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'User not found' });
        return true;
      }

      const target = uRes.rows[0];
      const result = await sendWelcomeEmail(target.email, target.full_name, target.id, true);

      sendJson(res, 200, {
        success: result.success,
        message: result.message,
        delivery: result,
      });
      return true;
    }

    // =========================================================================
    // SECTION A: ACCOUNT DELETION & CANCELLATION (24-Hour Backend Controlled)
    // =========================================================================

    // 1. INITIATE DELETION: POST /api/account/deletion/request
    if (pathname === '/api/account/deletion/request' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required to initiate account deletion.' });
        return true;
      }

      const rate = checkRateLimit(`del_req:${authUser.id}`, 5, 15 * 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { success: false, message: 'Too many deletion attempts. Please wait before trying again.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const password = body.password || '';
      const reason = (body.reason || '').trim();

      if (!password) {
        sendJson(res, 400, { success: false, message: 'Password verification is mandatory to schedule account deletion.' });
        return true;
      }

      // Verify password
      const uRes = await query('SELECT password_hash FROM public.app_users WHERE id = $1', [authUser.id]);
      const currentHash = uRes.rows[0]?.password_hash;
      const isPassValid = await verifyPassword(password, currentHash);
      if (!isPassValid) {
        await logSecurityEvent('ACCOUNT_DELETION_FAILED_BAD_PASSWORD', {
          userId: authUser.id,
          userEmail: authUser.email,
          ipAddress: clientIp,
        });
        sendJson(res, 400, { success: false, message: 'Incorrect password. Deletion request aborted for your security.' });
        return true;
      }

      // Check if already pending
      const pendingCheck = await query(
        `SELECT id, scheduled_for, created_at 
         FROM public.account_deletion_requests 
         WHERE user_id = $1 AND status = 'pending' AND scheduled_for > NOW()`,
        [authUser.id]
      );

      if (pendingCheck.rows.length > 0) {
        const existing = pendingCheck.rows[0];
        const remainingSec = Math.ceil((new Date(existing.scheduled_for).getTime() - Date.now()) / 1000);
        sendJson(res, 200, {
          success: true,
          message: 'An account deletion request is already pending for your account.',
          scheduledFor: existing.scheduled_for,
          remainingSeconds: Math.max(0, remainingSec),
          isAlreadyPending: true,
        });
        return true;
      }

      // Generate cryptographically secure single-use cancellation token
      const rawToken = generateCryptoToken(32);
      const tokenHash = hashToken(rawToken);

      // Backend controlled 24-hour cancellation window
      const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const nowIso = new Date().toISOString();

      const insRes = await query(
        `INSERT INTO public.account_deletion_requests (
          user_id, user_email, cancellation_token_hash, status, scheduled_for, reason, ip_address, user_agent
        ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)
        RETURNING id`,
        [authUser.id, authUser.email, tokenHash, scheduledFor, reason || null, clientIp, userAgent]
      );

      const requestId = insRes.rows[0].id;

      // Update app_users status
      await query(
        `UPDATE public.app_users 
         SET deletion_status = 'pending_deletion', deletion_scheduled_for = $1, deletion_request_id = $2, updated_at = NOW() 
         WHERE id = $3`,
        [scheduledFor, requestId, authUser.id]
      );

      const cancelLink = `${origin}/#cancel-deletion&token=${rawToken}&email=${encodeURIComponent(authUser.email)}`;
      const submissionTimeStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
      const scheduledForStr = scheduledFor.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';

      // Dispatch automated deletion notice email
      sendAccountDeletionRequestedEmail(
        authUser.email,
        authUser.full_name,
        scheduledForStr,
        cancelLink,
        submissionTimeStr
      ).catch(() => {});

      await logSecurityEvent('ACCOUNT_DELETION_SCHEDULED', {
        userId: authUser.id,
        userEmail: authUser.email,
        ipAddress: clientIp,
        details: { requestId, scheduledFor: scheduledFor.toISOString(), cancellationWindowHours: 24 },
      });

      sendJson(res, 200, {
        success: true,
        message: 'Account deletion request scheduled. You have 24 hours to cancel.',
        scheduledFor: scheduledFor.toISOString(),
        remainingSeconds: 24 * 60 * 60,
        requestId,
        cancelLink: process.env.NODE_ENV !== 'production' ? cancelLink : undefined,
      });
      return true;
    }

    // 2. CHECK DELETION STATUS: GET /api/account/deletion/status
    if (pathname === '/api/account/deletion/status' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const reqDb = await query(
        `SELECT id, scheduled_for, created_at, status, reason
         FROM public.account_deletion_requests 
         WHERE user_id = $1 
         ORDER BY created_at DESC 
         LIMIT 1`,
        [authUser.id]
      );

      if (reqDb.rows.length === 0 || reqDb.rows[0].status !== 'pending') {
        sendJson(res, 200, {
          success: true,
          isPending: false,
          status: reqDb.rows[0]?.status || 'none',
        });
        return true;
      }

      const currentReq = reqDb.rows[0];
      const remainingMs = new Date(currentReq.scheduled_for).getTime() - Date.now();

      if (remainingMs <= 0) {
        // Expired! Execute deletion asynchronously
        processExpiredAccountDeletions().catch(() => {});
        sendJson(res, 200, {
          success: true,
          isPending: false,
          status: 'executing',
          remainingSeconds: 0,
        });
        return true;
      }

      sendJson(res, 200, {
        success: true,
        isPending: true,
        status: 'pending_deletion',
        requestId: currentReq.id,
        scheduledFor: currentReq.scheduled_for,
        createdAt: currentReq.created_at,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        reason: currentReq.reason,
      });
      return true;
    }

    // 3. CANCEL DELETION (IN-APP): POST /api/account/deletion/cancel
    if (pathname === '/api/account/deletion/cancel' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const reqDb = await query(
        `SELECT id FROM public.account_deletion_requests 
         WHERE user_id = $1 AND status = 'pending' 
         ORDER BY created_at DESC LIMIT 1`,
        [authUser.id]
      );

      if (reqDb.rows.length === 0) {
        sendJson(res, 400, { success: false, message: 'No active pending deletion request found to cancel.' });
        return true;
      }

      const reqId = reqDb.rows[0].id;

      // Mark request cancelled
      await query(
        `UPDATE public.account_deletion_requests 
         SET status = 'cancelled', cancelled_at = NOW() 
         WHERE id = $1`,
        [reqId]
      );

      // Restore user account status
      await query(
        `UPDATE public.app_users 
         SET deletion_status = 'none', deletion_scheduled_for = NULL, deletion_request_id = NULL, updated_at = NOW() 
         WHERE id = $1`,
        [authUser.id]
      );

      // Send confirmation email
      sendAccountDeletionCancelledEmail(authUser.email, authUser.full_name).catch(() => {});

      await logSecurityEvent('ACCOUNT_DELETION_CANCELLED_IN_APP', {
        userId: authUser.id,
        userEmail: authUser.email,
        ipAddress: clientIp,
        details: { requestId: reqId },
      });

      sendJson(res, 200, {
        success: true,
        message: 'Your account deletion request has been cancelled. Your account and all records remain safe and active.',
      });
      return true;
    }

    // 4. CANCEL DELETION (EMAIL TOKEN): POST /api/account/deletion/cancel-by-token
    if (pathname === '/api/account/deletion/cancel-by-token' && method === 'POST') {
      const rate = checkRateLimit(`cancel_token:${clientIp}`, 15, 5 * 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { success: false, message: 'Too many requests. Please wait a moment.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const rawToken = body.token || '';

      if (!rawToken) {
        sendJson(res, 400, { success: false, message: 'Cancellation token is required.' });
        return true;
      }

      const tokenHash = hashToken(rawToken);

      const reqDb = await query(
        `SELECT r.id, r.user_id, r.status, r.scheduled_for, u.email, u.full_name 
         FROM public.account_deletion_requests r
         JOIN public.app_users u ON r.user_id = u.id
         WHERE r.cancellation_token_hash = $1`,
        [tokenHash]
      );

      if (reqDb.rows.length === 0) {
        sendJson(res, 400, { success: false, message: 'Invalid cancellation token.' });
        return true;
      }

      const record = reqDb.rows[0];

      if (record.status === 'cancelled') {
        sendJson(res, 200, {
          success: true,
          message: 'This account deletion request was already cancelled. Your account is active.',
        });
        return true;
      }

      if (record.status === 'executed') {
        sendJson(res, 400, {
          success: false,
          message: 'The 24-hour cancellation window has already expired and deletion was completed.',
        });
        return true;
      }

      // Mark request cancelled
      await query(
        `UPDATE public.account_deletion_requests 
         SET status = 'cancelled', cancelled_at = NOW() 
         WHERE id = $1`,
        [record.id]
      );

      // Restore user account status
      await query(
        `UPDATE public.app_users 
         SET deletion_status = 'none', deletion_scheduled_for = NULL, deletion_request_id = NULL, updated_at = NOW() 
         WHERE id = $1`,
        [record.user_id]
      );

      // Send confirmation email
      sendAccountDeletionCancelledEmail(record.email, record.full_name).catch(() => {});

      await logSecurityEvent('ACCOUNT_DELETION_CANCELLED_VIA_TOKEN', {
        userId: record.user_id,
        userEmail: record.email,
        ipAddress: clientIp,
        details: { requestId: record.id },
      });

      sendJson(res, 200, {
        success: true,
        message: 'Your account deletion request has been successfully cancelled. Your account remains active.',
      });
      return true;
    }

    // 5. TRIGGER EXPIRED DELETIONS: POST /api/account/deletion/process-expired
    if (pathname === '/api/account/deletion/process-expired' && method === 'POST') {
      const processed = await processExpiredAccountDeletions();
      sendJson(res, 200, { success: true, processedCount: processed });
      return true;
    }

    // =========================================================================
    // SECTION B: UDHAR CONTACTS (SAVED PEOPLE) & BIDIRECTIONAL SYNC
    // =========================================================================

    // Helper: Ensure 2-Way (Reciprocal) Mutual Contact in Saved People
    // When User A adds User B, User A automatically gets added to User B's saved contacts too!
    async function ensureReciprocalContact(
      targetUserId: string,
      sourceUser: { id: string; full_name?: string; email?: string; phone?: string; avatar_url?: string },
      relationshipType: string = 'Friend'
    ) {
      if (!targetUserId || targetUserId === sourceUser.id) return;

      const sourceName = (sourceUser.full_name || sourceUser.email?.split('@')[0] || 'Friend').trim();
      const sourceEmail = (sourceUser.email || '').trim().toLowerCase() || null;
      const sourcePhone = (sourceUser.phone || '').trim() || null;
      const sourcePhoto = sourceUser.avatar_url || null;

      try {
        // 1. Check if target user already has a contact linked to sourceUser.id
        const existingLinked = await query(
          `SELECT id, name FROM public.udhar_contacts WHERE user_id = $1 AND linked_user_id = $2 LIMIT 1`,
          [targetUserId, sourceUser.id]
        );

        if (existingLinked.rows.length > 0) {
          await query(
            `UPDATE public.udhar_contacts 
             SET email = COALESCE(email, $1), 
                 phone = COALESCE(phone, $2), 
                 photo_url = COALESCE(photo_url, $3),
                 updated_at = NOW() 
             WHERE id = $4`,
            [sourceEmail, sourcePhone, sourcePhoto, existingLinked.rows[0].id]
          );
        } else {
          // 2. Check if contact exists by name for target user
          const existingByName = await query(
            `SELECT id FROM public.udhar_contacts WHERE user_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
            [targetUserId, sourceName]
          );

          if (existingByName.rows.length > 0) {
            await query(
              `UPDATE public.udhar_contacts 
               SET linked_user_id = $1, 
                   email = COALESCE($2, email), 
                   phone = COALESCE($3, phone), 
                   photo_url = COALESCE($4, photo_url),
                   updated_at = NOW() 
               WHERE id = $5`,
              [sourceUser.id, sourceEmail, sourcePhone, sourcePhoto, existingByName.rows[0].id]
            );
          } else {
            // 3. Insert fresh reciprocal contact for target user
            await query(
              `INSERT INTO public.udhar_contacts (user_id, name, email, phone, photo_url, relationship_type, notes, linked_user_id, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'Added via 2-Way Sync', $7, NOW())
               ON CONFLICT (user_id, name) DO UPDATE 
               SET linked_user_id = EXCLUDED.linked_user_id, 
                   email = COALESCE(EXCLUDED.email, public.udhar_contacts.email), 
                   phone = COALESCE(EXCLUDED.phone, public.udhar_contacts.phone), 
                   photo_url = COALESCE(EXCLUDED.photo_url, public.udhar_contacts.photo_url),
                   updated_at = NOW()`,
              [targetUserId, sourceName, sourceEmail, sourcePhone, sourcePhoto, relationshipType, sourceUser.id]
            );
          }
        }

        // 4. Ensure mutual friendship connection in user_connections
        await query(
          `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
           VALUES ($1, $2, 'connected')
           ON CONFLICT (user_a_id, user_b_id) DO NOTHING`,
          [sourceUser.id, targetUserId]
        ).catch(() => {});

        await query(
          `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
           VALUES ($1, $2, 'connected')
           ON CONFLICT (user_a_id, user_b_id) DO NOTHING`,
          [targetUserId, sourceUser.id]
        ).catch(() => {});

        // 5. Retroactively bind counterpart_user_id on previous transactions if any
        await query(
          `UPDATE public.udhar_transactions 
           SET counterpart_user_id = $1, updated_at = NOW() 
           WHERE user_id = $2 AND LOWER(counterpart_name) = LOWER($3) AND counterpart_user_id IS NULL`,
          [sourceUser.id, targetUserId, sourceName]
        ).catch(() => {});
      } catch (err) {
        console.warn('[ensureReciprocalContact notice]:', err);
      }
    }

    // 6. GET CONTACTS: GET /api/udhar/contacts
    if (pathname === '/api/udhar/contacts' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      if (!isDatabaseAvailable()) {
        const restRes = await getContactsRest(authUser);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const contactsRes = await query(
        `SELECT c.id, c.name, c.email, c.phone, c.photo_url, c.relationship_type, c.notes, c.linked_user_id, c.created_at, c.updated_at,
                u.full_name AS linked_user_name, u.email AS linked_user_email, u.avatar_url AS linked_user_avatar
         FROM public.udhar_contacts c
         LEFT JOIN public.app_users u ON c.linked_user_id = u.id
         WHERE c.user_id = $1
         ORDER BY c.name ASC`,
        [authUser.id]
      );

      sendJson(res, 200, { success: true, contacts: contactsRes.rows });
      return true;
    }

    // 6B. GET CONTACTS WITH LIVE BALANCES: GET /api/udhar/contacts/with-balances
    if (pathname === '/api/udhar/contacts/with-balances' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      if (!isDatabaseAvailable()) {
        const restRes = await getContactsWithBalancesRest(authUser);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const contactsRes = await query(
        `SELECT 
          c.id, c.name, c.email, c.phone, c.relationship_type, c.notes, c.linked_user_id, c.photo_url, c.created_at, c.updated_at,
          u.full_name AS linked_user_name, u.email AS linked_user_email, u.avatar_url AS linked_user_avatar,
          COALESCE(SUM(CASE WHEN t.direction = 'gave' AND t.status <> 'cancelled' THEN t.original_amount ELSE 0 END), 0) AS total_given,
          COALESCE(SUM(CASE WHEN t.direction = 'took' AND t.status <> 'cancelled' THEN t.original_amount ELSE 0 END), 0) AS total_taken,
          COALESCE(SUM(CASE WHEN t.direction = 'gave' AND t.status NOT IN ('settled', 'cancelled') THEN t.current_balance 
                            WHEN t.direction = 'took' AND t.status NOT IN ('settled', 'cancelled') THEN -t.current_balance 
                            ELSE 0 END), 0) AS net_balance,
          COALESCE(SUM(CASE WHEN t.direction = 'gave' AND t.status NOT IN ('settled', 'cancelled') THEN t.current_balance ELSE 0 END), 0) AS outstanding_receivable,
          COALESCE(SUM(CASE WHEN t.direction = 'took' AND t.status NOT IN ('settled', 'cancelled') THEN t.current_balance ELSE 0 END), 0) AS outstanding_payable,
          MAX(t.transaction_date) AS last_transaction_date,
          COUNT(CASE WHEN t.status <> 'cancelled' THEN 1 END) AS total_transactions_count,
          COUNT(CASE WHEN t.status NOT IN ('settled', 'cancelled') AND t.current_balance > 0 THEN 1 END) AS pending_transactions_count
        FROM public.udhar_contacts c
        LEFT JOIN public.app_users u ON c.linked_user_id = u.id
        LEFT JOIN public.udhar_transactions t ON t.user_id = c.user_id AND (
          (c.linked_user_id IS NOT NULL AND t.counterpart_user_id = c.linked_user_id) OR
          (c.linked_user_id IS NULL AND t.counterpart_user_id IS NULL AND LOWER(TRIM(t.counterpart_name)) = LOWER(TRIM(c.name)))
        )
        WHERE c.user_id = $1
        GROUP BY c.id, u.full_name, u.email, u.avatar_url
        ORDER BY c.name ASC`,
        [authUser.id]
      );

      const parsedContacts = contactsRes.rows.map((row: any) => ({
        ...row,
        total_given: parseFloat(row.total_given) || 0,
        total_taken: parseFloat(row.total_taken) || 0,
        net_balance: Math.round((parseFloat(row.net_balance) || 0) * 100) / 100,
        outstanding_receivable: parseFloat(row.outstanding_receivable) || 0,
        outstanding_payable: parseFloat(row.outstanding_payable) || 0,
        total_transactions_count: parseInt(row.total_transactions_count, 10) || 0,
        pending_transactions_count: parseInt(row.pending_transactions_count, 10) || 0,
        is_registered: Boolean(row.linked_user_id),
      }));

      sendJson(res, 200, { success: true, contacts: parsedContacts });
      return true;
    }

    // 7. SAVE CONTACT: POST /api/udhar/contacts (Manual contacts NEVER silently auto-link by name!)
    if (pathname === '/api/udhar/contacts' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);

      if (!isDatabaseAvailable()) {
        const restRes = await saveContactRest(authUser, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const name = (body.name || '').trim();
      const email = (body.email || '').trim().toLowerCase();
      const phone = (body.phone || '').trim();
      const relationshipType = (body.relationship_type || body.relationshipType || 'Friend').trim();
      const notes = (body.notes || '').trim();
      const photoUrl = (body.photo_url || body.photoUrl || '').trim() || null;
      let linkedUserId = (body.linked_user_id || body.linkedUserId || '').trim() || null;

      if (!name) {
        sendJson(res, 400, { success: false, message: "Person's name is required." });
        return true;
      }

      // Only connect when an explicit linkedUserId is chosen via Search/QR/Link (never auto-link manual names!)
      if (linkedUserId) {
        if (linkedUserId === authUser.id) {
          sendJson(res, 400, { success: false, message: 'You cannot add yourself as a contact.' });
          return true;
        }
        const targetRes = await query(
          `SELECT id, full_name, status, COALESCE(deletion_status, 'none') AS deletion_status
           FROM public.app_users WHERE id = $1`,
          [linkedUserId]
        );
        if (targetRes.rows.length === 0 || targetRes.rows[0].status !== 'active' || targetRes.rows[0].deletion_status !== 'none') {
          sendJson(res, 404, { success: false, message: 'Selected user account is unavailable.' });
          return true;
        }
      }

      const upsertRes = await query(
        `INSERT INTO public.udhar_contacts (user_id, name, email, phone, photo_url, relationship_type, notes, linked_user_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (user_id, name) DO UPDATE 
         SET email = COALESCE(EXCLUDED.email, public.udhar_contacts.email), 
             phone = COALESCE(EXCLUDED.phone, public.udhar_contacts.phone), 
             photo_url = COALESCE(EXCLUDED.photo_url, public.udhar_contacts.photo_url),
             relationship_type = EXCLUDED.relationship_type, 
             notes = COALESCE(EXCLUDED.notes, public.udhar_contacts.notes), 
             linked_user_id = COALESCE(EXCLUDED.linked_user_id, public.udhar_contacts.linked_user_id), 
             updated_at = NOW()
         RETURNING *`,
        [authUser.id, name, email || null, phone || null, photoUrl, relationshipType, notes || null, linkedUserId]
      );

      if (linkedUserId && linkedUserId !== authUser.id) {
        await query(
          `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
           VALUES ($1, $2, 'connected')
           ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
          [authUser.id, linkedUserId]
        ).catch(() => {});
        await ensureReciprocalContact(linkedUserId, authUser, relationshipType);
      }

      sendJson(res, 200, {
        success: true,
        contact: upsertRes.rows[0],
        reciprocallyLinked: Boolean(linkedUserId && linkedUserId !== authUser.id),
      });
      return true;
    }

    // 8. UPDATE CONTACT: PUT /api/udhar/contacts/:id
    const contactUpdateMatch = pathname.match(/^\/api\/udhar\/contacts\/([a-zA-Z0-9_-]+)$/);
    if (contactUpdateMatch && method === 'PUT') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const contactId = contactUpdateMatch[1];
      const body = await parseJsonBody(req);

      if (!isDatabaseAvailable()) {
        const restRes = await updateContactRest(authUser, contactId, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const name = (body.name || '').trim();
      const email = (body.email || '').trim().toLowerCase();
      const phone = (body.phone || '').trim();
      const relationshipType = (body.relationship_type || body.relationshipType || 'Friend').trim();
      const notes = (body.notes || '').trim();
      const photoUrl = body.photo_url !== undefined ? (body.photo_url || null) : undefined;
      const linkedUserId = body.linked_user_id || body.linkedUserId || null;

      if (!name) {
        sendJson(res, 400, { success: false, message: "Person's name is required." });
        return true;
      }

      const updRes = await query(
        `UPDATE public.udhar_contacts 
         SET name = $1, email = $2, phone = $3, relationship_type = $4, notes = $5,
             photo_url = COALESCE($6, photo_url),
             linked_user_id = COALESCE($7, linked_user_id), updated_at = NOW()
         WHERE id = $8 AND user_id = $9
         RETURNING *`,
        [name, email || null, phone || null, relationshipType, notes || null, photoUrl ?? null, linkedUserId, contactId, authUser.id]
      );

      if (updRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Contact not found.' });
        return true;
      }

      const finalLinkedId = updRes.rows[0].linked_user_id;
      if (finalLinkedId && finalLinkedId !== authUser.id) {
        await ensureReciprocalContact(finalLinkedId, authUser, relationshipType);
      }

      sendJson(res, 200, {
        success: true,
        contact: updRes.rows[0],
        reciprocallyLinked: Boolean(finalLinkedId && finalLinkedId !== authUser.id),
      });
      return true;
    }

    // 9. DELETE CONTACT: DELETE /api/udhar/contacts/:id
    const contactDeleteMatch = pathname.match(/^\/api\/udhar\/contacts\/([a-zA-Z0-9_-]+)$/);
    if (contactDeleteMatch && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const contactId = contactDeleteMatch[1];
      if (!isDatabaseAvailable()) {
        const restRes = await deleteContactRest(authUser, contactId);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      await query('DELETE FROM public.udhar_contacts WHERE id = $1 AND user_id = $2', [contactId, authUser.id]);
      sendJson(res, 200, { success: true, message: 'Saved contact removed.' });
      return true;
    }

    // 10. LINK UNREGISTERED CONTACT TO REGISTERED USER: POST /api/udhar/contacts/:id/link-registered
    const contactLinkMatch = pathname.match(/^\/api\/udhar\/contacts\/([a-zA-Z0-9_-]+)\/link-registered$/);
    if (contactLinkMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const contactId = contactLinkMatch[1];
      const body = await parseJsonBody(req);
      const registeredUserId = body.registeredUserId || body.userId || '';

      if (!isDatabaseAvailable()) {
        const restRes = await linkContactRest(authUser, contactId, registeredUserId);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      if (!registeredUserId) {
        sendJson(res, 400, { success: false, message: 'Target registered user ID is required.' });
        return true;
      }

      if (registeredUserId === authUser.id) {
        sendJson(res, 400, { success: false, message: 'You cannot link a contact to your own account.' });
        return true;
      }

      const contactRes = await query(
        'SELECT * FROM public.udhar_contacts WHERE id = $1 AND user_id = $2',
        [contactId, authUser.id]
      );

      if (contactRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Contact not found.' });
        return true;
      }
      const contact = contactRes.rows[0];

      const targetUserRes = await query(
        `SELECT id, full_name, email, status, COALESCE(deletion_status, 'none') AS deletion_status
         FROM public.app_users WHERE id = $1`,
        [registeredUserId]
      );
      if (targetUserRes.rows.length === 0 || targetUserRes.rows[0].status !== 'active' || targetUserRes.rows[0].deletion_status !== 'none') {
        sendJson(res, 404, { success: false, message: 'Registered user not found or unavailable.' });
        return true;
      }

      await query(
        `UPDATE public.udhar_contacts 
         SET linked_user_id = $1, updated_at = NOW() 
         WHERE id = $2`,
        [registeredUserId, contactId]
      );

      await ensureReciprocalContact(registeredUserId, authUser, contact.relationship_type || 'Friend');

      await query(
        `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
         VALUES ($1, $2, 'connected')
         ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
        [authUser.id, registeredUserId]
      );
      await query(
        `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
         VALUES ($1, $2, 'connected')
         ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
        [registeredUserId, authUser.id]
      ).catch(() => {});

      sendJson(res, 200, {
        success: true,
        message: `Successfully linked ${contact.name} with verified account ${targetUserRes.rows[0].full_name}.`,
      });
      return true;
    }

    // 10C. EXPLICIT USER CONNECTION: POST /api/udhar/connections/connect
    if (pathname === '/api/udhar/connections/connect' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);
      if (!isDatabaseAvailable()) {
        const restRes = await connectUserRest(authUser, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const targetUserId = (body.targetUserId || body.target_user_id || '').trim();
      const relationshipType = (body.relationshipType || body.relationship_type || 'Friend').trim();

      if (!targetUserId) {
        sendJson(res, 400, { success: false, message: 'Target user ID is required.' });
        return true;
      }
      if (targetUserId === authUser.id) {
        sendJson(res, 400, { success: false, message: 'You cannot connect with your own account.' });
        return true;
      }

      const targetRes = await query(
        `SELECT id, full_name, email, phone, avatar_url, status, COALESCE(deletion_status, 'none') AS deletion_status
         FROM public.app_users WHERE id = $1`,
        [targetUserId]
      );
      if (targetRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'User account not found.' });
        return true;
      }
      const target = targetRes.rows[0];
      if (target.status !== 'active' || target.deletion_status !== 'none') {
        sendJson(res, 403, { success: false, message: 'This user account is deactivated or unavailable.' });
        return true;
      }

      const blockRes = await query(
        `SELECT id FROM public.user_connections
         WHERE ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))
           AND status = 'blocked' LIMIT 1`,
        [authUser.id, targetUserId]
      );
      if (blockRes.rows.length > 0) {
        sendJson(res, 403, { success: false, message: 'Connection is blocked between these accounts.' });
        return true;
      }

      const existingConn = await query(
        `SELECT id FROM public.user_connections
         WHERE ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))
           AND status = 'connected' LIMIT 1`,
        [authUser.id, targetUserId]
      );
      const alreadyConnected = existingConn.rows.length > 0;

      await query(
        `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
         VALUES ($1, $2, 'connected')
         ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
        [authUser.id, targetUserId]
      );
      await query(
        `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
         VALUES ($1, $2, 'connected')
         ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
        [targetUserId, authUser.id]
      ).catch(() => {});

      const targetDisplayName = (target.full_name || target.email?.split('@')[0] || 'Friend').trim();
      await query(
        `INSERT INTO public.udhar_contacts (user_id, name, email, phone, photo_url, relationship_type, linked_user_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id, name) DO UPDATE
         SET linked_user_id = EXCLUDED.linked_user_id,
             email = COALESCE(EXCLUDED.email, public.udhar_contacts.email),
             phone = COALESCE(EXCLUDED.phone, public.udhar_contacts.phone),
             photo_url = COALESCE(EXCLUDED.photo_url, public.udhar_contacts.photo_url),
             relationship_type = EXCLUDED.relationship_type,
             updated_at = NOW()`,
        [authUser.id, targetDisplayName, target.email, target.phone, target.avatar_url, relationshipType, targetUserId]
      );

      await ensureReciprocalContact(targetUserId, authUser, relationshipType);

      if (!alreadyConnected) {
        await query(
          `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
           VALUES ($1, $2, 'connection', $3, $4, $5, TRUE)`,
          [
            `Connected with ${authUser.full_name}`,
            `${authUser.full_name} connected with you on My Money Manager for Shared Udhar.`,
            targetUserId,
            authUser.id,
            authUser.id,
          ]
        ).catch(() => {});
      }

      sendJson(res, 200, {
        success: true,
        alreadyConnected,
        message: alreadyConnected
          ? `Already connected with ${targetDisplayName}.`
          : `Connected with ${targetDisplayName}! Shared 2-way Udhar is now enabled.`,
        connectedUser: {
          id: target.id,
          name: targetDisplayName,
          displayName: targetDisplayName,
          fullName: targetDisplayName,
          emailMasked: maskEmailForPrivacy(target.email),
          phoneMasked: maskPhoneForPrivacy(target.phone),
          avatarUrl: target.avatar_url || null,
        },
      });
      return true;
    }

    // 10B. INVITE CONTACT VIA EMAIL: POST /api/udhar/contacts/:id/invite
    const contactInviteMatch = pathname.match(/^\/api\/udhar\/contacts\/([a-zA-Z0-9_-]+)\/invite$/);
    if (contactInviteMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const contactId = contactInviteMatch[1];
      const contactRes = await query(
        'SELECT * FROM public.udhar_contacts WHERE id = $1 AND user_id = $2',
        [contactId, authUser.id]
      );

      if (contactRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Contact not found.' });
        return true;
      }

      const contact = contactRes.rows[0];
      if (!contact.email) {
        sendJson(res, 400, { success: false, message: 'This contact does not have an email address to invite.' });
        return true;
      }

      // Check if already registered
      const regUserCheck = await query(
        'SELECT id, full_name, email FROM public.app_users WHERE LOWER(email) = LOWER($1)',
        [contact.email]
      );
      if (regUserCheck.rows.length > 0) {
        const regUser = regUserCheck.rows[0];
        await query(
          'UPDATE public.udhar_contacts SET linked_user_id = $1, updated_at = NOW() WHERE id = $2',
          [regUser.id, contact.id]
        );
        await ensureReciprocalContact(regUser.id, authUser, contact.relationship_type || 'Friend');

        sendJson(res, 200, {
          success: true,
          message: `${contact.name} is already registered on My Money Manager! Linked accounts automatically.`,
          alreadyRegistered: true,
          linkedUserId: regUser.id,
        });
        return true;
      }

      // Generate secure invitation token
      const tokenHash = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
      const appBaseUrl = process.env.APP_URL || 'http://localhost:3000';
      const inviteLink = `${appBaseUrl}/#register?invite=${tokenHash}&email=${encodeURIComponent(contact.email)}`;

      await query(
        `INSERT INTO public.invitations (
          inviter_user_id, invited_person_id, recipient_email, recipient_name, token_hash, status, expires_at
        ) VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
        [authUser.id, contact.id, contact.email.toLowerCase().trim(), contact.name, tokenHash, expiresAt]
      );

      // Dispatch invitation email
      const sent = await sendContactInvitationEmail({
        inviterName: authUser.full_name || 'My Money User',
        inviterEmail: authUser.email,
        recipientName: contact.name,
        recipientEmail: contact.email,
        inviteLink,
        inviteToken: tokenHash,
      });

      sendJson(res, 200, {
        success: true,
        message: `Invitation email sent to ${contact.email}.`,
        inviteLink,
        emailSent: sent,
      });
      return true;
    }

    // =========================================================================
    // SECTION C: REGISTERED USER SEARCH (SAFE & PRIVACY PRESERVING)
    // =========================================================================

    // Helper: Mask email for privacy
    function maskEmail(em: string): string {
      if (!em || !em.includes('@')) return '***@***';
      const [local, domain] = em.split('@');
      if (local.length <= 2) return `${local.charAt(0)}***@${domain}`;
      return `${local.charAt(0)}***${local.charAt(local.length - 1)}@${domain}`;
    }

    function maskPhone(ph?: string | null): string | null {
      if (!ph) return null;
      const clean = ph.replace(/[\s\-\(\)]/g, '');
      if (clean.length < 6) return '****';
      return `${clean.slice(0, 3)}****${clean.slice(-3)}`;
    }

    // 11. SEARCH USERS: GET /api/udhar/users/search?q=...
    if (pathname === '/api/udhar/users/search' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const rate = checkRateLimit(`user_search:${authUser.id}`, 60, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { success: false, message: 'Search rate limit exceeded. Please wait a moment.' });
        return true;
      }

      const rawQ = (parsed.query.q as string) || '';
      const q = normalizeSearchQuery(rawQ);
      if (!q || q.length < 2) {
        sendJson(res, 200, { success: true, users: [] });
        return true;
      }

      if (!isDatabaseAvailable()) {
        const restRes = await searchUsersRest(authUser, rawQ);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const digitsOnly = q.replace(/\D/g, '');
      const phoneLike = digitsOnly.length >= 4 ? `%${digitsOnly}%` : `%${q}%`;

      // Query registered active non-deleted users (including self so UI can show "You" with connect disabled; excluding blocked users)
      const usersRes = await query(
        `SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.username,
           COALESCE(u.is_verified, TRUE) AS is_verified,
           (
             SELECT uc.status FROM public.user_connections uc
             WHERE (uc.user_a_id = $1 AND uc.user_b_id = u.id)
                OR (uc.user_b_id = $1 AND uc.user_a_id = u.id)
             ORDER BY CASE uc.status WHEN 'blocked' THEN 1 WHEN 'connected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END
             LIMIT 1
           ) AS conn_status,
           EXISTS(
             SELECT 1 FROM public.udhar_contacts c
             WHERE c.user_id = $1 AND c.linked_user_id = u.id
           ) AS is_saved_contact
         FROM public.app_users u 
         WHERE u.status = 'active'
           AND COALESCE(u.deletion_status, 'none') = 'none'
           AND NOT EXISTS (
             SELECT 1 FROM public.user_connections blk
             WHERE ((blk.user_a_id = $1 AND blk.user_b_id = u.id) OR (blk.user_b_id = $1 AND blk.user_a_id = u.id))
               AND blk.status = 'blocked'
           )
           AND (
             LOWER(u.email) = $2 OR 
             LOWER(u.email) LIKE $3 OR 
             LOWER(u.full_name) LIKE $3 OR
             LOWER(COALESCE(u.username, '')) LIKE $3 OR
             REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g') LIKE $4
           )
         ORDER BY (u.id = $1) ASC, u.full_name ASC
         LIMIT 20`,
        [authUser.id, q, `%${q}%`, phoneLike]
      );

      // Privacy-preserving output: NEVER expose raw email or raw phone to unconnected searchers!
      const sanitizedUsers = usersRes.rows.map((u: any) => {
        const isSelf = u.id === authUser.id;
        const isConnected = !isSelf && (u.conn_status === 'connected' || Boolean(u.is_saved_contact));
        const connectionStatus = isSelf
          ? 'self'
          : isConnected
            ? 'connected'
            : u.conn_status === 'pending'
              ? 'pending'
              : 'none';
        return {
          id: u.id,
          displayName: u.full_name || u.username || 'My Money User',
          fullName: u.full_name || u.username || 'My Money User',
          username: u.username || null,
          emailMasked: maskEmailForPrivacy(u.email),
          phoneMasked: maskPhoneForPrivacy(u.phone),
          avatarUrl: u.avatar_url || null,
          isSelf,
          isVerified: Boolean(u.is_verified),
          connectionStatus,
          isAlreadyConnected: isConnected,
          isSavedContact: Boolean(u.is_saved_contact),
        };
      });

      sendJson(res, 200, { success: true, users: sanitizedUsers });
      return true;
    }

    // =========================================================================
    // SECTION D: USER-SPECIFIC UDHAAR QR CODES & SECURE ONE-TIME PAIRING
    // =========================================================================

    // 12. GET MY QR CODE: GET /api/udhar/qr/my-code
    if (pathname === '/api/udhar/qr/my-code' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required. Please log in.' });
        return true;
      }

      if (!isDatabaseAvailable()) {
        const restRes = await getMyQrRest(authUser);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      let pairingToken = '';
      let pairingCode = '';
      let expiresAt: any = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      try {
        const tokenRes = await query(
          `SELECT pairing_token, pairing_code, expires_at 
           FROM public.qr_pairing_tokens 
           WHERE user_id = $1 AND expires_at > NOW() AND used = FALSE 
           ORDER BY created_at DESC LIMIT 1`,
          [authUser.id]
        );
        if (tokenRes.rows.length > 0) {
          pairingToken = tokenRes.rows[0].pairing_token;
          pairingCode = tokenRes.rows[0].pairing_code;
          if (tokenRes.rows[0].expires_at) expiresAt = tokenRes.rows[0].expires_at;
        }
      } catch (err) {
        console.warn('QR tokens table query notice:', err);
      }

      if (!pairingToken) {
        pairingToken = crypto.randomBytes(32).toString('hex');
        pairingCode = `MM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        await query(
          `INSERT INTO public.qr_pairing_tokens (user_id, pairing_token, pairing_code, is_single_use, expires_at)
           VALUES ($1, $2, $3, FALSE, $4)`,
          [authUser.id, pairingToken, pairingCode, expiresAt]
        );
      }

      const qrPayload = JSON.stringify({
        app: 'my-money',
        v: 2,
        type: 'udhar-pair',
        token: pairingToken,
        code: pairingCode,
        exp: new Date(expiresAt).getTime(),
      });

      sendJson(res, 200, {
        success: true,
        pairingToken,
        pairingCode,
        publicName: authUser.full_name || authUser.email?.split('@')[0] || 'User',
        avatarUrl: authUser.avatar_url || null,
        qrData: qrPayload,
        expiresAt,
      });
      return true;
    }

    // 13. RESOLVE QR CODE: POST /api/udhar/qr/resolve
    if (pathname === '/api/udhar/qr/resolve' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required. Please log in.' });
        return true;
      }

      const body = await parseJsonBody(req);
      if (!isDatabaseAvailable()) {
        const restRes = await resolveQrRest(authUser, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      let targetToken = (body.pairingToken || '').trim();
      let targetCode = (body.pairingCode || '').trim().toUpperCase();
      const rawData = (body.qrData || '').trim();

      if (rawData) {
        const parsedQr = parseQrPayload(rawData);
        if (!parsedQr.valid) {
          sendJson(res, 400, {
            success: false,
            code: 'INVALID_QR',
            message: parsedQr.error || 'Invalid QR format. Please scan a genuine My Money Manager user QR code.',
          });
          return true;
        }
        if (parsedQr.token) targetToken = parsedQr.token;
        if (parsedQr.code) targetCode = parsedQr.code;
      }

      if (!targetToken && !targetCode) {
        sendJson(res, 400, {
          success: false,
          code: 'INVALID_QR',
          message: 'No valid QR pairing token or code provided.',
        });
        return true;
      }

      const tokenRes = await query(
        `SELECT t.id, t.user_id, t.pairing_token, t.pairing_code, t.expires_at, t.used,
                u.id as account_id, u.full_name, u.email, u.phone, u.avatar_url, u.status,
                COALESCE(u.deletion_status, 'none') AS deletion_status
         FROM public.qr_pairing_tokens t
         JOIN public.app_users u ON t.user_id = u.id
         WHERE (t.pairing_token = $1 OR t.pairing_code = $2)
         ORDER BY t.created_at DESC LIMIT 1`,
        [targetToken || '__none__', targetCode || '__none__']
      );

      if (tokenRes.rows.length === 0) {
        sendJson(res, 404, {
          success: false,
          code: 'NOT_FOUND',
          message: 'QR code not recognized. This is not a registered My Money Manager account QR.',
        });
        return true;
      }

      const qrRecord = tokenRes.rows[0];

      if (qrRecord.used) {
        sendJson(res, 410, {
          success: false,
          code: 'QR_REVOKED',
          message: 'This QR code has been revoked. The user has generated a newer QR code.',
        });
        return true;
      }

      if (new Date(qrRecord.expires_at) <= new Date()) {
        sendJson(res, 410, {
          success: false,
          code: 'QR_EXPIRED',
          message: 'This QR code has expired. Please ask the person to tap "Regenerate QR" to get a fresh code.',
        });
        return true;
      }

      if (qrRecord.status !== 'active' || qrRecord.deletion_status !== 'none') {
        sendJson(res, 403, {
          success: false,
          code: 'ACCOUNT_UNAVAILABLE',
          message: 'This user account is currently deactivated or suspended.',
        });
        return true;
      }

      if (qrRecord.user_id === authUser.id) {
        sendJson(res, 400, {
          success: false,
          code: 'SELF_CONNECTION',
          message: 'This is your own QR code! You cannot link your account with yourself.',
        });
        return true;
      }

      const connRes = await query(
        `SELECT id, status FROM public.user_connections 
         WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)`,
        [authUser.id, qrRecord.user_id]
      );
      if (connRes.rows.some((r: any) => r.status === 'blocked')) {
        sendJson(res, 403, {
          success: false,
          code: 'BLOCKED',
          message: 'You cannot connect with this account.',
        });
        return true;
      }
      const isAlreadyConnected = connRes.rows.some((r: any) => r.status === 'connected');

      sendJson(res, 200, {
        success: true,
        owner: {
          id: qrRecord.user_id,
          displayName: qrRecord.full_name || qrRecord.email?.split('@')[0] || 'User',
          fullName: qrRecord.full_name || qrRecord.email?.split('@')[0] || 'User',
          emailMasked: maskEmailForPrivacy(qrRecord.email),
          phoneMasked: maskPhoneForPrivacy(qrRecord.phone),
          avatarUrl: qrRecord.avatar_url || null,
          isVerified: true,
        },
        pairingToken: qrRecord.pairing_token,
        pairingCode: qrRecord.pairing_code,
        isAlreadyConnected,
      });
      return true;
    }

    // 13B. REGENERATE QR CODE: POST /api/udhar/qr/regenerate
    if (pathname === '/api/udhar/qr/regenerate' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required. Please log in.' });
        return true;
      }

      if (!isDatabaseAvailable()) {
        const restRes = await regenerateQrRest(authUser);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      await query('UPDATE public.qr_pairing_tokens SET used = TRUE WHERE user_id = $1', [authUser.id]);

      const pairingToken = crypto.randomBytes(32).toString('hex');
      const pairingCode = `MM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await query(
        `INSERT INTO public.qr_pairing_tokens (user_id, pairing_token, pairing_code, is_single_use, expires_at)
         VALUES ($1, $2, $3, FALSE, $4)`,
        [authUser.id, pairingToken, pairingCode, expiresAt]
      );

      const qrPayload = JSON.stringify({
        app: 'my-money',
        v: 2,
        type: 'udhar-pair',
        token: pairingToken,
        code: pairingCode,
        exp: expiresAt.getTime(),
      });

      sendJson(res, 200, {
        success: true,
        message: 'Fresh QR code generated successfully. Previous codes have been expired.',
        pairingToken,
        pairingCode,
        publicName: authUser.full_name || authUser.email?.split('@')[0] || 'User',
        avatarUrl: authUser.avatar_url || null,
        qrData: qrPayload,
        expiresAt,
      });
      return true;
    }

    // 14. CONNECT PERSON VIA QR: POST /api/udhar/qr/connect
    if (pathname === '/api/udhar/qr/connect' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);
      if (!isDatabaseAvailable()) {
        const restRes = await connectQrRest(authUser, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const pairingToken = (body.pairingToken || '').trim();
      const pairingCode = (body.pairingCode || '').trim().toUpperCase();
      const relationshipType = (body.relationshipType || 'Friend').trim();

      const tokenRes = await query(
        `SELECT t.id, t.user_id, t.is_single_use, u.full_name, u.email, u.phone, u.avatar_url, u.status,
                COALESCE(u.deletion_status, 'none') AS deletion_status
         FROM public.qr_pairing_tokens t
         JOIN public.app_users u ON t.user_id = u.id
         WHERE (t.pairing_token = $1 OR t.pairing_code = $2) AND t.expires_at > NOW() AND t.used = FALSE`,
        [pairingToken || '__none__', pairingCode || '__none__']
      );

      if (tokenRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Pairing reference expired, revoked or invalid.' });
        return true;
      }

      const tokenRecord = tokenRes.rows[0];
      const targetUserId = tokenRecord.user_id;

      if (tokenRecord.status !== 'active' || tokenRecord.deletion_status !== 'none') {
        sendJson(res, 403, { success: false, message: 'This user account is currently deactivated or suspended.' });
        return true;
      }

      if (targetUserId === authUser.id) {
        sendJson(res, 400, { success: false, message: 'Cannot connect with your own QR code.' });
        return true;
      }

      const existingConn = await query(
        `SELECT id, status FROM public.user_connections 
         WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)`,
        [authUser.id, targetUserId]
      );
      if (existingConn.rows.some((r: any) => r.status === 'blocked')) {
        sendJson(res, 403, { success: false, message: 'Connection is blocked between these accounts.' });
        return true;
      }
      const wasAlreadyConnected = existingConn.rows.some((r: any) => r.status === 'connected');

      await query(
        `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
         VALUES ($1, $2, 'connected')
         ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
        [authUser.id, targetUserId]
      );
      await query(
        `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
         VALUES ($1, $2, 'connected')
         ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
        [targetUserId, authUser.id]
      ).catch(() => {});

      const targetDisplayName = (tokenRecord.full_name || tokenRecord.email?.split('@')[0] || 'Friend').trim();
      const existingLinked = await query(
        `SELECT id, name FROM public.udhar_contacts WHERE user_id = $1 AND linked_user_id = $2 LIMIT 1`,
        [authUser.id, targetUserId]
      );

      if (existingLinked.rows.length > 0) {
        await query(
          `UPDATE public.udhar_contacts 
           SET name = $1, email = COALESCE($2, email), phone = COALESCE($3, phone), photo_url = COALESCE($4, photo_url), relationship_type = $5, updated_at = NOW() 
           WHERE id = $6`,
          [targetDisplayName, tokenRecord.email, tokenRecord.phone, tokenRecord.avatar_url, relationshipType, existingLinked.rows[0].id]
        );
      } else {
        await query(
          `INSERT INTO public.udhar_contacts (user_id, name, email, phone, photo_url, relationship_type, linked_user_id, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (user_id, name) DO UPDATE 
           SET linked_user_id = EXCLUDED.linked_user_id, 
               email = COALESCE(EXCLUDED.email, public.udhar_contacts.email), 
               phone = COALESCE(EXCLUDED.phone, public.udhar_contacts.phone), 
               photo_url = COALESCE(EXCLUDED.photo_url, public.udhar_contacts.photo_url), 
               updated_at = NOW()`,
          [authUser.id, targetDisplayName, tokenRecord.email, tokenRecord.phone, tokenRecord.avatar_url, relationshipType, targetUserId]
        ).catch(err => console.warn('QR user contact insert notice:', err));
      }

      await ensureReciprocalContact(targetUserId, authUser, relationshipType);

      if (tokenRecord.is_single_use) {
        await query(
          `UPDATE public.qr_pairing_tokens 
           SET used = TRUE, used_by_user_id = $1, used_at = NOW() 
           WHERE id = $2`,
          [authUser.id, tokenRecord.id]
        );
      }

      notifyQrConnected({
        userAId: authUser.id,
        userAName: authUser.full_name || 'My Money User',
        userBId: targetUserId,
        userBName: tokenRecord.full_name || 'Friend',
      }).catch((e) => console.warn('[Notify QR Connected Error]:', e));

      await logSecurityEvent('USER_LINKED_VIA_QR', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { targetUserId, targetName: tokenRecord.full_name },
      });

      sendJson(res, 200, {
        success: true,
        alreadyConnected: wasAlreadyConnected,
        message: wasAlreadyConnected
          ? `Already connected with ${tokenRecord.full_name}.`
          : `Successfully linked with ${tokenRecord.full_name}! Added to Saved People.`,
        connectedUser: {
          id: targetUserId,
          name: tokenRecord.full_name,
          displayName: tokenRecord.full_name,
          fullName: tokenRecord.full_name,
          emailMasked: maskEmailForPrivacy(tokenRecord.email),
          phoneMasked: maskPhoneForPrivacy(tokenRecord.phone),
          avatarUrl: tokenRecord.avatar_url || null,
        },
      });
      return true;
    }

    // =========================================================================
    // SECTION E: TWO-SIDED UDHAAR TRANSACTIONS, ACCEPTANCE, DISPUTES & REPAYMENTS
    // =========================================================================

    // 15. GET UDHAAR TRANSACTIONS & SUMMARY: GET /api/udhar/transactions
    if (pathname === '/api/udhar/transactions' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      if (!isDatabaseAvailable()) {
        const restRes = await getUdharTransactionsRest(authUser);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const [txRes, repayRes, contactsRes] = await Promise.all([
        query(
          `SELECT t.*, 
                  u.full_name AS counterpart_registered_name, 
                  u.email AS counterpart_email,
                  u.avatar_url AS counterpart_avatar
           FROM public.udhar_transactions t
           LEFT JOIN public.app_users u ON t.counterpart_user_id = u.id
           WHERE t.user_id = $1
           ORDER BY t.transaction_date DESC, t.created_at DESC`,
          [authUser.id]
        ),
        query(
          `SELECT r.*, t.id AS tx_id, u.full_name AS recorded_by_name
           FROM public.udhar_repayments r
           JOIN public.udhar_transactions t ON (r.link_id = t.link_id OR r.udhar_id = t.id)
           LEFT JOIN public.app_users u ON r.recorded_by_user_id = u.id
           WHERE t.user_id = $1
           ORDER BY r.repayment_date DESC, r.created_at DESC`,
          [authUser.id]
        ),
        query(
          `SELECT name, linked_user_id FROM public.udhar_contacts WHERE user_id = $1`,
          [authUser.id]
        ),
      ]);

      let editHistRes: any = { rows: [] };
      try {
        editHistRes = await query(
          `SELECT h.*, u.full_name AS edited_by_name
           FROM public.udhar_edit_history h
           LEFT JOIN public.app_users u ON h.edited_by_user_id = u.id
           JOIN public.udhar_transactions t ON h.link_id = t.link_id
           WHERE t.user_id = $1
           ORDER BY h.created_at DESC`,
          [authUser.id]
        );
      } catch (e) {
        console.warn('Audit history query notice:', e);
      }

      const repaymentsByUdhar: Record<string, any[]> = {};
      for (const rep of repayRes.rows) {
        const key = rep.tx_id || rep.udhar_id;
        if (!repaymentsByUdhar[key]) repaymentsByUdhar[key] = [];
        const { note: repNote, meta: repMeta } = unpackStructuredNote(rep.notes);
        repaymentsByUdhar[key].push({
          ...rep,
          notes: repNote || null,
          transaction_ref: rep.transaction_ref || repMeta.transaction_ref || null,
          repayment_time: rep.repayment_time || repMeta.repayment_time || null,
          attachment_url: rep.attachment_url || repMeta.attachment_url || null,
        });
      }

      const editHistoryByLink: Record<string, any[]> = {};
      for (const hist of editHistRes.rows) {
        if (!editHistoryByLink[hist.link_id]) editHistoryByLink[hist.link_id] = [];
        editHistoryByLink[hist.link_id].push(hist);
      }

      const transactions = txRes.rows.map((r: any) => {
        const orig = parseFloat(r.original_amount) || 0;
        const cur = parseFloat(r.current_balance) || 0;
        const computedPaid = Math.max(0, roundMoney(orig - cur));
        const { note, meta } = unpackStructuredNote(r.notes);
        return {
          ...r,
          paid_amount: r.paid_amount !== null && r.paid_amount !== undefined ? parseFloat(r.paid_amount) : computedPaid,
          category: r.category || meta.category || 'Personal Loan',
          payment_method: r.payment_method || meta.payment_method || 'UPI',
          description: r.description || meta.description || null,
          clean_notes: note || null,
          notes: note || null,
          attachment_url: r.attachment_url || meta.attachment_url || null,
          repayments: repaymentsByUdhar[r.id] || [],
          edit_history: editHistoryByLink[r.link_id] || [],
        };
      });

      const summary = calculatePeopleDashboardSummary(transactions, contactsRes.rows);

      sendJson(res, 200, {
        success: true,
        transactions,
        summary,
      });
      return true;
    }

    // 16. CREATE UDHAAR TRANSACTION (TWO-SIDED IF LINKED USER): POST /api/udhar/transactions
    if (pathname === '/api/udhar/transactions' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);
      if (!isDatabaseAvailable()) {
        const restRes = await createUdharTransactionRest(authUser, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const counterpartName = (body.counterpart_name || body.person_name || '').trim();
      const counterpartUserId = (body.counterpart_user_id || body.counterpartUserId || '').trim() || null;
      const direction = body.direction;
      const amount = roundMoney(parseFloat(body.amount));
      const txDate = body.transaction_date || body.date || new Date().toISOString().split('T')[0];
      const dueDate = body.due_date || body.dueDate || null;
      const plainNotes = (body.notes || '').trim();
      const category = (body.category || 'Personal Loan').trim();
      const paymentMethod = (body.payment_method || body.paymentMethod || 'UPI').trim();
      const description = (body.description || '').trim();
      const attachmentUrl = body.attachment_url || null;
      const idempotencyKey = (body.idempotency_key || body.idempotencyKey || '').trim() || null;

      if (!counterpartName) {
        sendJson(res, 400, { success: false, message: "Person's name is required." });
        return true;
      }
      if (!['gave', 'took'].includes(direction)) {
        sendJson(res, 400, { success: false, message: "Transaction type must be 'gave' (I Gave) or 'took' (I Took)." });
        return true;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        sendJson(res, 400, { success: false, message: 'Please enter a valid amount greater than ₹0.' });
        return true;
      }

      if (idempotencyKey) {
        const dupRes = await query(
          `SELECT * FROM public.udhar_transactions WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1`,
          [authUser.id, idempotencyKey]
        );
        if (dupRes.rows.length > 0) {
          sendJson(res, 200, {
            success: true,
            deduplicated: true,
            message: 'Udhar already recorded.',
            transaction: dupRes.rows[0],
            isLinked: Boolean(dupRes.rows[0].counterpart_user_id),
          });
          return true;
        }
      }

      const packedNotes = packStructuredNote(plainNotes, {
        category,
        payment_method: paymentMethod,
        description: description || undefined,
        attachment_url: attachmentUrl || undefined,
      });

      const linkId = crypto.randomUUID();

      // Verify registered counterpart ONLY when explicit counterpartUserId is provided
      let isRegisteredCounterpart = false;
      let registeredUser: any = null;

      if (counterpartUserId && counterpartUserId !== authUser.id) {
        const uCheck = await query(
          `SELECT id, full_name, email, status, COALESCE(deletion_status, 'none') AS deletion_status
           FROM public.app_users WHERE id = $1`,
          [counterpartUserId]
        );
        if (uCheck.rows.length > 0 && uCheck.rows[0].status === 'active' && uCheck.rows[0].deletion_status === 'none') {
          const blk = await query(
            `SELECT 1 FROM public.user_connections
             WHERE ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))
               AND status = 'blocked' LIMIT 1`,
            [authUser.id, counterpartUserId]
          );
          if (blk.rows.length > 0) {
            sendJson(res, 403, { success: false, message: 'Cannot create shared Udhar with a blocked user.' });
            return true;
          }
          isRegisteredCounterpart = true;
          registeredUser = uCheck.rows[0];
        }
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (isRegisteredCounterpart) {
          const userARes = await client.query(
            `INSERT INTO public.udhar_transactions (
              link_id, user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance, paid_amount,
              transaction_date, due_date, notes, attachment_url, status, confirmation_status, is_initiator, idempotency_key
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, 'confirmed', 'confirmed', TRUE, $12)
            RETURNING *`,
            [linkId, authUser.id, registeredUser.id, registeredUser.full_name, direction, amount, amount, txDate, dueDate, packedNotes, attachmentUrl, idempotencyKey]
          );

          const counterpartDirection = direction === 'gave' ? 'took' : 'gave';
          await client.query(
            `INSERT INTO public.udhar_transactions (
              link_id, user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance, paid_amount,
              transaction_date, due_date, notes, attachment_url, status, confirmation_status, is_initiator, idempotency_key
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, 'confirmed', 'confirmed', FALSE, $12)`,
            [
              linkId,
              registeredUser.id,
              authUser.id,
              authUser.full_name,
              counterpartDirection,
              amount,
              amount,
              txDate,
              dueDate,
              packedNotes,
              attachmentUrl,
              idempotencyKey ? `${idempotencyKey}:counterpart` : null,
            ]
          );

          await client.query(
            `INSERT INTO public.udhar_contacts (user_id, name, email, relationship_type, linked_user_id, updated_at)
             VALUES ($1, $2, $3, 'Friend', $4, NOW())
             ON CONFLICT (user_id, name) DO UPDATE SET linked_user_id = EXCLUDED.linked_user_id, updated_at = NOW()`,
            [authUser.id, registeredUser.full_name, registeredUser.email, registeredUser.id]
          );

          await client.query(
            `INSERT INTO public.udhar_contacts (user_id, name, email, relationship_type, linked_user_id, updated_at)
             VALUES ($1, $2, $3, 'Friend', $4, NOW())
             ON CONFLICT (user_id, name) DO UPDATE SET linked_user_id = EXCLUDED.linked_user_id, updated_at = NOW()`,
            [registeredUser.id, authUser.full_name, authUser.email, authUser.id]
          );

          // FIXED PRIVACY LEAK: Always scope notification strictly to registeredUser.id (NEVER default to 'all')
          const notifMsg = `${authUser.full_name} recorded a shared Udhar of ₹${amount.toLocaleString('en-IN')} (${direction === 'gave' ? "You'll Pay" : "You'll Receive"}).`;
          await client.query(
            `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
             VALUES ($1, $2, 'udhar_created', $3, $4, $5, TRUE)`,
            [`New Shared Udhar from ${authUser.full_name}`, notifMsg, registeredUser.id, linkId, authUser.id]
          ).catch(() => {});

          await client.query('COMMIT');

          await ensureReciprocalContact(registeredUser.id, authUser, 'Friend');

          await logSecurityEvent('UDHAR_TWO_SIDED_CREATED', {
            userId: authUser.id,
            userEmail: authUser.email,
            details: { linkId, counterpartId: registeredUser.id, amount, direction },
          });

          notifyUdharCreated({
            initiatorUserId: authUser.id,
            initiatorName: authUser.full_name || 'Friend',
            recipientUserId: registeredUser.id,
            transactionId: userARes.rows[0].id,
            contactName: registeredUser.full_name || 'Friend',
            amount,
            direction,
            dueDate,
          }).catch((e) => console.warn('[Notify Udhar Created Error]:', e));

          sendUdharCreatedEmails({
            transactionId: userARes.rows[0].id,
            linkId,
            initiatorUserId: authUser.id,
            initiatorName: authUser.full_name || 'My Money User',
            initiatorEmail: authUser.email,
            counterpartUserId: registeredUser.id,
            counterpartName: registeredUser.full_name,
            counterpartEmail: registeredUser.email,
            direction,
            amount,
            description: description || plainNotes || undefined,
            transactionDate: txDate,
            status: 'confirmed',
          }).catch((e) => console.warn('[Udhar Created Two-Sided Email Error]:', e));

          const createdRow = userARes.rows[0];
          sendJson(res, 201, {
            success: true,
            message: `Shared Udhar recorded with ${registeredUser.full_name}. Synchronized across both accounts.`,
            transaction: {
              ...createdRow,
              category,
              payment_method: paymentMethod,
              description: description || null,
              notes: plainNotes || null,
              clean_notes: plainNotes || null,
              repayments: [],
              edit_history: [],
            },
            isLinked: true,
          });
          return true;
        } else {
          const singleRes = await client.query(
            `INSERT INTO public.udhar_transactions (
              link_id, user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance, paid_amount,
              transaction_date, due_date, notes, attachment_url, status, confirmation_status, is_initiator, idempotency_key
            ) VALUES ($1, $2, NULL, $3, $4, $5, $6, 0, $7, $8, $9, $10, 'confirmed', 'confirmed', TRUE, $11)
            RETURNING *`,
            [linkId, authUser.id, counterpartName, direction, amount, amount, txDate, dueDate, packedNotes, attachmentUrl, idempotencyKey]
          );

          await client.query(
            `INSERT INTO public.udhar_contacts (user_id, name, relationship_type, updated_at)
             VALUES ($1, $2, 'Friend', NOW())
             ON CONFLICT (user_id, name) DO NOTHING`,
            [authUser.id, counterpartName]
          );

          await client.query('COMMIT');

          await logSecurityEvent('UDHAR_UNREGISTERED_CREATED', {
            userId: authUser.id,
            userEmail: authUser.email,
            details: { counterpartName, amount, direction },
          });

          notifyUdharCreated({
            initiatorUserId: authUser.id,
            recipientUserId: null,
            transactionId: singleRes.rows[0].id,
            contactName: counterpartName,
            amount,
            direction,
            dueDate,
          }).catch((e) => console.warn('[Notify Udhar Created Error]:', e));

          const createdRow = singleRes.rows[0];
          sendJson(res, 201, {
            success: true,
            message: `Local Udhar recorded for ${counterpartName}.`,
            transaction: {
              ...createdRow,
              category,
              payment_method: paymentMethod,
              description: description || null,
              notes: plainNotes || null,
              clean_notes: plainNotes || null,
              repayments: [],
              edit_history: [],
            },
            isLinked: false,
          });
          return true;
        }
      } catch (e: any) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    // 17. CONFIRM TRANSACTION: POST /api/udhar/transactions/:id/confirm
    const confirmMatch = pathname.match(/^\/api\/udhar\/transactions\/([a-zA-Z0-9_-]+)\/confirm$/);
    if (confirmMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const txId = confirmMatch[1];
      if (!isDatabaseAvailable()) {
        const restRes = await confirmUdharTransactionRest(authUser, txId);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const txRes = await query('SELECT * FROM public.udhar_transactions WHERE id = $1 AND user_id = $2', [txId, authUser.id]);
      if (txRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Transaction not found.' });
        return true;
      }

      const tx = txRes.rows[0];
      await query(
        `UPDATE public.udhar_transactions 
         SET status = 'confirmed', confirmation_status = 'confirmed', updated_at = NOW() 
         WHERE link_id = $1`,
        [tx.link_id]
      );

      await logSecurityEvent('UDHAR_CONFIRMED', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { txId, linkId: tx.link_id },
      });

      sendJson(res, 200, { success: true, message: 'Transaction confirmed successfully on both accounts.' });
      return true;
    }

    // 18. DISPUTE TRANSACTION: POST /api/udhar/transactions/:id/dispute
    const disputeMatch = pathname.match(/^\/api\/udhar\/transactions\/([a-zA-Z0-9_-]+)\/dispute$/);
    if (disputeMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const txId = disputeMatch[1];
      const body = await parseJsonBody(req);
      const disputeReason = (body.reason || 'Transaction disputed by user').trim();

      if (!isDatabaseAvailable()) {
        const restRes = await disputeUdharTransactionRest(authUser, txId, disputeReason);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const txRes = await query('SELECT * FROM public.udhar_transactions WHERE id = $1 AND user_id = $2', [txId, authUser.id]);
      if (txRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Transaction not found.' });
        return true;
      }

      const tx = txRes.rows[0];
      await query(
        `UPDATE public.udhar_transactions 
         SET status = 'disputed', confirmation_status = 'disputed', dispute_reason = $1, disputed_at = NOW(), disputed_by = $2, updated_at = NOW() 
         WHERE link_id = $3`,
        [disputeReason, authUser.id, tx.link_id]
      );

      await logSecurityEvent('UDHAR_DISPUTED', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { txId, linkId: tx.link_id, disputeReason },
      });

      sendJson(res, 200, { success: true, message: 'Transaction marked as disputed. Reason visible to both parties.' });
      return true;
    }

    // 19. REPAY / SETTLE TRANSACTION: POST /api/udhar/transactions/:id/repay
    const repayMatch = pathname.match(/^\/api\/udhar\/transactions\/([a-zA-Z0-9_-]+)\/repay$/);
    if (repayMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const txId = repayMatch[1];
      const body = await parseJsonBody(req);

      if (!isDatabaseAvailable()) {
        const restRes = await repayUdharRest(authUser, txId, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const repayAmount = roundMoney(parseFloat(body.amount));
      const repayDate = body.repayment_date || body.date || new Date().toISOString().split('T')[0];
      const repayTime = (body.repayment_time || body.repaymentTime || '').trim();
      const plainNotes = (body.notes || '').trim();
      const paymentMethod = (body.payment_method || body.paymentMethod || 'UPI').trim();
      const transactionRef = (body.transaction_ref || body.transactionRef || '').trim();
      const attachmentUrl = (body.attachment_url || body.attachmentUrl || '').trim();
      const idempotencyKey = (body.idempotency_key || body.idempotencyKey || '').trim() || null;

      const packedRepayNotes = packStructuredNote(plainNotes, {
        transaction_ref: transactionRef || undefined,
        repayment_time: repayTime || undefined,
        attachment_url: attachmentUrl || undefined,
      });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Lock canonical row to prevent concurrent over-repayment race conditions
        const txRes = await client.query(
          `SELECT * FROM public.udhar_transactions WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [txId, authUser.id]
        );
        if (txRes.rows.length === 0) {
          await client.query('ROLLBACK');
          sendJson(res, 404, { success: false, message: 'Transaction not found.' });
          return true;
        }
        const tx = txRes.rows[0];

        if (idempotencyKey) {
          const dupRep = await client.query(
            `SELECT * FROM public.udhar_repayments WHERE link_id = $1 AND idempotency_key = $2 LIMIT 1`,
            [tx.link_id, idempotencyKey]
          );
          if (dupRep.rows.length > 0) {
            await client.query('COMMIT');
            sendJson(res, 200, {
              success: true,
              deduplicated: true,
              repayment: dupRep.rows[0],
              isPendingConfirmation: dupRep.rows[0].status === 'pending_confirmation',
              remainingBalance: parseFloat(tx.current_balance) || 0,
              isSettled: tx.status === 'settled',
              message: 'Repayment already recorded.',
            });
            return true;
          }
        }

        const sumsRes = await client.query(
          `SELECT
             COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount ELSE 0 END), 0) AS confirmed_paid,
             COALESCE(SUM(CASE WHEN status = 'pending_confirmation' THEN amount ELSE 0 END), 0) AS pending_paid
           FROM public.udhar_repayments
           WHERE link_id = $1`,
          [tx.link_id]
        );

        const calc = calculateRepaymentApplication({
          originalAmount: parseFloat(tx.original_amount) || 0,
          confirmedPaidAmount: parseFloat(sumsRes.rows[0].confirmed_paid) || 0,
          pendingRepaymentsAmount: parseFloat(sumsRes.rows[0].pending_paid) || 0,
          repayAmount,
          isShared: Boolean(tx.counterpart_user_id),
          actorRole: tx.direction === 'gave' ? 'lender' : 'borrower',
          udharStatus: tx.status,
        });

        if (!calc.valid) {
          await client.query('ROLLBACK');
          sendJson(res, 400, { success: false, message: calc.error || 'Invalid repayment amount.' });
          return true;
        }

        const repaymentStatus = calc.repaymentStatus!;
        const repInsertRes = await client.query(
          `INSERT INTO public.udhar_repayments (
            link_id, udhar_id, recorded_by_user_id, amount, repayment_date, payment_method, notes, status,
            idempotency_key, confirmed_at, confirmed_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (CASE WHEN $8 = 'confirmed' THEN NOW() ELSE NULL END), (CASE WHEN $8 = 'confirmed' THEN $3 ELSE NULL END))
          RETURNING *`,
          [tx.link_id, tx.id, authUser.id, repayAmount, repayDate, paymentMethod, packedRepayNotes, repaymentStatus, idempotencyKey]
        );

        const newBalance = calc.nextRemainingAmount ?? parseFloat(tx.current_balance);
        const isSettled = Boolean(calc.isSettled);

        if (repaymentStatus === 'confirmed') {
          await client.query(
            `UPDATE public.udhar_transactions 
             SET current_balance = $1, paid_amount = $2, status = $3, 
                 settled_at = (CASE WHEN $4 = TRUE THEN NOW() ELSE settled_at END), updated_at = NOW() 
             WHERE link_id = $5`,
            [newBalance, calc.nextPaidAmount, calc.nextUdharStatus, isSettled, tx.link_id]
          );
        }

        await client.query('COMMIT');

        await logSecurityEvent('UDHAR_REPAYMENT_RECORDED', {
          userId: authUser.id,
          userEmail: authUser.email,
          details: { txId, linkId: tx.link_id, amount: repayAmount, status: repaymentStatus, remainingBalance: newBalance, isSettled },
        });

        if (repaymentStatus === 'pending_confirmation' && tx.counterpart_user_id) {
          await query(
            `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
             VALUES ($1, $2, 'repayment_pending', $3, $4, $5, TRUE)`,
            [
              `Repayment Confirmation Needed: ${authUser.full_name}`,
              `${authUser.full_name} reported a payment of ₹${repayAmount.toLocaleString('en-IN')} via ${paymentMethod}. Please confirm receipt.`,
              tx.counterpart_user_id,
              tx.link_id,
              authUser.id,
            ]
          ).catch(() => {});
        } else if (repaymentStatus === 'confirmed') {
          notifyUdharRepayment({
            initiatorUserId: authUser.id,
            initiatorName: authUser.full_name || 'Friend',
            recipientUserId: tx.counterpart_user_id || null,
            repaymentId: txId,
            contactName: tx.counterpart_name || 'Contact',
            repaymentAmount: repayAmount,
            remainingBalance: newBalance,
            isFullySettled: isSettled,
          }).catch((e) => console.warn('[Notify Udhar Repayment Error]:', e));

          if (tx.counterpart_user_id) {
            await query(
              `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
               VALUES ($1, $2, 'repayment', $3, $4, $5, TRUE)`,
              [
                isSettled ? `Udhar Settled with ${authUser.full_name}` : `Repayment Recorded by ${authUser.full_name}`,
                `${authUser.full_name} recorded a repayment of ₹${repayAmount.toLocaleString('en-IN')}. Remaining balance: ₹${newBalance.toLocaleString('en-IN')}.`,
                tx.counterpart_user_id,
                tx.link_id,
                authUser.id,
              ]
            ).catch(() => {});
          }

          if (isSettled) {
            sendUdharSettledEmails({
              transactionId: tx.id,
              linkId: tx.link_id,
              initiatorUserId: authUser.id,
              initiatorName: authUser.full_name || 'My Money User',
              initiatorEmail: authUser.email,
              counterpartUserId: tx.counterpart_user_id || null,
              counterpartName: tx.counterpart_name,
              amountSettled: repayAmount,
              settlementDate: repayDate,
              updatedBalance: newBalance,
              direction: tx.direction,
            }).catch((e) => console.warn('[Udhar Settled Email Error]:', e));
          }
        }

        sendJson(res, 200, {
          success: true,
          repayment: repInsertRes.rows[0],
          isPendingConfirmation: repaymentStatus === 'pending_confirmation',
          message: repaymentStatus === 'pending_confirmation'
            ? `Payment of ₹${repayAmount.toLocaleString('en-IN')} submitted! Waiting for ${tx.counterpart_name} to confirm receipt.`
            : isSettled
              ? 'Full repayment recorded! Transaction is now completely settled.'
              : `Partial repayment of ₹${repayAmount.toLocaleString('en-IN')} recorded. Remaining balance: ₹${newBalance.toLocaleString('en-IN')}.`,
          remainingBalance: newBalance,
          isSettled,
        });
        return true;
      } catch (e: any) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    // 19B. CONFIRM REPAYMENT (LENDER ONLY): POST /api/udhar/repayments/:id/confirm
    const confirmRepaymentMatch = pathname.match(/^\/api\/udhar\/repayments\/([a-zA-Z0-9_-]+)\/confirm$/);
    if (confirmRepaymentMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const repaymentId = confirmRepaymentMatch[1];
      if (!isDatabaseAvailable()) {
        const restRes = await confirmRepaymentRest(authUser, repaymentId);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const repRes = await query(`SELECT r.* FROM public.udhar_repayments r WHERE r.id = $1`, [repaymentId]);
      if (repRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Repayment record not found.' });
        return true;
      }

      const rep = repRes.rows[0];
      if (rep.status === 'confirmed') {
        sendJson(res, 400, { success: false, message: 'This repayment has already been confirmed.' });
        return true;
      }

      const txRes = await query(
        `SELECT * FROM public.udhar_transactions WHERE link_id = $1 AND user_id = $2`,
        [rep.link_id, authUser.id]
      );
      if (txRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Associated transaction not found for your account.' });
        return true;
      }

      const tx = txRes.rows[0];
      if (tx.direction !== 'gave') {
        sendJson(res, 403, {
          success: false,
          message: 'Only the lender who gave the money can confirm receipt of repayment.',
        });
        return true;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `UPDATE public.udhar_repayments 
           SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = $1, rejection_reason = NULL
           WHERE id = $2`,
          [authUser.id, repaymentId]
        );

        const sumRes = await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS total_repaid
           FROM public.udhar_repayments
           WHERE link_id = $1 AND status = 'confirmed'`,
          [tx.link_id]
        );
        const totalConfirmedRepaid = roundMoney(parseFloat(sumRes.rows[0].total_repaid) || 0);
        const origAmt = roundMoney(parseFloat(tx.original_amount) || 0);
        const newBalance = roundMoney(Math.max(0, origAmt - totalConfirmedRepaid));
        const isSettled = newBalance <= 0.01;
        const newStatus = isSettled ? 'settled' : 'confirmed';

        await client.query(
          `UPDATE public.udhar_transactions 
           SET current_balance = $1, paid_amount = $2, status = $3, 
               settled_at = (CASE WHEN $4 = TRUE THEN NOW() ELSE settled_at END), updated_at = NOW() 
           WHERE link_id = $5`,
          [isSettled ? 0 : newBalance, isSettled ? origAmt : totalConfirmedRepaid, newStatus, isSettled, tx.link_id]
        );

        await client.query('COMMIT');

        if (rep.recorded_by_user_id && rep.recorded_by_user_id !== authUser.id) {
          await query(
            `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
             VALUES ($1, $2, 'repayment_confirmed', $3, $4, $5, TRUE)`,
            [
              `Repayment Confirmed by ${authUser.full_name}`,
              `${authUser.full_name} confirmed receiving your repayment of ₹${parseFloat(rep.amount).toLocaleString('en-IN')}. Remaining balance: ₹${(isSettled ? 0 : newBalance).toLocaleString('en-IN')}.`,
              rep.recorded_by_user_id,
              tx.link_id,
              authUser.id,
            ]
          ).catch(() => {});
        }

        sendJson(res, 200, {
          success: true,
          message: `Repayment of ₹${parseFloat(rep.amount).toLocaleString('en-IN')} confirmed successfully!`,
          remainingBalance: isSettled ? 0 : newBalance,
          isSettled,
        });
        return true;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    // 19C. REJECT REPAYMENT (LENDER ONLY): POST /api/udhar/repayments/:id/reject
    const rejectRepaymentMatch = pathname.match(/^\/api\/udhar\/repayments\/([a-zA-Z0-9_-]+)\/reject$/);
    if (rejectRepaymentMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const repaymentId = rejectRepaymentMatch[1];
      const body = await parseJsonBody(req);
      const rejectionReason = (body.reason || body.rejection_reason || 'Payment not received').trim();

      if (!isDatabaseAvailable()) {
        const restRes = await rejectRepaymentRest(authUser, repaymentId, rejectionReason);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const repRes = await query(`SELECT * FROM public.udhar_repayments WHERE id = $1`, [repaymentId]);
      if (repRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Repayment record not found.' });
        return true;
      }

      const rep = repRes.rows[0];
      const txRes = await query(
        `SELECT * FROM public.udhar_transactions WHERE link_id = $1 AND user_id = $2`,
        [rep.link_id, authUser.id]
      );
      if (txRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Associated transaction not found.' });
        return true;
      }

      const tx = txRes.rows[0];
      if (tx.direction !== 'gave') {
        sendJson(res, 403, {
          success: false,
          message: 'Only the lender who gave the money can reject a repayment claim.',
        });
        return true;
      }

      await query(
        `UPDATE public.udhar_repayments 
         SET status = 'rejected', rejection_reason = $1, confirmed_at = NOW(), confirmed_by = $2 
         WHERE id = $3`,
        [rejectionReason, authUser.id, repaymentId]
      );

      if (rep.recorded_by_user_id && rep.recorded_by_user_id !== authUser.id) {
        await query(
          `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
           VALUES ($1, $2, 'repayment_rejected', $3, $4, $5, TRUE)`,
          [
            `Repayment Claim Rejected`,
            `${authUser.full_name} rejected your payment of ₹${parseFloat(rep.amount).toLocaleString('en-IN')}: "${rejectionReason}".`,
            rep.recorded_by_user_id,
            tx.link_id,
            authUser.id,
          ]
        ).catch(() => {});
      }

      sendJson(res, 200, {
        success: true,
        message: 'Repayment claim rejected.',
        rejectionReason,
      });
      return true;
    }

    // 20. UPDATE UDHAAR TRANSACTION (WITH AUDIT & REPAYMENT PRESERVATION): PUT /api/udhar/transactions/:id
    const updateTxMatch = pathname.match(/^\/api\/udhar\/transactions\/([a-zA-Z0-9_-]+)$/);
    if (updateTxMatch && method === 'PUT') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const txId = updateTxMatch[1];
      const body = await parseJsonBody(req);

      if (!isDatabaseAvailable()) {
        const restRes = await editUdharRest(authUser, txId, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const txRes = await client.query(
          'SELECT * FROM public.udhar_transactions WHERE id = $1 AND (user_id = $2 OR counterpart_user_id = $2) FOR UPDATE',
          [txId, authUser.id]
        );
        if (txRes.rows.length === 0) {
          await client.query('ROLLBACK');
          sendJson(res, 404, { success: false, message: 'Transaction not found.' });
          return true;
        }
        const tx = txRes.rows[0];

        const repaySumRes = await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS total_repaid
           FROM public.udhar_repayments
           WHERE link_id = $1 AND status = 'confirmed'`,
          [tx.link_id]
        );
        const totalConfirmedRepaid = roundMoney(parseFloat(repaySumRes.rows[0].total_repaid) || 0);
        const { note: prevPlainNote, meta: prevMeta } = unpackStructuredNote(tx.notes);
        const editReason = (body.reason_for_edit || body.reason || body.edit_reason || '').trim();

        const validation = validateUdharEdit(
          {
            original_amount: parseFloat(tx.original_amount) || 0,
            paid_amount: totalConfirmedRepaid,
            status: tx.status,
            notes: prevPlainNote,
            transaction_date: tx.transaction_date,
            due_date: tx.due_date,
            category: prevMeta.category || 'Personal Loan',
            payment_method: prevMeta.payment_method || 'UPI',
            description: prevMeta.description || null,
          },
          {
            amount: body.amount !== undefined ? parseFloat(body.amount) : undefined,
            notes: body.notes !== undefined ? (body.notes || '').trim() : undefined,
            transaction_date: body.transaction_date || body.date || undefined,
            due_date: body.due_date !== undefined ? body.due_date : (body.dueDate !== undefined ? body.dueDate : undefined),
            category: body.category !== undefined ? body.category : undefined,
            payment_method: body.payment_method !== undefined ? body.payment_method : undefined,
            description: body.description !== undefined ? body.description : undefined,
            reason_for_edit: editReason,
          }
        );

        if (!validation.valid) {
          await client.query('ROLLBACK');
          sendJson(res, 400, { success: false, message: validation.error || 'Invalid edit.' });
          return true;
        }

        const updatedAmt = validation.nextOriginalAmount!;
        const newBalance = validation.nextRemainingAmount!;
        const isSettled = Boolean(validation.isSettled);
        const newStatus = validation.nextStatus!;
        const nextPlainNote = body.notes !== undefined ? (body.notes || '').trim() : prevPlainNote;
        const nextPackedNotes = packStructuredNote(nextPlainNote, {
          category: body.category !== undefined ? body.category : prevMeta.category,
          payment_method: body.payment_method !== undefined ? body.payment_method : prevMeta.payment_method,
          description: body.description !== undefined ? body.description : prevMeta.description,
          attachment_url: body.attachment_url !== undefined ? body.attachment_url : prevMeta.attachment_url,
        });
        const updatedDate = body.transaction_date || body.date || tx.transaction_date;
        const updatedDueDate =
          body.due_date !== undefined
            ? body.due_date || null
            : body.dueDate !== undefined
              ? body.dueDate || null
              : tx.due_date;

        await client.query(
          `INSERT INTO public.udhar_edit_history (
            udhar_id, link_id, edited_by_user_id, previous_amount, new_amount,
            previous_notes, new_notes, previous_date, new_date, previous_due_date, new_due_date,
            reason_for_edit
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            tx.id,
            tx.link_id,
            authUser.id,
            parseFloat(tx.original_amount) || 0,
            updatedAmt,
            prevPlainNote || null,
            nextPlainNote || null,
            tx.transaction_date,
            updatedDate,
            tx.due_date,
            updatedDueDate,
            editReason,
          ]
        );

        await client.query(
          `UPDATE public.udhar_transactions 
           SET original_amount = $1, current_balance = $2, paid_amount = $3, status = $4,
               notes = $5, transaction_date = $6, due_date = $7,
               last_edited_at = NOW(), last_edited_by = $8, edit_reason = $9, updated_at = NOW() 
           WHERE link_id = $10`,
          [
            updatedAmt,
            newBalance,
            totalConfirmedRepaid,
            newStatus,
            nextPackedNotes,
            updatedDate,
            updatedDueDate,
            authUser.id,
            editReason,
            tx.link_id,
          ]
        );

        await client.query('COMMIT');

        if (tx.counterpart_user_id) {
          const targetUser = tx.user_id === authUser.id ? tx.counterpart_user_id : tx.user_id;
          await query(
            `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
             VALUES ($1, $2, 'udhar_edited', $3, $4, $5, TRUE)`,
            [
              `Udhar Edited by ${authUser.full_name}`,
              `${authUser.full_name} updated the transaction details (${editReason}). Remaining balance: ₹${newBalance.toLocaleString('en-IN')}.`,
              targetUser,
              tx.link_id,
              authUser.id,
            ]
          ).catch(() => {});
        }

        sendUdharUpdatedEmails({
          transactionId: tx.id,
          linkId: tx.link_id,
          initiatorUserId: authUser.id,
          initiatorName: authUser.full_name || 'My Money User',
          initiatorEmail: authUser.email,
          counterpartUserId: tx.counterpart_user_id || null,
          counterpartName: tx.counterpart_name,
          amount: updatedAmt,
          direction: tx.direction,
          description: nextPlainNote || undefined,
          transactionDate: updatedDate,
          status: newStatus,
        }).catch((e) => console.warn('[Udhar Updated Email Error]:', e));

        sendJson(res, 200, {
          success: true,
          message: `Udhar transaction updated successfully. Remaining balance: ₹${newBalance.toLocaleString('en-IN')}.`,
          remainingBalance: newBalance,
          isSettled,
          changes: validation.changes,
        });
        return true;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // 20B. SETTLE TRANSACTION FULLY (LENDER ONLY FOR 2-WAY): POST /api/udhar/transactions/:id/settle
    const settleTxMatch = pathname.match(/^\/api\/udhar\/transactions\/([a-zA-Z0-9_-]+)\/settle$/);
    if (settleTxMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const txId = settleTxMatch[1];
      const body = await parseJsonBody(req);

      if (!isDatabaseAvailable()) {
        const restRes = await settleUdharRest(authUser, txId, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const notes = (body.notes || 'Settled in full').trim();
      const paymentMethod = (body.payment_method || body.paymentMethod || 'UPI').trim();
      const settleDate = body.settlement_date || body.date || new Date().toISOString().split('T')[0];

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const txRes = await client.query(
          'SELECT * FROM public.udhar_transactions WHERE id = $1 AND user_id = $2 FOR UPDATE',
          [txId, authUser.id]
        );
        if (txRes.rows.length === 0) {
          await client.query('ROLLBACK');
          sendJson(res, 404, { success: false, message: 'Transaction not found.' });
          return true;
        }

        const tx = txRes.rows[0];
        if (tx.counterpart_user_id && tx.direction === 'took') {
          await client.query('ROLLBACK');
          sendJson(res, 403, {
            success: false,
            message: 'Only the lender who gave the money can mark an Udhar as settled. As the borrower, please record a repayment for their confirmation.',
          });
          return true;
        }

        const currentBal = roundMoney(parseFloat(tx.current_balance) || 0);
        if (tx.status === 'settled' || currentBal <= 0.01) {
          await client.query('ROLLBACK');
          sendJson(res, 400, { success: false, message: 'This transaction is already settled.' });
          return true;
        }
        if (tx.status === 'cancelled') {
          await client.query('ROLLBACK');
          sendJson(res, 400, { success: false, message: 'Cannot settle a cancelled transaction.' });
          return true;
        }

        await client.query(
          `INSERT INTO public.udhar_repayments (
            link_id, udhar_id, recorded_by_user_id, amount, repayment_date, payment_method, notes, status,
            confirmed_at, confirmed_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', NOW(), $8)`,
          [tx.link_id, tx.id, authUser.id, currentBal, settleDate, paymentMethod, notes, authUser.id]
        );

        await client.query(
          `UPDATE public.udhar_transactions 
           SET current_balance = 0, paid_amount = original_amount, status = 'settled', settled_at = NOW(), updated_at = NOW() 
           WHERE link_id = $1`,
          [tx.link_id]
        );

        if (tx.counterpart_user_id) {
          await client.query(
            `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
             VALUES ($1, $2, 'settlement', $3, $4, $5, TRUE)`,
            [
              `Udhar Settled with ${authUser.full_name}`,
              `${authUser.full_name} marked the transaction of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')} as fully settled.`,
              tx.counterpart_user_id,
              tx.link_id,
              authUser.id,
            ]
          ).catch(() => {});
        }

        await client.query('COMMIT');

        sendUdharSettledEmails({
          transactionId: tx.id,
          linkId: tx.link_id,
          initiatorUserId: authUser.id,
          initiatorName: authUser.full_name || 'My Money User',
          initiatorEmail: authUser.email,
          counterpartUserId: tx.counterpart_user_id || null,
          counterpartName: tx.counterpart_name,
          amountSettled: currentBal,
          settlementDate: settleDate,
          updatedBalance: 0,
          direction: tx.direction,
        }).catch((e) => console.warn('[Udhar Settled Email Error]:', e));

        await logSecurityEvent('UDHAR_SETTLED_IN_FULL', {
          userId: authUser.id,
          userEmail: authUser.email,
          details: { txId, linkId: tx.link_id, settledAmount: currentBal },
        });

        sendJson(res, 200, {
          success: true,
          message: `Transaction with ${tx.counterpart_name} has been settled in full.`,
          isSettled: true,
        });
        return true;
      } catch (err: any) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // 20C. CANCEL UDHAAR TRANSACTION (BLOCKED IF REPAYMENTS EXIST): DELETE /api/udhar/transactions/:id
    const deleteTxMatch = pathname.match(/^\/api\/udhar\/transactions\/([a-zA-Z0-9_-]+)$/);
    if (deleteTxMatch && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const txId = deleteTxMatch[1];
      if (!isDatabaseAvailable()) {
        const restRes = await cancelUdharRest(authUser, txId);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const txRes = await query('SELECT * FROM public.udhar_transactions WHERE id = $1 AND user_id = $2', [txId, authUser.id]);
      if (txRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Transaction not found.' });
        return true;
      }

      const tx = txRes.rows[0];
      const repsRes = await query(
        `SELECT status FROM public.udhar_repayments WHERE link_id = $1`,
        [tx.link_id]
      );

      const guard = canCancelUdhar({
        status: tx.status,
        paid_amount: tx.paid_amount,
        repayments: repsRes.rows,
      });

      if (!guard.allowed) {
        sendJson(res, 409, {
          success: false,
          message: guard.reason,
        });
        return true;
      }

      await query(
        `UPDATE public.udhar_transactions 
         SET status = 'cancelled', current_balance = 0, updated_at = NOW() 
         WHERE link_id = $1`,
        [tx.link_id]
      );

      if (tx.counterpart_user_id) {
        await query(
          `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
           VALUES ($1, $2, 'udhar_cancelled', $3, $4, $5, TRUE)`,
          [
            `Udhar Cancelled by ${authUser.full_name}`,
            `${authUser.full_name} has cancelled the transaction of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')}.`,
            tx.counterpart_user_id,
            tx.link_id,
            authUser.id,
          ]
        ).catch(() => {});
      }

      await logSecurityEvent('UDHAR_CANCELLED', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { txId, linkId: tx.link_id, originalAmount: tx.original_amount },
      });

      sendJson(res, 200, {
        success: true,
        message: 'Transaction cancelled successfully. Balances updated.',
      });
      return true;
    }

    // 20D. GET TRANSACTION AUDIT & REPAYMENT HISTORY: GET /api/udhar/transactions/:id/history
    const historyTxMatch = pathname.match(/^\/api\/udhar\/transactions\/([a-zA-Z0-9_-]+)\/history$/);
    if (historyTxMatch && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const txId = historyTxMatch[1];
      if (!isDatabaseAvailable()) {
        const restRes = await getUdharHistoryRest(authUser, txId);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const txRes = await query(
        'SELECT * FROM public.udhar_transactions WHERE id = $1 AND (user_id = $2 OR counterpart_user_id = $2)',
        [txId, authUser.id]
      );
      if (txRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Transaction not found.' });
        return true;
      }

      const tx = txRes.rows[0];
      const { note, meta } = unpackStructuredNote(tx.notes);

      let editHistory: any[] = [];
      try {
        const editHistRes = await query(
          `SELECT h.*, u.full_name AS edited_by_name 
           FROM public.udhar_edit_history h
           LEFT JOIN public.app_users u ON h.edited_by_user_id = u.id
           WHERE h.link_id = $1
           ORDER BY h.created_at DESC`,
          [tx.link_id]
        );
        editHistory = editHistRes.rows;
      } catch (err) {
        console.warn('Edit history fetch notice:', err);
      }

      const repaymentsRes = await query(
        `SELECT r.*, u.full_name AS recorded_by_name
         FROM public.udhar_repayments r
         LEFT JOIN public.app_users u ON r.recorded_by_user_id = u.id
         WHERE r.link_id = $1
         ORDER BY r.repayment_date DESC, r.created_at DESC`,
        [tx.link_id]
      );

      const repayments = repaymentsRes.rows.map((r: any) => {
        const { note: repNote, meta: repMeta } = unpackStructuredNote(r.notes);
        return {
          ...r,
          notes: repNote || null,
          transaction_ref: r.transaction_ref || repMeta.transaction_ref || null,
          repayment_time: r.repayment_time || repMeta.repayment_time || null,
          attachment_url: r.attachment_url || repMeta.attachment_url || null,
        };
      });

      sendJson(res, 200, {
        success: true,
        transaction: {
          ...tx,
          category: tx.category || meta.category || 'Personal Loan',
          payment_method: tx.payment_method || meta.payment_method || 'UPI',
          description: tx.description || meta.description || null,
          notes: note || null,
          clean_notes: note || null,
        },
        editHistory,
        repayments,
      });
      return true;
    }

    // =========================================================================
    // CALCULATOR UPGRADE: SETTINGS & HISTORY APIS
    // =========================================================================

    // GET /api/calculator/settings
    if (pathname === '/api/calculator/settings' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        // Return default settings for unauthenticated/guest users
        sendJson(res, 200, {
          success: true,
          settings: {
            last_mode: 'gst',
            default_gst_percent: 18,
            default_offer_percent: 10,
            default_split_people: 2,
          },
        });
        return true;
      }

      const row = await query(
        `SELECT last_mode, default_gst_percent, default_offer_percent, default_split_people 
         FROM public.user_calculator_settings 
         WHERE user_id = $1`,
        [authUser.id]
      );

      if (row.rows.length > 0) {
        sendJson(res, 200, {
          success: true,
          settings: {
            last_mode: row.rows[0].last_mode,
            default_gst_percent: parseFloat(row.rows[0].default_gst_percent) || 18,
            default_offer_percent: parseFloat(row.rows[0].default_offer_percent) || 10,
            default_split_people: parseInt(row.rows[0].default_split_people, 10) || 2,
          },
        });
      } else {
        sendJson(res, 200, {
          success: true,
          settings: {
            last_mode: 'gst',
            default_gst_percent: 18,
            default_offer_percent: 10,
            default_split_people: 2,
          },
        });
      }
      return true;
    }

    // POST /api/calculator/settings
    if (pathname === '/api/calculator/settings' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required to save calculator settings.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const lastMode = ['gst', 'offer', 'split', 'basic'].includes(body.last_mode) ? body.last_mode : 'gst';
      const defaultGst = typeof body.default_gst_percent === 'number' && body.default_gst_percent >= 0 ? body.default_gst_percent : 18;
      const defaultOffer = typeof body.default_offer_percent === 'number' && body.default_offer_percent >= 0 && body.default_offer_percent <= 100 ? body.default_offer_percent : 10;
      const defaultSplit = typeof body.default_split_people === 'number' && body.default_split_people >= 1 ? Math.floor(body.default_split_people) : 2;

      await query(
        `INSERT INTO public.user_calculator_settings (user_id, last_mode, default_gst_percent, default_offer_percent, default_split_people, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) 
         DO UPDATE SET 
            last_mode = EXCLUDED.last_mode,
            default_gst_percent = EXCLUDED.default_gst_percent,
            default_offer_percent = EXCLUDED.default_offer_percent,
            default_split_people = EXCLUDED.default_split_people,
            updated_at = NOW()`,
        [authUser.id, lastMode, defaultGst, defaultOffer, defaultSplit]
      );

      sendJson(res, 200, {
        success: true,
        message: 'Calculator settings updated successfully.',
        settings: {
          last_mode: lastMode,
          default_gst_percent: defaultGst,
          default_offer_percent: defaultOffer,
          default_split_people: defaultSplit,
        },
      });
      return true;
    }

    // GET /api/calculator/history
    if (pathname === '/api/calculator/history' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 200, { success: true, history: [] });
        return true;
      }

      const parsedUrl = parseUrl(req.url || '', true);
      const typeFilter = parsedUrl.query.type as string | undefined;

      let q = `SELECT id, calc_type, title, input_values, result_values, created_at 
               FROM public.calculator_history 
               WHERE user_id = $1`;
      const params: any[] = [authUser.id];

      if (typeFilter && ['gst', 'offer', 'split', 'basic'].includes(typeFilter)) {
        params.push(typeFilter);
        q += ` AND calc_type = $2`;
      }

      q += ` ORDER BY created_at DESC LIMIT 50`;

      const result = await query(q, params);
      sendJson(res, 200, { success: true, history: result.rows });
      return true;
    }

    // POST /api/calculator/history
    if (pathname === '/api/calculator/history' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required to save calculation history.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const calcType = body.calc_type;
      if (!['gst', 'offer', 'split', 'basic'].includes(calcType)) {
        sendJson(res, 400, { success: false, message: 'Invalid calculation type.' });
        return true;
      }

      const title = (body.title || '').trim().slice(0, 100);
      const inputValues = typeof body.input_values === 'object' && body.input_values !== null ? body.input_values : {};
      const resultValues = typeof body.result_values === 'object' && body.result_values !== null ? body.result_values : {};

      const inserted = await query(
        `INSERT INTO public.calculator_history (user_id, calc_type, title, input_values, result_values, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id, calc_type, title, input_values, result_values, created_at`,
        [authUser.id, calcType, title || null, JSON.stringify(inputValues), JSON.stringify(resultValues)]
      );

      sendJson(res, 201, {
        success: true,
        message: 'Calculation saved to history.',
        record: inserted.rows[0],
      });
      return true;
    }

    // DELETE /api/calculator/history
    if (pathname === '/api/calculator/history' && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const parsedUrl = parseUrl(req.url || '', true);
      const targetId = (parsedUrl.query.id as string) || (await parseJsonBody(req)).id;

      if (targetId) {
        await query(
          `DELETE FROM public.calculator_history WHERE id = $1 AND user_id = $2`,
          [targetId, authUser.id]
        );
        sendJson(res, 200, { success: true, message: 'Calculation record deleted.' });
      } else {
        await query(
          `DELETE FROM public.calculator_history WHERE user_id = $1`,
          [authUser.id]
        );
        sendJson(res, 200, { success: true, message: 'Calculation history cleared.' });
      }
      return true;
    }

    // =========================================================
    // USER: FEEDBACK, COMPLAINT & SUPPORT TICKET ENDPOINTS
    // =========================================================

    // 1. SUBMIT STAR-RATING FEEDBACK: POST /api/feedback/submit
    if (pathname === '/api/feedback/submit' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required. Please log in.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const rawRating = body.rating !== undefined && body.rating !== null ? Number(body.rating) : null;
      const rating = rawRating && rawRating >= 1 && rawRating <= 5 ? rawRating : null;
      const message = (body.message || '').trim();
      const dpdpConsent = Boolean(body.dpdp_consent);

      if (!message || message.length < 3) {
        sendJson(res, 400, { success: false, message: 'Please share your thoughts, suggestions, or experience.' });
        return true;
      }

      // Fetch trusted user name and email from app_users
      const uRes = await query('SELECT full_name, email, phone FROM public.app_users WHERE id = $1', [authUser.id]);
      const trustedName = uRes.rows[0]?.full_name || authUser.full_name || 'Valued User';
      const trustedEmail = uRes.rows[0]?.email || authUser.email;
      const trustedPhone = uRes.rows[0]?.phone || null;

      // Duplicate prevention: check if identical feedback submitted within 15 seconds
      const dupCheck = await query(
        `SELECT id FROM public.feedbacks 
         WHERE user_id = $1 AND message = $2 AND created_at > NOW() - INTERVAL '15 seconds'`,
        [authUser.id, message]
      );
      if (dupCheck.rows.length > 0) {
        sendJson(res, 409, {
          success: false,
          message: 'Duplicate feedback detected. Your previous feedback was already received!',
        });
        return true;
      }

      const category = (body.category || 'General Feedback').trim();
      const subject = (body.subject || (rating ? `${rating}-Star User Feedback` : 'User Feedback')).trim();

      const insertRes = await query(
        `INSERT INTO public.feedbacks (
          user_id, user_name, user_email, user_phone, type, category, subject, message, rating, dpdp_consent, dpdp_consent_at, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'feedback', $5, $6, $7, $8, $9, $10, 'new', NOW(), NOW())
        RETURNING *`,
        [authUser.id, trustedName, trustedEmail, trustedPhone, category, subject, message, rating, dpdpConsent, dpdpConsent ? new Date() : null]
      );

      const feedback = insertRes.rows[0];
      const feedbackId = `FB-${feedback.id.slice(0, 8).toUpperCase()}`;

      // If user explicitly checked dpdp_consent, record in user_consents audit history as well
      if (dpdpConsent) {
        try {
          await query(
            `INSERT INTO public.user_consents (user_id, user_email, purpose, status, action, policy_version, consent_wording, ip_address, user_agent, created_at)
             VALUES ($1, $2, 'optional_feedback_support', 'granted', 'granted', 'v1.2 - DPDP Act 2023', 'Explicit consent granted during feedback submission for service quality improvement.', $3, $4, NOW())`,
            [authUser.id, trustedEmail, clientIp, userAgent]
          );
        } catch (e) {
          console.warn('[Consent Record Notice]:', e);
        }
      }

      // Automated Dual Feedback Emails: Instant User Confirmation + Admin Notification (hackifypro@gmail.com)
      sendFeedbackSubmissionEmails({
        feedbackId,
        userId: authUser.id,
        userName: trustedName,
        userEmail: trustedEmail,
        rating: rating || 5,
        feedbackMessage: message,
        category,
        submittedAt: feedback.created_at ? new Date(feedback.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : undefined,
      }).catch((e) => console.warn('[Feedback Dual Emails Dispatch Error]:', e));

      // In-app + Push notification for the submitting USER (thank-you)
      notifyFeedbackSubmitted(authUser.id, {
        id: feedback.id,
        rating: rating || 5,
        category,
      }).catch((e) => console.warn('[Notify Feedback User Error]:', e));

      // In-app + Push notification for ALL ADMINS (new feedback alert)
      notifyAdminNewFeedback({
        feedbackId,
        feedbackDbId: feedback.id,
        submitterName: trustedName,
        submitterEmail: trustedEmail,
        rating: rating || 5,
        category,
        message,
      }).catch((e) => console.warn('[Notify Admin Feedback Error]:', e));

      await logSecurityEvent('USER_SUBMITTED_FEEDBACK', {
        userId: authUser.id,
        userEmail: trustedEmail,
        details: { rating, feedbackId },
      });

      sendJson(res, 201, {
        success: true,
        message: 'Thank you for your feedback! Your opinion helps us improve My Money Manager.',
        feedback_id: feedbackId,
        feedback,
      });
      return true;
    }

    // 2. RAISE COMPLAINT: POST /api/support/complaint
    if (pathname === '/api/support/complaint' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required. Please log in.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const subject = (body.subject || '').trim();
      const description = (body.description || body.message || '').trim();
      const phone = (body.phone || body.user_phone || '').trim() || null;
      const category = (body.category || 'General Complaint').trim();
      const attachmentUrl = (body.attachment_url || body.attachment || '').trim() || null;

      if (!subject || subject.length < 3) {
        sendJson(res, 400, { success: false, message: 'Complaint subject is required (min 3 characters).' });
        return true;
      }
      if (!description || description.length < 5) {
        sendJson(res, 400, { success: false, message: 'Detailed description is required (min 5 characters).' });
        return true;
      }

      // Fetch trusted user name and email from app_users
      const uRes = await query('SELECT full_name, email, phone FROM public.app_users WHERE id = $1', [authUser.id]);
      const trustedName = uRes.rows[0]?.full_name || authUser.full_name || 'Valued User';
      const trustedEmail = uRes.rows[0]?.email || authUser.email;
      const userPhone = phone || uRes.rows[0]?.phone || null;

      // Duplicate prevention: check identical complaint within 15 seconds
      const dupCheck = await query(
        `SELECT id FROM public.support_tickets 
         WHERE user_id = $1 AND subject = $2 AND description = $3 AND created_at > NOW() - INTERVAL '15 seconds'`,
        [authUser.id, subject, description]
      );
      if (dupCheck.rows.length > 0) {
        sendJson(res, 409, {
          success: false,
          message: 'Duplicate complaint detected. Your previous submission was already received!',
        });
        return true;
      }

      // Generate unique ticket number: CMP-XXXX
      const ticketNumber = `CMP-${Math.floor(1000 + Math.random() * 9000)}`;

      const insertRes = await query(
        `INSERT INTO public.support_tickets (
          ticket_number, user_id, user_name, user_email, ticket_type, category, subject, description, priority, status, attachment_url, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'complaint', $5, $6, $7, 'normal', 'open', $8, NOW(), NOW())
        RETURNING *`,
        [ticketNumber, authUser.id, trustedName, trustedEmail, category, subject, description, attachmentUrl]
      );

      const ticket = insertRes.rows[0];

      // Async send confirmation email
      sendComplaintConfirmationEmail({
        email: trustedEmail,
        userName: trustedName,
        ticketNumber: ticket.ticket_number,
        category: ticket.category,
        subject: ticket.subject,
        description: ticket.description,
      }).catch((e) => console.warn('[Complaint Ack Email Error]:', e));

      // In-app complaint confirmation notification
      notifyComplaintSubmitted(authUser.id, {
        id: ticket.id,
        subject: ticket.subject,
        category: ticket.category,
      }).catch((e) => console.warn('[Notify Complaint Error]:', e));

      await logSecurityEvent('USER_SUBMITTED_COMPLAINT', {
        userId: authUser.id,
        userEmail: trustedEmail,
        details: { ticketNumber: ticket.ticket_number },
      });

      sendJson(res, 201, {
        success: true,
        message: 'Your complaint has been submitted successfully. Our support team will review it and get back to you.',
        ticket_number: ticket.ticket_number,
        ticket: {
          id: ticket.id,
          ticket_number: ticket.ticket_number,
          subject: ticket.subject,
          category: ticket.category,
          status: ticket.status,
          created_at: ticket.created_at,
        },
      });
      return true;
    }

    // 3. CONTACT SUPPORT / HELP REQUEST: POST /api/support/ticket
    if (pathname === '/api/support/ticket' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required. Please log in.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const category = (body.category || 'How to use the app').trim();
      const subject = (body.subject || '').trim();
      const message = (body.message || body.description || '').trim();
      const attachmentUrl = (body.attachment_url || body.attachment || '').trim() || null;

      if (!subject || subject.length < 3) {
        sendJson(res, 400, { success: false, message: 'Support subject is required.' });
        return true;
      }
      if (!message || message.length < 5) {
        sendJson(res, 400, { success: false, message: 'Support message is required.' });
        return true;
      }

      // Fetch trusted user name and email from app_users
      const uRes = await query('SELECT full_name, email FROM public.app_users WHERE id = $1', [authUser.id]);
      const trustedName = uRes.rows[0]?.full_name || authUser.full_name || 'Valued User';
      const trustedEmail = uRes.rows[0]?.email || authUser.email;

      // Generate unique ticket number: SUP-XXXX
      const ticketNumber = `SUP-${Math.floor(1000 + Math.random() * 9000)}`;

      const insertRes = await query(
        `INSERT INTO public.support_tickets (
          ticket_number, user_id, user_name, user_email, ticket_type, category, subject, description, priority, status, attachment_url, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'support', $5, $6, $7, 'normal', 'open', $8, NOW(), NOW())
        RETURNING *`,
        [ticketNumber, authUser.id, trustedName, trustedEmail, category, subject, message, attachmentUrl]
      );

      const ticket = insertRes.rows[0];

      // Async send confirmation email
      sendSupportTicketConfirmationEmail({
        email: trustedEmail,
        userName: trustedName,
        ticketNumber: ticket.ticket_number,
        category: ticket.category,
        subject: ticket.subject,
        description: ticket.description,
      }).catch((e) => console.warn('[Support Ticket Ack Email Error]:', e));

      await logSecurityEvent('USER_SUBMITTED_SUPPORT_TICKET', {
        userId: authUser.id,
        userEmail: trustedEmail,
        details: { ticketNumber: ticket.ticket_number, category: ticket.category },
      });

      sendJson(res, 201, {
        success: true,
        message: 'Your support request has been submitted successfully.',
        ticket: {
          id: ticket.id,
          ticket_number: ticket.ticket_number,
          subject: ticket.subject,
          category: ticket.category,
          status: ticket.status,
          created_at: ticket.created_at,
        },
      });
      return true;
    }

    // 4. USER SUPPORT HISTORY: GET /api/user/support-history
    if (pathname === '/api/user/support-history' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required. Please log in.' });
        return true;
      }

      const [feedbacksRes, ticketsRes] = await Promise.all([
        query(
          `SELECT id, category, subject, rating, message, status, admin_notes, created_at, updated_at 
           FROM public.feedbacks 
           WHERE user_id = $1 
           ORDER BY created_at DESC LIMIT 50`,
          [authUser.id]
        ),
        query(
          `SELECT id, ticket_number, ticket_type, category, subject, description, priority, status, attachment_url, created_at, updated_at, resolved_at 
           FROM public.support_tickets 
           WHERE user_id = $1 
           ORDER BY created_at DESC LIMIT 50`,
          [authUser.id]
        ),
      ]);

      sendJson(res, 200, {
        success: true,
        feedbacks: feedbacksRes.rows,
        tickets: ticketsRes.rows,
      });
      return true;
    }

    // 5. USER TICKET DETAIL & REPLIES: GET /api/user/tickets/:id
    const userTicketDetailMatch = pathname.match(/^\/api\/user\/tickets\/([a-zA-Z0-9_-]+)$/);
    if (userTicketDetailMatch && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required. Please log in.' });
        return true;
      }

      const ticketId = userTicketDetailMatch[1];
      const ticketRes = await query(
        `SELECT * FROM public.support_tickets WHERE id = $1 AND user_id = $2`,
        [ticketId, authUser.id]
      );

      if (ticketRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Ticket not found or unauthorized.' });
        return true;
      }

      // Fetch customer-facing replies ONLY (strictly exclude internal notes)
      const repliesRes = await query(
        `SELECT id, sender_name, sender_type, sender_role, message, created_at 
         FROM public.support_ticket_replies 
         WHERE ticket_id = $1 AND is_internal = FALSE 
         ORDER BY created_at ASC`,
        [ticketId]
      );

      sendJson(res, 200, {
        success: true,
        ticket: ticketRes.rows[0],
        replies: repliesRes.rows,
      });
      return true;
    }

    // 6. USER REPLY TO ACTIVE TICKET: POST /api/user/tickets/:id/reply
    const userTicketReplyMatch = pathname.match(/^\/api\/user\/tickets\/([a-zA-Z0-9_-]+)\/reply$/);
    if (userTicketReplyMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required. Please log in.' });
        return true;
      }

      const ticketId = userTicketReplyMatch[1];
      const body = await parseJsonBody(req);
      const message = (body.message || '').trim();

      if (!message) {
        sendJson(res, 400, { success: false, message: 'Reply message cannot be empty.' });
        return true;
      }

      // Verify ticket ownership
      const ticketRes = await query(
        `SELECT * FROM public.support_tickets WHERE id = $1 AND user_id = $2`,
        [ticketId, authUser.id]
      );

      if (ticketRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Ticket not found or unauthorized.' });
        return true;
      }

      const ticket = ticketRes.rows[0];
      if (ticket.status === 'closed') {
        sendJson(res, 400, { success: false, message: 'This ticket is closed. Please submit a new ticket for further assistance.' });
        return true;
      }

      const uRes = await query('SELECT full_name FROM public.app_users WHERE id = $1', [authUser.id]);
      const senderName = uRes.rows[0]?.full_name || authUser.full_name || 'User';

      // Insert user reply
      const replyRes = await query(
        `INSERT INTO public.support_ticket_replies (
          ticket_id, sender_id, sender_name, sender_role, sender_type, message, message_type, is_internal, email_status, created_at
        ) VALUES ($1, $2, $3, 'user', 'user', $4, 'user_message', FALSE, 'none', NOW())
        RETURNING id, sender_name, sender_type, sender_role, message, created_at`,
        [ticketId, authUser.id, senderName, message]
      );

      // Update ticket updated_at and move back to in_progress if waiting_user
      const newStatus = ticket.status === 'waiting_user' ? 'in_progress' : ticket.status;
      await query(
        `UPDATE public.support_tickets 
         SET updated_at = NOW(), status = $1 
         WHERE id = $2`,
        [newStatus, ticketId]
      );

      await logSecurityEvent('USER_REPLIED_TO_TICKET', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { ticketId, ticketNumber: ticket.ticket_number },
      });

      sendJson(res, 201, {
        success: true,
        message: 'Reply sent successfully.',
        reply: replyRes.rows[0],
      });
      return true;
    }

    // =========================================================
    // PRIVACY & DPDP CONSENT ENDPOINTS (DPDP ACT 2023)
    // =========================================================

    // 1. GET CONSENT STATUS: GET /api/privacy/consent-status
    if (pathname === '/api/privacy/consent-status' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required. Please log in.' });
        return true;
      }

      // Query consent history for this user
      const consentsRes = await query(
        `SELECT id, purpose, status, action, policy_version, consent_wording, created_at 
         FROM public.user_consents 
         WHERE user_id = $1 
         ORDER BY created_at DESC`,
        [authUser.id]
      );

      const history = consentsRes.rows;
      const latest = history[0] || null;
      const status = latest ? latest.status : 'not_granted';

      sendJson(res, 200, {
        success: true,
        status,
        latest,
        history,
        policyVersion: 'v1.2 - DPDP Act 2023',
      });
      return true;
    }

    // 2. GRANT OPTIONAL CONSENT: POST /api/privacy/consent-grant
    if (pathname === '/api/privacy/consent-grant' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required. Please log in.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const purpose = (body.purpose || 'optional_feedback_support').trim();
      const wording = (body.wording || 'User explicitly granted optional processing consent for service quality feedback and support inquiries under the DPDP Act 2023.').trim();

      const insertRes = await query(
        `INSERT INTO public.user_consents (
          user_id, user_email, purpose, status, action, policy_version, consent_wording, ip_address, user_agent, created_at, updated_at
        ) VALUES ($1, $2, $3, 'granted', 'granted', 'v1.2 - DPDP Act 2023', $4, $5, $6, NOW(), NOW())
        RETURNING *`,
        [authUser.id, authUser.email, purpose, wording, clientIp, userAgent]
      );

      await logSecurityEvent('USER_GRANTED_DPDP_CONSENT', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { purpose, policyVersion: 'v1.2 - DPDP Act 2023' },
      });

      sendJson(res, 200, {
        success: true,
        message: 'Optional consent recorded successfully.',
        status: 'granted',
        consent: insertRes.rows[0],
      });
      return true;
    }

    // 3. WITHDRAW OPTIONAL CONSENT: POST /api/privacy/consent-withdraw
    if (pathname === '/api/privacy/consent-withdraw' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required. Please log in.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const purpose = (body.purpose || 'optional_feedback_support').trim();
      const wording = (body.wording || 'User explicitly withdrew optional processing consent. All optional data processing ceased. Core app functionality and account remain active.').trim();

      // Check if user previously had granted consent
      const prevCheck = await query(
        `SELECT id, status FROM public.user_consents 
         WHERE user_id = $1 AND purpose = $2 
         ORDER BY created_at DESC LIMIT 1`,
        [authUser.id, purpose]
      );

      if (!prevCheck.rows.length || prevCheck.rows[0].status === 'withdrawn') {
        sendJson(res, 400, {
          success: false,
          message: 'No active optional consent found to withdraw.',
        });
        return true;
      }

      const insertRes = await query(
        `INSERT INTO public.user_consents (
          user_id, user_email, purpose, status, action, policy_version, consent_wording, ip_address, user_agent, created_at, updated_at
        ) VALUES ($1, $2, $3, 'withdrawn', 'withdrawn', 'v1.2 - DPDP Act 2023', $4, $5, $6, NOW(), NOW())
        RETURNING *`,
        [authUser.id, authUser.email, purpose, wording, clientIp, userAgent]
      );

      await logSecurityEvent('USER_WITHDREW_DPDP_CONSENT', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { purpose, policyVersion: 'v1.2 - DPDP Act 2023' },
      });

      sendJson(res, 200, {
        success: true,
        message: 'Optional consent has been withdrawn. Core account and financial ledgers remain preserved.',
        status: 'withdrawn',
        consent: insertRes.rows[0],
      });
      return true;
    }

    // =========================================================
    // SECTION: USER NOTIFICATION CENTER & WEB PUSH APIS
    // =========================================================

    // 1. GET USER NOTIFICATIONS: GET /api/notifications
    if (pathname === '/api/notifications' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const page = Math.max(1, parseInt(urlObj.searchParams.get('page') || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(urlObj.searchParams.get('limit') || '20', 10)));
      const offset = (page - 1) * limit;
      const category = (urlObj.searchParams.get('category') || '').trim();
      const unreadOnly = urlObj.searchParams.get('unread_only') === 'true';

      const conditions: string[] = ['user_id = $1', 'is_deleted = FALSE'];
      const params: any[] = [authUser.id];

      if (category && category !== 'all') {
        params.push(category);
        conditions.push(`category = $${params.length}`);
      }

      if (unreadOnly) {
        conditions.push('is_read = FALSE');
      }

      const whereClause = conditions.join(' AND ');

      const [listRes, countRes, unreadRes] = await Promise.all([
        query(
          `SELECT * FROM public.user_notifications 
           WHERE ${whereClause}
           ORDER BY created_at DESC 
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        ),
        query(
          `SELECT COUNT(*) as total FROM public.user_notifications WHERE ${whereClause}`,
          params
        ),
        query(
          `SELECT COUNT(*) as unread_count FROM public.user_notifications 
           WHERE user_id = $1 AND is_deleted = FALSE AND is_read = FALSE`,
          [authUser.id]
        ),
      ]);

      const total = parseInt(countRes.rows[0]?.total || '0', 10);
      const unreadCount = parseInt(unreadRes.rows[0]?.unread_count || '0', 10);

      sendJson(res, 200, {
        success: true,
        notifications: listRes.rows,
        unreadCount,
        total,
        page,
        totalPages: Math.ceil(total / limit) || 1,
      });
      return true;
    }

    // 2. MARK SINGLE NOTIFICATION AS READ: PATCH /api/notifications/:id/read
    const notifReadMatch = pathname.match(/^\/api\/notifications\/([a-zA-Z0-9_-]+)\/read$/);
    if (notifReadMatch && (method === 'PATCH' || method === 'POST')) {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const notifId = notifReadMatch[1];
      const updateRes = await query(
        `UPDATE public.user_notifications 
         SET is_read = TRUE, read_at = NOW() 
         WHERE id = $1 AND user_id = $2 
         RETURNING *`,
        [notifId, authUser.id]
      );

      if (updateRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Notification not found.' });
        return true;
      }

      sendJson(res, 200, { success: true, notification: updateRes.rows[0] });
      return true;
    }

    // 3. MARK ALL AS READ: POST /api/notifications/mark-all-read
    if (pathname === '/api/notifications/mark-all-read' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      await query(
        `UPDATE public.user_notifications 
         SET is_read = TRUE, read_at = NOW() 
         WHERE user_id = $1 AND is_deleted = FALSE AND is_read = FALSE`,
        [authUser.id]
      );

      sendJson(res, 200, { success: true, message: 'All notifications marked as read.' });
      return true;
    }

    // 4. DELETE SINGLE NOTIFICATION (SOFT DELETE): DELETE /api/notifications/:id
    const notifDeleteMatch = pathname.match(/^\/api\/notifications\/([a-zA-Z0-9_-]+)$/);
    if (notifDeleteMatch && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const notifId = notifDeleteMatch[1];
      await query(
        `UPDATE public.user_notifications 
         SET is_deleted = TRUE, deleted_at = NOW() 
         WHERE id = $1 AND user_id = $2`,
        [notifId, authUser.id]
      );

      sendJson(res, 200, { success: true, message: 'Notification removed.' });
      return true;
    }

    // 5. CLEAR ALL NOTIFICATIONS: POST /api/notifications/clear-all
    if (pathname === '/api/notifications/clear-all' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      await query(
        `UPDATE public.user_notifications 
         SET is_deleted = TRUE, deleted_at = NOW() 
         WHERE user_id = $1 AND is_deleted = FALSE`,
        [authUser.id]
      );

      sendJson(res, 200, { success: true, message: 'All notifications cleared.' });
      return true;
    }

    // 6. GET NOTIFICATION PREFERENCES: GET /api/notifications/preferences
    if (pathname === '/api/notifications/preferences' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const prefs = await getUserNotificationPreferences(authUser.id);
      sendJson(res, 200, { success: true, preferences: prefs });
      return true;
    }

    // 7. UPDATE NOTIFICATION PREFERENCES: PUT /api/notifications/preferences
    if (pathname === '/api/notifications/preferences' && method === 'PUT') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const rate = checkRateLimit(`notif_prefs:${authUser.id}`, 30, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { success: false, message: 'Too many preference updates. Please try again shortly.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const updated = await updateUserNotificationPreferences(authUser.id, {
        in_app_enabled: body.in_app_enabled,
        push_enabled: body.push_enabled,
        email_enabled: body.email_enabled,
        notify_income: body.notify_income,
        notify_expense: body.notify_expense,
        notify_budget: body.notify_budget,
        notify_bills: body.notify_bills,
        notify_udhar: body.notify_udhar,
        notify_savings: body.notify_savings,
        notify_receipts: body.notify_receipts,
        notify_security: body.notify_security,
        notify_support: body.notify_support,
        notify_announcements: body.notify_announcements,
        notify_offers: body.notify_offers,
        quiet_hours_enabled: body.quiet_hours_enabled,
        quiet_hours_start: body.quiet_hours_start,
        quiet_hours_end: body.quiet_hours_end,
        privacy_hide_amounts: body.privacy_hide_amounts,
      });

      sendJson(res, 200, { success: true, preferences: updated });
      return true;
    }

    // 8. PUSH VAPID PUBLIC KEY: GET /api/notifications/push/vapid-public-key
    // Public key only — private key NEVER leaves server
    if (pathname === '/api/notifications/push/vapid-public-key' && method === 'GET') {
      sendJson(res, 200, {
        success: true,
        publicKey: APP_CONFIG.vapid.publicKey,
        configured: Boolean(APP_CONFIG.vapid.publicKey && APP_CONFIG.vapid.privateKey),
        persistent: APP_CONFIG.vapid.isPersistent,
      });
      return true;
    }

    // 8b. LIST AUTHENTICATED USER'S REGISTERED PUSH DEVICES: GET /api/notifications/push/subscriptions
    if (pathname === '/api/notifications/push/subscriptions' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const devices = await listUserPushSubscriptions(authUser.id);
      sendJson(res, 200, {
        success: true,
        subscriptions: devices,
        count: devices.length,
      });
      return true;
    }

    // 8c. REMOVE A SPECIFIC REGISTERED DEVICE SUBSCRIPTION: DELETE /api/notifications/push/subscriptions/:id
    const pushSubDeleteMatch = pathname.match(/^\/api\/notifications\/push\/subscriptions\/([a-zA-Z0-9_-]+)$/);
    if (pushSubDeleteMatch && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const rate = checkRateLimit(`push_del:${authUser.id}`, 20, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { success: false, message: 'Too many requests. Please wait a minute.' });
        return true;
      }

      const subId = pushSubDeleteMatch[1];
      const { deleted } = await removePushSubscriptionById(authUser.id, subId);
      if (!deleted) {
        sendJson(res, 404, { success: false, message: 'Device subscription not found for your account.' });
        return true;
      }

      logSecurityEvent('PUSH_DEVICE_REMOVED', { userId: authUser.id, subscriptionId: subId });
      sendJson(res, 200, { success: true, message: 'Device removed from push notifications.' });
      return true;
    }

    // 8d. GET PUSH DELIVERY STATUS & LOGS: GET /api/notifications/push/status
    if (pathname === '/api/notifications/push/status' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const status = await getPushDeliveryStatus(authUser.id);
      sendJson(res, 200, { success: true, ...status });
      return true;
    }

    // 9. REGISTER PUSH SUBSCRIPTION: POST /api/notifications/push/subscribe
    if (pathname === '/api/notifications/push/subscribe' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const rate = checkRateLimit(`push_sub:${authUser.id}`, 20, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { success: false, message: 'Too many subscription requests. Try again shortly.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const endpoint = (body.endpoint || '').trim();
      const p256dh = body.keys?.p256dh || body.p256dh || '';
      const authKey = body.keys?.auth || body.auth || '';
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
      const deviceName = typeof body.deviceName === 'string' ? body.deviceName : null;

      const reg = await registerPushSubscription({
        userId: authUser.id,
        endpoint,
        p256dh,
        auth: authKey,
        userAgent,
        deviceName,
      });

      if (!reg.success) {
        sendJson(res, 400, {
          success: false,
          message: reg.error || 'Invalid push subscription payload.',
        });
        return true;
      }

      logSecurityEvent('PUSH_SUBSCRIPTION_REGISTERED', {
        userId: authUser.id,
        device: reg.subscription?.device_name,
      });
      sendJson(res, 200, {
        success: true,
        message: 'Push notifications registered successfully.',
        subscription: reg.subscription,
      });
      return true;
    }

    // 9b. REGISTER DEVICE & PWA INSTALLATION STATUS: POST /api/pwa/register-device
    if (
      (pathname === '/api/pwa/register-device' ||
        pathname === '/api/devices/register' ||
        pathname === '/api/pwa/record-install') &&
      method === 'POST'
    ) {
      const authUser = await authenticateRequest(req);
      const body = await parseJsonBody(req);
      const userId = authUser?.id || body.userId;

      if (!userId) {
        sendJson(res, 400, {
          success: false,
          message: 'Authenticated user or userId is required to register device installation.',
        });
        return true;
      }

      const resDev = await recordDeviceInstallation({
        userId,
        deviceType: body.deviceType,
        browser: body.browser,
        os: body.os,
        userAgent: userAgent || body.userAgent,
        isInstalled: Boolean(body.isInstalled),
        installationStatus: body.installationStatus,
        pushPermission: body.pushPermission,
        pushSubscriptionStatus: body.pushSubscriptionStatus,
        ipAddress: clientIp,
      });

      sendJson(res, 200, { success: true, ...resDev });
      return true;
    }

    // 10. UNREGISTER PUSH SUBSCRIPTION: POST /api/notifications/push/unsubscribe
    if (pathname === '/api/notifications/push/unsubscribe' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const rate = checkRateLimit(`push_unsub:${authUser.id}`, 20, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { success: false, message: 'Too many requests. Please wait a minute.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const endpoint = (body.endpoint || '').trim();

      if (endpoint) {
        await removePushSubscriptionByEndpoint(authUser.id, endpoint);
      }

      sendJson(res, 200, { success: true, message: 'Push notifications disabled for this device.' });
      return true;
    }

    // 11. SEND TEST NOTIFICATION: POST /api/notifications/push/test
    if (pathname === '/api/notifications/push/test' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const rate = checkRateLimit(`push_test:${authUser.id}`, 5, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, {
          success: false,
          message: 'Test notification rate limit reached (max 5 per minute).',
        });
        return true;
      }

      const result = await createNotification({
        userId: authUser.id,
        title: 'Test Notification · My Money Manager',
        message: 'Real Web Push delivery is active on this device. Tap to open your dashboard.',
        category: 'general',
        type: 'info',
        deepLink: 'dashboard',
        tag: `mm-test-${Date.now()}`,
        channels: ['in_app', 'push'],
        skipPreferenceCheck: true,
      });

      sendJson(res, 200, {
        success: true,
        message:
          result.pushDelivered > 0
            ? `Test push delivered to ${result.pushDelivered} of ${result.deviceCount} registered device(s).`
            : result.deviceCount === 0
              ? 'In-app test created, but no push devices are currently registered for your account.'
              : 'Push delivery failed for registered device(s). Expired subscriptions were cleaned up.',
        vapidPersistent: APP_CONFIG.vapid.isPersistent,
        result,
      });
      return true;
    }

    // 12. EVENT TRIGGER: TRANSACTION CREATED: POST /api/notifications/events/transaction-created
    if (pathname === '/api/notifications/events/transaction-created' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const rate = checkRateLimit(`notif_tx:${authUser.id}`, 30, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { success: false, message: 'Notification event rate limit reached.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const txId = String(body.id || body.transaction_id || '').trim().slice(0, 100);
      const title = String(body.title || 'Transaction').trim().slice(0, 120);
      const amount = Number(body.amount) || 0;
      const type = body.type === 'income' ? 'income' : 'expense';
      const category = String(body.category || 'General').trim().slice(0, 60);
      const section = String(body.section || '').trim().slice(0, 60);

      let delivery = null;
      if (txId && amount > 0) {
        delivery = await notifyTransactionCreated(authUser.id, {
          id: txId,
          title,
          amount,
          type,
          category,
          section,
        });
      }

      sendJson(res, 200, { success: true, message: 'Transaction notification processed.', delivery });
      return true;
    }

    // 13. EVENT TRIGGER: FINANCIAL INTELLIGENCE & SECURITY ALERTS: POST /api/notifications/events/financial-alert
    if (pathname === '/api/notifications/events/financial-alert' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const rate = checkRateLimit(`notif_fin:${authUser.id}`, 30, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { success: false, message: 'Alert event rate limit reached.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const allowedCategories = new Set([
        'budget',
        'bill',
        'anomaly',
        'low_balance',
        'savings',
        'udhar',
        'receipt',
        'security',
      ]);
      const category = String(body.category || '').trim();
      const title = String(body.title || '').trim();
      const message = String(body.message || '').trim();
      const dedupeKey = String(body.dedupeKey || '').trim().slice(0, 160);

      if (!allowedCategories.has(category) || !title || !message || !dedupeKey) {
        sendJson(res, 400, {
          success: false,
          message: 'Valid category, title, message, and dedupeKey are required.',
        });
        return true;
      }

      const delivery = await notifyFinancialAlert({
        userId: authUser.id,
        category: category as any,
        title,
        message,
        severity: ['info', 'warning', 'critical', 'success'].includes(body.severity)
          ? body.severity
          : 'info',
        deepLink: typeof body.deepLink === 'string' ? body.deepLink : undefined,
        dedupeKey,
        relatedEntityId: typeof body.relatedEntityId === 'string' ? body.relatedEntityId : undefined,
      });

      sendJson(res, 200, { success: true, delivery });
      return true;
    }

    // =========================================================
    // SECTION: USER BUDGETS APIS
    // =========================================================

    // 1. GET ALL USER BUDGETS: GET /api/budgets
    if (pathname === '/api/budgets' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const listRes = await query(
        `SELECT * FROM public.user_budgets WHERE user_id = $1 ORDER BY created_at ASC`,
        [authUser.id]
      );

      sendJson(res, 200, { success: true, budgets: listRes.rows });
      return true;
    }

    // 2. UPSERT BUDGET: POST /api/budgets
    if (pathname === '/api/budgets' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const category = (body.category || '').trim().toLowerCase();
      const monthlyLimit = Number(body.monthly_limit || body.monthlyLimit) || 0;
      const alertThreshold = Math.min(100, Math.max(1, Number(body.alert_threshold || body.alertThreshold) || 85));

      if (!category) {
        sendJson(res, 400, { success: false, message: 'Category is required for budget.' });
        return true;
      }
      if (monthlyLimit <= 0) {
        sendJson(res, 400, { success: false, message: 'Monthly budget limit must be greater than 0.' });
        return true;
      }

      const upsertRes = await query(
        `INSERT INTO public.user_budgets (user_id, category, monthly_limit, alert_threshold, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, category) DO UPDATE SET
           monthly_limit = EXCLUDED.monthly_limit,
           alert_threshold = EXCLUDED.alert_threshold,
           updated_at = NOW()
         RETURNING *`,
        [authUser.id, category, monthlyLimit, alertThreshold]
      );

      sendJson(res, 200, {
        success: true,
        message: 'Budget saved successfully.',
        budget: upsertRes.rows[0],
      });
      return true;
    }

    // 3. DELETE BUDGET: DELETE /api/budgets/:id
    const budgetDeleteMatch = pathname.match(/^\/api\/budgets\/([a-zA-Z0-9_-]+)$/);
    if (budgetDeleteMatch && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const budgetId = budgetDeleteMatch[1];
      await query(
        `DELETE FROM public.user_budgets WHERE id = $1 AND user_id = $2`,
        [budgetId, authUser.id]
      );

      sendJson(res, 200, { success: true, message: 'Budget removed successfully.' });
      return true;
    }

    // =========================================================
    // SECTION: SAVINGS GOALS APIS
    // =========================================================

    // 1. GET ALL SAVINGS GOALS: GET /api/savings-goals
    if (pathname === '/api/savings-goals' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const listRes = await query(
        `SELECT * FROM public.savings_goals WHERE user_id = $1 ORDER BY created_at DESC`,
        [authUser.id]
      );

      sendJson(res, 200, { success: true, goals: listRes.rows });
      return true;
    }

    // 2. CREATE OR EDIT SAVINGS GOAL: POST /api/savings-goals
    if (pathname === '/api/savings-goals' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const title = (body.title || '').trim();
      const targetAmount = Number(body.target_amount || body.targetAmount) || 0;
      const currentAmount = Math.max(0, Number(body.current_amount || body.currentAmount) || 0);
      const targetDate = body.target_date || body.targetDate || null;
      const category = (body.category || 'general').trim();
      const notes = (body.notes || '').trim() || null;
      const isCompleted = !!body.is_completed || currentAmount >= targetAmount;

      if (!title || title.length < 2) {
        sendJson(res, 400, { success: false, message: 'Goal title must be at least 2 characters.' });
        return true;
      }
      if (targetAmount <= 0) {
        sendJson(res, 400, { success: false, message: 'Target amount must be greater than 0.' });
        return true;
      }

      let goalRes;
      if (body.id) {
        goalRes = await query(
          `UPDATE public.savings_goals
           SET title = $1, target_amount = $2, current_amount = $3, target_date = $4, category = $5, notes = $6, is_completed = $7, updated_at = NOW()
           WHERE id = $8 AND user_id = $9
           RETURNING *`,
          [title, targetAmount, currentAmount, targetDate, category, notes, isCompleted, body.id, authUser.id]
        );
      } else {
        goalRes = await query(
          `INSERT INTO public.savings_goals (user_id, title, target_amount, current_amount, target_date, category, notes, is_completed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [authUser.id, title, targetAmount, currentAmount, targetDate, category, notes, isCompleted]
        );
      }

      sendJson(res, 200, {
        success: true,
        message: body.id ? 'Savings goal updated.' : 'Savings goal created.',
        goal: goalRes.rows[0],
      });
      return true;
    }

    // 3. CONTRIBUTE / WITHDRAW GOAL: POST /api/savings-goals/:id/contribute
    const goalContributeMatch = pathname.match(/^\/api\/savings-goals\/([a-zA-Z0-9_-]+)\/contribute$/);
    if (goalContributeMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const goalId = goalContributeMatch[1];
      const body = await parseJsonBody(req);
      const delta = Number(body.amount) || 0;
      const action = body.action === 'withdraw' ? 'withdraw' : 'add';

      if (delta <= 0) {
        sendJson(res, 400, { success: false, message: 'Contribution amount must be greater than 0.' });
        return true;
      }

      const existingGoal = await query(
        `SELECT * FROM public.savings_goals WHERE id = $1 AND user_id = $2`,
        [goalId, authUser.id]
      );

      if (existingGoal.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Savings goal not found.' });
        return true;
      }

      const goal = existingGoal.rows[0];
      const prevAmount = Number(goal.current_amount) || 0;
      const newAmount = action === 'withdraw'
        ? Math.max(0, prevAmount - delta)
        : prevAmount + delta;
      const isCompleted = newAmount >= Number(goal.target_amount);

      const updateRes = await query(
        `UPDATE public.savings_goals 
         SET current_amount = $1, is_completed = $2, updated_at = NOW() 
         WHERE id = $3 AND user_id = $4 
         RETURNING *`,
        [newAmount, isCompleted, goalId, authUser.id]
      );

      sendJson(res, 200, {
        success: true,
        message: action === 'withdraw' ? 'Amount withdrawn from goal.' : 'Contribution added to goal!',
        goal: updateRes.rows[0],
      });
      return true;
    }

    // 4. DELETE SAVINGS GOAL: DELETE /api/savings-goals/:id
    const goalDeleteMatch = pathname.match(/^\/api\/savings-goals\/([a-zA-Z0-9_-]+)$/);
    if (goalDeleteMatch && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const goalId = goalDeleteMatch[1];
      await query(
        `DELETE FROM public.savings_goals WHERE id = $1 AND user_id = $2`,
        [goalId, authUser.id]
      );

      sendJson(res, 200, { success: true, message: 'Savings goal deleted.' });
      return true;
    }

    // =========================================================
    // SECTION: RECURRING BILLS APIS
    // =========================================================

    // 1. GET ALL RECURRING BILLS: GET /api/recurring-bills
    if (pathname === '/api/recurring-bills' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const listRes = await query(
        `SELECT * FROM public.recurring_bills WHERE user_id = $1 ORDER BY due_day ASC`,
        [authUser.id]
      );

      sendJson(res, 200, { success: true, bills: listRes.rows });
      return true;
    }

    // 2. CREATE OR EDIT RECURRING BILL: POST /api/recurring-bills
    if (pathname === '/api/recurring-bills' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const title = (body.title || '').trim();
      const category = (body.category || 'other').trim().toLowerCase();
      const amount = Number(body.amount) || 0;
      const frequency = (body.frequency || 'monthly').trim().toLowerCase();
      const dueDay = Math.min(31, Math.max(1, Number(body.due_day || body.dueDay) || 1));
      const reminderEnabled = body.reminder_enabled !== undefined ? !!body.reminder_enabled : true;
      const isActive = body.is_active !== undefined ? !!body.is_active : true;

      if (!title || title.length < 2) {
        sendJson(res, 400, { success: false, message: 'Bill title must be at least 2 characters.' });
        return true;
      }
      if (amount <= 0) {
        sendJson(res, 400, { success: false, message: 'Bill amount must be greater than 0.' });
        return true;
      }

      let billRes;
      if (body.id) {
        billRes = await query(
          `UPDATE public.recurring_bills
           SET title = $1, category = $2, amount = $3, frequency = $4, due_day = $5, reminder_enabled = $6, is_active = $7, updated_at = NOW()
           WHERE id = $8 AND user_id = $9
           RETURNING *`,
          [title, category, amount, frequency, dueDay, reminderEnabled, isActive, body.id, authUser.id]
        );
      } else {
        billRes = await query(
          `INSERT INTO public.recurring_bills (user_id, title, category, amount, frequency, due_day, reminder_enabled, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [authUser.id, title, category, amount, frequency, dueDay, reminderEnabled, isActive]
        );
      }

      sendJson(res, 200, {
        success: true,
        message: body.id ? 'Recurring bill updated.' : 'Recurring bill added.',
        bill: billRes.rows[0],
      });
      return true;
    }

    // 3. MARK BILL AS PAID: POST /api/recurring-bills/:id/pay
    const billPayMatch = pathname.match(/^\/api\/recurring-bills\/([a-zA-Z0-9_-]+)\/pay$/);
    if (billPayMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const billId = billPayMatch[1];
      const body = await parseJsonBody(req);
      const paidDate = body.paid_date || new Date().toISOString().split('T')[0];

      const updateRes = await query(
        `UPDATE public.recurring_bills
         SET last_paid_date = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3
         RETURNING *`,
        [paidDate, billId, authUser.id]
      );

      if (updateRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Recurring bill not found.' });
        return true;
      }

      sendJson(res, 200, {
        success: true,
        message: 'Bill marked as paid for this cycle.',
        bill: updateRes.rows[0],
      });
      return true;
    }

    // 4. DELETE RECURRING BILL: DELETE /api/recurring-bills/:id
    const billDeleteMatch = pathname.match(/^\/api\/recurring-bills\/([a-zA-Z0-9_-]+)$/);
    if (billDeleteMatch && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const billId = billDeleteMatch[1];
      await query(
        `DELETE FROM public.recurring_bills WHERE id = $1 AND user_id = $2`,
        [billId, authUser.id]
      );

      sendJson(res, 200, { success: true, message: 'Recurring bill deleted.' });
      return true;
    }

    // Legacy alias: POST /api/send-reset-email
    if (pathname === '/api/send-reset-email' && method === 'POST') {
      const body = await parseJsonBody(req);
      const email = normalizeEmail(body.email || '');
      const rawToken = body.token || body.otp || generateCryptoToken(32);
      const resetLink = body.resetLink || `${origin}/#reset-password&token=${rawToken}&email=${encodeURIComponent(email)}`;
      const sent = await sendPasswordResetEmail(email, body.name || 'User', resetLink);
      sendJson(res, 200, { success: sent, message: sent ? 'Reset email dispatched' : 'Failed to dispatch email' });
      return true;
    }

    // Route not handled by API
    sendJson(res, 404, { success: false, message: 'API endpoint not found.' });
    return true;
  } catch (err: any) {
    console.error(`[API Error] ${method} ${pathname}:`, err);
    sendJson(res, 500, {
      success: false,
      message: 'An internal server security error occurred. Please try again later.',
    });
    return true;
  }
}
