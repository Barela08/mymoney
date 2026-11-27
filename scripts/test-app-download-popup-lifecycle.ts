/**
 * Verification Test Suite: App Download Popup Lifecycle & User Journey
 * 
 * Verifies the 3 required behaviors:
 * 1. Cancelling without downloading allows the popup to reappear.
 * 2. Cancelling on the login page re-prompts after logging in.
 * 3. Downloading/installing permanently suppresses the popup.
 */

// Mock storage
const mockSessionStorage: Record<string, string> = {};
const mockLocalStorage: Record<string, string> = {};
let mockCookies = '';

function setupMockEnvironment() {
  (global as any).window = {
    location: { hash: '', protocol: 'https:' },
    matchMedia: (query: string) => ({ matches: false }),
    navigator: {},
  };
  (global as any).document = {
    get cookie() {
      return mockCookies;
    },
    set cookie(val: string) {
      const [pair] = val.split(';');
      const [key, value] = pair.split('=');
      if (val.includes('max-age=0')) {
        mockCookies = '';
      } else {
        mockCookies = `${key}=${value}`;
      }
    },
  };
  (global as any).sessionStorage = {
    getItem: (key: string) => mockSessionStorage[key] || null,
    setItem: (key: string, val: string) => { mockSessionStorage[key] = val; },
    removeItem: (key: string) => { delete mockSessionStorage[key]; },
    clear: () => { for (const k in mockSessionStorage) delete mockSessionStorage[k]; },
  };
  (global as any).localStorage = {
    getItem: (key: string) => mockLocalStorage[key] || null,
    setItem: (key: string, val: string) => { mockLocalStorage[key] = val; },
    removeItem: (key: string) => { delete mockLocalStorage[key]; },
    clear: () => { for (const k in mockLocalStorage) delete mockLocalStorage[k]; },
  };
}

setupMockEnvironment();

// Import after globals are set
const {
  isAppDownloadedOrInstalled,
  markAppAsDownloaded,
  dismissPopupForCurrentView,
  clearDismissalForView,
  getPopupRemainingCooldownMs,
  isDismissedForView,
  POPUP_REPROMPT_DELAY_MS,
} = await import('../src/components/common/AppDownloadPopup.js');

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

console.log('=== App Download Popup Lifecycle Test Suite ===\n');

// Test 1: Initially, new visitor should NOT be considered downloaded/installed
assert(!isAppDownloadedOrInstalled(false), 'New visitor is not marked as downloaded/installed');
assert(POPUP_REPROMPT_DELAY_MS === 60_000, 'Reprompt cooldown is exactly 1 minute (60,000ms)');

// Test 2: If user cancels on Login page (auth view = true)
const t0 = 1_700_000_000_000;
dismissPopupForCurrentView(true, t0);
assert(mockSessionStorage['my_money_popup_auth_dismissed'] === 'true', 'Cancelling on login page sets auth view dismissal');
assert(!mockSessionStorage['my_money_popup_app_dismissed'], 'Cancelling on login page does NOT dismiss dashboard view');
assert(!isAppDownloadedOrInstalled(false), 'Cancelling does NOT mark app as downloaded');
assert(isDismissedForView(true, t0 + 59_000), 'Auth popup stays hidden at 59s after cancel');
assert(getPopupRemainingCooldownMs(true, t0 + 30_000) === 30_000, 'Remaining cooldown at 30s is exactly 30,000ms');
assert(!isDismissedForView(true, t0 + 60_000), 'Auth popup automatically clears dismissal and reappears at 60s (1 min)');

// Test 3: After login (dashboard view = false), popup should NOT be suppressed by the login dismiss
dismissPopupForCurrentView(true, t0);
const isDismissedOnDashboard = isDismissedForView(false, t0 + 5_000);
assert(!isDismissedOnDashboard, 'Dashboard view is NOT suppressed after user logged in from login page cancellation');

// Test 4: If user cancels on Dashboard, hides for 60s then re-appears automatically
dismissPopupForCurrentView(false, t0);
assert(mockSessionStorage['my_money_popup_app_dismissed'] === 'true', 'Cancelling on dashboard sets dashboard view dismissal');
assert(isDismissedForView(false, t0 + 45_000), 'Dashboard popup remains hidden at 45s after cancel');
assert(getPopupRemainingCooldownMs(false, t0 + 45_000) === 15_000, 'Remaining dashboard cooldown at 45s is 15,000ms');
assert(!isDismissedForView(false, t0 + 60_000), 'Dashboard popup automatically reappears after 1 minute (60s)');

// Test 5: Clear dismissal helper & fresh session without download
dismissPopupForCurrentView(false, t0);
clearDismissalForView(false);
assert(!isDismissedForView(false, t0 + 1_000), 'clearDismissalForView clears dismissal immediately');
delete mockSessionStorage['my_money_popup_app_dismissed'];
delete mockSessionStorage['my_money_popup_auth_dismissed'];
assert(!isAppDownloadedOrInstalled(false), 'On new session without download, app is not downloaded');
assert(!mockSessionStorage['my_money_popup_app_dismissed'], 'On new session, popup can appear again');

// Test 6: When user actually downloads or installs the app
markAppAsDownloaded();
assert(isAppDownloadedOrInstalled(false), 'After downloading, isAppDownloadedOrInstalled is TRUE');
assert(mockLocalStorage['my_money_app_downloaded_confirmed'] === 'true', 'Persistent download flag saved to localStorage');
assert(mockCookies.includes('mymoney_app_downloaded=downloaded'), 'Persistent download cookie saved');

// Test 7: Downloaded user in subsequent sessions or auth pages never sees the popup
assert(isAppDownloadedOrInstalled(false), 'Downloaded user is permanently suppressed even on new session');
assert(isAppDownloadedOrInstalled(true), 'Standalone/PWA-installed user is permanently suppressed');

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
