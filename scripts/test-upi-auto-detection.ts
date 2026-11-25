/**
 * Comprehensive Automated Verification Suite — Automatic UPI Payment Detection
 * Product: My Money Manager by HackifyPro
 *
 * Covers all 20 required verification scenarios:
 *  1. Google Pay outgoing payment parser (with merchant, UTR, UPI Txn ID)
 *  2. PhonePe outgoing payment parser (with merchant, VPA, UTR)
 *  3. Paytm outgoing payment parser (missing UTR -> null preserved, never fabricated)
 *  4. BHIM UPI outgoing payment parser (with RRN)
 *  5. Generic UPI (Amazon Pay / CRED) outgoing payment parser
 *  6. Incoming payment notification strictly rejected (never logged as expense)
 *  7. Failed payment notification strictly rejected
 *  8. Pending / processing payment notification strictly rejected
 *  9. OTP / UPI PIN / CVV / promotional / collect request strictly rejected
 * 10. Missing amount or foreign currency strictly rejected (never fabricated)
 * 11. Missing merchant preserved as null (never fabricated)
 * 12. Duplicate notification (same UTR / Txn ID / hash) deduplicated without duplicating expenses
 * 13. Multiple legitimate identical-amount payments (distinct UTRs or separated in time) preserved
 * 14. Disabled app filter respected by parser registry
 * 15. All 13 UPI popup categories map cleanly to existing ExpenseContext ledger payloads
 * 16. Sensitive log masking redacts OTPs, PINs, UPI handles, and long account numbers
 * 17. Native bridge permission verification never assumes granted when Settings opened & detects revocation
 * 18. Backend API /api/upi-detection/* auth guard (401 without session)
 * 19. Backend API end-to-end flow: settings -> ingest -> duplicate ingest -> remind-later -> categorize -> idempotent re-categorize -> edit -> reset
 * 20. SQL migration & Android native module structural verification (RLS, paise column, BIND_NOTIFICATION_LISTENER_SERVICE)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  parseUpiNotification,
  deduplicateDetectedTransaction,
  mapUpiCategoryToExpensePayload,
  maskSensitiveLogPayload,
  UPI_EXPENSE_CATEGORIES,
  SUPPORTED_UPI_APPS,
  PARSER_VERSION,
  type DetectedTransaction,
} from '../src/lib/upiDetectionEngine.js';
import {
  verifyNotificationAccessStatus,
  detectRuntimePlatform,
  openAndroidNotificationSettings,
} from '../src/lib/upiNativeBridge.js';
import {
  handleUpiDetectionRequest,
  __resetUpiDetectionMemoryStoreForTests,
} from '../server/upiDetectionApi.js';
import type { AuthenticatedUser } from '../server/auth.js';

interface TestCase {
  name: string;
  run: () => void | Promise<void>;
}

const tests: TestCase[] = [];
function test(name: string, run: () => void | Promise<void>) {
  tests.push({ name, run });
}

function createMockReqRes(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  const req = new EventEmitter() as IncomingMessage & {
    method: string;
    url: string;
    headers: Record<string, string>;
    socket: { remoteAddress: string };
  };
  req.method = options.method;
  req.url = options.url;
  req.headers = options.headers || {};
  req.socket = { remoteAddress: '127.0.0.1' } as any;

  let statusCode = 200;
  const responseHeaders: Record<string, string> = {};
  let rawBody = '';

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(key: string, val: string) {
      responseHeaders[key.toLowerCase()] = String(val);
    },
    getHeader(key: string) {
      return responseHeaders[key.toLowerCase()];
    },
    end(chunk?: string | Buffer) {
      if (chunk) rawBody += chunk.toString();
    },
  } as unknown as ServerResponse;

  const triggerBody = () => {
    if (options.body !== undefined) {
      const payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.emit('data', Buffer.from(payload, 'utf8'));
    }
    req.emit('end');
  };

  return {
    req,
    res,
    triggerBody,
    getResult: () => ({
      status: statusCode,
      headers: responseHeaders,
      json: rawBody ? JSON.parse(rawBody) : null,
    }),
  };
}

async function callUpiApi(options: {
  method: string;
  pathname: string;
  token?: string;
  body?: unknown;
  authUser?: AuthenticatedUser | null;
}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const mock = createMockReqRes({
    method: options.method,
    url: options.pathname,
    headers,
    body: options.body,
  });
  const promise =
    options.authUser !== undefined
      ? handleUpiDetectionRequest(mock.req, mock.res, options.pathname, options.method, async () => options.authUser!)
      : handleUpiDetectionRequest(mock.req, mock.res, options.pathname, options.method);
  queueMicrotask(() => mock.triggerBody());
  const handled = await promise;
  return { handled, ...mock.getResult() };
}

// ============================================================================
// SCENARIOS 1 - 16: PARSERS, REJECTION RULES, DEDUPLICATION, MAPPING, MASKING
// ============================================================================

test('01. Google Pay outgoing payment extracts exact paise, merchant, UTR & Txn ID', () => {
  const res = parseUpiNotification({
    packageName: 'com.google.android.apps.nbu.paisa.user',
    title: 'Paid ₹345.50 to Swiggy',
    text: 'UPI payment successful. UTR: 432918273645. Txn ID: GPAY9876543210',
    notificationTimestamp: '2026-11-25T10:15:00.000Z',
  });
  assert.equal(res.accepted, true);
  assert.equal(res.shouldTriggerPopup, true);
  assert.equal(res.parserUsed, 'GooglePayNotificationParser');
  assert.equal(res.parserVersion, PARSER_VERSION);
  assert.equal(res.transaction?.amountPaise, 34550);
  assert.equal(res.transaction?.amountRupees, 345.5);
  assert.equal(res.transaction?.sourceApp, 'Google Pay');
  assert.equal(res.transaction?.merchantName, 'Swiggy');
  assert.equal(res.transaction?.utrNumber, '432918273645');
  assert.equal(res.transaction?.upiTransactionId, 'GPAY9876543210');
  assert.equal(res.transaction?.verificationStatus, 'verified');
});

test('02. PhonePe outgoing payment extracts merchant, explicit VPA, and UTR', () => {
  const res = parseUpiNotification({
    packageName: 'com.phonepe.app',
    title: 'Money Sent',
    text: 'Paid ₹1,240 to DMart Ready (dmart@okicici). UTR No: 512098765432',
  });
  assert.equal(res.accepted, true);
  assert.equal(res.parserUsed, 'PhonePeNotificationParser');
  assert.equal(res.transaction?.amountPaise, 124000);
  assert.equal(res.transaction?.merchantName, 'DMart Ready');
  assert.equal(res.transaction?.upiId, 'dmart@okicici');
  assert.equal(res.transaction?.utrNumber, '512098765432');
});

test('03. Paytm outgoing payment without UTR preserves null references (never fabricated)', () => {
  const res = parseUpiNotification({
    packageName: 'net.one97.paytm',
    title: 'Payment Successful',
    text: 'Paid Rs. 500 to Indian Oil Fuel Station via Paytm UPI.',
  });
  assert.equal(res.accepted, true);
  assert.equal(res.parserUsed, 'PaytmNotificationParser');
  assert.equal(res.transaction?.amountPaise, 50000);
  assert.equal(res.transaction?.merchantName, 'Indian Oil Fuel Station');
  assert.equal(res.transaction?.utrNumber, null);
  assert.equal(res.transaction?.upiTransactionId, null);
  assert.equal(res.transaction?.rrn, null);
  assert.equal(res.transaction?.upiId, null);
  assert.equal(res.transaction?.verificationStatus, 'partial');
});

test('04. BHIM UPI outgoing payment extracts RRN and merchant', () => {
  const res = parseUpiNotification({
    packageName: 'in.org.npci.upiapp',
    title: 'BHIM UPI Debit',
    text: '₹680 debited for Apollo Pharmacy. RRN: 609812345678',
  });
  assert.equal(res.accepted, true);
  assert.equal(res.parserUsed, 'BHIMNotificationParser');
  assert.equal(res.transaction?.amountPaise, 68000);
  assert.equal(res.transaction?.merchantName, 'Apollo Pharmacy');
  assert.equal(res.transaction?.rrn, '609812345678');
});

test('05. Generic UPI (Amazon Pay) outgoing payment parses cleanly', () => {
  const res = parseUpiNotification({
    packageName: 'in.amazon.mShop.android.shopping',
    title: 'Amazon Pay UPI',
    text: 'Payment of ₹1,499 to Flipkart Grocery successful. Ref: 778899001122',
  });
  assert.equal(res.accepted, true);
  assert.equal(res.parserUsed, 'GenericUpiNotificationParser');
  assert.equal(res.transaction?.sourceApp, 'Amazon Pay UPI');
  assert.equal(res.transaction?.amountPaise, 149900);
  assert.equal(res.transaction?.utrNumber, '778899001122');
});

test('06. Incoming UPI credit notification is strictly rejected', () => {
  const res = parseUpiNotification({
    packageName: 'com.phonepe.app',
    title: 'Money Received',
    text: 'You received ₹2,500 from Amit Verma via PhonePe UPI.',
  });
  assert.equal(res.accepted, false);
  assert.equal(res.shouldTriggerPopup, false);
  assert.equal(res.rejectionReason, 'incoming_transfer_ignored');
  assert.equal(res.transaction, null);
});

test('07. Failed & reversed payment notifications are strictly rejected', () => {
  const failed = parseUpiNotification({
    packageName: 'com.google.android.apps.nbu.paisa.user',
    title: 'Payment Failed',
    text: 'Your payment of ₹499 to Zomato failed due to bank server timeout.',
  });
  assert.equal(failed.accepted, false);
  assert.equal(failed.rejectionReason, 'failed_or_reversed_payment');

  const reversed = parseUpiNotification({
    packageName: 'net.one97.paytm',
    title: 'Payment Reversed',
    text: 'Paid ₹299 to Uber was reversed to your bank account.',
  });
  assert.equal(reversed.accepted, false);
  assert.equal(reversed.rejectionReason, 'failed_or_reversed_payment');
});

test('08. Pending / processing payment notifications are not logged prematurely', () => {
  const res = parseUpiNotification({
    packageName: 'com.phonepe.app',
    title: 'Payment Pending',
    text: 'Payment of ₹750 to Electricity Board is processing. Awaiting bank confirmation.',
  });
  assert.equal(res.accepted, false);
  assert.equal(res.rejectionReason, 'pending_payment_not_final');
});

test('09. OTP, UPI PIN, promotional cashback & collect requests are strictly rejected', () => {
  const cases = [
    {
      packageName: 'com.google.android.apps.nbu.paisa.user',
      title: 'Security Code',
      text: 'Your OTP is 482910 for UPI PIN reset. Do not share with anyone.',
    },
    {
      packageName: 'com.phonepe.app',
      title: 'Collect Request',
      text: 'Rahul has requested ₹500 on PhonePe. Tap to pay.',
    },
    {
      packageName: 'net.one97.paytm',
      title: 'Scratch Card Unlocked!',
      text: 'Win upto ₹100 cashback offer when you refer and earn today.',
    },
    {
      packageName: 'in.org.npci.upiapp',
      title: 'Account Balance',
      text: 'Your available balance is ₹14,500.00.',
    },
  ];
  for (const sample of cases) {
    const res = parseUpiNotification(sample);
    assert.equal(res.accepted, false, `Expected rejection for: ${sample.title}`);
    assert.equal(res.rejectionReason, 'sensitive_or_non_payment_notification');
  }
});

test('10. Missing amount or unsupported foreign currency is rejected (never fabricated)', () => {
  const noAmount = parseUpiNotification({
    packageName: 'com.google.android.apps.nbu.paisa.user',
    title: 'Payment Successful',
    text: 'You paid Swiggy via Google Pay.',
  });
  assert.equal(noAmount.accepted, false);
  assert.equal(noAmount.rejectionReason, 'missing_or_unsupported_amount');

  const usdOnly = parseUpiNotification({
    packageName: 'com.google.android.apps.nbu.paisa.user',
    title: 'Paid $25.00 to Steam',
    text: 'Card payment of USD 25.00 successful.',
  });
  assert.equal(usdOnly.accepted, false);
  assert.equal(usdOnly.rejectionReason, 'missing_or_unsupported_amount');
});

test('11. Missing merchant name remains null instead of inventing placeholder text', () => {
  const res = parseUpiNotification({
    packageName: 'com.phonepe.app',
    title: 'Payment Successful',
    text: 'Debited by ₹199 via UPI. UTR: 998877665544',
  });
  assert.equal(res.accepted, true);
  assert.equal(res.transaction?.amountPaise, 19900);
  assert.equal(res.transaction?.merchantName, null);
  assert.equal(res.transaction?.utrNumber, '998877665544');
});

test('12. Duplicate notifications (same UTR / Txn ID / hash) deduplicate cleanly', () => {
  const first = parseUpiNotification({
    packageName: 'com.google.android.apps.nbu.paisa.user',
    title: 'Paid ₹250 to Cafe Coffee Day',
    text: 'UPI payment successful. UTR: 445566778899',
    notificationTimestamp: '2026-11-25T11:00:00.000Z',
  }).transaction!;

  const duplicateWithMoreMeta = parseUpiNotification({
    packageName: 'com.google.android.apps.nbu.paisa.user',
    title: 'Paid ₹250 to Cafe Coffee Day',
    text: 'UPI payment successful. UTR: 445566778899. Txn ID: GPAY11223344',
    notificationTimestamp: '2026-11-25T11:00:05.000Z',
  }).transaction!;

  const dedup = deduplicateDetectedTransaction(duplicateWithMoreMeta, [first]);
  assert.equal(dedup.isDuplicate, true);
  assert.equal(dedup.matchReason, 'utr_number');
  assert.equal(dedup.mergedRecord.id, first.id);
  // Enriched metadata merged without creating a second expense
  assert.equal(dedup.mergedRecord.upiTransactionId, 'GPAY11223344');
});

test('13. Multiple legitimate identical-amount payments are NOT erroneously merged', () => {
  const tea1 = parseUpiNotification({
    packageName: 'com.phonepe.app',
    title: 'Paid ₹20 to Chai Point',
    text: 'Paid ₹20 to Chai Point. UTR: 100000000001',
    notificationTimestamp: '2026-11-25T09:00:00.000Z',
  }).transaction!;

  const tea2DistinctUtr = parseUpiNotification({
    packageName: 'com.phonepe.app',
    title: 'Paid ₹20 to Chai Point',
    text: 'Paid ₹20 to Chai Point. UTR: 100000000002',
    notificationTimestamp: '2026-11-25T09:00:04.000Z',
  }).transaction!;

  const dedupDistinct = deduplicateDetectedTransaction(tea2DistinctUtr, [tea1]);
  assert.equal(dedupDistinct.isDuplicate, false);

  // Even without UTR, payments separated by >15s with different raw hashes remain distinct
  const metro1 = parseUpiNotification({
    packageName: 'net.one97.paytm',
    title: 'Paid ₹40 to Delhi Metro',
    text: 'Paid ₹40 to Delhi Metro at 09:00',
    notificationTimestamp: '2026-11-25T09:00:00.000Z',
  }).transaction!;
  const metro2 = parseUpiNotification({
    packageName: 'net.one97.paytm',
    title: 'Paid ₹40 to Delhi Metro',
    text: 'Paid ₹40 to Delhi Metro at 09:03',
    notificationTimestamp: '2026-11-25T09:03:00.000Z',
  }).transaction!;

  const dedupSeparated = deduplicateDetectedTransaction(metro2, [metro1]);
  assert.equal(dedupSeparated.isDuplicate, false);
});

test('14. Disabled payment app toggle prevents parsing for that app', () => {
  const res = parseUpiNotification(
    {
      packageName: 'com.phonepe.app',
      title: 'Paid ₹300 to Swiggy',
      text: 'UPI payment successful.',
    },
    { google_pay: true, phonepe: false }
  );
  assert.equal(res.accepted, false);
  assert.equal(res.rejectionReason, 'app_disabled_by_user');
});

test('15. All 13 required UPI popup categories map cleanly to ExpenseContext payloads', () => {
  const expectedCategories = [
    'Food',
    'Groceries',
    'Fuel',
    'Shopping',
    'Travel',
    'Bills',
    'Medical',
    'Education',
    'Entertainment',
    'Rent',
    'Recharge',
    'Personal',
    'Other',
  ];
  assert.deepEqual(
    UPI_EXPENSE_CATEGORIES.map((c) => c.id),
    expectedCategories
  );
  assert.ok(SUPPORTED_UPI_APPS.length >= 5);

  const sampleTx = parseUpiNotification({
    packageName: 'com.google.android.apps.nbu.paisa.user',
    title: 'Paid ₹420.75 to Blinkit',
    text: 'UPI payment successful. UTR: 556677889900',
    notificationTimestamp: '2026-11-25T12:30:00.000Z',
  }).transaction!;

  for (const cat of UPI_EXPENSE_CATEGORIES) {
    const payload = mapUpiCategoryToExpensePayload(sampleTx, cat.id, `Test ${cat.id}`);
    assert.equal(payload.transaction_type, 'expense');
    assert.equal(payload.amount, 420.75);
    assert.equal(payload.metadata?.payment_method, 'upi');
    assert.equal(payload.metadata?.utr, '556677889900');
    assert.equal(payload.metadata?.upi_popup_category, cat.id);
    assert.equal(payload.metadata?.detected_transaction_id, sampleTx.id);
    assert.match(payload.transaction_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(payload.transaction_time, /^\d{2}:\d{2}$/);
  }
});

test('16. Log sanitizer masks OTPs, PINs, UPI handles, and long numeric references', () => {
  const masked = maskSensitiveLogPayload(
    'OTP: 492817 UPI PIN 1234 paid rahul.sharma@okaxis UTR 432918273645'
  );
  assert.ok(!masked.includes('492817'), 'OTP must be redacted');
  assert.ok(!masked.includes('1234'), 'UPI PIN must be redacted');
  assert.ok(!masked.includes('rahul.sharma@okaxis'), 'Full UPI handle must be masked');
  assert.ok(!masked.includes('432918273645'), 'Full UTR must be masked');
});

test('17. Native bridge never assumes granted & detects OS permission revocation', () => {
  // Outside Android WebView -> accurately reports desktop_web & not_supported
  assert.equal(detectRuntimePlatform(), 'desktop_web');
  assert.equal(verifyNotificationAccessStatus(true), 'not_supported');
  assert.equal(openAndroidNotificationSettings().opened, false);

  // Simulate Android Native Bridge attached with denied -> granted -> revoked transitions
  let simulatedOsGrant = false;
  (globalThis as any).window = {
    HackifyProUpiBridge: {
      getNotificationAccessStatus: () => (simulatedOsGrant ? 'granted' : 'not_granted'),
      openNotificationAccessSettings: () => true,
      setDetectionEnabled: () => true,
      setAutoPopupEnabled: () => true,
      setSupportedAppsCsv: () => true,
      getPendingQueueJson: () => '[]',
      clearPendingQueueItem: () => true,
    },
  };
  try {
    assert.equal(openAndroidNotificationSettings().opened, true);
    // Opening Settings MUST NOT flip status to granted on its own!
    assert.equal(verifyNotificationAccessStatus(true), 'not_granted');
    // Once Android OS actually reports granted:
    simulatedOsGrant = true;
    assert.equal(verifyNotificationAccessStatus(true), 'granted');
    assert.equal(verifyNotificationAccessStatus(false), 'disabled');
    // Revocation in Android Settings immediately reflects as not_granted:
    simulatedOsGrant = false;
    assert.equal(verifyNotificationAccessStatus(true), 'not_granted');
  } finally {
    delete (globalThis as any).window;
  }
});

// ============================================================================
// SCENARIOS 18 - 19: BACKEND API AUTH, DEDUP, PENDING, CATEGORIZE, EDIT, RESET
// ============================================================================

test('18. Backend API /api/upi-detection/* rejects unauthenticated requests with 401', async () => {
  const res = await callUpiApi({
    method: 'GET',
    pathname: '/api/upi-detection/settings',
  });
  assert.equal(res.handled, true);
  assert.equal(res.status, 401);
  assert.equal(res.json?.code, 'UNAUTHORIZED');
});

test('19. Backend API full lifecycle: settings -> ingest -> dedup -> remind-later -> categorize -> idempotent save -> edit -> reset', async () => {
  __resetUpiDetectionMemoryStoreForTests();
  const mockUser: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'upi-test@hackifypro.in',
    full_name: 'UPI Test User',
    role: 'user',
    status: 'active',
    email_verified: true,
    force_password_reset: false,
    created_at: new Date().toISOString(),
    password_changed_at: new Date().toISOString(),
  };

  // 1. Default settings start disabled
  const initialSettings = await callUpiApi({
    method: 'GET',
    pathname: '/api/upi-detection/settings',
    authUser: mockUser,
  });
  assert.equal(initialSettings.status, 200);
  assert.equal(initialSettings.json.settings.enabled, false);

  // 2. While disabled, non-test ingestion is ignored safely
  const ignoredWhileDisabled = await callUpiApi({
    method: 'POST',
    pathname: '/api/upi-detection/ingest',
    authUser: mockUser,
    body: {
      packageName: 'com.google.android.apps.nbu.paisa.user',
      title: 'Paid ₹150 to Zomato',
      text: 'UPI payment successful. UTR: 123456789012',
    },
  });
  assert.equal(ignoredWhileDisabled.status, 200);
  assert.equal(ignoredWhileDisabled.json.accepted, false);
  assert.equal(ignoredWhileDisabled.json.reason, 'detection_disabled_by_user');

  // 3. Enable automatic detection
  const enabledRes = await callUpiApi({
    method: 'PUT',
    pathname: '/api/upi-detection/settings',
    authUser: mockUser,
    body: { enabled: true, autoPopupEnabled: true, onboardingCompleted: true },
  });
  assert.equal(enabledRes.status, 200);
  assert.equal(enabledRes.json.settings.enabled, true);

  // 4. Ingest valid Google Pay outgoing notification
  const ingest1 = await callUpiApi({
    method: 'POST',
    pathname: '/api/upi-detection/ingest',
    authUser: mockUser,
    body: {
      packageName: 'com.google.android.apps.nbu.paisa.user',
      title: 'Paid ₹350 to Zomato',
      text: 'UPI payment successful. UTR: 889900112233',
    },
  });
  assert.equal(ingest1.status, 200);
  assert.equal(ingest1.json.accepted, true);
  assert.equal(ingest1.json.deduplicated, false);
  assert.equal(ingest1.json.shouldShowPopup, true);
  const detectedId = ingest1.json.transaction.id as string;
  assert.equal(ingest1.json.transaction.amountPaise, 35000);

  // 5. Re-ingest duplicate notification -> deduplicated, no second popup
  const ingestDup = await callUpiApi({
    method: 'POST',
    pathname: '/api/upi-detection/ingest',
    authUser: mockUser,
    body: {
      packageName: 'com.google.android.apps.nbu.paisa.user',
      title: 'Paid ₹350 to Zomato',
      text: 'UPI payment successful. UTR: 889900112233',
    },
  });
  assert.equal(ingestDup.status, 200);
  assert.equal(ingestDup.json.deduplicated, true);
  assert.equal(ingestDup.json.shouldShowPopup, false);
  assert.equal(ingestDup.json.transaction.id, detectedId);

  // 6. Remind Me Later keeps it in pending queue
  const remind = await callUpiApi({
    method: 'POST',
    pathname: `/api/upi-detection/${detectedId}/remind-later`,
    authUser: mockUser,
  });
  assert.equal(remind.status, 200);
  assert.equal(remind.json.transaction.categorizationStatus, 'remind_later');

  const pendingList = await callUpiApi({
    method: 'GET',
    pathname: '/api/upi-detection/pending',
    authUser: mockUser,
  });
  assert.equal(pendingList.status, 200);
  assert.equal(pendingList.json.counts.pending, 1);

  // 7. Categorize -> saves category + description; re-categorize is idempotent
  const cat1 = await callUpiApi({
    method: 'POST',
    pathname: `/api/upi-detection/${detectedId}/categorize`,
    authUser: mockUser,
    body: { category: 'Food', description: 'Dinner order', linkedExpenseId: 'exp_101' },
  });
  assert.equal(cat1.status, 200);
  assert.equal(cat1.json.alreadyCategorized, false);
  assert.equal(cat1.json.transaction.categorizationStatus, 'categorized');

  const cat2 = await callUpiApi({
    method: 'POST',
    pathname: `/api/upi-detection/${detectedId}/categorize`,
    authUser: mockUser,
    body: { category: 'Food', description: 'Dinner order', linkedExpenseId: 'exp_101' },
  });
  assert.equal(cat2.status, 200);
  assert.equal(cat2.json.alreadyCategorized, true);

  // 8. Edit category/description preserves original UTR & amount
  const edited = await callUpiApi({
    method: 'PATCH',
    pathname: `/api/upi-detection/${detectedId}/edit`,
    authUser: mockUser,
    body: { category: 'Entertainment', description: 'Movie snacks' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.transaction.selectedCategory, 'Entertainment');
  assert.equal(edited.json.transaction.description, 'Movie snacks');
  assert.equal(edited.json.transaction.utrNumber, '889900112233');
  assert.equal(edited.json.transaction.amountPaise, 35000);

  // 9. Reset configuration clears history & restores defaults
  const reset = await callUpiApi({
    method: 'DELETE',
    pathname: '/api/upi-detection/reset',
    authUser: mockUser,
    body: { clearHistory: true },
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.settings.enabled, false);

  const afterReset = await callUpiApi({
    method: 'GET',
    pathname: '/api/upi-detection/pending',
    authUser: mockUser,
  });
  assert.equal(afterReset.json.counts.total, 0);
});

// ============================================================================
// SCENARIO 20: MIGRATION & NATIVE ANDROID MODULE INTEGRITY CHECK
// ============================================================================

test('20. SQL migration enforces integer paise & RLS; Android module declares NotificationListenerService', () => {
  const migrationSql = fs.readFileSync(
    path.resolve('scripts/migrations/20261125_upi_auto_detection.sql'),
    'utf8'
  );
  assert.ok(migrationSql.includes('amount_paise BIGINT NOT NULL'));
  assert.ok(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.detected_transactions'));
  assert.ok(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.expense_detection_settings'));
  assert.ok(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.transaction_detection_events'));
  assert.ok(migrationSql.includes('ENABLE ROW LEVEL SECURITY'));
  assert.ok(migrationSql.includes('auth.uid() = user_id'));

  const manifestXml = fs.readFileSync(
    path.resolve('android-upi-listener/src/main/AndroidManifest.xml'),
    'utf8'
  );
  assert.ok(manifestXml.includes('BIND_NOTIFICATION_LISTENER_SERVICE'));
  assert.ok(!manifestXml.includes('SYSTEM_ALERT_WINDOW'), 'Must not request invasive overlay permission');

  const listenerKt = fs.readFileSync(
    path.resolve('android-upi-listener/src/main/java/com/hackifypro/mymoney/upi/UpiNotificationListenerService.kt'),
    'utf8'
  );
  assert.ok(listenerKt.includes('class UpiNotificationListenerService : NotificationListenerService()'));
});

async function main() {
  let passed = 0;
  let failed = 0;
  console.log(`\nRunning Automatic UPI Payment Detection Test Suite (${tests.length} scenarios)...\n`);

  for (const t of tests) {
    try {
      await t.run();
      console.log(`  PASS  ${t.name}`);
      passed += 1;
    } catch (err: any) {
      console.error(`  FAIL  ${t.name}`);
      console.error(`        ${err?.stack || err?.message || err}`);
      failed += 1;
    }
  }

  console.log(`\nUPI Detection Suite Summary: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main();
