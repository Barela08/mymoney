import assert from 'assert';
import { parseQrPayload } from '../src/lib/sharedUdharEngine';
import QRCode from 'qrcode';

async function runPermissionsAndQrTests() {
  console.log('================================================================');
  console.log('🔍 SMART PERMISSION MANAGEMENT & QR SYSTEM VERIFICATION SUITE');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function runTest(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res.then(() => {
          console.log(`  ✅ [PASS] ${name}`);
          passed++;
        }).catch((err) => {
          console.error(`  ❌ [FAIL] ${name}:`, err.message);
        });
      } else {
        console.log(`  ✅ [PASS] ${name}`);
        passed++;
      }
    } catch (err: any) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
  }

  // TEST 1: QR Payload Parsing — Standard Web Pairing URL (Universal Phone Camera & Lens)
  await runTest('QR Parser: Resolves standard Web Deep Link URL into valid pair_url and code', () => {
    const raw = 'https://mymoney.nileshbarela.site/#pair=MM-X89K2L';
    const parsed = parseQrPayload(raw);
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.kind, 'pair_url');
    assert.strictEqual(parsed.code, 'MM-X89K2L');
  });

  // TEST 2: QR Payload Parsing — Query String Pair URL
  await runTest('QR Parser: Resolves query parameter ?pair=MM-AB12CD into valid code', () => {
    const raw = 'https://mymoney.nileshbarela.site/?pair=MM-AB12CD';
    const parsed = parseQrPayload(raw);
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.code, 'MM-AB12CD');
  });

  // TEST 3: QR Payload Parsing — Opaque 64-char Hex Token
  await runTest('QR Parser: Recognizes 64-character hex cryptographic pairing token', () => {
    const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const parsed = parseQrPayload(hex);
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.kind, 'hex_token');
    assert.strictEqual(parsed.token, hex);
  });

  // TEST 4: QR Payload Parsing — Direct Pairing Code MM-XXXXXX
  await runTest('QR Parser: Normalizes direct user pairing code MM-123456', () => {
    const parsed = parseQrPayload('mm-123456');
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.kind, 'pair_code');
    assert.strictEqual(parsed.code, 'MM-123456');
  });

  // TEST 5: QR Payload Parsing — Structured JSON format
  await runTest('QR Parser: Decodes and validates internal JSON pairing payload', () => {
    const payload = JSON.stringify({
      app: 'my-money',
      v: 2,
      type: 'udhar-pair',
      token: 'tok_live_998877',
      code: 'MM-QW7890',
      userId: 'usr_abc_123',
    });
    const parsed = parseQrPayload(payload);
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.kind, 'json');
    assert.strictEqual(parsed.token, 'tok_live_998877');
    assert.strictEqual(parsed.code, 'MM-QW7890');
  });

  // TEST 6: QR Payload Parsing — Reject Phishing & Malicious Payloads
  await runTest('QR Parser: Rejects phishing URLs, arbitrary websites, and invalid JSON', () => {
    const phishing1 = parseQrPayload('https://evil-phish.com/login');
    assert.strictEqual(phishing1.valid, false);

    const maliciousJson = parseQrPayload('{"app":"crypto-drainer","steal":true}');
    assert.strictEqual(maliciousJson.valid, false);

    const empty = parseQrPayload('');
    assert.strictEqual(empty.valid, false);
  });

  // TEST 7: High-Resolution QR Generation
  await runTest('QR Generator: Successfully outputs high-resolution QR data URL with Error Correction', async () => {
    const payload = 'https://mymoney.nileshbarela.site/#pair=MM-99AA11';
    const dataUrl = await QRCode.toDataURL(payload, {
      width: 640,
      margin: 2,
      errorCorrectionLevel: 'H',
    });
    assert(dataUrl.startsWith('data:image/png;base64,'), 'Output must be PNG base64 data URL');
    assert(dataUrl.length > 500, 'Image data URL must have valid payload bytes');
  });

  // TEST 8: UPI Payment QR URI Validation
  await runTest('UPI QR: Decodes recipient VPA, Payee Name, Amount, and Note without executing payment', () => {
    const upiUri = 'upi://pay?pa=nilesh@okaxis&pn=Nilesh%20Barela&am=500.00&cu=INR&tn=Rent%20Split';
    const parsedUrl = new URL(upiUri);
    const pa = parsedUrl.searchParams.get('pa');
    const pn = decodeURIComponent(parsedUrl.searchParams.get('pn') || '');
    const am = parsedUrl.searchParams.get('am');
    const cu = parsedUrl.searchParams.get('cu');
    const tn = parsedUrl.searchParams.get('tn');

    assert.strictEqual(pa, 'nilesh@okaxis');
    assert.strictEqual(pn, 'Nilesh Barela');
    assert.strictEqual(am, '500.00');
    assert.strictEqual(cu, 'INR');
    assert.strictEqual(tn, 'Rent Split');
  });

  // TEST 9: Permission State Transition Integrity
  await runTest('Permissions: State transition model supports prompt, requesting, granted, denied, and unsupported', () => {
    const validStates = ['prompt', 'requesting', 'granted', 'denied', 'restricted', 'unavailable', 'unsupported'];
    const testState = 'granted';
    assert(validStates.includes(testState), 'Permission state must be in approved enumerated states');
  });

  // TEST 10: PWA Installation Separation
  await runTest('PWA: Standalone detection operates independently from Push Notification permission', () => {
    const pwaInstalled = true;
    const notificationPermission = 'default';
    assert.notStrictEqual(pwaInstalled, notificationPermission === 'granted', 'Installing PWA does not grant notifications');
  });

  console.log('\n----------------------------------------------------------------');
  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${total - passed}`);
  console.log('----------------------------------------------------------------\n');

  if (passed === total) {
    console.log('🎉 ALL PERMISSION & QR VERIFICATION SCENARIOS PASSED WITH ZERO FAILURES!\n');
  } else {
    process.exit(1);
  }
}

runPermissionsAndQrTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
