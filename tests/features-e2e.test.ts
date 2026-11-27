import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  formatPersonalizedGreeting,
  generateWelcomeEmail,
} from '../server/welcomeEmailTemplate';
import {
  sendWelcomeEmail,
  getWelcomeEmailDeliveryStatus,
} from '../server/email';
import {
  recordAdminNotification,
  getAdminNotifications,
  markAdminNotificationRead,
} from '../server/notificationService';
import {
  MAX_ACTIVE_SESSIONS,
  revokeAllUserSessions,
} from '../server/auth';
import { handleApiRequest } from '../server/api';
import { isDatabaseAvailable, query } from '../server/db';
import { sbRestRequest } from '../server/supabaseRestFallback';
import {
  ACTIVE_REMINDER_DELAY_MS,
  getActiveElapsedMs,
  transitionActiveReminderVisibility,
  isActiveReminderDue,
  isInstallSuggestionSuppressed,
  type ActiveReminderState,
} from '../src/lib/pwaUtils';

function createMockReq(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  ip?: string;
}): IncomingMessage {
  const payload = opts.body !== undefined ? JSON.stringify(opts.body) : '';
  const stream = Readable.from(payload ? [Buffer.from(payload, 'utf8')] : []) as IncomingMessage;
  stream.method = opts.method;
  stream.url = opts.url;
  stream.headers = {
    host: 'localhost:3000',
    ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(opts.headers || {}),
  };
  (stream as any).socket = { remoteAddress: opts.ip || '127.0.0.1' };
  return stream;
}

function createMockRes(): {
  res: ServerResponse;
  getStatus: () => number;
  getBody: () => any;
} {
  let statusCode = 200;
  const chunks: string[] = [];
  const headers: Record<string, string | string[]> = {};

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    writeHead(code: number, hdrs?: Record<string, string | string[]>) {
      statusCode = code;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          headers[k.toLowerCase()] = v;
        }
      }
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      }
      (res as any).writableEnded = true;
      return res;
    },
    writableEnded: false,
  } as unknown as ServerResponse;

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => {
      const raw = chunks.join('');
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },
  };
}

async function apiCall(opts: {
  method: string;
  url: string;
  token?: string;
  userAgent?: string;
  ip?: string;
  body?: unknown;
}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.userAgent) headers['user-agent'] = opts.userAgent;
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;

  const req = createMockReq({
    method: opts.method,
    url: opts.url,
    headers,
    body: opts.body,
    ip: opts.ip,
  });
  const mock = createMockRes();
  const handled = await handleApiRequest(req, mock.res);
  assert.equal(handled, true, `Expected API route ${opts.method} ${opts.url} to be handled`);
  return { status: mock.getStatus(), body: mock.getBody() };
}

async function cleanupTestUser(userId?: string) {
  if (!userId) return;
  try {
    await revokeAllUserSessions(userId);
  } catch {}
  if (isDatabaseAvailable()) {
    await query('DELETE FROM public.email_dispatch_logs WHERE user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.admin_notifications WHERE user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.user_notifications WHERE user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.user_sessions WHERE user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.app_users WHERE id = $1', [userId]).catch(() => {});
  }
  await sbRestRequest(`email_dispatch_logs?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`admin_notifications?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`user_notifications?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`user_sessions?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`app_users?id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
}

describe('1. Welcome Email Template & Delivery Reliability', () => {
  it('renders exact subject, required product mentions, HackifyPro branding, and escapes XSS in name', () => {
    assert.equal(
      formatPersonalizedGreeting('<script>alert(1)</script>'),
      'Hi &lt;script&gt;alert(1)&lt;/script&gt;,'
    );

    const email = generateWelcomeEmail({
      userName: 'Priya Sharma',
      userEmail: 'priya@example.com',
      loginUrl: 'https://mymoney.nileshbarela.site/',
    });

    assert.equal(
      email.subject,
      'Welcome to My Money Manager – Your Financial Journey Starts Here!'
    );
    assert.ok(email.html.includes('Hi Priya,'));
    assert.ok(/transaction management/i.test(email.html));
    assert.ok(/UPI QR/i.test(email.html));
    assert.ok(/Udhar/i.test(email.html));
    assert.ok(/financial reports/i.test(email.html));
    assert.ok(email.html.includes('HackifyPro') || email.html.includes('HACKIFYPRO'));
    assert.ok(email.html.includes('https://mymoney.nileshbarela.site/'));
    assert.ok(/transaction management/i.test(email.text));
    assert.ok(/UPI QR/i.test(email.text));
    assert.ok(/Udhar/i.test(email.text));
    assert.ok(/financial reports/i.test(email.text));
  });

  it('never blocks or throws when dispatching welcome email and records delivery log cleanly', async () => {
    const suffix = crypto.randomBytes(4).toString('hex');
    const email = `welcome_status_${suffix}@example.com`;
    const result = await sendWelcomeEmail(email, 'Rohan Verma', `uid-${suffix}`);
    assert.ok(['sent', 'retrying', 'failed', 'skipped_duplicate'].includes(result.status));
    const status = await getWelcomeEmailDeliveryStatus(email);
    assert.ok(status.found, 'Delivery log status must be recorded');
  });
});

describe('2. PWA Persistent 60s Active-Page Install Reminder Logic', () => {
  it('accumulates strictly across visible intervals and reaches due at 60s', () => {
    assert.equal(ACTIVE_REMINDER_DELAY_MS, 60_000);
    let state: ActiveReminderState = { accumulatedMs: 0, visibleSinceMs: 1_000 };

    // 35s visible
    assert.equal(getActiveElapsedMs(state, 36_000), 35_000);
    assert.equal(isActiveReminderDue(state, 36_000), false);

    // Tab switches hidden for 5 minutes -> accumulated stays 35s
    state = transitionActiveReminderVisibility(state, false, 36_000);
    assert.equal(getActiveElapsedMs(state, 336_000), 35_000);
    assert.equal(isActiveReminderDue(state, 336_000), false);

    // Tab returns visible -> finishes remaining 25s
    state = transitionActiveReminderVisibility(state, true, 336_000);
    assert.equal(isActiveReminderDue(state, 360_999), false);
    assert.equal(isActiveReminderDue(state, 361_000), true);
  });

  it('separates current-visit dismissal from permanent installation suppression', () => {
    // Same-visit dismissal hides popup on current visit
    assert.equal(
      isInstallSuggestionSuppressed({
        sessionDismissed: true,
        persistedDismissedAt: Date.now(),
      }),
      true
    );

    // New visit after cooldown (or cleared dismissal when re-armed) shows reminder again if still uninstalled
    assert.equal(
      isInstallSuggestionSuppressed({
        sessionDismissed: false,
        persistedDismissedAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
      }),
      false
    );
  });
});

describe('3. Admin New-User Registration Notification, Deduplication, RBAC & 3-Session Enforcement', () => {
  it('creates user welcome notification + deduped admin alert, enforces RBAC, enforces 3-session concurrency & revoke-others', async () => {
    const suffix = crypto.randomBytes(5).toString('hex');
    const userEmail = `e2e_user_${suffix}@example.com`;
    const adminEmail = `e2e_admin_${suffix}@example.com`;
    let adminId: string | undefined;
    let adminToken = '';
    const password = 'SecurePassword#2026';
    let registeredUserId: string | undefined;

    try {
      // Register temporary admin user via real registration endpoint and elevate role cleanly
      const adminReg = await apiCall({
        method: 'POST',
        url: '/api/auth/register',
        ip: '10.20.0.99',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0.0.0',
        body: {
          fullName: 'QA Master Admin',
          email: adminEmail,
          password,
          confirmPassword: password,
        },
      });
      assert.equal(adminReg.status, 201, `Admin seed registration failed: ${JSON.stringify(adminReg.body)}`);
      adminId = adminReg.body.user?.id;
      adminToken = adminReg.body.sessionToken;
      assert.ok(adminId && adminToken);

      await sbRestRequest(`app_users?id=eq.${encodeURIComponent(adminId)}`, {
        method: 'PATCH',
        body: { role: 'superadmin' },
      }).catch(() => {});
      if (isDatabaseAvailable()) {
        await query(`UPDATE public.app_users SET role = 'superadmin' WHERE id = $1`, [adminId]).catch(() => {});
      }

      // 1. Register user (session #1)
      const reg = await apiCall({
        method: 'POST',
        url: '/api/auth/register',
        ip: '10.20.0.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
        body: {
          fullName: 'Kabir Mehta',
          email: userEmail,
          password,
          confirmPassword: password,
        },
      });
      assert.equal(reg.status, 201, `Registration failed: ${JSON.stringify(reg.body)}`);
      registeredUserId = reg.body.user?.id;
      const token1 = reg.body.sessionToken;
      assert.ok(registeredUserId && token1);

      // Deduplication test: trigger recordAdminNotification again with same dedupeKey
      await recordAdminNotification({
        eventType: 'new_user',
        title: 'New User Registered',
        message: 'Duplicate check',
        userId: registeredUserId,
        userName: 'Kabir Mehta',
        userEmail,
        dedupeKey: `new_user:${registeredUserId}`,
      });

      // RBAC check: normal user CANNOT read admin system notifications
      const forbiddenRes = await apiCall({
        method: 'GET',
        url: '/api/admin/system/notifications',
        token: token1,
      });
      assert.ok(forbiddenRes.status === 401 || forbiddenRes.status === 403);

      // Admin CAN read notifications and sees exactly 1 deduped New User Registered entry
      const adminNotifsRes = await apiCall({
        method: 'GET',
        url: '/api/admin/system/notifications',
        token: adminToken,
      });
      assert.equal(adminNotifsRes.status, 200);
      const matching = (adminNotifsRes.body.notifications || []).filter(
        (n: any) => n.event_type === 'new_user' && n.user_id === registeredUserId
      );
      assert.equal(matching.length, 1, 'Expected exactly 1 deduped admin registration notification');
      assert.equal(matching[0].title, 'New User Registered');
      assert.equal(matching[0].user_email, userEmail);
      assert.equal(matching[0].user_name, 'Kabir Mehta');
      assert.equal(matching[0].is_read, false);

      // Mark notification read via API
      const markReadRes = await apiCall({
        method: 'POST',
        url: `/api/admin/system/notifications/${encodeURIComponent(matching[0].id)}/read`,
        token: adminToken,
      });
      assert.equal(markReadRes.status, 200);
      const afterRead = await getAdminNotifications(50);
      const updated = afterRead.find((n) => n.id === matching[0].id);
      assert.equal(updated?.is_read, true);

      // 2. Concurrent login race: user already has 1 active session, fire 3 concurrent logins (total 4 attempted)
      assert.equal(MAX_ACTIVE_SESSIONS, 3);
      const concurrentLogins = await Promise.all([
        apiCall({
          method: 'POST',
          url: '/api/auth/login',
          ip: '10.20.0.2',
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile Safari/604.1',
          body: { email: userEmail, password },
        }),
        apiCall({
          method: 'POST',
          url: '/api/auth/login',
          ip: '10.20.0.3',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Firefox/132.0',
          body: { email: userEmail, password },
        }),
        apiCall({
          method: 'POST',
          url: '/api/auth/login',
          ip: '10.20.0.4',
          userAgent: 'Mozilla/5.0 (Linux; Android 14) Edg/131.0.0.0',
          body: { email: userEmail, password },
        }),
      ]);

      const successes = concurrentLogins.filter((r) => r.status === 200);
      const rejections = concurrentLogins.filter((r) => r.status === 409);
      assert.equal(successes.length, 2, `Expected 2 concurrent successes (total 3), got ${successes.length}`);
      assert.equal(rejections.length, 1, `Expected 1 strict 409 rejection, got ${rejections.length}`);
      assert.equal(rejections[0].body.code, 'MAX_SESSIONS_REACHED');
      assert.equal(
        rejections[0].body.message,
        'You have reached the maximum limit of 3 active devices. Please log out from an existing device before signing in here.'
      );

      // 3. Logout from all other devices keeps token1 active and revokes the 2 other tokens
      const otherTokens = successes.map((r) => r.body.sessionToken as string);
      const revokeOthersRes = await apiCall({
        method: 'POST',
        url: '/api/auth/sessions/revoke-others',
        token: token1,
      });
      assert.equal(revokeOthersRes.status, 200);
      assert.equal(revokeOthersRes.body.activeCount, 1);

      const currentMe = await apiCall({ method: 'GET', url: '/api/auth/me', token: token1 });
      assert.equal(currentMe.status, 200, 'Current device session must stay active after revoke-others');

      for (const t of otherTokens) {
        const otherMe = await apiCall({ method: 'GET', url: '/api/auth/me', token: t });
        assert.equal(otherMe.status, 401, 'Other device tokens must immediately return 401');
      }
    } finally {
      await cleanupTestUser(registeredUserId);
      await cleanupTestUser(adminId);
    }
  });
});
