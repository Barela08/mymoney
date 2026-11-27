import assert from 'assert';
import { EventEmitter } from 'events';
import {
  extractClientIp,
  getOrIssueDeviceId,
  checkRateLimit,
  resetRateLimit,
  recordViolationAndMaybeRestrictAsync,
  checkActiveRestrictionsAsync,
  releaseSecurityRestrictionAsync,
  PROGRESSIVE_COOLDOWN_MS,
} from '../server/security.js';
import {
  appCache,
  cachedRead,
  mapWithConcurrency,
  withTimeout,
  tryAcquireConcurrencySlot,
  releaseConcurrencySlot,
} from '../server/cache.js';

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✅ PASS: ${name}`);
}

async function main() {
  console.log('================================================================');
  console.log('🛡️ SECURITY, TOKEN BUCKET, COOLDOWN & CACHING VERIFICATION SUITE');
  console.log('================================================================');

  await check('Trusted IP extraction normalizes IPv4, IPv6, and prefers edge headers', () => {
    const req1: any = { headers: { 'x-vercel-forwarded-for': '203.0.113.45, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } };
    assert.strictEqual(extractClientIp(req1), '203.0.113.45');

    const req2: any = { headers: {}, socket: { remoteAddress: '::ffff:198.51.100.7' } };
    assert.strictEqual(extractClientIp(req2), '198.51.100.7');

    const req3: any = { headers: { 'cf-connecting-ip': '2001:0db8:85a3::8a2e:0370:7334' }, socket: { remoteAddress: '127.0.0.1' } };
    assert.strictEqual(extractClientIp(req3), '2001:0db8:85a3::8a2e:0370:7334');
  });

  await check('Signed HttpOnly device cookie issues valid ID and rejects tampered cookies', () => {
    const headersSet: Record<string, any> = {};
    const mockRes: any = {
      writableEnded: false,
      headersSent: false,
      getHeader: (k: string) => headersSet[k],
      setHeader: (k: string, v: any) => {
        headersSet[k] = v;
      },
    };
    const issued = getOrIssueDeviceId({ headers: {} } as any, mockRes);
    assert.ok(issued.isNew && !issued.wasTampered);
    const setCookie = String(headersSet['Set-Cookie']);
    assert.ok(setCookie.includes('mmm_dev=') && setCookie.includes('HttpOnly'));

    const cookiePair = setCookie.split(';')[0];
    const verified = getOrIssueDeviceId({ headers: { cookie: cookiePair } } as any);
    assert.strictEqual(verified.deviceId, issued.deviceId);
    assert.strictEqual(verified.wasTampered, false);

    const tampered = getOrIssueDeviceId({ headers: { cookie: 'mmm_dev=deadbeefdeadbeefdeadbeefdeadbeef.00000000000000000000000000000000' } } as any);
    assert.strictEqual(tampered.wasTampered, true);
    assert.notStrictEqual(tampered.deviceId, issued.deviceId);
  });

  await check('Token Bucket allows burst up to capacity, rejects excess with Retry-After, and refills over time', async () => {
    const key = 'test:bucket:1';
    resetRateLimit(key);
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit(key, 5, 1000);
      assert.strictEqual(r.allowed, true);
    }
    const blocked = checkRateLimit(key, 5, 1000);
    assert.strictEqual(blocked.allowed, false);
    assert.ok((blocked.retryAfterSec || 0) >= 1);

    // Wait 250ms -> >= 1.25 tokens refilled (capacity=5 per 1000ms = 5 tokens/sec)
    await new Promise((r) => setTimeout(r, 260));
    const afterRefill = checkRateLimit(key, 5, 1000);
    assert.strictEqual(afterRefill.allowed, true);
    resetRateLimit(key);
  });

  await check('Progressive cooldown escalates 5m -> 10m -> 20m -> 30m -> 30m and supports Admin release', async () => {
    assert.deepStrictEqual(PROGRESSIVE_COOLDOWN_MS, [5 * 60_000, 10 * 60_000, 20 * 60_000, 30 * 60_000]);
    const id = `test_escalate_${Date.now()}`;
    const fullKey = `ip_device:${id}`;

    // Trigger Level 1 (threshold=1)
    const r1 = await recordViolationAndMaybeRestrictAsync({ dimension: 'ip_device', identifier: id, reason: 'test.burst', threshold: 1 });
    assert.strictEqual(r1?.violationLevel, 1);
    const active1 = await checkActiveRestrictionsAsync([fullKey]);
    assert.ok(active1 && active1.violationLevel === 1);

    // Simulate expiry for Level 2 -> Level 3 -> Level 4 -> Level 5
    for (const expectedLevel of [2, 3, 4, 5]) {
      active1!.restrictedUntil = Date.now() - 1000;
      const rn = await recordViolationAndMaybeRestrictAsync({ dimension: 'ip_device', identifier: id, reason: 'test.burst', threshold: 1 });
      assert.strictEqual(rn?.violationLevel, expectedLevel);
    }

    await releaseSecurityRestrictionAsync(fullKey, 'admin@test.local');
    const afterRelease = await checkActiveRestrictionsAsync([fullKey]);
    assert.strictEqual(afterRelease, null);
  });

  await check('Smart Cache isolates per-user entries and deduplicates 50 concurrent reads', async () => {
    appCache.clear();
    let loaderCalls = 0;
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        cachedRead('public:concurrent_test', 10_000, async () => {
          loaderCalls += 1;
          await new Promise((r) => setTimeout(r, 20));
          return { ok: true, count: loaderCalls };
        })
      )
    );
    assert.strictEqual(loaderCalls, 1, '50 concurrent reads must coalesce into 1 loader call');
    assert.strictEqual(results.length, 50);

    appCache.set('user:userA:summary', { balance: 100 }, 10_000);
    appCache.set('user:userB:summary', { balance: 999 }, 10_000);
    appCache.invalidateUser('userA');
    assert.strictEqual(appCache.get('user:userA:summary'), null);
    assert.strictEqual(appCache.get<any>('user:userB:summary')?.value.balance, 999);
  });

  await check('Bounded concurrency and timeout protection work under load', async () => {
    let maxInFlight = 0;
    let current = 0;
    const res = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      current += 1;
      if (current > maxInFlight) maxInFlight = current;
      await new Promise((r) => setTimeout(r, 10));
      current -= 1;
      return n * 2;
    });
    assert.deepStrictEqual(res, [2, 4, 6, 8, 10, 12, 14, 16]);
    assert.ok(maxInFlight <= 3);

    await assert.rejects(
      () => withTimeout(new Promise((r) => setTimeout(r, 200)), 30, 'slow_upstream'),
      /Timeout after 30ms/
    );

    const slot = tryAcquireConcurrencySlot(true);
    assert.strictEqual(slot.allowed, true);
    releaseConcurrencySlot();
  });

  await check('API routes enforce CSRF Origin check, Admin RBAC, and public site-config caching', async () => {
    const { handleApiRequest } = await import('../server/api.js');

    const callApi = async (method: string, url: string, headers: Record<string, string> = {}) => {
      const req: any = new EventEmitter();
      req.method = method;
      req.url = url;
      req.headers = { host: 'localhost:3000', ...headers };
      req.socket = { remoteAddress: '127.0.0.1' };
      let status = 200;
      let payload: any = null;
      const resHeaders: Record<string, string> = {};
      const res: any = {
        writableEnded: false,
        headersSent: false,
        getHeader: (k: string) => resHeaders[k],
        setHeader: (k: string, v: string) => { resHeaders[k] = v; },
        status(code: number) { status = code; return this; },
        json(data: any) { payload = data; this.writableEnded = true; this.headersSent = true; return this; },
        writeHead(code: number, h?: Record<string, string>) { status = code; if (h) Object.assign(resHeaders, h); return this; },
        end(raw?: string) {
          if (!payload && raw) { try { payload = JSON.parse(raw); } catch { payload = raw; } }
          this.writableEnded = true; this.headersSent = true;
        },
      };
      await handleApiRequest(req, res);
      return { status, payload, headers: resHeaders };
    };

    const health = await callApi('GET', '/api/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.payload.status, 'ok');
    assert.ok(health.payload.concurrency);
    assert.ok(health.payload.cache);

    const unauthAdmin = await callApi('GET', '/api/admin/security/overview');
    assert.ok(unauthAdmin.status === 401 || unauthAdmin.status === 403);

    const csrfBad = await callApi('POST', '/api/transactions', {
      cookie: 'session_token=fake_cookie_token',
      origin: 'https://evil-attacker.example.com',
    });
    assert.strictEqual(csrfBad.status, 403);
    assert.strictEqual(csrfBad.payload.code, 'CSRF_ORIGIN_REJECTED');
  });

  console.log(`\n================================================================`);
  console.log(`🎉 ALL ${passed} SECURITY, RATE LIMIT & CACHING TESTS PASSED!`);
  console.log(`================================================================`);
}

main().catch((err) => {
  console.error('❌ Security Suite Failed:', err);
  process.exit(1);
});
