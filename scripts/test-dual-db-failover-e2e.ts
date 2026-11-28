import assert from 'assert';
import {
  assertAuthoritativeWriteEpoch,
  createLogicalBackupAndVerifyRestore,
  enqueueOutboxEvent,
  getFailoverState,
  getOutboxSummary,
  processOutboxQueue,
} from '../server/dbFailover.js';
import { listSecondaryCollection } from '../server/firebaseDb.js';
import { runIndependentHealthCheck, getFullHealthMatrix } from '../server/healthMonitor.js';

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✅ PASS: ${name}`);
}

async function main() {
  console.log('================================================================');
  console.log('🔁 DUAL-DB FAILOVER, OUTBOX SYNC & BACKUP VERIFICATION SUITE');
  console.log('================================================================');

  await check('Test 6 & 7: Idempotent Outbox Sync + Secondary Consistency (Profiles, Transactions, Udhaar)', async () => {
    const ikey = `tx_idem_${Date.now()}`;
    const ev1 = await enqueueOutboxEvent({
      idempotencyKey: ikey,
      collection: 'udhar_transactions',
      recordId: 'udhar_test_1',
      operation: 'upsert',
      payload: { id: 'udhar_test_1', user_id: 'user_a', amount: 500, direction: 'gave' },
      syncVersion: 1,
      sourceDb: 'supabase',
    });
    const ev2 = await enqueueOutboxEvent({
      idempotencyKey: ikey,
      collection: 'udhar_transactions',
      recordId: 'udhar_test_1',
      operation: 'upsert',
      payload: { id: 'udhar_test_1', user_id: 'user_a', amount: 500, direction: 'gave' },
      syncVersion: 1,
      sourceDb: 'supabase',
    });
    assert.strictEqual(ev1.id, ev2.id, 'Duplicate idempotencyKey must deduplicate outbox event');

    const proc = await processOutboxQueue(20);
    assert.ok(proc.synced >= 1);
    const docs = await listSecondaryCollection('udhar_transactions', 'user_a');
    assert.ok(docs.some((d) => d.id === 'udhar_test_1' && d.data.amount === 500));
  });

  await check('Test 1 & 2: Sustained PostgREST/DB Failure (3 probes) activates controlled Firebase failover & increments epoch', async () => {
    const initialEpoch = getFailoverState().providerEpoch;
    await runIndependentHealthCheck({ simulateSupabasePostgrestDown: true });
    await runIndependentHealthCheck({ simulateSupabasePostgrestDown: true });
    const res3 = await runIndependentHealthCheck({ simulateSupabasePostgrestDown: true, simulateSupabaseDbDown: true });

    assert.strictEqual(res3.failoverState.activeProvider, 'firebase');
    assert.strictEqual(res3.failoverState.providerEpoch, initialEpoch + 1);

    // Split-brain fencing check: stale epoch and non-active provider must be rejected
    const staleWrite = assertAuthoritativeWriteEpoch(initialEpoch, 'firebase');
    assert.strictEqual(staleWrite.allowed, false);
    const wrongProvider = assertAuthoritativeWriteEpoch(res3.failoverState.providerEpoch, 'supabase');
    assert.strictEqual(wrongProvider.allowed, false);
    const validWrite = assertAuthoritativeWriteEpoch(res3.failoverState.providerEpoch, 'firebase');
    assert.strictEqual(validWrite.allowed, true);
  });

  await check('Test 4: Both Databases Unavailable enters degraded_readonly and blocks financial writes', async () => {
    await runIndependentHealthCheck({
      simulateSupabaseDbDown: true,
      simulateSupabasePostgrestDown: true,
      simulateFirebaseDown: true,
    });
    const st = getFailoverState();
    assert.strictEqual(st.activeProvider, 'degraded_readonly');
    const writeGuard = assertAuthoritativeWriteEpoch(st.providerEpoch, 'firebase');
    assert.strictEqual(writeGuard.allowed, false);
  });

  await check('Test 5: Supabase Recovery (2 healthy probes) reconciles outbox and restores primary safely', async () => {
    await runIndependentHealthCheck({});
    const res2 = await runIndependentHealthCheck({});
    assert.strictEqual(res2.failoverState.activeProvider, 'supabase');
    assert.ok(res2.failoverState.lastRecoveryAt);
  });

  await check('Test 3: Firebase Failure keeps Supabase active without breaking primary', async () => {
    const res = await runIndependentHealthCheck({ simulateFirebaseDown: true });
    assert.strictEqual(res.failoverState.activeProvider, 'supabase');
    const fbSvc = res.services.find((s) => s.key === 'firebase_db');
    assert.strictEqual(fbSvc?.status, 'unhealthy');
    assert.ok(getOutboxSummary().total >= 1);
  });

  await check('Test 7B: Logical Backup Snapshot & Non-Destructive Restore Verification succeeds', async () => {
    const snap = await createLogicalBackupAndVerifyRestore('e2e_verifier');
    assert.strictEqual(snap.restoreVerified, true);
    assert.strictEqual(snap.status, 'verified');
    assert.ok(snap.checksumSha256.length === 64);
    const matrix = getFullHealthMatrix();
    assert.strictEqual(matrix.services.length, 14);
  });

  console.log(`\n================================================================`);
  console.log(`🎉 ALL ${passed} DUAL-DB FAILOVER & BACKUP TESTS PASSED!`);
  console.log(`================================================================`);
}

main().catch((err) => {
  console.error('❌ Dual-DB Failover Suite Failed:', err);
  process.exit(1);
});
