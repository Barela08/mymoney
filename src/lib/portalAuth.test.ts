import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDefaultPermissionsForRole,
  getPortalBranding,
  getPortalScopeFromLocation,
  hasPortalPermission,
  isAdminPortalUser,
  isStaffPortalUser,
  resolveEffectiveRoleSlug,
} from './portalAuth';

test('Portal scope detection isolates /, /myadmin, and /mystaff cleanly', () => {
  assert.equal(getPortalScopeFromLocation('/', '', 'mymoney.nileshbarela.site'), 'user');
  assert.equal(getPortalScopeFromLocation('/transactions', '', 'localhost'), 'user');
  assert.equal(getPortalScopeFromLocation('/myadmin', '', 'localhost'), 'myadmin');
  assert.equal(getPortalScopeFromLocation('/myadmin/', '', 'localhost'), 'myadmin');
  assert.equal(getPortalScopeFromLocation('/admin', '', 'localhost'), 'myadmin');
  assert.equal(getPortalScopeFromLocation('/', '#myadmin=users', 'localhost'), 'myadmin');
  assert.equal(getPortalScopeFromLocation('/', '', 'admin.nileshbarela.site'), 'myadmin');
  assert.equal(getPortalScopeFromLocation('/mystaff', '', 'localhost'), 'mystaff');
  assert.equal(getPortalScopeFromLocation('/mystaff/support', '', 'localhost'), 'mystaff');
  assert.equal(getPortalScopeFromLocation('/', '#mystaff=support', 'localhost'), 'mystaff');
});

test('Strict role separation keeps Admin and Staff logins mutually exclusive', () => {
  const superAdmin = { email: 'hackifypro@gmail.com', role: 'user' };
  const normalAdmin = { email: 'ops-admin@mymoney.com', role: 'admin', role_slug: 'admin' };
  const supportStaff = { email: 'agent1@mymoney.com', role: 'support', role_slug: 'support' };
  const analystStaff = { email: 'analyst1@mymoney.com', role: 'analyst', role_slug: 'analyst' };
  const customStaff = { email: 'mod@mymoney.com', role: 'user', role_slug: 'ticket_moderator' };
  const standardUser = { email: 'rahul@example.com', role: 'user', role_slug: null };

  assert.equal(isAdminPortalUser(superAdmin), true);
  assert.equal(isStaffPortalUser(superAdmin), false);

  assert.equal(isAdminPortalUser(normalAdmin), true);
  assert.equal(isStaffPortalUser(normalAdmin), false);

  assert.equal(isAdminPortalUser(supportStaff), false);
  assert.equal(isStaffPortalUser(supportStaff), true);

  assert.equal(isAdminPortalUser(analystStaff), false);
  assert.equal(isStaffPortalUser(analystStaff), true);

  assert.equal(isAdminPortalUser(customStaff), false);
  assert.equal(isStaffPortalUser(customStaff), true);
  assert.equal(resolveEffectiveRoleSlug(customStaff), 'ticket_moderator');

  assert.equal(isAdminPortalUser(standardUser), false);
  assert.equal(isStaffPortalUser(standardUser), false);
});

test('Separate PWA branding manifests & service workers per portal', () => {
  const userBrand = getPortalBranding('user');
  const adminBrand = getPortalBranding('myadmin');
  const staffBrand = getPortalBranding('mystaff');

  assert.equal(userBrand.startUrl, '/');
  assert.equal(userBrand.manifestUrl, '/manifest.json');
  assert.equal(userBrand.swUrl, '/sw.js');

  assert.equal(adminBrand.appName, 'My Money Manager Admin');
  assert.equal(adminBrand.startUrl, '/myadmin');
  assert.equal(adminBrand.manifestUrl, '/myadmin-manifest.json');
  assert.equal(adminBrand.swUrl, '/myadmin-sw.js');
  assert.notEqual(adminBrand.logoUrl, staffBrand.logoUrl);

  assert.equal(staffBrand.appName, 'My Money Manager Staff');
  assert.equal(staffBrand.startUrl, '/mystaff');
  assert.equal(staffBrand.manifestUrl, '/mystaff-manifest.json');
  assert.equal(staffBrand.swUrl, '/mystaff-sw.js');
  assert.equal(staffBrand.accent, 'indigo');
});

test('Staff RBAC permission filtering excludes admin-only configuration controls', () => {
  const supportPerms = getDefaultPermissionsForRole({ role: 'support' });
  assert.equal(hasPortalPermission(supportPerms, 'support.read'), true);
  assert.equal(hasPortalPermission(supportPerms, 'users.financial_data.request'), true);
  assert.equal(hasPortalPermission(supportPerms, 'settings.manage'), false);
  assert.equal(hasPortalPermission(supportPerms, 'admins.view'), false);

  const analystPerms = getDefaultPermissionsForRole({ role: 'analyst' });
  assert.equal(hasPortalPermission(analystPerms, 'analytics.read'), true);
  assert.equal(hasPortalPermission(analystPerms, 'database.view'), true);
  assert.equal(hasPortalPermission(analystPerms, 'support.manage'), false);
  assert.equal(hasPortalPermission(analystPerms, 'features.manage'), false);
});
