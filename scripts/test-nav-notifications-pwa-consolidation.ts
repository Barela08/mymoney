import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { maskFinancialData } from '../server/notificationService';

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

function readPngDimensions(relPath: string): { width: number; height: number } {
  const buf = fs.readFileSync(path.resolve(process.cwd(), relPath));
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${relPath} must be valid PNG`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  console.log(`  PASS: ${label}`);
  passed++;
}

console.log('=== Navigation, Notification Branding, Privacy & PWA Verification ===\n');

check('1. Official PWA & notification icon assets exist with exact PNG dimensions', () => {
  assert.deepEqual(readPngDimensions('public/notification-badge-96.png'), { width: 96, height: 96 });
  assert.deepEqual(readPngDimensions('public/apple-touch-icon.png'), { width: 180, height: 180 });
  assert.deepEqual(readPngDimensions('public/icon-512-maskable.png'), { width: 512, height: 512 });
  assert.deepEqual(readPngDimensions('public/icon-192.png'), { width: 192, height: 192 });
  assert.deepEqual(readPngDimensions('public/icon-512.png'), { width: 512, height: 512 });
  assert.deepEqual(
    readPngDimensions('android-upi-listener/src/main/res/drawable-xxhdpi/ic_notification.png'),
    { width: 96, height: 96 }
  );
});

check('2. Service worker, manifest, index.html & Android listener use monochrome notification badge', () => {
  const sw = read('public/sw.js');
  assert(sw.includes("'/notification-badge-96.png'"), 'sw.js precaches and uses /notification-badge-96.png');
  assert(!sw.includes("badge: '/icon-192.png'"), 'sw.js does NOT fall back to full-color icon-192 for badge');

  const html = read('index.html');
  assert(html.includes('/apple-touch-icon.png'), 'index.html declares apple-touch-icon.png');

  const manifest = JSON.parse(read('public/manifest.json'));
  assert(
    manifest.icons.some((i: any) => i.src === '/icon-512-maskable.png' && i.purpose === 'maskable'),
    'manifest.json includes 512 maskable icon'
  );
  assert(
    !manifest.shortcuts.some((s: any) => s.url === '/smart-alerts'),
    'manifest.json no longer uses legacy /smart-alerts shortcut'
  );

  const kt = read('android-upi-listener/src/main/java/com/hackifypro/mymoney/upi/UpiNotificationListenerService.kt');
  assert(kt.includes('R.drawable.ic_notification'), 'Android notification listener uses R.drawable.ic_notification');
  assert(!kt.includes('android.R.drawable.ic_dialog_info'), 'Android notification listener removed generic ic_dialog_info');
});

check('3. Sidebar, MobileNav, and Navbar enforce navigation consolidation & header gear icon', () => {
  const sidebar = read('src/components/common/Sidebar.tsx');
  assert(!sidebar.includes("id: 'settings'"), 'Sidebar removed Settings option');
  assert(!sidebar.includes("id: 'smart_alerts'"), 'Sidebar removed duplicate Smart Alerts option');
  assert(sidebar.includes("label: 'Notifications & Alerts'"), 'Sidebar exposes unified Notifications & Alerts');

  const mobileNav = read('src/components/common/MobileNav.tsx');
  assert(!mobileNav.includes("id: 'settings'"), 'MobileNav drawer removed Settings option');
  assert(!mobileNav.includes("onSelectTab('settings')"), 'MobileNav More sheet removed Settings option');
  assert(!mobileNav.includes("id: 'smart_alerts'"), 'MobileNav removed duplicate Smart Alerts option');
  assert(mobileNav.includes('data-testid="floating-notch-tab-bar"'), 'Mobile 6-tab bottom bar preserved');
  assert(mobileNav.includes('Notifications &amp; Alerts') || mobileNav.includes('Notifications & Alerts'), 'MobileNav shows unified Notifications & Alerts');

  const navbar = read('src/components/common/Navbar.tsx');
  assert(navbar.includes('data-testid="header-settings-button"'), 'Navbar includes top-right Settings gear icon');
  assert(navbar.includes('<NotificationBell'), 'Navbar includes NotificationBell beside Settings icon');
});

check('4. NotificationsSection provides unified filters and deduplicated smart alerts + notifications', () => {
  const notifSection = read('src/components/notifications/NotificationsSection.tsx');
  for (const label of [
    'All',
    'Notifications',
    'Alerts',
    'Reminders',
    'Security Alerts',
    'Transaction Updates',
    'Udhar Updates',
    'System Updates',
  ]) {
    assert(notifSection.includes(label), `NotificationsSection includes "${label}" filter`);
  }
  assert(notifSection.includes('ConfirmModal'), 'NotificationsSection includes Clear History confirmation modal');
});

check('5. SettingsSection exposes permanent App Installation section & Lock-Screen Privacy toggle', () => {
  const settings = read('src/components/settings/SettingsSection.tsx');
  assert(settings.includes('settings-app-install-section'), 'SettingsSection includes App Installation section');
  assert(settings.includes('Reopen Install Popup'), 'SettingsSection allows reopening cancelled install popup');
  assert(settings.includes('Lock-Screen Financial Privacy Mode'), 'SettingsSection exposes Lock-Screen Financial Privacy Mode');
});

check('6. Lock-screen financial privacy masking hides amounts & Udhar details', () => {
  const maskedTx = maskFinancialData('Paid ₹1,250.50 to Swiggy', false);
  assert(!maskedTx.includes('1,250') && maskedTx.includes('₹••••'), 'Masks rupee amounts accurately');

  const maskedUdhar = maskFinancialData('Rahul Sharma requested ₹2,500 on Udhar', true);
  assert(!maskedUdhar.includes('2,500'), 'Masks Udhar amount');
  assert(!maskedUdhar.includes('Rahul Sharma'), 'Masks Udhar counterparty name when maskUdharDetails is enabled');
});

console.log(`\nResults: ${passed} passed, 0 failed\n`);
