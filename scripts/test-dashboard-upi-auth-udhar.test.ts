import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  validateUpiId,
  validateAmountForUpiQr,
  canSaveUpiProfile,
  shouldRequireUpiConsent,
  doesUpiProfileBelongToUser,
  buildNormalUpiUri,
  buildAmountUpiUri,
  UPI_CONSENT_WORDING,
  UPI_PRIVACY_NOTICE,
  UPI_CONSENT_PURPOSE,
  UPI_CONSENT_POLICY_VERSION,
} from '../src/lib/upiQrUtils';
import {
  issueWebAuthnChallenge,
  consumeWebAuthnChallenge,
  verifyPasskeyAssertion,
  bufferToBase64Url,
} from '../server/webauthn';
import { verifyFirebaseJwtWithKey } from '../server/firebaseVerify';
import { isDiscoverableNormalUser, sanitizeUserOutput } from '../server/auth';
import { isValidUuid, parseConnectionRequestKey } from '../src/lib/sharedUdharEngine';

test('validateUpiId accepts valid Indian UPI VPAs and rejects emails & malformed strings', () => {
  const validIds = ['yourname@upi', 'name.123@okhdfcbank', '9876543210@ybl', 'Nilesh_08@okaxis', 'shop-pay@paytm'];
  for (const id of validIds) {
    const res = validateUpiId(id);
    assert.equal(res.isValid, true, `Expected ${id} to be valid`);
    assert.equal(res.normalized, id.toLowerCase());
  }

  const invalidIds = [
    '',
    '   ',
    'user@gmail.com',
    'name@company.co.in',
    'missinghandle',
    'a@upi',
    'bad space@upi',
    'two@@upi',
    '@upi',
    'user@',
  ];
  for (const id of invalidIds) {
    const res = validateUpiId(id);
    assert.equal(res.isValid, false, `Expected ${id} to be invalid`);
    assert.ok(res.error && res.error.length > 0);
  }
});

test('canSaveUpiProfile strictly enforces explicit unchecked-by-default DPDP consent', () => {
  assert.equal(UPI_CONSENT_PURPOSE, 'upi_qr_storage');
  assert.ok(UPI_CONSENT_WORDING.includes('My Money Manager'));
  assert.ok(UPI_PRIVACY_NOTICE.sections.length >= 6);

  const withoutConsent = canSaveUpiProfile({ upiId: 'yourname@upi', consentAccepted: false });
  assert.equal(withoutConsent.allowed, false);

  const invalidUpiWithConsent = canSaveUpiProfile({ upiId: 'user@gmail.com', consentAccepted: true });
  assert.equal(invalidUpiWithConsent.allowed, false);

  const validBoth = canSaveUpiProfile({ upiId: 'yourname@upi', consentAccepted: true });
  assert.equal(validBoth.allowed, true);
});

test('buildNormalUpiUri & buildAmountUpiUri generate NPCI-compliant upi://pay URIs and validate amounts', () => {
  const normal = buildNormalUpiUri({
    upiId: 'Nilesh.08@OKAXIS',
    payeeName: 'Nilesh Barela',
    paymentNote: 'Lunch split',
  });
  assert.equal(
    normal,
    'upi://pay?pa=nilesh.08%40okaxis&pn=Nilesh%20Barela&cu=INR&tn=Lunch%20split'
  );

  const amountUri = buildAmountUpiUri({
    upiId: 'yourname@upi',
    payeeName: 'HackifyPro User',
    amount: '250.50',
    paymentNote: 'Rent share',
  });
  assert.equal(
    amountUri,
    'upi://pay?pa=yourname%40upi&pn=HackifyPro%20User&am=250.50&cu=INR&tn=Rent%20share'
  );

  for (const bad of ['', '0', '-50', 'abc', '12.345', '100000000']) {
    const check = validateAmountForUpiQr(bad);
    assert.equal(check.isValid, false, `Expected amount "${bad}" to be rejected`);
    assert.throws(() =>
      buildAmountUpiUri({ upiId: 'yourname@upi', amount: bad })
    );
  }
});

test('WebAuthn server challenge + ES256 cryptographic assertion verification & replay protection', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeySpki = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  const rpId = 'mymoney.nileshbarela.site';
  const origin = `https://${rpId}`;

  const issued = issueWebAuthnChallenge({ type: 'login', rpId, origin });
  const consumed = consumeWebAuthnChallenge(issued.challengeId, 'login');
  assert.ok(consumed);
  assert.equal(consumed.challenge, issued.challenge);
  // Single-use challenge cannot be consumed twice
  assert.equal(consumeWebAuthnChallenge(issued.challengeId, 'login'), null);

  const buildAssertion = (params: { challenge: string; originVal: string; rpIdVal: string; signCount: number }) => {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: params.challenge,
        origin: params.originVal,
      }),
      'utf8'
    );
    const rpIdHash = crypto.createHash('sha256').update(params.rpIdVal).digest();
    const flags = Buffer.from([0x05]); // UP + UV
    const counterBuf = Buffer.alloc(4);
    counterBuf.writeUInt32BE(params.signCount, 0);
    const authDataBuf = Buffer.concat([rpIdHash, flags, counterBuf]);
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
    const signedData = Buffer.concat([authDataBuf, clientDataHash]);
    const signature = crypto.sign('sha256', signedData, privateKey);

    return {
      clientDataJSON: bufferToBase64Url(clientDataJSON),
      authenticatorData: bufferToBase64Url(authDataBuf),
      signature: bufferToBase64Url(signature),
    };
  };

  // 1. Valid assertion with advancing signCount succeeds
  const validAssertion = buildAssertion({ challenge: issued.challenge, originVal: origin, rpIdVal: rpId, signCount: 2 });
  const ok = verifyPasskeyAssertion({
    ...validAssertion,
    expectedChallenge: issued.challenge,
    expectedOrigin: origin,
    expectedRpId: rpId,
    publicKeySpki,
    previousCounter: 1,
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.newCounter, 2);

  // 2. Replay attack (same or lower signCount) is rejected
  const replay = verifyPasskeyAssertion({
    ...validAssertion,
    expectedChallenge: issued.challenge,
    expectedOrigin: origin,
    expectedRpId: rpId,
    publicKeySpki,
    previousCounter: 2,
  });
  assert.equal(replay.valid, false);
  assert.match(replay.error || '', /replay/i);

  // 3. Wrong origin is rejected
  const badOrigin = buildAssertion({ challenge: issued.challenge, originVal: 'https://evil.example', rpIdVal: rpId, signCount: 3 });
  const badOriginRes = verifyPasskeyAssertion({
    ...badOrigin,
    expectedChallenge: issued.challenge,
    expectedOrigin: origin,
    expectedRpId: rpId,
    publicKeySpki,
    previousCounter: 2,
  });
  assert.equal(badOriginRes.valid, false);
});

test('Firebase ID token server-side RS256 verification validates signature, project, issuer, and expiry', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const projectId = 'hackifypro-money-prod';
  const nowSec = 1760000000;

  const signJwt = (payload: Record<string, any>, alg = 'RS256') => {
    const headerB64 = bufferToBase64Url(Buffer.from(JSON.stringify({ alg, typ: 'JWT', kid: 'test-kid' })));
    const payloadB64 = bufferToBase64Url(Buffer.from(JSON.stringify(payload)));
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), privateKey);
    return `${headerB64}.${payloadB64}.${bufferToBase64Url(sig)}`;
  };

  const validToken = signJwt({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: 'firebase-uid-12345',
    email: 'User@Example.com',
    email_verified: true,
    name: 'Test User',
    iat: nowSec - 10,
    exp: nowSec + 3600,
    firebase: { sign_in_provider: 'google.com' },
  });

  const decoded = verifyFirebaseJwtWithKey(validToken, pubPem, projectId, nowSec);
  assert.equal(decoded.uid, 'firebase-uid-12345');
  assert.equal(decoded.email, 'user@example.com');
  assert.equal(decoded.emailVerified, true);

  // Expired token rejected
  const expiredToken = signJwt({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: 'firebase-uid-12345',
    email: 'user@example.com',
    iat: nowSec - 7200,
    exp: nowSec - 10,
  });
  assert.throws(() => verifyFirebaseJwtWithKey(expiredToken, pubPem, projectId, nowSec), /expired/i);

  // Wrong project / audience rejected
  const wrongAud = signJwt({
    aud: 'other-project',
    iss: `https://securetoken.google.com/${projectId}`,
    sub: 'firebase-uid-12345',
    email: 'user@example.com',
    iat: nowSec - 10,
    exp: nowSec + 3600,
  });
  assert.throws(() => verifyFirebaseJwtWithKey(wrongAud, pubPem, projectId, nowSec), /audience/i);

  // Tampered payload rejected
  const tamperedParts = validToken.split('.');
  const fakePayload = bufferToBase64Url(
    Buffer.from(
      JSON.stringify({
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        sub: 'admin-uid',
        email: 'admin@example.com',
        iat: nowSec - 10,
        exp: nowSec + 3600,
      })
    )
  );
  assert.throws(
    () => verifyFirebaseJwtWithKey(`${tamperedParts[0]}.${fakePayload}.${tamperedParts[2]}`, pubPem, projectId, nowSec),
    /signature/i
  );
});

test('isDiscoverableNormalUser strictly excludes admin/staff accounts and sanitizeUserOutput strips internal permissions', () => {
  assert.equal(
    isDiscoverableNormalUser({ role: 'user', email: 'rahul@example.com', status: 'active' }),
    true
  );
  assert.equal(
    isDiscoverableNormalUser({ role: 'admin', email: 'admin@example.com', status: 'active' }),
    false
  );
  assert.equal(
    isDiscoverableNormalUser({ role: 'superadmin', email: 'boss@example.com', status: 'active' }),
    false
  );
  assert.equal(
    isDiscoverableNormalUser({ role: 'support', email: 'help@example.com', status: 'active' }),
    false
  );
  assert.equal(
    isDiscoverableNormalUser({ role: 'user', email: 'suspended@example.com', status: 'suspended' }),
    false
  );

  const sanitized = sanitizeUserOutput({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Test Person',
    username: 'test_person',
    email: 'test@example.com',
    role: 'user',
    status: 'active',
    email_verified: true,
    profile_completed: false,
    custom_permissions: { __upi_profile: { upiId: 'secret@upi' } } as any,
  } as any);

  assert.equal(sanitized.username, 'test_person');
  assert.equal(sanitized.profileCompleted, false);
  assert.equal('custom_permissions' in sanitized, false);
});

test('isDiscoverableNormalUser rejects analyst/admin emails and pending-deletion accounts', () => {
  assert.equal(
    isDiscoverableNormalUser({ role: 'analyst', email: 'analyst@example.com', status: 'active' }),
    false
  );
  assert.equal(
    isDiscoverableNormalUser({ role: 'user', email: 'admin@mymoney.com', status: 'active' }),
    false
  );
  assert.equal(
    isDiscoverableNormalUser({ role: 'user', email: 'hackifypro@gmail.com', status: 'active' }),
    false
  );
  assert.equal(
    isDiscoverableNormalUser({
      role: 'user',
      email: 'deleting@example.com',
      status: 'active',
      deletion_status: 'pending_deletion',
    }),
    false
  );
});

test('parseConnectionRequestKey safely distinguishes UUIDs, composite requester:target keys, and invalid inputs', () => {
  const uuidA = '11111111-1111-4111-8111-111111111111';
  const uuidB = '22222222-2222-4222-8222-222222222222';

  assert.equal(isValidUuid(uuidA), true);
  assert.equal(isValidUuid('not-a-uuid'), false);

  const single = parseConnectionRequestKey(` ${uuidA} `);
  assert.deepEqual(single, {
    valid: true,
    kind: 'uuid',
    raw: uuidA,
    uuid: uuidA,
    requesterUserId: null,
    targetUserId: null,
  });

  const composite = parseConnectionRequestKey(`${uuidA}:${uuidB}`);
  assert.deepEqual(composite, {
    valid: true,
    kind: 'composite',
    raw: `${uuidA}:${uuidB}`,
    uuid: null,
    requesterUserId: uuidA,
    targetUserId: uuidB,
  });

  for (const bad of ['', '   ', 'abc:def', `${uuidA}:not-uuid`, `${uuidA}:${uuidB}:extra`]) {
    const parsed = parseConnectionRequestKey(bad);
    assert.equal(parsed.valid, false, `Expected "${bad}" to be invalid`);
    assert.equal(parsed.kind, 'invalid');
  }
});

test('validateAmountForUpiQr and buildAmountUpiUri enforce INR precision and upper/lower bounds', () => {
  assert.equal(validateAmountForUpiQr('0.01').isValid, true);
  assert.equal(validateAmountForUpiQr('100.5').isValid, true);
  assert.equal(validateAmountForUpiQr('10000000').isValid, true);
  assert.equal(validateAmountForUpiQr('10000000.01').isValid, false);
  assert.equal(validateAmountForUpiQr('12.345').isValid, false);

  const uri = buildAmountUpiUri({ upiId: 'demo@okaxis', amount: '100.5' });
  assert.equal(uri, 'upi://pay?pa=demo%40okaxis&am=100.50&cu=INR');
});

test('shouldRequireUpiConsent avoids repeated consent when valid active consent matches current version', () => {
  // First-time user always requires explicit consent
  assert.equal(
    shouldRequireUpiConsent({
      hasSavedProfile: false,
      consentStatus: 'granted',
      consentVersion: UPI_CONSENT_POLICY_VERSION,
    }),
    true
  );

  // Saved profile with matching granted version does NOT require repeated consent
  assert.equal(
    shouldRequireUpiConsent({
      hasSavedProfile: true,
      consentStatus: 'granted',
      consentVersion: UPI_CONSENT_POLICY_VERSION,
    }),
    false
  );

  // Saved profile with withdrawn or not_granted consent DOES require consent
  assert.equal(
    shouldRequireUpiConsent({
      hasSavedProfile: true,
      consentStatus: 'withdrawn',
      consentVersion: UPI_CONSENT_POLICY_VERSION,
    }),
    true
  );
  assert.equal(
    shouldRequireUpiConsent({
      hasSavedProfile: true,
      consentStatus: 'not_granted',
      consentVersion: null,
    }),
    true
  );

  // Outdated policy version requires fresh consent
  assert.equal(
    shouldRequireUpiConsent({
      hasSavedProfile: true,
      consentStatus: 'granted',
      consentVersion: 'v1.0 — legacy',
    }),
    true
  );

  // Editing an already-consented profile works when hasExistingValidConsent is true
  assert.equal(
    canSaveUpiProfile({
      upiId: 'updated.name@ybl',
      consentAccepted: false,
      hasExistingValidConsent: true,
    }).allowed,
    true
  );
  assert.equal(
    canSaveUpiProfile({
      upiId: 'invalid@gmail.com',
      consentAccepted: false,
      hasExistingValidConsent: true,
    }).allowed,
    false
  );
});

test('doesUpiProfileBelongToUser enforces strict per-user UPI ownership isolation', () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  const profileA = {
    id: 'upi-1',
    userId: userA,
    upiId: 'usera@okaxis',
    payeeName: 'User A',
    paymentNote: '',
  };

  assert.equal(doesUpiProfileBelongToUser(profileA, userA), true);
  assert.equal(doesUpiProfileBelongToUser(profileA, userB), false);
  assert.equal(doesUpiProfileBelongToUser(profileA, null), false);
  assert.equal(doesUpiProfileBelongToUser(null, userA), false);
  assert.equal(
    doesUpiProfileBelongToUser({ ...profileA, upiId: '' }, userA),
    false
  );
});


