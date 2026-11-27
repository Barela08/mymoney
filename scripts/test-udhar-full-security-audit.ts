import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../server/api';
import {
  authenticateRequest,
  signFallbackSessionToken,
  isDiscoverableNormalUser,
} from '../server/auth';
import {
  calculatePersonLedgerSummary,
  canCancelUdhar,
  parseQrPayload,
} from '../src/lib/sharedUdharEngine';

// ---------------------------------------------------------------------------
// Minimal In-Memory PostgREST Harness so real handleApiRequest -> supabaseRestUdhar
// -> auth -> adminApi paths run end-to-end without touching production DB.
// ---------------------------------------------------------------------------
type TableName =
  | 'app_users'
  | 'udhar_contacts'
  | 'udhar_transactions'
  | 'udhar_repayments'
  | 'udhar_edit_history'
  | 'user_connections'
  | 'qr_pairing_tokens'
  | 'notifications'
  | 'user_sessions'
  | 'security_logs'
  | 'password_resets';

function createInMemorySupabaseDb() {
  const tables: Record<TableName, any[]> = {
    app_users: [],
    udhar_contacts: [],
    udhar_transactions: [],
    udhar_repayments: [],
    udhar_edit_history: [],
    user_connections: [],
    qr_pairing_tokens: [],
    notifications: [],
    user_sessions: [],
    security_logs: [],
    password_resets: [],
  };

  function matchCondition(row: any, key: string, expr: string): boolean {
    if (expr.startsWith('eq.')) {
      const val = expr.slice(3);
      if (val === 'true') return row[key] === true;
      if (val === 'false') return row[key] === false;
      return String(row[key] ?? '') === val;
    }
    if (expr.startsWith('neq.')) {
      return String(row[key] ?? '') !== expr.slice(4);
    }
    if (expr.startsWith('ilike.')) {
      const pattern = expr.slice(6).replace(/\*/g, '%');
      const raw = String(row[key] ?? '').toLowerCase();
      const needle = pattern.replace(/^%|%$/g, '').toLowerCase();
      if (pattern.startsWith('%') && pattern.endsWith('%')) return raw.includes(needle);
      if (pattern.startsWith('%')) return raw.endsWith(needle);
      if (pattern.endsWith('%')) return raw.startsWith(needle);
      return raw === needle;
    }
    if (expr.startsWith('gt.')) {
      const rhs = expr.slice(3);
      return String(row[key] ?? '') > rhs;
    }
    if (expr.startsWith('in.(') && expr.endsWith(')')) {
      const inner = expr.slice(4, -1);
      const vals = inner.split(',').map((s) => s.replace(/^"|"$/g, '').trim());
      return vals.includes(String(row[key] ?? ''));
    }
    if (expr.startsWith('not.in.(') && expr.endsWith(')')) {
      const inner = expr.slice(8, -1);
      const vals = inner.split(',').map((s) => s.replace(/^"|"$/g, '').trim());
      return !vals.includes(String(row[key] ?? ''));
    }
    return true;
  }

  function splitTopLevelCommas(str: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of str) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  function matchOrGroup(row: any, orExpr: string): boolean {
    const inner = orExpr.startsWith('(') && orExpr.endsWith(')') ? orExpr.slice(1, -1) : orExpr;
    const parts = splitTopLevelCommas(inner);
    return parts.some((part) => {
      if (part.startsWith('and(') && part.endsWith(')')) {
        const sub = splitTopLevelCommas(part.slice(4, -1));
        return sub.every((s) => {
          const idx = s.indexOf('.');
          return idx > 0 ? matchCondition(row, s.slice(0, idx), s.slice(idx + 1)) : true;
        });
      }
      const idx = part.indexOf('.');
      if (idx <= 0) return true;
      return matchCondition(row, part.slice(0, idx), part.slice(idx + 1));
    });
  }

  function filterRows(table: TableName, urlObj: URL): any[] {
    let rows = [...tables[table]];
    for (const [k, v] of urlObj.searchParams.entries()) {
      if (k === 'select' || k === 'order' || k === 'limit' || k === 'on_conflict') continue;
      if (k === 'or') {
        rows = rows.filter((r) => matchOrGroup(r, v));
      } else {
        rows = rows.filter((r) => matchCondition(r, k, v));
      }
    }
    const order = urlObj.searchParams.get('order');
    if (order) {
      const [col, dir] = order.split(',')[0].split('.');
      rows.sort((a, b) => {
        const av = a[col] ?? '';
        const bv = b[col] ?? '';
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return dir === 'desc' ? -cmp : cmp;
      });
    }
    const limit = urlObj.searchParams.get('limit');
    if (limit) {
      rows = rows.slice(0, Number(limit));
    }
    return rows;
  }

  function upsertRow(table: TableName, item: any, onConflict: string | null): any {
    const cols = onConflict ? onConflict.split(',').map((c) => c.trim()) : [];
    if (cols.length > 0) {
      const idx = tables[table].findIndex((r) => cols.every((c) => String(r[c] ?? '') === String(item[c] ?? '')));
      if (idx >= 0) {
        tables[table][idx] = { ...tables[table][idx], ...item };
        return tables[table][idx];
      }
    }
    const row = {
      id: item.id || crypto.randomUUID(),
      created_at: item.created_at || new Date().toISOString(),
      ...item,
    };
    tables[table].push(row);
    return row;
  }

  async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const urlObj = new URL(urlStr);

    if (!urlObj.pathname.includes('/rest/v1/')) {
      return new Response(JSON.stringify({ error: 'unexpected external fetch in test' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const table = urlObj.pathname.split('/rest/v1/')[1].split('/')[0] as TableName;
    if (!tables[table]) {
      return new Response(JSON.stringify({ message: `Unknown table ${table}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const method = (init?.method || 'GET').toUpperCase();
    const rawBody = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (method === 'GET') {
      const matched = filterRows(table, urlObj);
      return new Response(JSON.stringify(matched), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'POST') {
      const onConflict = urlObj.searchParams.get('on_conflict');
      const items = Array.isArray(rawBody) ? rawBody : [rawBody];
      const inserted = items.map((it) => upsertRow(table, it, onConflict));
      return new Response(JSON.stringify(inserted), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'PATCH') {
      const matchedIds = new Set(filterRows(table, urlObj).map((r) => r.id));
      const updated: any[] = [];
      tables[table] = tables[table].map((row) => {
        if (matchedIds.has(row.id)) {
          const next = { ...row, ...rawBody };
          updated.push(next);
          return next;
        }
        return row;
      });
      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'DELETE') {
      const matchedIds = new Set(filterRows(table, urlObj).map((r) => r.id));
      const removed = tables[table].filter((r) => matchedIds.has(r.id));
      tables[table] = tables[table].filter((r) => !matchedIds.has(r.id));
      return new Response(JSON.stringify(removed), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify([]), { status: 200 });
  }

  return { tables, mockFetch };
}

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

function createMockRes() {
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
        for (const [k, v] of Object.entries(hdrs)) headers[k.toLowerCase()] = v;
      }
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
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

async function callApi(method: string, url: string, token?: string, body?: unknown) {
  const req = createMockReq({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  });
  const mock = createMockRes();
  await handleApiRequest(req, mock.res);
  return { status: mock.getStatus(), body: mock.getBody() };
}

test('End-to-End Security & Multi-Transaction Audit across People Search, QR, Settlement, Delete, and RBAC', async () => {
  const db = createInMemorySupabaseDb();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = db.mockFetch as any;

  try {
    const nileshId = '11111111-1111-4111-8111-111111111101';
    const rahulId = '11111111-1111-4111-8111-111111111102';
    const outsiderId = '11111111-1111-4111-8111-111111111103';
    const adminId = '99999999-9999-4999-8999-999999999901';
    const masterAdminId = '99999999-9999-4999-8999-999999999902';

    db.tables.app_users.push(
      {
        id: nileshId,
        full_name: 'Nilesh Barela',
        email: 'nilesh.user@example.com',
        phone: '+919800000001',
        role: 'user',
        status: 'active',
        deletion_status: 'none',
        is_verified: true,
        avatar_url: 'https://example.com/nilesh.png',
      },
      {
        id: rahulId,
        full_name: 'Rahul Sharma',
        email: 'rahul.sharma@example.com',
        phone: '+919800000002',
        role: 'user',
        status: 'active',
        deletion_status: 'none',
        is_verified: true,
        avatar_url: 'https://example.com/rahul.png',
      },
      {
        id: outsiderId,
        full_name: 'Vikram Outsider',
        email: 'vikram@example.com',
        phone: '+919800000003',
        role: 'user',
        status: 'active',
        deletion_status: 'none',
        is_verified: true,
      },
      {
        id: adminId,
        full_name: 'Platform Admin',
        email: 'staff.admin@example.com',
        phone: '+919800000099',
        role: 'admin',
        status: 'active',
        deletion_status: 'none',
        is_verified: true,
      },
      {
        id: masterAdminId,
        full_name: 'Master Admin',
        email: 'hackifypro@gmail.com',
        phone: '+919800000098',
        role: 'superadmin',
        status: 'active',
        deletion_status: 'none',
        is_verified: true,
      }
    );

    const nileshToken = signFallbackSessionToken({ id: nileshId, email: 'nilesh.user@example.com', role: 'user' }, Date.now() + 3600_000);
    const rahulToken = signFallbackSessionToken({ id: rahulId, email: 'rahul.sharma@example.com', role: 'user' }, Date.now() + 3600_000);
    const outsiderToken = signFallbackSessionToken({ id: outsiderId, email: 'vikram@example.com', role: 'user' }, Date.now() + 3600_000);
    const adminToken = signFallbackSessionToken({ id: adminId, email: 'staff.admin@example.com', role: 'admin' }, Date.now() + 3600_000);
    const expiredToken = signFallbackSessionToken({ id: nileshId, email: 'nilesh.user@example.com', role: 'user' }, Date.now() - 10_000);

    // Scenario 15 & 16: Expired session rejected; Admin keeps role across normal session auth, Normal user blocked 403 on /api/admin/*
    const expAuth = await callApi('GET', '/api/udhar/transactions', expiredToken);
    assert.equal(expAuth.status, 401);

    const normalToAdmin = await callApi('GET', '/api/admin/users', nileshToken);
    assert.equal(normalToAdmin.status, 403);

    const adminMeReq = createMockReq({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${adminToken}` } });
    const adminAuthObj = await authenticateRequest(adminMeReq);
    assert.equal(adminAuthObj?.role, 'admin');

    // Scenario 1 & 2: People Search returns normal users with public fields ONLY and strictly hides all admin accounts
    const searchRahul = await callApi('GET', '/api/udhar/users/search?q=Rahul', nileshToken);
    assert.equal(searchRahul.status, 200);
    assert.equal(searchRahul.body.users.length, 1);
    assert.equal(searchRahul.body.users[0].id, rahulId);
    assert.equal(searchRahul.body.users[0].avatarUrl, 'https://example.com/rahul.png');
    assert.equal(searchRahul.body.users[0].email, undefined, 'Raw email must never leak in public search');

    const searchAdminByName = await callApi('GET', '/api/udhar/users/search?q=Admin', nileshToken);
    assert.equal(searchAdminByName.status, 200);
    assert.equal(searchAdminByName.body.users.length, 0, 'Admin accounts must never appear in People Search');

    const searchMasterAdminByEmail = await callApi('GET', '/api/udhar/users/search?q=hackifypro@gmail.com', nileshToken);
    assert.equal(searchMasterAdminByEmail.status, 200);
    assert.equal(searchMasterAdminByEmail.body.users.length, 0, 'Master admin email must never appear in People Search');

    // Scenario 3, 4 & Admin QR Exclusion: QR generation, resolve, duplicate prevention, invalid/expired/revoked handling
    const rahulQr = await callApi('GET', '/api/udhar/qr/my-code', rahulToken);
    assert.equal(rahulQr.status, 200);
    assert.ok(rahulQr.body.pairingToken);

    const resolvedRahulQr = await callApi('POST', '/api/udhar/qr/resolve', nileshToken, { qrData: rahulQr.body.qrData });
    assert.equal(resolvedRahulQr.status, 200);
    assert.equal(resolvedRahulQr.body.owner.id, rahulId);
    assert.equal(resolvedRahulQr.body.owner.fullName, 'Rahul Sharma');

    // Admin QR must be blocked even if token exists
    db.tables.qr_pairing_tokens.push({
      id: 'qr-admin-1',
      user_id: adminId,
      pairing_token: 'admin-tok-secret',
      pairing_code: 'MM-ADMIN1',
      is_single_use: false,
      used: false,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    const resolvedAdminQr = await callApi('POST', '/api/udhar/qr/resolve', nileshToken, { pairingToken: 'admin-tok-secret' });
    assert.equal(resolvedAdminQr.status, 403);

    // Also block adding admin as linked contact or shared Udhar directly by ID
    const addAdminContact = await callApi('POST', '/api/udhar/contacts', nileshToken, {
      name: 'Platform Admin',
      linked_user_id: adminId,
    });
    assert.equal(addAdminContact.status, 403);
    const sharedWithAdmin = await callApi('POST', '/api/udhar/transactions', nileshToken, {
      counterpart_name: 'Platform Admin',
      counterpart_user_id: adminId,
      direction: 'gave',
      amount: 100,
    });
    assert.equal(sharedWithAdmin.status, 403);

    // Expired & Revoked QR
    db.tables.qr_pairing_tokens.push({
      id: 'qr-exp-1',
      user_id: rahulId,
      pairing_token: 'expired-tok',
      pairing_code: 'MM-EXP001',
      is_single_use: false,
      used: false,
      expires_at: new Date(Date.now() - 10_000).toISOString(),
    });
    const resolvedExpiredQr = await callApi('POST', '/api/udhar/qr/resolve', nileshToken, { pairingToken: 'expired-tok' });
    assert.equal(resolvedExpiredQr.status, 410);

    // Connect via QR & prevent duplicate pending / duplicate connection
    const reqConn1 = await callApi('POST', '/api/udhar/qr/connect', nileshToken, { pairingToken: rahulQr.body.pairingToken });
    assert.equal(reqConn1.status, 200);
    assert.equal(reqConn1.body.status, 'pending');

    const reqConnDup = await callApi('POST', '/api/udhar/qr/connect', nileshToken, { pairingToken: rahulQr.body.pairingToken });
    assert.equal(reqConnDup.status, 200);
    assert.equal(reqConnDup.body.alreadyPending, true);

    const acceptConn = await callApi('POST', `/api/udhar/connections/${encodeURIComponent(reqConn1.body.requestId)}/accept`, rahulToken);
    assert.equal(acceptConn.status, 200);

    const reqConnAfterAccepted = await callApi('POST', '/api/udhar/qr/connect', nileshToken, { pairingToken: rahulQr.body.pairingToken });
    assert.equal(reqConnAfterAccepted.status, 200);
    assert.equal(reqConnAfterAccepted.body.alreadyConnected, true);

    // Scenario 5 & 6: Create 5 independent Udhar transactions (₹500, ₹1000, ₹700, ₹300, ₹2000)
    const amounts = [500, 1000, 700, 300, 2000];
    const lenderTxIds: string[] = [];
    for (let i = 0; i < amounts.length; i++) {
      const created = await callApi('POST', '/api/udhar/transactions', nileshToken, {
        counterpart_name: 'Rahul Sharma',
        counterpart_user_id: rahulId,
        direction: 'gave',
        amount: amounts[i],
        description: `Udhar #${i + 1}`,
        notes: `Loan note ${i + 1}`,
        transaction_date: `2026-11-0${i + 1}`,
      });
      assert.equal(created.status, 201);
      lenderTxIds.push(created.body.transaction.id);
    }

    const nileshLedgerBefore = await callApi('GET', '/api/udhar/transactions', nileshToken);
    assert.equal(nileshLedgerBefore.status, 200);
    assert.equal(nileshLedgerBefore.body.transactions.length, 5);
    assert.equal(nileshLedgerBefore.body.summary.outstandingReceivable, 4500);

    const rahulLedgerBefore = await callApi('GET', '/api/udhar/transactions', rahulToken);
    assert.equal(rahulLedgerBefore.status, 200);
    assert.equal(rahulLedgerBefore.body.transactions.length, 5);
    assert.equal(rahulLedgerBefore.body.summary.outstandingPayable, 4500);
    const rahulThirdTx = rahulLedgerBefore.body.transactions.find((t: any) => Number(t.original_amount) === 700);
    assert.ok(rahulThirdTx);

    // Scenario 7, 8, 9 & 14: Borrower CANNOT settle, edit, or delete! Outsider CANNOT read or mutate!
    const borrowerSettleAttempt = await callApi('POST', `/api/udhar/transactions/${rahulThirdTx.id}/settle`, rahulToken, {});
    assert.equal(borrowerSettleAttempt.status, 403, 'Borrower must be forbidden from settling');

    const borrowerDeleteAttempt = await callApi('DELETE', `/api/udhar/transactions/${rahulThirdTx.id}`, rahulToken);
    assert.equal(borrowerDeleteAttempt.status, 403, 'Borrower must be forbidden from deleting');

    const borrowerEditAttempt = await callApi('PUT', `/api/udhar/transactions/${rahulThirdTx.id}`, rahulToken, {
      amount: 1,
      reason_for_edit: 'Tamper amount',
    });
    assert.equal(borrowerEditAttempt.status, 403, 'Borrower must be forbidden from editing');

    const outsiderReadAttempt = await callApi('GET', `/api/udhar/transactions/${lenderTxIds[2]}/history`, outsiderToken);
    assert.equal(outsiderReadAttempt.status, 404, 'Outsider cannot access participant transaction details');

    const outsiderSettleAttempt = await callApi('POST', `/api/udhar/transactions/${lenderTxIds[2]}/settle`, outsiderToken, {});
    assert.equal(outsiderSettleAttempt.status, 404, 'Outsider cannot settle participant transaction');

    // Lender settles ONLY Udhar #3 (₹700)
    const lenderSettle3 = await callApi('POST', `/api/udhar/transactions/${lenderTxIds[2]}/settle`, nileshToken, {
      payment_method: 'UPI',
      notes: 'Settled entry #3',
    });
    assert.equal(lenderSettle3.status, 200);
    assert.ok(lenderSettle3.body.settledAt);
    assert.equal(lenderSettle3.body.settledBy, nileshId);

    // Double-settlement race / repeat guard
    const doubleSettle = await callApi('POST', `/api/udhar/transactions/${lenderTxIds[2]}/settle`, nileshToken, {});
    assert.ok([400, 409].includes(doubleSettle.status));

    // Verify 4 remaining entries untouched and pending = ₹3800, settled = ₹700
    const nileshAfterSettle = await callApi('GET', '/api/udhar/transactions', nileshToken);
    assert.equal(nileshAfterSettle.body.summary.outstandingReceivable, 3800);
    assert.equal(nileshAfterSettle.body.summary.settledAmount, 700);
    const rahulAfterSettle = await callApi('GET', '/api/udhar/transactions', rahulToken);
    assert.equal(rahulAfterSettle.body.summary.outstandingPayable, 3800);

    // Scenario 11 & 12: Settled entry CAN be deleted by Lender (while disputed stays 409 and borrower stays 403), and Pending entry #4 (₹300) CAN also be deleted by Lender
    const deleteSettledAttempt = await callApi('DELETE', `/api/udhar/transactions/${lenderTxIds[2]}`, nileshToken, {
      reason: 'Settled entry cleanup',
    });
    assert.equal(deleteSettledAttempt.status, 200);
    assert.equal(deleteSettledAttempt.body.deletedBy, nileshId);

    const deletePending4 = await callApi('DELETE', `/api/udhar/transactions/${lenderTxIds[3]}`, nileshToken, {
      reason: 'Duplicate entry cleanup',
    });
    assert.equal(deletePending4.status, 200);
    assert.equal(deletePending4.body.deletedBy, nileshId);

    // Cancelled records excluded from active list & pending totals (now 3 active pending totaling 500 + 1000 + 2000 = 3500, settled = 0)
    const nileshAfterDelete = await callApi('GET', '/api/udhar/transactions', nileshToken);
    assert.equal(nileshAfterDelete.body.transactions.length, 3);
    assert.equal(nileshAfterDelete.body.summary.outstandingReceivable, 3500);
    assert.equal(nileshAfterDelete.body.summary.settledAmount, 0);

    const contactsWithBalances = await callApi('GET', '/api/udhar/contacts/with-balances', nileshToken);
    assert.equal(contactsWithBalances.status, 200);
    const rahulContact = contactsWithBalances.body.contacts.find((c: any) => c.linked_user_id === rahulId);
    assert.ok(rahulContact);
    assert.equal(rahulContact.outstanding_receivable, 3500);
    assert.equal(rahulContact.pending_transactions_count, 3);
    assert.equal(rahulContact.total_transactions_count, 3);

    // Scenario 15: Repayment Deletion & Parent Udhar Recalculation + Cascade Delete
    const multiRepayCreate = await callApi('POST', '/api/udhar/transactions', nileshToken, {
      counterpart_name: 'Rahul Sharma',
      counterpart_user_id: rahulId,
      direction: 'gave',
      amount: 1500,
      description: 'Split repayment test loan',
      transaction_date: '2026-11-26',
    });
    assert.equal(multiRepayCreate.status, 201);
    const multiTxId = multiRepayCreate.body.transaction.id;

    const repay1000 = await callApi('POST', `/api/udhar/transactions/${multiTxId}/repay`, nileshToken, {
      amount: 1000,
      payment_method: 'UPI',
      notes: 'Part 1',
      repayment_date: '2026-11-26',
    });
    assert.equal(repay1000.status, 200);
    const repay1000Id = repay1000.body.repayment.id;

    const repay500 = await callApi('POST', `/api/udhar/transactions/${multiTxId}/repay`, nileshToken, {
      amount: 500,
      payment_method: 'Cash',
      notes: 'Part 2 final',
      repayment_date: '2026-11-26',
    });
    assert.equal(repay500.status, 200);
    assert.equal(repay500.body.isSettled, true);
    assert.equal(repay500.body.remainingBalance, 0);

    // Borrower CANNOT delete confirmed repayment (403)
    const borrowerDeleteRep = await callApi('DELETE', `/api/udhar/repayments/${repay1000Id}`, rahulToken);
    assert.equal(borrowerDeleteRep.status, 403);

    // Lender deletes ₹1,000 repayment -> parent Udhar reopens from 'settled' to 'confirmed' with ₹500 paid & ₹1,000 remaining
    const lenderDeleteRep = await callApi('DELETE', `/api/udhar/repayments/${repay1000Id}`, nileshToken, {
      reason: 'Reversed UPI transfer',
    });
    assert.equal(lenderDeleteRep.status, 200);
    assert.equal(lenderDeleteRep.body.paidAmount, 500);
    assert.equal(lenderDeleteRep.body.remainingBalance, 1000);
    assert.equal(lenderDeleteRep.body.udharStatus, 'confirmed');
    assert.equal(lenderDeleteRep.body.isSettled, false);

    // Verify Nilesh & Rahul both see updated ₹1,000 remaining and only 1 active repayment (₹500)
    const afterRepDelList = await callApi('GET', '/api/udhar/transactions', nileshToken);
    const reopenedTx = afterRepDelList.body.transactions.find((t: any) => t.id === multiTxId);
    assert.ok(reopenedTx);
    assert.equal(reopenedTx.status, 'confirmed');
    assert.equal(Number(reopenedTx.paid_amount), 500);
    assert.equal(Number(reopenedTx.current_balance), 1000);
    assert.equal(reopenedTx.repayments.length, 1);
    assert.equal(Number(reopenedTx.repayments[0].amount), 500);
    assert.equal(afterRepDelList.body.summary.outstandingReceivable, 4500);

    // Now delete the entire ₹1,500 Udhar entry -> cascades soft-delete to remaining ₹500 repayment without affecting sibling entries
    const deleteMultiTx = await callApi('DELETE', `/api/udhar/transactions/${multiTxId}`, nileshToken, {
      reason: 'Delete entire reopened Udhar',
    });
    assert.equal(deleteMultiTx.status, 200);

    const afterCascadeDelete = await callApi('GET', '/api/udhar/transactions', nileshToken);
    assert.equal(afterCascadeDelete.body.transactions.length, 3);
    assert.equal(afterCascadeDelete.body.summary.outstandingReceivable, 3500);
    assert.equal(
      db.tables.udhar_repayments.filter((r) => r.link_id === multiRepayCreate.body.transaction.link_id && r.status !== 'deleted').length,
      0
    );

    // Scenario 16: Forgot Password -> Verify Reset Token -> Single-Use Reset Password
    const forgotKnown = await callApi('POST', '/api/auth/forgot-password', undefined, {
      email: 'nilesh.user@example.com',
    });
    assert.equal(forgotKnown.status, 200);
    assert.equal(forgotKnown.body.success, true);
    assert.equal((forgotKnown.body as any).token, undefined, 'Raw token must never leak in API response');

    const forgotUnknown = await callApi('POST', '/api/auth/forgot-password', undefined, {
      email: 'nobody.missing@example.com',
    });
    assert.equal(forgotUnknown.status, 200);
    assert.equal(forgotUnknown.body.message, forgotKnown.body.message);

    // Simulate a known raw token matching stored token_hash to test single-use atomic consumption
    const rawResetToken = 'ab'.repeat(32);
    const resetTokenHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');
    db.tables.password_resets.push({
      id: 'pr-test-1',
      user_id: nileshId,
      token_hash: resetTokenHash,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      used: false,
      created_at: new Date().toISOString(),
    });

    const verifyValid = await callApi('POST', '/api/auth/verify-reset-token', undefined, {
      token: rawResetToken,
    });
    assert.equal(verifyValid.status, 200);
    assert.equal(verifyValid.body.valid, true);
    assert.equal(verifyValid.body.email, 'nilesh.user@example.com');

    const firstReset = await callApi('POST', '/api/auth/reset-password', undefined, {
      token: rawResetToken,
      newPassword: 'NewStrong@Password123',
      confirmPassword: 'NewStrong@Password123',
    });
    assert.equal(firstReset.status, 200);
    assert.equal(firstReset.body.success, true);
    const updatedUser = db.tables.app_users.find((u) => u.id === nileshId);
    assert.ok(updatedUser?.password_hash);

    // Replay of the exact same token must be rejected as already used
    const replayReset = await callApi('POST', '/api/auth/reset-password', undefined, {
      token: rawResetToken,
      newPassword: 'AnotherStrong@Password123',
      confirmPassword: 'AnotherStrong@Password123',
    });
    assert.equal(replayReset.status, 400);

    // Sanity check unit exports stay aligned
    assert.equal(isDiscoverableNormalUser({ role: 'admin', status: 'active', email: 'a@b.com' }), false);
    assert.equal(canCancelUdhar({ status: 'settled', paid_amount: 700, repayments: [] }).allowed, true);
    assert.equal(canCancelUdhar({ status: 'disputed', paid_amount: 0, repayments: [] }).allowed, false);
    assert.equal(parseQrPayload('invalid').valid, false);
    assert.equal(calculatePersonLedgerSummary(afterCascadeDelete.body.transactions).youWillReceive, 3500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
