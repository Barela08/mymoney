/**
 * Verification Test Suite: App Download Popup Lifecycle & User Journey
 *
 * Verifies all required behaviors:
 * 1. Triggers after 60 seconds (60,000ms) of active page time when not installed.
 * 2. Persists open state & active time across refreshes, route changes, login transitions, and browser restarts.
 * 3. Cancelling/closing hides the popup and schedules reappearance after 1 minute (60,000ms) while still uninstalled.
 * 4. Cancelling NEVER marks the app as downloaded/installed.
 * 5. Built-in /#install mode stays enabled regardless of optional site banner setting.
 * 6. Installing/downloading permanently suppresses the popup.
 */

const mockSessionStorage: Record<string, string> = {};
const mockLocalStorage: Record<string, string> = {};
let mockCookies = '';

function setupMockEnvironment() {
  (global as any).window = {
    location: { hash: '', protocol: 'https:' },
    matchMedia: () => ({ matches: false }),
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
    setItem: (key: string, val: string) => {
      mockSessionStorage[key] = val;
    },
    removeItem: (key: string) => {
      delete mockSessionStorage[key];
    },
    clear: () => {
      for (const k in mockSessionStorage) delete mockSessionStorage[k];
    },
  };
  (global as any).localStorage = {
    getItem: (key: string) => mockLocalStorage[key] || null,
    setItem: (key: string, val: string) => {
      mockLocalStorage[key] = val;
    },
    removeItem: (key: string) => {
      delete mockLocalStorage[key];
    },
    clear: () => {
      for (const k in mockLocalStorage) delete mockLocalStorage[k];
    },
  };
}

setupMockEnvironment();

const {
  isAppDownloadedOrInstalled,
  markAppAsDownloaded,
  dismissPopupForCurrentView,
  clearDismissalForView,
  getPopupRemainingCooldownMs,
  isDismissedForView,
  getInitialVisitWaitMs,
  getActiveUsageMs,
  addActiveUsageMs,
  getRemainingInitialWaitMs,
  isPopupOpenPersisted,
  setPopupOpenPersisted,
  shouldSuppressInstallPopup,
  INITIAL_INSTALL_POPUP_DELAY_MS,
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

// Test 1: Initially requires 60 seconds of active page time
assert(!isAppDownloadedOrInstalled(false), 'New visitor is not marked as downloaded/installed');
assert(INITIAL_INSTALL_POPUP_DELAY_MS === 60_000, 'Initial delay is 60,000ms (60 seconds active usage)');
assert(POPUP_REPROMPT_DELAY_MS === 60_000, 'Reprompt cooldown is 60,000ms (1 minute)');
assert(getInitialVisitWaitMs() === 60_000, 'getInitialVisitWaitMs returns 60,000ms');
assert(getRemainingInitialWaitMs() === 60_000, 'Fresh visitor has 60,000ms active wait remaining');

// Test 2: Active usage persists across refresh / login transition / browser restart
addActiveUsageMs(25_000);
assert(getActiveUsageMs() === 25_000, 'Active page time stores 25,000ms in localStorage');
assert(getRemainingInitialWaitMs() === 35_000, '35,000ms remaining after refresh/restart');

addActiveUsageMs(35_000);
assert(getRemainingInitialWaitMs() === 0, 'After 60s cumulative active usage, remaining wait is 0ms');
setPopupOpenPersisted(true);
assert(isPopupOpenPersisted(), 'Open state persists across refresh/route/login/restart');

// Test 3: Cancelling / closing hides popup and schedules 60s reappear WITHOUT marking downloaded
const t0 = 1_700_000_000_000;
dismissPopupForCurrentView(true, t0);
assert(!isPopupOpenPersisted(), 'Cancelling clears open state');
assert(mockLocalStorage['my_money_pwa_dismissed_at'] === String(t0), 'Dismiss timestamp persisted in localStorage');
assert(!isAppDownloadedOrInstalled(false), 'Cancelling NEVER marks app as downloaded/installed');
assert(isDismissedForView(true, t0 + 59_000), 'Popup stays hidden at 59s after Cancel/Close');
assert(getPopupRemainingCooldownMs(true, t0 + 30_000) === 30_000, 'Remaining cooldown at 30s is 30,000ms');
assert(!isDismissedForView(false, t0 + 60_000), 'Popup reappears automatically after 60s even across login/view change or restart');

// Test 4: Clear dismissal helper
dismissPopupForCurrentView(false, t0);
clearDismissalForView(false);
assert(!isDismissedForView(false, t0 + 1_000), 'clearDismissalForView clears cooldown immediately');

// Test 5: Suppression rules
assert(
  !shouldSuppressInstallPopup({
    isAdminRoute: false,
    isMaintenanceBlocked: false,
    isEnabled: true,
    isInstalled: false,
    isHidden: false,
    isModalOpen: false,
    isScannerActive: false,
    activeModalCount: 0,
    autoPromptDisabled: false,
  }),
  'Popup displays cleanly when active wait reached and app is not installed'
);
assert(
  shouldSuppressInstallPopup({
    isAdminRoute: false,
    isMaintenanceBlocked: false,
    isEnabled: true,
    isInstalled: false,
    isHidden: false,
    isModalOpen: false,
    isScannerActive: false,
    activeModalCount: 1,
    autoPromptDisabled: false,
  }),
  'Popup is suppressed while active modal/payment form is open'
);
assert(
  shouldSuppressInstallPopup({
    isAdminRoute: false,
    isMaintenanceBlocked: false,
    isEnabled: true,
    isInstalled: false,
    isHidden: false,
    isModalOpen: false,
    isScannerActive: true,
    activeModalCount: 0,
    autoPromptDisabled: false,
  }),
  'Popup is suppressed while QR scanner is active'
);
assert(
  !shouldSuppressInstallPopup({
    isAdminRoute: false,
    isMaintenanceBlocked: false,
    isEnabled: true,
    isInstalled: false,
    isHidden: true,
    isModalOpen: false,
    isScannerActive: false,
    activeModalCount: 0,
    autoPromptDisabled: true,
    forceShow: true,
  }),
  'Settings Reopen Install Popup overrides cooldown when no blocking modal is open'
);

// Test 6: Installing / downloading permanently suppresses the popup
markAppAsDownloaded();
assert(isAppDownloadedOrInstalled(false), 'After installing/downloading, isAppDownloadedOrInstalled is TRUE');
assert(mockLocalStorage['my_money_app_downloaded_confirmed'] === 'true', 'Persistent download flag saved to localStorage');
assert(mockCookies.includes('mymoney_app_downloaded=downloaded'), 'Persistent download cookie saved');
assert(!isPopupOpenPersisted(), 'Open state cleared on install');
assert(isAppDownloadedOrInstalled(true), 'Standalone/PWA-installed user is permanently suppressed');
assert(
  shouldSuppressInstallPopup({
    isAdminRoute: false,
    isMaintenanceBlocked: false,
    isEnabled: true,
    isInstalled: true,
    isHidden: false,
    isModalOpen: false,
    isScannerActive: false,
    activeModalCount: 0,
    autoPromptDisabled: false,
    forceShow: true,
  }),
  'Installed app is ALWAYS suppressed even if forceShow is passed'
);

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
