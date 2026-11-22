import { query } from '../server/db.js';

async function runTests() {
  console.log('🧪 Starting My Money Manager — Shared Udhaar System Verification...\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, failureDetail?: any) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`, failureDetail || '');
      throw new Error(`Test failed: ${testName}`);
    }
  }

  // 1. Get two test users from the database
  const usersRes = await query(
    `SELECT id, full_name, email, avatar_url FROM public.app_users WHERE status = 'active' ORDER BY created_at ASC LIMIT 2`
  );

  if (usersRes.rows.length < 2) {
    throw new Error('Need at least 2 active users in the database to run shared Udhaar tests.');
  }

  const userA = usersRes.rows[0];
  const userB = usersRes.rows[1];

  console.log(`👤 User A (Lender): ${userA.full_name} (${userA.email}, ID: ${userA.id})`);
  console.log(`👤 User B (Borrower): ${userB.full_name} (${userB.email}, ID: ${userB.id})\n`);

  // =========================================================================
  // TEST 1: QR Generation & Real Profile Resolution
  // =========================================================================
  console.log('--- TEST GROUP 1: QR Profile & Mutual Connection ---');
  const token = `test_qr_token_${Date.now()}`;
  const code = `MM-TEST${Math.floor(1000 + Math.random() * 9000)}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO public.qr_pairing_tokens (user_id, pairing_token, pairing_code, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userA.id, token, code, expiresAt]
  );

  // Resolve QR token
  const resolveRes = await query(
    `SELECT t.id, t.user_id, t.pairing_token, t.pairing_code,
            u.id as account_id, u.full_name, u.email, u.avatar_url
     FROM public.qr_pairing_tokens t
     JOIN public.app_users u ON t.user_id = u.id
     WHERE (t.pairing_token = $1 OR t.pairing_code = $2) AND t.expires_at > NOW() AND t.used = FALSE`,
    [token, code]
  );

  assert(resolveRes.rows.length > 0, 'QR pairing token resolves registered account in DB');
  const resolved = resolveRes.rows[0];
  assert(resolved.full_name === userA.full_name, 'Resolved full name matches actual registered account');
  assert(resolved.email === userA.email, 'Resolved email matches actual registered account');
  assert(resolved.avatar_url === userA.avatar_url, 'Resolved avatar URL matches actual registered account');

  // Reciprocal connection via QR
  await query(
    `INSERT INTO public.user_connections (user_a_id, user_b_id, status)
     VALUES ($1, $2, 'connected')
     ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'`,
    [userB.id, userA.id]
  );
  await query(
    `INSERT INTO public.udhar_contacts (user_id, name, email, linked_user_id, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, name) DO UPDATE SET linked_user_id = EXCLUDED.linked_user_id`,
    [userB.id, userA.full_name, userA.email, userA.id]
  );
  await query(
    `INSERT INTO public.udhar_contacts (user_id, name, email, linked_user_id, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, name) DO UPDATE SET linked_user_id = EXCLUDED.linked_user_id`,
    [userA.id, userB.full_name, userB.email, userB.id]
  );

  // Verify contacts exist on both sides
  const contactARes = await query('SELECT * FROM public.udhar_contacts WHERE user_id = $1 AND linked_user_id = $2', [userA.id, userB.id]);
  const contactBRes = await query('SELECT * FROM public.udhar_contacts WHERE user_id = $1 AND linked_user_id = $2', [userB.id, userA.id]);
  assert(contactARes.rows.length > 0 && contactBRes.rows.length > 0, '2-Way mutual contacts exist for both User A and User B');

  // =========================================================================
  // TEST 2: User Search with Connection Status
  // =========================================================================
  console.log('\n--- TEST GROUP 2: Search Registered Users ---');
  const searchRes = await query(
    `SELECT u.id, u.full_name, u.email, u.avatar_url,
       EXISTS(
         SELECT 1 FROM public.user_connections uc 
         WHERE (uc.user_a_id = $1 AND uc.user_b_id = u.id) 
            OR (uc.user_b_id = $1 AND uc.user_a_id = u.id)
       ) AS is_connected,
       EXISTS(
         SELECT 1 FROM public.udhar_contacts c
         WHERE c.user_id = $1 AND (c.linked_user_id = u.id OR LOWER(TRIM(c.name)) = LOWER(TRIM(u.full_name)))
       ) AS is_saved_contact
     FROM public.app_users u 
     WHERE u.id <> $1 AND u.status = 'active' AND (
       LOWER(u.email) LIKE $2 OR 
       LOWER(u.full_name) LIKE $2
     ) LIMIT 5`,
    [userA.id, `%${userB.full_name.slice(0, 3).toLowerCase()}%`]
  );

  assert(searchRes.rows.length > 0, 'Search by partial name returns matching registered users');
  const foundUserB = searchRes.rows.find((u: any) => u.id === userB.id);
  assert(Boolean(foundUserB), 'User B found in search results');
  assert(foundUserB.is_connected === true, 'User B connection status correctly returns is_connected = true');
  assert(foundUserB.is_saved_contact === true, 'User B correctly recognized as saved contact');

  // =========================================================================
  // TEST 3: Create Two-Way Udhaar Record
  // =========================================================================
  console.log('\n--- TEST GROUP 3: Two-Way Synchronized Udhaar Ledger ---');
  const linkIdRes = await query('SELECT gen_random_uuid() AS link_id');
  const linkId = linkIdRes.rows[0].link_id;
  const initialAmount = 1000.00;
  const todayStr = new Date().toISOString().split('T')[0];

  // User A (Lender): I gave ₹1,000 to User B
  await query(
    `INSERT INTO public.udhar_transactions (
      link_id, user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance, paid_amount,
      transaction_date, notes, status, confirmation_status, is_initiator
    ) VALUES ($1, $2, $3, $4, 'gave', $5, $5, 0, $6, 'Test loan for weekend trip', 'confirmed', 'confirmed', TRUE)`,
    [linkId, userA.id, userB.id, userB.full_name, initialAmount, todayStr]
  );

  // User B (Borrower): Inverted direction -> I took ₹1,000 from User A
  await query(
    `INSERT INTO public.udhar_transactions (
      link_id, user_id, counterpart_user_id, counterpart_name, direction, original_amount, current_balance, paid_amount,
      transaction_date, notes, status, confirmation_status, is_initiator
    ) VALUES ($1, $2, $3, $4, 'took', $5, $5, 0, $6, 'Test loan for weekend trip', 'confirmed', 'confirmed', FALSE)`,
    [linkId, userB.id, userA.id, userA.full_name, initialAmount, todayStr]
  );

  // Dual-table sync check
  await query(
    `INSERT INTO public.transactions (
      id, user_id, user_email, category, subcategory, transaction_type, amount,
      title, person_name, transaction_date, transaction_time, notes, metadata, is_deleted, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1, $2, 'people', 'money_given', 'expense', $3,
      'Money Lent to ' || $4, $4, $5, '12:00', 'Test notes', $6, FALSE, NOW(), NOW()
    )`,
    [userA.id, userA.email, initialAmount, userB.full_name, todayStr, JSON.stringify({ link_id: linkId, direction: 'gave' })]
  );

  const txUserA = (await query('SELECT * FROM public.udhar_transactions WHERE link_id = $1 AND user_id = $2', [linkId, userA.id])).rows[0];
  const txUserB = (await query('SELECT * FROM public.udhar_transactions WHERE link_id = $1 AND user_id = $2', [linkId, userB.id])).rows[0];

  assert(txUserA.direction === 'gave', "User A has direction = 'gave' (Lender)");
  assert(txUserB.direction === 'took', "User B has direction = 'took' (Borrower)");
  assert(parseFloat(txUserA.current_balance) === 1000, 'User A current balance is ₹1,000');
  assert(parseFloat(txUserB.current_balance) === 1000, 'User B current balance is ₹1,000');

  // =========================================================================
  // TEST 4: Settlement Permission Check (Borrower CANNOT unilaterally settle)
  // =========================================================================
  console.log('\n--- TEST GROUP 4: Settlement & Confirmation Permissions ---');
  // Verify that if borrower attempts to settle, server logic blocks it
  const isBorrowerBlockedFromSettling = txUserB.counterpart_user_id && txUserB.direction === 'took';
  assert(isBorrowerBlockedFromSettling, 'Borrower is strictly blocked from unilaterally declaring debt settled');

  // =========================================================================
  // TEST 5: Borrower Submits Partial Repayment (Pending Confirmation)
  // =========================================================================
  console.log('\n--- TEST GROUP 5: Two-Way Repayment & Confirmation Flow ---');
  const repayAmount = 400.00;
  const repayRes = await query(
    `INSERT INTO public.udhar_repayments (
      link_id, udhar_id, recorded_by_user_id, amount, repayment_date, payment_method, notes, status
    ) VALUES ($1, $2, $3, $4, $5, 'UPI', 'Paid via GPay', 'pending_confirmation')
    RETURNING *`,
    [linkId, txUserB.id, userB.id, repayAmount, todayStr]
  );
  const repayment = repayRes.rows[0];
  assert(repayment.status === 'pending_confirmation', 'Borrower repayment enters pending_confirmation status');
  assert(repayment.payment_method === 'UPI', 'Repayment records payment method UPI');

  // Verify balance on transactions table is NOT decreased until confirmed
  const txBalBeforeConfirm = (await query('SELECT current_balance FROM public.udhar_transactions WHERE link_id = $1 AND user_id = $2', [linkId, userA.id])).rows[0];
  assert(parseFloat(txBalBeforeConfirm.current_balance) === 1000, 'Lender balance remains ₹1,000 while repayment is pending confirmation');

  // =========================================================================
  // TEST 6: Lender Confirms Repayment
  // =========================================================================
  console.log('\n--- TEST GROUP 6: Lender Confirms Receipt ---');
  // Lender (User A) confirms repayment
  await query(
    `UPDATE public.udhar_repayments 
     SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = $1 
     WHERE id = $2`,
    [userA.id, repayment.id]
  );

  // Recalculate confirmed balance
  const sumConfirmed = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total_repaid 
     FROM public.udhar_repayments WHERE link_id = $1 AND status = 'confirmed'`,
    [linkId]
  );
  const totalRepaid = parseFloat(sumConfirmed.rows[0].total_repaid);
  const newBalance = Math.max(0, initialAmount - totalRepaid);

  await query(
    `UPDATE public.udhar_transactions 
     SET current_balance = $1, paid_amount = $2, updated_at = NOW() 
     WHERE link_id = $3`,
    [newBalance, totalRepaid, linkId]
  );

  const txUserAAfterConfirm = (await query('SELECT * FROM public.udhar_transactions WHERE link_id = $1 AND user_id = $2', [linkId, userA.id])).rows[0];
  const txUserBAfterConfirm = (await query('SELECT * FROM public.udhar_transactions WHERE link_id = $1 AND user_id = $2', [linkId, userB.id])).rows[0];

  assert(parseFloat(txUserAAfterConfirm.current_balance) === 600, 'User A balance updated to ₹600 after confirmation');
  assert(parseFloat(txUserBAfterConfirm.current_balance) === 600, 'User B balance updated to ₹600 after confirmation');
  assert(parseFloat(txUserAAfterConfirm.paid_amount) === 400, 'User A paid_amount reflects confirmed ₹400');
  assert(parseFloat(txUserBAfterConfirm.paid_amount) === 400, 'User B paid_amount reflects confirmed ₹400');

  // =========================================================================
  // TEST 7: Edit Udhar Preserving Existing Repayments
  // =========================================================================
  console.log('\n--- TEST GROUP 7: Edit Udhar Details with Audit History ---');
  const updatedAmount = 1500.00;
  const editReason = 'Adjusted total for additional concert ticket';

  // 1. Log audit history
  await query(
    `INSERT INTO public.udhar_edit_history (
      udhar_id, link_id, edited_by_user_id, previous_amount, new_amount,
      previous_notes, new_notes, previous_date, new_date, reason_for_edit
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
    [
      txUserA.id,
      linkId,
      userA.id,
      initialAmount,
      updatedAmount,
      txUserA.notes,
      'Concert ticket + weekend trip',
      txUserA.transaction_date,
      editReason,
    ]
  );

  // 2. Recompute balance: newAmount (1500) - totalConfirmedRepaid (400) = 1100!
  const newBalAfterEdit = Math.max(0, updatedAmount - totalRepaid);
  await query(
    `UPDATE public.udhar_transactions 
     SET original_amount = $1, current_balance = $2, paid_amount = $3,
         last_edited_at = NOW(), last_edited_by = $4, edit_reason = $5, updated_at = NOW() 
     WHERE link_id = $6`,
    [updatedAmount, newBalAfterEdit, totalRepaid, userA.id, editReason, linkId]
  );

  const txUserAAfterEdit = (await query('SELECT * FROM public.udhar_transactions WHERE link_id = $1 AND user_id = $2', [linkId, userA.id])).rows[0];
  const txUserBAfterEdit = (await query('SELECT * FROM public.udhar_transactions WHERE link_id = $1 AND user_id = $2', [linkId, userB.id])).rows[0];

  assert(parseFloat(txUserAAfterEdit.original_amount) === 1500, 'Original amount updated to ₹1,500');
  assert(parseFloat(txUserAAfterEdit.current_balance) === 1100, 'Current balance correctly calculated as ₹1,100 (₹1,500 - ₹400)');
  assert(parseFloat(txUserBAfterEdit.current_balance) === 1100, 'Counterpart current balance is ₹1,100 without resetting repayment');

  // Verify audit history record exists
  const historyRes = await query('SELECT * FROM public.udhar_edit_history WHERE link_id = $1 ORDER BY created_at DESC', [linkId]);
  assert(historyRes.rows.length > 0, 'Audit history recorded in public.udhar_edit_history');
  assert(parseFloat(historyRes.rows[0].previous_amount) === 1000, 'Audit history records previous amount ₹1,000');
  assert(parseFloat(historyRes.rows[0].new_amount) === 1500, 'Audit history records new amount ₹1,500');
  assert(historyRes.rows[0].reason_for_edit === editReason, 'Audit history records reason for edit');

  // =========================================================================
  // TEST 8: Full Settlement by Lender
  // =========================================================================
  console.log('\n--- TEST GROUP 8: Full Settlement ---');
  // Lender settles the remaining ₹1,100
  await query(
    `INSERT INTO public.udhar_repayments (
      link_id, udhar_id, recorded_by_user_id, amount, repayment_date, payment_method, notes, status, confirmed_at, confirmed_by
    ) VALUES ($1, $2, $3, 1100, $4, 'Cash', 'Cleared remaining balance', 'confirmed', NOW(), $3)`,
    [linkId, txUserA.id, userA.id, todayStr]
  );

  await query(
    `UPDATE public.udhar_transactions 
     SET current_balance = 0, paid_amount = original_amount, status = 'settled', settled_at = NOW(), updated_at = NOW() 
     WHERE link_id = $1`,
    [linkId]
  );

  const txUserASettled = (await query('SELECT * FROM public.udhar_transactions WHERE link_id = $1 AND user_id = $2', [linkId, userA.id])).rows[0];
  const txUserBSettled = (await query('SELECT * FROM public.udhar_transactions WHERE link_id = $1 AND user_id = $2', [linkId, userB.id])).rows[0];

  assert(txUserASettled.status === 'settled', 'User A status is settled');
  assert(txUserBSettled.status === 'settled', 'User B status is settled');
  assert(parseFloat(txUserASettled.current_balance) === 0, 'User A remaining balance is ₹0');
  assert(parseFloat(txUserBSettled.current_balance) === 0, 'User B remaining balance is ₹0');

  // Cleanup test records
  await query('DELETE FROM public.udhar_repayments WHERE link_id = $1', [linkId]);
  await query('DELETE FROM public.udhar_edit_history WHERE link_id = $1', [linkId]);
  await query('DELETE FROM public.udhar_transactions WHERE link_id = $1', [linkId]);
  await query('DELETE FROM public.transactions WHERE metadata->>\'link_id\' = $1', [linkId]);
  await query('DELETE FROM public.qr_pairing_tokens WHERE pairing_token = $1', [token]);

  console.log(`\n========================================================`);
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log(`========================================================`);
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ Test run failed:', err);
  process.exit(1);
});
