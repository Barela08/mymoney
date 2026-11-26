import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  authenticateRequest,
  isDiscoverableNormalUser,
  isMasterAdminAccountEmail,
  signFallbackSessionToken,
  verifyFallbackSessionToken,
} from '../server/auth';
import { handleApiRequest } from '../server/api';
import {
  calculatePersonLedgerSummary,
  canCancelUdhar,
  parseQrPayload,
  resolveCanonicalPerspective,
} from '../src/lib/sharedUdharEngine';

function createMockReq(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
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
  (stream as any).socket = { remoteAddress: '127.0.0.1' };
  return stream;
}

function createMockRes(): {
  res: ServerResponse;
  getStatus: () => number;
  getBody: () => any;
} {
  let statusCode = 200;
  let chunks: string[] = [];
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

test('Auth: forged direct_<uuid>_<ts> bearer token is rejected', async () => {
  const req = createMockReq({
    method: 'GET',
    url: '/api/udhar/users/search?q=rahul',
    headers: {
      authorization: 'Bearer direct_11111111-1111-4111-8111-111111111111_1700000000000',
    },
  });
  const user = await authenticateRequest(req);
  assert.equal(user, null);
});

test('Auth: forged unsigned JWT token is rejected', async () => {
  const fakeHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const fakePayload = Buffer.from(
    JSON.stringify({
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'hackifypro@gmail.com',
      role: 'superadmin',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString('base64url');
  const forgedJwt = `${fakeHeader}.${fakePayload}.forgedsignature`;

  const req = createMockReq({
    method: 'GET',
    url: '/api/admin/users',
    headers: {
      authorization: `Bearer ${forgedJwt}`,
    },
  });
  const user = await authenticateRequest(req);
  assert.equal(user, null);
});

test('Auth: HMAC fallback session token verifies valid tokens and rejects tampering or expiry', () => {
  const token = signFallbackSessionToken(
    {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'admin@example.com',
      role: 'admin',
    },
    Date.now() + 60_000
  );
  assert.ok(token.startsWith('mmf1.'));

  const verified = verifyFallbackSessionToken(token);
  assert.ok(verified);
  assert.equal(verified?.userId, '22222222-2222-4222-8222-222222222222');
  assert.equal(verified?.role, 'admin');

  // Tamper payload
  const parts = token.split('.');
  const tamperedPayload = Buffer.from(
    JSON.stringify({
      sub: '22222222-2222-4222-8222-222222222222',
      email: 'hackifypro@gmail.com',
      role: 'superadmin',
      exp: Date.now() + 3_600_000,
    })
  ).toString('base64url');
  const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
  assert.equal(verifyFallbackSessionToken(tampered), null);

  // Expired token
  const expired = signFallbackSessionToken(
    {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'admin@example.com',
      role: 'admin',
    },
    Date.now() - 5_000
  );
  assert.equal(verifyFallbackSessionToken(expired), null);

  // Unsigned legacy direct_ token format
  assert.equal(
    verifyFallbackSessionToken('direct_22222222-2222-4222-8222-222222222222_1700000000'),
    null
  );
});

test('People Search: only active normal users are discoverable; all admin accounts are excluded', () => {
  assert.equal(isMasterAdminAccountEmail('hackifypro@gmail.com'), true);
  assert.equal(isMasterAdminAccountEmail('ADMIN@MYMONEY.COM'), true);
  assert.equal(isMasterAdminAccountEmail('rahul@example.com'), false);

  assert.equal(
    isDiscoverableNormalUser({ role: 'user', status: 'active', email: 'rahul@example.com' }),
    true
  );
  assert.equal(
    isDiscoverableNormalUser({ role: null, status: 'active', email: 'priya@example.com' }),
    true
  );

  // Admin / staff roles must never leak into People Search or QR
  for (const role of ['admin', 'superadmin', 'support', 'analyst']) {
    assert.equal(
      isDiscoverableNormalUser({ role, status: 'active', email: `${role}@example.com` }),
      false,
      `Role ${role} must be excluded from people discovery`
    );
  }

  // Master admin emails must never leak even if role were misconfigured as 'user'
  assert.equal(
    isDiscoverableNormalUser({ role: 'user', status: 'active', email: 'hackifypro@gmail.com' }),
    false
  );
  assert.equal(
    isDiscoverableNormalUser({ role: 'user', status: 'active', email: 'admin@mymoney.com' }),
    false
  );

  // Suspended or pending-deletion accounts must be excluded
  assert.equal(
    isDiscoverableNormalUser({ role: 'user', status: 'suspended', email: 'rahul@example.com' }),
    false
  );
  assert.equal(
    isDiscoverableNormalUser({
      role: 'user',
      status: 'active',
      email: 'rahul@example.com',
      deletion_status: 'pending_deletion',
    }),
    false
  );
});

test('Udhar multi-transaction ledger: 5 independent entries settle individually without merging', () => {
  const initialEntries = [
    { id: 'u1', direction: 'gave' as const, original_amount: 500, current_balance: 500, paid_amount: 0, status: 'confirmed' },
    { id: 'u2', direction: 'gave' as const, original_amount: 1000, current_balance: 1000, paid_amount: 0, status: 'confirmed' },
    { id: 'u3', direction: 'gave' as const, original_amount: 700, current_balance: 700, paid_amount: 0, status: 'confirmed' },
    { id: 'u4', direction: 'gave' as const, original_amount: 300, current_balance: 300, paid_amount: 0, status: 'confirmed' },
    { id: 'u5', direction: 'gave' as const, original_amount: 2000, current_balance: 2000, paid_amount: 0, status: 'confirmed' },
  ];

  const summaryBefore = calculatePersonLedgerSummary(initialEntries);
  assert.equal(summaryBefore.totalGiven, 4500);
  assert.equal(summaryBefore.youWillReceive, 4500);
  assert.equal(summaryBefore.settledAmount, 0);
  assert.equal(summaryBefore.activeCount, 5);
  assert.equal(summaryBefore.settledCount, 0);

  // Settle only Udhar 3 (₹700); remaining 4 entries stay untouched
  const afterSingleSettlement = initialEntries.map((entry) =>
    entry.id === 'u3'
      ? { ...entry, current_balance: 0, paid_amount: 700, status: 'settled' }
      : entry
  );

  const summaryAfter = calculatePersonLedgerSummary(afterSingleSettlement);
  assert.equal(summaryAfter.youWillReceive, 3800);
  assert.equal(summaryAfter.settledAmount, 700);
  assert.equal(summaryAfter.activeCount, 4);
  assert.equal(summaryAfter.settledCount, 1);
  assert.equal(afterSingleSettlement.filter((e) => e.status === 'confirmed').length, 4);
});

test('Udhar lender/borrower perspective & cancellation guard: disputed or settled entries cannot be cancelled', () => {
  const canonical = {
    id: 'tx-100',
    lender_user_id: 'lender-nilesh',
    lender_name: 'Nilesh',
    borrower_user_id: 'borrower-rahul',
    borrower_name: 'Rahul',
    created_by_user_id: 'lender-nilesh',
    original_amount: 1000,
    paid_amount: 0,
    remaining_amount: 1000,
    status: 'confirmed' as const,
  };

  const lenderView = resolveCanonicalPerspective(canonical, 'lender-nilesh');
  const borrowerView = resolveCanonicalPerspective(canonical, 'borrower-rahul');
  const outsiderView = resolveCanonicalPerspective(canonical, 'random-user');
  assert.equal(lenderView?.direction, 'gave');
  assert.equal(lenderView?.role, 'lender');
  assert.equal(borrowerView?.direction, 'took');
  assert.equal(borrowerView?.role, 'borrower');
  assert.equal(outsiderView, null);

  // Clean pending/confirmed entry with 0 paid can be cancelled by lender
  assert.equal(
    canCancelUdhar({ status: 'confirmed', paid_amount: 0, repayments: [] }).allowed,
    true
  );

  // Disputed entry must preserve financial audit history
  const disputedCheck = canCancelUdhar({ status: 'disputed', paid_amount: 0, repayments: [] });
  assert.equal(disputedCheck.allowed, false);

  // Settled entry cannot be cancelled
  assert.equal(
    canCancelUdhar({ status: 'settled', paid_amount: 1000, repayments: [] }).allowed,
    false
  );

  // Partially repaid entry cannot be cancelled
  assert.equal(
    canCancelUdhar({ status: 'partial', paid_amount: 250, repayments: [] }).allowed,
    false
  );

  // Entry with pending repayment claim cannot be cancelled
  assert.equal(
    canCancelUdhar({
      status: 'confirmed',
      paid_amount: 0,
      repayments: [{ status: 'pending_confirmation' }],
    }).allowed,
    false
  );

  // QR validation safely rejects invalid / UPI payment QRs
  const upiRes = parseQrPayload('upi://pay?pa=merchant@upi&pn=Shop&am=100');
  assert.equal(upiRes.valid, false);
  assert.equal(upiRes.isUpiPaymentQr, true);
  assert.equal(upiRes.errorCode, 'UPI_QR_NOT_PAIRING');
  const garbageRes = parseQrPayload('not-a-valid-qr-code-at-all');
  assert.equal(garbageRes.valid, false);
});

test('API Routes: unauthenticated access to internal reset email, cron deletion, and Udhar search is blocked', async () => {
  // 1. Unauthenticated POST /api/send-reset-email -> 403
  {
    const req = createMockReq({
      method: 'POST',
      url: '/api/send-reset-email',
      body: { email: 'victim@example.com', resetLink: 'https://evil.example/phish' },
    });
    const mock = createMockRes();
    const handled = await handleApiRequest(req, mock.res);
    assert.equal(handled, true);
    assert.equal(mock.getStatus(), 403);
  }

  // 2. Unauthenticated POST /api/account/deletion/process-expired -> 403
  {
    const req = createMockReq({
      method: 'POST',
      url: '/api/account/deletion/process-expired',
      body: {},
    });
    const mock = createMockRes();
    const handled = await handleApiRequest(req, mock.res);
    assert.equal(handled, true);
    assert.equal(mock.getStatus(), 403);
  }

  // 3. Forged direct_ bearer token to GET /api/udhar/users/search -> 401
  {
    const req = createMockReq({
      method: 'GET',
      url: '/api/udhar/users/search?q=rahul',
      headers: {
        authorization: 'Bearer direct_11111111-1111-4111-8111-111111111111_1700000000000',
      },
    });
    const mock = createMockRes();
    const handled = await handleApiRequest(req, mock.res);
    assert.equal(handled, true);
    assert.equal(mock.getStatus(), 401);
  }

  // 4. Forged direct_ bearer token to DELETE /api/udhar/transactions/:id -> 401
  {
    const req = createMockReq({
      method: 'DELETE',
      url: '/api/udhar/transactions/11111111-1111-4111-8111-111111111111',
      headers: {
        authorization: 'Bearer direct_11111111-1111-4111-8111-111111111111_1700000000000',
      },
    });
    const mock = createMockRes();
    const handled = await handleApiRequest(req, mock.res);
    assert.equal(handled, true);
    assert.equal(mock.getStatus(), 401);
  }

  // 5. Forged unsigned JWT to GET /api/admin/users -> 401 or 403
  {
    const fakeHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const fakePayload = Buffer.from(
      JSON.stringify({ sub: '11111111-1111-4111-8111-111111111111', email: 'hackifypro@gmail.com' })
    ).toString('base64url');
    const req = createMockReq({
      method: 'GET',
      url: '/api/admin/users',
      headers: {
        authorization: `Bearer ${fakeHeader}.${fakePayload}.fakesig`,
      },
    });
    const mock = createMockRes();
    const handled = await handleApiRequest(req, mock.res);
    assert.equal(handled, true);
    assert.ok([401, 403].includes(mock.getStatus()), `Expected 401 or 403, got ${mock.getStatus()}`);
  }

  // 6. Forged direct_ bearer token to POST /api/privacy/consents/batch -> 401
  {
    const req = createMockReq({
      method: 'POST',
      url: '/api/privacy/consents/batch',
      headers: {
        authorization: 'Bearer direct_11111111-1111-4111-8111-111111111111_1700000000000',
      },
      body: {
        entries: [{ purpose: 'cloud_sync', status: 'granted' }],
        source: 'privacy_choices_modal',
      },
    });
    const mock = createMockRes();
    const handled = await handleApiRequest(req, mock.res);
    assert.equal(handled, true);
    assert.equal(mock.getStatus(), 401);
  }
});

test('Auth Session Creation: createSession never issues unsigned direct_ tokens', async () => {
  const { createSession } = await import('../server/auth');
  const session = await createSession('33333333-3333-4333-8333-333333333333', {
    rememberMe: false,
    userAgent: 'node-test',
    ipAddress: '127.0.0.1',
    user: { role: 'user', email: 'session-test@example.com' },
  });
  assert.ok(session.sessionToken && session.sessionToken.length >= 32);
  assert.equal(session.sessionToken.startsWith('direct_'), false);
  // If HMAC fallback was used, it must verify cryptographically
  if (session.sessionToken.startsWith('mmf1.')) {
    const verified = verifyFallbackSessionToken(session.sessionToken);
    assert.ok(verified);
    assert.equal(verified?.userId, '33333333-3333-4333-8333-333333333333');
  }
});

