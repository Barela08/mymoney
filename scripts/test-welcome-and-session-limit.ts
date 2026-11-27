import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  MAX_ACTIVE_SESSIONS,
  SessionLimitError,
  parseUserAgentSummary,
  revokeAllUserSessions,
} from '../server/auth';
import { handleApiRequest } from '../server/api';
import { isDatabaseAvailable, query } from '../server/db';
import { sbRestRequest } from '../server/supabaseRestFallback';

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
    await query('DELETE FROM public.user_notifications WHERE user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.user_sessions WHERE user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.app_users WHERE id = $1', [userId]).catch(() => {});
  }
  await sbRestRequest(`user_notifications?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`user_sessions?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`app_users?id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
}

async function main() {
  console.log('=== Welcome Notification & 3-Device Session Limit Test Suite ===\n');
  let passed = 0;
  let failed = 0;

  const check = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  FAIL: ${name} -> ${err?.message || err}`);
      failed++;
    }
  };

  await check('MAX_ACTIVE_SESSIONS constant is 3 and SessionLimitError uses HTTP 409', () => {
    assert.equal(MAX_ACTIVE_SESSIONS, 3);
    const err = new SessionLimitError([], 3);
    assert.equal(err.status, 409);
    assert.equal(err.code, 'MAX_SESSIONS_REACHED');
  });

  await check('parseUserAgentSummary classifies desktop, mobile, and tablet user-agents cleanly', () => {
    const winChrome = parseUserAgentSummary(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    assert.equal(winChrome.deviceType, 'desktop');
    assert.equal(winChrome.browser, 'Chrome');
    assert.equal(winChrome.os, 'Windows');
    assert.equal(winChrome.deviceName, 'Chrome on Windows');

    const iphoneSafari = parseUserAgentSummary(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    );
    assert.equal(iphoneSafari.deviceType, 'mobile');
    assert.equal(iphoneSafari.browser, 'Safari');
    assert.equal(iphoneSafari.os, 'iOS (iPhone)');

    const ipad = parseUserAgentSummary(
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
    );
    assert.equal(ipad.deviceType, 'tablet');
  });

  const suffix = crypto.randomBytes(5).toString('hex');
  const userAEmail = `welcome_session_a_${suffix}@example.com`;
  const userBEmail = `welcome_session_b_${suffix}@example.com`;
  const password = 'StrongPassword#2026';
  let userAId: string | undefined;
  let userBId: string | undefined;

  try {
    let token1 = '';
    let token2 = '';
    let token3 = '';
    let token4 = '';
    let tokenB = '';

    await check('Registering a new user immediately creates an unread in-app welcome notification', async () => {
      const reg = await apiCall({
        method: 'POST',
        url: '/api/auth/register',
        ip: '10.10.0.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
        body: {
          fullName: 'Aarav Tester',
          email: userAEmail,
          password,
          confirmPassword: password,
        },
      });
      assert.equal(reg.status, 201, `Expected 201, got ${reg.status}: ${JSON.stringify(reg.body)}`);
      assert.equal(reg.body.success, true);
      userAId = reg.body.user?.id;
      token1 = reg.body.sessionToken;
      assert.ok(userAId, 'User A ID must exist');
      assert.ok(token1, 'Initial registration session token must exist');

      const notifRes = await apiCall({
        method: 'GET',
        url: '/api/notifications',
        token: token1,
      });
      assert.equal(notifRes.status, 200);
      const items: any[] = notifRes.body.notifications || [];
      const welcome = items.find((n) =>
        String(n.dedupeKey || n.dedupe_key || n.metadata?.dedupeKey || '').startsWith('welcome_in_app:')
      );
      assert.ok(welcome, 'Unread welcome in-app notification must appear immediately after registration');
      assert.equal(welcome.title, 'Welcome to My Money Manager!');
      assert.equal(welcome.isRead ?? welcome.is_read, false);
      assert.ok((notifRes.body.unreadCount ?? 0) >= 1, 'unreadCount must reflect the welcome notification');
    });

    await check('Account allows up to 3 concurrent active logins (devices 1, 2, 3) and rejects 4th with 409', async () => {
      const login2 = await apiCall({
        method: 'POST',
        url: '/api/auth/login',
        ip: '10.10.0.2',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1',
        body: { email: userAEmail, password },
      });
      assert.equal(login2.status, 200, `Expected 200 for device 2, got ${login2.status}: ${JSON.stringify(login2.body)}`);
      token2 = login2.body.sessionToken;

      const login3 = await apiCall({
        method: 'POST',
        url: '/api/auth/login',
        ip: '10.10.0.3',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Firefox/132.0',
        body: { email: userAEmail, password },
      });
      assert.equal(login3.status, 200, `Expected 200 for device 3, got ${login3.status}: ${JSON.stringify(login3.body)}`);
      token3 = login3.body.sessionToken;

      const login4 = await apiCall({
        method: 'POST',
        url: '/api/auth/login',
        ip: '10.10.0.4',
        userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/131.0.0.0 Mobile Safari/537.36',
        body: { email: userAEmail, password },
      });
      assert.equal(login4.status, 409, `Expected 409 on 4th login, got ${login4.status}`);
      assert.equal(login4.body.code, 'MAX_SESSIONS_REACHED');
      assert.equal(login4.body.maxSessions, 3);
      assert.equal(login4.body.activeSessions?.length, 3);
    });

    let sessionsOnA: any[] = [];
    await check('GET /api/auth/sessions lists all 3 active devices without leaking session hashes', async () => {
      const res = await apiCall({
        method: 'GET',
        url: '/api/auth/sessions',
        token: token1,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.activeCount, 3);
      assert.equal(res.body.maxSessions, 3);
      sessionsOnA = res.body.sessions || [];
      assert.equal(sessionsOnA.length, 3);
      const currentOnes = sessionsOnA.filter((s) => s.isCurrent === true);
      assert.equal(currentOnes.length, 1, 'Exactly one session must be marked isCurrent');
      for (const s of sessionsOnA) {
        assert.equal('session_token_hash' in s, false, 'Must never expose session_token_hash');
        assert.ok(s.deviceName && s.browser && s.os && s.deviceType);
      }
    });

    await check('IDOR check: Another user cannot revoke User A sessions via DELETE /api/auth/sessions/:id', async () => {
      const regB = await apiCall({
        method: 'POST',
        url: '/api/auth/register',
        ip: '10.10.0.99',
        body: { fullName: 'Second User', email: userBEmail, password, confirmPassword: password },
      });
      assert.equal(regB.status, 201);
      userBId = regB.body.user?.id;
      tokenB = regB.body.sessionToken;

      const targetFromA = sessionsOnA.find((s) => !s.isCurrent);
      assert.ok(targetFromA?.id);

      const idorAttempt = await apiCall({
        method: 'DELETE',
        url: `/api/auth/sessions/${encodeURIComponent(targetFromA.id)}`,
        token: tokenB,
      });
      assert.equal(idorAttempt.status, 404, `Cross-user revoke must return 404, got ${idorAttempt.status}`);
    });

    await check('Remote logout revokes targeted session, invalidates its token, and allows a new 3rd login', async () => {
      // Identify which session corresponds to token2
      const listAs2 = await apiCall({ method: 'GET', url: '/api/auth/sessions', token: token2 });
      const session2 = (listAs2.body.sessions || []).find((s: any) => s.isCurrent === true);
      assert.ok(session2?.id, 'Must find session2 ID');

      // Remotely revoke session2 from device 1
      const revokeRes = await apiCall({
        method: 'DELETE',
        url: `/api/auth/sessions/${encodeURIComponent(session2.id)}`,
        token: token1,
      });
      assert.equal(revokeRes.status, 200);
      assert.equal(revokeRes.body.activeCount, 2);

      // Token2 must now fail authentication immediately
      const me2 = await apiCall({ method: 'GET', url: '/api/auth/me', token: token2 });
      assert.equal(me2.status, 401, 'Revoked session token must return 401');

      // Device 4 can now sign in cleanly
      const login4Retry = await apiCall({
        method: 'POST',
        url: '/api/auth/login',
        ip: '10.10.0.4',
        userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/131.0.0.0 Mobile Safari/537.36',
        body: { email: userAEmail, password },
      });
      assert.equal(login4Retry.status, 200, 'Login on 4th device should succeed after remote logout');
      token4 = login4Retry.body.sessionToken;
      assert.ok(token4);
    });

    await check('Login with replaceSessionId swaps out an older active session atomically', async () => {
      const listAs3 = await apiCall({ method: 'GET', url: '/api/auth/sessions', token: token3 });
      const session3 = (listAs3.body.sessions || []).find((s: any) => s.isCurrent === true);
      assert.ok(session3?.id);

      const login5 = await apiCall({
        method: 'POST',
        url: '/api/auth/login',
        ip: '10.10.0.5',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Edg/131.0.0.0',
        body: { email: userAEmail, password, replaceSessionId: session3.id },
      });
      assert.equal(login5.status, 200, `Expected 200 with replaceSessionId, got ${login5.status}: ${JSON.stringify(login5.body)}`);

      const me3 = await apiCall({ method: 'GET', url: '/api/auth/me', token: token3 });
      assert.equal(me3.status, 401, 'Replaced session token must immediately return 401');
    });
  } finally {
    await cleanupTestUser(userAId);
    await cleanupTestUser(userBId);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal suite error:', err);
  process.exit(1);
});
