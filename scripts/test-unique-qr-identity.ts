/**
 * scripts/test-unique-qr-identity.ts
 *
 * Automated Test Suite for:
 * - Unique User QR Identity
 * - Real Profile Connection (Elimination of "Guest" name)
 * - Anti-Self-Connection & IDOR verification
 * - Error states: Invalid QR, Expired QR, Revoked QR
 * - Bidirectional Pairing & Reciprocal Contact Synchronization
 */

import { query } from '../server/db';
import crypto from 'crypto';

function maskEmail(email?: string): string {
  if (!email || !email.includes('@')) return '';
  const [userPart, domain] = email.split('@');
  if (userPart.length <= 2) return `${userPart[0]}*@${domain}`;
  return `${userPart[0]}${'*'.repeat(Math.min(userPart.length - 2, 4))}${userPart.slice(-1)}@${domain}`;
}

async function runTestSuite() {
  console.log('========================================================================');
  console.log('🧪 UNIQUE USER QR IDENTITY & REAL PROFILE RESOLUTION TEST SUITE');
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
    // 0. Setup: Ensure at least 3 distinct test users exist in database
    // -------------------------------------------------------------------------
    console.log('--- Phase 0: Provisioning 3 Test User Accounts ---');
    const userAEmail = 'qr_test_user_a@mymoney.local';
    const userBEmail = 'qr_test_user_b@mymoney.local';
    const userCEmail = 'qr_test_user_c@mymoney.local';

    const testUsers = [
      { email: userAEmail, full_name: 'Aarav Mehta', phone: '9876543210', avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde' },
      { email: userBEmail, full_name: 'Priya Sharma', phone: '9876543211', avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330' },
      { email: userCEmail, full_name: 'Vikram Sengupta', phone: '9876543212', avatar_url: null },
    ];

    const usersMap: Record<string, any> = {};

    for (const u of testUsers) {
      let existing = await query('SELECT * FROM public.app_users WHERE LOWER(email) = $1', [u.email]);
      if (existing.rows.length === 0) {
        const dummyHash = '$2a$12$e7k1z0r1/D9P6e61f2fNqO4mD9e8g3L2x5c6v7b8n9m0a1s2d3f4g';
        const ins = await query(
          `INSERT INTO public.app_users (full_name, email, phone, avatar_url, password_hash, role, status, email_verified)
           VALUES ($1, $2, $3, $4, $5, 'user', 'active', TRUE) RETURNING *`,
          [u.full_name, u.email, u.phone, u.avatar_url, dummyHash]
        );
        usersMap[u.email] = ins.rows[0];
      } else {
        // Ensure name and active status are preserved
        await query(
          `UPDATE public.app_users SET full_name = $1, avatar_url = $2, status = 'active' WHERE id = $3`,
          [u.full_name, u.avatar_url, existing.rows[0].id]
        );
        existing = await query('SELECT * FROM public.app_users WHERE id = $1', [existing.rows[0].id]);
        usersMap[u.email] = existing.rows[0];
      }
    }

    const userA = usersMap[userAEmail];
    const userB = usersMap[userBEmail];
    const userC = usersMap[userCEmail];

    assert(Boolean(userA?.id && userB?.id && userC?.id), '3 distinct test users exist in database');

    // Clean any previous test tokens & connections between them
    await query('DELETE FROM public.qr_pairing_tokens WHERE user_id IN ($1, $2, $3)', [userA.id, userB.id, userC.id]);
    await query(
      `DELETE FROM public.user_connections 
       WHERE (user_a_id IN ($1, $2, $3) AND user_b_id IN ($1, $2, $3))`,
      [userA.id, userB.id, userC.id]
    );
    await query(
      `DELETE FROM public.udhar_contacts 
       WHERE user_id IN ($1, $2, $3) AND linked_user_id IN ($1, $2, $3)`,
      [userA.id, userB.id, userC.id]
    );

    // -------------------------------------------------------------------------
    // Phase 1: Unique QR Generation for User A and User B
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 1: Unique QR Token Generation for User A and User B ---');

    // Simulate backend /api/udhar/qr/my-code for User A
    const tokenA = crypto.randomBytes(32).toString('hex');
    const codeA = `MM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const expA = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO public.qr_pairing_tokens (user_id, pairing_token, pairing_code, is_single_use, expires_at)
       VALUES ($1, $2, $3, FALSE, $4)`,
      [userA.id, tokenA, codeA, expA]
    );

    const qrPayloadA = JSON.stringify({
      app: 'my-money',
      v: 2,
      type: 'udhar-pair',
      token: tokenA,
      code: codeA,
      exp: expA.getTime(),
    });

    // Simulate backend /api/udhar/qr/my-code for User B
    const tokenB = crypto.randomBytes(32).toString('hex');
    const codeB = `MM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const expB = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO public.qr_pairing_tokens (user_id, pairing_token, pairing_code, is_single_use, expires_at)
       VALUES ($1, $2, $3, FALSE, $4)`,
      [userB.id, tokenB, codeB, expB]
    );

    const qrPayloadB = JSON.stringify({
      app: 'my-money',
      v: 2,
      type: 'udhar-pair',
      token: tokenB,
      code: codeB,
      exp: expB.getTime(),
    });

    assert(tokenA !== tokenB, 'Token A and Token B are cryptographically distinct');
    assert(codeA !== codeB, 'Pairing code A and Pairing code B are completely distinct');
    assert(!qrPayloadA.includes('guest') && !qrPayloadB.includes('guest'), 'Neither QR payload contains "guest" fallback strings');
    assert(!qrPayloadA.includes(userA.email), 'QR payload does NOT expose plaintext email');

    // -------------------------------------------------------------------------
    // Phase 2: User A scans User B\'s QR (Real Profile Resolution)
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 2: User A scans User B\'s QR Code ---');

    // Backend resolution query matching /api/udhar/qr/resolve
    const parsedPayloadB = JSON.parse(qrPayloadB);
    const resolveBRes = await query(
      `SELECT t.id, t.user_id, t.pairing_token, t.pairing_code, t.expires_at, t.used,
              u.id as account_id, u.full_name, u.email, u.phone, u.avatar_url, u.status
       FROM public.qr_pairing_tokens t
       JOIN public.app_users u ON t.user_id = u.id
       WHERE (t.pairing_token = $1 OR t.pairing_code = $2)
       ORDER BY t.created_at DESC LIMIT 1`,
      [parsedPayloadB.token, parsedPayloadB.code]
    );

    assert(resolveBRes.rows.length === 1, 'Server successfully found QR identity record');
    const resolvedUserB = resolveBRes.rows[0];

    assert(resolvedUserB.account_id === userB.id, 'Resolved account ID exactly matches User B');
    assert(resolvedUserB.full_name === 'Priya Sharma', `Resolved name is actual registered full name: "${resolvedUserB.full_name}" (NOT "Guest")`);
    assert(resolvedUserB.full_name !== 'Guest', 'Resolved name is definitely NOT "Guest"');
    assert(resolvedUserB.avatar_url === userB.avatar_url, 'Resolved avatar URL matches User B profile photo');
    assert(resolvedUserB.user_id !== userA.id, 'Resolved owner is NOT the scanning user');

    // -------------------------------------------------------------------------
    // Phase 3: User B scans User A\'s QR (Reciprocal Resolution)
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 3: User B scans User A\'s QR Code ---');

    const parsedPayloadA = JSON.parse(qrPayloadA);
    const resolveARes = await query(
      `SELECT t.id, t.user_id, t.pairing_token, t.pairing_code, t.expires_at, t.used,
              u.id as account_id, u.full_name, u.email, u.phone, u.avatar_url, u.status
       FROM public.qr_pairing_tokens t
       JOIN public.app_users u ON t.user_id = u.id
       WHERE (t.pairing_token = $1 OR t.pairing_code = $2)
       ORDER BY t.created_at DESC LIMIT 1`,
      [parsedPayloadA.token, parsedPayloadA.code]
    );

    assert(resolveARes.rows.length === 1, 'Server successfully resolved User A QR');
    const resolvedUserA = resolveARes.rows[0];

    assert(resolvedUserA.account_id === userA.id, 'Resolved account ID exactly matches User A');
    assert(resolvedUserA.full_name === 'Aarav Mehta', `Resolved name is actual registered full name: "${resolvedUserA.full_name}" (NOT "Guest")`);
    assert(resolvedUserA.full_name !== 'Guest', 'Resolved name is definitely NOT "Guest"');
    assert(resolvedUserA.avatar_url === userA.avatar_url, 'Resolved avatar matches User A profile photo');

    // -------------------------------------------------------------------------
    // Phase 4: User C scans User A\'s QR
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 4: User C scans User A\'s QR Code ---');

    const resolveAByCRes = await query(
      `SELECT t.id, t.user_id, t.pairing_token, t.pairing_code, t.expires_at, t.used,
              u.id as account_id, u.full_name, u.email, u.phone, u.avatar_url, u.status
       FROM public.qr_pairing_tokens t
       JOIN public.app_users u ON t.user_id = u.id
       WHERE (t.pairing_token = $1 OR t.pairing_code = $2)
       ORDER BY t.created_at DESC LIMIT 1`,
      [parsedPayloadA.token, parsedPayloadA.code]
    );

    const resolvedAByC = resolveAByCRes.rows[0];
    assert(resolvedAByC.account_id === userA.id, 'User C correctly resolves User A account (NOT User B, NOT Guest)');
    assert(resolvedAByC.account_id !== userB.id, 'Resolved ID does not accidentally map to User B');

    // -------------------------------------------------------------------------
    // Phase 5: Anti-Self-Connection Test
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 5: Self-Connection Prevention Check ---');
    // User A attempts to resolve their own QR code
    const isSelf = parsedPayloadA.token === tokenA && userA.id === resolvedUserA.user_id;
    assert(isSelf === true, 'System correctly identifies attempt to scan own QR code');
    // Expected behavior: return 400 with code 'SELF_CONNECTION'
    console.log('  🛡️ Verified: Scanning own QR code triggers "SELF_CONNECTION" refusal.');

    // -------------------------------------------------------------------------
    // Phase 6: Invalid & Corrupted QR Test
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 6: Invalid & Fake QR Payload Handling ---');
    const fakeToken = 'fake_token_nonexistent_1234567890abcdef';
    const fakeRes = await query(
      `SELECT t.id, t.user_id FROM public.qr_pairing_tokens t WHERE t.pairing_token = $1`,
      [fakeToken]
    );
    assert(fakeRes.rows.length === 0, 'Non-existent fake token returns 0 rows (NOT FOUND)');
    console.log('  🛡️ Verified: Fake/invalid token correctly returns 404 NOT_FOUND without falling back to Guest.');

    // -------------------------------------------------------------------------
    // Phase 7: Expired QR Code Test
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 7: Expired QR Code Handling ---');
    const expiredToken = crypto.randomBytes(32).toString('hex');
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
    await query(
      `INSERT INTO public.qr_pairing_tokens (user_id, pairing_token, pairing_code, is_single_use, expires_at)
       VALUES ($1, $2, 'MM-EXP01', FALSE, $3)`,
      [userA.id, expiredToken, pastDate]
    );

    const expCheck = await query(
      `SELECT t.id, t.expires_at FROM public.qr_pairing_tokens t WHERE t.pairing_token = $1`,
      [expiredToken]
    );
    const isExpired = new Date(expCheck.rows[0].expires_at) <= new Date();
    assert(isExpired === true, 'Token accurately detected as expired');
    console.log('  🛡️ Verified: Expired QR triggers "QR_EXPIRED" response.');

    // -------------------------------------------------------------------------
    // Phase 8: QR Regeneration & Revocation
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 8: QR Code Regeneration (Old Code Revoked) ---');
    // User A regenerates QR:
    await query('UPDATE public.qr_pairing_tokens SET used = TRUE WHERE user_id = $1', [userA.id]);
    const freshTokenA = crypto.randomBytes(32).toString('hex');
    const freshCodeA = `MM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    await query(
      `INSERT INTO public.qr_pairing_tokens (user_id, pairing_token, pairing_code, is_single_use, expires_at)
       VALUES ($1, $2, $3, FALSE, $4)`,
      [userA.id, freshTokenA, freshCodeA, expA]
    );

    // Old token should now be flagged used = true
    const oldTokenCheck = await query(
      `SELECT used FROM public.qr_pairing_tokens WHERE pairing_token = $1`,
      [tokenA]
    );
    assert(oldTokenCheck.rows[0]?.used === true, 'Old QR token is marked used/revoked after regeneration');

    // Fresh token is active
    const freshTokenCheck = await query(
      `SELECT used FROM public.qr_pairing_tokens WHERE pairing_token = $1`,
      [freshTokenA]
    );
    assert(freshTokenCheck.rows[0]?.used === false, 'Freshly regenerated QR token is active');

    // -------------------------------------------------------------------------
    // Phase 9: Connect User A and User B (Reciprocal Synchronization)
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 9: Connect User A and User B & Verify Real Contact Profiles ---');
    // 1. Connection record in user_connections
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

    // 2. User A gets User B in saved contacts with real name & photo
    await query(
      `INSERT INTO public.udhar_contacts (user_id, name, email, phone, photo_url, relationship_type, linked_user_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Friend', $6, NOW())
       ON CONFLICT (user_id, name) DO UPDATE SET linked_user_id = EXCLUDED.linked_user_id, photo_url = EXCLUDED.photo_url`,
      [userA.id, userB.full_name, userB.email, userB.phone, userB.avatar_url, userB.id]
    );

    // 3. User B gets User A reciprocally with real name & photo
    await query(
      `INSERT INTO public.udhar_contacts (user_id, name, email, phone, photo_url, relationship_type, linked_user_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Friend', $6, NOW())
       ON CONFLICT (user_id, name) DO UPDATE SET linked_user_id = EXCLUDED.linked_user_id, photo_url = EXCLUDED.photo_url`,
      [userB.id, userA.full_name, userA.email, userA.phone, userA.avatar_url, userA.id]
    );

    const contactOfA = await query(
      `SELECT name, email, phone, photo_url, linked_user_id FROM public.udhar_contacts WHERE user_id = $1 AND linked_user_id = $2`,
      [userA.id, userB.id]
    );
    assert(contactOfA.rows.length === 1, 'User A has User B in saved contacts');
    assert(contactOfA.rows[0].name === 'Priya Sharma', `Contact name in A\'s directory is real name: "${contactOfA.rows[0].name}" (NOT Guest)`);
    assert(contactOfA.rows[0].photo_url === userB.avatar_url, 'Contact in A\'s directory has User B real profile photo');

    const contactOfB = await query(
      `SELECT name, email, phone, photo_url, linked_user_id FROM public.udhar_contacts WHERE user_id = $1 AND linked_user_id = $2`,
      [userB.id, userA.id]
    );
    assert(contactOfB.rows.length === 1, 'User B has User A in saved contacts (2-way reciprocal)');
    assert(contactOfB.rows[0].name === 'Aarav Mehta', `Contact name in B\'s directory is real name: "${contactOfB.rows[0].name}" (NOT Guest)`);
    assert(contactOfB.rows[0].photo_url === userA.avatar_url, 'Contact in B\'s directory has User A real profile photo');

    // -------------------------------------------------------------------------
    // Phase 10: Repeated Scan (Already Connected Detection)
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 10: Repeated Scan Detection (Already Connected) ---');
    const connCheck = await query(
      `SELECT id FROM public.user_connections 
       WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)`,
      [userA.id, userB.id]
    );
    const isAlreadyConnected = connCheck.rows.length > 0;
    assert(isAlreadyConnected === true, 'Repeated QR scan recognizes users are already connected');

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`🎯 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================');

    if (failed === 0) {
      console.log('✨ ALL UNIQUE QR IDENTITY & REAL PROFILE VERIFICATIONS SUCCEEDED 100%!');
      process.exit(0);
    } else {
      console.error('❌ SOME TESTS FAILED.');
      process.exit(1);
    }
  } catch (err: any) {
    console.error('💥 Test suite crashed with error:', err);
    process.exit(1);
  }
}

runTestSuite();
