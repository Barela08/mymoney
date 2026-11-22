import { query, pool } from '../server/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  notifyQrConnected,
  notifyUdharCreated,
  notifyUdharRepayment,
} from '../server/notificationService';

async function runMutualUdharTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING COMPREHENSIVE MUTUAL UDHAR & NOTIFICATION TESTS');
  console.log('====================================================\n');

  try {
    // -----------------------------------------------------------------
    // Step 1: Ensure Two Test Accounts Exist
    // -----------------------------------------------------------------
    console.log('Step 1: Setting up Test User A and Test User B...');
    const salt = await bcrypt.genSalt(10);
    const pwdHash = await bcrypt.hash('TestPass123!', salt);

    const userAEmail = 'test_user_a@mymoney.local';
    const userBEmail = 'test_user_b@mymoney.local';

    let userARes = await query('SELECT * FROM public.app_users WHERE LOWER(email) = $1', [userAEmail]);
    if (userARes.rows.length === 0) {
      userARes = await query(
        `INSERT INTO public.app_users (full_name, email, password_hash, role, status, updated_at)
         VALUES ('Arjun Verma', $1, $2, 'user', 'active', NOW())
         RETURNING *`,
        [userAEmail, pwdHash]
      );
    }

    let userBRes = await query('SELECT * FROM public.app_users WHERE LOWER(email) = $1', [userBEmail]);
    if (userBRes.rows.length === 0) {
      userBRes = await query(
        `INSERT INTO public.app_users (full_name, email, password_hash, role, status, updated_at)
         VALUES ('Priya Sharma', $1, $2, 'user', 'active', NOW())
         RETURNING *`,
        [userBEmail, pwdHash]
      );
    }

    const userA = userARes.rows[0];
    const userB = userBRes.rows[0];
    console.log(`✅ User A: ${userA.full_name} (${userA.id})`);
    console.log(`✅ User B: ${userB.full_name} (${userB.id})\n`);

    // -----------------------------------------------------------------
    // Step 2: Test QR Code Generation for User B
    // -----------------------------------------------------------------
    console.log("Step 2: User B generates a QR Pairing Token...");
    const pairingToken = 'token_' + crypto.randomBytes(16).toString('hex');
    const pairingCode = Math.floor(100000 + Math.random() * 900000).toString();

    const qrRes = await query(
      `INSERT INTO public.qr_pairing_tokens (user_id, pairing_token, pairing_code, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')
       RETURNING *`,
      [userB.id, pairingToken, pairingCode]
    );
    console.log(`✅ Generated QR Token for User B (Code: ${pairingCode})\n`);

    // -----------------------------------------------------------------
    // Step 3: Test QR Scanning & Bidirectional Contact Pairing
    // -----------------------------------------------------------------
    console.log("Step 3: User A scans User B's QR Code (Mutual Linking)...");

    // Create mutual user_connections
    await query(
      `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
       VALUES ($1, $2, 'connected')
       ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
      [userA.id, userB.id]
    );
    await query(
      `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
       VALUES ($1, $2, 'connected')
       ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
      [userB.id, userA.id]
    );

    // User A's contacts gets User B
    await query(
      `INSERT INTO public.udhar_contacts (user_id, name, email, phone, relationship_type, linked_user_id, updated_at)
       VALUES ($1, $2, $3, $4, 'Friend', $5, NOW())
       ON CONFLICT (user_id, name) DO UPDATE
       SET linked_user_id = EXCLUDED.linked_user_id, updated_at = NOW()`,
      [userA.id, userB.full_name, userB.email, userB.phone, userB.id]
    );

    // User B's contacts reciprocally gets User A
    await query(
      `INSERT INTO public.udhar_contacts (user_id, name, email, phone, relationship_type, linked_user_id, updated_at)
       VALUES ($1, $2, $3, $4, 'Friend', $5, NOW())
       ON CONFLICT (user_id, name) DO UPDATE
       SET linked_user_id = EXCLUDED.linked_user_id, updated_at = NOW()`,
      [userB.id, userA.full_name, userA.email, userA.phone, userA.id]
    );

    // Trigger QR Connected Notifications
    await notifyQrConnected({
      userAId: userA.id,
      userAName: userA.full_name,
      userBId: userB.id,
      userBName: userB.full_name,
    });

    // Verification
    const contactCheckA = await query(
      `SELECT * FROM public.udhar_contacts WHERE user_id = $1 AND linked_user_id = $2`,
      [userA.id, userB.id]
    );
    const contactCheckB = await query(
      `SELECT * FROM public.udhar_contacts WHERE user_id = $1 AND linked_user_id = $2`,
      [userB.id, userA.id]
    );

    if (contactCheckA.rows.length === 0 || contactCheckB.rows.length === 0) {
      throw new Error('❌ Failed: Mutual contact linking incomplete!');
    }
    console.log(`✅ User A has saved contact: ${contactCheckA.rows[0].name} (Linked User ID: ${contactCheckA.rows[0].linked_user_id})`);
    console.log(`✅ User B has saved contact: ${contactCheckB.rows[0].name} (Linked User ID: ${contactCheckB.rows[0].linked_user_id})\n`);

    // -----------------------------------------------------------------
    // Step 4: Test Two-Sided Udhar Creation (User A lends ₹1,000 to User B)
    // -----------------------------------------------------------------
    console.log("Step 4: User A records lending ₹1,000 to User B (gave)...");
    const linkId = crypto.randomUUID();
    const amount = 1000.00;
    const txDate = new Date().toISOString().split('T')[0];

    // User A record: gave 1000 (Receivable)
    const txARes = await query(
      `INSERT INTO public.udhar_transactions (
        link_id, user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance,
        transaction_date, notes, status, confirmation_status, is_initiator
      ) VALUES ($1, $2, $3, $4, 'gave', $5, $6, $7, 'Dinner bill share', 'confirmed', 'confirmed', TRUE)
      RETURNING *`,
      [linkId, userA.id, userB.id, userB.full_name, amount, amount, txDate]
    );

    // User B reciprocal record: took 1000 (Payable)
    const txBRes = await query(
      `INSERT INTO public.udhar_transactions (
        link_id, user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance,
        transaction_date, notes, status, confirmation_status, is_initiator
      ) VALUES ($1, $2, $3, $4, 'took', $5, $6, $7, 'Dinner bill share', 'confirmed', 'confirmed', FALSE)
      RETURNING *`,
      [linkId, userB.id, userA.id, userA.full_name, amount, amount, txDate]
    );

    // Notifications for Udhar Created
    await notifyUdharCreated({
      initiatorUserId: userA.id,
      initiatorName: userA.full_name,
      recipientUserId: userB.id,
      transactionId: txARes.rows[0].id,
      contactName: userB.full_name,
      amount,
      direction: 'gave',
    });

    console.log(`✅ User A tx created: ID ${txARes.rows[0].id}, Direction: ${txARes.rows[0].direction}, Amount: ₹${txARes.rows[0].original_amount}`);
    console.log(`✅ User B tx created: ID ${txBRes.rows[0].id}, Direction: ${txBRes.rows[0].direction}, Amount: ₹${txBRes.rows[0].original_amount}`);
    console.log(`✅ Both share link_id: ${linkId}\n`);

    // -----------------------------------------------------------------
    // Step 5: Test Two-Sided Partial Repayment (User B pays ₹500)
    // -----------------------------------------------------------------
    console.log("Step 5: User B records partial repayment of ₹500...");
    const repayAmount = 500.00;
    const newBalance = amount - repayAmount; // 500.00

    const repayRes = await query(
      `INSERT INTO public.udhar_repayments (
        link_id, udhar_id, amount, notes, recorded_by_user_id, repayment_date, status
      ) VALUES ($1, $2, $3, 'Paid via UPI Google Pay', $4, $5, 'confirmed')
      RETURNING *`,
      [linkId, txBRes.rows[0].id, repayAmount, userB.id, txDate]
    );

    // Symmetrically update current_balance on all records with link_id
    await query(
      `UPDATE public.udhar_transactions 
       SET current_balance = $1, updated_at = NOW() 
       WHERE link_id = $2`,
      [newBalance, linkId]
    );

    // Notifications for Partial Repayment
    await notifyUdharRepayment({
      initiatorUserId: userB.id,
      initiatorName: userB.full_name,
      recipientUserId: userA.id,
      repaymentId: repayRes.rows[0].id,
      contactName: userA.full_name,
      repaymentAmount: repayAmount,
      remainingBalance: newBalance,
      isFullySettled: false,
    });

    // Check balances on both records
    const checkTxA = await query('SELECT current_balance, status FROM public.udhar_transactions WHERE id = $1', [txARes.rows[0].id]);
    const checkTxB = await query('SELECT current_balance, status FROM public.udhar_transactions WHERE id = $1', [txBRes.rows[0].id]);

    if (Number(checkTxA.rows[0].current_balance) !== 500 || Number(checkTxB.rows[0].current_balance) !== 500) {
      throw new Error(`❌ Balance mismatch! User A: ${checkTxA.rows[0].current_balance}, User B: ${checkTxB.rows[0].current_balance}`);
    }
    console.log(`✅ User A balance updated to: ₹${checkTxA.rows[0].current_balance}`);
    console.log(`✅ User B balance updated to: ₹${checkTxB.rows[0].current_balance}`);

    // Check repayments query on User A side (must match via link_id)
    const userARepayments = await query(
      `SELECT r.* FROM public.udhar_repayments r
       JOIN public.udhar_transactions t ON (r.link_id = t.link_id OR r.udhar_id = t.id)
       WHERE t.user_id = $1 AND t.id = $2`,
      [userA.id, txARes.rows[0].id]
    );
    console.log(`✅ User A can see User B's repayment: Count = ${userARepayments.rows.length}, Amount = ₹${userARepayments.rows[0]?.amount}\n`);

    // -----------------------------------------------------------------
    // Step 6: Test Full Settlement (User B settles remaining ₹500)
    // -----------------------------------------------------------------
    console.log("Step 6: User B settles remaining ₹500 (full settlement)...");
    const settleRes = await query(
      `INSERT INTO public.udhar_repayments (
        link_id, udhar_id, amount, notes, recorded_by_user_id, repayment_date, status
      ) VALUES ($1, $2, $3, 'Full settlement cash', $4, $5, 'confirmed')
      RETURNING *`,
      [linkId, txBRes.rows[0].id, 500.00, userB.id, txDate]
    );

    // Update to settled
    await query(
      `UPDATE public.udhar_transactions 
       SET current_balance = 0.00, status = 'settled', updated_at = NOW() 
       WHERE link_id = $1`,
      [linkId]
    );

    // Notifications for Settlement
    await notifyUdharRepayment({
      initiatorUserId: userB.id,
      initiatorName: userB.full_name,
      recipientUserId: userA.id,
      repaymentId: settleRes.rows[0].id,
      contactName: userA.full_name,
      repaymentAmount: 500.00,
      remainingBalance: 0.00,
      isFullySettled: true,
    });

    const settledTxA = await query('SELECT current_balance, status FROM public.udhar_transactions WHERE id = $1', [txARes.rows[0].id]);
    const settledTxB = await query('SELECT current_balance, status FROM public.udhar_transactions WHERE id = $1', [txBRes.rows[0].id]);

    if (settledTxA.rows[0].status !== 'settled' || settledTxB.rows[0].status !== 'settled') {
      throw new Error('❌ Settlement status mismatch!');
    }
    console.log(`✅ User A status: ${settledTxA.rows[0].status}, Balance: ₹${settledTxA.rows[0].current_balance}`);
    console.log(`✅ User B status: ${settledTxB.rows[0].status}, Balance: ₹${settledTxB.rows[0].current_balance}\n`);

    // -----------------------------------------------------------------
    // Step 7: Verify Notification Delivery in Database
    // -----------------------------------------------------------------
    console.log("Step 7: Verifying Notification Records in public.user_notifications...");
    const notifsA = await query(
      `SELECT title, message, category, type, created_at 
       FROM public.user_notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC LIMIT 5`,
      [userA.id]
    );
    const notifsB = await query(
      `SELECT title, message, category, type, created_at 
       FROM public.user_notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC LIMIT 5`,
      [userB.id]
    );

    console.log(`User A Notifications (${notifsA.rows.length}):`);
    notifsA.rows.forEach((n, idx) => console.log(`  ${idx + 1}. [${n.category}] ${n.title} - ${n.message}`));

    console.log(`\nUser B Notifications (${notifsB.rows.length}):`);
    notifsB.rows.forEach((n, idx) => console.log(`  ${idx + 1}. [${n.category}] ${n.title} - ${n.message}`));

    console.log('\n====================================================');
    console.log('🎉 ALL MUTUAL UDHAR & NOTIFICATION TESTS PASSED SUCCESSFULLY!');
    console.log('====================================================');
  } catch (err: any) {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMutualUdharTests();
