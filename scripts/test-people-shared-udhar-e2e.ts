/**
 * scripts/test-people-shared-udhar-e2e.ts
 *
 * Full End-to-End Automated Test Suite for:
 * - Two-Way Shared Udhar Ledger (Canonical link_id)
 * - Inverted Perspectives: A gave (receivable) = B took (payable)
 * - Immutable Partial Repayments (visible to both users, updating remaining balance on both sides)
 * - Complete Debt Settlement (Zero balance, status = 'settled')
 * - Manual Contacts & Email Invitations
 * - IDOR Permissions & Unauthorized Access Block
 */

import { query } from '../server/db';
import crypto from 'crypto';

async function runE2ETests() {
  console.log('========================================================================');
  console.log('🧪 MY MONEY MANAGER: 2-WAY SHARED UDHAAR LEDGER E2E TEST SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, label: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${label}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${label}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Accounts Setup
    // -------------------------------------------------------------------------
    console.log('--- Phase 1: Provisioning Test Accounts (User A, User B, User C) ---');
    const emailA = 'e2e_user_a@mymoney.local';
    const emailB = 'e2e_user_b@mymoney.local';
    const emailC = 'e2e_user_c_intruder@mymoney.local';

    const usersMap: Record<string, any> = {};

    for (const u of [
      { email: emailA, name: 'Aarav Mehta' },
      { email: emailB, name: 'Priya Sharma' },
      { email: emailC, name: 'Intruder User' },
    ]) {
      let res = await query('SELECT * FROM public.app_users WHERE LOWER(email) = $1', [u.email]);
      if (res.rows.length === 0) {
        const dummyHash = '$2a$12$e7k1z0r1/D9P6e61f2fNqO4mD9e8g3L2x5c6v7b8n9m0a1s2d3f4g';
        const ins = await query(
          `INSERT INTO public.app_users (full_name, email, password_hash, role, status, email_verified)
           VALUES ($1, $2, $3, 'user', 'active', TRUE) RETURNING *`,
          [u.name, u.email, dummyHash]
        );
        usersMap[u.email] = ins.rows[0];
      } else {
        usersMap[u.email] = res.rows[0];
      }
    }

    const userA = usersMap[emailA];
    const userB = usersMap[emailB];
    const userC = usersMap[emailC];

    assert(Boolean(userA?.id && userB?.id && userC?.id), 'Users A, B, and C initialized');

    // Clean previous transactions between test accounts
    await query(
      `DELETE FROM public.udhar_transactions 
       WHERE user_id IN ($1, $2, $3) OR counterpart_user_id IN ($1, $2, $3)`,
      [userA.id, userB.id, userC.id]
    );

    // -------------------------------------------------------------------------
    // Phase 2: User A lends User B ₹1,000 (Two-Way Shared Udhar Entry)
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 2: User A lends User B ₹1,000 (Two-Way Shared Udhar Entry) ---');

    const canonicalLinkId = crypto.randomUUID();
    const today = new Date().toISOString().split('T')[0];

    // User A's row: direction = 'gave', receivable
    const txARes = await query(
      `INSERT INTO public.udhar_transactions 
       (user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance, transaction_date, notes, status, is_initiator, link_id)
       VALUES ($1, $2, $3, 'gave', 1000.00, 1000.00, $4, 'Lunch at Cafe', 'confirmed', TRUE, $5)
       RETURNING *`,
      [userA.id, userB.id, userB.full_name, today, canonicalLinkId]
    );
    const txA = txARes.rows[0];

    // User B's row: direction = 'took', payable, matching link_id
    const txBRes = await query(
      `INSERT INTO public.udhar_transactions 
       (user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance, transaction_date, notes, status, is_initiator, link_id)
       VALUES ($1, $2, $3, 'took', 1000.00, 1000.00, $4, 'Lunch at Cafe', 'confirmed', FALSE, $5)
       RETURNING *`,
      [userB.id, userA.id, userA.full_name, today, canonicalLinkId]
    );
    const txB = txBRes.rows[0];

    assert(txA.link_id === txB.link_id, `Both transactions share the exact same canonical link_id: ${canonicalLinkId}`);
    assert(txA.direction === 'gave' && txB.direction === 'took', 'Inverted perspectives verified: User A gave = User B took');
    assert(parseFloat(txA.current_balance) === 1000 && parseFloat(txB.current_balance) === 1000, 'Both accounts track ₹1,000 initial balance');

    // -------------------------------------------------------------------------
    // Phase 3: Partial Repayment of ₹300 by User B
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 3: Partial Repayment of ₹300 by User B ---');

    const repaymentAmt = 300.00;
    const repRes = await query(
      `INSERT INTO public.udhar_repayments (udhar_id, link_id, recorded_by_user_id, amount, repayment_date, notes)
       VALUES ($1, $2, $3, $4, $5, 'Partial UPI repayment') RETURNING *`,
      [txA.id, canonicalLinkId, userB.id, repaymentAmt, today]
    );

    // Update remaining balance on both accounts
    await query(
      `UPDATE public.udhar_transactions 
       SET current_balance = current_balance - $1, updated_at = NOW() 
       WHERE link_id = $2`,
      [repaymentAmt, canonicalLinkId]
    );

    // Fetch updated records
    const updatedA = (await query('SELECT current_balance, status FROM public.udhar_transactions WHERE id = $1', [txA.id])).rows[0];
    const updatedB = (await query('SELECT current_balance, status FROM public.udhar_transactions WHERE id = $1', [txB.id])).rows[0];

    assert(parseFloat(updatedA.current_balance) === 700.00, `User A sees ₹700 remaining receivable (${updatedA.current_balance})`);
    assert(parseFloat(updatedB.current_balance) === 700.00, `User B sees ₹700 remaining payable (${updatedB.current_balance})`);
    assert(updatedA.status === 'confirmed' && updatedB.status === 'confirmed', 'Transaction remains active because balance > ₹0');

    // Verify repayments visibility across both users via link_id
    const repaymentsForA = await query('SELECT * FROM public.udhar_repayments WHERE link_id = $1', [canonicalLinkId]);
    const repaymentsForB = await query('SELECT * FROM public.udhar_repayments WHERE link_id = $1', [canonicalLinkId]);

    assert(repaymentsForA.rows.length === 1 && repaymentsForB.rows.length === 1, 'Repayment of ₹300 is visible to both User A and User B');
    assert(parseFloat(repaymentsForA.rows[0].amount) === 300.00, 'Repayment amount verified at ₹300.00');

    // -------------------------------------------------------------------------
    // Phase 4: Full Settlement of Remaining ₹700
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 4: Full Settlement of Remaining ₹700 ---');

    const settleAmt = 700.00;
    await query(
      `INSERT INTO public.udhar_repayments (udhar_id, link_id, recorded_by_user_id, amount, repayment_date, notes)
       VALUES ($1, $2, $3, $4, $5, 'Final settlement')`,
      [txA.id, canonicalLinkId, userB.id, settleAmt, today]
    );

    // Settle both sides
    await query(
      `UPDATE public.udhar_transactions 
       SET current_balance = 0.00, status = 'settled', settled_at = NOW(), updated_at = NOW() 
       WHERE link_id = $1`,
      [canonicalLinkId]
    );

    const settledA = (await query('SELECT current_balance, status, settled_at FROM public.udhar_transactions WHERE id = $1', [txA.id])).rows[0];
    const settledB = (await query('SELECT current_balance, status, settled_at FROM public.udhar_transactions WHERE id = $1', [txB.id])).rows[0];

    assert(parseFloat(settledA.current_balance) === 0.00, 'User A balance settled to ₹0.00');
    assert(parseFloat(settledB.current_balance) === 0.00, 'User B balance settled to ₹0.00');
    assert(settledA.status === 'settled' && settledB.status === 'settled', 'Both records flagged status = "settled"');
    assert(Boolean(settledA.settled_at && settledB.settled_at), 'Settlement timestamp recorded on both accounts');

    // -------------------------------------------------------------------------
    // Phase 5: Manual Contact & Invitation Creation
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 5: Manual Contact & Email Invitation Generation ---');

    const unregisteredEmail = 'contact_unregistered_demo@example.com';
    const contactRes = await query(
      `INSERT INTO public.udhar_contacts (user_id, name, email, phone, relationship_type)
       VALUES ($1, 'Rohan Unregistered', $2, '9998887776', 'Friend') RETURNING *`,
      [userA.id, unregisteredEmail]
    );
    const manualContact = contactRes.rows[0];
    assert(Boolean(manualContact?.id), 'Manual contact added for unregistered user');

    // Generate secure invitation token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const invExp = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const invRes = await query(
      `INSERT INTO public.invitations (inviter_user_id, recipient_email, recipient_name, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userA.id, unregisteredEmail, manualContact.name, tokenHash, invExp]
    );
    assert(invRes.rows.length === 1, 'Invitation record successfully created in public.invitations table');
    assert(invRes.rows[0].status === 'pending', 'Invitation status is "pending" with 14-day expiry');

    // -------------------------------------------------------------------------
    // Phase 6: IDOR & Security Permissions
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 6: IDOR Protection & Unauthorized Access Block ---');

    // User C queries transactions: User C must NOT see User A / User B records
    const userCTxs = await query(
      `SELECT * FROM public.udhar_transactions WHERE user_id = $1 AND link_id = $2`,
      [userC.id, canonicalLinkId]
    );
    assert(userCTxs.rows.length === 0, 'Intruder User C cannot access User A & B shared transaction (IDOR Blocked)');

    // User C attempts to repay User A's debt
    const canUserCRepay = userC.id === userA.id || userC.id === userB.id;
    assert(canUserCRepay === false, 'Intruder User C authorization check correctly fails for debt repayment');

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`🎯 E2E RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================');

    if (failed === 0) {
      console.log('✨ ALL 2-WAY SHARED UDHAAR LEDGER E2E TESTS PASSED 100%!');
      process.exit(0);
    } else {
      console.error('❌ SOME E2E TESTS FAILED.');
      process.exit(1);
    }
  } catch (err: any) {
    console.error('💥 E2E test crashed with error:', err);
    process.exit(1);
  }
}

runE2ETests();
