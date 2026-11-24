/**
 * Automated Live HTTP, Security & Integration Verification Suite
 * Project: My Money Manager by HackifyPro
 * Tests live endpoints on http://127.0.0.1:3000 (non-destructive, read/guard checks).
 */
import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true, detail: 'PASS' });
  } catch (err: any) {
    results.push({ name, passed: false, detail: `FAIL: ${err?.message || err}` });
  }
}

async function run() {
  console.log('================================================================');
  console.log('MY MONEY MANAGER — LIVE HTTP & SECURITY INTEGRATION SUITE');
  console.log(`Target: ${BASE_URL}`);
  console.log('================================================================\n');

  // 1. Root SPA & Security Headers
  await check('GET / serves SPA HTML with strict security headers', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get('content-security-policy') || '').includes("default-src 'self'"));
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((res.headers.get('permissions-policy') || '').includes('camera=(self)'));
  });

  // 2. All 6 AI Financial Intelligence SPA Routes
  const spaRoutes = [
    '/ai-assistant',
    '/expense-calendar',
    '/smart-alerts',
    '/receipt-scanner',
    '/net-worth',
    '/safe-to-spend',
  ];
  for (const route of spaRoutes) {
    await check(`SPA route ${route} returns HTTP 200`, async () => {
      const res = await fetch(`${BASE_URL}${route}`);
      assert.equal(res.status, 200);
    });
  }

  // 3. Health & AI Status Endpoints (No Secret Leakage)
  await check('GET /api/health returns 200 with clean payload', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.status, 'ok');
  });

  await check('GET /api/ai/status returns 200 without leaking secrets', async () => {
    const res = await fetch(`${BASE_URL}/api/ai/status`);
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.ok(!raw.includes('AIza'), 'Must never leak Google API key');
    const data = JSON.parse(raw);
    assert.equal(data.success, true);
    assert.equal(typeof data.status?.configured, 'boolean');
    assert.equal(typeof data.status?.model, 'string');
  });

  // 4. CORS Origin Allowlist Enforcement
  await check('CORS rejects arbitrary untrusted origin reflection', async () => {
    const res = await fetch(`${BASE_URL}/api/health`, {
      headers: { Origin: 'https://evil-attacker.example' },
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get('access-control-allow-origin'),
      null,
      'Untrusted origin must NOT be echoed in Access-Control-Allow-Origin'
    );
  });

  await check('CORS allows trusted localhost origin with Vary: Origin', async () => {
    const res = await fetch(`${BASE_URL}/api/health`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.ok((res.headers.get('vary') || '').toLowerCase().includes('origin'));
  });

  // 5. Unauthenticated Access Blocked (401) Across All Protected AI & Finance APIs
  const protectedEndpoints: Array<{ method: string; path: string }> = [
    { method: 'GET', path: '/api/ai/conversations' },
    { method: 'POST', path: '/api/ai/conversations' },
    { method: 'POST', path: '/api/ai/assistant/chat' },
    { method: 'GET', path: '/api/ai/categorization/rules' },
    { method: 'POST', path: '/api/ai/categorization/predict' },
    { method: 'POST', path: '/api/ai/receipt-ocr' },
    { method: 'GET', path: '/api/finance/receipts' },
    { method: 'GET', path: '/api/finance/net-worth' },
    { method: 'POST', path: '/api/finance/net-worth/assets' },
    { method: 'POST', path: '/api/finance/net-worth/liabilities' },
    { method: 'POST', path: '/api/finance/net-worth/snapshots' },
    { method: 'GET', path: '/api/finance/safe-to-spend/preferences' },
    { method: 'PUT', path: '/api/finance/safe-to-spend/preferences' },
    { method: 'GET', path: '/api/finance/smart-alerts/state' },
    { method: 'PUT', path: '/api/finance/smart-alerts/preferences' },
    { method: 'POST', path: '/api/finance/smart-alerts/events' },
  ];

  for (const ep of protectedEndpoints) {
    await check(`Unauthenticated ${ep.method} ${ep.path} rejected with 401`, async () => {
      const res = await fetch(`${BASE_URL}${ep.path}`, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: ep.method === 'GET' ? undefined : JSON.stringify({}),
      });
      assert.equal(res.status, 401, `Expected 401 for ${ep.method} ${ep.path}, got ${res.status}`);
    });
  }

  await check('Unauthenticated GET /api/admin/users rejected with 401 or 403', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/users`);
    assert.ok(res.status === 401 || res.status === 403, `Expected 401/403 for /api/admin/users, got ${res.status}`);
  });

  // 6. Spoofed Invalid Bearer Token Rejected (401)
  await check('Forged Bearer token rejected on /api/finance/net-worth', async () => {
    const res = await fetch(`${BASE_URL}/api/finance/net-worth`, {
      headers: { Authorization: 'Bearer invalid.forged.token.value' },
    });
    assert.equal(res.status, 401);
  });

  // Summary
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.passed) {
      passed++;
      console.log(`✅ ${r.name}`);
    } else {
      failed++;
      console.error(`❌ ${r.name} — ${r.detail}`);
    }
  }
  console.log(`\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Integration suite failed:', err);
  process.exit(1);
});
