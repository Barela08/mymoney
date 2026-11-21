import type { IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { query } from './db.ts';
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
  logSecurityEvent,
} from './security.ts';
import {
  createSession,
  revokeSession,
  revokeAllUserSessions,
  authenticateRequest,
  sanitizeUserOutput,
} from './auth.ts';
import {
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendWelcomeEmail,
  sendAccountStatusEmail,
} from './email.ts';

// Helper: parse JSON body from incoming request
async function parseJsonBody(req: IncomingMessage): Promise<any> {
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

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const parsed = parseUrl(req.url || '', true);
  const pathname = parsed.pathname || '';
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
        sendJson(res, 400, {
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

      // Async send welcome email
      sendWelcomeEmail(email, fullName).catch(() => {});

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

      // Rate limiting: 10 attempts per 5 minutes per IP
      const rate = checkRateLimit(`login_ip:${clientIp}`, 10, 5 * 60 * 1000);
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

      // STRICT SECURITY RULE: NEVER select password_hash or display_password!
      const usersRes = await query(
        `SELECT 
            u.id,
            u.full_name,
            u.email,
            u.phone,
            u.role,
            u.status,
            u.email_verified,
            u.avatar_url,
            u.force_password_reset,
            u.failed_login_attempts,
            u.created_at,
            u.last_login_at,
            u.password_changed_at,
            COUNT(s.id) FILTER (WHERE s.is_revoked = FALSE AND s.expires_at > NOW()) AS active_sessions_count
         FROM public.app_users u
         LEFT JOIN public.user_sessions s ON u.id = s.user_id
         GROUP BY u.id
         ORDER BY u.created_at DESC`
      );

      const users = usersRes.rows.map((r: any) => ({
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
