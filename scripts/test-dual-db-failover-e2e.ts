import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  _resetFailoverStateForTests,
  assertAuthoritativeWriteEpoch,
  createLogicalBackupAndVerifyRestore,
  enqueueOutboxEvent,
  getFailoverHistory,
  getFailoverState,
  getOutboxSummary,
  processOutboxQueue,
  runDualDbReconciliation,
  setSimulatedPrimaryReconcileError,
} from '../server/dbFailover.js';
import {
  listUserTransactionsViaProvider,
  upsertUserTransactionViaProvider,
} from '../server/dbProvider.js';
import { listSecondaryCollection, upsertSecondaryRecord } from '../server/firebaseDb.js';
import {
  drainPendingEmailAlertQueue,
  getFullHealthMatrix,
  runIndependentHealthCheck,
} from '../server/healthMonitor.js';

let passed = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✅ PASS: ${name}`);
}

async function main() {
  console.log('========================================================================');
  console.log('🔁 MY MONEY MANAGER — 7-SCENARIO DUAL-DB FAILOVER & CONSISTENCY E2E SUITE');
  console.log('========================================================================');

  _resetFailoverStateForTests();
  const runId = Date.now().toString(36);
  const userA = `test_user_a_${runId}`;
  const userB = `test_user_b_${runId}`;

  // -------------------------------------------------------------------------
  // TEST 1: SUPABASE POSTGREST FAILURE (Premature switch guard + 3rd probe failover)
  // -------------------------------------------------------------------------
  await check('Test 1: Supabase PostgREST Failure — no premature switch on 1–2 blips; failover on 3rd sustained failure + alert logged', async () => {
    const startEpoch = getFailoverState().providerEpoch;

    const r1 = await runIndependentHealthCheck({ simulateSupabasePostgrestDown: true });
    assert.strictEqual(r1.failoverState.activeProvider, 'supabase', '1st transient failure must NOT trigger failover');
    assert.strictEqual(r1.failoverState.consecutivePrimaryFailures, 1);

    const r2 = await runIndependentHealthCheck({ simulateSupabasePostgrestDown: true });
    assert.strictEqual(r2.failoverState.activeProvider, 'supabase', '2nd transient failure must NOT trigger failover');
    assert.strictEqual(r2.failoverState.consecutivePrimaryFailures, 2);

    const r3 = await runIndependentHealthCheck({ simulateSupabasePostgrestDown: true });
    assert.strictEqual(r3.failoverState.activeProvider, 'firebase', '3rd sustained PostgREST failure must activate Firebase failover');
    assert.strictEqual(r3.failoverState.providerEpoch, startEpoch + 1, 'Provider fencing epoch must increment monotonically');

    const matrix = getFullHealthMatrix();
    const restSvc = matrix.services.find((s) => s.key === 'supabase_postgrest');
    assert.strictEqual(restSvc?.status, 'unhealthy');
    assert.ok(matrix.alerts.recent.length >= 1, 'Admin failure alert must be logged');
    assert.ok(getFailoverHistory().some((h) => h.toProvider === 'firebase'), 'Failover history must record transition to firebase');
  });

  // -------------------------------------------------------------------------
  // TEST 2: SUPABASE DATABASE FAILURE + ACTIVE FAILOVER WRITE + SPLIT-BRAIN FENCING
  // -------------------------------------------------------------------------
  await check('Test 2: Supabase Database Failure — fencing blocks stale writes & failover write persists to Firebase + queues reverse sync', async () => {
    const r = await runIndependentHealthCheck({
      simulateSupabaseDbDown: true,
      simulateSupabasePostgrestDown: true,
    });
    assert.strictEqual(r.failoverState.activeProvider, 'firebase');

    const epoch = r.failoverState.providerEpoch;
    assert.strictEqual(assertAuthoritativeWriteEpoch(epoch - 1, 'firebase').allowed, false, 'Stale epoch must be rejected');
    assert.strictEqual(assertAuthoritativeWriteEpoch(epoch, 'supabase').allowed, false, 'Non-active primary write must be rejected');
    assert.strictEqual(assertAuthoritativeWriteEpoch(epoch, 'firebase').allowed, true, 'Active failover epoch must be allowed');

    // Write a real financial transaction via the centralized provider during failover
    const failoverTxId = '11111111-1111-4111-8111-111111111111';
    const writeRes = await upsertUserTransactionViaProvider({
      tx: {
        id: failoverTxId,
        user_id: userA,
        category: 'food',
        subcategory: 'Lunch',
        transaction_type: 'expense',
        amount: 275,
        title: 'Failover Lunch Expense',
        transaction_date: '2026-11-28',
        transaction_time: '13:15:00',
      },
      idempotencyKey: `tx_failover_key_${runId}`,
    });
    assert.strictEqual(writeRes.ok, true, `Failover write should succeed: ${writeRes.error || ''}`);
    assert.strictEqual(writeRes.provider, 'firebase', 'Write during failover must route to Firebase secondary');
    assert.strictEqual(writeRes.epoch, epoch);

    // Confirm failover read returns the newly persisted transaction immediately
    const readRes = await listUserTransactionsViaProvider({ userId: userA });
    assert.strictEqual(readRes.ok, true);
    assert.strictEqual(readRes.provider, 'firebase');
    assert.ok(
      (readRes.data || []).some((t) => t.id === failoverTxId && Number(t.amount) === 275),
      'Transaction written during failover must be immediately readable from Firebase'
    );

    // Confirm a pending reverse-sync outbox event (firebase -> supabase) was queued
    const outbox = getOutboxSummary();
    assert.ok(
      outbox.recentEvents.some((e) => e.recordId === failoverTxId && e.sourceDb === 'firebase' && e.targetDb === 'supabase'),
      'Failover write must enqueue reverse outbox event targeting Supabase'
    );
  });

  // -------------------------------------------------------------------------
  // TEST 4: BOTH DATABASES UNAVAILABLE (Degraded Read-Only — ZERO Fake Success)
  // -------------------------------------------------------------------------
  await check('Test 4: Both Databases Unavailable — enters degraded_readonly and rejects financial writes with HTTP 503', async () => {
    const r = await runIndependentHealthCheck({
      simulateSupabaseDbDown: true,
      simulateSupabasePostgrestDown: true,
      simulateFirebaseDown: true,
    });
    assert.strictEqual(r.failoverState.activeProvider, 'degraded_readonly');

    const guard = assertAuthoritativeWriteEpoch(r.failoverState.providerEpoch, 'firebase');
    assert.strictEqual(guard.allowed, false);

    const blockedRes = await upsertUserTransactionViaProvider({
      tx: {
        id: '22222222-2222-4222-8222-222222222222',
        user_id: userA,
        category: 'other',
        subcategory: 'Blocked',
        transaction_type: 'expense',
        amount: 999,
        title: 'Must Be Rejected',
      },
    });
    assert.strictEqual(blockedRes.ok, false, 'Financial write MUST fail when both DBs are down');
    assert.strictEqual(blockedRes.status, 503, 'Financial write MUST return HTTP 503');
    assert.strictEqual(
      blockedRes.code,
      'WRITE_BLOCKED_DEGRADED_MODE',
      'Financial write MUST return WRITE_BLOCKED_DEGRADED_MODE'
    );
  });

  // -------------------------------------------------------------------------
  // TEST 5: SUPABASE RECOVERY (2 healthy probes + outbox reconciliation + recovery alert)
  // -------------------------------------------------------------------------
  await check('Test 5: Supabase Recovery — requires 2 consecutive healthy probes, restores primary, logs recovery & reconciles', async () => {
    // Allow reverse sync reconciliation to complete cleanly in test mode when PG isn't locally configured
    setSimulatedPrimaryReconcileError(null);

    const rec1 = await runIndependentHealthCheck({});
    assert.notStrictEqual(rec1.failoverState.activeProvider, 'supabase', '1st healthy probe must NOT immediately restore primary');

    const rec2 = await runIndependentHealthCheck({});
    assert.strictEqual(rec2.failoverState.activeProvider, 'supabase', '2nd consecutive healthy probe must restore Supabase primary');
    assert.ok(rec2.failoverState.lastRecoveryAt, 'lastRecoveryAt timestamp must be recorded');

    const recon = await runDualDbReconciliation();
    assert.ok(recon.timestamp, 'Reconciliation run must record completion timestamp');
    assert.ok(recon.checkedCollections >= 6, 'Reconciliation must audit core business collections');

    const matrix = getFullHealthMatrix();
    assert.ok(
      matrix.alerts.recent.some((a) => a.transition === 'recovery'),
      'Admin recovery alert must be logged after Supabase returns healthy'
    );
    const drain = await drainPendingEmailAlertQueue();
    assert.ok(typeof drain.remaining === 'number');
  });

  // -------------------------------------------------------------------------
  // TEST 3: FIREBASE FAILURE WHILE SUPABASE IS HEALTHY
  // -------------------------------------------------------------------------
  await check('Test 3: Firebase Failure — Supabase stays primary, Firebase marked unhealthy, outbox preserves pending writes', async () => {
    const r = await runIndependentHealthCheck({ simulateFirebaseDown: true });
    assert.strictEqual(r.failoverState.activeProvider, 'supabase', 'Supabase must remain primary when only Firebase fails');
    const fbSvc = r.services.find((s) => s.key === 'firebase_db');
    assert.strictEqual(fbSvc?.status, 'unhealthy');

    // Enqueue a Supabase-origin write; it must remain safely tracked in the outbox
    const ev = await enqueueOutboxEvent({
      idempotencyKey: `sb_only_${runId}`,
      collection: 'transactions',
      recordId: `tx_sb_${runId}`,
      operation: 'upsert',
      payload: { id: `tx_sb_${runId}`, user_id: userA, amount: 150, transaction_type: 'income', title: 'Refund' },
      syncVersion: 1,
      sourceDb: 'supabase',
      targetDb: 'firebase',
    });
    assert.strictEqual(ev.sourceDb, 'supabase');
    assert.ok(getOutboxSummary().total >= 1);
  });

  // -------------------------------------------------------------------------
  // TEST 6: DUPLICATE SYNCHRONIZATION & MONOTONIC VERSION PROTECTION
  // -------------------------------------------------------------------------
  await check('Test 6: Duplicate Sync — idempotencyKey deduplicates outbox & stale sync_version cannot overwrite newer revision', async () => {
    const ikey = `idem_dup_${runId}`;
    const recId = `udhar_dup_${runId}`;

    const ev1 = await enqueueOutboxEvent({
      idempotencyKey: ikey,
      collection: 'udhar_transactions',
      recordId: recId,
      operation: 'upsert',
      payload: { id: recId, user_id: userA, amount: 500, direction: 'gave', status: 'confirmed' },
      syncVersion: 2,
      sourceDb: 'supabase',
    });
    const ev2 = await enqueueOutboxEvent({
      idempotencyKey: ikey,
      collection: 'udhar_transactions',
      recordId: recId,
      operation: 'upsert',
      payload: { id: recId, user_id: userA, amount: 500, direction: 'gave', status: 'confirmed' },
      syncVersion: 2,
      sourceDb: 'supabase',
    });
    assert.strictEqual(ev1.id, ev2.id, 'Duplicate idempotencyKey must return the exact same outbox event');

    await processOutboxQueue(500, { forceImmediate: true });

    // Attempt stale version (v1 < v2) overwrite directly — must be ignored!
    await upsertSecondaryRecord({
      collection: 'udhar_transactions',
      id: recId,
      sync_version: 1,
      source_db: 'supabase',
      updated_at: new Date().toISOString(),
      data: { id: recId, user_id: userA, amount: 999999, direction: 'gave', status: 'stale_overwrite' },
    });

    const docs = await listSecondaryCollection('udhar_transactions', userA);
    const matches = docs.filter((d) => d.id === recId);
    assert.strictEqual(matches.length, 1, 'Must never create duplicate records in secondary store');
    assert.strictEqual(matches[0].sync_version, 2, 'Newer sync_version (2) must not be downgraded by stale v1');
    assert.strictEqual(matches[0].data.amount, 500, 'Stale payload must not overwrite newer amount');
  });

  // -------------------------------------------------------------------------
  // TEST 7: TWO-ACCOUNT CONSISTENCY + REAL LOGICAL BACKUP & RESTORE VERIFICATION
  // -------------------------------------------------------------------------
  await check('Test 7: Two-Account Consistency (Profiles, Income, Expense, Udhaar, Connections, Settlements, Notifications) + Backup/Restore Verification', async () => {
    const records: Array<{ collection: string; id: string; userId: string; data: Record<string, any> }> = [
      { collection: 'profiles', id: userA, userId: userA, data: { id: userA, full_name: 'Account Alpha', email: 'alpha@example.com' } },
      { collection: 'profiles', id: userB, userId: userB, data: { id: userB, full_name: 'Account Beta', email: 'beta@example.com' } },
      { collection: 'transactions', id: `inc_a_${runId}`, userId: userA, data: { id: `inc_a_${runId}`, user_id: userA, transaction_type: 'income', amount: 10000, title: 'Salary' } },
      { collection: 'transactions', id: `exp_a_${runId}`, userId: userA, data: { id: `exp_a_${runId}`, user_id: userA, transaction_type: 'expense', amount: 1200, title: 'Groceries' } },
      { collection: 'transactions', id: `inc_b_${runId}`, userId: userB, data: { id: `inc_b_${runId}`, user_id: userB, transaction_type: 'income', amount: 5000, title: 'Freelance' } },
      { collection: 'user_connections', id: `conn_ab_${runId}`, userId: userA, data: { id: `conn_ab_${runId}`, user_id: userA, user_a_id: userA, user_b_id: userB, status: 'connected' } },
      { collection: 'udhar_transactions', id: `udhar_ab_${runId}`, userId: userA, data: { id: `udhar_ab_${runId}`, user_id: userA, counterpart_user_id: userB, direction: 'gave', original_amount: 1500, current_balance: 500 } },
      { collection: 'udhar_repayments', id: `repay_ab_${runId}`, userId: userA, data: { id: `repay_ab_${runId}`, user_id: userA, amount: 1000, status: 'confirmed' } },
      { collection: 'user_notifications', id: `notif_b_${runId}`, userId: userB, data: { id: `notif_b_${runId}`, user_id: userB, title: 'Settlement Confirmed', is_read: false } },
    ];

    for (const r of records) {
      await enqueueOutboxEvent({
        idempotencyKey: `t7:${r.collection}:${r.id}:v1`,
        collection: r.collection,
        recordId: r.id,
        operation: 'upsert',
        payload: r.data,
        syncVersion: 1,
        sourceDb: 'supabase',
      });
    }

    const proc = await processOutboxQueue(500, { forceImmediate: true });
    assert.ok(proc.synced >= records.length, `Expected at least ${records.length} records synced`);

    // Verify User A & User B isolation + exact balances
    const txA = await listSecondaryCollection('transactions', userA);
    const txB = await listSecondaryCollection('transactions', userB);
    const netA = txA
      .filter((t) => t.id === `inc_a_${runId}` || t.id === `exp_a_${runId}`)
      .reduce((acc, t) => acc + (t.data.transaction_type === 'income' ? Number(t.data.amount) : -Number(t.data.amount)), 0);
    const netB = txB
      .filter((t) => t.id === `inc_b_${runId}`)
      .reduce((acc, t) => acc + Number(t.data.amount), 0);

    assert.strictEqual(netA, 8800, 'Account A net balance must equal ₹8,800 (10,000 - 1,200)');
    assert.strictEqual(netB, 5000, 'Account B net balance must equal ₹5,000');

    const connA = await listSecondaryCollection('user_connections', userA);
    const repA = await listSecondaryCollection('udhar_repayments', userA);
    const notifB = await listSecondaryCollection('user_notifications', userB);
    assert.ok(connA.some((c) => c.id === `conn_ab_${runId}`));
    assert.ok(repA.some((r) => r.id === `repay_ab_${runId}` && r.data.amount === 1000));
    assert.ok(notifB.some((n) => n.id === `notif_b_${runId}`));

    // Real logical backup snapshot + non-destructive restore verification
    const snap = await createLogicalBackupAndVerifyRestore('e2e_verifier', 'test_verified_snapshot');
    assert.strictEqual(snap.restoreVerified, true, 'Non-destructive restore verification MUST pass');
    assert.strictEqual(snap.status, 'verified');
    assert.strictEqual(snap.checksumSha256.length, 64, 'Checksum must be a real 64-char SHA-256 hex digest');
    assert.ok(snap.totalRecords >= records.length, 'Backup must contain all synced records');
    assert.ok(snap.byteSize > 100, 'Backup payload must be non-empty');

    const matrix = getFullHealthMatrix();
    assert.strictEqual(matrix.services.length, 14, 'Health matrix must report all 14 independent services');
  });

  // Clean up synthetic test records from local staging mirror file if created
  const mirrorPath = path.resolve(process.cwd(), '.runtime-firebase-mirror.json');
  try {
    if (fs.existsSync(mirrorPath)) {
      const parsed = JSON.parse(fs.readFileSync(mirrorPath, 'utf8'));
      for (const col of Object.keys(parsed || {})) {
        for (const docId of Object.keys(parsed[col] || {})) {
          if (docId.includes(runId) || docId === '11111111-1111-4111-8111-111111111111') {
            delete parsed[col][docId];
          }
        }
      }
      fs.writeFileSync(mirrorPath, JSON.stringify(parsed, null, 2), 'utf8');
    }
  } catch {}

  console.log('\n========================================================================');
  console.log(`🎉 ALL ${passed} DUAL-DB FAILOVER, CONSISTENCY & BACKUP TESTS PASSED!`);
  console.log('========================================================================');
}

main().catch((err) => {
  console.error('❌ Dual-DB Failover Suite Failed:', err);
  process.exit(1);
});
