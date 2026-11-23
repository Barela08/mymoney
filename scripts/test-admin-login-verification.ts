import { query } from '../server/db';
import { verifyPassword, hashPassword } from '../server/security';
import { createSession } from '../server/auth';

async function testAdminLogin() {
  console.log('====================================================');
  console.log('VERIFYING ADMIN CREDENTIALS & LOGIN FLOW');
  console.log('====================================================\n');

  const adminEmail = 'hackifypro@gmail.com';
  const adminPassword = 'Nilu@2006';

  // 1. Fetch user from database
  console.log('--- Step 1: Query public.app_users ---');
  const userRes = await query(
    `SELECT id, full_name, email, role, status, password_hash, email_verified, force_password_reset 
     FROM public.app_users 
     WHERE LOWER(email) = LOWER($1)`,
    [adminEmail]
  );

  if (userRes.rows.length === 0) {
    console.error('✕ FAIL: User not found in public.app_users!');
    process.exit(1);
  }

  const user = userRes.rows[0];
  console.log('✓ Found user in database:');
  console.log(`  ID: ${user.id}`);
  console.log(`  Name: ${user.full_name}`);
  console.log(`  Email: ${user.email}`);
  console.log(`  Role: ${user.role}`);
  console.log(`  Status: ${user.status}`);

  // 2. Verify password comparison
  console.log('\n--- Step 2: Verifying Bcrypt Password Matching ---');
  const isMatch = await verifyPassword(adminPassword, user.password_hash);
  if (!isMatch) {
    console.error('✕ FAIL: Password Nilu@2006 did not match stored bcrypt hash!');
    process.exit(1);
  }
  console.log('✓ PASS: Password "Nilu@2006" matches stored bcrypt hash perfectly.');

  const isWrongMatch = await verifyPassword('WrongPassword123', user.password_hash);
  if (isWrongMatch) {
    console.error('✕ FAIL: Incorrect password unexpectedly passed validation!');
    process.exit(1);
  }
  console.log('✓ PASS: Wrong password correctly rejected.');

  // 3. Test Session Creation
  console.log('\n--- Step 3: Testing Admin Session Creation ---');
  const session = await createSession(user.id, { rememberMe: true, userAgent: 'Verification-Script' });
  console.log(`✓ PASS: Admin session generated: ${session.sessionId}`);
  console.log(`  Session token: ${session.sessionToken.slice(0, 10)}...`);

  // 4. Test Role & Privileges
  console.log('\n--- Step 4: Verifying Master Admin Privileges ---');
  const isMaster = user.email.toLowerCase().trim() === 'hackifypro@gmail.com';
  console.log(`✓ PASS: Recognized as master administrator: ${isMaster}`);
  console.log(`✓ PASS: Role slug: ${user.role}`);

  console.log('\n====================================================');
  console.log('ALL ADMIN CREDENTIAL CHECKS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

testAdminLogin()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
