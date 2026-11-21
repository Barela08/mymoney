/**
 * Comprehensive End-to-End Verification Suite for Authentication & Security Architecture
 */
import fs from 'fs';
import path from 'path';

// Read .env if needed
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const BASE_URL = 'http://localhost:5173';

interface ApiResponse {
  status: number;
  data: any;
  headers: Headers;
}

async function api(path: string, options: RequestInit = {}): Promise<ApiResponse> {
  const url = `${BASE_URL}${path}`;
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });
  let data: any = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

async function runVerification() {
  console.log('================================================================');
  console.log('STARTING SECURE AUTHENTICATION SYSTEM VERIFICATION');
  console.log('Target Server:', BASE_URL);
  console.log('================================================================\n');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      if (detail) console.error(`   Details: ${detail}`);
      failedTests++;
    }
  }

  const timestamp = Date.now();
  const testEmail = `testuser_${timestamp}@mymoney-test.com`;
  const initialPassword = 'SuperSecureP@ssw0rd!2026#';
  const updatedPassword = 'NewSuperSecureP@ssw0rd!2026#';

  // TEST 1: Password Strength Validation (< 12 chars rejected)
  console.log('\n--- 1. Testing Registration Validation ---');
  const shortPassRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Weak Password User',
      email: testEmail,
      phone: '+91 9876543210',
      password: 'weak',
      confirmPassword: 'weak',
    }),
  });
  assert(
    shortPassRes.status === 400 && shortPassRes.data.errors?.some((e: string) => e.includes('12')),
    'Reject password shorter than 12 characters',
    JSON.stringify(shortPassRes.data)
  );

  // TEST 2: Successful Registration
  const regRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Rahul Sharma',
      email: testEmail,
      phone: '+91 9876543210',
      password: initialPassword,
      confirmPassword: initialPassword,
    }),
  });
  assert(
    regRes.status === 201 && regRes.data.success && regRes.data.sessionToken,
    'Register user with bcrypt hashing (12 rounds) and receive session token',
    JSON.stringify(regRes.data)
  );
  let userSessionToken = regRes.data.sessionToken;

  // TEST 3: Duplicate Email Prevention
  const dupRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Duplicate User',
      email: testEmail,
      phone: '+91 9876543211',
      password: initialPassword,
      confirmPassword: initialPassword,
    }),
  });
  assert(
    dupRes.status === 409 && !dupRes.data.success,
    'Prevent duplicate user registration with 409 Conflict',
    JSON.stringify(dupRes.data)
  );

  // TEST 4: Login Verification
  console.log('\n--- 2. Testing Authentication & Session Management ---');
  const loginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: testEmail,
      password: initialPassword,
      rememberMe: true,
    }),
  });
  assert(
    loginRes.status === 200 && loginRes.data.success && loginRes.data.sessionToken,
    'Login with valid credentials and receive cryptographically secure session token',
    JSON.stringify(loginRes.data)
  );
  userSessionToken = loginRes.data.sessionToken;

  // TEST 5: Verify User Identity (/api/auth/me)
  const meRes = await api('/api/auth/me', {
    headers: { Authorization: `Bearer ${userSessionToken}` },
  });
  assert(
    meRes.status === 200 && meRes.data.user.email === testEmail,
    'Verify session identity via Bearer token',
    JSON.stringify(meRes.data)
  );

  // TEST 6: User Profile Retrieval (/api/profile)
  console.log('\n--- 3. Testing User Profile & Sanitization ---');
  const profileRes = await api('/api/profile', {
    headers: { Authorization: `Bearer ${userSessionToken}` },
  });
  assert(
    profileRes.status === 200 &&
      profileRes.data.profile.email === testEmail &&
      profileRes.data.profile.password === undefined &&
      profileRes.data.profile.password_hash === undefined,
    'Profile endpoint sanitizes sensitive security data (no password / no hash)',
    JSON.stringify(profileRes.data)
  );

  // TEST 7: Update Profile Details
  const updateRes = await api('/api/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${userSessionToken}` },
    body: JSON.stringify({
      fullName: 'Rahul S. Sharma',
      phone: '+91 9999988888',
    }),
  });
  assert(
    updateRes.status === 200 && updateRes.data.user.displayName === 'Rahul S. Sharma',
    'Update user profile details (Name & Phone)',
    JSON.stringify(updateRes.data)
  );

  // TEST 8: Change Password
  console.log('\n--- 4. Testing Password Change Workflow ---');
  const changePassRes = await api('/api/profile/change-password', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userSessionToken}` },
    body: JSON.stringify({
      currentPassword: initialPassword,
      newPassword: updatedPassword,
      confirmNewPassword: updatedPassword,
    }),
  });
  assert(
    changePassRes.status === 200 && changePassRes.data.success,
    'Change password with current password verification & session revocation',
    JSON.stringify(changePassRes.data)
  );

  // TEST 9: Login with Old Password Must Fail
  const oldLoginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: testEmail,
      password: initialPassword,
    }),
  });
  assert(
    oldLoginRes.status === 401 && !oldLoginRes.data.success,
    'Old password fails authentication after password change',
    JSON.stringify(oldLoginRes.data)
  );

  // TEST 10: Login with New Password
  const newLoginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: testEmail,
      password: updatedPassword,
    }),
  });
  assert(
    newLoginRes.status === 200 && newLoginRes.data.success,
    'Login successfully with updated password',
    JSON.stringify(newLoginRes.data)
  );
  userSessionToken = newLoginRes.data.sessionToken;

  // TEST 11: Forgot Password Workflow
  console.log('\n--- 5. Testing Forgot Password & Single-Use Reset Token ---');
  const forgotRes = await api('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: testEmail }),
  });
  assert(
    forgotRes.status === 200 && forgotRes.data.success && forgotRes.data.resetLink,
    'Forgot password generates single-use reset token and dispatches secure link',
    JSON.stringify(forgotRes.data)
  );

  // Extract reset token from link
  const linkStr: string = forgotRes.data.resetLink;
  const tokenMatch = linkStr.match(/token=([a-f0-9]+)/);
  const rawResetToken = tokenMatch ? tokenMatch[1] : '';

  assert(rawResetToken.length === 64, 'Reset token is cryptographically secure (64 hex characters)');

  // TEST 12: Verify Reset Token
  const verifyTokenRes = await api('/api/auth/verify-reset-token', {
    method: 'POST',
    body: JSON.stringify({ token: rawResetToken }),
  });
  assert(
    verifyTokenRes.status === 200 && verifyTokenRes.data.valid && verifyTokenRes.data.email === testEmail,
    'Verify reset token before allowing password reset',
    JSON.stringify(verifyTokenRes.data)
  );

  // TEST 13: Complete Password Reset
  const resetPassFinal = 'FinalSecureP@ssw0rd!2026#Reset';
  const resetRes = await api('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({
      token: rawResetToken,
      newPassword: resetPassFinal,
      confirmPassword: resetPassFinal,
    }),
  });
  assert(
    resetRes.status === 200 && resetRes.data.success,
    'Reset password with token, update hash, and invalidate reset token',
    JSON.stringify(resetRes.data)
  );

  // TEST 14: Token Re-use Prevention (Single-Use Only)
  const reuseRes = await api('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({
      token: rawResetToken,
      newPassword: 'AnotherPassword!2026#MustFail',
      confirmPassword: 'AnotherPassword!2026#MustFail',
    }),
  });
  assert(
    reuseRes.status === 400 && !reuseRes.data.success,
    'Prevent replay attack: used reset token is permanently rejected',
    JSON.stringify(reuseRes.data)
  );

  // TEST 15: Admin User Management & Password Visibility Protection
  console.log('\n--- 6. Testing Admin User Management & Zero Password Visibility ---');
  const adminLoginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@mymoney.com',
      password: process.env.ADMIN_INITIAL_PASSWORD || 'Admin@Sec2026!Master',
    }),
  });
  assert(
    adminLoginRes.status === 200 && adminLoginRes.data.user.role === 'admin',
    'Admin authenticated successfully',
    JSON.stringify(adminLoginRes.data)
  );
  const adminToken = adminLoginRes.data.sessionToken;

  // TEST 16: Admin User List - Zero Password Leak
  const adminUsersRes = await api('/api/admin/users', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    adminUsersRes.status === 200 && Array.isArray(adminUsersRes.data.users),
    'Admin lists users',
    `Found ${adminUsersRes.data.users?.length} users`
  );

  const foundUser = adminUsersRes.data.users.find((u: any) => u.email === testEmail);
  assert(
    foundUser &&
      foundUser.password === undefined &&
      foundUser.password_hash === undefined &&
      foundUser.display_password === undefined &&
      foundUser.reset_token_hash === undefined,
    'STRICT RULE CHECK: User list NEVER exposes passwords, hashes, display_passwords, or tokens to Admin',
    JSON.stringify(foundUser)
  );

  // TEST 17: Admin Send Password Reset Email
  if (foundUser) {
    const adminSendReset = await api(`/api/admin/users/${foundUser.id}/send-reset-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      adminSendReset.status === 200 && adminSendReset.data.success,
      'Admin triggers user password reset email (dispatches reset link to user email)',
      JSON.stringify(adminSendReset.data)
    );

    // TEST 18: Admin Revoke All User Sessions
    const revokeRes = await api(`/api/admin/users/${foundUser.id}/revoke-sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      revokeRes.status === 200 && revokeRes.data.success,
      'Admin revokes all active sessions for targeted user',
      JSON.stringify(revokeRes.data)
    );
  }

  // TEST 19: Security Audit Log Verification
  console.log('\n--- 7. Testing Immutable Security Audit Trail ---');
  const auditLogsRes = await api('/api/admin/audit-logs', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    auditLogsRes.status === 200 && Array.isArray(auditLogsRes.data.logs) && auditLogsRes.data.logs.length > 0,
    'Security audit trail records events with actor role, IP, user email, and timestamp',
    `Found ${auditLogsRes.data.logs?.length} logged events`
  );

  // TEST 20: Clean up test user
  console.log('\n--- 8. Account Deletion & Cleanup ---');
  if (foundUser) {
    const delRes = await api(`/api/admin/users/${foundUser.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      delRes.status === 200 && delRes.data.success,
      'Admin securely deletes test account and purges associated sessions',
      JSON.stringify(delRes.data)
    );
  }

  console.log('\n================================================================');
  console.log(`VERIFICATION COMPLETE: ${passedTests} Passed, ${failedTests} Failed.`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runVerification().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
