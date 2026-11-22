import type { IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { query, pool } from './db';
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
  sendFeedbackConfirmationEmail,
  sendComplaintConfirmationEmail,
  sendSupportTicketConfirmationEmail,
} from './email';
import { APP_CONFIG } from './config';
import { handleAdminApiRequest } from './adminApi';

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
    console.error('[Account Deletion Worker Error]:', err.message);
  }
  return count;
}

// Background timer: runs check every 60 seconds
if (!(globalThis as any).__accountDeletionWorkerTimer) {
  (globalThis as any).__accountDeletionWorkerTimer = setInterval(() => {
    processExpiredAccountDeletions().catch(() => {});
  }, 60000);
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

  const clientIp = getClientIp(req);
  const userAgent = (req.headers['user-agent'] as string) || '';
  const origin = (req.headers['origin'] as string) || 'http://localhost:5173';

  // Enable standard CORS headers
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
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
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      // Count active sessions
      const sessRes = await query(
        `SELECT COUNT(*) as count FROM public.user_sessions 
         WHERE user_id = $1 AND is_revoked = FALSE AND expires_at > NOW()`,
        [authUser.id]
      );
      const activeSessionsCount = parseInt(sessRes.rows[0]?.count || '1');

      sendJson(res, 200, {
        success: true,
        profile: {
          ...sanitizeUserOutput(authUser),
          activeSessionsCount,
        },
      });
      return true;
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
        message: 'If an account exists with that email address, password reset instructions have been sent.',
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

      const resetLink = `${origin}/#reset-password&token=${rawToken}&email=${encodeURIComponent(user.email)}`;

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

      const resetLink = `${origin}/#reset-password&token=${rawToken}&email=${encodeURIComponent(targetUser.email)}`;

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
    // SECTION B: UDHAR CONTACTS (SAVED PEOPLE)
    // =========================================================================

    // 6. GET CONTACTS: GET /api/udhar/contacts
    if (pathname === '/api/udhar/contacts' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const contactsRes = await query(
        `SELECT c.id, c.name, c.email, c.phone, c.relationship_type, c.notes, c.linked_user_id, c.created_at, c.updated_at,
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

    // 7. SAVE CONTACT: POST /api/udhar/contacts
    if (pathname === '/api/udhar/contacts' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const name = (body.name || '').trim();
      const email = (body.email || '').trim().toLowerCase();
      const phone = (body.phone || '').trim();
      const relationshipType = (body.relationship_type || body.relationshipType || 'Friend').trim();
      const notes = (body.notes || '').trim();
      const linkedUserId = body.linked_user_id || body.linkedUserId || null;

      if (!name) {
        sendJson(res, 400, { success: false, message: "Person's name is required." });
        return true;
      }

      const upsertRes = await query(
        `INSERT INTO public.udhar_contacts (user_id, name, email, phone, relationship_type, notes, linked_user_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id, name) DO UPDATE 
         SET email = EXCLUDED.email, 
             phone = EXCLUDED.phone, 
             relationship_type = EXCLUDED.relationship_type, 
             notes = EXCLUDED.notes, 
             linked_user_id = COALESCE(EXCLUDED.linked_user_id, public.udhar_contacts.linked_user_id), 
             updated_at = NOW()
         RETURNING *`,
        [authUser.id, name, email || null, phone || null, relationshipType, notes || null, linkedUserId]
      );

      sendJson(res, 200, { success: true, contact: upsertRes.rows[0] });
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
      const name = (body.name || '').trim();
      const email = (body.email || '').trim().toLowerCase();
      const phone = (body.phone || '').trim();
      const relationshipType = (body.relationship_type || body.relationshipType || 'Friend').trim();
      const notes = (body.notes || '').trim();
      const linkedUserId = body.linked_user_id || body.linkedUserId || null;

      if (!name) {
        sendJson(res, 400, { success: false, message: "Person's name is required." });
        return true;
      }

      const updRes = await query(
        `UPDATE public.udhar_contacts 
         SET name = $1, email = $2, phone = $3, relationship_type = $4, notes = $5, linked_user_id = $6, updated_at = NOW()
         WHERE id = $7 AND user_id = $8
         RETURNING *`,
        [name, email || null, phone || null, relationshipType, notes || null, linkedUserId, contactId, authUser.id]
      );

      if (updRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Contact not found.' });
        return true;
      }

      sendJson(res, 200, { success: true, contact: updRes.rows[0] });
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

      // Verify target user exists
      const targetUserRes = await query('SELECT id, full_name, email FROM public.app_users WHERE id = $1', [registeredUserId]);
      if (targetUserRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Registered user not found.' });
        return true;
      }

      // Link contact
      await query(
        `UPDATE public.udhar_contacts 
         SET linked_user_id = $1, updated_at = NOW() 
         WHERE id = $2`,
        [registeredUserId, contactId]
      );

      // Link user connection
      await query(
        `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
         VALUES ($1, $2, 'connected')
         ON CONFLICT (user_a_id, user_b_id) DO NOTHING`,
        [authUser.id, registeredUserId]
      );

      // Retroactively bind counterpart_user_id on previous transactions with this contact name
      await query(
        `UPDATE public.udhar_transactions 
         SET counterpart_user_id = $1, updated_at = NOW() 
         WHERE user_id = $2 AND counterpart_name = $3 AND counterpart_user_id IS NULL`,
        [registeredUserId, authUser.id, contact.name]
      );

      sendJson(res, 200, {
        success: true,
        message: `Successfully linked ${contact.name} with registered user ${targetUserRes.rows[0].full_name}.`,
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

      const rate = checkRateLimit(`user_search:${authUser.id}`, 40, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { success: false, message: 'Search rate limit exceeded. Please wait a moment.' });
        return true;
      }

      const q = ((parsed.query.q as string) || '').trim().toLowerCase();
      if (!q || q.length < 2) {
        sendJson(res, 200, { success: true, users: [] });
        return true;
      }

      // Query registered active users excluding requesting user
      const usersRes = await query(
        `SELECT id, full_name, email, phone, avatar_url, role 
         FROM public.app_users 
         WHERE id <> $1 AND status = 'active' AND (
           LOWER(email) = $2 OR 
           phone = $2 OR 
           LOWER(email) LIKE $3 OR 
           LOWER(full_name) LIKE $3
         )
         LIMIT 10`,
        [authUser.id, q, `%${q}%`]
      );

      // Return ONLY privacy-sanitized profile info (never expose password, sessions, financial logs)
      const sanitizedUsers = usersRes.rows.map((u: any) => ({
        id: u.id,
        displayName: u.full_name,
        fullName: u.full_name,
        emailMasked: maskEmail(u.email),
        phoneMasked: maskPhone(u.phone),
        avatarUrl: u.avatar_url,
      }));

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
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
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
        pairingToken = tokenRes.rows[0]?.pairing_token;
        pairingCode = tokenRes.rows[0]?.pairing_code;
        if (tokenRes.rows[0]?.expires_at) expiresAt = tokenRes.rows[0].expires_at;
      } catch (err) {
        console.warn('QR tokens table query notice:', err);
      }

      if (!pairingToken) {
        pairingToken = generateCryptoToken(32);
        pairingCode = `MM-${generateCryptoToken(4).toUpperCase()}`;

        try {
          await query(
            `INSERT INTO public.qr_pairing_tokens (user_id, pairing_token, pairing_code, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [authUser.id, pairingToken, pairingCode, expiresAt]
          );
        } catch (dbErr) {
          console.warn('[QR Pairing DB Notice]:', dbErr);
        }
      }

      const qrPayload = JSON.stringify({
        v: 1,
        app: 'my-money',
        type: 'udhar-pair',
        code: pairingCode,
        token: pairingToken,
        userId: authUser.id,
        name: authUser.full_name || authUser.email?.split('@')[0] || 'User',
      });

      sendJson(res, 200, {
        success: true,
        pairingToken,
        pairingCode,
        publicName: authUser.full_name || authUser.email?.split('@')[0] || 'User',
        qrData: qrPayload,
        expiresAt,
      });
      return true;
    }

    // 13. RESOLVE QR CODE: POST /api/udhar/qr/resolve
    if (pathname === '/api/udhar/qr/resolve' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);
      let targetToken = (body.pairingToken || '').trim();
      let targetCode = (body.pairingCode || '').trim();
      const rawData = body.qrData || '';

      if (rawData) {
        try {
          const parsedQr = JSON.parse(rawData);
          if (parsedQr.token) targetToken = parsedQr.token;
          if (parsedQr.code) targetCode = parsedQr.code;
        } catch {
          // If plain token string was scanned
          if (!targetToken) targetToken = rawData.trim();
        }
      }

      if (!targetToken && !targetCode) {
        sendJson(res, 400, { success: false, message: 'No valid QR pairing token or code provided.' });
        return true;
      }

      // Query token from database
      const tokenRes = await query(
        `SELECT t.id, t.user_id, t.pairing_token, t.pairing_code, t.expires_at, t.used,
                u.full_name, u.email, u.phone, u.avatar_url
         FROM public.qr_pairing_tokens t
         JOIN public.app_users u ON t.user_id = u.id
         WHERE (t.pairing_token = $1 OR t.pairing_code = $2) AND t.expires_at > NOW() AND t.used = FALSE`,
        [targetToken || '__none__', targetCode || '__none__']
      );

      if (tokenRes.rows.length === 0) {
        sendJson(res, 404, {
          success: false,
          message: 'Invalid, expired, or already used QR code pairing reference.',
        });
        return true;
      }

      const qrOwner = tokenRes.rows[0];

      if (qrOwner.user_id === authUser.id) {
        sendJson(res, 400, {
          success: false,
          message: 'This is your own QR code! You cannot link your account with yourself.',
        });
        return true;
      }

      // Check if already linked
      const connRes = await query(
        `SELECT id FROM public.user_connections 
         WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)`,
        [authUser.id, qrOwner.user_id]
      );
      const isAlreadyConnected = connRes.rows.length > 0;

      sendJson(res, 200, {
        success: true,
        owner: {
          id: qrOwner.user_id,
          displayName: qrOwner.full_name,
          fullName: qrOwner.full_name,
          emailMasked: maskEmail(qrOwner.email),
          phoneMasked: maskPhone(qrOwner.phone),
          avatarUrl: qrOwner.avatar_url,
        },
        pairingToken: qrOwner.pairing_token,
        pairingCode: qrOwner.pairing_code,
        isAlreadyConnected,
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
      const pairingToken = (body.pairingToken || '').trim();
      const pairingCode = (body.pairingCode || '').trim();
      const relationshipType = (body.relationshipType || 'Friend').trim();

      // Find token
      const tokenRes = await query(
        `SELECT t.id, t.user_id, t.is_single_use, u.full_name, u.email, u.phone 
         FROM public.qr_pairing_tokens t
         JOIN public.app_users u ON t.user_id = u.id
         WHERE (t.pairing_token = $1 OR t.pairing_code = $2) AND t.expires_at > NOW() AND t.used = FALSE`,
        [pairingToken || '__none__', pairingCode || '__none__']
      );

      if (tokenRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Pairing reference expired or invalid.' });
        return true;
      }

      const tokenRecord = tokenRes.rows[0];
      const targetUserId = tokenRecord.user_id;

      if (targetUserId === authUser.id) {
        sendJson(res, 400, { success: false, message: 'Cannot connect with your own QR code.' });
        return true;
      }

      // 1. Create connection (idempotent ON CONFLICT DO NOTHING)
      await query(
        `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
         VALUES ($1, $2, 'connected')
         ON CONFLICT (user_a_id, user_b_id) DO NOTHING`,
        [authUser.id, targetUserId]
      );

      // 2. Save target user in current user's udhar_contacts
      await query(
        `INSERT INTO public.udhar_contacts (user_id, name, email, phone, relationship_type, linked_user_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id, name) DO UPDATE 
         SET linked_user_id = EXCLUDED.linked_user_id, email = EXCLUDED.email, updated_at = NOW()`,
        [authUser.id, tokenRecord.full_name, tokenRecord.email, tokenRecord.phone, relationshipType, targetUserId]
      );

      // 3. Reciprocally save current user in target user's contacts
      await query(
        `INSERT INTO public.udhar_contacts (user_id, name, email, phone, relationship_type, linked_user_id, updated_at)
         VALUES ($1, $2, $3, $4, 'Friend', $5, NOW())
         ON CONFLICT (user_id, name) DO UPDATE 
         SET linked_user_id = EXCLUDED.linked_user_id, email = EXCLUDED.email, updated_at = NOW()`,
        [targetUserId, authUser.full_name, authUser.email, authUser.phone, authUser.id]
      );

      // 4. Mark single-use token if configured
      if (tokenRecord.is_single_use) {
        await query(
          `UPDATE public.qr_pairing_tokens 
           SET used = TRUE, used_by_user_id = $1, used_at = NOW() 
           WHERE id = $2`,
          [authUser.id, tokenRecord.id]
        );
      }

      await logSecurityEvent('USER_LINKED_VIA_QR', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { targetUserId, targetName: tokenRecord.full_name },
      });

      sendJson(res, 200, {
        success: true,
        message: `Successfully linked with ${tokenRecord.full_name}! Added to Saved People.`,
        connectedUser: {
          id: targetUserId,
          displayName: tokenRecord.full_name,
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

      // Fetch all transactions for this user
      const txRes = await query(
        `SELECT t.*, 
                u.full_name AS counterpart_registered_name, 
                u.email AS counterpart_email
         FROM public.udhar_transactions t
         LEFT JOIN public.app_users u ON t.counterpart_user_id = u.id
         WHERE t.user_id = $1
         ORDER BY t.transaction_date DESC, t.created_at DESC`,
        [authUser.id]
      );

      // Fetch repayments for these transactions
      const repayRes = await query(
        `SELECT r.*, u.full_name AS recorded_by_name
         FROM public.udhar_repayments r
         JOIN public.udhar_transactions t ON r.udhar_id = t.id
         LEFT JOIN public.app_users u ON r.recorded_by_user_id = u.id
         WHERE t.user_id = $1
         ORDER BY r.repayment_date DESC, r.created_at DESC`,
        [authUser.id]
      );

      // Group repayments by udhar_id
      const repaymentsByUdhar: Record<string, any[]> = {};
      for (const rep of repayRes.rows) {
        if (!repaymentsByUdhar[rep.udhar_id]) {
          repaymentsByUdhar[rep.udhar_id] = [];
        }
        repaymentsByUdhar[rep.udhar_id].push(rep);
      }

      const transactions = txRes.rows.map((r: any) => ({
        ...r,
        repayments: repaymentsByUdhar[r.id] || [],
      }));

      // Calculate totals
      let totalLent = 0;
      let totalBorrowed = 0;
      let outstandingReceivable = 0;
      let outstandingPayable = 0;
      let settledAmount = 0;
      let overdueAmount = 0;

      const todayStr = new Date().toISOString().split('T')[0];

      for (const t of transactions) {
        const orig = parseFloat(t.original_amount) || 0;
        const cur = parseFloat(t.current_balance) || 0;

        if (t.direction === 'gave') {
          totalLent += orig;
          if (t.status !== 'settled') {
            outstandingReceivable += cur;
          }
        } else {
          totalBorrowed += orig;
          if (t.status !== 'settled') {
            outstandingPayable += cur;
          }
        }

        settledAmount += Math.max(0, orig - cur);

        if (t.due_date && t.due_date < todayStr && t.status !== 'settled' && cur > 0) {
          overdueAmount += cur;
        }
      }

      sendJson(res, 200, {
        success: true,
        transactions,
        summary: {
          totalLent: Math.round(totalLent * 100) / 100,
          totalBorrowed: Math.round(totalBorrowed * 100) / 100,
          outstandingReceivable: Math.round(outstandingReceivable * 100) / 100,
          outstandingPayable: Math.round(outstandingPayable * 100) / 100,
          settledAmount: Math.round(settledAmount * 100) / 100,
          overdueAmount: Math.round(overdueAmount * 100) / 100,
        },
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
      const counterpartName = (body.counterpart_name || body.person_name || '').trim();
      const counterpartUserId = body.counterpart_user_id || body.counterpartUserId || null;
      const direction = body.direction; // 'gave' (Lend) or 'took' (Borrow)
      const amount = parseFloat(body.amount);
      const txDate = body.transaction_date || body.date || new Date().toISOString().split('T')[0];
      const dueDate = body.due_date || body.dueDate || null;
      const notes = (body.notes || '').trim();
      const attachmentUrl = body.attachment_url || null;

      if (!counterpartName) {
        sendJson(res, 400, { success: false, message: "Person's name is required." });
        return true;
      }

      if (!['gave', 'took'].includes(direction)) {
        sendJson(res, 400, { success: false, message: "Transaction type must be 'gave' (I Gave) or 'took' (I Took)." });
        return true;
      }

      if (isNaN(amount) || amount <= 0) {
        sendJson(res, 400, { success: false, message: 'Please enter a valid amount greater than ₹0.' });
        return true;
      }

      // Generate shared link ID
      const linkRes = await query('SELECT gen_random_uuid() AS link_id');
      const linkId = linkRes.rows[0].link_id;

      // Check if counterpart is a registered user
      let isRegisteredCounterpart = false;
      let registeredUser: any = null;

      if (counterpartUserId && counterpartUserId !== authUser.id) {
        const uCheck = await query('SELECT id, full_name, email FROM public.app_users WHERE id = $1', [counterpartUserId]);
        if (uCheck.rows.length > 0) {
          isRegisteredCounterpart = true;
          registeredUser = uCheck.rows[0];
        }
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (isRegisteredCounterpart) {
          // TWO-SIDED SYNCHRONIZATION:
          // User A (Initiator):
          const userAStatus = 'pending_confirmation';
          const userARes = await client.query(
            `INSERT INTO public.udhar_transactions (
              link_id, user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance,
              transaction_date, due_date, notes, attachment_url, status, confirmation_status, is_initiator
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', TRUE)
            RETURNING *`,
            [linkId, authUser.id, registeredUser.id, registeredUser.full_name, direction, amount, amount, txDate, dueDate, notes || null, attachmentUrl, userAStatus]
          );

          // User B (Counterpart): Inverted direction!
          // If User A gave, User B took. If User A took, User B gave.
          const counterpartDirection = direction === 'gave' ? 'took' : 'gave';
          await client.query(
            `INSERT INTO public.udhar_transactions (
              link_id, user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance,
              transaction_date, due_date, notes, attachment_url, status, confirmation_status, is_initiator
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_confirmation', 'pending', FALSE)`,
            [linkId, registeredUser.id, authUser.id, authUser.full_name, counterpartDirection, amount, amount, txDate, dueDate, notes || null, attachmentUrl]
          );

          // Auto-save contacts for both users
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

          // Create in-app notification for User B
          const notifMsg = `${authUser.full_name} recorded an Udhar of ₹${amount.toLocaleString('en-IN')} (${direction === 'gave' ? 'You Borrowed' : 'You Lent'}). Please confirm or dispute.`;
          await client.query(
            `INSERT INTO public.notifications (title, message, type, is_active)
             VALUES ($1, $2, 'info', TRUE)`,
            [`New Udhar Request from ${authUser.full_name}`, notifMsg]
          ).catch(() => {});

          await client.query('COMMIT');

          await logSecurityEvent('UDHAR_TWO_SIDED_CREATED', {
            userId: authUser.id,
            userEmail: authUser.email,
            details: { linkId, counterpartId: registeredUser.id, amount, direction },
          });

          sendJson(res, 201, {
            success: true,
            message: `Udhar recorded with ${registeredUser.full_name}. A linked entry was synchronized for their account.`,
            transaction: userARes.rows[0],
            isLinked: true,
          });
          return true;
        } else {
          // Unregistered contact or self-managed entry
          const singleRes = await client.query(
            `INSERT INTO public.udhar_transactions (
              link_id, user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance,
              transaction_date, due_date, notes, attachment_url, status, confirmation_status, is_initiator
            ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, 'confirmed', 'confirmed', TRUE)
            RETURNING *`,
            [linkId, authUser.id, counterpartName, direction, amount, amount, txDate, dueDate, notes || null, attachmentUrl]
          );

          // Ensure saved in udhar_contacts
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

          sendJson(res, 201, {
            success: true,
            message: `Udhar recorded for ${counterpartName}.`,
            transaction: singleRes.rows[0],
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
      const txRes = await query('SELECT * FROM public.udhar_transactions WHERE id = $1 AND user_id = $2', [txId, authUser.id]);
      if (txRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Transaction not found.' });
        return true;
      }

      const tx = txRes.rows[0];

      // Update both sides sharing link_id
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

      const txRes = await query('SELECT * FROM public.udhar_transactions WHERE id = $1 AND user_id = $2', [txId, authUser.id]);
      if (txRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Transaction not found.' });
        return true;
      }

      const tx = txRes.rows[0];

      // Mark both sides as disputed
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
      const repayAmount = parseFloat(body.amount);
      const repayDate = body.repayment_date || body.date || new Date().toISOString().split('T')[0];
      const notes = (body.notes || '').trim();

      if (isNaN(repayAmount) || repayAmount <= 0) {
        sendJson(res, 400, { success: false, message: 'Please enter a valid repayment amount greater than ₹0.' });
        return true;
      }

      const txRes = await query('SELECT * FROM public.udhar_transactions WHERE id = $1 AND user_id = $2', [txId, authUser.id]);
      if (txRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Transaction not found.' });
        return true;
      }

      const tx = txRes.rows[0];
      const currentBal = parseFloat(tx.current_balance);

      if (repayAmount > currentBal + 0.05) {
        sendJson(res, 400, {
          success: false,
          message: `Repayment amount (₹${repayAmount}) cannot exceed remaining balance (₹${currentBal}).`,
        });
        return true;
      }

      const newBalance = Math.max(0, Math.round((currentBal - repayAmount) * 100) / 100);
      const isSettled = newBalance <= 0.01;
      const newStatus = isSettled ? 'settled' : 'confirmed';

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Record repayment entry
        await client.query(
          `INSERT INTO public.udhar_repayments (link_id, udhar_id, recorded_by_user_id, amount, repayment_date, notes, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')`,
          [tx.link_id, tx.id, authUser.id, repayAmount, repayDate, notes || null]
        );

        // Update balances on all transactions sharing this link_id
        await client.query(
          `UPDATE public.udhar_transactions 
           SET current_balance = $1, status = $2, settled_at = (CASE WHEN $3 = TRUE THEN NOW() ELSE settled_at END), updated_at = NOW() 
           WHERE link_id = $4`,
          [newBalance, newStatus, isSettled, tx.link_id]
        );

        await client.query('COMMIT');

        await logSecurityEvent('UDHAR_REPAYMENT_RECORDED', {
          userId: authUser.id,
          userEmail: authUser.email,
          details: { txId, linkId: tx.link_id, amount: repayAmount, remainingBalance: newBalance, isSettled },
        });

        sendJson(res, 200, {
          success: true,
          message: isSettled
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

      // Async send acknowledgement email
      sendFeedbackConfirmationEmail({
        email: trustedEmail,
        userName: trustedName,
        rating: rating || 5,
        category,
        message,
      }).catch((e) => console.warn('[Feedback Ack Email Error]:', e));

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
