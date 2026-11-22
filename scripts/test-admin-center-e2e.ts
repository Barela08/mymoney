/**
 * End-to-End Automated Verification of Admin Control Center Endpoints
 */
const BASE_URL = 'http://localhost:5173';

async function run() {
  console.log('--- STARTING ADMIN CONTROL CENTER E2E VERIFICATION ---');

  // Step 1: Admin Authentication
  console.log('1. Testing Admin Authentication...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@mymoney.com',
      password: 'Admin@Sec2026!Master',
    }),
  });

  if (!loginRes.ok) {
    throw new Error(`Admin login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const loginData = await loginRes.json();
  const token = loginData.sessionToken;
  console.log('   ✓ Admin Login Success. Role:', loginData.user?.role);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // Helper tester
  async function testEndpoint(name: string, path: string, options: RequestInit = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { ...authHeaders, ...(options.headers as any) },
    });
    if (!res.ok) {
      throw new Error(`FAIL [${res.status}]: ${name} (${path}) -> ${await res.text()}`);
    }
    const data = await res.json();
    console.log(`   ✓ ${name} [${res.status}] -> OK:`, data.success !== undefined ? `success=${data.success}` : 'data received');
    return data;
  }

  // Step 2: Dashboard Overview Stats
  console.log('2. Testing Dashboard Overview & KPI Metrics...');
  const stats = await testEndpoint('Dashboard Stats', '/api/admin/dashboard-stats');
  if (!stats.stats || typeof stats.stats.totalUsers !== 'number') {
    throw new Error('Dashboard stats missing required fields');
  }

  // Step 3: User Management
  console.log('3. Testing User Directory & Activity...');
  const users = await testEndpoint('Users List', '/api/admin/users');
  if (!Array.isArray(users.users)) throw new Error('Users endpoint did not return an array');

  // Step 4: Security Center, Incidents, Sessions & Login Attempts
  console.log('4. Testing Security Center Modules...');
  await testEndpoint('Security Incidents', '/api/admin/security/incidents');
  await testEndpoint('Login Attempts', '/api/admin/security/login-attempts');
  await testEndpoint('Active Sessions', '/api/admin/security/sessions');

  // Step 5: Account Lifecycle (24-hr Deletions)
  console.log('5. Testing Account Deletion Queue...');
  await testEndpoint('Deletions Queue', '/api/admin/deletions');

  // Step 6: Email Management & Templates
  console.log('6. Testing Email Management...');
  await testEndpoint('Email Dispatch Logs', '/api/admin/emails/logs');
  await testEndpoint('Email Templates', '/api/admin/emails/templates');

  // Step 7: Support Tickets
  console.log('7. Testing Support Tickets Queue...');
  await testEndpoint('Support Tickets', '/api/admin/support/tickets');

  // Step 8: Legal & Compliance
  console.log('8. Testing Legal & Privacy Policies...');
  await testEndpoint('Legal Policies', '/api/admin/legal/policies');

  // Step 9: System Health & Backups
  console.log('9. Testing Infrastructure Monitoring & Backups...');
  await testEndpoint('System Health Status', '/api/admin/system/health');
  await testEndpoint('System Backups List', '/api/admin/system/backups');

  // Step 10: Roles & RBAC Matrix
  console.log('10. Testing Admin Roles & Permissions...');
  await testEndpoint('Admin Roles', '/api/admin/roles');

  // Step 11: Feature Flags
  console.log('11. Testing Feature Flags Management...');
  await testEndpoint('Feature Flags', '/api/admin/features');

  // Step 12: Global Search & Alerts
  console.log('12. Testing Global Search & Alerts...');
  await testEndpoint('Global Search', '/api/admin/search?q=admin');
  await testEndpoint('Admin Alerts', '/api/admin/alerts');

  // Step 13: Broadcast Notifications
  console.log('13. Testing Broadcast Notifications Dispatch & Query...');
  await testEndpoint('Broadcast Post', '/api/admin/notifications', {
    method: 'POST',
    body: JSON.stringify({
      title: 'E2E Test Notification',
      message: 'Automated validation verification alert',
      type: 'info',
      target_user_id: 'all',
    }),
  });
  await testEndpoint('Broadcast Query', '/api/admin/notifications');

  // Step 14: Audit Logs
  console.log('14. Testing Immutable Audit Trail...');
  const auditLogs = await testEndpoint('Audit Logs', '/api/admin/audit-logs');
  if (!Array.isArray(auditLogs.logs)) throw new Error('Audit logs not returned as array');

  // Step 15: Analytics & Intelligence (Aggregated, zero private financials)
  console.log('15. Testing Platform Analytics...');
  const analytics = await testEndpoint('Aggregated Analytics', '/api/admin/analytics?range=30d');
  if (!analytics.data || !analytics.data.registrationsTrend) {
    throw new Error('Analytics payload missing expected aggregated metrics');
  }

  // Step 16: RBAC Protection Guard
  console.log('16. Testing RBAC Security Guard (Unauthenticated / Forbidden access)...');
  const unauthRes = await fetch(`${BASE_URL}/api/admin/dashboard-stats`);
  if (unauthRes.status !== 401 && unauthRes.status !== 403) {
    throw new Error(`Security Guard FAILED: Expected 401/403, received ${unauthRes.status}`);
  }
  console.log(`   ✓ Unauthenticated request correctly rejected with HTTP ${unauthRes.status}`);

  console.log('\n======================================================');
  console.log(' ALL 16 ADMIN CONTROL CENTER E2E TESTS PASSED CLEANLY ');
  console.log('======================================================');
}

run().catch((err) => {
  console.error('\n❌ E2E TEST RUNNER FAILED:', err);
  process.exit(1);
});
