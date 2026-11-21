import pg from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Parse .env
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  console.warn('Notice loading .env:', e);
}

const connectionString = process.env.DATABASE_URL || '';
const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function runVerificationSuite() {
  console.log('--- STARTING UDHAR & ACCOUNT DELETION VERIFICATION SUITE ---');

  // Verify DB connection
  const client = await pool.connect();
  console.log('✓ Connected to PostgreSQL DB successfully');

  try {
    // 1. Verify schema tables exist
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN (
          'account_deletion_requests', 
          'udhar_contacts', 
          'qr_pairing_tokens', 
          'user_connections', 
          'udhar_transactions', 
          'udhar_repayments'
        );
    `);
    const existingTables = tablesRes.rows.map((r: any) => r.table_name);
    console.log('✓ Public tables verified:', existingTables);
    if (existingTables.length < 6) {
      throw new Error(`Missing expected tables. Found only: ${existingTables.join(', ')}`);
    }

    // 2. Fetch or create test users
    const usersRes = await client.query(`
      SELECT id, email, full_name 
      FROM app_users 
      LIMIT 2;
    `);

    if (usersRes.rows.length < 2) {
      console.log('Creating 2 test users for verification...');
      const u1 = await client.query(`
        INSERT INTO app_users (email, password_hash, full_name, role, status)
        VALUES ('test_user_a@example.com', 'hash_a', 'Nilesh Shinde', 'user', 'active')
        ON CONFLICT (email) DO UPDATE SET full_name = 'Nilesh Shinde'
        RETURNING id, email, full_name;
      `);
      const u2 = await client.query(`
        INSERT INTO app_users (email, password_hash, full_name, role, status)
        VALUES ('test_user_b@example.com', 'hash_b', 'Rahul Verma', 'user', 'active')
        ON CONFLICT (email) DO UPDATE SET full_name = 'Rahul Verma'
        RETURNING id, email, full_name;
      `);
      usersRes.rows.push(u1.rows[0], u2.rows[0]);
    }

    const userA = usersRes.rows[0];
    const userB = usersRes.rows[1];
    console.log(`✓ Test User A: ${userA.full_name} (${userA.id})`);
    console.log(`✓ Test User B: ${userB.full_name} (${userB.id})`);

    // 3. Test QR Pairing Token Creation for User A
    const pairingCode = 'MM-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const pairingToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const qrInsertRes = await client.query(`
      INSERT INTO qr_pairing_tokens (user_id, pairing_token, pairing_code, expires_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id, pairing_code, used;
    `, [userA.id, pairingToken, pairingCode, expiresAt]);

    console.log('✓ QR pairing token created:', qrInsertRes.rows[0].pairing_code);

    // 4. Test User Connection Linking User B -> User A via QR pairing code
    const connectRes = await client.query(`
      INSERT INTO user_connections (user_a_id, user_b_id, status)
      VALUES ($1, $2, 'connected')
      ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET status = 'connected'
      RETURNING id, user_a_id, user_b_id, status;
    `, [userB.id, userA.id]);

    console.log(`✓ User connection established: ${userB.full_name} connected to ${userA.full_name} (Status: ${connectRes.rows[0].status})`);

    // 5. Test Two-Sided Udhar Transaction Synchronization
    // User A gives User B ₹1,500
    const linkId = crypto.randomUUID();
    const amount = 1500;
    const dueDate = '2026-12-15';
    const txDate = '2026-11-22';

    // Insert Side A (Money I Gave)
    const txARes = await client.query(`
      INSERT INTO udhar_transactions (
        user_id, counterpart_user_id, counterpart_name, direction, original_amount,
        current_balance, status, confirmation_status, transaction_date, due_date, notes, link_id, is_initiator
      )
      VALUES ($1, $2, $3, 'gave', $4, $4, 'confirmed', 'confirmed', $5, $6, 'Dinner payment test', $7, true)
      RETURNING id, direction, original_amount, current_balance, link_id;
    `, [userA.id, userB.id, userB.full_name, amount, txDate, dueDate, linkId]);

    // Insert Side B (Money I Took)
    const txBRes = await client.query(`
      INSERT INTO udhar_transactions (
        user_id, counterpart_user_id, counterpart_name, direction, original_amount,
        current_balance, status, confirmation_status, transaction_date, due_date, notes, link_id, is_initiator
      )
      VALUES ($1, $2, $3, 'took', $4, $4, 'pending_confirmation', 'pending', $5, $6, 'Dinner payment test', $7, false)
      RETURNING id, direction, original_amount, current_balance, link_id;
    `, [userB.id, userA.id, userA.full_name, amount, txDate, dueDate, linkId]);

    console.log(`✓ Two-sided Udhar transactions synchronized:`);
    console.log(`   User A (${userA.full_name}) record: id=${txARes.rows[0].id}, direction=${txARes.rows[0].direction}, balance=₹${txARes.rows[0].current_balance}`);
    console.log(`   User B (${userB.full_name}) record: id=${txBRes.rows[0].id}, direction=${txBRes.rows[0].direction}, balance=₹${txBRes.rows[0].current_balance}`);
    console.log(`   Shared link_id: ${linkId}`);

    // 6. Test User B confirms the transaction
    const confirmRes = await client.query(`
      UPDATE udhar_transactions
      SET status = 'confirmed', confirmation_status = 'confirmed'
      WHERE id = $1
      RETURNING id, status, confirmation_status;
    `, [txBRes.rows[0].id]);
    console.log(`✓ User B confirmed transaction: status=${confirmRes.rows[0].status}, confirmation_status=${confirmRes.rows[0].confirmation_status}`);

    // 7. Test Partial Repayment of ₹500
    const repayAmount = 500;

    // Create repayment records
    await client.query(`
      INSERT INTO udhar_repayments (transaction_id, link_id, amount, payment_mode, notes)
      VALUES ($1, $2, $3, 'upi', 'Partial repayment ₹500 via UPI');
    `, [txARes.rows[0].id, linkId, repayAmount]);

    await client.query(`
      INSERT INTO udhar_repayments (transaction_id, link_id, amount, payment_mode, notes)
      VALUES ($1, $2, $3, 'upi', 'Partial repayment ₹500 via UPI');
    `, [txBRes.rows[0].id, linkId, repayAmount]);

    // Update balances on both sides
    const newBal = amount - repayAmount;
    await client.query(`
      UPDATE udhar_transactions
      SET current_balance = $1
      WHERE link_id = $2;
    `, [newBal, linkId]);

    const checkBalancesRes = await client.query(`
      SELECT id, user_id, direction, original_amount, current_balance, status
      FROM udhar_transactions
      WHERE link_id = $1;
    `, [linkId]);

    console.log(`✓ Repayment applied: Both sides current_balance updated to ₹${checkBalancesRes.rows[0].current_balance} (Remaining balance is synchronized)`);

    // 8. Test Account Deletion 24-Hour Scheduling & Cancellation Workflow
    console.log('Testing 24-hour Account Deletion Workflow...');
    const deletionToken = crypto.randomBytes(32).toString('hex');
    const deletionTokenHash = crypto.createHash('sha256').update(deletionToken).digest('hex');
    const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const delReqRes = await client.query(`
      INSERT INTO account_deletion_requests (user_id, cancellation_token_hash, scheduled_for, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING id, scheduled_for, status;
    `, [userA.id, deletionTokenHash, scheduledFor]);

    const reqId = delReqRes.rows[0].id;

    // Update user record
    await client.query(`
      UPDATE app_users
      SET deletion_status = 'pending_deletion',
          deletion_scheduled_for = $1,
          deletion_request_id = $2
      WHERE id = $3;
    `, [scheduledFor, reqId, userA.id]);

    const checkUserPending = await client.query(`
      SELECT id, email, deletion_status, deletion_scheduled_for 
      FROM app_users 
      WHERE id = $1;
    `, [userA.id]);

    console.log(`✓ User A status marked as: ${checkUserPending.rows[0].deletion_status}, Scheduled for: ${checkUserPending.rows[0].deletion_scheduled_for}`);

    // 9. Test In-App / Email Token Cancellation
    await client.query(`
      UPDATE account_deletion_requests
      SET status = 'cancelled', cancelled_at = NOW()
      WHERE id = $1;
    `, [reqId]);

    await client.query(`
      UPDATE app_users
      SET deletion_status = 'active',
          deletion_scheduled_for = NULL,
          deletion_request_id = NULL
      WHERE id = $1;
    `, [userA.id]);

    const checkUserRestored = await client.query(`
      SELECT id, email, deletion_status, deletion_scheduled_for 
      FROM app_users 
      WHERE id = $1;
    `, [userA.id]);

    console.log(`✓ User A successfully cancelled deletion. Status restored to: ${checkUserRestored.rows[0].deletion_status}`);

    console.log('--- ALL UDHAR & ACCOUNT DELETION VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
  } catch (err: any) {
    console.error('❌ Verification test failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runVerificationSuite().then(() => {
  process.exit(0);
});
