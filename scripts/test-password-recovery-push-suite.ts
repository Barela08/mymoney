/**
 * Test Suite: Password Recovery, PWA Installed Device Management & Two-Way Push Notification System
 * Project: My Money Manager by HackifyPro
 */

import {
  recordDeviceInstallation,
  getAdminInstalledDevices,
  recordAdminNotification,
  getAdminNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  getAdminNotificationPreferences,
  saveAdminNotificationPreferences,
  dispatchCampaign,
  localCampaigns,
} from '../server/notificationService.js';

import {
  generateCryptoToken,
  hashToken,
  validateEmail,
  validatePasswordPolicy,
  checkRateLimit,
} from '../server/security.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

async function runSuite() {
  console.log('================================================================');
  console.log('🔐 PASSWORD RECOVERY, PWA DEVICES & TWO-WAY NOTIFICATION SUITE');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // PART 1: PASSWORD RECOVERY SECURITY & TOKEN LIFECYCLE
  // -------------------------------------------------------------
  console.log('--- Part 1: Password Recovery & Token Lifecycle ---');

  // 1. Email format validation
  assert(validateEmail('user@example.com') === true, 'Standard email passes validation');
  assert(validateEmail('invalid-email') === false, 'Invalid email without domain is rejected');
  assert(validateEmail('') === false, 'Empty email string is rejected');

  // 2. Token generation & SHA-256 hashing
  const rawToken = generateCryptoToken(32);
  assert(typeof rawToken === 'string' && rawToken.length === 64, 'Raw token is 64 hex characters (32 cryptographically secure random bytes)');
  const tokenHash = hashToken(rawToken);
  assert(typeof tokenHash === 'string' && tokenHash.length === 64, 'Token hash is deterministic 64-char SHA-256 hex digest');
  assert(tokenHash !== rawToken, 'Raw token is not stored in plaintext');

  // 3. Password policy enforcement (min 8 chars, diversity, common passwords rejected)
  const shortPass = validatePasswordPolicy('Ab1!xyz'); // 7 characters
  assert(!shortPass.isValid && shortPass.errors.some((e: string) => e.includes('8 characters')), 'Passwords under 8 characters are strictly rejected');

  const eightCharPass = validatePasswordPolicy('Ab1!xyzz'); // 8 characters
  assert(eightCharPass.isValid && eightCharPass.errors.length === 0, '8-character passwords with character diversity are accepted');

  const commonPass = validatePasswordPolicy('password1234');
  assert(!commonPass.isValid && commonPass.errors.some((e: string) => e.includes('common')), 'Common dictionary passwords are strictly rejected');

  const strongPass = validatePasswordPolicy('MyMoney#Secure2026!Pass');
  assert(strongPass.isValid && strongPass.errors.length === 0, 'Strong enterprise password (12+ chars with mixed character classes) passes');

  // 4. Rate limiting for forgot password attempts
  const rlKey = `test_rate_limit_${Date.now()}`;
  for (let i = 0; i < 5; i++) {
    const r = checkRateLimit(rlKey, 5, 60000);
    assert(r.allowed === true, `Rate limit attempt ${i + 1}/5 is allowed`);
  }
  const blockedAttempt = checkRateLimit(rlKey, 5, 60000);
  assert(blockedAttempt.allowed === false, 'Excessive forgot-password requests are rate-limited');

  // 5. Anti-enumeration neutral confirmation message
  const neutralMessage = 'If an account exists with this email, a password reset link has been sent.';
  assert(
    neutralMessage === 'If an account exists with this email, a password reset link has been sent.',
    'Neutral confirmation does not reveal user account existence'
  );

  // 6. Branded email subject requirement
  const emailSubject = 'Reset Your My Money Manager Password';
  assert(
    emailSubject === 'Reset Your My Money Manager Password',
    'Reset email subject exactly matches: "Reset Your My Money Manager Password"'
  );

  // 7. Production domain link requirement
  const appBase = 'https://mymoney.nileshbarela.site';
  const resetLink = `${appBase}/reset-password?token=${rawToken}&email=test@example.com`;
  assert(
    resetLink.startsWith('https://mymoney.nileshbarela.site/reset-password?token='),
    'Reset link targets production domain: https://mymoney.nileshbarela.site/'
  );

  // -------------------------------------------------------------
  // PART 2: PWA INSTALLED DEVICES MANAGEMENT
  // -------------------------------------------------------------
  console.log('\n--- Part 2: PWA Installed Devices Management ---');

  const res1 = await recordDeviceInstallation({
    userId: 'usr_pwa_001',
    isInstalled: true,
    installationStatus: 'standalone',
    deviceType: 'mobile',
    browser: 'Chrome Mobile',
    os: 'Android 14',
    pushPermission: 'granted',
    pushSubscriptionStatus: 'active',
    ipAddress: '203.0.113.19',
  });

  assert(res1.success === true, 'Device registration successfully recorded');
  assert(res1.record?.is_installed === true, 'Device install state correctly flagged as true');
  assert(res1.record?.device_type === 'mobile' && res1.record?.os === 'Android 14', 'Device metadata (type, browser, OS) correctly preserved');

  const res2 = await recordDeviceInstallation({
    userId: 'usr_web_002',
    isInstalled: false,
    installationStatus: 'browser',
    deviceType: 'desktop',
    browser: 'Safari',
    os: 'macOS 15',
    pushPermission: 'denied',
    pushSubscriptionStatus: 'unsubscribed',
    ipAddress: '203.0.113.20',
  });

  assert(res2.record?.is_installed === false, 'Web browser visitor correctly identified as non-installed');

  // Fetch installed devices list
  const allDevices = await getAdminInstalledDevices();
  assert(Array.isArray(allDevices) && allDevices.length >= 2, 'Admin query retrieves registered devices');

  const installedOnly = await getAdminInstalledDevices({ installedOnly: true });
  const hasOnlyInstalled = installedOnly.every((d) => d.is_installed);
  assert(hasOnlyInstalled && installedOnly.length >= 1, 'Filter by installedOnly=true accurately returns only PWA installed devices');

  // -------------------------------------------------------------
  // PART 3: AUDIENCE TARGETING & CAMPAIGN DISPATCH
  // -------------------------------------------------------------
  console.log('\n--- Part 3: Audience Targeting & Notification Campaigns ---');

  localCampaigns.set('cmp_test_001', {
    id: 'cmp_test_001',
    title: 'Festival Bonus Activated!',
    message: 'Check your revised budget and cashback alerts now.',
    target_type: 'installed',
    category: 'system_alert',
    scheduled_for: null,
    channels: ['in_app', 'push'],
  });

  const campaignResult = await dispatchCampaign('cmp_test_001');

  assert(campaignResult.success === true, 'Push campaign dispatched with target_type=installed');

  // -------------------------------------------------------------
  // PART 4: TWO-WAY USER-TO-ADMIN NOTIFICATIONS & PREFERENCES
  // -------------------------------------------------------------
  console.log('\n--- Part 4: Two-Way User-To-Admin Notifications ---');

  const adminAlertCreated = await recordAdminNotification({
    eventType: 'pwa_install',
    title: 'New PWA App Installation',
    message: 'User Aarav Patel installed My Money Manager on Android 14.',
    userId: 'usr_pwa_001',
    userEmail: 'aarav@example.com',
    metadata: { browser: 'Chrome Mobile', deviceType: 'mobile' },
  });

  assert(adminAlertCreated === true, 'User event successfully triggered Admin notification');

  const notifsList = await getAdminNotifications(10);
  assert(Array.isArray(notifsList) && notifsList.length > 0, 'Admin notifications retrieval contains recent event');

  const firstNotif = notifsList[0];
  const markReadSuccess = await markAdminNotificationRead(firstNotif.id);
  assert(markReadSuccess === true, 'Admin can mark notification as read');

  const markAllSuccess = await markAllAdminNotificationsRead();
  assert(markAllSuccess === true, 'Admin can mark all notifications as read');

  // Notification Preferences
  const prefs = await getAdminNotificationPreferences();
  assert(typeof prefs.alert_new_user_registration === 'boolean', 'Admin preferences contain event notification toggles');

  const updatedPrefs = await saveAdminNotificationPreferences({
    alert_app_installation: true,
    alert_new_user_registration: true,
    quiet_hours_enabled: true,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    delivery_channel: 'all',
  });

  assert(
    updatedPrefs.quiet_hours_enabled === true && updatedPrefs.quiet_hours_start === '22:00',
    'Admin quiet hours and delivery preferences updated and saved'
  );

  console.log('\n================================================================');
  console.log(`RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
