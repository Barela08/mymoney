import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

/**
 * End-to-End Verification Suite for Udhaar People System:
 *   1. Method A: Search -> Send Request (PENDING) -> Duplicate Prevention -> Cancel Request -> Reject Request -> Accept Request -> Simultaneous Opposite Requests
 *   2. Method B: QR Code & Confirmation Code -> Direct Bidirectional Connection (ZERO pending request) -> Informational Notification (NO accept/reject) -> Already Connected Idempotency -> Resolves Pending Search Request Cleanly
 *   3. Notification Inline Action Endpoint: Ownership Check (IDOR 404), Informational QR Guard (400), Stale Double-Submit Guard (409), Accept & Reject
 *   4. Instant Two-Sided Delete: Removes connection & both Saved People entries immediately while preserving 100% of Udhaar transactions & balances with zero resurrection
 */

const USER_A_ID = '11111111-1111-4111-8111-111111111111';
const USER_B_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN_A = 'e2e_token_user_a_secret_12345';
const TOKEN_B = 'e2e_token_user_b_secret_67890';

function sha256(val: string) {
  return crypto.createHash('sha256').update(val).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

// In-memory Supabase PostgREST table store for isolated, deterministic end-to-end execution
const tables: Record<string, any[]> = {
  app_users: [
    {
      id: USER_A_ID,
      full_name: 'Alice Sharma',
      email: 'alice.e2e@example.com',
      phone: '+919876500001',
      role: 'user',
      status: 'active',
      deletion_status: 'none',
      email_verified: true,
      avatar_url: 'https://example.com/alice.png',
      created_at: nowIso(),
      password_changed_at: nowIso(),
    },
    {
      id: USER_B_ID,
      full_name: 'Bob Verma',
      email: 'bob.e2e@example.com',
      phone: '+919876500002',
      role: 'user',
      status: 'active',
      deletion_status: 'none',
      email_verified: true,
      avatar_url: 'https://example.com/bob.png',
      created_at: nowIso(),
      password_changed_at: nowIso(),
    },
  ],
  user_sessions: [
    {
      id: 'sess-a-1',
      user_id: USER_A_ID,
      session_token_hash: sha256(TOKEN_A),
      is_revoked: false,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      last_active_at: nowIso(),
    },
    {
      id: 'sess-b-1',
      user_id: USER_B_ID,
      session_token_hash: sha256(TOKEN_B),
      is_revoked: false,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      last_active_at: nowIso(),
    },
  ],
  user_connections: [],
  udhar_contacts: [],
  user_pairing_identities: [],
  user_notifications: [],
  udhar_transactions: [],
  udhar_repayments: [],
  udhar_edit_history: [],
  security_audit_logs: [],
  maintenance_settings: [],
};

function matchesFilter(row: any, key: string, expr: string): boolean {
  if (key === 'select' || key === 'order' || key === 'limit' || key === 'on_conflict') return true;
  if (key === 'or') {
    const inner = expr.startsWith('(') && expr.endsWith(')') ? expr.slice(1, -1) : expr;
    // Split top-level commas outside parentheses
    const parts: string[] = [];
    let depth = 0;
    let buf = '';
    for (const ch of inner) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        parts.push(buf);
        buf = '';
      } else {
        buf += ch;
      }
    }
    if (buf) parts.push(buf);

    return parts.some((part) => {
      if (part.startsWith('and(') && part.endsWith(')')) {
        const subParts = part.slice(4, -1).split(',');
        return subParts.every((sp) => {
          const [sk, ...rest] = sp.split('.');
          return matchesFilter(row, sk, rest.join('.'));
        });
      }
      const [sk, ...rest] = part.split('.');
      return matchesFilter(row, sk, rest.join('.'));
    });
  }

  const rowVal = row[key];
  if (expr.startsWith('eq.')) {
    const target = expr.slice(3);
    if (target === 'true') return rowVal === true;
    if (target === 'false') return rowVal === false;
    return String(rowVal ?? '') === target;
  }
  if (expr.startsWith('neq.')) {
    return String(rowVal ?? '') !== expr.slice(4);
  }
  if (expr.startsWith('ilike.')) {
    const rawPattern = expr.slice(6).replace(/\*/g, '%');
    const regexStr = '^' + rawPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$';
    return new RegExp(regexStr, 'i').test(String(rowVal ?? ''));
  }
  if (expr.startsWith('is.')) {
    const target = expr.slice(3);
    if (target === 'null') return rowVal === null || rowVal === undefined;
    return true;
  }
  if (expr.startsWith('in.(') && expr.endsWith(')')) {
    const vals = expr
      .slice(4, -1)
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''));
    return vals.includes(String(rowVal ?? ''));
  }
  return true;
}

const originalFetch = global.fetch;

function installInMemorySupabaseFetch() {
  (global as any).fetch = async (input: any, init: any = {}) => {
    const urlStr = typeof input === 'string' ? input : input?.url || '';
    if (!urlStr.includes('/rest/v1/')) {
      return originalFetch(input, init);
    }

    const parsedUrl = new URL(urlStr);
    const tableName = parsedUrl.pathname.split('/rest/v1/')[1].split('/')[0];
    if (!tables[tableName]) tables[tableName] = [];
    const rows = tables[tableName];
    const method = String(init.method || 'GET').toUpperCase();
    const bodyText = typeof init.body === 'string' ? init.body : undefined;
    const payload = bodyText ? JSON.parse(bodyText) : undefined;
    const params = Array.from(parsedUrl.searchParams.entries());

    const filterRow = (r: any) => params.every(([k, v]) => matchesFilter(r, k, v));

    if (method === 'GET') {
      let out = rows.filter(filterRow).map((r) => ({ ...r }));
      const orderParam = parsedUrl.searchParams.get('order');
      if (orderParam) {
        const [col, dir] = orderParam.split('.');
        out.sort((a, b) => {
          const av = String(a[col] ?? '');
          const bv = String(b[col] ?? '');
          return dir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
        });
      }
      const limitParam = parsedUrl.searchParams.get('limit');
      if (limitParam && Number.isFinite(Number(limitParam))) {
        out = out.slice(0, Number(limitParam));
      }
      return new Response(JSON.stringify(out), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'POST') {
      const items = Array.isArray(payload) ? payload : [payload];
      const onConflict = parsedUrl.searchParams.get('on_conflict');
      const prefer = String(init.headers?.Prefer || init.headers?.prefer || '');
      const inserted: any[] = [];

      for (const rawItem of items) {
        const item = { ...rawItem };
        if (!item.id) item.id = crypto.randomUUID();
        if (!item.created_at) item.created_at = nowIso();
        if (!item.updated_at) item.updated_at = nowIso();

        if (prefer.includes('resolution=merge-duplicates') && onConflict) {
          const cols = onConflict.split(',').map((s) => s.trim());
          const idx = rows.findIndex((r) => cols.every((c) => r[c] === item[c]));
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...item, id: rows[idx].id };
            inserted.push({ ...rows[idx] });
            continue;
          }
        }
        rows.push(item);
        inserted.push({ ...item });
      }
      return new Response(JSON.stringify(inserted), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'PATCH') {
      const updated: any[] = [];
      for (let i = 0; i < rows.length; i++) {
        if (filterRow(rows[i])) {
          rows[i] = { ...rows[i], ...payload };
          updated.push({ ...rows[i] });
        }
      }
      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'DELETE') {
      const remaining: any[] = [];
      const deleted: any[] = [];
      for (const r of rows) {
        if (filterRow(r)) deleted.push(r);
        else remaining.push(r);
      }
      tables[tableName] = remaining;
      return new Response(JSON.stringify(deleted), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify([]), { status: 200 });
  };
}

let handleApiRequestRef: ((req: any, res: any) => Promise<boolean>) | null = null;

async function apiCall(token: string, method: string, url: string, body?: any) {
  if (!handleApiRequestRef) {
    throw new Error('handleApiRequest not loaded');
  }
  const req: any = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {
    host: 'localhost:3000',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  req.socket = { remoteAddress: '127.0.0.1' };
  req.body = body;

  let status = 200;
  let payload: any = null;
  const res: any = {
    writableEnded: false,
    headersSent: false,
    status(code: number) {
      status = code;
      return this;
    },
    json(data: any) {
      payload = data;
      this.writableEnded = true;
      this.headersSent = true;
      return this;
    },
    setHeader() {},
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(raw?: string) {
      if (!payload && raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = raw;
        }
      }
      this.writableEnded = true;
      this.headersSent = true;
    },
  };

  const handled = await handleApiRequestRef(req, res);
  return { handled, status, payload };
}

let passed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    });
}

async function main() {
  installInMemorySupabaseFetch();
  const apiMod = await import('../server/api');
  handleApiRequestRef = apiMod.handleApiRequest;

  console.log('================================================================');
  console.log('🧪 UDHAAR PEOPLE CONNECTIONS E2E VERIFICATION SUITE');
  console.log('================================================================');

  // Snapshot local runtime-store notifications.json if any so we clean up afterwards
  const notifStorePath = path.resolve(process.cwd(), '.data', 'runtime-store', 'notifications.json');
  const prevNotifStore = fs.existsSync(notifStorePath) ? fs.readFileSync(notifStorePath, 'utf8') : null;

  try {
    // 1. Method A: Search & Send Request
    await check('Method A: User A searches User B -> status none', async () => {
      const res = await apiCall(TOKEN_A, 'GET', '/api/udhar/users/search?q=Bob');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.payload.success, true);
      const bob = res.payload.users.find((u: any) => u.id === USER_B_ID);
      assert.ok(bob, 'Bob must appear in search');
      assert.strictEqual(bob.connectionStatus, 'none');
    });

    let firstReqId = '';
    await check('Method A: User A sends request -> PENDING created, zero Saved People added', async () => {
      const res = await apiCall(TOKEN_A, 'POST', '/api/udhar/connections/connect', {
        targetUserId: USER_B_ID,
        relationshipType: 'Friend',
        requestedVia: 'search',
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.payload.status, 'pending');
      assert.ok(res.payload.requestId);
      firstReqId = res.payload.requestId;

      const contactsA = await apiCall(TOKEN_A, 'GET', '/api/udhar/contacts');
      const contactsB = await apiCall(TOKEN_B, 'GET', '/api/udhar/contacts');
      assert.strictEqual(contactsA.payload.contacts.length, 0, 'Sender must not get Saved Person while pending');
      assert.strictEqual(contactsB.payload.contacts.length, 0, 'Receiver must not get Saved Person while pending');
    });

    await check('Method A: Duplicate pending request is blocked cleanly (deduplicated)', async () => {
      const notifCountBefore = tables.user_notifications.length;
      const res = await apiCall(TOKEN_A, 'POST', '/api/udhar/connections/connect', {
        targetUserId: USER_B_ID,
        requestedVia: 'search',
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.payload.status, 'pending');
      assert.strictEqual(res.payload.deduplicated, true);
      assert.strictEqual(tables.user_notifications.length, notifCountBefore, 'No duplicate notification on duplicate request');
    });

    await check('Method A: Search shows Request Sent (pending) + Requests panel lists incoming/outgoing', async () => {
      const searchA = await apiCall(TOKEN_A, 'GET', '/api/udhar/users/search?q=Bob');
      const bob = searchA.payload.users.find((u: any) => u.id === USER_B_ID);
      assert.strictEqual(bob.connectionStatus, 'pending');
      assert.strictEqual(bob.requestId, firstReqId);

      const reqsA = await apiCall(TOKEN_A, 'GET', '/api/udhar/connections/requests');
      const reqsB = await apiCall(TOKEN_B, 'GET', '/api/udhar/connections/requests');
      assert.strictEqual(reqsA.payload.outgoing.length, 1);
      assert.strictEqual(reqsB.payload.incoming.length, 1);
    });

    await check('Method A: User A cancels outgoing request -> cancelled, notification updated, zero connection', async () => {
      const res = await apiCall(TOKEN_A, 'POST', `/api/udhar/connections/${firstReqId}/cancel`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.payload.status, 'cancelled');

      const reqsA = await apiCall(TOKEN_A, 'GET', '/api/udhar/connections/requests');
      assert.strictEqual(reqsA.payload.outgoing.length, 0);

      const bNotif = tables.user_notifications.find(
        (n) => n.user_id === USER_B_ID && n.metadata?.requestId === firstReqId
      );
      assert.strictEqual(bNotif?.metadata?.requestStatus, 'cancelled');
    });

    let secondReqId = '';
    let secondNotifId = '';
    await check('Method A + Notification Action: User A re-requests -> User B rejects via notification -> zero connection & 409 double-submit guard', async () => {
      const sendRes = await apiCall(TOKEN_A, 'POST', '/api/udhar/connections/request', {
        targetUserId: USER_B_ID,
        source: 'search',
      });
      assert.strictEqual(sendRes.status, 200);
      assert.strictEqual(sendRes.payload.status, 'pending');
      secondReqId = sendRes.payload.requestId;

      const notifsB = await apiCall(TOKEN_B, 'GET', '/api/notifications?limit=20');
      const reqNotif = notifsB.payload.notifications.find(
        (n: any) =>
          n.metadata?.actionType === 'udhar_connection_request' &&
          n.metadata?.requestId === secondReqId
      );
      assert.ok(reqNotif, 'User B must receive connection request notification');
      secondNotifId = reqNotif.id;

      // IDOR check: User A cannot act on User B's notification
      const idorRes = await apiCall(TOKEN_A, 'POST', `/api/notifications/${secondNotifId}/connection-action`, {
        action: 'accept',
      });
      assert.strictEqual(idorRes.status, 404);

      // User B rejects from notification
      const rejectRes = await apiCall(TOKEN_B, 'POST', `/api/notifications/${secondNotifId}/connection-action`, {
        action: 'reject',
      });
      assert.strictEqual(rejectRes.status, 200);
      assert.strictEqual(rejectRes.payload.status, 'rejected');

      // Double-submit guard returns 409
      const doubleRes = await apiCall(TOKEN_B, 'POST', `/api/notifications/${secondNotifId}/connection-action`, {
        action: 'accept',
      });
      assert.strictEqual(doubleRes.status, 409);

      const contactsA = await apiCall(TOKEN_A, 'GET', '/api/udhar/contacts');
      assert.strictEqual(contactsA.payload.contacts.length, 0);
    });

    await check('Method A: Simultaneous opposite-direction requests connect safely, and Notification Accept works', async () => {
      // A requests B
      const r1 = await apiCall(TOKEN_A, 'POST', '/api/udhar/connections/connect', {
        targetUserId: USER_B_ID,
        requestedVia: 'search',
      });
      assert.strictEqual(r1.payload.status, 'pending');

      // B sends request to A while A->B is pending -> connects cleanly without duplicate rows
      const r2 = await apiCall(TOKEN_B, 'POST', '/api/udhar/connections/connect', {
        targetUserId: USER_A_ID,
        requestedVia: 'search',
      });
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r2.payload.status, 'connected');

      const contactsA = await apiCall(TOKEN_A, 'GET', '/api/udhar/contacts');
      const contactsB = await apiCall(TOKEN_B, 'GET', '/api/udhar/contacts');
      assert.strictEqual(contactsA.payload.contacts.length, 1);
      assert.strictEqual(contactsB.payload.contacts.length, 1);
      assert.strictEqual(contactsA.payload.contacts[0].linked_user_id, USER_B_ID);
      assert.strictEqual(contactsB.payload.contacts[0].linked_user_id, USER_A_ID);

      // Clean up connection via User A's DELETE endpoint
      const delRes = await apiCall(TOKEN_A, 'DELETE', `/api/udhar/connections/conn_${USER_B_ID}`);
      assert.strictEqual(delRes.status, 200);

      // Now test Notification Accept explicitly
      const r3 = await apiCall(TOKEN_A, 'POST', '/api/udhar/connections/connect', {
        targetUserId: USER_B_ID,
        requestedVia: 'search',
      });
      const notifsB = await apiCall(TOKEN_B, 'GET', '/api/notifications?limit=20');
      const reqNotif = notifsB.payload.notifications.find(
        (n: any) =>
          n.metadata?.actionType === 'udhar_connection_request' &&
          n.metadata?.requestId === r3.payload.requestId
      );
      const acceptRes = await apiCall(TOKEN_B, 'POST', `/api/notifications/${reqNotif.id}/connection-action`, {
        action: 'accept',
      });
      assert.strictEqual(acceptRes.status, 200);
      assert.strictEqual(acceptRes.payload.status, 'connected');
      assert.strictEqual(acceptRes.payload.requestStatus, 'accepted');

      // Clean up again for Method B tests
      await apiCall(TOKEN_A, 'DELETE', `/api/udhar/connections/conn_${USER_B_ID}`);
    });

    // 2. Method B: QR Code & Confirmation Code Direct Connection
    let bobCode = '';
    let bobToken = '';
    await check('Method B: Confirmation Code direct connection creates mutual Saved People immediately with ZERO pending request & informational-only notification', async () => {
      const qrRes = await apiCall(TOKEN_B, 'GET', '/api/udhar/qr/my-code');
      assert.strictEqual(qrRes.status, 200);
      bobCode = qrRes.payload.pairingCode;
      bobToken = qrRes.payload.pairingToken;
      assert.ok(bobCode && bobToken);

      const resolveRes = await apiCall(TOKEN_A, 'POST', '/api/udhar/qr/resolve', { pairingCode: bobCode });
      assert.strictEqual(resolveRes.status, 200);
      assert.strictEqual(resolveRes.payload.isAlreadyConnected, false);

      const notifBefore = tables.user_notifications.filter((n) => n.user_id === USER_B_ID).length;
      const connectRes = await apiCall(TOKEN_A, 'POST', '/api/udhar/qr/connect', {
        pairingCode: bobCode,
        connectionMethod: 'CONFIRMATION_CODE',
      });
      assert.strictEqual(connectRes.status, 200);
      assert.strictEqual(connectRes.payload.status, 'connected');
      assert.strictEqual(connectRes.payload.title, 'Connection Added Successfully');
      assert.strictEqual(connectRes.payload.message, 'Bob Verma has been added to your Saved People.');

      // Both users in Saved People immediately, zero pending requests
      const contactsA = await apiCall(TOKEN_A, 'GET', '/api/udhar/contacts');
      const contactsB = await apiCall(TOKEN_B, 'GET', '/api/udhar/contacts');
      const reqsB = await apiCall(TOKEN_B, 'GET', '/api/udhar/connections/requests');
      assert.strictEqual(contactsA.payload.contacts.length, 1);
      assert.strictEqual(contactsB.payload.contacts.length, 1);
      assert.strictEqual(reqsB.payload.incoming.length, 0);

      // Zero Udhaar transactions auto-created
      assert.strictEqual(tables.udhar_transactions.length, 0);

      // Informational notification sent to User B without accept/reject actions
      const notifsB = await apiCall(TOKEN_B, 'GET', '/api/notifications?limit=20');
      assert.strictEqual(tables.user_notifications.filter((n) => n.user_id === USER_B_ID).length, notifBefore + 1);
      const infoNotif = notifsB.payload.notifications[0];
      assert.strictEqual(infoNotif.title, 'New People Connection');
      assert.strictEqual(infoNotif.message, 'Alice Sharma added you using your Confirmation Code.');
      assert.strictEqual(infoNotif.metadata.actionType, 'udhar_qr_connected');
      assert.strictEqual(infoNotif.metadata.informationalOnly, true);
      assert.strictEqual(infoNotif.metadata.connectionMethod, 'CONFIRMATION_CODE');
      assert.strictEqual(infoNotif.metadata.initiatorName, 'Alice Sharma');

      // Informational notification must reject connection-action endpoint
      const badActionRes = await apiCall(TOKEN_B, 'POST', `/api/notifications/${infoNotif.id}/connection-action`, {
        action: 'accept',
      });
      assert.strictEqual(badActionRes.status, 400);
    });

    await check('Method B: Duplicate QR/Code scan returns Already Connected without duplicate notifications', async () => {
      const notifBefore = tables.user_notifications.filter((n) => n.user_id === USER_B_ID).length;
      const dupRes = await apiCall(TOKEN_A, 'POST', '/api/udhar/qr/connect', {
        pairingToken: bobToken,
        connectionMethod: 'QR_CODE',
      });
      assert.strictEqual(dupRes.status, 200);
      assert.strictEqual(dupRes.payload.alreadyConnected, true);
      assert.strictEqual(dupRes.payload.title, 'Already Connected');
      const notifAfter = tables.user_notifications.filter((n) => n.user_id === USER_B_ID).length;
      assert.strictEqual(notifAfter, notifBefore, 'Duplicate connect must not emit duplicate notifications');
    });

    await check('Method B: Scanning QR resolves pre-existing pending Search request cleanly and sends QR Code notification', async () => {
      await apiCall(TOKEN_A, 'DELETE', `/api/udhar/connections/conn_${USER_B_ID}`);
      const pendingRes = await apiCall(TOKEN_A, 'POST', '/api/udhar/connections/connect', {
        targetUserId: USER_B_ID,
        requestedVia: 'search',
      });
      assert.strictEqual(pendingRes.payload.status, 'pending');

      const qrConnect = await apiCall(TOKEN_A, 'POST', '/api/udhar/qr/connect', {
        pairingToken: bobToken,
        connectionMethod: 'QR_CODE',
      });
      assert.strictEqual(qrConnect.status, 200);
      assert.strictEqual(qrConnect.payload.status, 'connected');

      const reqsB = await apiCall(TOKEN_B, 'GET', '/api/udhar/connections/requests');
      assert.strictEqual(reqsB.payload.incoming.length, 0, 'Pending search request must be cleanly resolved');

      const notifsB = await apiCall(TOKEN_B, 'GET', '/api/notifications?limit=20');
      const qrInfoNotif = notifsB.payload.notifications.find(
        (n: any) =>
          n.metadata?.actionType === 'udhar_qr_connected' &&
          n.metadata?.connectionMethod === 'QR_CODE'
      );
      assert.ok(qrInfoNotif, 'User B must receive QR Code informational notification');
      assert.strictEqual(qrInfoNotif.message, 'Alice Sharma added you using your QR Code.');
    });

    // 3. Instant Two-Sided Delete Preserving Udhaar Transactions
    await check('Two-Sided Delete removes Saved People from BOTH accounts immediately while preserving all Udhaar transactions & balances with zero resurrection', async () => {
      // Create Udhaar transaction while connected
      const txRes = await apiCall(TOKEN_A, 'POST', '/api/udhar/transactions', {
        counterpart_name: 'Bob Verma',
        counterpart_user_id: USER_B_ID,
        direction: 'gave',
        amount: 1500,
        notes: 'Dinner split',
        description: 'Dinner split',
      });
      assert.ok(txRes.status === 200 || txRes.status === 201, `Expected 200/201, got ${txRes.status}`);
      assert.strictEqual(txRes.payload.success, true);

      // Verify transaction visible to both
      const txListA = await apiCall(TOKEN_A, 'GET', '/api/udhar/transactions');
      const txListB = await apiCall(TOKEN_B, 'GET', '/api/udhar/transactions');
      assert.strictEqual(txListA.payload.transactions.length, 1);
      assert.strictEqual(txListB.payload.transactions.length, 1);

      // Delete from User A's Saved People using contact id or conn_ id
      const contactsA = await apiCall(TOKEN_A, 'GET', '/api/udhar/contacts');
      assert.strictEqual(contactsA.payload.contacts.length, 1);
      const contactIdA = contactsA.payload.contacts[0].id;

      const delRes = await apiCall(TOKEN_A, 'DELETE', `/api/udhar/contacts/${encodeURIComponent(contactIdA)}`);
      assert.strictEqual(delRes.status, 200);
      assert.strictEqual(delRes.payload.success, true);
      assert.strictEqual(delRes.payload.twoSided, true);
      assert.strictEqual(delRes.payload.preservedTransactions, true);

      // Immediately absent from BOTH users' contacts and contacts/with-balances (NO tx_peer_* resurrection!)
      const afterContactsA = await apiCall(TOKEN_A, 'GET', '/api/udhar/contacts');
      const afterContactsB = await apiCall(TOKEN_B, 'GET', '/api/udhar/contacts');
      const afterBalancesA = await apiCall(TOKEN_A, 'GET', '/api/udhar/contacts/with-balances');
      const afterBalancesB = await apiCall(TOKEN_B, 'GET', '/api/udhar/contacts/with-balances');

      assert.strictEqual(afterContactsA.payload.contacts.length, 0, 'User A contacts must be empty after delete');
      assert.strictEqual(afterContactsB.payload.contacts.length, 0, 'User B contacts must be empty immediately after User A deletes');
      assert.strictEqual(afterBalancesA.payload.contacts.length, 0, 'User A balances directory must NOT resurrect deleted peer from transactions');
      assert.strictEqual(afterBalancesB.payload.contacts.length, 0, 'User B balances directory must NOT resurrect deleted peer from transactions');

      // Existing Udhaar transactions must remain 100% intact for both users!
      const afterTxA = await apiCall(TOKEN_A, 'GET', '/api/udhar/transactions');
      const afterTxB = await apiCall(TOKEN_B, 'GET', '/api/udhar/transactions');
      assert.strictEqual(afterTxA.payload.transactions.length, 1, 'User A Udhaar transaction must be preserved');
      assert.strictEqual(afterTxB.payload.transactions.length, 1, 'User B Udhaar transaction must be preserved');
      assert.strictEqual(Number(afterTxA.payload.transactions[0].original_amount), 1500);
      assert.strictEqual(afterTxA.payload.transactions[0].description, 'Dinner split');
    });

    await check('Repeated Cancel is idempotent (alreadyCancelled) and Profile Edit updates local nickname/notes only without touching peer account', async () => {
      // Re-send search request -> cancel once -> cancel again
      const reqRes = await apiCall(TOKEN_A, 'POST', '/api/udhar/connections/connect', { targetUserId: USER_B_ID });
      assert.strictEqual(reqRes.status, 200);
      assert.strictEqual(reqRes.payload.status, 'pending');
      const reqId = reqRes.payload.requestId;

      // Verify exactly 1 outgoing for A and 1 incoming for B
      const listA = await apiCall(TOKEN_A, 'GET', '/api/udhar/connections/requests');
      const listB = await apiCall(TOKEN_B, 'GET', '/api/udhar/connections/requests');
      assert.strictEqual(listA.payload.outgoing.length, 1, 'Must have exactly 1 outgoing request');
      assert.strictEqual(listB.payload.incoming.length, 1, 'Must have exactly 1 incoming request');

      const cancel1 = await apiCall(TOKEN_A, 'POST', `/api/udhar/connections/${encodeURIComponent(reqId)}/cancel`);
      assert.strictEqual(cancel1.status, 200);
      assert.strictEqual(cancel1.payload.success, true);

      const cancel2 = await apiCall(TOKEN_A, 'POST', `/api/udhar/connections/${encodeURIComponent(reqId)}/cancel`);
      assert.strictEqual(cancel2.status, 200);
      assert.strictEqual(cancel2.payload.alreadyCancelled, true);

      // Re-send request from User B and have User A accept so we can test Profile Edit on linked contact + conn_ fallback
      const reqRes2 = await apiCall(TOKEN_B, 'POST', '/api/udhar/connections/connect', { targetUserId: USER_A_ID });
      assert.strictEqual(reqRes2.status, 200);
      const acceptRes2 = await apiCall(TOKEN_A, 'POST', `/api/udhar/connections/${encodeURIComponent(reqRes2.payload.requestId)}/accept`);
      assert.strictEqual(acceptRes2.status, 200);

      // Edit using conn_<USER_B_ID> synthetic ID -> creates/updates local nickname & notes only
      const editConnRes = await apiCall(TOKEN_A, 'PUT', `/api/udhar/contacts/conn_${USER_B_ID}`, {
        name: 'Bobby Nickname',
        relationship_type: 'Roommate',
        notes: 'Flatmate rent split',
        email: 'hacked@evil.com',
      });
      assert.strictEqual(editConnRes.status, 200);
      assert.strictEqual(editConnRes.payload.success, true);
      assert.strictEqual(editConnRes.payload.contact.name, 'Bobby Nickname');
      assert.strictEqual(editConnRes.payload.contact.notes, 'Flatmate rent split');
      // Ownership check: User B's contact email/name must NOT be altered by User A
      assert.notStrictEqual(editConnRes.payload.contact.email, 'hacked@evil.com');

      // Unauthorized modification: User B cannot edit User A's contact row
      const unauthEdit = await apiCall(TOKEN_B, 'PUT', `/api/udhar/contacts/${editConnRes.payload.contact.id}`, {
        name: 'Hacked',
      });
      assert.strictEqual(unauthEdit.status, 404);

      // Two-sided Udhar create & two-sided Udhar delete
      const twoWayTxRes = await apiCall(TOKEN_A, 'POST', '/api/udhar/transactions', {
        counterpart_name: 'Bob Verma',
        counterpart_user_id: USER_B_ID,
        direction: 'gave',
        amount: 750,
        description: 'Two-sided sync check',
      });
      assert.ok(twoWayTxRes.status === 200 || twoWayTxRes.status === 201);
      const createdId = twoWayTxRes.payload.transaction?.id;
      assert.ok(createdId, 'Created transaction ID required');

      const bothA1 = await apiCall(TOKEN_A, 'GET', '/api/udhar/transactions');
      const bothB1 = await apiCall(TOKEN_B, 'GET', '/api/udhar/transactions');
      assert.ok(bothA1.payload.transactions.some((t: any) => t.id === createdId && t.direction === 'gave'));
      assert.ok(bothB1.payload.transactions.some((t: any) => t.link_id === twoWayTxRes.payload.transaction.link_id && t.direction === 'took'));

      const delTxRes = await apiCall(TOKEN_A, 'DELETE', `/api/udhar/transactions/${encodeURIComponent(createdId)}`);
      assert.strictEqual(delTxRes.status, 200);
      assert.strictEqual(delTxRes.payload.success, true);

      const bothA2 = await apiCall(TOKEN_A, 'GET', '/api/udhar/transactions');
      const bothB2 = await apiCall(TOKEN_B, 'GET', '/api/udhar/transactions');
      assert.ok(!bothA2.payload.transactions.some((t: any) => t.id === createdId), 'Deleted Udhar must disappear for User A');
      assert.ok(!bothB2.payload.transactions.some((t: any) => t.link_id === twoWayTxRes.payload.transaction.link_id), 'Deleted Udhar must disappear for User B');
    });

    console.log(`\n================================================================`);
    console.log(`🎉 ALL ${passed} E2E UDHAAR PEOPLE SCENARIOS PASSED!`);
    console.log(`================================================================`);
  } finally {
    (global as any).fetch = originalFetch;
    // Restore previous notifications runtime-store file so test leaves zero side effects
    try {
      if (prevNotifStore !== null) {
        fs.writeFileSync(notifStorePath, prevNotifStore, 'utf8');
      } else if (fs.existsSync(notifStorePath)) {
        fs.unlinkSync(notifStorePath);
      }
    } catch {}
  }
}

main().catch((err) => {
  console.error('❌ E2E Suite Failed:', err);
  process.exit(1);
});
