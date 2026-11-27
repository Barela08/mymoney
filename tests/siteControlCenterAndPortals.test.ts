import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  validateAndSanitizeSvg,
  validateBrandingImageInput,
  sanitizeHexColor,
} from '../src/lib/svgSanitizer';
import {
  getControlCenterAdminState,
  getPublicSiteConfigPayload,
  saveControlCenterDraft,
  publishControlCenterChanges,
  restoreControlCenterVersion,
  discardControlCenterDraft,
  generateRobotsTxt,
  generateSitemapXml,
  buildDynamicPwaManifest,
  listStaffTasks,
  createStaffTask,
  updateStaffTask,
} from '../server/siteControlCenter';
import { handleApiRequest } from '../server/api';
import { revokeAllUserSessions } from '../server/auth';
import { isDatabaseAvailable, query } from '../server/db';
import { sbRestRequest } from '../server/supabaseRestFallback';

function createMockReq(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  ip?: string;
}): IncomingMessage {
  const payload = opts.body !== undefined ? JSON.stringify(opts.body) : '';
  const stream = Readable.from(payload ? [Buffer.from(payload, 'utf8')] : []) as IncomingMessage;
  stream.method = opts.method;
  stream.url = opts.url;
  stream.headers = {
    host: opts.headers?.host || 'localhost:3000',
    ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(opts.headers || {}),
  };
  (stream as any).socket = { remoteAddress: opts.ip || '127.0.0.1' };
  return stream;
}

function createMockRes(): {
  res: ServerResponse;
  getStatus: () => number;
  getHeaders: () => Record<string, string | string[]>;
  getBody: () => any;
} {
  let statusCode = 200;
  const chunks: string[] = [];
  const headers: Record<string, string | string[]> = {};

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    writeHead(code: number, hdrs?: Record<string, string | string[]>) {
      statusCode = code;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          headers[k.toLowerCase()] = v;
        }
      }
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      }
      (res as any).writableEnded = true;
      return res;
    },
    writableEnded: false,
  } as unknown as ServerResponse;

  return {
    res,
    getStatus: () => statusCode,
    getHeaders: () => headers,
    getBody: () => {
      const raw = chunks.join('');
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },
  };
}

async function apiCall(opts: {
  method: string;
  url: string;
  token?: string;
  headers?: Record<string, string>;
  ip?: string;
  body?: unknown;
}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;

  const req = createMockReq({
    method: opts.method,
    url: opts.url,
    headers,
    body: opts.body,
    ip: opts.ip,
  });
  const mock = createMockRes();
  const handled = await handleApiRequest(req, mock.res);
  assert.equal(handled, true, `Expected route ${opts.method} ${opts.url} to be handled`);
  return { status: mock.getStatus(), headers: mock.getHeaders(), body: mock.getBody() };
}

async function cleanupTestUser(userId?: string) {
  if (!userId) return;
  try {
    await revokeAllUserSessions(userId);
  } catch {}
  if (isDatabaseAvailable()) {
    await query('DELETE FROM public.udhar_repayments WHERE recorded_by_user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.udhar_transactions WHERE user_id = $1 OR counterpart_user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.udhar_contacts WHERE user_id = $1 OR linked_user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.user_connections WHERE user_a_id = $1 OR user_b_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.qr_pairing_tokens WHERE user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.staff_notifications WHERE staff_user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.admin_notifications WHERE user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.user_notifications WHERE user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.user_sessions WHERE user_id = $1', [userId]).catch(() => {});
    await query('DELETE FROM public.app_users WHERE id = $1', [userId]).catch(() => {});
  }
  await sbRestRequest(`udhar_repayments?recorded_by_user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`udhar_transactions?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`udhar_transactions?counterpart_user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`udhar_contacts?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`udhar_contacts?linked_user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`user_connections?user_a_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`user_connections?user_b_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`qr_pairing_tokens?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`staff_notifications?staff_user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`admin_notifications?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`user_notifications?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`user_sessions?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  await sbRestRequest(`app_users?id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
}

describe('1. Branding Asset & SVG Sanitization Hardening', () => {
  it('blocks malicious SVG payloads (<script>, onload=, javascript:, <foreignObject>, external href)', () => {
    const payloads = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="10"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(\'https://evil.test\')"><rect width="10" height="10"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text y="10">x</text></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body><div>html</div></body></foreignObject></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.test/sprite.svg#x"/></svg>',
    ];

    for (const badSvg of payloads) {
      const result = validateAndSanitizeSvg(badSvg);
      assert.equal(result.valid, false, `Expected payload to be rejected: ${badSvg}`);
      assert.ok(result.error, 'Rejection should include a clear security error message');
    }

    const unsafeUrl = validateBrandingImageInput('javascript:alert(1)');
    assert.equal(unsafeUrl.valid, false);
  });

  it('accepts clean SVG and valid raster PNG/JPEG inputs and normalizes hex colors', () => {
    const cleanSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#10b981"/></svg>';
    const svgCheck = validateBrandingImageInput(cleanSvg);
    assert.equal(svgCheck.valid, true);
    assert.equal(svgCheck.mimeType, 'image/svg+xml');
    assert.ok(svgCheck.sanitizedDataUrl?.startsWith('data:image/svg+xml;base64,'));
    assert.ok(svgCheck.sanitizedSvg?.includes('viewBox="0 0 128 128"'));

    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const pngCheck = validateBrandingImageInput(tinyPng, { width: 64, height: 64 });
    assert.equal(pngCheck.valid, true);
    assert.equal(pngCheck.mimeType, 'image/png');

    assert.equal(sanitizeHexColor('#0f0', '#000000'), '#00ff00');
    assert.equal(sanitizeHexColor('not-a-color', '#10b981'), '#10b981');
  });
});

describe('2. Website & Multi-App Control Center Lifecycle, SEO & Isolated PWA Manifests', () => {
  it('keeps drafts isolated from live config until published, supports rollback, and excludes private portals from SEO', async () => {
    const initialState = await getControlCenterAdminState();
    const originalPublished = structuredClone(initialState.published);

    try {
      // Save draft only -> public payload must still reflect published appName
      const draftHeroHeading = `Draft Heading ${Date.now()}`;
      await saveControlCenterDraft(
        {
          homepage: { ...originalPublished.homepage, heroHeading: draftHeroHeading },
        },
        { id: 'test-admin', email: 'test-admin@mymoney.local' }
      );

      const stateWithDraft = await getControlCenterAdminState();
      assert.equal(stateWithDraft.hasUnpublishedDraft, true);
      assert.equal(stateWithDraft.draft?.homepage.heroHeading, draftHeroHeading);

      const publicBeforePublish = await getPublicSiteConfigPayload();
      assert.notEqual(
        publicBeforePublish.siteConfig.homepage.heroHeading,
        draftHeroHeading,
        'Unpublished drafts must not leak to live public payload'
      );

      // Publish live -> increments version, clears draft, updates public config
      const publishedCustomHeading = `Published Control Center ${Date.now()}`;
      const pubRes = await publishControlCenterChanges(
        {
          configPatch: {
            homepage: { ...originalPublished.homepage, heroHeading: publishedCustomHeading },
            branding: {
              ...originalPublished.branding,
              admin_app: {
                ...originalPublished.branding.admin_app,
                appName: 'Custom Admin Portal Name',
              },
              staff_app: {
                ...originalPublished.branding.staff_app,
                appName: 'Custom Staff Desk Name',
              },
            },
            header: {
              ...originalPublished.header,
              navLinks: [
                { id: 'n1', label: 'Features', target: '#features', visible: true },
                { id: 'n2', label: 'Hidden Admin', target: '/myadmin', visible: true },
                { id: 'n3', label: 'Hidden Staff', target: '/mystaff', visible: true },
              ],
            },
          },
          summary: 'Test automated publish',
        },
        { id: 'test-admin', email: 'test-admin@mymoney.local' }
      );

      assert.ok(pubRes.published.version > originalPublished.version);
      const publicAfterPublish = await getPublicSiteConfigPayload();
      assert.equal(publicAfterPublish.siteConfig.homepage.heroHeading, publishedCustomHeading);
      assert.equal(
        publicAfterPublish.siteConfig.header.navLinks.some(
          (l) => l.target.includes('/myadmin') || l.target.includes('/mystaff')
        ),
        false,
        'Public header navLinks must strip /myadmin and /mystaff links'
      );

      // Verify zero secrets leak on public payload
      const serialized = JSON.stringify(publicAfterPublish);
      assert.equal(/smtpPass|geminiApiKey|vapidPrivateKey|passwordHash/i.test(serialized), false);

      // Verify isolated manifests per portal scope
      const userManifest = await buildDynamicPwaManifest('user');
      const adminManifest = await buildDynamicPwaManifest('myadmin');
      const adminSubManifest = await buildDynamicPwaManifest('myadmin', 'admin.mymoney.nileshbarela.site');
      const staffManifest = await buildDynamicPwaManifest('mystaff');

      assert.equal(userManifest.start_url, '/');
      assert.equal(userManifest.scope, '/');
      assert.equal(adminManifest.start_url, '/myadmin');
      assert.equal(adminManifest.scope, '/myadmin');
      assert.equal(adminManifest.name, 'Custom Admin Portal Name');
      assert.equal(adminSubManifest.start_url, '/');
      assert.equal(staffManifest.start_url, '/mystaff');
      assert.equal(staffManifest.scope, '/mystaff');
      assert.equal(staffManifest.name, 'Custom Staff Desk Name');

      // Verify SEO robots.txt & sitemap.xml block /myadmin and /mystaff
      const robots = await generateRobotsTxt();
      assert.ok(robots.includes('Disallow: /myadmin'));
      assert.ok(robots.includes('Disallow: /mystaff'));

      const sitemap = await generateSitemapXml();
      assert.equal(sitemap.includes('/myadmin'), false);
      assert.equal(sitemap.includes('/mystaff'), false);

      // Verify restore rollback
      const priorVersion = originalPublished.version;
      const restored = await restoreControlCenterVersion(priorVersion, {
        id: 'test-admin',
        email: 'test-admin@mymoney.local',
      });
      if (restored) {
        assert.equal(restored.restored.homepage.heroHeading, originalPublished.homepage.heroHeading);
      }
    } finally {
      await discardControlCenterDraft({ id: 'test-admin', email: 'test-admin@mymoney.local' }).catch(() => {});
      await publishControlCenterChanges(
        { configPatch: originalPublished, summary: 'Restore baseline after test' },
        { id: 'test-admin', email: 'test-admin@mymoney.local' }
      ).catch(() => {});
    }
  });
});

describe('3. Three-Portal RBAC Isolation, Staff Tasks & Separated Notifications', () => {
  it('enforces portal login isolation, RBAC boundaries, and end-to-end Admin -> Staff task workflow', async () => {
    const suffix = crypto.randomBytes(5).toString('hex');
    const adminEmail = `portal_admin_${suffix}@example.com`;
    const staffEmail = `portal_staff_${suffix}@example.com`;
    const userEmail = `portal_user_${suffix}@example.com`;
    const password = 'PortalSecure#Password2026';

    let adminId: string | undefined;
    let staffId: string | undefined;
    let userId: string | undefined;

    try {
      // Unauthenticated checks
      const unauthAdminCtrl = await apiCall({ method: 'GET', url: '/api/admin/control-center' });
      assert.equal(unauthAdminCtrl.status, 401);

      const unauthStaffTasks = await apiCall({ method: 'GET', url: '/api/staff/tasks' });
      assert.equal(unauthStaffTasks.status, 401);

      // Public endpoints return 200
      const publicCfgRes = await apiCall({ method: 'GET', url: '/api/public/site-config' });
      assert.equal(publicCfgRes.status, 200);
      assert.equal(publicCfgRes.body.success, true);

      const manifestStaffRes = await apiCall({ method: 'GET', url: '/api/pwa/manifest/mystaff' });
      assert.equal(manifestStaffRes.status, 200);
      assert.equal(manifestStaffRes.body.scope, '/mystaff');

      // Seed accounts via registration
      const [regAdmin, regStaff, regUser] = await Promise.all([
        apiCall({
          method: 'POST',
          url: '/api/auth/register',
          ip: '10.30.0.1',
          body: { fullName: 'Portal SuperAdmin', email: adminEmail, password, confirmPassword: password },
        }),
        apiCall({
          method: 'POST',
          url: '/api/auth/register',
          ip: '10.30.0.2',
          body: { fullName: 'Portal Staff Agent', email: staffEmail, password, confirmPassword: password },
        }),
        apiCall({
          method: 'POST',
          url: '/api/auth/register',
          ip: '10.30.0.3',
          body: { fullName: 'Standard App User', email: userEmail, password, confirmPassword: password },
        }),
      ]);

      assert.equal(regAdmin.status, 201);
      assert.equal(regStaff.status, 201);
      assert.equal(regUser.status, 201);

      adminId = regAdmin.body.user.id;
      staffId = regStaff.body.user.id;
      userId = regUser.body.user.id;

      const userToken = regUser.body.sessionToken as string;

      // Elevate Admin & Staff roles in DB/fallback store
      const adminPatch = await sbRestRequest(`app_users?id=eq.${encodeURIComponent(adminId!)}`, {
        method: 'PATCH',
        body: { role: 'superadmin', role_slug: 'superadmin' },
      }).catch(() => ({ ok: false, status: 500, error: 'err' } as any));
      assert.ok(adminPatch.ok, `Admin elevation failed: ${JSON.stringify(adminPatch)}`);

      let staffPatch = await sbRestRequest(`app_users?id=eq.${encodeURIComponent(staffId!)}`, {
        method: 'PATCH',
        body: { role: 'support', role_slug: 'support' },
      }).catch(() => ({ ok: false, status: 500, error: 'err' } as any));
      if (!staffPatch.ok) {
        staffPatch = await sbRestRequest(`app_users?id=eq.${encodeURIComponent(staffId!)}`, {
          method: 'PATCH',
          body: { role: 'user', role_slug: 'support' },
        }).catch(() => ({ ok: false, status: 500, error: 'err' } as any));
      }
      assert.ok(staffPatch.ok, `Staff elevation failed: ${JSON.stringify(staffPatch)}`);

      if (isDatabaseAvailable()) {
        await query(`UPDATE public.app_users SET role = 'superadmin', role_slug = 'superadmin' WHERE id = $1`, [adminId]).catch(() => {});
        await query(`UPDATE public.app_users SET role = 'support', role_slug = 'support' WHERE id = $1`, [staffId]).catch(() => {});
      }

      // 1. Cross-portal login rejection checks
      const userAdminLogin = await apiCall({
        method: 'POST',
        url: '/api/admin/auth/login',
        ip: '10.30.0.10',
        body: { email: userEmail, password },
      });
      assert.equal(userAdminLogin.status, 403, `Standard user must be rejected from /myadmin login: ${JSON.stringify(userAdminLogin.body)}`);

      const userStaffLogin = await apiCall({
        method: 'POST',
        url: '/api/staff/auth/login',
        ip: '10.30.0.11',
        body: { email: userEmail, password },
      });
      assert.equal(userStaffLogin.status, 403, `Standard user must be rejected from /mystaff login: ${JSON.stringify(userStaffLogin.body)}`);

      const staffAdminLogin = await apiCall({
        method: 'POST',
        url: '/api/admin/auth/login',
        ip: '10.30.0.12',
        body: { email: staffEmail, password },
      });
      assert.equal(staffAdminLogin.status, 403, `Staff agent must be rejected from /myadmin login: ${JSON.stringify(staffAdminLogin.body)}`);

      // 2. Valid Admin & Staff portal logins succeed cleanly
      const adminPortalLogin = await apiCall({
        method: 'POST',
        url: '/api/admin/auth/login',
        ip: '10.30.0.13',
        body: { email: adminEmail, password },
      });
      assert.equal(adminPortalLogin.status, 200, `Admin login failed: ${JSON.stringify(adminPortalLogin.body)}`);
      const adminToken = adminPortalLogin.body.sessionToken as string;

      const staffPortalLogin = await apiCall({
        method: 'POST',
        url: '/api/staff/auth/login',
        ip: '10.30.0.14',
        body: { email: staffEmail, password },
      });
      assert.equal(staffPortalLogin.status, 200, `Staff login failed: ${JSON.stringify(staffPortalLogin.body)}`);
      const staffToken = staffPortalLogin.body.sessionToken as string;

      // 3. RBAC enforcement on portal APIs
      const userBlockedAdmin = await apiCall({
        method: 'GET',
        url: '/api/admin/control-center',
        token: userToken,
      });
      assert.equal(userBlockedAdmin.status, 403);

      const userBlockedStaff = await apiCall({
        method: 'GET',
        url: '/api/staff/tasks',
        token: userToken,
      });
      assert.equal(userBlockedStaff.status, 403);

      const staffBlockedAdmin = await apiCall({
        method: 'GET',
        url: '/api/admin/control-center',
        token: staffToken,
      });
      assert.equal(staffBlockedAdmin.status, 403);

      // 4. Admin creates assigned Staff task -> Staff sees task + isolated staff alert -> Staff updates status
      const taskTitle = `Verify KYC & Settlement Dispute #${suffix}`;
      const createTaskRes = await apiCall({
        method: 'POST',
        url: '/api/admin/staff-tasks',
        token: adminToken,
        body: {
          title: taskTitle,
          description: 'Review user uploaded receipt and reply to ticket.',
          category: 'support',
          priority: 'high',
          assigned_to: staffId,
        },
      });
      assert.equal(createTaskRes.status, 201);
      const createdTaskId = createTaskRes.body.task?.id as string;
      assert.ok(createdTaskId);

      // Staff sees assigned task on /api/staff/tasks
      const staffTasksRes = await apiCall({
        method: 'GET',
        url: '/api/staff/tasks',
        token: staffToken,
      });
      assert.equal(staffTasksRes.status, 200);
      assert.ok(
        (staffTasksRes.body.tasks || []).some((t: any) => t.id === createdTaskId && t.title === taskTitle),
        'Assigned task must appear in Staff workspace'
      );

      // Staff notifications contain dedicated assigned_task alert
      const staffNotifRes = await apiCall({
        method: 'GET',
        url: '/api/staff/notifications',
        token: staffToken,
      });
      assert.equal(staffNotifRes.status, 200);
      assert.ok(
        (staffNotifRes.body.notifications || []).some(
          (n: any) =>
            (n.event_type === 'assigned_task' || n.category === 'assigned_task') &&
            (String(n.title || '').includes(taskTitle) || String(n.message || '').includes(taskTitle))
        ),
        `Staff notifications feed must receive isolated assigned_task notification: ${JSON.stringify(staffNotifRes.body)}`
      );

      // Staff progresses task -> completed
      const patchTaskRes = await apiCall({
        method: 'PATCH',
        url: `/api/staff/tasks/${encodeURIComponent(createdTaskId)}`,
        token: staffToken,
        body: { status: 'completed' },
      });
      assert.equal(patchTaskRes.status, 200);
      assert.equal(patchTaskRes.body.task?.status, 'completed');

      // Direct domain task create/update sanity check
      const directTask = await createStaffTask({
        title: `Direct Smoke Task ${suffix}`,
        assigned_to: staffId,
        assigned_by: adminId!,
      });
      const updatedDirect = await updateStaffTask(directTask.id, { status: 'in_progress' });
      assert.equal(updatedDirect?.status, 'in_progress');
      const filteredList = await listStaffTasks({ assignedTo: staffId });
      assert.ok(filteredList.some((t) => t.id === directTask.id));
    } finally {
      await cleanupTestUser(userId);
      await cleanupTestUser(staffId);
      await cleanupTestUser(adminId);
    }
  });
});

describe('4. Clean Public Login Footer & Udhar / Saved People Delete + Re-Add Flows', () => {
  it('serves clean login page config with screenshot footer details', async () => {
    const res = await apiCall({ method: 'GET', url: '/api/public/site-config' });
    assert.equal(res.status, 200);
    const cfg = res.body.siteConfig;
    assert.equal(cfg.homepage.showHero, false);
    assert.equal(cfg.featureVisibility.publicWelcomeHeroEnabled, false);
    assert.equal(cfg.footer.showSocialLinks, false);
    assert.equal(cfg.footer.supportEmail, 'hackifypro@gmail.com');
    assert.equal(cfg.footer.supportPhone, '+919669412829');
    assert.equal(cfg.footer.copyrightText, '© 2026 My Money Manager by HackifyPro. All rights reserved.');
    assert.equal(cfg.branding.website.footerBrandText, 'My Money Manager by HackifyPro');
  });

  it('allows deleting Udhar entries, deleting saved people, requiring request on search re-add, and connecting directly via QR/code', async () => {
    const suffix = crypto.randomBytes(5).toString('hex');
    const emailA = `udhar_a_${suffix}@example.com`;
    const emailB = `udhar_b_${suffix}@example.com`;
    const password = 'UdharFlowSecure#2026';

    let userAId: string | undefined;
    let userBId: string | undefined;

    try {
      const [regA, regB] = await Promise.all([
        apiCall({
          method: 'POST',
          url: '/api/auth/register',
          ip: '10.40.0.1',
          body: { fullName: `Alpha ${suffix}`, email: emailA, password, confirmPassword: password },
        }),
        apiCall({
          method: 'POST',
          url: '/api/auth/register',
          ip: '10.40.0.2',
          body: { fullName: `Beta ${suffix}`, email: emailB, password, confirmPassword: password },
        }),
      ]);

      assert.equal(regA.status, 201);
      assert.equal(regB.status, 201);

      userAId = regA.body.user.id;
      userBId = regB.body.user.id;
      const tokenA = regA.body.sessionToken as string;
      const tokenB = regB.body.sessionToken as string;

      // 1. User A sends search connection request -> must be pending (NOT immediately connected)
      const req1 = await apiCall({
        method: 'POST',
        url: '/api/udhar/connections/request',
        token: tokenA,
        body: { targetUserId: userBId, relationshipType: 'Friend', consentConfirmed: true },
      });
      assert.equal(req1.status, 200);
      assert.equal(req1.body.status, 'pending');
      assert.ok(req1.body.requestId);

      // 2. User B accepts -> both users connected in Saved People
      const acc1 = await apiCall({
        method: 'POST',
        url: `/api/udhar/connections/${encodeURIComponent(req1.body.requestId)}/accept`,
        token: tokenB,
      });
      assert.equal(acc1.status, 200);
      assert.equal(acc1.body.status, 'connected');

      // 3. User A creates a shared Udhar ("gave" to B) and User B accepts; then User B deletes it from their ('took') perspective
      const txCreate = await apiCall({
        method: 'POST',
        url: '/api/udhar/transactions',
        token: tokenA,
        body: {
          direction: 'gave',
          amount: 750,
          counterpart_user_id: userBId,
          counterpart_name: `Beta ${suffix}`,
          description: 'Room dinner split',
        },
      });
      assert.equal(txCreate.status, 201);
      const txAId = txCreate.body.transaction?.id;
      const linkId = txCreate.body.transaction?.link_id;
      assert.ok(txAId && linkId);

      const listB = await apiCall({ method: 'GET', url: '/api/udhar/transactions', token: tokenB });
      assert.equal(listB.status, 200);
      const txB = (listB.body.transactions || []).find((t: any) => t.link_id === linkId);
      assert.ok(txB, 'Counterpart User B should see shared Udhar entry');

      const confirmB = await apiCall({
        method: 'POST',
        url: `/api/udhar/transactions/${encodeURIComponent(txB.id)}/confirm`,
        token: tokenB,
      });
      assert.equal(confirmB.status, 200);

      const deleteB = await apiCall({
        method: 'DELETE',
        url: `/api/udhar/transactions/${encodeURIComponent(txB.id)}`,
        token: tokenB,
      });
      assert.equal(deleteB.status, 200, `Expected borrower Udhar delete to succeed: ${JSON.stringify(deleteB.body)}`);

      const afterDelListA = await apiCall({ method: 'GET', url: '/api/udhar/transactions', token: tokenA });
      assert.equal(
        (afterDelListA.body.transactions || []).some((t: any) => t.link_id === linkId),
        false,
        'Deleted Udhar entry must not appear in active list'
      );

      // 4. Delete Saved Person -> removed cleanly from both sides
      const contactsA1 = await apiCall({ method: 'GET', url: '/api/udhar/contacts', token: tokenA });
      const savedB = (contactsA1.body.contacts || []).find((c: any) => c.linked_user_id === userBId);
      assert.ok(savedB, 'Beta should appear in Alpha Saved People');

      const delSaved = await apiCall({
        method: 'DELETE',
        url: `/api/udhar/connections/${encodeURIComponent(savedB.id)}`,
        token: tokenA,
      });
      assert.equal(delSaved.status, 200);

      const contactsB1 = await apiCall({ method: 'GET', url: '/api/udhar/contacts', token: tokenB });
      assert.equal(
        (contactsB1.body.contacts || []).some((c: any) => c.linked_user_id === userAId),
        false,
        'Two-sided removal must remove Alpha from Beta Saved People too'
      );

      // 5. Re-add via Search -> must send pending request (NOT auto-connect!)
      const searchA = await apiCall({
        method: 'GET',
        url: `/api/udhar/users/search?q=${encodeURIComponent(suffix)}`,
        token: tokenA,
      });
      assert.equal(searchA.status, 200);
      const foundB = (searchA.body.users || []).find((u: any) => u.id === userBId);
      assert.ok(foundB);
      assert.equal(foundB.connectionStatus, 'none', 'Deleted peer search status must reset to none');

      const req2 = await apiCall({
        method: 'POST',
        url: '/api/udhar/connections/request',
        token: tokenA,
        body: { targetUserId: userBId, relationshipType: 'Friend', consentConfirmed: true },
      });
      assert.equal(req2.status, 200);
      assert.equal(req2.body.status, 'pending', 'Re-adding via search after deletion must require consent request');

      // User B accepts re-add request, then deletes again
      const acc2 = await apiCall({
        method: 'POST',
        url: `/api/udhar/connections/${encodeURIComponent(req2.body.requestId)}/accept`,
        token: tokenB,
      });
      assert.equal(acc2.status, 200);
      assert.equal(acc2.body.status, 'connected');

      const delAgain = await apiCall({
        method: 'DELETE',
        url: `/api/udhar/connections/${encodeURIComponent(`conn_${userAId}`)}`,
        token: tokenB,
      });
      assert.equal(delAgain.status, 200);

      // 6. Re-add via QR / Pairing Code -> must connect directly (status: 'connected', NO pending request)
      const myCodeB = await apiCall({ method: 'GET', url: '/api/udhar/qr/my-code', token: tokenB });
      assert.equal(myCodeB.status, 200);
      assert.ok(myCodeB.body.pairingCode);

      const qrConnect = await apiCall({
        method: 'POST',
        url: '/api/udhar/qr/connect',
        token: tokenA,
        body: {
          pairingCode: myCodeB.body.pairingCode,
          connectionMethod: 'CONFIRMATION_CODE',
          relationshipType: 'Friend',
        },
      });
      assert.equal(qrConnect.status, 200);
      assert.equal(qrConnect.body.status, 'connected', 'QR/code connect must add directly without pending request');

      const [contactsA2, contactsB2] = await Promise.all([
        apiCall({ method: 'GET', url: '/api/udhar/contacts', token: tokenA }),
        apiCall({ method: 'GET', url: '/api/udhar/contacts', token: tokenB }),
      ]);
      assert.ok((contactsA2.body.contacts || []).some((c: any) => c.linked_user_id === userBId));
      assert.ok((contactsB2.body.contacts || []).some((c: any) => c.linked_user_id === userAId));
    } finally {
      await cleanupTestUser(userAId);
      await cleanupTestUser(userBId);
    }
  });
});

