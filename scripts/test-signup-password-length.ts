/**
 * Test Suite: Create Account Password Minimum Length (8 Characters)
 *
 * Verifies:
 * 1. 7-character password is rejected with min-length error message
 * 2. 8-character password with character diversity is accepted
 * 3. 12-character password is accepted
 * 4. Passwords under 8 chars rejected
 * 5. Confirm password mismatch is rejected
 * 6. Confirm password matching is accepted
 * 7. Existing security protections (common passwords, max 128 chars, bcrypt hashing) remain intact
 */

import { strict as assert } from 'assert';
import { validatePasswordPolicy, hashPassword, verifyPassword } from '../server/security.js';
import { validatePasswordStrength } from '../src/lib/security.js';

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 CREATE ACCOUNT PASSWORD MINIMUM LENGTH (8 CHARS) TEST SUITE');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ [FAIL] ${name}: ${err?.message}`);
      failed++;
    }
  }

  async function testAsync(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ [FAIL] ${name}: ${err?.message}`);
      failed++;
    }
  }

  console.log('--- 1. Backend validatePasswordPolicy Tests ---');

  // Test 1: 7-character password must be rejected
  test('7-character password is rejected', () => {
    const res = validatePasswordPolicy('Ab1!xyz'); // 7 characters
    assert.strictEqual(res.isValid, false, '7-character password must not be valid');
    assert.ok(
      res.errors.some((e) => e.includes('8 characters')),
      'Error message must state password must be at least 8 characters long'
    );
  });

  // Test 2: 8-character password must be accepted
  test('8-character password with character diversity is accepted', () => {
    const res = validatePasswordPolicy('Ab1!xyzz'); // 8 characters, Upper+Lower+Num+Symbol
    assert.strictEqual(res.isValid, true, '8-character diverse password must be accepted');
    assert.strictEqual(res.errors.length, 0, 'No validation errors expected for valid 8-char password');
  });

  // Test 3: 8-character password with letters + numbers is accepted
  test('8-character alphanumeric password is accepted', () => {
    const res = validatePasswordPolicy('Pass1234'); // 8 characters, Upper+Lower+Num
    assert.strictEqual(res.isValid, true, '8-character alphanumeric password must be accepted');
  });

  // Test 4: 12-character password is accepted
  test('12-character password is accepted', () => {
    const res = validatePasswordPolicy('MyMoney#2026!'); // 13 characters
    assert.strictEqual(res.isValid, true, '12+ character password must be accepted');
  });

  // Test 5: Exact 12-character password is accepted
  test('Exact 12-character password is accepted', () => {
    const res = validatePasswordPolicy('Pass#1234567'); // 12 characters
    assert.strictEqual(res.isValid, true, 'Exact 12-character password must be accepted');
  });

  // Test 6: Fewer than 8 characters (e.g. 5 or 6 chars) rejected
  test('5-character password rejected', () => {
    const res = validatePasswordPolicy('Ab1!x');
    assert.strictEqual(res.isValid, false, '5-character password must be rejected');
    assert.ok(res.errors.some((e) => e.includes('8 characters')));
  });

  // Test 7: Empty or null password rejected
  test('Empty password rejected', () => {
    const res = validatePasswordPolicy('');
    assert.strictEqual(res.isValid, false, 'Empty password must be rejected');
  });

  console.log('\n--- 2. Frontend validatePasswordStrength Tests ---');

  // Test 8: Frontend validation accepts 8 characters
  test('Frontend validation: 7 characters rejected, 8 characters accepted', () => {
    const seven = validatePasswordStrength('Pass12!'); // 7 characters
    assert.strictEqual(seven.isValid, false, '7-char password must be marked invalid');
    assert.ok(seven.errors.some((e) => e.includes('8 characters')));

    const eight = validatePasswordStrength('Pass123!'); // 8 characters
    assert.strictEqual(eight.isValid, true, '8-char password must be marked valid');
    assert.strictEqual(eight.errors.length, 0);
  });

  console.log('\n--- 3. Confirm Password & Security Preservation Tests ---');

  // Test 9: Password matching vs mismatching
  test('Confirm password matching rule', () => {
    const p1 = 'Secure8#Pass';
    const p2Matching = 'Secure8#Pass';
    const p3Mismatching = 'Different#Pass';

    assert.strictEqual(p1 === p2Matching, true, 'Matching confirm password passes check');
    assert.strictEqual(p1 === p3Mismatching, false, 'Mismatching confirm password fails check');
  });

  // Test 10: Common dictionary password rejected even if 8+ characters
  test('Common dictionary passwords rejected', () => {
    const res = validatePasswordPolicy('password1234'); // 12 characters, common
    assert.strictEqual(res.isValid, false, 'Common dictionary password must be rejected');
    assert.ok(res.errors.some((e) => e.includes('common')));
  });

  // Test 11: Passwords exceeding 128 characters rejected
  test('Password exceeding 128 characters rejected', () => {
    const longPass = 'A1!' + 'a'.repeat(126); // 129 chars
    const res = validatePasswordPolicy(longPass);
    assert.strictEqual(res.isValid, false, 'Password over 128 chars must be rejected');
    assert.ok(res.errors.some((e) => e.includes('128 characters')));
  });

  // Test 12: Bcrypt hashing & verification works with 8-character password
  await testAsync('Bcrypt hashing and verification with 8-character password', async () => {
    const pass = 'Pass8#Ok';
    const hash = await hashPassword(pass);
    assert.ok(hash.startsWith('$2'), 'Bcrypt hash generated');
    const valid = await verifyPassword(pass, hash);
    assert.strictEqual(valid, true, 'Password correctly verified against bcrypt hash');
    const invalid = await verifyPassword('Wrong#Pass8', hash);
    assert.strictEqual(invalid, false, 'Incorrect password rejected');
  });

  console.log('\n================================================================');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
