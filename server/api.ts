import type { IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import crypto from 'crypto';
import { query, pool, isDatabaseConfigured, isDatabaseAvailable } from './db.js';
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
  checkRateLimitAsync,
  resetRateLimitAsync,
  sendRateLimitExceeded,
  RATE_LIMITS,
  logSecurityEvent,
  extractClientIp,
  getOrIssueDeviceId,
  checkActiveRestrictionsAsync,
  recordViolationAndMaybeRestrictAsync,
} from './security.js';
import {
  cachedRead,
  tryAcquireConcurrencySlot,
  releaseConcurrencySlot,
  getConcurrencyMetrics,
  appCache,
} from './cache.js';
import {
  createSession,
  revokeSession,
  revokeAllUserSessions,
  authenticateRequest,
  sanitizeUserOutput,
  isDiscoverableNormalUser,
  MAX_ACTIVE_SESSIONS,
  SessionLimitError,
  listActiveSessionsForUser,
  revokeUserSessionById,
  extractSessionToken,
} from './auth.js';
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
  sendComplaintSubmissionEmails,
  sendSupportTicketSubmissionEmails,
} from './email.js';
import { APP_CONFIG } from './config.js';
import {
  getMaintenanceSettings,
  getAppPopupSettings,
  isMaintenanceModeEnabled,
} from './adminSettingsStore.js';
import { handleAdminApiRequest } from './adminApi.js';
import { handleAiFinanceRequest } from './aiFinanceApi.js';
import { handleUpiDetectionRequest } from './upiDetectionApi.js';
import { handlePrivacyConsentApi } from './privacyConsentApi.js';
import { handleUserAccountExtensions } from './userAccountExtensions.js';
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
  updateConnectionRequestNotificationsState,
  notifyFeedbackSubmitted,
  notifyAdminNewFeedback,
  notifyComplaintSubmitted,
  notifyAdminNewSupportTicket,
  processScheduledCampaigns,
  recordDeviceInstallation,
  recordAdminNotification,
  dispatchNewUserWelcomeNotification,
  getStaffNotifications,
  markStaffNotificationRead,
  markAllStaffNotificationsRead,
} from './notificationService.js';
import {
  getPublicSiteConfigPayload,
  getPublishedSiteConfig,
  subscribeSiteConfigSse,
  getBrandingAssetById,
  serveBrandingAssetResponse,
  buildDynamicPwaManifest,
  resolveDynamicPwaIcon,
  generateRobotsTxt,
  generateSitemapXml,
  listStaffTasks,
  updateStaffTask,
} from './siteControlCenter.js';
import { recordHttpRequestMetric, recordRateLimitEvent } from './telemetry.js';
import { processSecureUpload } from './uploadSecurity.js';
import {
  verifySignedPrivateParams,
  getObjectFromStorage,
  createSignedPrivateUrl,
  hashOwnerId,
} from './storageService.js';
import {
  insertFeedbackFallback,
  listFeedbacksFallback,
  listUserNotificationsFallback,
  getUserNotificationByIdFallback,
  markUserNotificationReadFallback,
  markAllUserNotificationsReadFallback,
  deleteUserNotificationFallback,
  clearAllUserNotificationsFallback,
  sbRestRequest,
  listAllAppUsersFallback,
  insertSupportTicketFallback,
  listSupportTicketsFallback,
  getSupportTicketByIdFallback,
  insertSupportTicketReplyFallback,
  getSupportTicketRepliesFallback,
  updateSupportTicketStatusFallback,
  listAdminRolesFallback,
} from './supabaseRestFallback.js';
import {
  normalizeSearchQuery,
  classifyLiveSearchQuery,
  maskEmailForPrivacy,
  maskPhoneForPrivacy,
  parseQrPayload,
  calculateRepaymentApplication,
  validateUdharEdit,
  canCancelUdhar,
  canDeleteRepayment,
  isActiveRepayment,
  recalculateUdharFromRepayments,
  calculatePeopleDashboardSummary,
  packStructuredNote,
  unpackStructuredNote,
  roundMoney,
  parseConnectionRequestKey,
  normalizeUdharLifecycleStatus,
  canAcceptUdhar,
  canRejectUdhar,
  canSenderCancelUdhar,
  type UdharCreationMethod,
} from '../src/lib/sharedUdharEngine.js';
import { validateReceiptFileSignature } from '../src/lib/financialIntelligenceEngine.js';
import {
  searchUsersRest,
  connectUserRest,
  getConnectionRequestsRest,
  acceptConnectionRequestRest,
  rejectConnectionRequestRest,
  cancelConnectionRequestRest,
  removeSavedConnectionRest,
  disconnectUserRest,
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
  createUdharViaQrRest,
  confirmUdharTransactionRest,
  rejectUdharTransactionRest,
  cancelUdharRequestRest,
  disputeUdharTransactionRest,
  repayUdharRest,
  confirmRepaymentRest,
  rejectRepaymentRest,
  editUdharRest,
  settleUdharRest,
  cancelUdharRest,
  deleteRepaymentRest,
  getUdharHistoryRest,
  getPersonUpiProfileRest,
} from './supabaseRestUdhar.js';

async function syncSupabaseAuthPassword(email: string, newPassword: string): Promise<void> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  if (!serviceKey || !supabaseUrl || !email) return;

  try {
    const listRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=100`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: 'application/json',
        },
      }
    );
    if (!listRes.ok) return;
    const listData = await listRes.json().catch(() => null);
    const users: any[] = Array.isArray(listData?.users) ? listData.users : [];
    const target = users.find((u) => String(u?.email || '').trim().toLowerCase() === email.trim().toLowerCase());
    if (!target?.id) return;

    await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(target.id)}`, {
      method: 'PUT',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: newPassword }),
    });
  } catch (err) {
    console.warn('[Supabase Auth Password Sync Notice]:', err);
  }
}

// Helper: parse JSON body from incoming request
async function parseJsonBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<any> {
  // If Vercel or middleware already consumed and parsed JSON body
  if ((req as any).body !== undefined && (req as any).body !== null) {
    if (typeof (req as any).body === 'object') {
      if (Buffer.byteLength(JSON.stringify((req as any).body), 'utf8') > maxBytes) {
        throw new Error('Request payload too large');
      }
      return (req as any).body;
    }
    if (typeof (req as any).body === 'string') {
      if (Buffer.byteLength((req as any).body, 'utf8') > maxBytes) {
        throw new Error('Request payload too large');
      }
      try {
        return JSON.parse((req as any).body);
      } catch {
        return {};
      }
    }
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer | string) => {
      if (aborted) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        aborted = true;
        reject(new Error('Request payload too large'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (aborted) return;
      if (totalBytes === 0) return resolve({});
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', (err) => {
      if (!aborted) reject(err);
    });
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

// Helper: get client IP address (proxy-aware IPv4/IPv6)
function getClientIp(req: IncomingMessage): string {
  return extractClientIp(req);
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
  const isProd = process.env.NODE_ENV === 'production';
  const secureFlag = isProd ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secureFlag}`
  );
}

const PROTECTED_MASTER_ADMINS = new Set(['hackifypro@gmail.com', 'admin@mymoney.com']);
function isProtectedMasterAdminEmail(email?: string | null): boolean {
  return Boolean(email && PROTECTED_MASTER_ADMINS.has(String(email).trim().toLowerCase()));
}

function validateAvatarUrlInput(raw: unknown): { valid: boolean; value: string | null; error?: string } {
  if (raw === null || raw === undefined) return { valid: true, value: null };
  const trimmed = String(raw).trim();
  if (!trimmed) return { valid: true, value: null };

  if (trimmed.startsWith('data:')) {
    const match = trimmed.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      return {
        valid: false,
        value: null,
        error: 'Profile photo must be a valid JPEG, PNG, or WEBP image.',
      };
    }
    const mimeType = match[1].toLowerCase();
    const base64Data = match[2];
    const estimatedBytes = Math.floor((base64Data.length * 3) / 4);
    if (estimatedBytes <= 0 || estimatedBytes > 2 * 1024 * 1024) {
      return {
        valid: false,
        value: null,
        error: 'Profile photo must be smaller than 2 MB.',
      };
    }
    const sigCheck = validateReceiptFileSignature(base64Data, mimeType);
    if (!sigCheck.valid) {
      return {
        valid: false,
        value: null,
        error: 'Uploaded photo signature does not match a valid JPEG, PNG, or WEBP image.',
      };
    }
    return { valid: true, value: trimmed };
  }

  if (trimmed.length > 500) {
    return { valid: false, value: null, error: 'Avatar URL is too long (maximum 500 characters).' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return { valid: false, value: null, error: 'Avatar URL must be a valid HTTPS image URL.' };
    }
    if (/\.(svgz?|html?|xhtml|js|mjs)(\?|#|$)/i.test(parsed.pathname)) {
      return { valid: false, value: null, error: 'SVG or executable avatar URLs are not permitted.' };
    }
    return { valid: true, value: parsed.toString() };
  } catch {
    return { valid: false, value: null, error: 'Invalid avatar URL format.' };
  }
}

function sanitizeAttachmentUrlInput(raw: unknown): { valid: boolean; value: string | null; error?: string } {
  if (raw === null || raw === undefined) return { valid: true, value: null };
  const trimmed = String(raw).trim();
  if (!trimmed) return { valid: true, value: null };
  if (/[\r\n\0]/.test(trimmed)) {
    return { valid: false, value: null, error: 'Attachment URL contains invalid control characters.' };
  }

  // Signed private storage access route
  if (trimmed.startsWith('/api/uploads/private?')) {
    return trimmed.length <= 1200
      ? { valid: true, value: trimmed }
      : { valid: false, value: null, error: 'Attachment reference URL is too long.' };
  }

  // Legacy data URLs must be safe raster images (no SVG, HTML, scripts)
  if (trimmed.startsWith('data:')) {
    const match = trimmed.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
      return {
        valid: false,
        value: null,
        error: 'Only PNG, JPG, JPEG, or WebP attachment images are allowed.',
      };
    }
    const est = Math.floor((match[2].length * 3) / 4);
    if (est <= 0 || est > 5 * 1024 * 1024) {
      return { valid: false, value: null, error: 'Attachment exceeds maximum 5 MB limit.' };
    }
    const sig = validateReceiptFileSignature(match[2], match[1].toLowerCase());
    if (!sig.valid) {
      return { valid: false, value: null, error: sig.error || 'Attachment signature mismatch.' };
    }
    return { valid: true, value: trimmed };
  }

  if (trimmed.length > 800) {
    return { valid: false, value: null, error: 'Attachment URL exceeds maximum length.' };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return { valid: false, value: null, error: 'Attachment URL must use HTTPS.' };
    }
    if (/\.(svgz?|html?|xhtml|js|mjs|php|exe|dll|bat|cmd|ps1|sh|jar|apk|msi|scr)(\?|#|$)/i.test(parsed.pathname)) {
      return { valid: false, value: null, error: 'Dangerous attachment file type blocked.' };
    }
    return { valid: true, value: parsed.toString() };
  } catch {
    return { valid: false, value: null, error: 'Invalid attachment URL.' };
  }
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

  // Handle /api/* and dynamic SEO endpoints (/robots.txt, /sitemap.xml)
  if (!pathname.startsWith('/api/') && pathname !== '/robots.txt' && pathname !== '/sitemap.xml') {
    return false;
  }

  // Real-time HTTP latency & status telemetry (skip long-lived SSE stream)
  if (pathname !== '/api/public/site-config/stream' && !(res as any).__mmTelemetryHooked) {
    (res as any).__mmTelemetryHooked = true;
    const reqStart = Date.now();
    res.on('finish', () => {
      recordHttpRequestMetric(Date.now() - reqStart, res.statusCode || 200);
    });
  }

  const clientIp = getClientIp(req);
  const { deviceId } = getOrIssueDeviceId(req, res);
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
      if (parsed.hostname === 'mymoney.nileshbarela.site') return true;
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

  // CSRF Defense: For state-changing requests authenticated solely via cookie, validate Origin/Referer
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const cookieHeader = String(req.headers.cookie || '');
    const authHeader = String(req.headers.authorization || '');
    const usesCookieOnlyAuth = cookieHeader.includes('session_token=') && !authHeader.startsWith('Bearer ');
    if (usesCookieOnlyAuth) {
      if (requestOrigin) {
        if (!isAllowedOrigin(requestOrigin)) {
          sendJson(res, 403, { success: false, code: 'CSRF_ORIGIN_REJECTED', message: 'Cross-origin state-changing request rejected.' });
          return true;
        }
      } else if (req.headers.referer) {
        try {
          const refOrigin = new URL(String(req.headers.referer)).origin;
          if (!isAllowedOrigin(refOrigin)) {
            sendJson(res, 403, { success: false, code: 'CSRF_ORIGIN_REJECTED', message: 'Cross-origin state-changing request rejected.' });
            return true;
          }
        } catch {
          sendJson(res, 403, { success: false, code: 'CSRF_ORIGIN_REJECTED', message: 'Invalid request origin.' });
          return true;
        }
      }
    }
  }

  // Lightweight health check (no secrets exposed)
  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, {
      success: true,
      status: 'ok',
      databaseAvailable: isDatabaseAvailable(),
      concurrency: getConcurrencyMetrics(),
      cache: appCache.getStats(),
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  // Concurrency backpressure & multi-dimensional cooldown gate
  const isPriorityRoute =
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/udhar/transactions') ||
    pathname.startsWith('/api/transactions');
  const slot = tryAcquireConcurrencySlot(isPriorityRoute);
  if (!slot.allowed) {
    res.setHeader('Retry-After', String(slot.retryAfterSec || 3));
    sendJson(res, 503, {
      success: false,
      code: 'SERVER_BUSY',
      retryAfter: slot.retryAfterSec || 3,
      message: 'Server is handling high traffic. Please retry in a few seconds.',
    });
    return true;
  }

  try {
    // Check active progressive cooldown on IP, Device, or IP+Device (except admin security release)
    if (!pathname.startsWith('/api/admin/security/')) {
      const activeRestriction = await checkActiveRestrictionsAsync([
        `ip_device:${clientIp}:${deviceId}`,
        `device:${deviceId}`,
        `ip:${clientIp}`,
      ]);
      if (activeRestriction && activeRestriction.restrictedUntil) {
        const retryAfterSec = Math.max(1, Math.ceil((activeRestriction.restrictedUntil - Date.now()) / 1000));
        sendRateLimitExceeded(
          res,
          {
            retryAfterSec,
            operation: activeRestriction.reason,
            violationLevel: activeRestriction.violationLevel,
          },
          `Temporarily restricted (Level ${activeRestriction.violationLevel}). Please retry in ${Math.ceil(retryAfterSec / 60)} minute(s).`
        );
        return true;
      }
    }

    // General Token Bucket protection for read/write API bursts
    if (method === 'GET' && pathname !== '/api/public/site-config/stream') {
      const [ipRead, devRead] = await Promise.all([
        checkRateLimitAsync(`read:ip:${clientIp}`, RATE_LIMITS.GENERAL_READ_IP.max, RATE_LIMITS.GENERAL_READ_IP.windowMs, RATE_LIMITS.GENERAL_READ_IP.op),
        checkRateLimitAsync(`read:device:${deviceId}`, RATE_LIMITS.GENERAL_READ_DEVICE.max, RATE_LIMITS.GENERAL_READ_DEVICE.windowMs, RATE_LIMITS.GENERAL_READ_DEVICE.op),
      ]);
      if (!ipRead.allowed || !devRead.allowed) {
        recordRateLimitEvent();
        const violated = !ipRead.allowed ? ipRead : devRead;
        await recordViolationAndMaybeRestrictAsync({
          dimension: 'ip_device',
          identifier: `${clientIp}:${deviceId}`,
          reason: 'api.read.burst',
          threshold: 4,
        });
        sendRateLimitExceeded(res, violated);
        return true;
      }
    }

  // Public non-secret site configuration (cached with in-flight deduplication, never secrets)
  if (pathname === '/api/public/site-config' && method === 'GET') {
    try {
      const { value: payload, cacheStatus } = await cachedRead(
        'public:site_config',
        60_000,
        () => getPublicSiteConfigPayload(),
        120_000
      );
      sendJson(res, 200, payload, {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
        'X-Cache': cacheStatus,
      });
    } catch {
      const [maintenance, appPopup] = await Promise.all([
        getMaintenanceSettings().catch(() => ({ isEnabled: false })),
        getAppPopupSettings().catch(() => ({ enabled: true, downloadUrl: '/#install' })),
      ]);
      sendJson(res, 200, {
        success: true,
        version: 1,
        updatedAt: new Date().toISOString(),
        maintenance,
        appPopup,
      });
    }
    return true;
  }

  // Real-time Server-Sent Events (SSE) stream for live configuration updates without page reload
  if (pathname === '/api/public/site-config/stream' && method === 'GET') {
    const parsed = parseUrl(req.url || '', true);
    const sinceParam =
      typeof parsed.query.v === 'string'
        ? parseInt(parsed.query.v, 10)
        : typeof req.headers['last-event-id'] === 'string'
        ? parseInt(req.headers['last-event-id'], 10)
        : undefined;
    await subscribeSiteConfigSse(
      req,
      res,
      Number.isFinite(sinceParam as number) ? (sinceParam as number) : undefined
    );
    return true;
  }

  // Public sanitized branding asset retrieval (sandbox CSP enforced for SVG)
  const brandingAssetMatch = pathname.match(/^\/api\/branding\/assets\/([a-zA-Z0-9._-]+)$/);
  if (brandingAssetMatch && method === 'GET') {
    const asset = await getBrandingAssetById(brandingAssetMatch[1]);
    if (!asset) {
      sendJson(res, 404, { success: false, message: 'Branding asset not found.' });
      return true;
    }
    await serveBrandingAssetResponse(res, asset);
    return true;
  }

  // Dynamic per-app PWA manifests (/api/pwa/manifest/user | myadmin | mystaff)
  const pwaManifestMatch = pathname.match(/^\/api\/pwa\/manifest\/(user|myadmin|mystaff)$/);
  if (pwaManifestMatch && method === 'GET') {
    const scope = pwaManifestMatch[1] as 'user' | 'myadmin' | 'mystaff';
    const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
    const manifest = await buildDynamicPwaManifest(scope, hostHeader);
    res.writeHead(200, {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(manifest, null, 2));
    return true;
  }

  // Dynamic per-app PWA icon resolver (/api/pwa/icon/user | myadmin | mystaff)
  const pwaIconMatch = pathname.match(/^\/api\/pwa\/icon\/(user|myadmin|mystaff)$/);
  if (pwaIconMatch && method === 'GET') {
    const scope = pwaIconMatch[1] as 'user' | 'myadmin' | 'mystaff';
    await resolveDynamicPwaIcon(scope, res);
    return true;
  }

  // Dynamic SEO endpoints (never expose /myadmin or /mystaff)
  if ((pathname === '/robots.txt' || pathname === '/api/robots.txt') && method === 'GET') {
    const body = await generateRobotsTxt();
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=60, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
    return true;
  }

  if ((pathname === '/sitemap.xml' || pathname === '/api/sitemap.xml') && method === 'GET') {
    const xml = await generateSitemapXml();
    res.writeHead(200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(xml);
    return true;
  }

  try {
    // ---------------------------------------------------------
    // 0-UPLOADS. SECURE QUARANTINE UPLOAD & SIGNED PRIVATE ACCESS
    // ---------------------------------------------------------
    if (pathname === '/api/uploads/attachment' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req, 8 * 1024 * 1024);
      const allowedPurposes = new Set([
        'transaction_attachment',
        'udhar_attachment',
        'receipt_ocr',
        'profile_avatar',
      ]);
      const purpose = allowedPurposes.has(String(body.purpose))
        ? (body.purpose as 'transaction_attachment' | 'udhar_attachment' | 'receipt_ocr' | 'profile_avatar')
        : 'transaction_attachment';
      const dataUrl = String(body.dataUrl || body.imageDataUrl || '').trim();
      const filename = String(body.filename || 'attachment.jpg').slice(0, 140);

      if (!dataUrl) {
        sendJson(res, 400, { success: false, message: 'Upload payload is required.' });
        return true;
      }

      const result = await processSecureUpload({
        userId: authUser.id,
        userEmail: authUser.email,
        purpose,
        filename,
        dataUrlOrRawBase64: dataUrl,
        declaredMime: typeof body.mimeType === 'string' ? body.mimeType : undefined,
        ipAddress: clientIp,
        allowSvg: false,
      });

      if (!result.success) {
        const statusCode = result.status === 'quarantined_pending' ? 202 : 400;
        sendJson(res, statusCode, {
          success: false,
          code: result.status === 'quarantined_pending' ? 'QUARANTINED_PENDING_REVIEW' : 'UPLOAD_SECURITY_REJECTED',
          quarantineId: result.quarantineId,
          scanStatus: result.status,
          scannerEngine: result.scannerEngine,
          message: result.error || 'File failed security validation.',
        });
        return true;
      }

      sendJson(res, 201, {
        success: true,
        quarantineId: result.quarantineId,
        scanStatus: result.status,
        scannerEngine: result.scannerEngine,
        mimeType: result.mimeType,
        byteSize: result.byteSize,
        width: result.width,
        height: result.height,
        sha256: result.sha256,
        bucket: result.bucket,
        objectKey: result.objectKey,
        signedAccessUrl: result.signedAccessUrl,
        signedUrlExpiresAt: result.signedUrlExpiresAt,
      });
      return true;
    }

    if (pathname === '/api/uploads/signed-url' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }
      const body = await parseJsonBody(req);
      const objectKey = String(body.objectKey || '').trim();
      const mimeType = String(body.mimeType || 'image/jpeg').trim();
      const ownerPrefix = `${hashOwnerId(authUser.id)}/`;
      const isAdmin = authUser.role === 'admin' || authUser.role === 'superadmin';
      if (!objectKey || (!objectKey.startsWith(ownerPrefix) && !isAdmin)) {
        sendJson(res, 403, { success: false, message: 'Unauthorized storage object reference.' });
        return true;
      }
      const signed = await createSignedPrivateUrl({
        bucket: 'private-attachments',
        objectKey,
        ownerUserId: authUser.id,
        mimeType,
        ttlSeconds: 300,
      });
      sendJson(res, 200, { success: true, ...signed });
      return true;
    }

    if (pathname === '/api/uploads/private' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }
      const bucket = String(parsed.query.bucket || '');
      const objectKey = String(parsed.query.key || '');
      const exp = String(parsed.query.exp || '');
      const mime = String(parsed.query.mime || 'application/octet-stream');
      const sig = String(parsed.query.sig || '');

      if (bucket !== 'private-attachments' || !objectKey) {
        sendJson(res, 403, { success: false, message: 'Forbidden storage bucket.' });
        return true;
      }
      const ownerPrefix = `${hashOwnerId(authUser.id)}/`;
      const isAdmin = authUser.role === 'admin' || authUser.role === 'superadmin';
      if (!objectKey.startsWith(ownerPrefix) && !isAdmin) {
        sendJson(res, 403, { success: false, message: 'Access denied to another user attachment.' });
        return true;
      }
      if (!isAdmin) {
        const sigValid = verifySignedPrivateParams({
          bucket,
          objectKey,
          ownerUserId: authUser.id,
          mimeType: mime,
          exp,
          sig,
        });
        if (!sigValid) {
          sendJson(res, 403, { success: false, message: 'Signed attachment link expired or invalid.' });
          return true;
        }
      }

      const obj = await getObjectFromStorage('private-attachments', objectKey);
      if (!obj) {
        sendJson(res, 404, { success: false, message: 'Attachment not found.' });
        return true;
      }
      const safeContentType = ['image/png', 'image/jpeg', 'image/webp'].includes(mime) ? mime : 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': safeContentType,
        'Content-Length': String(obj.data.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': 'inline',
      });
      res.end(obj.data);
      return true;
    }

    // ---------------------------------------------------------
    // 0A. DEDICATED ADMIN LOGIN: POST /api/admin/auth/login
    // Always accessible (even during Maintenance Mode); strictly verifies admin role.
    // ---------------------------------------------------------
    if (pathname === '/api/admin/auth/login' && method === 'POST') {
      const body = await parseJsonBody(req);
      const email = normalizeEmail(body.email || '');
      const password = String(body.password || '');
      const rememberMe = Boolean(body.rememberMe);

      const rateIp = await checkRateLimitAsync(`admin_login:ip:${clientIp}`, RATE_LIMITS.ADMIN_LOGIN_IP.max, RATE_LIMITS.ADMIN_LOGIN_IP.windowMs, RATE_LIMITS.ADMIN_LOGIN_IP.op);
      if (!rateIp.allowed) {
        sendRateLimitExceeded(res, rateIp);
        return true;
      }

      if (email) {
        const rateAcct = await checkRateLimitAsync(`admin_login:account:${email}`, RATE_LIMITS.ADMIN_LOGIN_ACCOUNT.max, RATE_LIMITS.ADMIN_LOGIN_ACCOUNT.windowMs, RATE_LIMITS.ADMIN_LOGIN_ACCOUNT.op);
        if (!rateAcct.allowed) {
          sendRateLimitExceeded(res, rateAcct);
          return true;
        }
      }

      if (!email || !password) {
        sendJson(res, 400, { success: false, message: 'Admin email and password are required.' });
        return true;
      }

      const ADMIN_PORTAL_ROLES = new Set(['superadmin', 'admin']);
      const BUILTIN_STAFF_ROLES = new Set(['support', 'analyst']);
      const isMasterAdminEmail = (addr: string) =>
        addr === 'hackifypro@gmail.com' || addr === 'admin@mymoney.com';

      const isKnownStaffRoleSlug = async (slugCandidate: string): Promise<boolean> => {
        const clean = String(slugCandidate || '').toLowerCase().trim();
        if (!clean || clean === 'user' || clean === 'anonymous' || ADMIN_PORTAL_ROLES.has(clean)) {
          return false;
        }
        if (BUILTIN_STAFF_ROLES.has(clean)) return true;
        if (isDatabaseAvailable()) {
          try {
            const roleRes = await query('SELECT slug FROM public.admin_roles WHERE LOWER(slug) = $1 LIMIT 1', [clean]);
            if (roleRes.rows.length > 0) return true;
          } catch {}
        }
        try {
          const fallbackRoles = await listAdminRolesFallback();
          if (fallbackRoles.some((r: any) => String(r.slug || '').toLowerCase().trim() === clean)) {
            return true;
          }
        } catch {}
        return false;
      };

      let userRecord: any = null;
      if (isDatabaseAvailable()) {
        try {
          const userRes = await query('SELECT * FROM public.app_users WHERE LOWER(email) = $1 LIMIT 1', [email]);
          if (userRes.rows.length > 0) userRecord = userRes.rows[0];
        } catch {
          // Fall back to Supabase REST if direct DB fails
        }
      }

      if (!userRecord) {
        const sbRes = await sbRestRequest<any[]>(
          `app_users?email=ilike.${encodeURIComponent(email)}&select=*&limit=1`
        );
        if (sbRes.ok && Array.isArray(sbRes.data) && sbRes.data.length > 0) {
          userRecord = sbRes.data[0];
        }
      }

      if (!userRecord) {
        await logSecurityEvent('ADMIN_LOGIN_FAILED_UNKNOWN', { userEmail: email, ipAddress: clientIp }).catch(() => {});
        sendJson(res, 401, { success: false, message: 'Invalid administrator credentials.' });
        return true;
      }

      if (userRecord.locked_until && new Date(userRecord.locked_until) > new Date()) {
        const remainingMin = Math.ceil((new Date(userRecord.locked_until).getTime() - Date.now()) / 60000);
        sendJson(res, 429, {
          success: false,
          message: `Administrator account is temporarily locked. Try again in ${remainingMin} minute(s).`,
        });
        return true;
      }

      if (userRecord.status === 'suspended' || userRecord.status === 'deactivated') {
        sendJson(res, 403, {
          success: false,
          message: `This account is ${userRecord.status}. Administrative sign-in blocked.`,
        });
        return true;
      }

      const isValid = await verifyPassword(password, userRecord.password_hash);
      if (!isValid) {
        if (isDatabaseAvailable()) {
          const attempts = (userRecord.failed_login_attempts || 0) + 1;
          const lockSql =
            attempts >= 5
              ? "UPDATE public.app_users SET failed_login_attempts = $1, locked_until = NOW() + INTERVAL '15 minutes' WHERE id = $2"
              : 'UPDATE public.app_users SET failed_login_attempts = $1 WHERE id = $2';
          await query(lockSql, [attempts, userRecord.id]).catch(() => {});
        }
        await logSecurityEvent('ADMIN_LOGIN_FAILED_PASSWORD', {
          userId: userRecord.id,
          userEmail: email,
          ipAddress: clientIp,
        }).catch(() => {});
        sendJson(res, 401, { success: false, message: 'Invalid administrator credentials.' });
        return true;
      }

      const rawRole = String(userRecord.role || 'user').toLowerCase().trim();
      const rawSlug = String(userRecord.role_slug || '').toLowerCase().trim();
      const effectiveRole = isMasterAdminEmail(email)
        ? 'superadmin'
        : ADMIN_PORTAL_ROLES.has(rawRole)
        ? rawRole
        : ADMIN_PORTAL_ROLES.has(rawSlug)
        ? rawSlug
        : rawSlug && rawSlug !== 'user'
        ? rawSlug
        : rawRole;

      if (!ADMIN_PORTAL_ROLES.has(effectiveRole)) {
        const isStaffAccount = await isKnownStaffRoleSlug(effectiveRole);
        await logSecurityEvent(
          isStaffAccount ? 'ADMIN_LOGIN_DENIED_STAFF_PORTAL' : 'ADMIN_LOGIN_DENIED_NON_ADMIN',
          {
            userId: userRecord.id,
            userEmail: email,
            actorRole: effectiveRole,
            ipAddress: clientIp,
          }
        ).catch(() => {});

        if (isStaffAccount) {
          sendJson(res, 403, {
            success: false,
            code: 'STAFF_PORTAL_REQUIRED',
            message: 'Staff accounts cannot sign in on the Admin Portal. Please use the dedicated Staff Portal (/mystaff).',
          });
          return true;
        }

        sendJson(res, 403, {
          success: false,
          code: 'ADMIN_ROLE_REQUIRED',
          message: 'Access Denied: This login portal (/myadmin) is restricted to authorized administrators only.',
        });
        return true;
      }

      if (isDatabaseAvailable()) {
        try {
          await query(
            `UPDATE public.app_users
             SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW(), last_login_ip = $1
             WHERE id = $2`,
            [clientIp, userRecord.id]
          );
        } catch {}
      } else {
        await sbRestRequest(`app_users?id=eq.${encodeURIComponent(userRecord.id)}`, {
          method: 'PATCH',
          body: {
            failed_login_attempts: 0,
            locked_until: null,
            last_login_at: new Date().toISOString(),
            last_login_ip: clientIp,
          },
        }).catch(() => {});
      }

      const replaceSessionId =
        typeof body.replaceSessionId === 'string' && body.replaceSessionId.trim()
          ? body.replaceSessionId.trim()
          : undefined;

      let session;
      try {
        session = await createSession(userRecord.id, {
          rememberMe,
          userAgent,
          ipAddress: clientIp,
          user: { role: effectiveRole, email },
          replaceSessionId,
        });
      } catch (sessionErr: any) {
        if (sessionErr instanceof SessionLimitError) {
          await logSecurityEvent('ADMIN_LOGIN_BLOCKED_MAX_SESSIONS', {
            userId: userRecord.id,
            userEmail: email,
            actorRole: effectiveRole,
            ipAddress: clientIp,
          }).catch(() => {});
          sendJson(res, 409, {
            success: false,
            code: sessionErr.code,
            message: sessionErr.message,
            maxSessions: sessionErr.maxSessions,
            activeSessions: sessionErr.activeSessions,
          });
          return true;
        }
        throw sessionErr;
      }
      const sessionToken = session.sessionToken;
      const expiresAt = session.expiresAt;

      setSessionCookie(res, sessionToken, expiresAt);
      await resetRateLimitAsync(`admin_login:ip:${clientIp}`);
      await resetRateLimitAsync(`admin_login:account:${email}`);

      const sanitizedUser = sanitizeUserOutput({
        ...userRecord,
        role: effectiveRole as any,
      });

      await logSecurityEvent('ADMIN_LOGIN_SUCCESS', {
        userId: userRecord.id,
        userEmail: email,
        actorRole: effectiveRole,
        ipAddress: clientIp,
      }).catch(() => {});

      sendJson(res, 200, {
        success: true,
        message: 'Administrator authenticated successfully.',
        user: sanitizedUser,
        sessionToken,
      });
      return true;
    }

    // ---------------------------------------------------------
    // 0B. DEDICATED STAFF LOGIN: POST /api/staff/auth/login
    // Strictly separates Staff accounts (support, analyst, custom staff roles) from Admin & User logins.
    // ---------------------------------------------------------
    if (pathname === '/api/staff/auth/login' && method === 'POST') {
      const maintCheck = await getMaintenanceSettings().catch(() => ({ isEnabled: false, allowStaffAccessDuringMaintenance: true } as any));
      if (maintCheck?.isEnabled && maintCheck?.allowStaffAccessDuringMaintenance === false) {
        sendJson(res, 503, {
          success: false,
          code: 'MAINTENANCE_MODE',
          maintenance: true,
          message:
            maintCheck.message ||
            'Platform maintenance is active and staff access is temporarily paused.',
          expectedRestoration: maintCheck.expectedRestoration,
        });
        return true;
      }

      const body = await parseJsonBody(req);
      const email = normalizeEmail(body.email || '');
      const password = String(body.password || '');
      const rememberMe = Boolean(body.rememberMe);

      const rateIp = await checkRateLimitAsync(`staff_login:ip:${clientIp}`, RATE_LIMITS.ADMIN_LOGIN_IP.max, RATE_LIMITS.ADMIN_LOGIN_IP.windowMs, RATE_LIMITS.ADMIN_LOGIN_IP.op);
      if (!rateIp.allowed) {
        sendRateLimitExceeded(res, rateIp);
        return true;
      }

      if (email) {
        const rateAcct = await checkRateLimitAsync(`staff_login:account:${email}`, RATE_LIMITS.ADMIN_LOGIN_ACCOUNT.max, RATE_LIMITS.ADMIN_LOGIN_ACCOUNT.windowMs, RATE_LIMITS.ADMIN_LOGIN_ACCOUNT.op);
        if (!rateAcct.allowed) {
          sendRateLimitExceeded(res, rateAcct);
          return true;
        }
      }

      if (!email || !password) {
        sendJson(res, 400, { success: false, message: 'Staff email and password are required.' });
        return true;
      }

      const ADMIN_PORTAL_ROLES = new Set(['superadmin', 'admin']);
      const BUILTIN_STAFF_ROLES = new Set(['support', 'analyst']);
      const isMasterAdminEmail = (addr: string) =>
        addr === 'hackifypro@gmail.com' || addr === 'admin@mymoney.com';

      let userRecord: any = null;
      if (isDatabaseAvailable()) {
        try {
          const userRes = await query('SELECT * FROM public.app_users WHERE LOWER(email) = $1 LIMIT 1', [email]);
          if (userRes.rows.length > 0) userRecord = userRes.rows[0];
        } catch {}
      }

      if (!userRecord) {
        const sbRes = await sbRestRequest<any[]>(
          `app_users?email=ilike.${encodeURIComponent(email)}&select=*&limit=1`
        );
        if (sbRes.ok && Array.isArray(sbRes.data) && sbRes.data.length > 0) {
          userRecord = sbRes.data[0];
        }
      }

      if (!userRecord) {
        await logSecurityEvent('STAFF_LOGIN_FAILED_UNKNOWN', { userEmail: email, ipAddress: clientIp }).catch(() => {});
        sendJson(res, 401, { success: false, message: 'Invalid staff credentials.' });
        return true;
      }

      if (userRecord.locked_until && new Date(userRecord.locked_until) > new Date()) {
        const remainingMin = Math.ceil((new Date(userRecord.locked_until).getTime() - Date.now()) / 60000);
        sendJson(res, 429, {
          success: false,
          message: `Staff account is temporarily locked. Try again in ${remainingMin} minute(s).`,
        });
        return true;
      }

      if (userRecord.status === 'suspended' || userRecord.status === 'deactivated') {
        sendJson(res, 403, {
          success: false,
          message: `This staff account is ${userRecord.status}. Sign-in blocked.`,
        });
        return true;
      }

      const isValid = await verifyPassword(password, userRecord.password_hash);
      if (!isValid) {
        if (isDatabaseAvailable()) {
          const attempts = (userRecord.failed_login_attempts || 0) + 1;
          const lockSql =
            attempts >= 5
              ? "UPDATE public.app_users SET failed_login_attempts = $1, locked_until = NOW() + INTERVAL '15 minutes' WHERE id = $2"
              : 'UPDATE public.app_users SET failed_login_attempts = $1 WHERE id = $2';
          await query(lockSql, [attempts, userRecord.id]).catch(() => {});
        }
        await logSecurityEvent('STAFF_LOGIN_FAILED_PASSWORD', {
          userId: userRecord.id,
          userEmail: email,
          ipAddress: clientIp,
        }).catch(() => {});
        sendJson(res, 401, { success: false, message: 'Invalid staff credentials.' });
        return true;
      }

      const rawRole = String(userRecord.role || 'user').toLowerCase().trim();
      const rawSlug = String(userRecord.role_slug || '').toLowerCase().trim();
      const effectiveRoleSlug = rawSlug && rawSlug !== 'user' ? rawSlug : rawRole;

      // Reject pure Admin / Super Admin accounts from Staff Login
      if (isMasterAdminEmail(email) || ADMIN_PORTAL_ROLES.has(rawRole) || ADMIN_PORTAL_ROLES.has(rawSlug)) {
        await logSecurityEvent('STAFF_LOGIN_DENIED_ADMIN_PORTAL', {
          userId: userRecord.id,
          userEmail: email,
          actorRole: effectiveRoleSlug,
          ipAddress: clientIp,
        }).catch(() => {});
        sendJson(res, 403, {
          success: false,
          code: 'ADMIN_PORTAL_REQUIRED',
          message: 'Administrator accounts must sign in through the dedicated Admin Portal (/myadmin).',
        });
        return true;
      }

      let isAuthorizedStaff =
        BUILTIN_STAFF_ROLES.has(rawRole) || BUILTIN_STAFF_ROLES.has(rawSlug);
      if (!isAuthorizedStaff && effectiveRoleSlug && effectiveRoleSlug !== 'user' && effectiveRoleSlug !== 'anonymous') {
        if (isDatabaseAvailable()) {
          try {
            const roleRes = await query('SELECT slug FROM public.admin_roles WHERE LOWER(slug) = $1 LIMIT 1', [effectiveRoleSlug]);
            if (roleRes.rows.length > 0) isAuthorizedStaff = true;
          } catch {}
        }
        if (!isAuthorizedStaff) {
          try {
            const fallbackRoles = await listAdminRolesFallback();
            if (fallbackRoles.some((r: any) => String(r.slug || '').toLowerCase().trim() === effectiveRoleSlug)) {
              isAuthorizedStaff = true;
            }
          } catch {}
        }
      }

      if (!isAuthorizedStaff) {
        await logSecurityEvent('STAFF_LOGIN_DENIED_NON_STAFF', {
          userId: userRecord.id,
          userEmail: email,
          actorRole: effectiveRoleSlug,
          ipAddress: clientIp,
        }).catch(() => {});
        sendJson(res, 403, {
          success: false,
          code: 'STAFF_ROLE_REQUIRED',
          message: 'Access Denied: This login portal (/mystaff) is restricted to authorized My Money Manager staff only.',
        });
        return true;
      }

      if (isDatabaseAvailable()) {
        try {
          await query(
            `UPDATE public.app_users
             SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW(), last_login_ip = $1
             WHERE id = $2`,
            [clientIp, userRecord.id]
          );
        } catch {}
      } else {
        await sbRestRequest(`app_users?id=eq.${encodeURIComponent(userRecord.id)}`, {
          method: 'PATCH',
          body: {
            failed_login_attempts: 0,
            locked_until: null,
            last_login_at: new Date().toISOString(),
            last_login_ip: clientIp,
          },
        }).catch(() => {});
      }

      const replaceSessionId =
        typeof body.replaceSessionId === 'string' && body.replaceSessionId.trim()
          ? body.replaceSessionId.trim()
          : undefined;

      let session;
      try {
        session = await createSession(userRecord.id, {
          rememberMe,
          userAgent,
          ipAddress: clientIp,
          user: { role: effectiveRoleSlug, email },
          replaceSessionId,
        });
      } catch (sessionErr: any) {
        if (sessionErr instanceof SessionLimitError) {
          await logSecurityEvent('STAFF_LOGIN_BLOCKED_MAX_SESSIONS', {
            userId: userRecord.id,
            userEmail: email,
            actorRole: effectiveRoleSlug,
            ipAddress: clientIp,
          }).catch(() => {});
          sendJson(res, 409, {
            success: false,
            code: sessionErr.code,
            message: sessionErr.message,
            maxSessions: sessionErr.maxSessions,
            activeSessions: sessionErr.activeSessions,
          });
          return true;
        }
        throw sessionErr;
      }

      setSessionCookie(res, session.sessionToken, session.expiresAt);
      await resetRateLimitAsync(`staff_login:ip:${clientIp}`);
      await resetRateLimitAsync(`staff_login:account:${email}`);

      const sanitizedUser = sanitizeUserOutput({
        ...userRecord,
        role: rawRole as any,
        role_slug: effectiveRoleSlug,
      });

      await logSecurityEvent('STAFF_LOGIN_SUCCESS', {
        userId: userRecord.id,
        userEmail: email,
        actorRole: effectiveRoleSlug,
        ipAddress: clientIp,
      }).catch(() => {});

      sendJson(res, 200, {
        success: true,
        message: 'Staff member authenticated successfully.',
        user: sanitizedUser,
        sessionToken: session.sessionToken,
      });
      return true;
    }

    // ---------------------------------------------------------
    // 0. ADMIN CONTROL CENTER DISPATCH (RBAC Protected — Always accessible during Maintenance Mode)
    // ---------------------------------------------------------
    if (pathname.startsWith('/api/admin/')) {
      const handled = await handleAdminApiRequest(req, res, pathname, method);
      if (handled) return true;
    }

    // ---------------------------------------------------------
    // MAINTENANCE MODE API GUARD
    // Blocks non-admin access when Maintenance Mode is ON.
    // Staff bypass is controlled by maint.allowStaffAccessDuringMaintenance (superadmin/admin always bypass).
    // ---------------------------------------------------------
    const isMaintenanceExemptPath =
      pathname === '/api/health' ||
      pathname === '/api/public/site-config' ||
      pathname === '/api/public/site-config/stream' ||
      pathname.startsWith('/api/branding/assets/') ||
      pathname.startsWith('/api/pwa/') ||
      pathname === '/api/robots.txt' ||
      pathname === '/api/sitemap.xml' ||
      pathname === '/robots.txt' ||
      pathname === '/sitemap.xml' ||
      pathname.startsWith('/api/admin/') ||
      pathname === '/api/staff/auth/login' ||
      pathname === '/api/auth/me' ||
      pathname === '/api/auth/logout' ||
      pathname === '/api/auth/logout-all-devices';

    if (!isMaintenanceExemptPath && (await isMaintenanceModeEnabled())) {
      const maint = await getMaintenanceSettings();
      const reqUser = await authenticateRequest(req);
      const reqEmail = (reqUser?.email || '').toLowerCase().trim();
      const reqRole = (reqUser?.role || '').toLowerCase().trim();
      const reqSlug = (reqUser?.role_slug || '').toLowerCase().trim();
      const isPureAdmin = Boolean(
        reqUser &&
          (reqEmail === 'hackifypro@gmail.com' ||
            reqEmail === 'admin@mymoney.com' ||
            ['superadmin', 'admin'].includes(reqRole) ||
            ['superadmin', 'admin'].includes(reqSlug))
      );
      const isStaffMember = Boolean(
        reqUser &&
          !isPureAdmin &&
          (['support', 'analyst'].includes(reqRole) ||
            (reqSlug && reqSlug !== 'user' && reqSlug !== 'anonymous'))
      );
      const canBypass =
        isPureAdmin || (isStaffMember && maint.allowStaffAccessDuringMaintenance !== false);
      if (!canBypass) {
        sendJson(res, 503, {
          success: false,
          code: 'MAINTENANCE_MODE',
          maintenance: true,
          message:
            maint.message ||
            'Platform is currently undergoing scheduled maintenance. Please check back shortly.',
          expectedRestoration: maint.expectedRestoration,
        });
        return true;
      }
    }

    // ---------------------------------------------------------
    // 0A-2. DEDICATED STAFF PORTAL ENDPOINTS: /api/staff/*
    // Strictly isolated to verified staff accounts (support, analyst, custom staff roles).
    // Normal users and unauthenticated callers are denied with 401/403.
    // ---------------------------------------------------------
    if (pathname.startsWith('/api/staff/')) {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Staff authentication required.' });
        return true;
      }
      const staffRole = String(authUser.role || 'user').toLowerCase().trim();
      const staffSlug = String(authUser.role_slug || '').toLowerCase().trim();
      const effectiveStaffRole = staffSlug && staffSlug !== 'user' ? staffSlug : staffRole;
      const isMaster =
        (authUser.email || '').toLowerCase().trim() === 'hackifypro@gmail.com' ||
        (authUser.email || '').toLowerCase().trim() === 'admin@mymoney.com';

      let isVerifiedStaff =
        !isMaster &&
        !['superadmin', 'admin'].includes(effectiveStaffRole) &&
        (['support', 'analyst'].includes(staffRole) ||
          ['support', 'analyst'].includes(staffSlug));

      if (!isVerifiedStaff && !isMaster && !['superadmin', 'admin'].includes(effectiveStaffRole) && effectiveStaffRole !== 'user' && effectiveStaffRole !== 'anonymous') {
        try {
          const fbRoles = await listAdminRolesFallback();
          if (fbRoles.some((r: any) => String(r.slug || '').toLowerCase().trim() === effectiveStaffRole)) {
            isVerifiedStaff = true;
          }
        } catch {}
        if (!isVerifiedStaff && isDatabaseAvailable()) {
          try {
            const roleCheck = await query('SELECT slug FROM public.admin_roles WHERE LOWER(slug) = $1 LIMIT 1', [effectiveStaffRole]);
            if (roleCheck.rows.length > 0) isVerifiedStaff = true;
          } catch {}
        }
      }

      const allowReadForSuperadmin = ['superadmin', 'admin'].includes(effectiveStaffRole) || isMaster;
      if (!isVerifiedStaff && !allowReadForSuperadmin) {
        sendJson(res, 403, {
          success: false,
          code: 'STAFF_ROLE_REQUIRED',
          message: 'Access Denied: Staff role authorization required for /api/staff/* endpoints.',
        });
        return true;
      }

      if (pathname === '/api/staff/tasks' && method === 'GET') {
        const parsed = parseUrl(req.url || '', true);
        const status = typeof parsed.query.status === 'string' ? parsed.query.status : undefined;
        const tasks = await listStaffTasks({ assignedTo: allowReadForSuperadmin ? undefined : authUser.id, status });
        const allForCounts = await listStaffTasks({ assignedTo: allowReadForSuperadmin ? undefined : authUser.id });
        const counts = {
          total: allForCounts.length,
          open: allForCounts.filter((t) => t.status === 'open').length,
          in_progress: allForCounts.filter((t) => t.status === 'in_progress').length,
          completed: allForCounts.filter((t) => t.status === 'completed').length,
          blocked: allForCounts.filter((t) => t.status === 'blocked').length,
        };
        sendJson(res, 200, { success: true, tasks, counts });
        return true;
      }

      const staffTaskPatchMatch = pathname.match(/^\/api\/staff\/tasks\/([a-zA-Z0-9_-]+)$/);
      if (staffTaskPatchMatch && (method === 'PATCH' || method === 'PUT')) {
        const taskId = staffTaskPatchMatch[1];
        const body = await parseJsonBody(req);
        const allowedStatuses = new Set(['open', 'in_progress', 'completed', 'blocked']);
        if (!body.status || !allowedStatuses.has(String(body.status))) {
          sendJson(res, 400, {
            success: false,
            message: 'Staff members can only update task status to open, in_progress, completed, or blocked.',
          });
          return true;
        }
        const visibleTasks = await listStaffTasks({ assignedTo: allowReadForSuperadmin ? undefined : authUser.id });
        const existingTask = visibleTasks.find((t) => t.id === taskId);
        if (!existingTask) {
          sendJson(res, 404, { success: false, message: 'Assigned task not found for your staff account.' });
          return true;
        }
        const updated = await updateStaffTask(taskId, {
          status: body.status,
        });
        await logSecurityEvent('STAFF_TASK_STATUS_UPDATED', {
          userId: authUser.id,
          userEmail: authUser.email,
          actorRole: effectiveStaffRole,
          ipAddress: clientIp,
          details: { taskId, newStatus: body.status },
        }).catch(() => {});
        sendJson(res, 200, { success: true, message: 'Task status updated.', task: updated });
        return true;
      }

      if (pathname === '/api/staff/notifications' && method === 'GET') {
        const notifications = await getStaffNotifications(authUser.id, 60);
        const unreadCount = notifications.filter((n) => !n.is_read).length;
        sendJson(res, 200, { success: true, notifications, unreadCount });
        return true;
      }

      const staffNotifReadMatch = pathname.match(/^\/api\/staff\/notifications\/([a-zA-Z0-9_-]+)\/read$/);
      if (staffNotifReadMatch && method === 'POST') {
        await markStaffNotificationRead(staffNotifReadMatch[1], authUser.id);
        sendJson(res, 200, { success: true, message: 'Notification marked as read.' });
        return true;
      }

      if (pathname === '/api/staff/notifications/read-all' && method === 'POST') {
        await markAllStaffNotificationsRead(authUser.id);
        sendJson(res, 200, { success: true, message: 'All staff notifications marked as read.' });
        return true;
      }

      if (pathname === '/api/staff/profile' && method === 'GET') {
        sendJson(res, 200, {
          success: true,
          staff: sanitizeUserOutput(authUser),
          portalRole: effectiveStaffRole,
        });
        return true;
      }
    }

    // All /api/auth/* and /api/profile* routes support direct PostgreSQL with native Supabase HTTPS REST fallback.

    // ---------------------------------------------------------
    // 0B. AI & FINANCIAL INTELLIGENCE DISPATCH (Auth Protected)
    // ---------------------------------------------------------
    if (pathname.startsWith('/api/ai/') || pathname.startsWith('/api/finance/')) {
      const handled = await handleAiFinanceRequest(req, res, pathname, method);
      if (handled) return true;
    }

    // ---------------------------------------------------------
    // 0C. AUTOMATIC UPI PAYMENT DETECTION DISPATCH (Auth Protected)
    // ---------------------------------------------------------
    if (pathname.startsWith('/api/upi-detection')) {
      const handled = await handleUpiDetectionRequest(req, res, pathname, method);
      if (handled) return true;
    }

    // ---------------------------------------------------------
    // 0D. UPI QR PROFILES, UNIFIED AUTH (GOOGLE / PASSKEY), COMPLETE PROFILE
    // ---------------------------------------------------------
    if (
      pathname === '/api/upi/profile' ||
      pathname === '/api/profile/complete' ||
      pathname === '/api/profile/security-methods' ||
      pathname.startsWith('/api/auth/google') ||
      pathname.startsWith('/api/auth/passkey')
    ) {
      const handled = await handleUserAccountExtensions(req, res, pathname, method, clientIp, userAgent);
      if (handled) return true;
    }

    // ---------------------------------------------------------
    // 1. REGISTER: POST /api/auth/register
    // ---------------------------------------------------------
    if (pathname === '/api/auth/register' && method === 'POST') {
      const siteCfg = await getPublishedSiteConfig().catch(() => null);
      if (siteCfg && siteCfg.loginSettings.allowRegistration === false) {
        sendJson(res, 403, {
          success: false,
          code: 'REGISTRATION_DISABLED',
          message: 'New user registration is currently disabled by an administrator.',
        });
        return true;
      }

      const rate = await checkRateLimitAsync(`signup:ip:${clientIp}`, RATE_LIMITS.SIGNUP_IP.max, RATE_LIMITS.SIGNUP_IP.windowMs, RATE_LIMITS.SIGNUP_IP.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
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

      // Duplicate email check (PostgreSQL primary with Supabase REST fallback)
      let emailExists = false;
      if (isDatabaseAvailable()) {
        try {
          const dup = await query('SELECT id FROM public.app_users WHERE LOWER(email) = $1', [email]);
          emailExists = dup.rows.length > 0;
        } catch (err: any) {
          console.warn('[Register] PG duplicate check failed, falling back to Supabase REST:', err?.message);
          const dupRest = await sbRestRequest<any[]>(
            `app_users?email=ilike.${encodeURIComponent(email)}&select=id&limit=1`
          );
          emailExists = Boolean(dupRest.ok && Array.isArray(dupRest.data) && dupRest.data.length > 0);
        }
      } else {
        const dupRest = await sbRestRequest<any[]>(
          `app_users?email=ilike.${encodeURIComponent(email)}&select=id&limit=1`
        );
        emailExists = Boolean(dupRest.ok && Array.isArray(dupRest.data) && dupRest.data.length > 0);
      }

      if (emailExists) {
        sendJson(res, 409, {
          success: false,
          message: 'An account with this email address already exists. Please log in or reset your password.',
        });
        return true;
      }

      // Hash password with bcrypt (12 rounds)
      const passwordHash = await hashPassword(password);

      const requireProfileCompletion = body.requireProfileCompletion === true;
      const initialCustomPermissions = requireProfileCompletion ? { __profile_completed: false } : {};

      // Default role is strictly 'user' from backend authority
      let newUser: any = null;
      if (isDatabaseAvailable()) {
        try {
          const userRes = await query(
            `INSERT INTO public.app_users (
              full_name, email, phone, password_hash, role, status, email_verified, custom_permissions
            ) VALUES ($1, $2, $3, $4, 'user', 'active', FALSE, $5::jsonb)
            RETURNING *`,
            [fullName, email, phone || null, passwordHash, JSON.stringify(initialCustomPermissions)]
          );
          newUser = userRes.rows[0] || null;
        } catch (err: any) {
          console.warn('[Register] PG insert failed, attempting Supabase REST:', err?.message);
        }
      }

      if (!newUser) {
        const insertRest = await sbRestRequest<any[]>('app_users', {
          method: 'POST',
          prefer: 'return=representation',
          body: {
            full_name: fullName,
            email,
            phone: phone || null,
            password_hash: passwordHash,
            role: 'user',
            status: 'active',
            email_verified: false,
            custom_permissions: initialCustomPermissions,
          },
        });
        if (!insertRest.ok || !Array.isArray(insertRest.data) || !insertRest.data[0]) {
          const errMsg = insertRest.error || 'Could not create your account right now. Please try again.';
          const isDup = String(errMsg).toLowerCase().includes('duplicate') || insertRest.status === 409;
          sendJson(res, isDup ? 409 : 503, {
            success: false,
            message: isDup
              ? 'An account with this email address already exists. Please log in or reset your password.'
              : errMsg,
          });
          return true;
        }
        newUser = insertRest.data[0];
      }

      // Create server-verified session (PG -> Supabase REST user_sessions -> HMAC-SHA256 fallback)
      const session = await createSession(newUser.id, {
        userAgent,
        ipAddress: clientIp,
        user: { role: 'user', email },
      });
      setSessionCookie(res, session.sessionToken, session.expiresAt);

      // Immediately deliver in-app welcome notification & dispatch welcome email via SMTP
      await dispatchNewUserWelcomeNotification({
        userId: newUser.id,
        fullName: newUser.full_name,
        email,
        provider: 'email',
      }).catch((err) => {
        console.error('[Welcome In-App Notification Error]:', err);
      });

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
      }).catch(() => {});

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
      const siteCfg = await getPublishedSiteConfig().catch(() => null);
      if (siteCfg && siteCfg.loginSettings.allowLogin === false) {
        sendJson(res, 403, {
          success: false,
          code: 'LOGIN_DISABLED',
          message: 'User login is temporarily paused by an administrator. Please check back shortly.',
        });
        return true;
      }

      const body = await parseJsonBody(req);
      const email = normalizeEmail(body.email || '');
      const password = body.password || '';
      const rememberMe = Boolean(body.rememberMe);

      // Rate limiting: 15 attempts / 15m per IP & Device; 5 attempts / 15m per account
      const [rateIp, rateDev] = await Promise.all([
        checkRateLimitAsync(`login:ip:${clientIp}`, RATE_LIMITS.LOGIN_IP.max, RATE_LIMITS.LOGIN_IP.windowMs, RATE_LIMITS.LOGIN_IP.op),
        checkRateLimitAsync(`login:device:${deviceId}`, RATE_LIMITS.LOGIN_IP.max, RATE_LIMITS.LOGIN_IP.windowMs, RATE_LIMITS.LOGIN_IP.op),
      ]);
      if (!rateIp.allowed || !rateDev.allowed) {
        const violated = !rateIp.allowed ? rateIp : rateDev;
        const restr = await recordViolationAndMaybeRestrictAsync({
          dimension: 'ip_device',
          identifier: `${clientIp}:${deviceId}`,
          reason: 'auth.login.burst',
          threshold: 2,
          metadata: { email: email || undefined },
        });
        sendRateLimitExceeded(res, { ...violated, violationLevel: restr?.violationLevel });
        return true;
      }

      if (email) {
        const rateAcct = await checkRateLimitAsync(`login:account:${email}`, RATE_LIMITS.LOGIN_ACCOUNT.max, RATE_LIMITS.LOGIN_ACCOUNT.windowMs, RATE_LIMITS.LOGIN_ACCOUNT.op);
        if (!rateAcct.allowed) {
          const restr = await recordViolationAndMaybeRestrictAsync({
            dimension: 'ip_device',
            identifier: `${clientIp}:${deviceId}`,
            reason: 'auth.login.account_burst',
            threshold: 2,
            metadata: { email },
          });
          sendRateLimitExceeded(res, { ...rateAcct, violationLevel: restr?.violationLevel });
          return true;
        }
      }

      if (!email || !password) {
        sendJson(res, 400, { success: false, message: 'Email and password are required.' });
        return true;
      }

      // Query user (PostgreSQL primary with Supabase REST fallback)
      let user: any = null;
      if (isDatabaseAvailable()) {
        try {
          const userRes = await query('SELECT * FROM public.app_users WHERE LOWER(email) = $1', [email]);
          if (userRes.rows.length > 0) user = userRes.rows[0];
        } catch (err: any) {
          console.warn('[Login] PG lookup failed, attempting Supabase REST:', err?.message);
        }
      }

      if (!user) {
        const restUser = await sbRestRequest<any[]>(
          `app_users?email=ilike.${encodeURIComponent(email)}&select=*&limit=1`
        );
        if (restUser.ok && Array.isArray(restUser.data) && restUser.data.length > 0) {
          user = restUser.data[0];
        }
      }

      if (!user) {
        await logSecurityEvent('LOGIN_FAILED_UNKNOWN_EMAIL', { userEmail: email, ipAddress: clientIp }).catch(() => {});
        sendJson(res, 401, { success: false, message: 'Invalid email or password.' });
        return true;
      }

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
        await logSecurityEvent('LOGIN_BLOCKED_SUSPENDED', { userId: user.id, userEmail: email, ipAddress: clientIp }).catch(() => {});
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
        const lockUntilIso = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
        if (isDatabaseAvailable()) {
          let lockSql = 'UPDATE public.app_users SET failed_login_attempts = $1 WHERE id = $2';
          if (attempts >= 5) {
            lockSql = "UPDATE public.app_users SET failed_login_attempts = $1, locked_until = NOW() + INTERVAL '15 minutes' WHERE id = $2";
          }
          await query(lockSql, [attempts, user.id]).catch(() => {});
        } else {
          await sbRestRequest(`app_users?id=eq.${encodeURIComponent(user.id)}`, {
            method: 'PATCH',
            body: lockUntilIso
              ? { failed_login_attempts: attempts, locked_until: lockUntilIso }
              : { failed_login_attempts: attempts },
          }).catch(() => {});
        }

        await recordViolationAndMaybeRestrictAsync({
          dimension: 'ip_device',
          identifier: `${clientIp}:${deviceId}`,
          reason: 'auth.login.bad_password',
          threshold: 5,
          metadata: { userId: user.id, email },
        });
        await logSecurityEvent('LOGIN_FAILED_BAD_PASSWORD', { userId: user.id, userEmail: email, ipAddress: clientIp }).catch(() => {});
        sendJson(res, 401, { success: false, message: 'Invalid email or password.' });
        return true;
      }

      // Reset failed login attempts and update last login
      if (isDatabaseAvailable()) {
        await query(
          `UPDATE public.app_users 
           SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW(), last_login_ip = $1 
           WHERE id = $2`,
          [clientIp, user.id]
        ).catch(() => {});
      } else {
        await sbRestRequest(`app_users?id=eq.${encodeURIComponent(user.id)}`, {
          method: 'PATCH',
          body: {
            failed_login_attempts: 0,
            locked_until: null,
            last_login_at: new Date().toISOString(),
            last_login_ip: clientIp,
          },
        }).catch(() => {});
      }

      // Create server-verified session (PG -> Supabase REST user_sessions -> HMAC-SHA256 fallback)
      const replaceSessionId =
        typeof body.replaceSessionId === 'string' && body.replaceSessionId.trim()
          ? body.replaceSessionId.trim()
          : undefined;

      let session;
      try {
        session = await createSession(user.id, {
          rememberMe,
          userAgent,
          ipAddress: clientIp,
          user: { role: user.role, email },
          replaceSessionId,
        });
      } catch (sessionErr: any) {
        if (sessionErr instanceof SessionLimitError) {
          await logSecurityEvent('LOGIN_BLOCKED_MAX_SESSIONS', {
            userId: user.id,
            userEmail: email,
            actorRole: user.role,
            ipAddress: clientIp,
          }).catch(() => {});
          sendJson(res, 409, {
            success: false,
            code: sessionErr.code,
            message: sessionErr.message,
            maxSessions: sessionErr.maxSessions,
            activeSessions: sessionErr.activeSessions,
          });
          return true;
        }
        throw sessionErr;
      }
      setSessionCookie(res, session.sessionToken, session.expiresAt);

      await resetRateLimitAsync(`login:ip:${clientIp}`);
      await resetRateLimitAsync(`login:account:${email}`);

      await logSecurityEvent('USER_LOGIN_SUCCESS', {
        userId: user.id,
        userEmail: email,
        actorRole: user.role,
        ipAddress: clientIp,
      }).catch(() => {});

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
      const token = extractSessionToken(req);
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
    // 4A. LIST ACTIVE SESSIONS: GET /api/auth/sessions
    // ---------------------------------------------------------
    if (pathname === '/api/auth/sessions' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const token = extractSessionToken(req);
      const sessions = await listActiveSessionsForUser(authUser.id, token);
      sendJson(res, 200, {
        success: true,
        maxSessions: MAX_ACTIVE_SESSIONS,
        activeCount: sessions.length,
        sessions,
      });
      return true;
    }

    // ---------------------------------------------------------
    // 4B. REVOKE SINGLE SESSION (REMOTE LOGOUT): DELETE /api/auth/sessions/:id
    // ---------------------------------------------------------
    if (pathname.startsWith('/api/auth/sessions/') && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const sessionId = decodeURIComponent(pathname.slice('/api/auth/sessions/'.length)).trim();
      if (!sessionId || !/^[a-zA-Z0-9_-]{4,100}$/.test(sessionId)) {
        sendJson(res, 400, { success: false, message: 'Invalid session ID.' });
        return true;
      }

      const token = extractSessionToken(req);
      const beforeSessions = await listActiveSessionsForUser(authUser.id, token);
      const targetSession = beforeSessions.find((s) => s.id === sessionId);
      if (!targetSession) {
        sendJson(res, 404, { success: false, message: 'Active session not found.' });
        return true;
      }

      const revoked = await revokeUserSessionById(authUser.id, sessionId);
      if (!revoked) {
        sendJson(res, 404, { success: false, message: 'Active session not found or already logged out.' });
        return true;
      }

      if (targetSession.isCurrent) {
        clearSessionCookie(res);
      }

      await logSecurityEvent('USER_SESSION_REVOKED', {
        userId: authUser.id,
        userEmail: authUser.email,
        ipAddress: clientIp,
        metadata: {
          revokedSessionId: sessionId,
          deviceName: targetSession.deviceName,
          revokedCurrent: targetSession.isCurrent,
        },
      }).catch(() => {});

      const remaining = await listActiveSessionsForUser(authUser.id, targetSession.isCurrent ? null : token);
      sendJson(res, 200, {
        success: true,
        message: targetSession.isCurrent
          ? 'Current session logged out successfully.'
          : `${targetSession.deviceName} has been logged out remotely.`,
        revokedCurrent: targetSession.isCurrent,
        maxSessions: MAX_ACTIVE_SESSIONS,
        activeCount: remaining.length,
        sessions: remaining,
      });
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

        let activeSessionsCount = 1;
        try {
          const activeList = await listActiveSessionsForUser(authUser.id, extractSessionToken(req));
          activeSessionsCount = activeList.length || 1;
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

      const body = await parseJsonBody(req, 4 * 1024 * 1024);
      // Security: strictly allow ONLY full_name, phone, username, avatar_url — NEVER role, status, or email_verified
      const fullName = (body.fullName || body.full_name || authUser.full_name).trim();
      const phone = (body.phone !== undefined ? body.phone : authUser.phone || '').trim();
      const rawAvatarInput = body.avatarUrl !== undefined ? body.avatarUrl : authUser.avatar_url;
      const avatarCheck = validateAvatarUrlInput(rawAvatarInput);
      if (!avatarCheck.valid) {
        sendJson(res, 400, {
          success: false,
          code: 'INVALID_AVATAR_IMAGE',
          message: avatarCheck.error || 'Invalid profile photo format.',
        });
        return true;
      }
      let avatarUrl = avatarCheck.value;
      if (avatarUrl && avatarUrl.startsWith('data:')) {
        const avatarScan = await processSecureUpload({
          userId: authUser.id,
          userEmail: authUser.email,
          purpose: 'profile_avatar',
          filename: String(body.avatarFilename || 'avatar.jpg'),
          dataUrlOrRawBase64: avatarUrl,
          ipAddress: clientIp,
          allowSvg: false,
        });
        if (!avatarScan.success || !avatarScan.sanitizedDataUrl) {
          sendJson(res, avatarScan.status === 'quarantined_pending' ? 202 : 400, {
            success: false,
            code: 'INVALID_AVATAR_IMAGE',
            quarantineId: avatarScan.quarantineId,
            message: avatarScan.error || 'Uploaded profile photo failed security verification.',
          });
          return true;
        }
        avatarUrl = avatarScan.sanitizedDataUrl;
      }
      const rawUsername =
        body.username !== undefined ? String(body.username || '').trim().toLowerCase() : authUser.username || '';

      if (!fullName || fullName.length < 2 || fullName.length > 80) {
        sendJson(res, 400, { success: false, message: 'Full name must be between 2 and 80 characters.' });
        return true;
      }

      if (phone && !validatePhone(phone)) {
        sendJson(res, 400, { success: false, message: 'Please enter a valid phone number (10-15 digits).' });
        return true;
      }

      if (rawUsername && !/^[a-z0-9_]{3,30}$/.test(rawUsername)) {
        sendJson(res, 400, {
          success: false,
          message: 'Username must be 3-30 characters using lowercase letters, numbers, or underscores.',
        });
        return true;
      }

      if (rawUsername && rawUsername !== (authUser.username || '').toLowerCase()) {
        const dupUsername = await sbRestRequest<any[]>(
          `app_users?username=eq.${encodeURIComponent(rawUsername)}&id=neq.${encodeURIComponent(authUser.id)}&select=id&limit=1`
        );
        if (dupUsername.ok && Array.isArray(dupUsername.data) && dupUsername.data.length > 0) {
          sendJson(res, 409, { success: false, message: 'That username is already taken. Please choose another.' });
          return true;
        }
      }

      let updatedUser: any = null;
      if (isDatabaseAvailable()) {
        try {
          const updatedRes = await query(
            `UPDATE public.app_users 
             SET full_name = $1, phone = $2, avatar_url = $3, username = $4, updated_at = NOW() 
             WHERE id = $5 
             RETURNING *`,
            [fullName, phone || null, avatarUrl || null, rawUsername || null, authUser.id]
          );
          updatedUser = updatedRes.rows[0] || null;
        } catch (err: any) {
          console.warn('[Profile PUT] PG update failed, attempting Supabase REST:', err?.message);
        }
      }

      if (!updatedUser) {
        const restUpd = await sbRestRequest<any[]>(`app_users?id=eq.${encodeURIComponent(authUser.id)}`, {
          method: 'PATCH',
          prefer: 'return=representation',
          body: {
            full_name: fullName,
            phone: phone || null,
            avatar_url: avatarUrl || null,
            username: rawUsername || null,
            updated_at: new Date().toISOString(),
          },
        });
        if (!restUpd.ok || !Array.isArray(restUpd.data) || !restUpd.data[0]) {
          sendJson(res, 503, { success: false, message: restUpd.error || 'Failed to update profile.' });
          return true;
        }
        updatedUser = restUpd.data[0];
      }

      await logSecurityEvent('PROFILE_UPDATED', {
        userId: authUser.id,
        userEmail: authUser.email,
        ipAddress: clientIp,
      }).catch(() => {});

      sendJson(res, 200, {
        success: true,
        message: 'Profile updated successfully.',
        user: sanitizeUserOutput(updatedUser),
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
      let currentHash: string | null = null;
      if (isDatabaseAvailable()) {
        try {
          const userRes = await query('SELECT password_hash FROM public.app_users WHERE id = $1', [authUser.id]);
          currentHash = userRes.rows[0]?.password_hash || null;
        } catch {}
      }
      if (!currentHash) {
        const restUser = await sbRestRequest<any[]>(
          `app_users?id=eq.${encodeURIComponent(authUser.id)}&select=password_hash&limit=1`
        );
        currentHash = restUser.ok && Array.isArray(restUser.data) ? restUser.data[0]?.password_hash || null : null;
      }

      const isCurrentValid = currentHash ? await verifyPassword(currentPassword, currentHash) : false;
      if (!isCurrentValid) {
        await logSecurityEvent('PASSWORD_CHANGE_FAILED_WRONG_CURRENT', {
          userId: authUser.id,
          userEmail: authUser.email,
          ipAddress: clientIp,
        }).catch(() => {});
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
      const nowIso = new Date().toISOString();

      // Update password in DB or Supabase REST
      if (isDatabaseAvailable()) {
        await query(
          `UPDATE public.app_users 
           SET password_hash = $1, password_changed_at = NOW(), force_password_reset = FALSE, updated_at = NOW() 
           WHERE id = $2`,
          [newHash, authUser.id]
        );
      } else {
        const updRest = await sbRestRequest(`app_users?id=eq.${encodeURIComponent(authUser.id)}`, {
          method: 'PATCH',
          body: {
            password_hash: newHash,
            password_changed_at: nowIso,
            force_password_reset: false,
            updated_at: nowIso,
          },
        });
        if (!updRest.ok) {
          sendJson(res, 503, { success: false, message: updRest.error || 'Failed to update password.' });
          return true;
        }
      }

      // Revoke all other sessions (keep current session active)
      const currentToken = (req.headers['authorization']?.slice(7) || '').trim();
      if (currentToken && !currentToken.startsWith('mmf1.')) {
        const curHash = hashToken(currentToken);
        if (isDatabaseAvailable()) {
          await query(
            `UPDATE public.user_sessions 
             SET is_revoked = TRUE 
             WHERE user_id = $1 AND session_token_hash <> $2`,
            [authUser.id, curHash]
          ).catch(() => {});
        } else {
          await sbRestRequest(
            `user_sessions?user_id=eq.${encodeURIComponent(authUser.id)}&session_token_hash=neq.${encodeURIComponent(curHash)}`,
            {
              method: 'PATCH',
              body: { is_revoked: true },
            }
          ).catch(() => {});
        }
      }

      // Async send password changed email
      sendPasswordChangedEmail(authUser.email, authUser.full_name, clientIp).catch(() => {});

      await logSecurityEvent('PASSWORD_CHANGED_SUCCESS', {
        userId: authUser.id,
        userEmail: authUser.email,
        ipAddress: clientIp,
      }).catch(() => {});

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

      let currentHash: string | null = null;
      if (isDatabaseAvailable()) {
        try {
          const userRes = await query('SELECT password_hash FROM public.app_users WHERE id = $1', [authUser.id]);
          currentHash = userRes.rows[0]?.password_hash || null;
        } catch {}
      }
      if (!currentHash) {
        const restUser = await sbRestRequest<any[]>(
          `app_users?id=eq.${encodeURIComponent(authUser.id)}&select=password_hash&limit=1`
        );
        currentHash = restUser.ok && Array.isArray(restUser.data) ? restUser.data[0]?.password_hash || null : null;
      }

      const isCurrentValid = currentHash ? await verifyPassword(password, currentHash) : false;
      if (!isCurrentValid) {
        sendJson(res, 400, { success: false, message: 'Incorrect password. Account deletion aborted.' });
        return true;
      }

      // Delete transactions, sessions, user
      if (isDatabaseAvailable()) {
        await query('DELETE FROM public.transactions WHERE user_id = $1', [authUser.id]).catch(() => {});
        await query('DELETE FROM public.user_sessions WHERE user_id = $1', [authUser.id]).catch(() => {});
        await query('DELETE FROM public.password_resets WHERE user_id = $1', [authUser.id]).catch(() => {});
        await query('DELETE FROM public.app_users WHERE id = $1', [authUser.id]);
      } else {
        await sbRestRequest(`transactions?user_id=eq.${encodeURIComponent(authUser.id)}`, { method: 'DELETE' }).catch(() => {});
        await sbRestRequest(`user_sessions?user_id=eq.${encodeURIComponent(authUser.id)}`, { method: 'DELETE' }).catch(() => {});
        await sbRestRequest(`password_resets?user_id=eq.${encodeURIComponent(authUser.id)}`, { method: 'DELETE' }).catch(() => {});
        await sbRestRequest(`app_users?id=eq.${encodeURIComponent(authUser.id)}`, { method: 'DELETE' });
      }

      clearSessionCookie(res);

      await logSecurityEvent('ACCOUNT_DELETED_BY_USER', {
        userId: authUser.id,
        userEmail: authUser.email,
        ipAddress: clientIp,
      }).catch(() => {});

      sendJson(res, 200, { success: true, message: 'Your account and all associated data have been permanently deleted.' });
      return true;
    }

    // ---------------------------------------------------------
    // 10. FORGOT PASSWORD: POST /api/auth/forgot-password
    // ---------------------------------------------------------
    if (pathname === '/api/auth/forgot-password' && method === 'POST') {
      const rateIp = await checkRateLimitAsync(`forgot_pass:ip:${clientIp}`, RATE_LIMITS.FORGOT_PASSWORD_IP.max, RATE_LIMITS.FORGOT_PASSWORD_IP.windowMs, RATE_LIMITS.FORGOT_PASSWORD_IP.op);
      if (!rateIp.allowed) {
        sendRateLimitExceeded(res, rateIp);
        return true;
      }

      const body = await parseJsonBody(req);
      const email = normalizeEmail(body.email || '');

      if (!validateEmail(email)) {
        sendJson(res, 400, { success: false, message: 'Please provide a valid email address.' });
        return true;
      }

      const rateAcct = await checkRateLimitAsync(`forgot_pass:account:${email}`, RATE_LIMITS.FORGOT_PASSWORD_ACCOUNT.max, RATE_LIMITS.FORGOT_PASSWORD_ACCOUNT.windowMs, RATE_LIMITS.FORGOT_PASSWORD_ACCOUNT.op);
      if (!rateAcct.allowed) {
        sendRateLimitExceeded(res, rateAcct);
        return true;
      }

      let user: any = null;
      if (isDatabaseAvailable()) {
        try {
          const userRes = await query('SELECT id, full_name, email, status FROM public.app_users WHERE LOWER(email) = $1', [email]);
          if (userRes.rows.length > 0) user = userRes.rows[0];
        } catch {}
      }
      if (!user) {
        const restUser = await sbRestRequest<any[]>(
          `app_users?email=ilike.${encodeURIComponent(email)}&select=id,full_name,email,status&limit=1`
        );
        if (restUser.ok && Array.isArray(restUser.data) && restUser.data.length > 0) {
          user = restUser.data[0];
        }
      }

      // Prevent Email Enumeration: Always return identical success response
      const standardResponse = {
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.',
      };

      if (!user) {
        await logSecurityEvent('FORGOT_PASSWORD_UNKNOWN_EMAIL', { userEmail: email, ipAddress: clientIp }).catch(() => {});
        sendJson(res, 200, standardResponse);
        return true;
      }

      if (user.status !== 'active') {
        sendJson(res, 200, standardResponse);
        return true;
      }

      // Generate cryptographically secure random token (32 bytes = 64 hex chars)
      const rawToken = generateCryptoToken(32);
      const tokenHash = hashToken(rawToken);

      // Set 15-minute expiration
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      if (isDatabaseAvailable()) {
        // Invalidate any previous unused reset tokens for this user
        await query('UPDATE public.password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE', [user.id]);
        await query(
          `INSERT INTO public.password_resets (user_id, token_hash, expires_at, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5)`,
          [user.id, tokenHash, expiresAt, clientIp, userAgent]
        );
      } else {
        await sbRestRequest(
          `password_resets?user_id=eq.${encodeURIComponent(user.id)}&used=eq.false`,
          { method: 'PATCH', body: { used: true } }
        ).catch(() => {});
        await sbRestRequest('password_resets', {
          method: 'POST',
          body: {
            user_id: user.id,
            token_hash: tokenHash,
            expires_at: expiresAt.toISOString(),
            ip_address: clientIp,
            user_agent: userAgent,
            used: false,
          },
        });
      }

      const appBase = process.env.APP_BASE_URL || 'https://mymoney.nileshbarela.site';
      const resetLink = `${appBase}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

      // Dispatch real email via configured SMTP / Nodemailer transport
      const emailSent = await sendPasswordResetEmail(user.email, user.full_name, resetLink);
      if (!emailSent) {
        console.warn('[Forgot Password] SMTP delivery failed or SMTP credentials are not configured.');
        await logSecurityEvent('FORGOT_PASSWORD_SMTP_FAILED', {
          userId: user.id,
          userEmail: user.email,
          ipAddress: clientIp,
        }).catch(() => {});
      }

      await logSecurityEvent('FORGOT_PASSWORD_LINK_GENERATED', {
        userId: user.id,
        userEmail: user.email,
        ipAddress: clientIp,
        details: { emailSent },
      }).catch(() => {});

      // Strict security: Never return raw recovery URL or token in API responses
      sendJson(res, 200, standardResponse);
      return true;
    }

    // ---------------------------------------------------------
    // 11. VERIFY RESET TOKEN: POST /api/auth/verify-reset-token
    // ---------------------------------------------------------
    if (pathname === '/api/auth/verify-reset-token' && method === 'POST') {
      const rate = await checkRateLimitAsync(`verify_token:ip:${clientIp}`, RATE_LIMITS.VERIFY_RESET_TOKEN_IP.max, RATE_LIMITS.VERIFY_RESET_TOKEN_IP.windowMs, RATE_LIMITS.VERIFY_RESET_TOKEN_IP.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      const body = await parseJsonBody(req);
      const rawToken = body.token || '';

      if (!rawToken) {
        sendJson(res, 400, { valid: false, message: 'Reset token is missing.' });
        return true;
      }

      const tokenHash = hashToken(rawToken);
      let record: any = null;
      if (isDatabaseAvailable()) {
        try {
          const resDb = await query(
            `SELECT pr.id, pr.expires_at, pr.used, u.email, u.full_name
             FROM public.password_resets pr
             JOIN public.app_users u ON pr.user_id = u.id
             WHERE pr.token_hash = $1`,
            [tokenHash]
          );
          if (resDb.rows.length > 0) record = resDb.rows[0];
        } catch {}
      }
      if (!record) {
        const restPr = await sbRestRequest<any[]>(
          `password_resets?token_hash=eq.${encodeURIComponent(tokenHash)}&select=id,user_id,expires_at,used&limit=1`
        );
        if (restPr.ok && Array.isArray(restPr.data) && restPr.data[0]) {
          const prRow = restPr.data[0];
          const restU = await sbRestRequest<any[]>(
            `app_users?id=eq.${encodeURIComponent(prRow.user_id)}&select=email,full_name&limit=1`
          );
          const uRow = restU.ok && Array.isArray(restU.data) ? restU.data[0] : null;
          if (uRow) {
            record = { ...prRow, email: uRow.email, full_name: uRow.full_name };
          }
        }
      }

      if (!record) {
        sendJson(res, 200, { valid: false, message: 'Invalid reset token.' });
        return true;
      }

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
      const rateIp = await checkRateLimitAsync(`reset_pass:ip:${clientIp}`, RATE_LIMITS.PASSWORD_RESET_IP.max, RATE_LIMITS.PASSWORD_RESET_IP.windowMs, RATE_LIMITS.PASSWORD_RESET_IP.op);
      if (!rateIp.allowed) {
        sendRateLimitExceeded(res, rateIp);
        return true;
      }

      const body = await parseJsonBody(req);
      const rawToken = body.token || '';
      const newPassword = body.newPassword || '';
      const confirmPassword = body.confirmPassword || '';

      if (!rawToken) {
        sendJson(res, 400, { success: false, message: 'Reset token is required.' });
        return true;
      }

      const tokenHash = hashToken(rawToken);

      const rateSession = await checkRateLimitAsync(`reset_pass:session:${tokenHash}`, RATE_LIMITS.PASSWORD_RESET_SUBMIT.max, RATE_LIMITS.PASSWORD_RESET_SUBMIT.windowMs, RATE_LIMITS.PASSWORD_RESET_SUBMIT.op);
      if (!rateSession.allowed) {
        sendRateLimitExceeded(res, rateSession);
        return true;
      }

      let record: any = null;
      if (isDatabaseAvailable()) {
        try {
          const resDb = await query(
            `SELECT pr.id, pr.user_id, pr.expires_at, pr.used, u.email, u.full_name
             FROM public.password_resets pr
             JOIN public.app_users u ON pr.user_id = u.id
             WHERE pr.token_hash = $1`,
            [tokenHash]
          );
          if (resDb.rows.length > 0) record = resDb.rows[0];
        } catch {}
      }
      if (!record) {
        const restPr = await sbRestRequest<any[]>(
          `password_resets?token_hash=eq.${encodeURIComponent(tokenHash)}&select=id,user_id,expires_at,used&limit=1`
        );
        if (restPr.ok && Array.isArray(restPr.data) && restPr.data[0]) {
          const prRow = restPr.data[0];
          const restU = await sbRestRequest<any[]>(
            `app_users?id=eq.${encodeURIComponent(prRow.user_id)}&select=email,full_name&limit=1`
          );
          const uRow = restU.ok && Array.isArray(restU.data) ? restU.data[0] : null;
          if (uRow) {
            record = { ...prRow, email: uRow.email, full_name: uRow.full_name };
          }
        }
      }

      if (!record || record.used || new Date(record.expires_at) < new Date()) {
        sendJson(res, 400, {
          success: false,
          message: 'This reset link is invalid, expired, or has already been used. Please request a new one.',
        });
        return true;
      }

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
      const nowIso = new Date().toISOString();

      if (isDatabaseAvailable()) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Atomically claim the single-use reset token first to block concurrent reuse
          const claimRes = await client.query(
            `UPDATE public.password_resets
             SET used = TRUE, used_at = NOW()
             WHERE id = $1 AND used = FALSE AND expires_at > NOW()
             RETURNING id`,
            [record.id]
          );
          if (claimRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendJson(res, 400, {
              success: false,
              message: 'This reset link is invalid, expired, or has already been used. Please request a new one.',
            });
            return true;
          }

          await client.query(
            `UPDATE public.app_users
             SET password_hash = $1, password_changed_at = NOW(), force_password_reset = FALSE, failed_login_attempts = 0, locked_until = NULL
             WHERE id = $2`,
            [passwordHash, record.user_id]
          );
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK');
          throw txErr;
        } finally {
          client.release();
        }
      } else {
        // Atomically mark token used before updating password
        const claimRest = await sbRestRequest<any[]>(
          `password_resets?id=eq.${encodeURIComponent(record.id)}&used=eq.false`,
          {
            method: 'PATCH',
            prefer: 'return=representation',
            body: { used: true, used_at: nowIso },
          }
        );
        if (!claimRest.ok || !Array.isArray(claimRest.data) || claimRest.data.length === 0) {
          sendJson(res, 400, {
            success: false,
            message: 'This reset link is invalid, expired, or has already been used. Please request a new one.',
          });
          return true;
        }

        const updUser = await sbRestRequest(`app_users?id=eq.${encodeURIComponent(record.user_id)}`, {
          method: 'PATCH',
          body: {
            password_hash: passwordHash,
            password_changed_at: nowIso,
            force_password_reset: false,
            failed_login_attempts: 0,
            locked_until: null,
            updated_at: nowIso,
          },
        });
        if (!updUser.ok) {
          sendJson(res, 503, { success: false, message: 'Failed to update password right now. Please retry.' });
          return true;
        }
      }

      // Sync Supabase Auth password if user also has a Supabase Auth account and Admin Key is configured
      await syncSupabaseAuthPassword(record.email, newPassword).catch(() => {});

      // Invalidate all existing sessions
      await revokeAllUserSessions(record.user_id);

      // Clear any lockout / rate limits on the updated account
      await resetRateLimitAsync(`reset_pass:session:${tokenHash}`);
      await resetRateLimitAsync(`login:account:${record.email}`);

      // Dispatch confirmation email via configured SMTP
      sendPasswordChangedEmail(record.email, record.full_name, clientIp).catch(() => {});

      await logSecurityEvent('PASSWORD_RESET_SUCCESSFUL', {
        userId: record.user_id,
        userEmail: record.email,
        ipAddress: clientIp,
      }).catch(() => {});

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

      const rate = await checkRateLimitAsync(`admin_search:${authUser.id}`, RATE_LIMITS.ADMIN_USER_SEARCH.max, RATE_LIMITS.ADMIN_USER_SEARCH.windowMs, RATE_LIMITS.ADMIN_USER_SEARCH.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      // Fetch users robustly: Direct SQL (profiles + app_users) with HTTPS Supabase REST API fallback
      let users: any[] = [];
      if (isDatabaseAvailable()) {
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
      }

      // If SQL unavailable, empty, or failed, merge app_users + profiles via Supabase REST API
      if (users.length === 0) {
        try {
          const [appUsersRes, profilesRes] = await Promise.all([
            sbRestRequest<any[]>('app_users?select=*&order=created_at.desc&limit=500'),
            sbRestRequest<any[]>('profiles?select=*&order=created_at.desc&limit=500'),
          ]);

          const merged = new Map<string, any>();
          if (profilesRes.ok && Array.isArray(profilesRes.data)) {
            for (const p of profilesRes.data) {
              const key = String(p.email || p.id || '').toLowerCase();
              if (!key) continue;
              merged.set(key, {
                id: p.id,
                uid: p.id,
                fullName: p.full_name || (p.email ? p.email.split('@')[0] : 'User'),
                displayName: p.full_name || (p.email ? p.email.split('@')[0] : 'User'),
                email: p.email,
                phone: p.phone || null,
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
              });
            }
          }
          if (appUsersRes.ok && Array.isArray(appUsersRes.data)) {
            for (const u of appUsersRes.data) {
              const key = String(u.email || u.id || '').toLowerCase();
              if (!key) continue;
              const prev = merged.get(key) || {};
              merged.set(key, {
                ...prev,
                id: u.id || prev.id,
                uid: u.id || prev.uid,
                fullName: u.full_name || prev.fullName || (u.email ? u.email.split('@')[0] : 'User'),
                displayName: u.full_name || prev.displayName || (u.email ? u.email.split('@')[0] : 'User'),
                email: u.email || prev.email,
                phone: u.phone || prev.phone || null,
                role: u.role || prev.role || 'user',
                status: u.status || prev.status || 'active',
                emailVerified: u.email_verified ?? prev.emailVerified ?? true,
                forcePasswordReset: Boolean(u.force_password_reset),
                failedLoginAttempts: Number(u.failed_login_attempts || 0),
                createdAt: u.created_at || prev.createdAt,
                lastLoginAt: u.last_login_at || null,
                passwordChangedAt: u.password_changed_at || u.created_at || prev.createdAt,
                passwordStatus: 'Set (Encrypted Bcrypt Hash)',
                activeSessionsCount: prev.activeSessionsCount ?? 1,
              });
            }
          }
          users = Array.from(merged.values()).sort(
            (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
          );
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

      const rate = await checkRateLimitAsync(`admin_sensitive:${authUser.id}`, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.max, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.windowMs, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
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

      let targetUser: any = null;
      if (isDatabaseAvailable()) {
        try {
          const userRes = await query('SELECT * FROM public.app_users WHERE id = $1', [targetUserId]);
          targetUser = userRes.rows[0] || null;
        } catch {}
      }
      if (!targetUser) {
        const fbUsers = await listAllAppUsersFallback();
        targetUser = fbUsers.find((u) => u.id === targetUserId) || null;
      }

      if (!targetUser) {
        sendJson(res, 404, { success: false, message: 'User not found.' });
        return true;
      }

      if (isProtectedMasterAdminEmail(targetUser.email) && newStatus !== 'active') {
        sendJson(res, 403, { success: false, message: 'Protected master administrator account cannot be suspended or deactivated.' });
        return true;
      }

      const callerIsSuper = authUser.role === 'superadmin' || isProtectedMasterAdminEmail(authUser.email);
      if (String(targetUser.role || '').toLowerCase() === 'superadmin' && !callerIsSuper) {
        sendJson(res, 403, { success: false, message: 'Only a superadmin can modify another superadmin account.' });
        return true;
      }

      if (isDatabaseAvailable()) {
        try {
          await query('UPDATE public.app_users SET status = $1, updated_at = NOW() WHERE id = $2', [newStatus, targetUserId]);
          if (newStatus !== 'active') {
            await revokeAllUserSessions(targetUserId);
          }
        } catch {}
      }

      await sbRestRequest(`app_users?id=eq.${encodeURIComponent(targetUserId)}`, {
        method: 'PATCH',
        body: { status: newStatus, updated_at: new Date().toISOString() },
      });
      await sbRestRequest(`profiles?id=eq.${encodeURIComponent(targetUserId)}`, {
        method: 'PATCH',
        body: { status: newStatus },
      });

      // Async send email alert
      if (targetUser.email) {
        sendAccountStatusEmail(targetUser.email, targetUser.full_name || '', newStatus).catch(() => {});
      }

      if (isDatabaseAvailable()) {
        await logSecurityEvent('ADMIN_USER_STATUS_CHANGE', {
          userId: authUser.id,
          userEmail: authUser.email,
          actorRole: authUser.role,
          ipAddress: clientIp,
          details: { targetUserId, newStatus, targetEmail: targetUser.email },
        }).catch(() => {});
      }

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

      const rate = await checkRateLimitAsync(`admin_role:${authUser.id}`, RATE_LIMITS.ADMIN_ROLE_CHANGE.max, RATE_LIMITS.ADMIN_ROLE_CHANGE.windowMs, RATE_LIMITS.ADMIN_ROLE_CHANGE.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      const targetUserId = roleMatch[1];
      const body = await parseJsonBody(req);
      const newRole = String(body.role || '').trim().toLowerCase();
      const callerIsSuper = authUser.role === 'superadmin' || isProtectedMasterAdminEmail(authUser.email);
      const allowedRoles = callerIsSuper
        ? ['user', 'admin', 'support', 'analyst', 'superadmin']
        : ['user', 'admin', 'support', 'analyst'];

      if (!allowedRoles.includes(newRole)) {
        sendJson(res, newRole === 'superadmin' && !callerIsSuper ? 403 : 400, {
          success: false,
          message: newRole === 'superadmin' && !callerIsSuper
            ? 'Only a superadmin can assign superadmin privileges.'
            : 'Invalid role specified.',
        });
        return true;
      }

      if (targetUserId === authUser.id && newRole !== 'admin' && newRole !== 'superadmin') {
        sendJson(res, 400, { success: false, message: 'You cannot demote yourself from admin.' });
        return true;
      }

      let targetUser: any = null;
      if (isDatabaseAvailable()) {
        try {
          const userRes = await query('SELECT id, email, role FROM public.app_users WHERE id = $1', [targetUserId]);
          targetUser = userRes.rows[0] || null;
        } catch {}
      }
      if (!targetUser) {
        const fbUsers = await listAllAppUsersFallback();
        targetUser = fbUsers.find((u) => u.id === targetUserId) || null;
      }
      if (!targetUser) {
        sendJson(res, 404, { success: false, message: 'User not found.' });
        return true;
      }
      if (isProtectedMasterAdminEmail(targetUser.email)) {
        sendJson(res, 403, { success: false, message: 'Protected master administrator role cannot be modified.' });
        return true;
      }
      if (String(targetUser.role || '').toLowerCase() === 'superadmin' && !callerIsSuper) {
        sendJson(res, 403, { success: false, message: 'Only a superadmin can modify another superadmin account.' });
        return true;
      }

      const nextRoleSlug = newRole === 'user' ? null : newRole;
      if (isDatabaseAvailable()) {
        await query('UPDATE public.app_users SET role = $1, role_slug = $2, updated_at = NOW() WHERE id = $3', [newRole, nextRoleSlug, targetUserId]).catch(() => {});
        await revokeAllUserSessions(targetUserId).catch(() => 0);
      }
      await sbRestRequest(`app_users?id=eq.${encodeURIComponent(targetUserId)}`, {
        method: 'PATCH',
        body: { role: newRole, role_slug: nextRoleSlug, updated_at: new Date().toISOString() },
      });
      await sbRestRequest(`profiles?id=eq.${encodeURIComponent(targetUserId)}`, {
        method: 'PATCH',
        body: { role: newRole },
      });

      if (isDatabaseAvailable()) {
        await logSecurityEvent('ADMIN_USER_ROLE_CHANGE', {
          userId: authUser.id,
          actorRole: authUser.role,
          ipAddress: clientIp,
          details: { targetUserId, previousRole: targetUser.role, newRole },
        }).catch(() => {});
      }

      sendJson(res, 200, { success: true, message: `User role updated to ${newRole}. Active sessions revoked for security.` });
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

      const rate = await checkRateLimitAsync(`admin_sensitive:${authUser.id}`, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.max, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.windowMs, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      const targetUserId = resetEmailMatch[1];
      let targetUser: any = null;
      if (isDatabaseAvailable()) {
        try {
          const userRes = await query('SELECT id, full_name, email FROM public.app_users WHERE id = $1', [targetUserId]);
          targetUser = userRes.rows[0] || null;
        } catch {}
      }
      if (!targetUser) {
        const fbUsers = await listAllAppUsersFallback();
        targetUser = fbUsers.find((u) => u.id === targetUserId) || null;
      }
      if (!targetUser || !targetUser.email) {
        sendJson(res, 404, { success: false, message: 'User not found.' });
        return true;
      }

      const rawToken = generateCryptoToken(32);
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      if (isDatabaseAvailable()) {
        await query('UPDATE public.password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE', [targetUserId]).catch(() => {});
        await query(
          `INSERT INTO public.password_resets (user_id, token_hash, expires_at, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5)`,
          [targetUserId, tokenHash, expiresAt, clientIp, 'Admin-Initiated-Dispatch']
        ).catch(() => {});
      }

      const appBase = process.env.APP_BASE_URL || 'https://mymoney.nileshbarela.site';
      const resetLink = `${appBase}/reset-password?token=${rawToken}&email=${encodeURIComponent(targetUser.email)}`;

      const sent = await sendPasswordResetEmail(targetUser.email, targetUser.full_name || '', resetLink);

      if (isDatabaseAvailable()) {
        await logSecurityEvent('ADMIN_SENT_PASSWORD_RESET_EMAIL', {
          userId: authUser.id,
          actorRole: authUser.role,
          ipAddress: clientIp,
          details: { targetUserId, targetEmail: targetUser.email, emailDispatched: sent },
        }).catch(() => {});
      }

      sendJson(res, 200, {
        success: sent,
        message: sent
          ? `Password reset email dispatched to ${targetUser.email}.`
          : `Could not send password reset email to ${targetUser.email}. Check SMTP_USER / SMTP_PASS server configuration.`,
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

      const rate = await checkRateLimitAsync(`admin_sensitive:${authUser.id}`, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.max, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.windowMs, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      const targetUserId = forceResetMatch[1];
      let targetUser: any = null;
      if (isDatabaseAvailable()) {
        try {
          const uRes = await query('SELECT id, email, role FROM public.app_users WHERE id = $1', [targetUserId]);
          targetUser = uRes.rows[0] || null;
        } catch {}
      }
      if (!targetUser) {
        const fbUsers = await listAllAppUsersFallback();
        targetUser = fbUsers.find((u) => u.id === targetUserId) || null;
      }
      if (!targetUser) {
        sendJson(res, 404, { success: false, message: 'User not found.' });
        return true;
      }
      const callerIsSuper = authUser.role === 'superadmin' || isProtectedMasterAdminEmail(authUser.email);
      if (isProtectedMasterAdminEmail(targetUser.email) && !callerIsSuper) {
        sendJson(res, 403, { success: false, message: 'Protected master administrator account cannot be modified.' });
        return true;
      }
      if (String(targetUser.role || '').toLowerCase() === 'superadmin' && !callerIsSuper) {
        sendJson(res, 403, { success: false, message: 'Only a superadmin can force password reset on a superadmin account.' });
        return true;
      }

      if (isDatabaseAvailable()) {
        await query('UPDATE public.app_users SET force_password_reset = TRUE WHERE id = $1', [targetUserId]).catch(() => {});
        await revokeAllUserSessions(targetUserId).catch(() => {});
        await logSecurityEvent('ADMIN_FORCED_PASSWORD_RESET', {
          userId: authUser.id,
          actorRole: authUser.role,
          ipAddress: clientIp,
          details: { targetUserId },
        }).catch(() => {});
      }
      await sbRestRequest(`app_users?id=eq.${encodeURIComponent(targetUserId)}`, {
        method: 'PATCH',
        body: { force_password_reset: true, updated_at: new Date().toISOString() },
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

      const rate = await checkRateLimitAsync(`admin_sensitive:${authUser.id}`, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.max, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.windowMs, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      const targetUserId = revokeMatch[1];
      let count = 0;
      if (isDatabaseAvailable()) {
        count = await revokeAllUserSessions(targetUserId).catch(() => 0);
        await logSecurityEvent('ADMIN_REVOKED_USER_SESSIONS', {
          userId: authUser.id,
          actorRole: authUser.role,
          ipAddress: clientIp,
          details: { targetUserId, revokedCount: count },
        }).catch(() => {});
      } else {
        await sbRestRequest(`user_sessions?user_id=eq.${encodeURIComponent(targetUserId)}`, {
          method: 'PATCH',
          body: { is_revoked: true },
        });
      }

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

      const rate = await checkRateLimitAsync(`admin_sensitive:${authUser.id}`, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.max, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.windowMs, RATE_LIMITS.ADMIN_SENSITIVE_ACCOUNT.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      const targetUserId = deleteMatch[1];
      if (targetUserId === authUser.id) {
        sendJson(res, 400, { success: false, message: 'Administrators cannot delete their own account from admin panel.' });
        return true;
      }

      let targetUser: any = null;
      if (isDatabaseAvailable()) {
        try {
          const userRes = await query('SELECT id, email, role FROM public.app_users WHERE id = $1', [targetUserId]);
          targetUser = userRes.rows[0] || null;
        } catch {}
      }
      if (!targetUser) {
        const fbUsers = await listAllAppUsersFallback();
        targetUser = fbUsers.find((u) => u.id === targetUserId) || null;
      }
      if (!targetUser) {
        sendJson(res, 404, { success: false, message: 'User not found.' });
        return true;
      }
      if (isProtectedMasterAdminEmail(targetUser.email)) {
        sendJson(res, 403, { success: false, message: 'Protected master administrator account cannot be deleted.' });
        return true;
      }
      const callerIsSuper = authUser.role === 'superadmin' || isProtectedMasterAdminEmail(authUser.email);
      if (String(targetUser.role || '').toLowerCase() === 'superadmin' && !callerIsSuper) {
        sendJson(res, 403, { success: false, message: 'Only a superadmin can delete another superadmin account.' });
        return true;
      }

      const targetEmail = targetUser.email;
      if (isDatabaseAvailable()) {
        try {
          await query('DELETE FROM public.transactions WHERE user_id = $1', [targetUserId]).catch(() => {});
          await query('DELETE FROM public.user_sessions WHERE user_id = $1', [targetUserId]).catch(() => {});
          await query('DELETE FROM public.password_resets WHERE user_id = $1', [targetUserId]).catch(() => {});
          await query('DELETE FROM public.app_users WHERE id = $1', [targetUserId]).catch(() => {});
          await logSecurityEvent('ADMIN_DELETED_USER', {
            userId: authUser.id,
            actorRole: authUser.role,
            ipAddress: clientIp,
            details: { targetUserId, targetEmail },
          }).catch(() => {});
        } catch {}
      }
      await sbRestRequest(`app_users?id=eq.${encodeURIComponent(targetUserId)}`, { method: 'DELETE' });
      await sbRestRequest(`profiles?id=eq.${encodeURIComponent(targetUserId)}`, { method: 'DELETE' });

      sendJson(res, 200, { success: true, message: 'User and all associated data permanently deleted.' });
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

      if (!isDatabaseAvailable()) {
        sendJson(res, 503, { success: false, message: 'Account deletion service requires an active database connection.' });
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

      const safeAppBase =
        APP_CONFIG.appBaseUrl ||
        'https://mymoney.nileshbarela.site';
      const cancelLink = `${safeAppBase}/#cancel-deletion&token=${rawToken}&email=${encodeURIComponent(authUser.email)}`;
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

    // 5. TRIGGER EXPIRED DELETIONS: POST /api/account/deletion/process-expired (Admin or CRON_SECRET only)
    if (pathname === '/api/account/deletion/process-expired' && method === 'POST') {
      const cronSecret = process.env.CRON_SECRET || '';
      const providedCron = String(req.headers['x-cron-secret'] || '').trim();
      const validCron =
        cronSecret.length >= 16 &&
        providedCron.length === cronSecret.length &&
        crypto.timingSafeEqual(Buffer.from(providedCron), Buffer.from(cronSecret));
      if (!validCron) {
        const authUser = await authenticateRequest(req);
        if (!authUser || (authUser.role !== 'admin' && authUser.role !== 'superadmin')) {
          sendJson(res, 403, { success: false, message: 'Access Denied: Administrator or cron secret required.' });
          return true;
        }
      }
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
        try {
          await query(
            `INSERT INTO public.user_connections (user_a_id, user_b_id, status, consented_at, responded_at, deleted_at, deleted_by, cancelled_at, updated_at)
             VALUES ($1, $2, 'connected', NOW(), NOW(), NULL, NULL, NULL, NOW())
             ON CONFLICT (user_a_id, user_b_id) DO UPDATE
             SET status = 'connected', consented_at = COALESCE(public.user_connections.consented_at, NOW()), responded_at = NOW(), deleted_at = NULL, deleted_by = NULL, cancelled_at = NULL, updated_at = NOW()`,
            [sourceUser.id, targetUserId]
          );
          await query(
            `INSERT INTO public.user_connections (user_a_id, user_b_id, status, consented_at, responded_at, deleted_at, deleted_by, cancelled_at, updated_at)
             VALUES ($1, $2, 'connected', NOW(), NOW(), NULL, NULL, NULL, NOW())
             ON CONFLICT (user_a_id, user_b_id) DO UPDATE
             SET status = 'connected', consented_at = COALESCE(public.user_connections.consented_at, NOW()), responded_at = NOW(), deleted_at = NULL, deleted_by = NULL, cancelled_at = NULL, updated_at = NOW()`,
            [targetUserId, sourceUser.id]
          );
        } catch {
          await query(
            `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
             VALUES ($1, $2, 'connected')
             ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
            [sourceUser.id, targetUserId]
          ).catch(() => {});
          await query(
            `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
             VALUES ($1, $2, 'connected')
             ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
            [targetUserId, sourceUser.id]
          ).catch(() => {});
        }

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

    async function createSearchConnectionRequestPg(
      authUser: any,
      targetUserId: string,
      relationshipType: string = 'Friend',
      requestedVia: string = 'search'
    ): Promise<{ status: number; body: Record<string, any> }> {
      if (!targetUserId) {
        return { status: 400, body: { success: false, code: 'MISSING_TARGET', message: 'Target user ID is required.' } };
      }
      if (targetUserId === authUser.id) {
        return { status: 400, body: { success: false, code: 'SELF_CONNECTION', message: 'You cannot connect with your own account.' } };
      }

      const targetRes = await query(
        `SELECT id, full_name, email, phone, avatar_url, role, status, COALESCE(deletion_status, 'none') AS deletion_status
         FROM public.app_users WHERE id = $1`,
        [targetUserId]
      );
      if (targetRes.rows.length === 0) {
        return { status: 404, body: { success: false, code: 'NOT_FOUND', message: 'User account not found.' } };
      }
      const target = targetRes.rows[0];
      if (!isDiscoverableNormalUser(target)) {
        return { status: 403, body: { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'This user account is not eligible for Udhar connections.' } };
      }

      const pairRes = await query(
        `SELECT id, user_a_id, user_b_id, status FROM public.user_connections
         WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)`,
        [authUser.id, targetUserId]
      );
      if (pairRes.rows.some((r: any) => r.status === 'blocked')) {
        return { status: 403, body: { success: false, code: 'BLOCKED', message: 'Connection is blocked between these accounts.' } };
      }

      const targetDisplayName = (target.full_name || target.email?.split('@')[0] || 'Friend').trim();
      const requesterDisplayName = (authUser.full_name || authUser.email?.split('@')[0] || 'A user').trim();

      if (pairRes.rows.some((r: any) => r.status === 'connected')) {
        return {
          status: 200,
          body: {
            success: true,
            status: 'connected',
            alreadyConnected: true,
            message: `You are already connected with ${targetDisplayName}.`,
            connectedUser: {
              id: target.id,
              name: targetDisplayName,
              displayName: targetDisplayName,
              fullName: targetDisplayName,
              avatarUrl: target.avatar_url || null,
              isVerified: true,
            },
          },
        };
      }

      // Opposite-direction simultaneous pending request -> accept cleanly
      const incomingPending = pairRes.rows.find(
        (r: any) => r.user_a_id === targetUserId && r.user_b_id === authUser.id && r.status === 'pending'
      );
      if (incomingPending) {
        return acceptConnectionRequestPg(authUser, String(incomingPending.id || targetUserId));
      }

      // Duplicate outgoing pending request -> prevent duplicates
      const outgoingPending = pairRes.rows.find(
        (r: any) => r.user_a_id === authUser.id && r.user_b_id === targetUserId && r.status === 'pending'
      );
      if (outgoingPending) {
        return {
          status: 200,
          body: {
            success: true,
            status: 'pending',
            alreadyPending: true,
            deduplicated: true,
            connectionMethod: 'SEARCH',
            requestId: outgoingPending.id,
            message: `Connection request already sent to ${targetDisplayName}. Waiting for their approval.`,
            connectedUser: {
              id: target.id,
              name: targetDisplayName,
              displayName: targetDisplayName,
              fullName: targetDisplayName,
              avatarUrl: target.avatar_url || null,
              isVerified: true,
            },
          },
        };
      }

      // Clear any prior deleted/rejected/cancelled rows in both directions so re-adding via search
      // creates a clean fresh pending connection request requiring the recipient's approval.
      await query(
        `DELETE FROM public.user_connections
         WHERE ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))
           AND status IN ('deleted', 'rejected', 'cancelled')`,
        [authUser.id, targetUserId]
      ).catch(() => {});

      let insRes: any;
      try {
        insRes = await query(
          `INSERT INTO public.user_connections (user_a_id, user_b_id, status, relationship_type, requested_via, connection_method, updated_at)
           VALUES ($1, $2, 'pending', $3, $4, 'SEARCH', NOW())
           ON CONFLICT (user_a_id, user_b_id) DO UPDATE
           SET status = 'pending',
               relationship_type = EXCLUDED.relationship_type,
               requested_via = EXCLUDED.requested_via,
               connection_method = 'SEARCH',
               responded_at = NULL,
               consented_at = NULL,
               cancelled_at = NULL,
               deleted_at = NULL,
               deleted_by = NULL,
               updated_at = NOW()
           RETURNING id`,
          [authUser.id, targetUserId, relationshipType, requestedVia]
        );
      } catch {
        insRes = await query(
          `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
           VALUES ($1, $2, 'pending')
           ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'pending'
           RETURNING id`,
          [authUser.id, targetUserId]
        );
      }
      const requestId = insRes.rows[0]?.id || `${authUser.id}:${targetUserId}`;

      await createNotification({
        userId: targetUserId,
        title: 'Udhar Connection Request',
        message: `${requesterDisplayName} wants to connect with you on My Money Manager Udhar.`,
        category: 'udhar',
        type: 'info',
        relatedEntityType: 'user_connection',
        relatedEntityId: String(requestId),
        deepLink: 'people',
        metadata: {
          actionType: 'udhar_connection_request',
          requestId: String(requestId),
          connectionId: String(requestId),
          requesterId: authUser.id,
          requesterUserId: authUser.id,
          receiverId: targetUserId,
          requesterName: requesterDisplayName,
          requesterAvatar: authUser.avatar_url || null,
          requestedVia,
          connectionMethod: 'SEARCH',
          relationshipType,
          requestStatus: 'pending',
        },
        channels: ['in_app', 'push'],
      }).catch(() => {});

      await query(
        `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
         VALUES ($1, $2, 'udhar_connection_request', $3, $4, $5, TRUE)`,
        [
          'Udhar Connection Request',
          `${requesterDisplayName} wants to connect with you on My Money Manager Udhar.`,
          targetUserId,
          String(requestId),
          authUser.id,
        ]
      ).catch(() => {});

      await logSecurityEvent('UDHAR_CONNECTION_REQUESTED', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { targetUserId, requestId: String(requestId), requestedVia },
      });

      return {
        status: 200,
        body: {
          success: true,
          status: 'pending',
          connectionMethod: 'SEARCH',
          alreadyConnected: false,
          alreadyPending: false,
          requestId: String(requestId),
          message: `Connection request sent to ${targetDisplayName}. You'll be connected once they accept.`,
          connectedUser: {
            id: target.id,
            name: targetDisplayName,
            displayName: targetDisplayName,
            fullName: targetDisplayName,
            avatarUrl: target.avatar_url || null,
            isVerified: true,
          },
        },
      };
    }

    async function acceptConnectionRequestPg(authUser: any, key: string): Promise<{ status: number; body: Record<string, any> }> {
      const parsedKey = parseConnectionRequestKey(key);
      if (!parsedKey.valid) {
        return { status: 400, body: { success: false, message: 'Valid connection request ID is required.' } };
      }

      const lookupKey = parsedKey.kind === 'composite' ? (parsedKey.requesterUserId || key) : (parsedKey.uuid || key);
      const reqRes = await query(
        `SELECT uc.id, uc.user_a_id, u.full_name, u.email, u.phone, u.avatar_url, u.status
         FROM public.user_connections uc
         JOIN public.app_users u ON u.id = uc.user_a_id
         WHERE uc.user_b_id = $1 AND uc.status = 'pending'
           AND (uc.id::text = $2 OR uc.user_a_id::text = $2)
         LIMIT 1`,
        [authUser.id, lookupKey]
      );

      if (reqRes.rows.length === 0) {
        return { status: 404, body: { success: false, code: 'REQUEST_NOT_FOUND', message: 'Pending connection request not found.' } };
      }

      const pending = reqRes.rows[0];
      const requesterId = pending.user_a_id;
      const requesterName = (pending.full_name || pending.email?.split('@')[0] || 'Friend').trim();
      const acceptorName = (authUser.full_name || authUser.email?.split('@')[0] || 'User').trim();

      try {
        await query(
          `UPDATE public.user_connections
           SET status = 'connected', consented_at = NOW(), responded_at = NOW(), deleted_at = NULL, deleted_by = NULL, cancelled_at = NULL, updated_at = NOW()
           WHERE id = $1`,
          [pending.id]
        );
      } catch {
        await query(`UPDATE public.user_connections SET status = 'connected' WHERE id = $1`, [pending.id]);
      }

      await ensureReciprocalContact(
        authUser.id,
        {
          id: requesterId,
          full_name: requesterName,
          email: pending.email,
          phone: pending.phone,
          avatar_url: pending.avatar_url,
        },
        'Friend'
      );
      await ensureReciprocalContact(requesterId, authUser, 'Friend');

      await updateConnectionRequestNotificationsState({
        requestId: String(pending.id),
        requesterId,
        receiverId: authUser.id,
        status: 'accepted',
      }).catch(() => {});

      await createNotification({
        userId: requesterId,
        title: 'Connection Request Accepted',
        message: `${acceptorName} accepted your connection request. Added to your Saved People.`,
        category: 'udhar',
        type: 'success',
        relatedEntityType: 'user_connection',
        relatedEntityId: authUser.id,
        deepLink: 'people',
        metadata: {
          actionType: 'udhar_connection_accepted',
          acceptorId: authUser.id,
          acceptorName,
          acceptorAvatar: authUser.avatar_url || null,
          connectionId: String(pending.id),
        },
        channels: ['in_app', 'push'],
      }).catch(() => {});

      await logSecurityEvent('USER_ACCEPTED_UDHAR_CONNECTION', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { requesterId, requestId: pending.id },
      });

      return {
        status: 200,
        body: {
          success: true,
          status: 'connected',
          message: `Connected with ${requesterName}! Added to your Saved People.`,
          connectedUser: {
            id: requesterId,
            name: requesterName,
            displayName: requesterName,
            fullName: requesterName,
            avatarUrl: pending.avatar_url || null,
            isVerified: true,
          },
        },
      };
    }

    async function rejectConnectionRequestPg(authUser: any, key: string): Promise<{ status: number; body: Record<string, any> }> {
      const parsedKey = parseConnectionRequestKey(key);
      if (!parsedKey.valid) {
        return { status: 400, body: { success: false, message: 'Valid connection request ID is required.' } };
      }

      const lookupKey = parsedKey.kind === 'composite' ? (parsedKey.requesterUserId || key) : (parsedKey.uuid || key);
      const reqRes = await query(
        `SELECT id, user_a_id FROM public.user_connections
         WHERE user_b_id = $1 AND status = 'pending'
           AND (id::text = $2 OR user_a_id::text = $2)
         LIMIT 1`,
        [authUser.id, lookupKey]
      );
      if (reqRes.rows.length === 0) {
        return { status: 404, body: { success: false, code: 'REQUEST_NOT_FOUND', message: 'Pending connection request not found.' } };
      }

      const pending = reqRes.rows[0];
      try {
        await query(`UPDATE public.user_connections SET status = 'rejected', responded_at = NOW(), updated_at = NOW() WHERE id = $1`, [pending.id]);
      } catch {
        await query(`UPDATE public.user_connections SET status = 'rejected' WHERE id = $1`, [pending.id]);
      }

      await updateConnectionRequestNotificationsState({
        requestId: String(pending.id),
        requesterId: pending.user_a_id,
        receiverId: authUser.id,
        status: 'rejected',
      }).catch(() => {});

      const rejectorName = (authUser.full_name || authUser.email?.split('@')[0] || 'User').trim();
      await createNotification({
        userId: pending.user_a_id,
        title: 'Connection Request Declined',
        message: `${rejectorName} declined your My Money Manager Udhar connection request.`,
        category: 'udhar',
        type: 'info',
        deepLink: 'people',
        channels: ['in_app'],
      }).catch(() => {});

      await logSecurityEvent('USER_REJECTED_UDHAR_CONNECTION', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { requesterId: pending.user_a_id, requestId: pending.id },
      });

      return {
        status: 200,
        body: {
          success: true,
          status: 'rejected',
          message: 'Connection request declined. No active connection was created.',
        },
      };
    }

    async function cancelConnectionRequestPg(authUser: any, key: string): Promise<{ status: number; body: Record<string, any> }> {
      const parsedKey = parseConnectionRequestKey(key);
      if (!parsedKey.valid) {
        return { status: 400, body: { success: false, message: 'Valid connection request ID is required.' } };
      }

      const lookupKey = parsedKey.kind === 'composite' ? (parsedKey.targetUserId || key) : (parsedKey.uuid || key);
      const reqRes = await query(
        `SELECT id, user_b_id FROM public.user_connections
         WHERE user_a_id = $1 AND status = 'pending'
           AND (id::text = $2 OR user_b_id::text = $2)
         LIMIT 1`,
        [authUser.id, lookupKey]
      );
      if (reqRes.rows.length === 0) {
        const anyRes = await query(
          `SELECT id, status FROM public.user_connections
           WHERE user_a_id = $1 AND (id::text = $2 OR user_b_id::text = $2)
           LIMIT 1`,
          [authUser.id, lookupKey]
        ).catch(() => ({ rows: [] as any[] }));
        const existing = anyRes.rows[0];
        if (existing?.status === 'connected') {
          return {
            status: 409,
            body: { success: false, code: 'ALREADY_CONNECTED', message: 'This connection request was already accepted and cannot be cancelled.' },
          };
        }
        if (existing && (existing.status === 'cancelled' || existing.status === 'rejected')) {
          return {
            status: 200,
            body: { success: true, alreadyCancelled: true, status: 'cancelled', requestId: String(existing.id), message: 'Connection request was already cancelled.' },
          };
        }
        return { status: 404, body: { success: false, code: 'REQUEST_NOT_FOUND', message: 'Pending outgoing connection request not found.' } };
      }

      const pending = reqRes.rows[0];
      try {
        await query(`UPDATE public.user_connections SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`, [pending.id]);
      } catch {
        await query(`DELETE FROM public.user_connections WHERE id = $1`, [pending.id]);
      }

      await updateConnectionRequestNotificationsState({
        requestId: String(pending.id),
        requesterId: authUser.id,
        receiverId: pending.user_b_id,
        status: 'cancelled',
      }).catch(() => {});

      return {
        status: 200,
        body: {
          success: true,
          status: 'cancelled',
          requestId: String(pending.id),
          message: 'Connection request cancelled.',
        },
      };
    }

    async function removeSavedConnectionPg(authUser: any, targetOrContactId: string): Promise<{ status: number; body: Record<string, any> }> {
      const rawId = (targetOrContactId || '').trim();
      if (!rawId) {
        return { status: 400, body: { success: false, message: 'Contact or peer user ID is required.' } };
      }

      let contactRow: any = null;
      let peerUserId: string | null = null;

      if (rawId.startsWith('conn_')) {
        peerUserId = rawId.slice(5).trim() || null;
      } else {
        const contactRes = await query(
          `SELECT * FROM public.udhar_contacts WHERE id::text = $1 AND user_id = $2 LIMIT 1`,
          [rawId, authUser.id]
        ).catch(() => ({ rows: [] as any[] }));
        if (contactRes.rows.length > 0) {
          contactRow = contactRes.rows[0];
          peerUserId = contactRow.linked_user_id || null;
        } else {
          peerUserId = rawId;
        }
      }

      if (!contactRow && !peerUserId) {
        return { status: 404, body: { success: false, message: 'Saved connection not found.' } };
      }

      if (!contactRow && peerUserId) {
        const [peerContactRes, peerConnRes] = await Promise.all([
          query(`SELECT id FROM public.udhar_contacts WHERE user_id = $1 AND linked_user_id = $2 LIMIT 1`, [authUser.id, peerUserId]),
          query(
            `SELECT id, status FROM public.user_connections
             WHERE ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))
               AND status <> 'deleted'
             LIMIT 1`,
            [authUser.id, peerUserId]
          ),
        ]);
        if (peerContactRes.rows.length === 0 && peerConnRes.rows.length === 0) {
          return { status: 404, body: { success: false, message: 'Saved connection not found.' } };
        }
      }

      if (contactRow?.id) {
        await query(`DELETE FROM public.udhar_contacts WHERE id = $1 AND user_id = $2`, [contactRow.id, authUser.id]);
      }

      // Instant two-sided removal of Saved People entries + user_connections (NEVER deletes transactions/repayments)
      if (peerUserId && peerUserId !== authUser.id) {
        await query(
          `DELETE FROM public.udhar_contacts
           WHERE (user_id = $1 AND linked_user_id = $2)
              OR (user_id = $2 AND linked_user_id = $1)`,
          [authUser.id, peerUserId]
        );
        try {
          await query(
            `UPDATE public.user_connections
             SET status = 'deleted', deleted_at = NOW(), deleted_by = $3, updated_at = NOW()
             WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)`,
            [authUser.id, peerUserId, authUser.id]
          );
        } catch {
          await query(
            `DELETE FROM public.user_connections
             WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)`,
            [authUser.id, peerUserId]
          );
        }

        await Promise.all([
          updateConnectionRequestNotificationsState({ requesterId: authUser.id, receiverId: peerUserId, status: 'cancelled' }).catch(() => {}),
          updateConnectionRequestNotificationsState({ requesterId: peerUserId, receiverId: authUser.id, status: 'cancelled' }).catch(() => {}),
        ]);
      }

      await logSecurityEvent('USER_REMOVED_SAVED_CONNECTION', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { targetOrContactId: rawId, peerUserId },
      });

      return {
        status: 200,
        body: {
          success: true,
          removed: true,
          twoSided: Boolean(peerUserId && peerUserId !== authUser.id),
          peerUserId,
          preservedTransactions: true,
          message: 'Connection removed from Saved People. Existing Udhaar history remains preserved.',
        },
      };
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

      const [contactsRes, connsRes] = await Promise.all([
        query(
          `SELECT c.id, c.name, c.email, c.phone, c.photo_url, c.relationship_type, c.notes, c.linked_user_id, c.created_at, c.updated_at,
                  u.full_name AS linked_user_name, u.email AS linked_user_email, u.avatar_url AS linked_user_avatar
           FROM public.udhar_contacts c
           LEFT JOIN public.app_users u ON c.linked_user_id = u.id
           WHERE c.user_id = $1
           ORDER BY c.name ASC`,
          [authUser.id]
        ),
        query(
          `SELECT CASE WHEN uc.user_a_id = $1 THEN uc.user_b_id ELSE uc.user_a_id END AS peer_id,
                  u.full_name, u.email, u.avatar_url, u.role, u.status, COALESCE(u.deletion_status, 'none') AS deletion_status
           FROM public.user_connections uc
           JOIN public.app_users u ON u.id = (CASE WHEN uc.user_a_id = $1 THEN uc.user_b_id ELSE uc.user_a_id END)
           WHERE (uc.user_a_id = $1 OR uc.user_b_id = $1) AND uc.status = 'connected'`,
          [authUser.id]
        ),
      ]);

      const mergedContacts: any[] = [];
      const seenLinked = new Set<string>();
      const seenNames = new Set<string>();

      for (const c of contactsRes.rows) {
        const linkedId = c.linked_user_id || null;
        const normName = (c.name || '').trim().toLowerCase();
        if (linkedId) {
          if (seenLinked.has(linkedId)) continue;
          seenLinked.add(linkedId);
        } else if (normName) {
          if (seenNames.has(normName)) continue;
          seenNames.add(normName);
        }
        mergedContacts.push({
          ...c,
          linked_user_email: c.linked_user_email ? maskEmailForPrivacy(c.linked_user_email) : null,
          is_registered: Boolean(linkedId),
        });
      }

      for (const conn of connsRes.rows) {
        if (!conn.peer_id || conn.peer_id === authUser.id || seenLinked.has(conn.peer_id)) continue;
        if (!isDiscoverableNormalUser(conn)) continue;
        seenLinked.add(conn.peer_id);
        mergedContacts.push({
          id: `conn_${conn.peer_id}`,
          name: (conn.full_name || conn.email?.split('@')[0] || 'Connected User').trim(),
          email: conn.email ? maskEmailForPrivacy(conn.email) : null,
          phone: null,
          photo_url: conn.avatar_url || null,
          relationship_type: 'Friend',
          notes: null,
          linked_user_id: conn.peer_id,
          linked_user_name: conn.full_name || null,
          linked_user_email: conn.email ? maskEmailForPrivacy(conn.email) : null,
          linked_user_avatar: conn.avatar_url || null,
          is_registered: true,
        });
      }

      mergedContacts.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      sendJson(res, 200, { success: true, contacts: mergedContacts });
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

      const [contactsRes, connsRes, txsRes] = await Promise.all([
        query(
          `SELECT c.id, c.name, c.email, c.phone, c.relationship_type, c.notes, c.linked_user_id, c.photo_url, c.created_at, c.updated_at,
                  u.full_name AS linked_user_name, u.email AS linked_user_email, u.avatar_url AS linked_user_avatar
           FROM public.udhar_contacts c
           LEFT JOIN public.app_users u ON c.linked_user_id = u.id
           WHERE c.user_id = $1
           ORDER BY c.name ASC`,
          [authUser.id]
        ),
        query(
          `SELECT CASE WHEN uc.user_a_id = $1 THEN uc.user_b_id ELSE uc.user_a_id END AS peer_id,
                  u.full_name, u.email, u.avatar_url, u.role, u.status, COALESCE(u.deletion_status, 'none') AS deletion_status
           FROM public.user_connections uc
           JOIN public.app_users u ON u.id = (CASE WHEN uc.user_a_id = $1 THEN uc.user_b_id ELSE uc.user_a_id END)
           WHERE (uc.user_a_id = $1 OR uc.user_b_id = $1) AND uc.status = 'connected'`,
          [authUser.id]
        ),
        query(
          `SELECT t.*, u.full_name AS counterpart_registered_name, u.email AS counterpart_email, u.avatar_url AS counterpart_avatar
           FROM public.udhar_transactions t
           LEFT JOIN public.app_users u ON t.counterpart_user_id = u.id
           WHERE t.user_id = $1 AND t.status <> 'cancelled' AND t.deleted_at IS NULL`,
          [authUser.id]
        ),
      ]);

      const baseContacts: any[] = [];
      const seenLinked = new Set<string>();
      const seenNames = new Set<string>();

      for (const c of contactsRes.rows) {
        const linkedId = c.linked_user_id || null;
        const normName = (c.name || '').trim().toLowerCase();
        if (linkedId) {
          if (seenLinked.has(linkedId)) continue;
          seenLinked.add(linkedId);
        } else if (normName) {
          if (seenNames.has(normName)) continue;
          seenNames.add(normName);
        }
        baseContacts.push(c);
      }

      for (const conn of connsRes.rows) {
        if (!conn.peer_id || conn.peer_id === authUser.id || seenLinked.has(conn.peer_id)) continue;
        if (!isDiscoverableNormalUser(conn)) continue;
        seenLinked.add(conn.peer_id);
        baseContacts.push({
          id: `conn_${conn.peer_id}`,
          name: (conn.full_name || conn.email?.split('@')[0] || 'Connected User').trim(),
          email: conn.email ? maskEmailForPrivacy(conn.email) : null,
          phone: null,
          photo_url: conn.avatar_url || null,
          relationship_type: 'Friend',
          notes: null,
          linked_user_id: conn.peer_id,
          linked_user_name: conn.full_name || null,
          linked_user_email: conn.email ? maskEmailForPrivacy(conn.email) : null,
          linked_user_avatar: conn.avatar_url || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      const activeTxs = txsRes.rows.filter((t: any) => normalizeUdharLifecycleStatus(t) !== 'deleted');
      const parsedContacts = baseContacts
        .map((c) => {
          const matchingTxs = activeTxs.filter((t: any) => {
            if (c.linked_user_id && t.counterpart_user_id === c.linked_user_id) return true;
            if (
              !c.linked_user_id &&
              !t.counterpart_user_id &&
              (t.counterpart_name || '').trim().toLowerCase() === (c.name || '').trim().toLowerCase()
            ) {
              return true;
            }
            return false;
          });

          let totalGiven = 0;
          let totalTaken = 0;
          let receivable = 0;
          let payable = 0;
          let lastDate: string | null = null;
          let pendingCount = 0;
          let pendingRequestsCount = 0;
          let pendingRequestsAmount = 0;
          let pendingGivenAmount = 0;
          let pendingReceivedAmount = 0;
          let rejectedCount = 0;

          for (const t of matchingTxs) {
            const lifecycle = normalizeUdharLifecycleStatus(t);
            if (lifecycle === 'deleted') continue;

            if (t.transaction_date && (!lastDate || t.transaction_date > lastDate)) {
              lastDate = t.transaction_date;
            }

            if (lifecycle === 'rejected') {
              rejectedCount += 1;
              continue;
            }
            if (lifecycle === 'cancelled') continue;

            const orig = parseFloat(t.original_amount) || 0;
            if (lifecycle === 'pending_confirmation') {
              pendingRequestsCount += 1;
              pendingRequestsAmount += orig;
              if (t.direction === 'gave') pendingGivenAmount += orig;
              else pendingReceivedAmount += orig;
              continue;
            }

            const cur = parseFloat(t.current_balance) || 0;
            const isSettled = lifecycle === 'settled' || cur <= 0.01;
            if (t.direction === 'gave') {
              totalGiven += orig;
              if (!isSettled) receivable += cur;
            } else {
              totalTaken += orig;
              if (!isSettled) payable += cur;
            }
            if (!isSettled && cur > 0.01) pendingCount += 1;
          }

          return {
            ...c,
            linked_user_email: c.linked_user_email ? maskEmailForPrivacy(c.linked_user_email) : null,
            total_given: roundMoney(totalGiven),
            total_taken: roundMoney(totalTaken),
            outstanding_receivable: roundMoney(receivable),
            outstanding_payable: roundMoney(payable),
            net_balance: roundMoney(receivable - payable),
            last_transaction_date: lastDate,
            total_transactions_count: matchingTxs.length,
            pending_transactions_count: pendingCount,
            pending_requests_count: pendingRequestsCount,
            pending_requests_amount: roundMoney(pendingRequestsAmount),
            pending_given_amount: roundMoney(pendingGivenAmount),
            pending_received_amount: roundMoney(pendingReceivedAmount),
            rejected_count: rejectedCount,
            is_registered: Boolean(c.linked_user_id),
          };
        })
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

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

      // Only connect when an explicit linkedUserId is already connected, otherwise initiate Method A connection request
      if (linkedUserId) {
        if (linkedUserId === authUser.id) {
          sendJson(res, 400, { success: false, message: 'You cannot add yourself as a contact.' });
          return true;
        }
        const pairRes = await query(
          `SELECT status FROM public.user_connections
           WHERE ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))
             AND status = 'connected'
           LIMIT 1`,
          [authUser.id, linkedUserId]
        );
        if (pairRes.rows.length === 0) {
          const reqResult = await createSearchConnectionRequestPg(authUser, linkedUserId, relationshipType, 'search');
          sendJson(res, reqResult.status, reqResult.body);
          return true;
        }
        const targetRes = await query(
          `SELECT id, full_name, email, role, status, COALESCE(deletion_status, 'none') AS deletion_status
           FROM public.app_users WHERE id = $1`,
          [linkedUserId]
        );
        if (targetRes.rows.length === 0) {
          sendJson(res, 404, { success: false, message: 'Selected user account was not found.' });
          return true;
        }
        if (!isDiscoverableNormalUser(targetRes.rows[0])) {
          sendJson(res, 403, { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'Selected user account is not eligible for Udhar connections.' });
          return true;
        }
      }

      // Deduplicate by linked_user_id or case-insensitive trimmed name before inserting
      const existingCheck = linkedUserId
        ? await query(
            `SELECT * FROM public.udhar_contacts
             WHERE user_id = $1 AND (linked_user_id = $2 OR (linked_user_id IS NULL AND LOWER(TRIM(name)) = LOWER(TRIM($3))))
             ORDER BY (linked_user_id IS NOT NULL) DESC LIMIT 1`,
            [authUser.id, linkedUserId, name]
          )
        : await query(
            `SELECT * FROM public.udhar_contacts
             WHERE user_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2))
             LIMIT 1`,
            [authUser.id, name]
          );

      const upsertRes = existingCheck.rows.length > 0
        ? await query(
            `UPDATE public.udhar_contacts
             SET name = $1,
                 email = COALESCE($2, email),
                 phone = COALESCE($3, phone),
                 photo_url = COALESCE($4, photo_url),
                 relationship_type = $5,
                 notes = COALESCE($6, notes),
                 linked_user_id = COALESCE($7, linked_user_id),
                 updated_at = NOW()
             WHERE id = $8 AND user_id = $9
             RETURNING *`,
            [name, email || null, phone || null, photoUrl, relationshipType, notes || null, linkedUserId, existingCheck.rows[0].id, authUser.id]
          )
        : await query(
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

      if (contactId.startsWith('conn_')) {
        const peerUserId = contactId.slice(5).trim();
        if (!peerUserId || peerUserId === authUser.id) {
          sendJson(res, 400, { success: false, message: 'Invalid connected user identifier.' });
          return true;
        }
        const connCheck = await query(
          `SELECT id FROM public.user_connections
           WHERE ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))
             AND status = 'connected'
           LIMIT 1`,
          [authUser.id, peerUserId]
        );
        if (connCheck.rows.length === 0) {
          sendJson(res, 404, { success: false, message: 'Active connection not found.' });
          return true;
        }
        const existingPeerRow = await query(
          `SELECT id FROM public.udhar_contacts WHERE user_id = $1 AND linked_user_id = $2 LIMIT 1`,
          [authUser.id, peerUserId]
        );
        if (existingPeerRow.rows.length > 0) {
          const updRes = await query(
            `UPDATE public.udhar_contacts
             SET name = $1, relationship_type = $2, notes = $3, updated_at = NOW()
             WHERE id = $4 AND user_id = $5
             RETURNING *`,
            [name, relationshipType, notes || null, existingPeerRow.rows[0].id, authUser.id]
          );
          sendJson(res, 200, { success: true, contact: updRes.rows[0], reciprocallyLinked: true });
          return true;
        }
        const insRes = await query(
          `INSERT INTO public.udhar_contacts (user_id, name, relationship_type, notes, linked_user_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [authUser.id, name, relationshipType, notes || null, peerUserId]
        );
        sendJson(res, 200, { success: true, contact: insRes.rows[0], reciprocallyLinked: true });
        return true;
      }

      const existingRes = await query(
        `SELECT id, linked_user_id FROM public.udhar_contacts WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [contactId, authUser.id]
      );
      if (existingRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Contact not found.' });
        return true;
      }
      const isLinked = Boolean(existingRes.rows[0].linked_user_id);

      const updRes = isLinked
        ? await query(
            `UPDATE public.udhar_contacts
             SET name = $1, relationship_type = $2, notes = $3, updated_at = NOW()
             WHERE id = $4 AND user_id = $5
             RETURNING *`,
            [name, relationshipType, notes || null, contactId, authUser.id]
          )
        : await query(
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
      sendJson(res, 200, {
        success: true,
        contact: updRes.rows[0],
        reciprocallyLinked: Boolean(finalLinkedId && finalLinkedId !== authUser.id),
      });
      return true;
    }

    // 9. DELETE CONTACT / TWO-SIDED CONNECTION REMOVAL: DELETE /api/udhar/contacts/:id
    const contactDeleteMatch = pathname.match(/^\/api\/udhar\/contacts\/([a-zA-Z0-9_:-]+)$/);
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

      try {
        const pgRes = await removeSavedConnectionPg(authUser, contactId);
        sendJson(res, pgRes.status, pgRes.body);
        return true;
      } catch (pgErr) {
        console.warn('[PG Delete Contact Fallback]:', (pgErr as any)?.message);
        const restRes = await deleteContactRest(authUser, contactId);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
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

      const pairRes = await query(
        `SELECT status FROM public.user_connections
         WHERE ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))
           AND status = 'connected'
         LIMIT 1`,
        [authUser.id, registeredUserId]
      );

      if (pairRes.rows.length === 0) {
        const reqResult = await createSearchConnectionRequestPg(
          authUser,
          registeredUserId,
          contact.relationship_type || 'Friend',
          'search'
        );
        sendJson(res, reqResult.status, {
          ...reqResult.body,
          pendingApproval: reqResult.body.status === 'pending',
        });
        return true;
      }

      const targetUserRes = await query(
        `SELECT id, full_name, email, role, status, COALESCE(deletion_status, 'none') AS deletion_status
         FROM public.app_users WHERE id = $1`,
        [registeredUserId]
      );
      if (targetUserRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Registered user not found.' });
        return true;
      }
      if (!isDiscoverableNormalUser(targetUserRes.rows[0])) {
        sendJson(res, 403, { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'Target user account is not eligible for Udhar connections.' });
        return true;
      }

      await query(
        `UPDATE public.udhar_contacts 
         SET linked_user_id = $1, updated_at = NOW() 
         WHERE id = $2 AND user_id = $3`,
        [registeredUserId, contactId, authUser.id]
      );

      await ensureReciprocalContact(registeredUserId, authUser, contact.relationship_type || 'Friend');

      sendJson(res, 200, {
        success: true,
        status: 'connected',
        message: `Successfully linked ${contact.name} with verified account ${targetUserRes.rows[0].full_name}.`,
      });
      return true;
    }

    // 10B. GET PERSON'S UPI PROFILE: GET /api/udhar/people/:identifier/upi-profile
    const personUpiMatch = pathname.match(/^\/api\/(?:udhar\/people|people|udhar\/contacts)\/([^/]+)\/upi-profile$/);
    if (personUpiMatch && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }
      const identifier = decodeURIComponent(personUpiMatch[1]).trim();
      const restRes = await getPersonUpiProfileRest(authUser, identifier);
      sendJson(res, restRes.status, restRes.body);
      return true;
    }

    // 10C. CONSENT-BASED CONNECTION REQUEST: POST /api/udhar/connections/connect or /api/udhar/connections/request
    if (
      (pathname === '/api/udhar/connections/connect' || pathname === '/api/udhar/connections/request') &&
      method === 'POST'
    ) {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required.' });
        return true;
      }

      const reqRate = await checkRateLimitAsync(`conn_request:${authUser.id}`, RATE_LIMITS.CONNECTION_REQUEST.max, RATE_LIMITS.CONNECTION_REQUEST.windowMs, RATE_LIMITS.CONNECTION_REQUEST.op);
      if (!reqRate.allowed) {
        sendRateLimitExceeded(res, reqRate);
        return true;
      }

      const body = await parseJsonBody(req);
      if (!isDatabaseAvailable()) {
        const restRes = await connectUserRest(authUser, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      try {
        const targetUserId = (body.targetUserId || body.target_user_id || '').trim();
        const relationshipType = (body.relationshipType || body.relationship_type || 'Friend').trim();
        const requestedVia = (body.requestedVia || body.source || 'search').trim();
        const pgRes = await createSearchConnectionRequestPg(authUser, targetUserId, relationshipType, requestedVia);
        sendJson(res, pgRes.status, pgRes.body);
        return true;
      } catch (pgErr) {
        console.warn('[PG Connection Request Fallback]:', (pgErr as any)?.message);
        const restRes = await connectUserRest(authUser, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
    }

    // 10D. LIST CONNECTION REQUESTS & ACTIVE CONNECTIONS: GET /api/udhar/connections/requests
    if (pathname === '/api/udhar/connections/requests' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required.' });
        return true;
      }

      if (!isDatabaseAvailable()) {
        const restRes = await getConnectionRequestsRest(authUser);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      try {
        let rowsRes: any;
        try {
          rowsRes = await query(
            `SELECT uc.id, uc.user_a_id, uc.user_b_id, uc.status, uc.relationship_type, uc.requested_via, uc.connection_method, uc.created_at,
                    ua.full_name AS a_name, ua.avatar_url AS a_avatar, COALESCE(ua.email_verified, TRUE) AS a_verified,
                    ub.full_name AS b_name, ub.avatar_url AS b_avatar, COALESCE(ub.email_verified, TRUE) AS b_verified
             FROM public.user_connections uc
             LEFT JOIN public.app_users ua ON uc.user_a_id = ua.id
             LEFT JOIN public.app_users ub ON uc.user_b_id = ub.id
             WHERE (uc.user_a_id = $1 OR uc.user_b_id = $1)
               AND uc.status IN ('pending', 'connected')
             ORDER BY uc.created_at DESC`,
            [authUser.id]
          );
        } catch {
          rowsRes = await query(
            `SELECT uc.id, uc.user_a_id, uc.user_b_id, uc.status, uc.created_at,
                    ua.full_name AS a_name, ua.avatar_url AS a_avatar, COALESCE(ua.email_verified, TRUE) AS a_verified,
                    ub.full_name AS b_name, ub.avatar_url AS b_avatar, COALESCE(ub.email_verified, TRUE) AS b_verified
             FROM public.user_connections uc
             LEFT JOIN public.app_users ua ON uc.user_a_id = ua.id
             LEFT JOIN public.app_users ub ON uc.user_b_id = ub.id
             WHERE (uc.user_a_id = $1 OR uc.user_b_id = $1)
               AND uc.status IN ('pending', 'connected')
             ORDER BY uc.created_at DESC`,
            [authUser.id]
          );
        }

        const incoming: any[] = [];
        const outgoing: any[] = [];
        const seenIncomingUsers = new Set<string>();
        const seenOutgoingUsers = new Set<string>();
        const connectedMap = new Map<string, any>();

        for (const r of rowsRes.rows) {
          if (r.status === 'pending') {
            if (r.user_b_id === authUser.id) {
              if (seenIncomingUsers.has(r.user_a_id)) continue;
              seenIncomingUsers.add(r.user_a_id);
              incoming.push({
                id: r.id,
                direction: 'incoming',
                requesterUserId: r.user_a_id,
                displayName: r.a_name || 'My Money User',
                avatarUrl: r.a_avatar || null,
                isVerified: Boolean(r.a_verified),
                status: 'pending',
                relationshipType: r.relationship_type || 'Friend',
                requestedVia: r.requested_via || 'search',
                connectionMethod: r.connection_method || 'SEARCH',
                createdAt: r.created_at,
              });
            } else if (r.user_a_id === authUser.id) {
              if (seenOutgoingUsers.has(r.user_b_id)) continue;
              seenOutgoingUsers.add(r.user_b_id);
              outgoing.push({
                id: r.id,
                direction: 'outgoing',
                targetUserId: r.user_b_id,
                displayName: r.b_name || 'My Money User',
                avatarUrl: r.b_avatar || null,
                isVerified: Boolean(r.b_verified),
                status: 'pending',
                relationshipType: r.relationship_type || 'Friend',
                requestedVia: r.requested_via || 'search',
                connectionMethod: r.connection_method || 'SEARCH',
                createdAt: r.created_at,
              });
            }
          } else if (r.status === 'connected') {
            const isA = r.user_a_id === authUser.id;
            const otherId = isA ? r.user_b_id : r.user_a_id;
            if (otherId && !connectedMap.has(otherId)) {
              connectedMap.set(otherId, {
                id: r.id,
                userId: otherId,
                displayName: (isA ? r.b_name : r.a_name) || 'My Money User',
                avatarUrl: (isA ? r.b_avatar : r.a_avatar) || null,
                isVerified: Boolean(isA ? r.b_verified : r.a_verified),
                status: 'connected',
                relationshipType: r.relationship_type || 'Friend',
                connectionMethod: r.connection_method || 'SEARCH',
                createdAt: r.created_at,
              });
            }
          }
        }

        sendJson(res, 200, {
          success: true,
          incoming,
          outgoing,
          connected: Array.from(connectedMap.values()),
        });
        return true;
      } catch (pgErr) {
        console.warn('[PG Connection Requests Fallback]:', (pgErr as any)?.message);
        const restRes = await getConnectionRequestsRest(authUser);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
    }

    // 10E. ACCEPT CONNECTION REQUEST: POST /api/udhar/connections/:id/accept
    const connAcceptMatch = pathname.match(/^\/api\/udhar\/connections\/([a-zA-Z0-9_:%-]+)\/accept$/);
    if (connAcceptMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required.' });
        return true;
      }

      const key = decodeURIComponent(connAcceptMatch[1]);
      if (!isDatabaseAvailable()) {
        const restRes = await acceptConnectionRequestRest(authUser, key);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      try {
        const pgRes = await acceptConnectionRequestPg(authUser, key);
        sendJson(res, pgRes.status, pgRes.body);
        return true;
      } catch (pgErr) {
        console.warn('[PG Accept Connection Fallback]:', (pgErr as any)?.message);
        const restRes = await acceptConnectionRequestRest(authUser, key);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
    }

    // 10F. REJECT CONNECTION REQUEST: POST /api/udhar/connections/:id/reject
    const connRejectMatch = pathname.match(/^\/api\/udhar\/connections\/([a-zA-Z0-9_:%-]+)\/reject$/);
    if (connRejectMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required.' });
        return true;
      }

      const key = decodeURIComponent(connRejectMatch[1]);
      if (!isDatabaseAvailable()) {
        const restRes = await rejectConnectionRequestRest(authUser, key);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      try {
        const pgRes = await rejectConnectionRequestPg(authUser, key);
        sendJson(res, pgRes.status, pgRes.body);
        return true;
      } catch (pgErr) {
        console.warn('[PG Reject Connection Fallback]:', (pgErr as any)?.message);
        const restRes = await rejectConnectionRequestRest(authUser, key);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
    }

    // 10F-2. CANCEL OUTGOING CONNECTION REQUEST: POST /api/udhar/connections/:id/cancel
    const connCancelMatch = pathname.match(/^\/api\/udhar\/connections\/([a-zA-Z0-9_:%-]+)\/cancel$/);
    if (connCancelMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required.' });
        return true;
      }

      const key = decodeURIComponent(connCancelMatch[1]);
      if (!isDatabaseAvailable()) {
        const restRes = await cancelConnectionRequestRest(authUser, key);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      try {
        const pgRes = await cancelConnectionRequestPg(authUser, key);
        sendJson(res, pgRes.status, pgRes.body);
        return true;
      } catch (pgErr) {
        console.warn('[PG Cancel Connection Fallback]:', (pgErr as any)?.message);
        const restRes = await cancelConnectionRequestRest(authUser, key);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
    }

    // 10G. INSTANT TWO-SIDED CONNECTION REMOVAL: DELETE /api/udhar/connections/:id
    const connDeleteMatch = pathname.match(/^\/api\/udhar\/connections\/([a-zA-Z0-9_:%-]+)$/);
    if (connDeleteMatch && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required.' });
        return true;
      }

      const targetOrContactId = decodeURIComponent(connDeleteMatch[1]);
      if (!isDatabaseAvailable()) {
        const restRes = await removeSavedConnectionRest(authUser, targetOrContactId);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      try {
        const pgRes = await removeSavedConnectionPg(authUser, targetOrContactId);
        sendJson(res, pgRes.status, pgRes.body);
        return true;
      } catch (pgErr) {
        console.warn('[PG Remove Connection Fallback]:', (pgErr as any)?.message);
        const restRes = await removeSavedConnectionRest(authUser, targetOrContactId);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
    }

    // 10G-2. DISCONNECT / UNPAIR CONNECTION: POST /api/udhar/connections/disconnect
    if (pathname === '/api/udhar/connections/disconnect' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const targetUserId = (body.targetUserId || body.target_user_id || '').trim();
      if (!targetUserId) {
        sendJson(res, 400, { success: false, message: 'Target user ID is required.' });
        return true;
      }

      if (!isDatabaseAvailable()) {
        const restRes = await disconnectUserRest(authUser, targetUserId);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      try {
        const pgRes = await removeSavedConnectionPg(authUser, targetUserId);
        sendJson(res, pgRes.status, {
          ...pgRes.body,
          status: 'disconnected',
        });
        return true;
      } catch (pgErr) {
        console.warn('[PG Disconnect Fallback]:', (pgErr as any)?.message);
        const restRes = await disconnectUserRest(authUser, targetUserId);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
    }

    // 10B. INVITE CONTACT VIA EMAIL: POST /api/udhar/contacts/:id/invite
    const contactInviteMatch = pathname.match(/^\/api\/udhar\/contacts\/([a-zA-Z0-9_-]+)\/invite$/);
    if (contactInviteMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      if (!isDatabaseAvailable()) {
        sendJson(res, 503, { success: false, message: 'Contact invitation service requires an active database connection.' });
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

      // Check if already registered -> send consent-based connection request instead of silently auto-connecting
      const regUserCheck = await query(
        'SELECT id, full_name, email FROM public.app_users WHERE LOWER(email) = LOWER($1)',
        [contact.email]
      );
      if (regUserCheck.rows.length > 0) {
        const regUser = regUserCheck.rows[0];
        const reqResult = await createSearchConnectionRequestPg(
          authUser,
          regUser.id,
          contact.relationship_type || 'Friend',
          'search'
        );
        sendJson(res, reqResult.status, {
          ...reqResult.body,
          alreadyRegistered: true,
          linkedUserId: regUser.id,
        });
        return true;
      }

      // Generate secure invitation token
      const tokenHash = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
      const appBaseUrl = APP_CONFIG.appBaseUrl || 'https://mymoney.nileshbarela.site';
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
        sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required.' });
        return true;
      }

      const rate = await checkRateLimitAsync(`user_search:${authUser.id}`, RATE_LIMITS.PEOPLE_SEARCH.max, RATE_LIMITS.PEOPLE_SEARCH.windowMs, RATE_LIMITS.PEOPLE_SEARCH.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      const rawQ = (parsed.query.q as string) || '';
      const classified = classifyLiveSearchQuery(rawQ);
      if (classified.mode === 'too_short') {
        sendJson(res, 200, { success: true, users: [], searchMode: 'too_short' });
        return true;
      }
      if (classified.mode === 'email_incomplete') {
        sendJson(res, 200, {
          success: true,
          users: [],
          searchMode: 'email_incomplete',
          hint: 'Enter the complete email address to find a user.',
        });
        return true;
      }
      if (classified.mode === 'phone_incomplete') {
        sendJson(res, 200, {
          success: true,
          users: [],
          searchMode: 'phone_incomplete',
          hint: 'Enter a complete 10-digit mobile number to search.',
        });
        return true;
      }

      if (!isDatabaseAvailable()) {
        const restRes = await searchUsersRest(authUser, rawQ);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      try {
        let whereMatchSql = '';
        let queryParams: any[] = [];

        if (classified.mode === 'email_exact') {
          whereMatchSql = `LOWER(TRIM(u.email)) = $2`;
          queryParams = [authUser.id, classified.normalized];
        } else if (classified.mode === 'phone_exact') {
          whereMatchSql = `(
            REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g') = $2
            OR RIGHT(REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g'), 10) = $3
          ) AND LENGTH(REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g')) >= 10`;
          queryParams = [authUser.id, classified.digitsOnly, classified.last10Digits];
        } else {
          whereMatchSql = `(LOWER(u.full_name) LIKE $2 OR LOWER(COALESCE(u.email, '')) LIKE $2)`;
          queryParams = [authUser.id, `%${classified.normalized}%`];
        }

        const usersRes = await query(
          `SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.role, u.status,
             COALESCE(u.deletion_status, 'none') AS deletion_status,
             COALESCE(u.email_verified, TRUE) AS is_verified,
             (
               SELECT uc.status FROM public.user_connections uc
               WHERE (uc.user_a_id = $1 AND uc.user_b_id = u.id)
                  OR (uc.user_b_id = $1 AND uc.user_a_id = u.id)
               ORDER BY CASE uc.status WHEN 'blocked' THEN 1 WHEN 'connected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END
               LIMIT 1
             ) AS conn_status,
             (
               SELECT uc.user_a_id FROM public.user_connections uc
               WHERE ((uc.user_a_id = $1 AND uc.user_b_id = u.id) OR (uc.user_b_id = $1 AND uc.user_a_id = u.id))
                 AND uc.status = 'pending'
               LIMIT 1
             ) AS pending_requester_id,
             (
               SELECT uc.id FROM public.user_connections uc
               WHERE ((uc.user_a_id = $1 AND uc.user_b_id = u.id) OR (uc.user_b_id = $1 AND uc.user_a_id = u.id))
                 AND uc.status = 'pending'
               LIMIT 1
             ) AS pending_request_id,
             EXISTS(
               SELECT 1 FROM public.udhar_contacts c
               WHERE c.user_id = $1 AND c.linked_user_id = u.id
             ) AS is_saved_contact
           FROM public.app_users u
           WHERE u.status = 'active'
           AND COALESCE(u.deletion_status, 'none') = 'none'
           AND COALESCE(LOWER(u.role), 'user') = 'user'
           AND LOWER(TRIM(COALESCE(u.email, ''))) NOT IN ('admin@mymoney.com', 'hackifypro@gmail.com')
           AND NOT EXISTS (
               SELECT 1 FROM public.user_connections blk
               WHERE ((blk.user_a_id = $1 AND blk.user_b_id = u.id) OR (blk.user_b_id = $1 AND blk.user_a_id = u.id))
                 AND blk.status = 'blocked'
             )
             AND ${whereMatchSql}
           ORDER BY (u.id = $1) ASC, u.full_name ASC
           LIMIT 15`,
          queryParams
        );

        // Privacy-preserving output: partial name search NEVER exposes email or phone before consent
        const sanitizedUsers = usersRes.rows
          .filter((u: any) => isDiscoverableNormalUser(u))
          .map((u: any) => {
          const isSelf = u.id === authUser.id;
          const isConnected = !isSelf && (u.conn_status === 'connected' || Boolean(u.is_saved_contact));
          const isIncomingPending = !isSelf && !isConnected && u.conn_status === 'pending' && u.pending_requester_id === u.id;
          const isOutgoingPending = !isSelf && !isConnected && u.conn_status === 'pending' && u.pending_requester_id === authUser.id;
          const connectionStatus = isSelf
            ? 'self'
            : isConnected
              ? 'connected'
              : isOutgoingPending
                ? 'pending'
                : isIncomingPending
                  ? 'incoming_pending'
                  : 'none';
          const showContactHint = isConnected || isSelf;
          return {
            id: u.id,
            displayName: u.full_name || (u.email ? u.email.split('@')[0] : 'My Money User'),
            fullName: u.full_name || (u.email ? u.email.split('@')[0] : 'My Money User'),
            username: u.email ? u.email.split('@')[0] : null,
            accountIndicator: 'My Money Manager Account',
            emailMasked: showContactHint ? maskEmailForPrivacy(u.email) : undefined,
            phoneMasked: showContactHint ? maskPhoneForPrivacy(u.phone) : null,
            avatarUrl: u.avatar_url || null,
            isSelf,
            isVerified: Boolean(u.is_verified),
            connectionStatus,
            requestId: u.pending_request_id || null,
            isAlreadyConnected: isConnected,
            isSavedContact: Boolean(u.is_saved_contact),
          };
        });

        sendJson(res, 200, { success: true, users: sanitizedUsers, searchMode: classified.mode });
        return true;
      } catch (pgErr) {
        console.warn('[PG User Search Fallback]:', (pgErr as any)?.message);
        const restRes = await searchUsersRest(authUser, rawQ);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
    }

    // =========================================================================
    // SECTION D: USER-SPECIFIC UDHAR PAIRING QR CODES & CONSENT-BASED PAIRING
    // =========================================================================

    // 12. GET MY QR CODE: GET /api/udhar/qr/my-code
    if (pathname === '/api/udhar/qr/my-code' && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required. Please log in.' });
        return true;
      }

      const rate = await checkRateLimitAsync(`qr_generate:${authUser.id}`, RATE_LIMITS.QR_GENERATION.max, RATE_LIMITS.QR_GENERATION.windowMs, RATE_LIMITS.QR_GENERATION.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      if (!isDatabaseAvailable()) {
        const restRes = await getMyQrRest(authUser);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      try {
        let pairingToken = '';
        let pairingCode = '';
        let expiresAt: any = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

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
          publicName: authUser.full_name || 'My Money User',
          avatarUrl: authUser.avatar_url || null,
          qrData: qrPayload,
          expiresAt,
        });
        return true;
      } catch (pgErr) {
        console.warn('[PG My QR Fallback]:', (pgErr as any)?.message);
        const restRes = await getMyQrRest(authUser);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
    }

    // 13. RESOLVE QR CODE: POST /api/udhar/qr/resolve
    if (pathname === '/api/udhar/qr/resolve' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required. Please log in.' });
        return true;
      }

      const qrRate = await checkRateLimitAsync(`qr_resolve:${authUser.id}`, RATE_LIMITS.QR_SCAN_VALIDATE.max, RATE_LIMITS.QR_SCAN_VALIDATE.windowMs, RATE_LIMITS.QR_SCAN_VALIDATE.op);
      if (!qrRate.allowed) {
        sendRateLimitExceeded(res, qrRate);
        return true;
      }

      const body = await parseJsonBody(req);
      if (!isDatabaseAvailable()) {
        const restRes = await resolveQrRest(authUser, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      try {
        let targetToken = (body.pairingToken || '').trim();
        let targetCode = (body.pairingCode || '').replace(/\s+/g, '').trim().toUpperCase();
        const rawData = (body.qrData || '').trim();

        if (rawData) {
          const parsedQr = parseQrPayload(rawData);
          if (!parsedQr.valid) {
            sendJson(res, 400, {
              success: false,
              code: parsedQr.errorCode || 'INVALID_QR',
              message: parsedQr.error || 'Invalid QR format. Please scan a genuine My Money Manager Udhar pairing QR.',
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
          `SELECT t.id, t.user_id, t.pairing_token, t.pairing_code, t.expires_at, t.used, t.is_single_use, t.used_at,
                  u.id as account_id, u.full_name, u.email, u.phone, u.avatar_url, u.role, u.status,
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
            message: 'Pairing code or QR not recognized. Ask your friend to share their latest My Money Manager Udhar Pairing QR.',
          });
          return true;
        }

        const qrRecord = tokenRes.rows[0];

        if (qrRecord.used || (qrRecord.is_single_use && qrRecord.used_at)) {
          sendJson(res, 410, {
            success: false,
            code: 'QR_REVOKED',
            message: 'This pairing QR has already been used or revoked. Ask your friend to share their newer Udhar Pairing QR.',
          });
          return true;
        }

        if (new Date(qrRecord.expires_at) <= new Date()) {
          sendJson(res, 410, {
            success: false,
            code: 'QR_EXPIRED',
            message: 'This pairing QR has expired. Ask your friend to tap Reset QR to get a fresh code.',
          });
          return true;
        }

        if (!isDiscoverableNormalUser(qrRecord)) {
          sendJson(res, 403, {
            success: false,
            code: 'ACCOUNT_UNAVAILABLE',
            message: 'This user account is currently deactivated or unavailable for Udhar connections.',
          });
          return true;
        }

        if (qrRecord.user_id === authUser.id) {
          sendJson(res, 400, {
            success: false,
            code: 'SELF_CONNECTION',
            message: 'This is your own Udhar pairing QR. You cannot pair with yourself.',
          });
          return true;
        }

        const connRes = await query(
          `SELECT id, user_a_id, user_b_id, status FROM public.user_connections
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
        const outgoingPending = connRes.rows.find((r: any) => r.user_a_id === authUser.id && r.status === 'pending');
        const incomingPending = connRes.rows.find((r: any) => r.user_b_id === authUser.id && r.status === 'pending');
        const connectionStatus = isAlreadyConnected
          ? 'connected'
          : outgoingPending
            ? 'pending'
            : incomingPending
              ? 'incoming_pending'
              : 'none';

        sendJson(res, 200, {
          success: true,
          owner: {
            id: qrRecord.user_id,
            displayName: qrRecord.full_name || 'My Money User',
            fullName: qrRecord.full_name || 'My Money User',
            accountIndicator: 'My Money Manager Account',
            emailMasked: isAlreadyConnected ? maskEmailForPrivacy(qrRecord.email) : undefined,
            phoneMasked: isAlreadyConnected ? maskPhoneForPrivacy(qrRecord.phone) : null,
            avatarUrl: qrRecord.avatar_url || null,
            isVerified: true,
          },
          pairingToken: qrRecord.pairing_token,
          pairingCode: qrRecord.pairing_code,
          isAlreadyConnected,
          connectionStatus,
          requestId: outgoingPending?.id || incomingPending?.id || null,
        });
        return true;
      } catch (pgErr) {
        console.warn('[PG QR Resolve Fallback]:', (pgErr as any)?.message);
        const restRes = await resolveQrRest(authUser, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
    }

    // 13B. REGENERATE QR CODE: POST /api/udhar/qr/regenerate
    if (pathname === '/api/udhar/qr/regenerate' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required. Please log in.' });
        return true;
      }

      const rate = await checkRateLimitAsync(`qr_generate:${authUser.id}`, RATE_LIMITS.QR_GENERATION.max, RATE_LIMITS.QR_GENERATION.windowMs, RATE_LIMITS.QR_GENERATION.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      if (!isDatabaseAvailable()) {
        const restRes = await regenerateQrRest(authUser);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      try {
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
          message: 'Fresh pairing QR generated successfully. Previous QR codes have been revoked.',
          pairingToken,
          pairingCode,
          publicName: authUser.full_name || 'My Money User',
          avatarUrl: authUser.avatar_url || null,
          qrData: qrPayload,
          expiresAt,
        });
        return true;
      } catch (pgErr) {
        console.warn('[PG QR Regenerate Fallback]:', (pgErr as any)?.message);
        const restRes = await regenerateQrRest(authUser);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
    }

    // 14. DIRECT CONNECTION VIA QR CODE OR CONFIRMATION CODE (METHOD B): POST /api/udhar/qr/connect
    if (pathname === '/api/udhar/qr/connect' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required.' });
        return true;
      }

      const qrConnRate = await checkRateLimitAsync(`conn_request:${authUser.id}`, RATE_LIMITS.CONNECTION_REQUEST.max, RATE_LIMITS.CONNECTION_REQUEST.windowMs, RATE_LIMITS.CONNECTION_REQUEST.op);
      if (!qrConnRate.allowed) {
        sendRateLimitExceeded(res, qrConnRate);
        return true;
      }

      const body = await parseJsonBody(req);
      if (!isDatabaseAvailable()) {
        const restRes = await connectQrRest(authUser, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      try {
        let pairingToken = (body.pairingToken || '').trim();
        let pairingCode = (body.pairingCode || '').replace(/\s+/g, '').trim().toUpperCase();
        const rawData = (body.qrData || '').trim();
        if (rawData) {
          const parsedQr = parseQrPayload(rawData);
          if (!parsedQr.valid) {
            sendJson(res, 400, {
              success: false,
              code: parsedQr.errorCode || 'INVALID_QR',
              message: parsedQr.error || 'Invalid QR format.',
            });
            return true;
          }
          if (parsedQr.token) pairingToken = parsedQr.token;
          if (parsedQr.code) pairingCode = parsedQr.code;
        }

        const rawMethod = String(body.connectionMethod || body.entryMethod || '').trim().toUpperCase();
        const connectionMethod: 'QR_CODE' | 'CONFIRMATION_CODE' =
          rawMethod === 'CONFIRMATION_CODE' ||
          rawMethod === 'CODE' ||
          (!rawData && !body.pairingToken && Boolean(pairingCode))
            ? 'CONFIRMATION_CODE'
            : 'QR_CODE';
        const requestedVia = connectionMethod === 'CONFIRMATION_CODE' ? 'confirmation_code' : 'qr';
        const relationshipType = (body.relationshipType || 'Friend').trim();

        const tokenRes = await query(
          `SELECT t.id, t.user_id, t.is_single_use, u.full_name, u.email, u.phone, u.avatar_url, u.role, u.status,
                  COALESCE(u.deletion_status, 'none') AS deletion_status
           FROM public.qr_pairing_tokens t
           JOIN public.app_users u ON t.user_id = u.id
           WHERE (t.pairing_token = $1 OR t.pairing_code = $2) AND t.expires_at > NOW() AND t.used = FALSE`,
          [pairingToken || '__none__', pairingCode || '__none__']
        );

        if (tokenRes.rows.length === 0) {
          sendJson(res, 410, {
            success: false,
            code: 'QR_INVALID_OR_EXPIRED',
            message: 'Pairing QR or confirmation code is expired, revoked, or invalid.',
          });
          return true;
        }

        const tokenRecord = tokenRes.rows[0];
        const targetUserId = tokenRecord.user_id;

        if (!isDiscoverableNormalUser(tokenRecord)) {
          sendJson(res, 403, { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'This user account is currently deactivated or unavailable.' });
          return true;
        }

        if (targetUserId === authUser.id) {
          sendJson(res, 400, { success: false, code: 'SELF_CONNECTION', message: 'Cannot pair with your own QR code.' });
          return true;
        }

        const existingConn = await query(
          `SELECT id, user_a_id, user_b_id, status FROM public.user_connections
           WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)`,
          [authUser.id, targetUserId]
        );
        if (existingConn.rows.some((r: any) => r.status === 'blocked')) {
          sendJson(res, 403, { success: false, code: 'BLOCKED', message: 'Connection is blocked between these accounts.' });
          return true;
        }

        const targetDisplayName = (tokenRecord.full_name || tokenRecord.email?.split('@')[0] || 'Friend').trim();
        const requesterDisplayName = (authUser.full_name || authUser.email?.split('@')[0] || 'A user').trim();

        // Already connected -> ensure Saved People entries exist for both users without duplicate notifications
        if (existingConn.rows.some((r: any) => r.status === 'connected')) {
          await ensureReciprocalContact(
            authUser.id,
            {
              id: targetUserId,
              full_name: targetDisplayName,
              email: tokenRecord.email,
              phone: tokenRecord.phone,
              avatar_url: tokenRecord.avatar_url,
            },
            relationshipType
          );
          await ensureReciprocalContact(targetUserId, authUser, relationshipType);
          sendJson(res, 200, {
            success: true,
            status: 'connected',
            alreadyConnected: true,
            connectionMethod,
            title: 'Already Connected',
            message: 'Already Connected',
            connectedUser: {
              id: targetUserId,
              name: targetDisplayName,
              displayName: targetDisplayName,
              fullName: targetDisplayName,
              avatarUrl: tokenRecord.avatar_url || null,
              isVerified: true,
            },
          });
          return true;
        }

        // Method B: Immediate direct two-way connection after QR/code validation — NO pending request, NO Accept/Reject
        let connId: string | null = null;
        try {
          const insConn = await query(
            `INSERT INTO public.user_connections (user_a_id, user_b_id, status, relationship_type, requested_via, connection_method, consented_at, responded_at, updated_at)
             VALUES ($1, $2, 'connected', $3, $4, $5, NOW(), NOW(), NOW())
             ON CONFLICT (user_a_id, user_b_id) DO UPDATE
             SET status = 'connected',
                 relationship_type = EXCLUDED.relationship_type,
                 requested_via = EXCLUDED.requested_via,
                 connection_method = EXCLUDED.connection_method,
                 consented_at = NOW(),
                 responded_at = NOW(),
                 cancelled_at = NULL,
                 deleted_at = NULL,
                 deleted_by = NULL,
                 updated_at = NOW()
             RETURNING id`,
            [authUser.id, targetUserId, relationshipType, requestedVia, connectionMethod]
          );
          connId = insConn.rows[0]?.id ? String(insConn.rows[0].id) : null;
          await query(
            `INSERT INTO public.user_connections (user_a_id, user_b_id, status, relationship_type, requested_via, connection_method, consented_at, responded_at, updated_at)
             VALUES ($1, $2, 'connected', $3, $4, $5, NOW(), NOW(), NOW())
             ON CONFLICT (user_a_id, user_b_id) DO UPDATE
             SET status = 'connected',
                 relationship_type = EXCLUDED.relationship_type,
                 requested_via = EXCLUDED.requested_via,
                 connection_method = EXCLUDED.connection_method,
                 consented_at = NOW(),
                 responded_at = NOW(),
                 cancelled_at = NULL,
                 deleted_at = NULL,
                 deleted_by = NULL,
                 updated_at = NOW()`,
            [targetUserId, authUser.id, relationshipType, requestedVia, connectionMethod]
          ).catch(() => {});
        } catch {
          const insConn = await query(
            `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
             VALUES ($1, $2, 'connected')
             ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'
             RETURNING id`,
            [authUser.id, targetUserId]
          );
          connId = insConn.rows[0]?.id ? String(insConn.rows[0].id) : null;
          await query(
            `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
             VALUES ($1, $2, 'connected')
             ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
            [targetUserId, authUser.id]
          ).catch(() => {});
        }

        // Add both users to each other's Saved People (udhar_contacts) immediately
        await ensureReciprocalContact(
          authUser.id,
          {
            id: targetUserId,
            full_name: targetDisplayName,
            email: tokenRecord.email,
            phone: tokenRecord.phone,
            avatar_url: tokenRecord.avatar_url,
          },
          relationshipType
        );
        await ensureReciprocalContact(targetUserId, authUser, relationshipType);

        // Resolve any previously pending search request notifications cleanly without duplicates
        const pendingRow = existingConn.rows.find((r: any) => r.status === 'pending');
        await Promise.all([
          updateConnectionRequestNotificationsState({
            requestId: pendingRow?.id ? String(pendingRow.id) : null,
            requesterId: authUser.id,
            receiverId: targetUserId,
            status: 'accepted',
          }).catch(() => {}),
          updateConnectionRequestNotificationsState({
            requestId: pendingRow?.id ? String(pendingRow.id) : null,
            requesterId: targetUserId,
            receiverId: authUser.id,
            status: 'accepted',
          }).catch(() => {}),
        ]);

        if (tokenRecord.is_single_use) {
          await query(
            `UPDATE public.qr_pairing_tokens SET used = TRUE, used_by_user_id = $1, used_at = NOW() WHERE id = $2`,
            [authUser.id, tokenRecord.id]
          );
        }

        await notifyQrConnected({
          userAId: authUser.id,
          userAName: requesterDisplayName,
          userAAvatar: authUser.avatar_url || null,
          userBId: targetUserId,
          userBName: targetDisplayName,
          connectionMethod,
          connectionId: connId,
        }).catch(() => {});

        await logSecurityEvent('UDHAR_QR_DIRECT_CONNECTED', {
          userId: authUser.id,
          userEmail: authUser.email,
          details: { targetUserId, targetName: targetDisplayName, connectionMethod, connectionId: connId },
        });

        sendJson(res, 200, {
          success: true,
          status: 'connected',
          alreadyConnected: false,
          connectionMethod,
          connectionId: connId,
          title: 'Connection Added Successfully',
          message: `${targetDisplayName} has been added to your Saved People.`,
          connectedUser: {
            id: targetUserId,
            name: targetDisplayName,
            displayName: targetDisplayName,
            fullName: targetDisplayName,
            avatarUrl: tokenRecord.avatar_url || null,
            isVerified: true,
          },
        });
        return true;
      } catch (pgErr) {
        console.warn('[PG QR Connect Fallback]:', (pgErr as any)?.message);
        const restRes = await connectQrRest(authUser, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }
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
        if (!isActiveRepayment(rep)) continue;
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

      const activeTxRows = txRes.rows.filter((r: any) => normalizeUdharLifecycleStatus(r) !== 'deleted');
      const transactions = activeTxRows.map((r: any) => {
        const orig = parseFloat(r.original_amount) || 0;
        const cur = parseFloat(r.current_balance) || 0;
        const computedPaid = Math.max(0, roundMoney(orig - cur));
        const { note, meta } = unpackStructuredNote(r.notes);
        const normalizedStatus = normalizeUdharLifecycleStatus(r);
        return {
          ...r,
          status: normalizedStatus,
          creation_method: (r.creation_method || meta.creation_method || 'manual') as UdharCreationMethod,
          accepted_by: r.accepted_by || meta.accepted_by || null,
          rejected_by: r.rejected_by || meta.rejected_by || null,
          cancelled_by: r.cancelled_by || meta.cancelled_by || null,
          responded_at: r.responded_at || meta.responded_at || null,
          cancelled_at: r.cancelled_at || meta.cancelled_at || null,
          rejection_reason: r.rejection_reason || meta.rejection_reason || null,
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

    // 16. CREATE UDHAAR TRANSACTION (METHOD A MANUAL -> PENDING_CONFIRMATION; METHOD B QR/CODE -> INSTANT CONFIRMED)
    // Supports POST /api/udhar/transactions and POST /api/udhar/qr/create-transaction
    if (
      (pathname === '/api/udhar/transactions' || pathname === '/api/udhar/qr/create-transaction') &&
      method === 'POST'
    ) {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const rate = await checkRateLimitAsync(`udhar_create:${authUser.id}`, RATE_LIMITS.UDHAR_CREATE.max, RATE_LIMITS.UDHAR_CREATE.windowMs, RATE_LIMITS.UDHAR_CREATE.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      const body = await parseJsonBody(req);
      const isExplicitQrEndpoint = pathname === '/api/udhar/qr/create-transaction';

      if (!isDatabaseAvailable()) {
        const restRes = isExplicitQrEndpoint
          ? await createUdharViaQrRest(authUser, body)
          : await createUdharTransactionRest(authUser, body);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      let counterpartName = (body.counterpart_name || body.person_name || '').trim();
      const counterpartUserId = (body.counterpart_user_id || body.counterpartUserId || '').trim() || null;
      let qrToken = (body.qr_token || body.qrToken || body.pairingToken || '').trim();
      let pairingCode = (body.pairing_code || body.pairingCode || '').replace(/\s+/g, '').trim().toUpperCase();
      const qrDataRaw = (body.qrData || body.qr_data || '').trim();
      const direction = body.direction;
      const amount = roundMoney(parseFloat(body.amount));
      const txDate = body.transaction_date || body.date || new Date().toISOString().split('T')[0];
      const dueDate = body.due_date || body.dueDate || null;
      const plainNotes = (body.notes || '').trim();
      const category = (body.category || 'Personal Loan').trim();
      const paymentMethod = (body.payment_method || body.paymentMethod || 'UPI').trim();
      const description = (body.description || '').trim();
      const attCheck = sanitizeAttachmentUrlInput(body.attachment_url);
      if (!attCheck.valid) {
        sendJson(res, 400, { success: false, code: 'INVALID_ATTACHMENT', message: attCheck.error || 'Invalid attachment.' });
        return true;
      }
      const attachmentUrl = attCheck.value;
      const idempotencyKey = (body.idempotency_key || body.idempotencyKey || '').trim() || null;

      if (isExplicitQrEndpoint && !qrToken && !pairingCode && !qrDataRaw) {
        sendJson(res, 400, { success: false, code: 'QR_OR_CODE_REQUIRED', message: 'A valid QR token or confirmation code is required.' });
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

      let isRegisteredCounterpart = false;
      let registeredUser: any = null;
      let verifiedCreationMethod: UdharCreationMethod = 'manual';
      let singleUseTokenRecordId: string | null = null;

      if (qrToken || pairingCode || qrDataRaw) {
        if (qrDataRaw) {
          const parsedQr = parseQrPayload(qrDataRaw);
          if (!parsedQr.valid) {
            sendJson(res, 400, {
              success: false,
              code: parsedQr.errorCode || 'INVALID_QR',
              message: parsedQr.error || 'Invalid QR format. Please scan a genuine My Money Manager Udhar QR.',
            });
            return true;
          }
          if (parsedQr.token) qrToken = parsedQr.token;
          if (parsedQr.code) pairingCode = parsedQr.code;
        }

        if (!qrToken && !pairingCode) {
          sendJson(res, 400, { success: false, code: 'INVALID_QR', message: 'No valid QR token or confirmation code provided.' });
          return true;
        }

        const tokenRes = await query(
          `SELECT t.id, t.user_id, t.expires_at, t.used, t.is_single_use, t.used_at,
                  u.id AS account_id, u.full_name, u.email, u.phone, u.avatar_url, u.role, u.status,
                  COALESCE(u.deletion_status, 'none') AS deletion_status
           FROM public.qr_pairing_tokens t
           JOIN public.app_users u ON t.user_id = u.id
           WHERE (t.pairing_token = $1 OR t.pairing_code = $2)
           ORDER BY t.created_at DESC LIMIT 1`,
          [qrToken || '__none__', pairingCode || '__none__']
        );

        if (tokenRes.rows.length === 0) {
          sendJson(res, 404, { success: false, code: 'NOT_FOUND', message: 'Confirmation code or QR not recognized.' });
          return true;
        }
        const qrRecord = tokenRes.rows[0];
        if (qrRecord.used || (qrRecord.is_single_use && qrRecord.used_at)) {
          sendJson(res, 410, { success: false, code: 'QR_REVOKED', message: 'This QR or code has already been revoked or replaced.' });
          return true;
        }
        if (new Date(qrRecord.expires_at) <= new Date()) {
          sendJson(res, 410, { success: false, code: 'QR_EXPIRED', message: 'This QR or confirmation code has expired.' });
          return true;
        }
        if (!isDiscoverableNormalUser(qrRecord)) {
          sendJson(res, 403, { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'Target user account is unavailable for shared Udhar.' });
          return true;
        }
        if (qrRecord.user_id === authUser.id) {
          sendJson(res, 400, { success: false, code: 'SELF_CONNECTION', message: 'You cannot add an Udhar with your own QR or code.' });
          return true;
        }
        const blk = await query(
          `SELECT 1 FROM public.user_connections
           WHERE ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))
             AND status = 'blocked' LIMIT 1`,
          [authUser.id, qrRecord.user_id]
        );
        if (blk.rows.length > 0) {
          sendJson(res, 403, { success: false, code: 'BLOCKED', message: 'Cannot create shared Udhar with a blocked user.' });
          return true;
        }

        isRegisteredCounterpart = true;
        registeredUser = {
          id: qrRecord.user_id,
          full_name: qrRecord.full_name,
          email: qrRecord.email,
        };
        counterpartName = qrRecord.full_name || counterpartName || 'Friend';
        verifiedCreationMethod = qrToken || (qrDataRaw && qrDataRaw.startsWith('{')) ? 'qr' : 'code';
        if (qrRecord.is_single_use) singleUseTokenRecordId = qrRecord.id;
      } else if (counterpartUserId && counterpartUserId !== authUser.id) {
        const uCheck = await query(
          `SELECT id, full_name, email, role, status, COALESCE(deletion_status, 'none') AS deletion_status
           FROM public.app_users WHERE id = $1`,
          [counterpartUserId]
        );
        if (uCheck.rows.length > 0) {
          if (!isDiscoverableNormalUser(uCheck.rows[0])) {
            sendJson(res, 403, { success: false, code: 'ACCOUNT_UNAVAILABLE', message: 'Selected user account is not eligible for shared Udhar connections.' });
            return true;
          }
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
          counterpartName = counterpartName || registeredUser.full_name;
        }
      }

      if (!counterpartName) {
        sendJson(res, 400, { success: false, message: "Person's name is required." });
        return true;
      }

      const linkId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (isRegisteredCounterpart) {
          const isInstantQr = verifiedCreationMethod === 'qr' || verifiedCreationMethod === 'code';
          const initialLifecycle = isInstantQr ? 'confirmed' : 'pending_confirmation';
          const initialConfirmStatus = isInstantQr ? 'confirmed' : 'pending';

          const packedNotes = packStructuredNote(plainNotes, {
            category,
            payment_method: paymentMethod,
            description: description || undefined,
            attachment_url: attachmentUrl || undefined,
            creation_method: verifiedCreationMethod,
            lifecycle_status: initialLifecycle,
            accepted_by: isInstantQr ? registeredUser.id : undefined,
            responded_at: isInstantQr ? nowIso : undefined,
          });

          const userARes = await client.query(
            `INSERT INTO public.udhar_transactions (
              link_id, user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance, paid_amount,
              transaction_date, due_date, notes, attachment_url, status, confirmation_status, is_initiator, idempotency_key
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, $13, TRUE, $14)
            RETURNING *`,
            [linkId, authUser.id, registeredUser.id, registeredUser.full_name, direction, amount, amount, txDate, dueDate, packedNotes, attachmentUrl, initialLifecycle, initialConfirmStatus, idempotencyKey]
          );

          const counterpartDirection = direction === 'gave' ? 'took' : 'gave';
          await client.query(
            `INSERT INTO public.udhar_transactions (
              link_id, user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance, paid_amount,
              transaction_date, due_date, notes, attachment_url, status, confirmation_status, is_initiator, idempotency_key
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, $13, FALSE, $14)`,
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
              initialLifecycle,
              initialConfirmStatus,
              idempotencyKey ? `${idempotencyKey}:counterpart` : null,
            ]
          );

          if (singleUseTokenRecordId) {
            await client.query(
              `UPDATE public.qr_pairing_tokens SET used = TRUE, used_by_user_id = $1, used_at = NOW() WHERE id = $2`,
              [authUser.id, singleUseTokenRecordId]
            ).catch(() => {});
          }

          await client.query(
            `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
             VALUES ($1, $2, 'connected')
             ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
            [authUser.id, registeredUser.id]
          ).catch(() => {});
          await client.query(
            `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
             VALUES ($1, $2, 'connected')
             ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
            [registeredUser.id, authUser.id]
          ).catch(() => {});

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

          if (isInstantQr) {
            const viaLabel = verifiedCreationMethod === 'qr' ? 'QR code' : 'confirmation code';
            await client.query(
              `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
               VALUES ($1, $2, 'udhar_qr_confirmed', $3, $4, $5, TRUE)`,
              [
                `Instant Udhar Confirmed via ${viaLabel}`,
                `${authUser.full_name} added a confirmed Udhar of ₹${amount.toLocaleString('en-IN')} (${direction === 'gave' ? "You'll Pay" : "You'll Receive"}) via your ${viaLabel}.`,
                registeredUser.id,
                linkId,
                authUser.id,
              ]
            ).catch(() => {});
          } else {
            const dirHuman = direction === 'gave' ? 'gave you (You Borrowed)' : 'borrowed from you (You Gave)';
            await client.query(
              `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
               VALUES ($1, $2, 'udhar_request', $3, $4, $5, TRUE)`,
              [
                'New Udhaar Confirmation Request',
                `${authUser.full_name} added an Udhaar request of ₹${amount.toLocaleString('en-IN')} (${dirHuman}). Please review and confirm.`,
                registeredUser.id,
                linkId,
                authUser.id,
              ]
            ).catch(() => {});
          }

          await client.query('COMMIT');

          await ensureReciprocalContact(registeredUser.id, authUser, 'Friend');

          await logSecurityEvent(isInstantQr ? 'UDHAR_QR_INSTANT_CREATED' : 'UDHAR_REQUEST_CREATED', {
            userId: authUser.id,
            userEmail: authUser.email,
            details: { linkId, counterpartId: registeredUser.id, amount, direction, creationMethod: verifiedCreationMethod },
          });

          if (isInstantQr) {
            const viaLabel = verifiedCreationMethod === 'qr' ? 'QR code' : 'confirmation code';
            Promise.all([
              createNotification({
                userId: registeredUser.id,
                title: `Instant Udhar Confirmed via ${viaLabel}`,
                message: `${authUser.full_name} added a confirmed Udhar of ₹${amount.toLocaleString('en-IN')} (${direction === 'gave' ? "You'll Pay" : "You'll Receive"}) via your ${viaLabel}.`,
                category: 'udhar',
                type: 'success',
                deepLink: 'people',
                dedupeKey: `udhar_qr_rec_${linkId}`,
                metadata: { actionType: 'udhar_qr_confirmed', linkId, udharId: userARes.rows[0].id, amount, creationMethod: verifiedCreationMethod },
                channels: ['in_app', 'push'],
              }),
              createNotification({
                userId: authUser.id,
                title: `Udhar Added via ${viaLabel}`,
                message: `Your Udhar of ₹${amount.toLocaleString('en-IN')} with ${registeredUser.full_name} was confirmed immediately.`,
                category: 'udhar',
                type: 'success',
                deepLink: 'people',
                dedupeKey: `udhar_qr_init_${linkId}`,
                metadata: { actionType: 'udhar_qr_confirmed', linkId, udharId: userARes.rows[0].id, amount, creationMethod: verifiedCreationMethod },
                channels: ['in_app', 'push'],
              }),
            ]).catch(() => {});
          } else {
            const dirHuman = direction === 'gave' ? 'gave you (You Borrowed)' : 'borrowed from you (You Gave)';
            createNotification({
              userId: registeredUser.id,
              title: 'New Udhaar Confirmation Request',
              message: `${authUser.full_name} added an Udhaar request of ₹${amount.toLocaleString('en-IN')} (${dirHuman}). Please review and confirm.`,
              category: 'udhar',
              type: 'info',
              deepLink: 'people',
              dedupeKey: `udhar_req_${linkId}`,
              metadata: {
                actionType: 'udhar_confirmation_request',
                linkId,
                udharId: userARes.rows[0].id,
                requesterUserId: authUser.id,
                requesterName: authUser.full_name,
                amount,
                creationMethod: 'manual',
              },
              channels: ['in_app', 'push'],
            }).catch((e) => console.warn('[Notify Udhar Request Error]:', e));
          }

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
            status: initialLifecycle,
          }).catch((e) => console.warn('[Udhar Created Two-Sided Email Error]:', e));

          const createdRow = userARes.rows[0];
          sendJson(res, 201, {
            success: true,
            requiresConfirmation: !isInstantQr,
            creationMethod: verifiedCreationMethod,
            message: isInstantQr
              ? 'Udhaar added successfully.'
              : `Udhaar request sent to ${registeredUser.full_name}. Waiting for recipient confirmation.`,
            transaction: {
              ...createdRow,
              status: initialLifecycle,
              creation_method: verifiedCreationMethod,
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
          const packedNotes = packStructuredNote(plainNotes, {
            category,
            payment_method: paymentMethod,
            description: description || undefined,
            attachment_url: attachmentUrl || undefined,
            creation_method: 'manual',
            lifecycle_status: 'confirmed',
          });

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
            requiresConfirmation: false,
            creationMethod: 'manual',
            message: `Local Udhar recorded for ${counterpartName}.`,
            transaction: {
              ...createdRow,
              status: 'confirmed',
              creation_method: 'manual',
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

    // 17. CONFIRM TRANSACTION (RECIPIENT ONLY): POST /api/udhar/transactions/:id/confirm
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
      const guard = canAcceptUdhar(tx, authUser.id);
      if (!guard.allowed) {
        sendJson(res, guard.httpStatus || 403, { success: false, code: guard.code, message: guard.reason });
        return true;
      }

      const nowIso = new Date().toISOString();
      const { note, meta } = unpackStructuredNote(tx.notes);
      const updatedPackedNotes = packStructuredNote(note, {
        ...meta,
        lifecycle_status: 'confirmed',
        accepted_by: authUser.id,
        responded_at: nowIso,
      });

      const updRes = await query(
        `UPDATE public.udhar_transactions 
         SET status = 'confirmed', confirmation_status = 'confirmed', notes = $2, updated_at = NOW() 
         WHERE link_id = $1 AND status = 'pending_confirmation'
         RETURNING id`,
        [tx.link_id, updatedPackedNotes]
      );

      if (updRes.rows.length === 0) {
        sendJson(res, 409, { success: false, code: 'CONCURRENT_MODIFICATION', message: 'This Udhar request has already been accepted, rejected, or cancelled.' });
        return true;
      }

      await query(`UPDATE public.notifications SET is_active = FALSE WHERE related_entity_id = $1 OR related_entity_id = $2`, [tx.link_id, tx.id]).catch(() => {});
      await query(
        `UPDATE public.user_notifications SET is_deleted = TRUE, deleted_at = NOW()
         WHERE related_entity_id = $1 OR related_entity_id = $2 OR metadata->>'linkId' = $1`,
        [tx.link_id, tx.id]
      ).catch(() => {});

      if (tx.counterpart_user_id) {
        createNotification({
          userId: tx.counterpart_user_id,
          title: 'Udhaar Request Accepted',
          message: `${authUser.full_name} accepted your Udhaar request of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')}. Both balances are now updated.`,
          category: 'udhar',
          type: 'success',
          deepLink: 'people',
          dedupeKey: `udhar_acc_${tx.link_id}`,
          metadata: { actionType: 'udhar_accepted', linkId: tx.link_id, udharId: tx.id, acceptedBy: authUser.id },
          channels: ['in_app', 'push'],
        }).catch(() => {});
      }

      await logSecurityEvent('UDHAR_CONFIRMED', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { txId, linkId: tx.link_id },
      });

      sendJson(res, 200, { success: true, status: 'confirmed', message: 'Udhaar request accepted successfully.' });
      return true;
    }

    // 17B. REJECT PENDING UDHAAR REQUEST (RECIPIENT ONLY): POST /api/udhar/transactions/:id/reject
    const rejectMatch = pathname.match(/^\/api\/udhar\/transactions\/([a-zA-Z0-9_-]+)\/reject$/);
    if (rejectMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const txId = rejectMatch[1];
      const body = await parseJsonBody(req).catch(() => ({}));
      const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

      if (!isDatabaseAvailable()) {
        const restRes = await rejectUdharTransactionRest(authUser, txId, reason);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const txRes = await query('SELECT * FROM public.udhar_transactions WHERE id = $1 AND user_id = $2', [txId, authUser.id]);
      if (txRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Transaction not found.' });
        return true;
      }

      const tx = txRes.rows[0];
      const guard = canRejectUdhar(tx, authUser.id);
      if (!guard.allowed) {
        sendJson(res, guard.httpStatus || 403, { success: false, code: guard.code, message: guard.reason });
        return true;
      }

      const nowIso = new Date().toISOString();
      const cleanReason = reason ? reason.slice(0, 400) : 'Rejected by recipient';
      const { note, meta } = unpackStructuredNote(tx.notes);
      const updatedPackedNotes = packStructuredNote(note, {
        ...meta,
        lifecycle_status: 'rejected',
        rejected_by: authUser.id,
        responded_at: nowIso,
        rejection_reason: cleanReason,
      });

      let updRows: any[] = [];
      try {
        const r = await query(
          `UPDATE public.udhar_transactions
           SET status = 'rejected', confirmation_status = 'rejected', current_balance = 0, paid_amount = 0, notes = $2, updated_at = NOW()
           WHERE link_id = $1 AND status = 'pending_confirmation'
           RETURNING id`,
          [tx.link_id, updatedPackedNotes]
        );
        updRows = r.rows;
      } catch {
        const r = await query(
          `UPDATE public.udhar_transactions
           SET status = 'cancelled', current_balance = 0, paid_amount = 0, notes = $2, updated_at = NOW()
           WHERE link_id = $1 AND status = 'pending_confirmation'
           RETURNING id`,
          [tx.link_id, updatedPackedNotes]
        );
        updRows = r.rows;
      }

      if (updRows.length === 0) {
        sendJson(res, 409, { success: false, code: 'CONCURRENT_MODIFICATION', message: 'This Udhar request has already been handled.' });
        return true;
      }

      await query(`UPDATE public.notifications SET is_active = FALSE WHERE related_entity_id = $1 OR related_entity_id = $2`, [tx.link_id, tx.id]).catch(() => {});
      await query(
        `UPDATE public.user_notifications SET is_deleted = TRUE, deleted_at = NOW()
         WHERE related_entity_id = $1 OR related_entity_id = $2 OR metadata->>'linkId' = $1`,
        [tx.link_id, tx.id]
      ).catch(() => {});

      if (tx.counterpart_user_id) {
        createNotification({
          userId: tx.counterpart_user_id,
          title: 'Udhaar Request Rejected',
          message: `${authUser.full_name} rejected your Udhaar request of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')}.`,
          category: 'udhar',
          type: 'warning',
          deepLink: 'people',
          dedupeKey: `udhar_rej_${tx.link_id}`,
          metadata: { actionType: 'udhar_rejected', linkId: tx.link_id, udharId: tx.id, rejectedBy: authUser.id, reason: cleanReason },
          channels: ['in_app', 'push'],
        }).catch(() => {});
      }

      await logSecurityEvent('UDHAR_REJECTED', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { txId, linkId: tx.link_id, reason: cleanReason },
      });

      sendJson(res, 200, { success: true, status: 'rejected', message: 'You rejected this Udhaar request.' });
      return true;
    }

    // 17C. CANCEL PENDING UDHAAR REQUEST (SENDER ONLY): POST /api/udhar/transactions/:id/cancel-request
    const cancelReqMatch = pathname.match(/^\/api\/udhar\/transactions\/([a-zA-Z0-9_-]+)\/cancel-request$/);
    if (cancelReqMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const txId = cancelReqMatch[1];
      const body = await parseJsonBody(req).catch(() => ({}));
      const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

      if (!isDatabaseAvailable()) {
        const restRes = await cancelUdharRequestRest(authUser, txId, reason);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const txRes = await query('SELECT * FROM public.udhar_transactions WHERE id = $1 AND user_id = $2', [txId, authUser.id]);
      if (txRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Transaction not found.' });
        return true;
      }

      const tx = txRes.rows[0];
      const guard = canSenderCancelUdhar(tx, authUser.id);
      if (!guard.allowed) {
        sendJson(res, guard.httpStatus || 403, { success: false, code: guard.code, message: guard.reason });
        return true;
      }

      const nowIso = new Date().toISOString();
      const cleanReason = reason ? reason.slice(0, 400) : 'Cancelled by sender';
      const { note, meta } = unpackStructuredNote(tx.notes);
      const updatedPackedNotes = packStructuredNote(note, {
        ...meta,
        lifecycle_status: 'cancelled',
        cancelled_by: authUser.id,
        cancelled_at: nowIso,
        rejection_reason: cleanReason,
      });

      const updRes = await query(
        `UPDATE public.udhar_transactions
         SET status = 'cancelled', current_balance = 0, paid_amount = 0, notes = $2, updated_at = NOW()
         WHERE link_id = $1 AND status = 'pending_confirmation'
         RETURNING id`,
        [tx.link_id, updatedPackedNotes]
      );

      if (updRes.rows.length === 0) {
        sendJson(res, 409, { success: false, code: 'CONCURRENT_MODIFICATION', message: 'This Udhar request has already been responded to or cancelled.' });
        return true;
      }

      await query(`UPDATE public.notifications SET is_active = FALSE WHERE related_entity_id = $1 OR related_entity_id = $2`, [tx.link_id, tx.id]).catch(() => {});
      await query(
        `UPDATE public.user_notifications SET is_deleted = TRUE, deleted_at = NOW()
         WHERE related_entity_id = $1 OR related_entity_id = $2 OR metadata->>'linkId' = $1`,
        [tx.link_id, tx.id]
      ).catch(() => {});

      if (tx.counterpart_user_id) {
        createNotification({
          userId: tx.counterpart_user_id,
          title: 'Udhaar Request Cancelled',
          message: `${authUser.full_name} cancelled their pending Udhaar request of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')}.`,
          category: 'udhar',
          type: 'info',
          deepLink: 'people',
          dedupeKey: `udhar_canc_${tx.link_id}`,
          metadata: { actionType: 'udhar_request_cancelled', linkId: tx.link_id, udharId: tx.id, cancelledBy: authUser.id },
          channels: ['in_app', 'push'],
        }).catch(() => {});
      }

      await logSecurityEvent('UDHAR_REQUEST_CANCELLED', {
        userId: authUser.id,
        userEmail: authUser.email,
        details: { txId, linkId: tx.link_id, reason: cleanReason },
      });

      sendJson(res, 200, { success: true, status: 'cancelled', message: 'Pending Udhaar request cancelled.' });
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

      const rate = await checkRateLimitAsync(`udhar_settle:${authUser.id}`, RATE_LIMITS.UDHAR_SETTLE.max, RATE_LIMITS.UDHAR_SETTLE.windowMs, RATE_LIMITS.UDHAR_SETTLE.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
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
      const repAttCheck = sanitizeAttachmentUrlInput(body.attachment_url || body.attachmentUrl);
      if (!repAttCheck.valid) {
        sendJson(res, 400, { success: false, code: 'INVALID_ATTACHMENT', message: repAttCheck.error || 'Invalid attachment.' });
        return true;
      }
      const attachmentUrl = repAttCheck.value || '';
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
          udharStatus: normalizeUdharLifecycleStatus(tx),
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
      if (!isActiveRepayment(rep)) {
        sendJson(res, 404, { success: false, message: 'Repayment record not found.' });
        return true;
      }
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
      if (!isActiveRepayment(rep)) {
        sendJson(res, 404, { success: false, message: 'Repayment record not found.' });
        return true;
      }
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
            message: 'Only the lender who gave the money can edit this Udhar transaction.',
          });
          return true;
        }

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
            status: normalizeUdharLifecycleStatus(tx),
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
        let nextAttachmentUrl = prevMeta.attachment_url;
        if (body.attachment_url !== undefined) {
          const updAttCheck = sanitizeAttachmentUrlInput(body.attachment_url);
          if (!updAttCheck.valid) {
            await client.query('ROLLBACK');
            sendJson(res, 400, { success: false, code: 'INVALID_ATTACHMENT', message: updAttCheck.error || 'Invalid attachment.' });
            return true;
          }
          nextAttachmentUrl = updAttCheck.value || undefined;
        }
        const nextPackedNotes = packStructuredNote(nextPlainNote, {
          ...prevMeta,
          lifecycle_status: newStatus,
          category: body.category !== undefined ? body.category : prevMeta.category,
          payment_method: body.payment_method !== undefined ? body.payment_method : prevMeta.payment_method,
          description: body.description !== undefined ? body.description : prevMeta.description,
          attachment_url: nextAttachmentUrl,
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

      const rate = await checkRateLimitAsync(`udhar_settle:${authUser.id}`, RATE_LIMITS.UDHAR_SETTLE.max, RATE_LIMITS.UDHAR_SETTLE.windowMs, RATE_LIMITS.UDHAR_SETTLE.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
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
        const txLifecycle = normalizeUdharLifecycleStatus(tx);
        if (txLifecycle === 'settled' || (txLifecycle === 'confirmed' && currentBal <= 0.01)) {
          await client.query('ROLLBACK');
          sendJson(res, 400, { success: false, message: 'This transaction is already settled.' });
          return true;
        }
        if (txLifecycle === 'pending_confirmation') {
          await client.query('ROLLBACK');
          sendJson(res, 409, { success: false, message: 'Cannot settle a request that has not been confirmed by the recipient yet.' });
          return true;
        }
        if (txLifecycle === 'rejected' || txLifecycle === 'cancelled' || txLifecycle === 'deleted') {
          await client.query('ROLLBACK');
          sendJson(res, 400, { success: false, message: `Cannot settle a ${txLifecycle} transaction.` });
          return true;
        }
        if (txLifecycle === 'disputed') {
          await client.query('ROLLBACK');
          sendJson(res, 409, { success: false, message: 'Cannot settle a disputed transaction. Resolve the dispute first.' });
          return true;
        }

        await client.query(
          `INSERT INTO public.udhar_repayments (
            link_id, udhar_id, recorded_by_user_id, amount, repayment_date, payment_method, notes, status,
            confirmed_at, confirmed_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', NOW(), $8)`,
          [tx.link_id, tx.id, authUser.id, currentBal, settleDate, paymentMethod, notes, authUser.id]
        );

        await client.query('SAVEPOINT settle_audit_cols');
        try {
          await client.query(
            `UPDATE public.udhar_transactions 
             SET current_balance = 0, paid_amount = original_amount, status = 'settled', settled_at = NOW(), settled_by = $2, updated_at = NOW() 
             WHERE link_id = $1`,
            [tx.link_id, authUser.id]
          );
          await client.query('RELEASE SAVEPOINT settle_audit_cols');
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT settle_audit_cols');
          await client.query(
            `UPDATE public.udhar_transactions 
             SET current_balance = 0, paid_amount = original_amount, status = 'settled', settled_at = NOW(), updated_at = NOW() 
             WHERE link_id = $1`,
            [tx.link_id]
          );
        }

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

    // 20C. DELETE INDIVIDUAL UDHAAR TRANSACTION (LENDER ONLY; CASCADES SOFT-DELETE TO REPAYMENTS): DELETE /api/udhar/transactions/:id
    const deleteTxMatch = pathname.match(/^\/api\/udhar\/transactions\/([a-zA-Z0-9_-]+)$/);
    if (deleteTxMatch && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const rate = await checkRateLimitAsync(`udhar_delete:${authUser.id}`, RATE_LIMITS.UDHAR_DELETE.max, RATE_LIMITS.UDHAR_DELETE.windowMs, RATE_LIMITS.UDHAR_DELETE.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      const txId = deleteTxMatch[1];
      const body = await parseJsonBody(req).catch(() => ({}));
      const deletionReason = typeof body?.reason === 'string'
        ? body.reason.trim()
        : typeof body?.deletion_reason === 'string'
          ? body.deletion_reason.trim()
          : '';

      if (!isDatabaseAvailable()) {
        const restRes = await cancelUdharRest(authUser, txId, deletionReason);
        if (restRes.status === 200 && restRes.body?.success) {
          await logSecurityEvent('UDHAR_DELETED', {
            userId: authUser.id,
            userEmail: authUser.email,
            details: {
              txId,
              linkId: restRes.body.linkId,
              direction: restRes.body.direction,
              counterpartUserId: restRes.body.counterpartUserId,
              originalAmount: restRes.body.originalAmount,
              reason: deletionReason || null,
            },
          });
        }
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

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
        const repsRes = await client.query(
          `SELECT id, amount, status, deleted_at FROM public.udhar_repayments WHERE link_id = $1`,
          [tx.link_id]
        );
        const activeReps = repsRes.rows.filter((r: any) => isActiveRepayment(r));

        const recalc = recalculateUdharFromRepayments({
          originalAmount: tx.original_amount,
          repayments: activeReps,
          currentStatus: tx.status,
        });
        const baseLifecycle = normalizeUdharLifecycleStatus(tx);
        const effectiveStatus = baseLifecycle === 'deleted' || baseLifecycle === 'cancelled' || baseLifecycle === 'rejected'
          ? baseLifecycle
          : baseLifecycle === 'disputed'
            ? 'disputed'
            : baseLifecycle === 'pending_confirmation'
              ? 'pending_confirmation'
              : (activeReps.length > 0 ? recalc.nextStatus : baseLifecycle);

        const guard = canCancelUdhar({
          status: effectiveStatus,
          deleted_at: tx.deleted_at,
          notes: tx.notes,
          direction: tx.direction,
          is_shared: Boolean(tx.counterpart_user_id),
          counterpart_user_id: tx.counterpart_user_id,
          original_amount: tx.original_amount,
          paid_amount: activeReps.length > 0 ? recalc.paidAmount : tx.paid_amount,
          current_balance: activeReps.length > 0 ? recalc.remainingBalance : tx.current_balance,
          settled_at: tx.settled_at,
          repayments: activeReps,
        });

        if (!guard.allowed) {
          await client.query('ROLLBACK');
          sendJson(res, guard.httpStatus || 409, {
            success: false,
            code: guard.code,
            message: guard.reason,
          });
          return true;
        }

        const cleanReason = deletionReason ? deletionReason.slice(0, 500) : null;
        const nowIso = new Date().toISOString();
        const { note: prevPlain, meta: prevMeta } = unpackStructuredNote(tx.notes);
        const deletedPackedNotes = packStructuredNote(prevPlain, {
          ...prevMeta,
          lifecycle_status: 'deleted',
          cancelled_at: nowIso,
          cancelled_by: authUser.id,
        });

        let updatedRows: any[] = [];
        await client.query('SAVEPOINT delete_audit_cols');
        try {
          const upd = await client.query(
            `UPDATE public.udhar_transactions
             SET status = 'cancelled', current_balance = 0, paid_amount = 0, notes = $4, updated_at = NOW(),
                 deleted_at = NOW(), deleted_by = $2, deletion_reason = $3
             WHERE link_id = $1 AND deleted_at IS NULL AND status <> 'disputed'
             RETURNING id`,
            [tx.link_id, authUser.id, cleanReason, deletedPackedNotes]
          );
          updatedRows = upd.rows;
          await client.query('RELEASE SAVEPOINT delete_audit_cols');
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT delete_audit_cols');
          const upd = await client.query(
            `UPDATE public.udhar_transactions
             SET status = 'cancelled', current_balance = 0, paid_amount = 0, notes = $2, updated_at = NOW()
             WHERE link_id = $1 AND status <> 'disputed' AND COALESCE(notes, '') NOT LIKE '%"lifecycle_status":"deleted"%'
             RETURNING id`,
            [tx.link_id, deletedPackedNotes]
          );
          updatedRows = upd.rows;
        }

        if (updatedRows.length === 0) {
          await client.query('ROLLBACK');
          sendJson(res, 409, {
            success: false,
            message: 'This transaction has already been deleted or cannot be deleted in its current state.',
          });
          return true;
        }

        // Soft-delete associated repayments so orphaned rows cannot affect totals or history
        await client.query('SAVEPOINT delete_reps_soft');
        try {
          await client.query(
            `UPDATE public.udhar_repayments
             SET status = 'deleted', deleted_at = NOW(), deleted_by = $2, deletion_reason = $3
             WHERE link_id = $1 AND status NOT IN ('deleted', 'cancelled')`,
            [tx.link_id, authUser.id, cleanReason || 'Parent Udhar deleted']
          );
          await client.query('RELEASE SAVEPOINT delete_reps_soft');
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT delete_reps_soft');
          await client.query(
            `DELETE FROM public.udhar_repayments WHERE link_id = $1`,
            [tx.link_id]
          );
        }

        // Deactivate notifications tied to this deleted Udhar in parallel
        await Promise.all([
          client.query(
            `UPDATE public.notifications SET is_active = FALSE WHERE related_entity_id = $1 OR related_entity_id = $2`,
            [tx.link_id, tx.id]
          ).catch(() => {}),
          client.query(
            `UPDATE public.user_notifications
             SET is_deleted = TRUE, deleted_at = NOW()
             WHERE related_entity_id = $1
                OR related_entity_id = $2
                OR metadata->>'relatedEntityId' = $1
                OR metadata->>'linkId' = $1
                OR metadata->>'udharId' = $2`,
            [tx.link_id, tx.id]
          ).catch(() => {}),
        ]);

        await client.query('COMMIT');

        // Dispatch counterpart notification & security audit log asynchronously after commit
        const postCommitTasks: Promise<any>[] = [
          logSecurityEvent('UDHAR_DELETED', {
            userId: authUser.id,
            userEmail: authUser.email,
            details: {
              txId,
              linkId: tx.link_id,
              direction: tx.direction,
              counterpartUserId: tx.counterpart_user_id || null,
              originalAmount: tx.original_amount,
              reason: cleanReason,
            },
          }).catch(() => {}),
        ];
        if (tx.counterpart_user_id) {
          postCommitTasks.push(
            createNotification({
              userId: tx.counterpart_user_id,
              title: `Udhar Deleted by ${authUser.full_name}`,
              message: `${authUser.full_name} permanently deleted the shared Udhar entry of ₹${parseFloat(tx.original_amount).toLocaleString('en-IN')}. Both accounts have been updated.`,
              category: 'udhar',
              type: 'info',
              deepLink: 'people',
              dedupeKey: `udhar_del_${tx.link_id}`,
              metadata: { actionType: 'udhar_deleted', deletedLinkId: tx.link_id, deletedTxId: tx.id },
              channels: ['in_app', 'push'],
            }).catch(() => {})
          );
        }
        void Promise.all(postCommitTasks);

        sendJson(res, 200, {
          success: true,
          deletedTransactionId: tx.id,
          linkId: tx.link_id,
          message: 'Udhar entry deleted successfully for both participants. Totals have been recalculated.',
        });
        return true;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // 20C-2. DELETE INDIVIDUAL REPAYMENT & RECALCULATE PARENT UDHAAR: DELETE /api/udhar/repayments/:id
    const deleteRepaymentMatch = pathname.match(/^\/api\/udhar\/repayments\/([a-zA-Z0-9_-]+)$/);
    if (deleteRepaymentMatch && method === 'DELETE') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const rate = await checkRateLimitAsync(`udhar_rep_delete:${authUser.id}`, RATE_LIMITS.UDHAR_DELETE.max, RATE_LIMITS.UDHAR_DELETE.windowMs, RATE_LIMITS.UDHAR_DELETE.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      const repaymentId = deleteRepaymentMatch[1];
      const body = await parseJsonBody(req).catch(() => ({}));
      const deletionReason = typeof body?.reason === 'string'
        ? body.reason.trim()
        : typeof body?.deletion_reason === 'string'
          ? body.deletion_reason.trim()
          : '';

      if (!isDatabaseAvailable()) {
        const restRes = await deleteRepaymentRest(authUser, repaymentId, deletionReason);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const repRes = await client.query(
          `SELECT * FROM public.udhar_repayments WHERE id = $1 FOR UPDATE`,
          [repaymentId]
        );
        if (repRes.rows.length === 0 || !isActiveRepayment(repRes.rows[0])) {
          await client.query('ROLLBACK');
          sendJson(res, 404, { success: false, message: 'Repayment record not found.' });
          return true;
        }
        const rep = repRes.rows[0];

        const txRes = await client.query(
          `SELECT * FROM public.udhar_transactions WHERE link_id = $1 AND user_id = $2 FOR UPDATE`,
          [rep.link_id, authUser.id]
        );
        if (txRes.rows.length === 0) {
          await client.query('ROLLBACK');
          sendJson(res, 404, { success: false, message: 'Associated Udhar transaction not found.' });
          return true;
        }
        const tx = txRes.rows[0];

        if (tx.status === 'cancelled' || tx.deleted_at) {
          await client.query('ROLLBACK');
          sendJson(res, 409, { success: false, message: 'Associated Udhar has already been deleted.' });
          return true;
        }
        if (tx.status === 'disputed') {
          await client.query('ROLLBACK');
          sendJson(res, 409, { success: false, message: 'Cannot delete repayments on a disputed Udhar. Resolve the dispute first.' });
          return true;
        }

        const guard = canDeleteRepayment({
          isShared: Boolean(tx.counterpart_user_id),
          direction: tx.direction,
          actorUserId: authUser.id,
          repayment: rep,
        });
        if (!guard.allowed) {
          await client.query('ROLLBACK');
          sendJson(res, guard.httpStatus || 403, { success: false, message: guard.reason || 'Not authorized to delete this repayment.' });
          return true;
        }

        const cleanReason = deletionReason ? deletionReason.slice(0, 500) : null;
        await client.query('SAVEPOINT delete_single_rep_soft');
        try {
          await client.query(
            `UPDATE public.udhar_repayments
             SET status = 'deleted', deleted_at = NOW(), deleted_by = $2, deletion_reason = $3
             WHERE id = $1`,
            [repaymentId, authUser.id, cleanReason]
          );
          await client.query('RELEASE SAVEPOINT delete_single_rep_soft');
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT delete_single_rep_soft');
          await client.query(
            `DELETE FROM public.udhar_repayments WHERE id = $1`,
            [repaymentId]
          );
        }

        const remRepsRes = await client.query(
          `SELECT id, amount, status FROM public.udhar_repayments WHERE link_id = $1`,
          [tx.link_id]
        );
        const remainingReps = remRepsRes.rows.filter((r: any) => r.id !== repaymentId && isActiveRepayment(r));

        const recalc = recalculateUdharFromRepayments({
          originalAmount: tx.original_amount,
          repayments: remainingReps,
          currentStatus: tx.status,
        });

        await client.query('SAVEPOINT recalc_parent_udhar_cols');
        try {
          await client.query(
            `UPDATE public.udhar_transactions
             SET paid_amount = $1,
                 current_balance = $2,
                 status = $3,
                 settled_at = CASE WHEN $4 = TRUE THEN COALESCE(settled_at, NOW()) ELSE NULL END,
                 settled_by = CASE WHEN $4 = TRUE THEN COALESCE(settled_by, $5) ELSE NULL END,
                 updated_at = NOW()
             WHERE link_id = $6 AND status <> 'cancelled'`,
            [recalc.paidAmount, recalc.remainingBalance, recalc.nextStatus, recalc.isSettled, authUser.id, tx.link_id]
          );
          await client.query('RELEASE SAVEPOINT recalc_parent_udhar_cols');
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT recalc_parent_udhar_cols');
          await client.query(
            `UPDATE public.udhar_transactions
             SET paid_amount = $1,
                 current_balance = $2,
                 status = $3,
                 settled_at = CASE WHEN $4 = TRUE THEN COALESCE(settled_at, NOW()) ELSE NULL END,
                 updated_at = NOW()
             WHERE link_id = $5 AND status <> 'cancelled'`,
            [recalc.paidAmount, recalc.remainingBalance, recalc.nextStatus, recalc.isSettled, tx.link_id]
          );
        }

        if (tx.counterpart_user_id) {
          await client.query(
            `INSERT INTO public.notifications (title, message, type, target_user_id, related_entity_id, actor_user_id, is_active)
             VALUES ($1, $2, 'repayment_deleted', $3, $4, $5, TRUE)`,
            [
              `Repayment Deleted by ${authUser.full_name}`,
              `${authUser.full_name} deleted a repayment of ₹${parseFloat(rep.amount).toLocaleString('en-IN')}. Updated balance: ₹${recalc.remainingBalance.toLocaleString('en-IN')}.`,
              tx.counterpart_user_id,
              tx.link_id,
              authUser.id,
            ]
          ).catch(() => {});
        }

        await client.query('COMMIT');

        await logSecurityEvent('UDHAR_REPAYMENT_DELETED', {
          userId: authUser.id,
          userEmail: authUser.email,
          details: {
            repaymentId,
            txId: tx.id,
            linkId: tx.link_id,
            deletedAmount: rep.amount,
            paidAmount: recalc.paidAmount,
            remainingBalance: recalc.remainingBalance,
            udharStatus: recalc.nextStatus,
            reason: cleanReason,
          },
        });

        sendJson(res, 200, {
          success: true,
          deletedRepaymentId: repaymentId,
          transactionId: tx.id,
          linkId: tx.link_id,
          paidAmount: recalc.paidAmount,
          remainingBalance: recalc.remainingBalance,
          udharStatus: recalc.nextStatus,
          isSettled: recalc.isSettled,
          message: `Repayment of ₹${parseFloat(rep.amount).toLocaleString('en-IN')} deleted. Remaining balance: ₹${recalc.remainingBalance.toLocaleString('en-IN')}.`,
        });
        return true;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // 20D. GET TRANSACTION AUDIT & REPAYMENT HISTORY: GET /api/udhar/transactions/:id/history
    const historyTxMatch = pathname.match(/^\/api\/udhar\/transactions\/([a-zA-Z0-9_-]+)\/history$/);
    if (historyTxMatch && method === 'GET') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const rate = await checkRateLimitAsync(`udhar_history:${authUser.id}`, RATE_LIMITS.TRANSACTION_DETAILS.max, RATE_LIMITS.TRANSACTION_DETAILS.windowMs, RATE_LIMITS.TRANSACTION_DETAILS.op);
      if (!rate.allowed) {
        sendRateLimitExceeded(res, rate);
        return true;
      }

      const txId = historyTxMatch[1];
      if (!isDatabaseAvailable()) {
        const restRes = await getUdharHistoryRest(authUser, txId);
        sendJson(res, restRes.status, restRes.body);
        return true;
      }

      const txRes = await query(
        `SELECT * FROM public.udhar_transactions
         WHERE id = $1
           AND (user_id = $2 OR counterpart_user_id = $2)
           AND deleted_at IS NULL`,
        [txId, authUser.id]
      );
      if (txRes.rows.length === 0 || normalizeUdharLifecycleStatus(txRes.rows[0]) === 'deleted') {
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

      const repayments = repaymentsRes.rows
        .filter((r: any) => isActiveRepayment(r))
        .map((r: any) => {
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

      const useDb = isDatabaseAvailable();
      let trustedName = authUser.full_name || 'Valued User';
      let trustedEmail = authUser.email;
      let trustedPhone: string | null = null;

      if (useDb) {
        const uRes = await query('SELECT full_name, email, phone FROM public.app_users WHERE id = $1', [authUser.id]);
        trustedName = uRes.rows[0]?.full_name || trustedName;
        trustedEmail = uRes.rows[0]?.email || trustedEmail;
        trustedPhone = uRes.rows[0]?.phone || null;

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
      } else {
        const recentFb = await listFeedbacksFallback({ userId: authUser.id });
        const nowMs = Date.now();
        const isDup = recentFb.feedbacks.some(
          (f: any) =>
            f.message === message &&
            f.created_at &&
            nowMs - new Date(f.created_at).getTime() < 15000
        );
        if (isDup) {
          sendJson(res, 409, {
            success: false,
            message: 'Duplicate feedback detected. Your previous feedback was already received!',
          });
          return true;
        }
      }

      const category = (body.category || 'General Feedback').trim();
      const subject = (body.subject || (rating ? `${rating}-Star User Feedback` : 'User Feedback')).trim();

      let feedback: any = null;
      if (useDb) {
        const insertRes = await query(
          `INSERT INTO public.feedbacks (
            user_id, user_name, user_email, user_phone, type, category, subject, message, rating, dpdp_consent, dpdp_consent_at, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, 'feedback', $5, $6, $7, $8, $9, $10, 'new', NOW(), NOW())
          RETURNING *`,
          [authUser.id, trustedName, trustedEmail, trustedPhone, category, subject, message, rating, dpdpConsent, dpdpConsent ? new Date() : null]
        );
        feedback = insertRes.rows[0] || null;
      }

      if (!feedback) {
        feedback = await insertFeedbackFallback({
          user_id: authUser.id,
          user_name: trustedName,
          user_email: trustedEmail,
          user_phone: trustedPhone,
          category,
          subject,
          message,
          rating,
          dpdp_consent: dpdpConsent,
          dpdp_consent_at: dpdpConsent ? new Date().toISOString() : null,
        });
      }

      const feedbackId = `FB-${String(feedback.id).slice(0, 8).toUpperCase()}`;

      // If user explicitly checked dpdp_consent, record in user_consents audit history as well
      if (dpdpConsent && useDb) {
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

      // Automated Dual Feedback Emails + In-App/Push Alerts (awaited so serverless runtimes don't freeze mid-SMTP)
      let userEmailSent = false;
      try {
        const [emailResult] = await Promise.allSettled([
          sendFeedbackSubmissionEmails({
            feedbackId,
            userId: authUser.id,
            userName: trustedName,
            userEmail: trustedEmail,
            rating: rating || 5,
            feedbackMessage: message,
            category,
            submittedAt: feedback.created_at
              ? new Date(feedback.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'
              : undefined,
          }),
          notifyFeedbackSubmitted(authUser.id, {
            id: feedback.id,
            rating: rating || 5,
            category,
          }),
          notifyAdminNewFeedback({
            feedbackId,
            feedbackDbId: feedback.id,
            submitterName: trustedName,
            submitterEmail: trustedEmail,
            rating: rating || 5,
            category,
            message,
          }),
        ]);
        if (emailResult.status === 'fulfilled') {
          userEmailSent = Boolean(emailResult.value?.userEmailSent);
        }
      } catch (e) {
        console.warn('[Feedback Notification/Email Error]:', e);
      }

      if (useDb) {
        await logSecurityEvent('USER_SUBMITTED_FEEDBACK', {
          userId: authUser.id,
          userEmail: trustedEmail,
          details: { rating, feedbackId, userEmailSent },
        });
      }

      sendJson(res, 201, {
        success: true,
        message: userEmailSent
          ? 'Thank you for your feedback! A confirmation email has been sent to you.'
          : 'Thank you for your feedback! Your opinion helps us improve My Money Manager.',
        feedback_id: feedbackId,
        emailDispatched: userEmailSent,
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
      const cmpAttCheck = sanitizeAttachmentUrlInput(body.attachment_url || body.attachment);
      if (!cmpAttCheck.valid) {
        sendJson(res, 400, { success: false, code: 'INVALID_ATTACHMENT', message: cmpAttCheck.error || 'Invalid attachment.' });
        return true;
      }
      const attachmentUrl = cmpAttCheck.value;

      if (!subject || subject.length < 3) {
        sendJson(res, 400, { success: false, message: 'Complaint subject is required (min 3 characters).' });
        return true;
      }
      if (!description || description.length < 5) {
        sendJson(res, 400, { success: false, message: 'Detailed description is required (min 5 characters).' });
        return true;
      }

      const useDb = isDatabaseAvailable();
      let trustedName = authUser.full_name || 'Valued User';
      let trustedEmail = authUser.email;
      let userPhone = phone;

      if (useDb) {
        const uRes = await query('SELECT full_name, email, phone FROM public.app_users WHERE id = $1', [authUser.id]);
        trustedName = uRes.rows[0]?.full_name || trustedName;
        trustedEmail = uRes.rows[0]?.email || trustedEmail;
        userPhone = userPhone || uRes.rows[0]?.phone || null;

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
      } else {
        const recentTickets = await listSupportTicketsFallback(authUser.id);
        const nowMs = Date.now();
        const isDup = recentTickets.some(
          (t: any) =>
            t.subject === subject &&
            t.description === description &&
            t.created_at &&
            nowMs - new Date(t.created_at).getTime() < 15000
        );
        if (isDup) {
          sendJson(res, 409, {
            success: false,
            message: 'Duplicate complaint detected. Your previous submission was already received!',
          });
          return true;
        }
      }

      const ticketNumber = `CMP-${Math.floor(1000 + Math.random() * 9000)}`;
      let ticket: any = null;

      if (useDb) {
        const insertRes = await query(
          `INSERT INTO public.support_tickets (
            ticket_number, user_id, user_name, user_email, ticket_type, category, subject, description, priority, status, attachment_url, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, 'complaint', $5, $6, $7, 'normal', 'open', $8, NOW(), NOW())
          RETURNING *`,
          [ticketNumber, authUser.id, trustedName, trustedEmail, category, subject, description, attachmentUrl]
        );
        ticket = insertRes.rows[0] || null;
      }

      if (!ticket) {
        ticket = await insertSupportTicketFallback({
          ticket_number: ticketNumber,
          user_id: authUser.id,
          user_name: trustedName,
          user_email: trustedEmail,
          ticket_type: 'complaint',
          category,
          subject,
          description,
          priority: 'normal',
          status: 'open',
          attachment_url: attachmentUrl,
        });
      }

      let userEmailSent = false;
      try {
        const [emailResult] = await Promise.allSettled([
          sendComplaintSubmissionEmails({
            ticketId: ticket.id,
            ticketNumber: ticket.ticket_number,
            userId: authUser.id,
            userName: trustedName,
            userEmail: trustedEmail,
            userPhone,
            category: ticket.category,
            subject: ticket.subject,
            description: ticket.description,
            submittedAt: ticket.created_at
              ? new Date(ticket.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'
              : undefined,
          }),
          notifyComplaintSubmitted(authUser.id, {
            id: ticket.id,
            subject: ticket.subject,
            category: ticket.category,
            ticketType: 'complaint',
          }),
          notifyAdminNewSupportTicket({
            ticketId: ticket.id,
            ticketNumber: ticket.ticket_number,
            ticketType: 'complaint',
            submitterName: trustedName,
            submitterEmail: trustedEmail,
            category: ticket.category,
            subject: ticket.subject,
          }),
        ]);
        if (emailResult.status === 'fulfilled') {
          userEmailSent = Boolean(emailResult.value?.userEmailSent);
        }
      } catch (e) {
        console.warn('[Complaint Notification/Email Error]:', e);
      }

      if (useDb) {
        await logSecurityEvent('USER_SUBMITTED_COMPLAINT', {
          userId: authUser.id,
          userEmail: trustedEmail,
          details: { ticketNumber: ticket.ticket_number, userEmailSent },
        });
      }

      sendJson(res, 201, {
        success: true,
        message: userEmailSent
          ? 'Your complaint has been submitted and a confirmation email has been sent to you.'
          : 'Your complaint has been submitted successfully. Our support team will review it and get back to you.',
        ticket_number: ticket.ticket_number,
        emailDispatched: userEmailSent,
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
      const supAttCheck = sanitizeAttachmentUrlInput(body.attachment_url || body.attachment);
      if (!supAttCheck.valid) {
        sendJson(res, 400, { success: false, code: 'INVALID_ATTACHMENT', message: supAttCheck.error || 'Invalid attachment.' });
        return true;
      }
      const attachmentUrl = supAttCheck.value;

      if (!subject || subject.length < 3) {
        sendJson(res, 400, { success: false, message: 'Support subject is required.' });
        return true;
      }
      if (!message || message.length < 5) {
        sendJson(res, 400, { success: false, message: 'Support message is required.' });
        return true;
      }

      const useDb = isDatabaseAvailable();
      let trustedName = authUser.full_name || 'Valued User';
      let trustedEmail = authUser.email;

      if (useDb) {
        const uRes = await query('SELECT full_name, email FROM public.app_users WHERE id = $1', [authUser.id]);
        trustedName = uRes.rows[0]?.full_name || trustedName;
        trustedEmail = uRes.rows[0]?.email || trustedEmail;
      }

      const ticketNumber = `SUP-${Math.floor(1000 + Math.random() * 9000)}`;
      let ticket: any = null;

      if (useDb) {
        const insertRes = await query(
          `INSERT INTO public.support_tickets (
            ticket_number, user_id, user_name, user_email, ticket_type, category, subject, description, priority, status, attachment_url, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, 'support', $5, $6, $7, 'normal', 'open', $8, NOW(), NOW())
          RETURNING *`,
          [ticketNumber, authUser.id, trustedName, trustedEmail, category, subject, message, attachmentUrl]
        );
        ticket = insertRes.rows[0] || null;
      }

      if (!ticket) {
        ticket = await insertSupportTicketFallback({
          ticket_number: ticketNumber,
          user_id: authUser.id,
          user_name: trustedName,
          user_email: trustedEmail,
          ticket_type: 'support',
          category,
          subject,
          description: message,
          priority: 'normal',
          status: 'open',
          attachment_url: attachmentUrl,
        });
      }

      let userEmailSent = false;
      try {
        const [emailResult] = await Promise.allSettled([
          sendSupportTicketSubmissionEmails({
            ticketId: ticket.id,
            ticketNumber: ticket.ticket_number,
            userId: authUser.id,
            userName: trustedName,
            userEmail: trustedEmail,
            category: ticket.category,
            subject: ticket.subject,
            description: ticket.description,
            submittedAt: ticket.created_at
              ? new Date(ticket.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'
              : undefined,
          }),
          notifyComplaintSubmitted(authUser.id, {
            id: ticket.id,
            subject: ticket.subject,
            category: ticket.category,
            ticketType: 'support',
          }),
          notifyAdminNewSupportTicket({
            ticketId: ticket.id,
            ticketNumber: ticket.ticket_number,
            ticketType: 'support',
            submitterName: trustedName,
            submitterEmail: trustedEmail,
            category: ticket.category,
            subject: ticket.subject,
          }),
        ]);
        if (emailResult.status === 'fulfilled') {
          userEmailSent = Boolean(emailResult.value?.userEmailSent);
        }
      } catch (e) {
        console.warn('[Support Ticket Notification/Email Error]:', e);
      }

      if (useDb) {
        await logSecurityEvent('USER_SUBMITTED_SUPPORT_TICKET', {
          userId: authUser.id,
          userEmail: trustedEmail,
          details: { ticketNumber: ticket.ticket_number, category: ticket.category, userEmailSent },
        });
      }

      sendJson(res, 201, {
        success: true,
        message: userEmailSent
          ? 'Your support request has been submitted and a confirmation email has been sent to you.'
          : 'Your support request has been submitted successfully.',
        emailDispatched: userEmailSent,
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

      if (!isDatabaseAvailable()) {
        const [fbRes, tickets] = await Promise.all([
          listFeedbacksFallback({ userId: authUser.id }),
          listSupportTicketsFallback(authUser.id),
        ]);
        sendJson(res, 200, {
          success: true,
          feedbacks: fbRes.feedbacks,
          tickets,
        });
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
      if (!isDatabaseAvailable()) {
        const ticket = await getSupportTicketByIdFallback(ticketId, authUser.id);
        if (!ticket) {
          sendJson(res, 404, { success: false, message: 'Ticket not found or unauthorized.' });
          return true;
        }
        const replies = await getSupportTicketRepliesFallback(ticketId, false);
        sendJson(res, 200, { success: true, ticket, replies });
        return true;
      }

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

      if (!isDatabaseAvailable()) {
        const ticket = await getSupportTicketByIdFallback(ticketId, authUser.id);
        if (!ticket) {
          sendJson(res, 404, { success: false, message: 'Ticket not found or unauthorized.' });
          return true;
        }
        if (ticket.status === 'closed') {
          sendJson(res, 400, { success: false, message: 'This ticket is closed. Please submit a new ticket for further assistance.' });
          return true;
        }
        const senderName = authUser.full_name || 'User';
        const reply = await insertSupportTicketReplyFallback({
          ticket_id: ticketId,
          sender_id: authUser.id,
          sender_name: senderName,
          sender_role: 'user',
          sender_type: 'user',
          message,
          message_type: 'user_message',
          is_internal: false,
          email_status: 'none',
        });
        const newStatus = ticket.status === 'waiting_user' ? 'in_progress' : ticket.status;
        await updateSupportTicketStatusFallback(ticketId, newStatus);

        notifyAdminNewSupportTicket({
          ticketId: ticket.id,
          ticketNumber: ticket.ticket_number,
          ticketType: ticket.ticket_type === 'complaint' ? 'complaint' : 'support',
          submitterName: senderName,
          submitterEmail: authUser.email,
          category: 'User Follow-Up Reply',
          subject: `Reply on #${ticket.ticket_number}: ${ticket.subject}`,
        }).catch(() => {});

        sendJson(res, 201, { success: true, message: 'Reply sent successfully.', reply });
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

      notifyAdminNewSupportTicket({
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        ticketType: ticket.ticket_type === 'complaint' ? 'complaint' : 'support',
        submitterName: senderName,
        submitterEmail: authUser.email,
        category: 'User Follow-Up Reply',
        subject: `Reply on #${ticket.ticket_number}: ${ticket.subject}`,
      }).catch(() => {});

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

    // 4. GRANULAR CATEGORY CONSENTS: GET/POST /api/privacy/consents, /batch, /withdraw-all
    if (
      pathname === '/api/privacy/consents' ||
      pathname === '/api/privacy/consents/batch' ||
      pathname === '/api/privacy/consents/withdraw-all'
    ) {
      const handled = await handlePrivacyConsentApi(req, res, pathname, method, {
        clientIp,
        userAgent,
      });
      if (handled) return true;
    }

    // =========================================================
    // SECTION: PRIVATE USER UPI PROFILE APIS (STRICT OWNER-ONLY)
    // =========================================================
    if (pathname === '/api/upi-profile' && (method === 'GET' || method === 'PUT' || method === 'DELETE')) {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const UPI_ID_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

      if (method === 'GET') {
        if (!isDatabaseAvailable()) {
          sendJson(res, 200, { success: true, profile: null, offlineFallback: true });
          return true;
        }
        try {
          const r = await query(
            `SELECT id, user_id, upi_id, payee_name, payment_note, created_at, updated_at
             FROM public.user_upi_profiles
             WHERE user_id = $1
             LIMIT 1`,
            [authUser.id]
          );
          sendJson(res, 200, { success: true, profile: r.rows[0] || null });
        } catch (err: any) {
          sendJson(res, 500, { success: false, message: err.message || 'Failed to fetch UPI profile.' });
        }
        return true;
      }

      if (method === 'PUT') {
        const body = await readJsonBody(req);
        const upiId = String(body.upiId || body.upi_id || '').trim();
        const payeeName = String(body.payeeName || body.payee_name || '').trim().slice(0, 100);
        const paymentNote = String(body.paymentNote || body.payment_note || '').trim().slice(0, 80);
        const consentGranted = body.consentGranted === true;

        if (!consentGranted) {
          sendJson(res, 400, {
            success: false,
            message: 'Explicit consent is required before saving your UPI ID.',
          });
          return true;
        }

        if (!upiId || !UPI_ID_REGEX.test(upiId)) {
          sendJson(res, 400, {
            success: false,
            message: 'Please enter a valid UPI ID (e.g. yourname@upi).',
          });
          return true;
        }

        if (!isDatabaseAvailable()) {
          sendJson(res, 200, {
            success: true,
            offlineFallback: true,
            profile: {
              id: `local_${authUser.id}`,
              user_id: authUser.id,
              upi_id: upiId,
              payee_name: payeeName,
              payment_note: paymentNote,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          });
          return true;
        }

        try {
          const upsertRes = await query(
            `INSERT INTO public.user_upi_profiles (user_id, upi_id, payee_name, payment_note, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (user_id) DO UPDATE SET
               upi_id = EXCLUDED.upi_id,
               payee_name = EXCLUDED.payee_name,
               payment_note = EXCLUDED.payment_note,
               updated_at = NOW()
             RETURNING id, user_id, upi_id, payee_name, payment_note, created_at, updated_at`,
            [authUser.id, upiId, payeeName || null, paymentNote || null]
          );

          await logSecurityEvent('UPI_PROFILE_UPDATED', {
            userId: authUser.id,
            userEmail: authUser.email,
            ipAddress: clientIp,
            userAgent,
            details: { hasPayeeName: Boolean(payeeName) },
          });

          sendJson(res, 200, {
            success: true,
            message: 'UPI ID saved securely.',
            profile: upsertRes.rows[0],
          });
        } catch (err: any) {
          sendJson(res, 500, { success: false, message: err.message || 'Failed to save UPI profile.' });
        }
        return true;
      }

      if (method === 'DELETE') {
        if (!isDatabaseAvailable()) {
          sendJson(res, 200, { success: true, offlineFallback: true });
          return true;
        }
        try {
          await query(`DELETE FROM public.user_upi_profiles WHERE user_id = $1`, [authUser.id]);
          await logSecurityEvent('UPI_PROFILE_DELETED', {
            userId: authUser.id,
            userEmail: authUser.email,
            ipAddress: clientIp,
            userAgent,
          });
          sendJson(res, 200, { success: true, message: 'Saved UPI ID removed.' });
        } catch (err: any) {
          sendJson(res, 500, { success: false, message: err.message || 'Failed to remove UPI profile.' });
        }
        return true;
      }
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

      if (!isDatabaseAvailable()) {
        const fbRes = await listUserNotificationsFallback(authUser.id, {
          category: category || undefined,
          unreadOnly,
          page,
          limit,
        });
        sendJson(res, 200, {
          success: true,
          notifications: fbRes.notifications,
          unreadCount: fbRes.unreadCount,
          total: fbRes.total,
          page,
          totalPages: Math.ceil(fbRes.total / limit) || 1,
        });
        return true;
      }

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

    // 2B. RESPOND TO CONNECTION REQUEST NOTIFICATION INLINE: POST /api/notifications/:id/connection-action
    const notifConnActionMatch = pathname.match(/^\/api\/notifications\/([a-zA-Z0-9_-]+)\/connection-action$/);
    if (notifConnActionMatch && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser) {
        sendJson(res, 401, { success: false, message: 'Authentication required.' });
        return true;
      }

      const notifId = notifConnActionMatch[1];
      const body = await parseJsonBody(req);
      const action = String(body.action || '').trim().toLowerCase();
      if (action !== 'accept' && action !== 'reject') {
        sendJson(res, 400, { success: false, message: 'Invalid action. Expected accept or reject.' });
        return true;
      }

      let notifRow: any = null;
      if (isDatabaseAvailable()) {
        const resNotif = await query(
          `SELECT * FROM public.user_notifications WHERE id::text = $1 AND user_id = $2 AND is_deleted = FALSE LIMIT 1`,
          [notifId, authUser.id]
        ).catch(() => ({ rows: [] as any[] }));
        notifRow = resNotif.rows[0] || null;
      }
      if (!notifRow) {
        notifRow = await getUserNotificationByIdFallback(authUser.id, notifId);
      }
      if (!notifRow) {
        sendJson(res, 404, { success: false, message: 'Notification not found.' });
        return true;
      }

      const meta = (notifRow.metadata && typeof notifRow.metadata === 'object' ? notifRow.metadata : {}) as Record<string, any>;
      if (meta.actionType !== 'udhar_connection_request') {
        sendJson(res, 400, {
          success: false,
          message: 'This notification is informational and does not support connection approval actions.',
        });
        return true;
      }

      const currentReqStatus = String(meta.requestStatus || 'pending').toLowerCase();
      if (currentReqStatus !== 'pending') {
        sendJson(res, 409, {
          success: false,
          code: 'ALREADY_RESOLVED',
          status: currentReqStatus,
          message: `This connection request has already been ${currentReqStatus}.`,
        });
        return true;
      }

      const requestKey = String(
        meta.requestId ||
          meta.connectionId ||
          notifRow.related_entity_id ||
          meta.requesterUserId ||
          meta.requesterId ||
          ''
      ).trim();
      if (!requestKey) {
        sendJson(res, 400, { success: false, message: 'Missing connection request reference.' });
        return true;
      }

      let actionResult: { status: number; body: Record<string, any> };
      if (isDatabaseAvailable()) {
        try {
          actionResult =
            action === 'accept'
              ? await acceptConnectionRequestPg(authUser, requestKey)
              : await rejectConnectionRequestPg(authUser, requestKey);
        } catch {
          actionResult =
            action === 'accept'
              ? await acceptConnectionRequestRest(authUser, requestKey)
              : await rejectConnectionRequestRest(authUser, requestKey);
        }
      } else {
        actionResult =
          action === 'accept'
            ? await acceptConnectionRequestRest(authUser, requestKey)
            : await rejectConnectionRequestRest(authUser, requestKey);
      }

      // If request was already accepted/rejected/cancelled elsewhere, sync notification state safely
      if (actionResult.status === 404) {
        await updateConnectionRequestNotificationsState({
          requestId: requestKey,
          requesterId: meta.requesterUserId || meta.requesterId || null,
          receiverId: authUser.id,
          status: 'cancelled',
        }).catch(() => {});
        sendJson(res, 409, {
          success: false,
          code: 'REQUEST_NO_LONGER_PENDING',
          message: 'This connection request is no longer pending.',
        });
        return true;
      }

      if (actionResult.status >= 400) {
        sendJson(res, actionResult.status, actionResult.body);
        return true;
      }

      const resolvedStatus = action === 'accept' ? 'accepted' : 'rejected';
      await updateConnectionRequestNotificationsState({
        requestId: requestKey,
        requesterId: meta.requesterUserId || meta.requesterId || null,
        receiverId: authUser.id,
        status: resolvedStatus,
      }).catch(() => {});

      sendJson(res, 200, {
        ...actionResult.body,
        action,
        requestStatus: resolvedStatus,
        notificationId: notifId,
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
      if (!isDatabaseAvailable() || notifId.startsWith('broadcast_')) {
        const updated = await markUserNotificationReadFallback(authUser.id, notifId);
        sendJson(res, 200, { success: true, notification: updated });
        return true;
      }

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

      if (!isDatabaseAvailable()) {
        await markAllUserNotificationsReadFallback(authUser.id);
        sendJson(res, 200, { success: true, message: 'All notifications marked as read.' });
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
      if (!isDatabaseAvailable() || notifId.startsWith('broadcast_')) {
        await deleteUserNotificationFallback(authUser.id, notifId);
        sendJson(res, 200, { success: true, message: 'Notification removed.' });
        return true;
      }

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

      if (!isDatabaseAvailable()) {
        await clearAllUserNotificationsFallback(authUser.id);
        sendJson(res, 200, { success: true, message: 'All notifications cleared.' });
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
        sound_enabled: body.sound_enabled,
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
      if (!authUser) {
        sendJson(res, 401, {
          success: false,
          message: 'Authentication required to register device installation.',
        });
        return true;
      }
      const body = await parseJsonBody(req);
      const userId = authUser.id;

      const resDev = await recordDeviceInstallation({
        userId,
        portalScope: body.portalScope,
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
      if (!isDatabaseAvailable()) {
        sendJson(res, 200, { success: true, budgets: [] });
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
      if (!isDatabaseAvailable()) {
        sendJson(res, 503, { success: false, message: 'Database unavailable for saving budgets.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const category = String(body.category || '').trim().toLowerCase().slice(0, 60);
      const monthlyLimit = Number(body.monthly_limit ?? body.monthlyLimit);
      const rawThreshold = Number(body.alert_threshold ?? body.alertThreshold);
      const alertThreshold = Number.isFinite(rawThreshold) ? Math.min(100, Math.max(1, Math.round(rawThreshold))) : 85;

      if (!category) {
        sendJson(res, 400, { success: false, message: 'Category is required for budget.' });
        return true;
      }
      if (!Number.isFinite(monthlyLimit) || monthlyLimit <= 0 || monthlyLimit > 999999999) {
        sendJson(res, 400, { success: false, message: 'Monthly budget limit must be between 1 and 99,99,99,999.' });
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
        [authUser.id, category, Math.round(monthlyLimit * 100) / 100, alertThreshold]
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
      if (!isDatabaseAvailable()) {
        sendJson(res, 503, { success: false, message: 'Database unavailable.' });
        return true;
      }

      const budgetId = budgetDeleteMatch[1];
      const delRes = await query(
        `DELETE FROM public.user_budgets WHERE id = $1 AND user_id = $2 RETURNING id`,
        [budgetId, authUser.id]
      );
      if (delRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Budget not found.' });
        return true;
      }

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
      if (!isDatabaseAvailable()) {
        sendJson(res, 200, { success: true, goals: [] });
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
      if (!isDatabaseAvailable()) {
        sendJson(res, 503, { success: false, message: 'Database unavailable for savings goals.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const title = String(body.title || '').trim().slice(0, 120);
      const targetAmount = Number(body.target_amount ?? body.targetAmount);
      const rawCurrent = Number(body.current_amount ?? body.currentAmount ?? 0);
      const currentAmount = Number.isFinite(rawCurrent) ? Math.min(999999999, Math.max(0, rawCurrent)) : 0;
      const rawDate = body.target_date || body.targetDate || null;
      const targetDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(String(rawDate).trim()) ? String(rawDate).trim() : null;
      const category = String(body.category || 'general').trim().slice(0, 60) || 'general';
      const notes = String(body.notes || '').trim().slice(0, 500) || null;
      const isCompleted = !!body.is_completed || currentAmount >= targetAmount;

      if (!title || title.length < 2) {
        sendJson(res, 400, { success: false, message: 'Goal title must be at least 2 characters.' });
        return true;
      }
      if (!Number.isFinite(targetAmount) || targetAmount <= 0 || targetAmount > 999999999) {
        sendJson(res, 400, { success: false, message: 'Target amount must be between 1 and 99,99,99,999.' });
        return true;
      }

      let goalRes;
      if (body.id) {
        goalRes = await query(
          `UPDATE public.savings_goals
           SET title = $1, target_amount = $2, current_amount = $3, target_date = $4, category = $5, notes = $6, is_completed = $7, updated_at = NOW()
           WHERE id = $8 AND user_id = $9
           RETURNING *`,
          [title, Math.round(targetAmount * 100) / 100, Math.round(currentAmount * 100) / 100, targetDate, category, notes, isCompleted, body.id, authUser.id]
        );
        if (goalRes.rows.length === 0) {
          sendJson(res, 404, { success: false, message: 'Savings goal not found.' });
          return true;
        }
      } else {
        goalRes = await query(
          `INSERT INTO public.savings_goals (user_id, title, target_amount, current_amount, target_date, category, notes, is_completed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [authUser.id, title, Math.round(targetAmount * 100) / 100, Math.round(currentAmount * 100) / 100, targetDate, category, notes, isCompleted]
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
      if (!isDatabaseAvailable()) {
        sendJson(res, 503, { success: false, message: 'Database unavailable.' });
        return true;
      }

      const goalId = goalContributeMatch[1];
      const body = await parseJsonBody(req);
      const delta = Number(body.amount);
      const action = body.action === 'withdraw' ? 'withdraw' : 'add';

      if (!Number.isFinite(delta) || delta <= 0 || delta > 999999999) {
        sendJson(res, 400, { success: false, message: 'Contribution amount must be between 1 and 99,99,99,999.' });
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
        : Math.min(999999999, prevAmount + delta);
      const isCompleted = newAmount >= Number(goal.target_amount);

      const updateRes = await query(
        `UPDATE public.savings_goals 
         SET current_amount = $1, is_completed = $2, updated_at = NOW() 
         WHERE id = $3 AND user_id = $4 
         RETURNING *`,
        [Math.round(newAmount * 100) / 100, isCompleted, goalId, authUser.id]
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
      if (!isDatabaseAvailable()) {
        sendJson(res, 503, { success: false, message: 'Database unavailable.' });
        return true;
      }

      const goalId = goalDeleteMatch[1];
      const delRes = await query(
        `DELETE FROM public.savings_goals WHERE id = $1 AND user_id = $2 RETURNING id`,
        [goalId, authUser.id]
      );
      if (delRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Savings goal not found.' });
        return true;
      }

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
      if (!isDatabaseAvailable()) {
        sendJson(res, 200, { success: true, bills: [] });
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
      if (!isDatabaseAvailable()) {
        sendJson(res, 503, { success: false, message: 'Database unavailable for recurring bills.' });
        return true;
      }

      const body = await parseJsonBody(req);
      const title = String(body.title || '').trim().slice(0, 120);
      const category = String(body.category || 'other').trim().toLowerCase().slice(0, 60) || 'other';
      const amount = Number(body.amount);
      const rawFreq = String(body.frequency || 'monthly').trim().toLowerCase();
      const frequency = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(rawFreq) ? rawFreq : 'monthly';
      const rawDueDay = Number(body.due_day ?? body.dueDay);
      const dueDay = Number.isFinite(rawDueDay) ? Math.min(31, Math.max(1, Math.round(rawDueDay))) : 1;
      const reminderEnabled = body.reminder_enabled !== undefined ? !!body.reminder_enabled : true;
      const isActive = body.is_active !== undefined ? !!body.is_active : true;

      if (!title || title.length < 2) {
        sendJson(res, 400, { success: false, message: 'Bill title must be at least 2 characters.' });
        return true;
      }
      if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999) {
        sendJson(res, 400, { success: false, message: 'Bill amount must be between 1 and 99,99,99,999.' });
        return true;
      }

      let billRes;
      if (body.id) {
        billRes = await query(
          `UPDATE public.recurring_bills
           SET title = $1, category = $2, amount = $3, frequency = $4, due_day = $5, reminder_enabled = $6, is_active = $7, updated_at = NOW()
           WHERE id = $8 AND user_id = $9
           RETURNING *`,
          [title, category, Math.round(amount * 100) / 100, frequency, dueDay, reminderEnabled, isActive, body.id, authUser.id]
        );
        if (billRes.rows.length === 0) {
          sendJson(res, 404, { success: false, message: 'Recurring bill not found.' });
          return true;
        }
      } else {
        billRes = await query(
          `INSERT INTO public.recurring_bills (user_id, title, category, amount, frequency, due_day, reminder_enabled, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [authUser.id, title, category, Math.round(amount * 100) / 100, frequency, dueDay, reminderEnabled, isActive]
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
      if (!isDatabaseAvailable()) {
        sendJson(res, 503, { success: false, message: 'Database unavailable.' });
        return true;
      }

      const billId = billPayMatch[1];
      const body = await parseJsonBody(req);
      const rawPaid = String(body.paid_date || '').trim();
      const paidDate = /^\d{4}-\d{2}-\d{2}$/.test(rawPaid) ? rawPaid : new Date().toISOString().split('T')[0];

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
      if (!isDatabaseAvailable()) {
        sendJson(res, 503, { success: false, message: 'Database unavailable.' });
        return true;
      }

      const billId = billDeleteMatch[1];
      const delRes = await query(
        `DELETE FROM public.recurring_bills WHERE id = $1 AND user_id = $2 RETURNING id`,
        [billId, authUser.id]
      );
      if (delRes.rows.length === 0) {
        sendJson(res, 404, { success: false, message: 'Recurring bill not found.' });
        return true;
      }

      sendJson(res, 200, { success: true, message: 'Recurring bill deleted.' });
      return true;
    }

    // Legacy alias: POST /api/send-reset-email (strictly restricted to authenticated admins)
    if (pathname === '/api/send-reset-email' && method === 'POST') {
      const authUser = await authenticateRequest(req);
      if (!authUser || (authUser.role !== 'admin' && authUser.role !== 'superadmin')) {
        sendJson(res, 403, { success: false, message: 'Access Denied: Administrator authentication required.' });
        return true;
      }
      const body = await parseJsonBody(req);
      const email = normalizeEmail(body.email || '');
      if (!validateEmail(email)) {
        sendJson(res, 400, { success: false, message: 'Valid email address is required.' });
        return true;
      }

      let targetUser: any = null;
      if (isDatabaseAvailable()) {
        const uRes = await query('SELECT id, full_name, email FROM public.app_users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
        targetUser = uRes.rows[0] || null;
      } else {
        const fbUsers = await listAllAppUsersFallback();
        targetUser = fbUsers.find((u) => String(u.email || '').trim().toLowerCase() === email) || null;
      }
      if (!targetUser) {
        sendJson(res, 404, { success: false, message: 'User account not found.' });
        return true;
      }

      const rawToken = generateCryptoToken(32);
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      if (isDatabaseAvailable()) {
        await query('UPDATE public.password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE', [targetUser.id]).catch(() => {});
        await query(
          `INSERT INTO public.password_resets (user_id, token_hash, expires_at, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5)`,
          [targetUser.id, tokenHash, expiresAt, clientIp, 'Admin-Initiated-Legacy-Dispatch']
        ).catch(() => {});
      }

      const appBase = APP_CONFIG.appBaseUrl || process.env.APP_BASE_URL || 'https://mymoney.nileshbarela.site';
      const resetLink = `${appBase}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;
      const sent = await sendPasswordResetEmail(email, String(targetUser.full_name || body.name || 'User').slice(0, 80), resetLink);

      if (isDatabaseAvailable()) {
        await logSecurityEvent('ADMIN_SENT_PASSWORD_RESET_EMAIL', {
          userId: authUser.id,
          actorRole: authUser.role,
          ipAddress: clientIp,
          details: { targetUserId: targetUser.id, targetEmail: email, emailDispatched: sent },
        }).catch(() => {});
      }

      sendJson(res, 200, { success: sent, message: sent ? 'Reset email dispatched' : 'Failed to dispatch email' });
      return true;
    }

    // Route not handled by API
    sendJson(res, 404, { success: false, message: 'API endpoint not found.' });
    return true;
  } catch (err: any) {
    if (err?.message === 'Request payload too large' || err?.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, {
        success: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Uploaded request payload exceeds the maximum allowed server limit.',
      });
      return true;
    }
    console.error(`[API Error] ${method} ${pathname}:`, err);
    sendJson(res, 500, {
      success: false,
      message: 'An internal server security error occurred. Please try again later.',
    });
    return true;
  }
  } finally {
    releaseConcurrencySlot();
  }
}
