import assert from 'assert';
import { EventEmitter } from 'events';
import { handleApiRequest } from '../server/api';
import {
  buildNormalUpiUri,
  buildAmountUpiUri,
  validateAmountForUpiQr,
  validateUpiId,
} from '../src/lib/upiQrUtils';
import fs from 'fs';
import path from 'path';

async function callApi(method: string, url: string, headers: Record<string, string> = {}, body?: any) {
  const req: any = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:3000', ...headers };
  req.socket = { remoteAddress: '127.0.0.1' };
  req.body = body;

  let status = 0;
  let payload: any = null;
  const res: any = {
    writableEnded: false,
    headersSent: false,
    statusCode: 200,
    status(code: number) {
      status = code;
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      payload = data;
      this.writableEnded = true;
      this.headersSent = true;
      return this;
    },
    setHeader() {},
    writeHead(code: number) {
      status = code;
      this.statusCode = code;
      return this;
    },
    end(raw: string) {
      status = status || this.statusCode;
      if (!payload && raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = raw;
        }
      }
      this.writableEnded = true;
      this.headersSent = true;
    },
  };

  const handled = await handleApiRequest(req, res);
  return { handled, status: status || res.statusCode, payload };
}

async function runTests() {
  console.log('--- Testing Person UPI QR & Direct Payment Option ---');

  // Test 1: Deep Link Intent Construction
  console.log('\n[1] Testing UPI deep-link URI construction & encoding...');
  const baseUri = buildNormalUpiUri({
    upiId: 'recipient@oksbi',
    payeeName: 'Ramesh Barela & Sons',
  });
  console.log('Generated base URI:', baseUri);
  assert.ok(baseUri.startsWith('upi://pay?'), 'Must start with upi://pay?');
  assert.ok(baseUri.includes('pa=recipient%40oksbi') || baseUri.includes('pa=recipient@oksbi'), 'Recipient pa must be present');
  assert.ok(baseUri.includes('pn=Ramesh%20Barela%20%26%20Sons') || baseUri.includes('pn=Ramesh+Barela'), 'Recipient pn must be URL-encoded');
  assert.ok(baseUri.includes('cu=INR'), 'Currency INR must be present');

  const amountUri = buildAmountUpiUri({
    upiId: 'recipient@oksbi',
    payeeName: 'Ramesh Barela',
    amount: 1250.5,
    paymentNote: 'Udhar settle #42',
  });
  console.log('Generated amount URI:', amountUri);
  assert.ok(amountUri.includes('am=1250.50'), 'Amount must be formatted to 2 decimals');
  assert.ok(amountUri.includes('cu=INR'), 'Currency INR must be present');
  assert.ok(amountUri.includes('tn=Udhar'), 'Transaction note must be present');

  // Test 2: UPI ID and Amount Validation
  console.log('\n[2] Testing UPI ID & Amount Validation...');
  assert.strictEqual(validateUpiId('nilesh@okaxis').isValid, true);
  assert.strictEqual(validateUpiId('barela.shop@hdfcbank').isValid, true);
  assert.strictEqual(validateUpiId('9876543210@paytm').isValid, true);
  assert.strictEqual(validateUpiId('invalid-upi').isValid, false);
  assert.strictEqual(validateUpiId('test@').isValid, false);
  assert.strictEqual(validateUpiId('@axis').isValid, false);

  assert.strictEqual(validateAmountForUpiQr('500').isValid, true);
  assert.strictEqual(validateAmountForUpiQr('0').isValid, false);
  assert.strictEqual(validateAmountForUpiQr('-10').isValid, false);
  assert.strictEqual(validateAmountForUpiQr('20000000').isValid, false); // Exceeds UPI limit
  assert.strictEqual(validateAmountForUpiQr('abc').isValid, false);

  // Test 3: Backend Security & Authorization on /api/udhar/people/:identifier/upi-profile
  console.log('\n[3] Testing /api/udhar/people/:identifier/upi-profile backend route...');
  const unauthRes = await callApi('GET', '/api/udhar/people/user-123/upi-profile');
  assert.strictEqual(unauthRes.handled, true, 'Route must be handled');
  assert.strictEqual(unauthRes.status, 401, 'Unauthenticated request must return 401');
  assert.ok(
    unauthRes.payload?.error?.includes('Unauthorized') ||
    unauthRes.payload?.message?.includes('Authentication required'),
    'Error must specify auth failure'
  );

  // Test 4: Code Inspection to Ensure No Logged-in QR Leakage
  console.log('\n[4] Verifying PersonDetailsView does not route to /upi-qr...');
  const personDetailsSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/people/PersonDetailsView.tsx'),
    'utf-8'
  );
  assert.ok(!personDetailsSrc.includes("window.history.pushState(null, '', '/upi-qr')"), 'PersonDetailsView must NOT route to /upi-qr');
  assert.ok(personDetailsSrc.includes('<PersonUpiQrModal'), 'PersonDetailsView must render PersonUpiQrModal');
  assert.ok(personDetailsSrc.includes('suggestedAmount={suggestedPaymentAmount}'), 'Must pass suggestedPaymentAmount');

  console.log('\n[5] Verifying SavedPeopleManagerModal incorporates PersonUpiQrModal...');
  const savedPeopleSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/people/SavedPeopleManagerModal.tsx'),
    'utf-8'
  );
  assert.ok(savedPeopleSrc.includes('<PersonUpiQrModal'), 'SavedPeopleManagerModal must render PersonUpiQrModal');
  assert.ok(savedPeopleSrc.includes('setSelectedContactForUpi'), 'Must have trigger to open Person UPI modal');

  console.log('\n[6] Verifying PersonUpiQrModal implementation details...');
  const modalSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/people/PersonUpiQrModal.tsx'),
    'utf-8'
  );
  assert.ok(modalSrc.includes('UPI ID not available'), 'Must show UPI ID not available when unconfigured');
  assert.ok(modalSrc.includes('buildNormalUpiUri') && modalSrc.includes('buildAmountUpiUri'), 'Must use official UPI URI builders');
  assert.ok(modalSrc.includes('upi://'), 'Must handle standard upi:// deep-link');
  assert.ok(
    modalSrc.includes('does not automatically record or mark an Udhar transaction as paid'),
    'Must inform user about ledger settlement distinction'
  );

  console.log('\n✅ ALL PERSON UPI QR & DIRECT PAYMENT TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
