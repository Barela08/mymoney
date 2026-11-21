import { query } from '../server/db';

async function testRegistrationE2E() {
  console.log('================================================================');
  console.log('STARTING REGISTRATION -> WELCOME EMAIL AUTOMATION E2E TEST');
  console.log('================================================================\n');

  const timestamp = Date.now();
  const testEmail = `nilesh_auto_${timestamp}@mymoney-test.com`;
  const validPassword = `SecPass@2026!Master#`;

  // 1. TEST FAILED REGISTRATION DOES NOT SEND WELCOME EMAIL
  console.log('--- 1. Testing Failed Registration (Short Password) ---');
  const failRes = await fetch('http://localhost:5173/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Nilesh Fail',
      email: testEmail,
      password: 'short',
      confirmPassword: 'short',
    }),
  });

  const failData = await failRes.json();
  console.log('Failed Registration Status:', failRes.status, failData.message);
  if (failRes.status === 400) {
    console.log('✅ [PASS] Invalid registration was rejected by backend');
  } else {
    console.error('❌ [FAIL] Expected 400 for short password');
    process.exit(1);
  }

  // Check no email log created for testEmail
  const checkLogAfterFail = await query(
    'SELECT * FROM public.email_dispatch_logs WHERE LOWER(email) = LOWER($1)',
    [testEmail]
  );
  if (checkLogAfterFail.rows.length === 0) {
    console.log('✅ [PASS] No welcome email sent for failed registration');
  } else {
    console.error('❌ [FAIL] Welcome email was improperly dispatched for failed registration');
    process.exit(1);
  }

  // 2. TEST SUCCESSFUL REGISTRATION TRIGGERS AUTOMATIC WELCOME EMAIL
  console.log('\n--- 2. Testing Successful Registration ---');
  const regRes = await fetch('http://localhost:5173/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Nilesh Barela',
      email: testEmail,
      password: validPassword,
      confirmPassword: validPassword,
    }),
  });

  const regData = await regRes.json();
  console.log('Registration Status:', regRes.status, regData.message);
  if (regRes.status === 201 && regData.success) {
    console.log('✅ [PASS] User account successfully created in backend');
    console.log('   User ID:', regData.user?.id);
    console.log('   User Name:', regData.user?.displayName || regData.user?.full_name);
  } else {
    console.error('❌ [FAIL] Account creation failed:', regData);
    process.exit(1);
  }

  // Wait a moment for background email dispatch
  console.log('Waiting 2 seconds for background email dispatch & log recording...');
  await new Promise((r) => setTimeout(r, 2000));

  // 3. VERIFY EMAIL DISPATCH LOG
  console.log('\n--- 3. Verifying Email Delivery Record in Database ---');
  const logRes = await query(
    `SELECT id, user_id, email, email_type, idempotency_key, recipient_name, subject, status, attempts, sent_at
     FROM public.email_dispatch_logs 
     WHERE LOWER(email) = LOWER($1)`,
    [testEmail]
  );

  if (logRes.rows.length > 0) {
    const log = logRes.rows[0];
    console.log('✅ [PASS] Welcome email dispatch record found in database');
    console.log('   Email Log ID:', log.id);
    console.log('   Status:', log.status);
    console.log('   Recipient Name (Trusted):', log.recipient_name);
    console.log('   Subject:', log.subject);
    console.log('   Attempts:', log.attempts);
    console.log('   Idempotency Key:', log.idempotency_key);
    console.log('   Sent At:', log.sent_at);

    if (log.status === 'sent' || log.status === 'pending') {
      console.log('✅ [PASS] Email status correctly tracked as sent or pending');
    } else {
      console.warn('⚠️ Notice: Email status is:', log.status);
    }
  } else {
    console.error('❌ [FAIL] No email dispatch log found for user');
    process.exit(1);
  }

  // 4. TEST IDEMPOTENCY ON DUPLICATE TRIGGER
  console.log('\n--- 4. Testing Idempotency (Prevent Duplicate Welcome Email) ---');
  // Attempt to trigger duplicate registration
  const dupRes = await fetch('http://localhost:5173/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Nilesh Barela',
      email: testEmail,
      password: validPassword,
      confirmPassword: validPassword,
    }),
  });

  const dupData = await dupRes.json();
  console.log('Duplicate Registration Status:', dupRes.status, dupData.message);
  if (dupRes.status === 409) {
    console.log('✅ [PASS] Duplicate registration rejected with 409 Conflict');
  }

  // Check logs count - should still be exactly 1
  const logCount = await query(
    'SELECT COUNT(*) as count FROM public.email_dispatch_logs WHERE LOWER(email) = LOWER($1)',
    [testEmail]
  );
  const count = parseInt(logCount.rows[0].count, 10);
  if (count === 1) {
    console.log('✅ [PASS] Exactly 1 welcome email log exists, duplicate avoided!');
  } else {
    console.error(`❌ [FAIL] Expected 1 log, found ${count}`);
    process.exit(1);
  }

  console.log('\n================================================================');
  console.log('ALL REGISTRATION & EMAIL AUTOMATION E2E TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
}

testRegistrationE2E()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('E2E Test Failed:', e);
    process.exit(1);
  });
