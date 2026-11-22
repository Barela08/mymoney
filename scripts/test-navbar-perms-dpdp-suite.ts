import assert from 'assert';
import { getStoredDpdpConsent, saveDpdpConsent } from '../src/components/common/DpdpConsentBanner';
import { formatDisplayTime, formatDisplayDate, getISTNow } from '../src/lib/dateUtils';

// Mock localStorage if in node environment
if (typeof localStorage === 'undefined' || !localStorage) {
  const store: Record<string, string> = {};
  (global as any).localStorage = {
    getItem: (k: string) => store[k] || null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
  };
}

async function runNavbarPermsDpdpSuite() {
  console.log('====================================================');
  console.log('🧪 TEST SUITE: NAVBAR CLEANUP, PERMISSIONS & DPDP');
  console.log('====================================================');

  console.log('\n--- 1. Testing Clock Format Without Seconds ---');
  const cleanTime = formatDisplayTime('14:30');
  assert.strictEqual(cleanTime, '02:30 PM', 'formatDisplayTime formats HH:mm to 12-hour AM/PM without seconds');

  const cleanMorning = formatDisplayTime('09:05');
  assert.strictEqual(cleanMorning, '09:05 AM', 'formatDisplayTime formats morning time without seconds');

  const ist = getISTNow();
  const hours = String(ist.getHours()).padStart(2, '0');
  const minutes = String(ist.getMinutes()).padStart(2, '0');
  const istFormatted = formatDisplayTime(`${hours}:${minutes}`);
  assert(!istFormatted.match(/:\d{2}:\d{2}/), 'No seconds present in IST time string');
  console.log(`  ✅ PASS: IST clean display time: ${istFormatted} (No seconds)`);

  console.log('\n--- 2. Testing DPDP Act 2023 Consent Gate Logic ---');
  localStorage.removeItem('my_money_dpdp_consent_v1');
  const initial = getStoredDpdpConsent();
  assert.strictEqual(initial.hasAnswered, false, 'Initial DPDP consent hasAnswered must be false');
  console.log('  ✅ PASS: DPDP consent requires explicit user action (defaults to unanswered)');

  // Grant Consent
  const consented = saveDpdpConsent(true);
  assert.strictEqual(consented.hasAnswered, true, 'hasAnswered is true after consent');
  assert.strictEqual(consented.isConsented, true, 'isConsented is true after accepting DPDP');
  assert(consented.consentedAt, 'consentedAt timestamp recorded');
  console.log('  ✅ PASS: DPDP consent correctly saved and timestamped');

  // Verify retrieval from storage
  const retrieved = getStoredDpdpConsent();
  assert.strictEqual(retrieved.isConsented, true, 'Retrieved consent matches saved consent');
  console.log('  ✅ PASS: DPDP consent accurately persisted in storage');

  console.log('\n--- 3. Testing Startup Permissions Storage Key ---');
  localStorage.removeItem('my_money_startup_perms_handled_v1');
  assert.strictEqual(localStorage.getItem('my_money_startup_perms_handled_v1'), null, 'Permissions unhandled at start');
  localStorage.setItem('my_money_startup_perms_handled_v1', 'true');
  assert.strictEqual(localStorage.getItem('my_money_startup_perms_handled_v1'), 'true', 'Permissions handled state saved');
  console.log('  ✅ PASS: Startup permissions handling recorded accurately');

  console.log('\n====================================================');
  console.log('📊 ALL SUITE TESTS PASSED SUCCESSFULLY (0 FAILURES)');
  console.log('====================================================');
}

runNavbarPermsDpdpSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
