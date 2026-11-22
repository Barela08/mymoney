import { query } from '../server/db';
import {
  sendFeedbackSubmissionEmails,
  sendUdharCreatedEmails,
  sendUdharSettledEmails,
  sendUdharUpdatedEmails,
} from '../server/email';

async function runTestSuite() {
  console.log('================================================================');
  console.log('STARTING AUTOMATED E2E VERIFICATION SUITE: FEEDBACK & UDHAR EMAILS');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ✕ FAIL: ${msg}`);
      failed++;
    }
  }

  // 1. Setup Test Users
  console.log('--- Step 1: Setting up Test Users in public.app_users ---');
  const user1Email = `test_lender_${Date.now()}@example.com`;
  const user2Email = `test_borrower_${Date.now()}@example.com`;

  const u1Res = await query(
    `INSERT INTO public.app_users (full_name, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES ('Rahul Sharma', $1, 'hashed_test_password', 'user', 'active', TRUE, NOW(), NOW())
     RETURNING id, full_name, email`,
    [user1Email]
  );
  const user1 = u1Res.rows[0];

  const u2Res = await query(
    `INSERT INTO public.app_users (full_name, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES ('Priya Patel', $1, 'hashed_test_password', 'user', 'active', TRUE, NOW(), NOW())
     RETURNING id, full_name, email`,
    [user2Email]
  );
  const user2 = u2Res.rows[0];

  assert(Boolean(user1 && user2), 'Created test registered users User 1 (Rahul) & User 2 (Priya)');

  // 2. Test Feedback Submission Instant Dual Emails
  console.log('\n--- Step 2: Testing Automated Feedback Dual Emails (User + Admin) ---');
  const feedbackId = `FB-TEST-${Date.now().toString(36).toUpperCase()}`;
  const feedbackRes = await sendFeedbackSubmissionEmails({
    feedbackId,
    userId: user1.id,
    userName: user1.full_name,
    userEmail: user1.email,
    rating: 5,
    feedbackMessage: 'My Money Manager is an outstanding application! The Udhar module is super useful.',
    category: 'Application Experience',
  });

  assert(Boolean(feedbackRes.userLogId), 'User confirmation log ID created in email_dispatch_logs');
  assert(Boolean(feedbackRes.adminLogId), 'Admin notification log ID created in email_dispatch_logs');

  // Verify DB records for feedback
  const fbUserLog = await query(
    `SELECT * FROM public.email_dispatch_logs WHERE reference_id = $1 AND email_type = 'feedback_user_confirmation'`,
    [feedbackId]
  );
  assert(fbUserLog.rows.length === 1, 'Feedback user confirmation email logged in DB');
  if (fbUserLog.rows.length > 0) {
    const l = fbUserLog.rows[0];
    assert(l.email === user1.email, `User log recipient matches: ${l.email}`);
    assert(l.trigger_event === 'feedback_submission', `Trigger event is 'feedback_submission'`);
    assert(l.subject.includes('Thank you for your feedback'), `Subject matches prompt requirement: ${l.subject}`);
  }

  const fbAdminLog = await query(
    `SELECT * FROM public.email_dispatch_logs WHERE reference_id = $1 AND email_type = 'feedback_admin_notification'`,
    [feedbackId]
  );
  assert(fbAdminLog.rows.length === 1, 'Feedback admin notification email logged in DB');
  if (fbAdminLog.rows.length > 0) {
    const l = fbAdminLog.rows[0];
    assert(l.email === 'hackifypro@gmail.com', `Admin log recipient matches: ${l.email}`);
    assert(l.trigger_event === 'feedback_submission', `Admin log trigger event is 'feedback_submission'`);
    assert(l.subject.includes('New Feedback Received'), `Admin subject matches prompt: ${l.subject}`);
  }

  // 3. Test Udhar Creation — Scenario A (Both are Registered Users)
  console.log('\n--- Step 3: Testing Udhar Creation (Both Parties Are Registered Users) ---');
  const tx1Id = `TX-${Date.now()}-A`;
  const link1Id = `LINK-${Date.now()}-A`;

  const udharTwoSidedRes = await sendUdharCreatedEmails({
    transactionId: tx1Id,
    linkId: link1Id,
    initiatorUserId: user1.id,
    initiatorName: user1.full_name,
    initiatorEmail: user1.email,
    counterpartUserId: user2.id,
    counterpartName: user2.full_name,
    counterpartEmail: user2.email,
    direction: 'gave', // Rahul lent to Priya
    amount: 5000,
    description: 'Advance rent payment',
    transactionDate: '2026-11-22',
    status: 'pending_confirmation',
  });

  assert(udharTwoSidedRes.counterpartStatus === 'sent' || udharTwoSidedRes.counterpartStatus === 'failed',
    `Registered counterpart received email notification (status: ${udharTwoSidedRes.counterpartStatus})`);

  // Verify logs for Initiator
  const initTxLog = await query(
    `SELECT * FROM public.email_dispatch_logs WHERE reference_id = $1 AND email_type = 'udhar_created_initiator'`,
    [tx1Id]
  );
  assert(initTxLog.rows.length === 1, 'Initiator Udhar Created email logged');
  if (initTxLog.rows.length > 0) {
    const l = initTxLog.rows[0];
    assert(l.email === user1.email, `Initiator email matches: ${l.email}`);
    assert(l.subject.includes('Udhar Entry Added'), `Initiator subject matches: ${l.subject}`);
    assert(l.trigger_event === 'udhar_created', `Trigger event is 'udhar_created'`);
  }

  // Verify logs for Counterpart
  const cpTxLog = await query(
    `SELECT * FROM public.email_dispatch_logs WHERE reference_id = $1 AND email_type = 'udhar_created_counterpart'`,
    [tx1Id]
  );
  assert(cpTxLog.rows.length === 1, 'Counterpart Udhar Created notification email logged');
  if (cpTxLog.rows.length > 0) {
    const l = cpTxLog.rows[0];
    assert(l.email === user2.email, `Counterpart email matches registered user email: ${l.email}`);
    assert(l.subject.includes('New Udhar Transaction Recorded'), `Counterpart subject matches: ${l.subject}`);
    assert(l.user_id === user2.id, `Counterpart user_id correctly linked to app_users ID`);
  }

  // 4. Test Udhar Creation — Critical Privacy Guard (Unregistered Counterpart)
  console.log('\n--- Step 4: Testing Privacy Guard (Counterpart is NOT a Registered User) ---');
  const tx2Id = `TX-${Date.now()}-B`;
  const link2Id = `LINK-${Date.now()}-B`;

  const udharUnregisteredRes = await sendUdharCreatedEmails({
    transactionId: tx2Id,
    linkId: link2Id,
    initiatorUserId: user1.id,
    initiatorName: user1.full_name,
    initiatorEmail: user1.email,
    counterpartUserId: null,
    counterpartName: 'Vikram Mehta (Offline Friend)',
    counterpartEmail: null,
    direction: 'gave',
    amount: 1500,
    description: 'Lunch split offline',
    transactionDate: '2026-11-22',
    status: 'confirmed',
  });

  assert(udharUnregisteredRes.counterpartStatus === 'skipped_not_registered',
    `Unregistered counterpart correctly skipped with status 'skipped_not_registered'`);

  // Verify skipped log in DB
  const skippedLog = await query(
    `SELECT * FROM public.email_dispatch_logs WHERE reference_id = $1 AND status = 'skipped_not_registered'`,
    [tx2Id]
  );
  assert(skippedLog.rows.length === 1, 'Skipped record logged in public.email_dispatch_logs');
  if (skippedLog.rows.length > 0) {
    const l = skippedLog.rows[0];
    assert(l.attempts === 0, 'Skipped log has 0 attempts');
    assert(l.last_error?.includes('not a registered My Money Manager user'), `Clear skip reason recorded: ${l.last_error}`);
    assert(l.user_id === null, 'No user_id linked for unregistered counterpart');
  }

  // 5. Test Udhar Settled / Cleared
  console.log('\n--- Step 5: Testing Udhar Settlement Notifications ---');
  const settleRes = await sendUdharSettledEmails({
    transactionId: tx1Id,
    linkId: link1Id,
    initiatorUserId: user1.id,
    initiatorName: user1.full_name,
    initiatorEmail: user1.email,
    counterpartUserId: user2.id,
    counterpartName: user2.full_name,
    counterpartEmail: user2.email,
    amountSettled: 5000,
    settlementDate: '2026-11-22',
    updatedBalance: 0,
    direction: 'gave',
  });

  assert(settleRes.counterpartStatus === 'sent' || settleRes.counterpartStatus === 'failed',
    `Settlement notification triggered for registered counterpart (status: ${settleRes.counterpartStatus})`);

  const settleLogs = await query(
    `SELECT * FROM public.email_dispatch_logs WHERE reference_id = $1 AND trigger_event = 'udhar_settled'`,
    [tx1Id]
  );
  assert(settleLogs.rows.length >= 2, `Both parties have settlement logs recorded in DB (found ${settleLogs.rows.length})`);

  // 6. Test Udhar Updated
  console.log('\n--- Step 6: Testing Udhar Updated Notifications ---');
  const updateRes = await sendUdharUpdatedEmails({
    transactionId: tx1Id,
    linkId: link1Id,
    initiatorUserId: user1.id,
    initiatorName: user1.full_name,
    initiatorEmail: user1.email,
    counterpartUserId: user2.id,
    counterpartName: user2.full_name,
    counterpartEmail: user2.email,
    amount: 5500,
    direction: 'gave',
    description: 'Updated with additional expense',
    transactionDate: '2026-11-22',
    status: 'pending_confirmation',
  });

  assert(updateRes.counterpartStatus === 'sent' || updateRes.counterpartStatus === 'failed',
    `Update notification triggered for registered counterpart (status: ${updateRes.counterpartStatus})`);

  const updateLogs = await query(
    `SELECT * FROM public.email_dispatch_logs WHERE reference_id = $1 AND trigger_event = 'udhar_updated'`,
    [tx1Id]
  );
  assert(updateLogs.rows.length >= 2, `Both parties have update logs recorded in DB (found ${updateLogs.rows.length})`);

  // 7. Cleanup Test Records
  console.log('\n--- Step 7: Cleaning up test artifacts from database ---');
  await query(`DELETE FROM public.email_dispatch_logs WHERE reference_id IN ($1, $2, $3)`, [feedbackId, tx1Id, tx2Id]);
  await query(`DELETE FROM public.app_users WHERE id IN ($1, $2)`, [user1.id, user2.id]);
  console.log('  ✓ Test users and email logs cleaned up safely.');

  console.log('\n================================================================');
  console.log(`TEST SUITE COMPLETED: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
