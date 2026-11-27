/**
 * Pure Portal Routing, Strict Admin vs. Staff RBAC Separation, and Scoped PWA Branding Utilities.
 * Shared across frontend UI, server helpers, and automated node:test suites.
 */

export type AppPortalScope = 'user' | 'myadmin' | 'mystaff';

export const MASTER_ADMIN_EMAILS = new Set([
  'hackifypro@gmail.com',
  'admin@mymoney.com',
]);

export const ADMIN_PORTAL_ROLES = new Set(['superadmin', 'admin']);
export const BUILTIN_STAFF_ROLES = new Set(['support', 'analyst']);

export interface PortalRoleCandidate {
  email?: string | null;
  role?: string | null;
  role_slug?: string | null;
}

export interface PortalBrandingInfo {
  scope: AppPortalScope;
  appName: string;
  shortName: string;
  tagline: string;
  subtitle: string;
  logoUrl: string;
  fallbackIcon: string;
  startUrl: string;
  manifestUrl: string;
  swUrl: string;
  swScope: string;
  accent: 'emerald' | 'indigo';
  installButtonLabel: string;
}

export function isMasterAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return MASTER_ADMIN_EMAILS.has(String(email).toLowerCase().trim());
}

/**
 * Normalizes the effective privilege slug from role and role_slug.
 */
export function resolveEffectiveRoleSlug(user?: PortalRoleCandidate | null): string {
  if (!user) return 'user';
  if (isMasterAdminEmail(user.email)) return 'superadmin';
  const slug = String(user.role_slug || '').toLowerCase().trim();
  const baseRole = String(user.role || '').toLowerCase().trim();
  if (slug && slug !== 'user' && slug !== 'anonymous') {
    return slug;
  }
  return baseRole || 'user';
}

/**
 * Returns TRUE strictly for Super Admin & Admin accounts (the /myadmin portal).
 * Staff accounts (support, analyst, or custom staff roles) return FALSE.
 */
export function isAdminPortalUser(user?: PortalRoleCandidate | null): boolean {
  if (!user) return false;
  if (isMasterAdminEmail(user.email)) return true;
  const baseRole = String(user.role || '').toLowerCase().trim();
  const slug = String(user.role_slug || '').toLowerCase().trim();
  if (ADMIN_PORTAL_ROLES.has(baseRole)) return true;
  if (ADMIN_PORTAL_ROLES.has(slug)) return true;
  return false;
}

/**
 * Returns TRUE strictly for Staff accounts (support, analyst, or custom non-admin staff roles)
 * used on the /mystaff portal. Admins and standard users return FALSE.
 */
export function isStaffPortalUser(user?: PortalRoleCandidate | null): boolean {
  if (!user) return false;
  if (isAdminPortalUser(user)) return false;
  const baseRole = String(user.role || '').toLowerCase().trim();
  const slug = String(user.role_slug || '').toLowerCase().trim();
  if (BUILTIN_STAFF_ROLES.has(baseRole) || BUILTIN_STAFF_ROLES.has(slug)) {
    return true;
  }
  if (slug && slug !== 'user' && slug !== 'anonymous') {
    return true;
  }
  return false;
}

/**
 * Determines which application portal is active from pathname, hash, and hostname.
 */
export function getPortalScopeFromLocation(
  pathname: string = '/',
  hash: string = '',
  hostname: string = ''
): AppPortalScope {
  const cleanPath = (pathname || '/').replace(/\/+$/, '') || '/';
  const cleanHash = (hash || '').trim();
  const cleanHost = (hostname || '').toLowerCase().trim();

  if (
    cleanPath === '/mystaff' ||
    cleanPath.startsWith('/mystaff/') ||
    cleanPath === '/staff' ||
    cleanPath.startsWith('/staff/') ||
    cleanHash === '#mystaff' ||
    cleanHash.startsWith('#mystaff=') ||
    cleanHash === '#staff' ||
    cleanHash.startsWith('#staff=')
  ) {
    return 'mystaff';
  }

  if (
    cleanHost.startsWith('admin.') ||
    cleanPath === '/myadmin' ||
    cleanPath.startsWith('/myadmin/') ||
    cleanPath === '/admin' ||
    cleanPath.startsWith('/admin/') ||
    cleanHash === '#myadmin' ||
    cleanHash.startsWith('#myadmin=') ||
    cleanHash === '#admin' ||
    cleanHash.startsWith('#admin=')
  ) {
    return 'myadmin';
  }

  return 'user';
}

export function getCurrentPortalScope(): AppPortalScope {
  if (typeof window === 'undefined') return 'user';
  return getPortalScopeFromLocation(
    window.location.pathname,
    window.location.hash,
    window.location.hostname
  );
}

/**
 * Returns isolated PWA & branding metadata for the active portal ('user' | 'myadmin' | 'mystaff').
 */
export function getPortalBranding(scope: AppPortalScope): PortalBrandingInfo {
  if (scope === 'myadmin') {
    return {
      scope: 'myadmin',
      appName: 'My Money Manager Admin',
      shortName: 'MM Admin',
      tagline: 'A product of HackifyPro · Admin Security Gateway',
      subtitle: 'Dedicated administration console, security controls, and real-time push alerts.',
      logoUrl: '/admin-logo.png',
      fallbackIcon: '/admin-icon-192.png',
      startUrl: '/myadmin',
      manifestUrl: '/myadmin-manifest.json',
      swUrl: '/myadmin-sw.js',
      swScope: '/myadmin',
      accent: 'emerald',
      installButtonLabel: 'Install Admin App',
    };
  }

  if (scope === 'mystaff') {
    return {
      scope: 'mystaff',
      appName: 'My Money Manager Staff',
      shortName: 'MM Staff',
      tagline: 'A product of HackifyPro · Staff Operations Desk',
      subtitle: 'Dedicated staff workspace for support desk, user operations, analytics, and alerts.',
      logoUrl: '/staff-logo.png',
      fallbackIcon: '/staff-icon-192.png',
      startUrl: '/mystaff',
      manifestUrl: '/mystaff-manifest.json',
      swUrl: '/mystaff-sw.js',
      swScope: '/mystaff',
      accent: 'indigo',
      installButtonLabel: 'Install Staff App',
    };
  }

  return {
    scope: 'user',
    appName: 'My Money Manager',
    shortName: 'My Money',
    tagline: 'A product of HackifyPro',
    subtitle: 'Personal & shared finance ledger with instant UPI tracking.',
    logoUrl: '/logo.jpg',
    fallbackIcon: '/icon-192.png',
    startUrl: '/',
    manifestUrl: '/manifest.json',
    swUrl: '/sw.js',
    swScope: '/',
    accent: 'emerald',
    installButtonLabel: 'Install App',
  };
}

/**
 * Evaluates permission matching identically on client & server for Staff/Admin RBAC navigation filtering.
 */
export function hasPortalPermission(
  permissions: string[],
  required?: string
): boolean {
  if (!required) return true;
  if (permissions.includes('*') || permissions.includes('*.*')) return true;
  if (permissions.includes(required)) return true;

  const [reqRes, reqAct] = required.split('.');
  if (!reqAct) return false;

  for (const perm of permissions) {
    if (perm === required) return true;
    const [pRes, pAct] = perm.split('.');
    if (pRes === reqRes) {
      if ((reqAct === 'view' || reqAct === 'read') && (pAct === 'view' || pAct === 'read')) return true;
      if (pAct === 'send' && reqAct === 'manage') return true;
      if (
        pAct === 'manage' &&
        ['view', 'read', 'update', 'reply', 'assign', 'create', 'suspend', 'send', 'tickets'].includes(reqAct)
      ) {
        return true;
      }
      if (reqAct === 'read' && ['tickets', 'reply'].includes(pAct)) return true;
    }
  }
  return false;
}

/**
 * Derives default effective permissions for a staff or admin role when explicit role rows are unavailable client-side.
 */
export function getDefaultPermissionsForRole(user?: (PortalRoleCandidate & { staff_permissions?: string[] }) | null): string[] {
  if (!user) return [];
  if (isMasterAdminEmail(user.email)) return ['*'];
  const effectiveRole = resolveEffectiveRoleSlug(user);

  let perms: string[] = [];
  if (effectiveRole === 'superadmin') {
    return ['*'];
  } else if (effectiveRole === 'admin') {
    perms = [
      'dashboard.view', 'users.view', 'users.update', 'users.suspend', 'users.financial_data.request',
      'admins.view', 'roles.view', 'analytics.view', 'notifications.view', 'notifications.send', 'notifications.manage',
      'features.manage', 'settings.manage', 'security.view', 'audit_logs.view', 'audit.read', 'database.view',
      'backup.manage', 'backups.read', 'maintenance.manage', 'support.manage', 'ai.manage',
      'emails.read', 'emails.templates.manage', 'legal.read', 'deletions.read', 'system.read',
    ];
  } else if (effectiveRole === 'support') {
    perms = [
      'dashboard.view',
      'users.view',
      'support.manage',
      'support.read',
      'users.financial_data.request',
      'notifications.view',
      'notifications.manage',
      'audit_logs.view',
      'audit.read',
    ];
  } else if (effectiveRole === 'analyst') {
    perms = [
      'dashboard.view',
      'users.view',
      'analytics.view',
      'analytics.read',
      'audit_logs.view',
      'audit.read',
      'database.view',
      'notifications.view',
    ];
  } else if (effectiveRole !== 'user' && effectiveRole !== 'anonymous') {
    // Custom staff role baseline view
    perms = ['dashboard.view', 'notifications.view'];
  }

  if (Array.isArray(user.staff_permissions)) {
    for (const p of user.staff_permissions) {
      if (typeof p === 'string' && !perms.includes(p)) {
        perms.push(p);
      }
    }
  }

  return perms;
}
