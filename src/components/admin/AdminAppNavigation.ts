export type AdminSectionKey =
  | 'dashboard'
  | 'users'
  | 'installed_devices'
  | 'admins'
  | 'activity'
  | 'financial_access'
  | 'transactions'
  | 'security'
  | 'login_attempts'
  | 'sessions'
  | 'deletions'
  | 'emails'
  | 'email_templates'
  | 'notifications'
  | 'broadcasts'
  | 'feedback'
  | 'complaints'
  | 'support'
  | 'legal'
  | 'analytics'
  | 'ai'
  | 'system'
  | 'database'
  | 'backups'
  | 'audit_logs'
  | 'settings'
  | 'roles'
  | 'features'
  | 'website_control'
  | 'staff_tasks'
  | 'app_management'
  | 'app_branding'
  | 'app_pwa'
  | 'app_push'
  | 'app_config'
  | 'app_preview'
  | 'app_history';

const VALID_SECTIONS = new Set<string>([
  'dashboard',
  'users',
  'installed_devices',
  'admins',
  'activity',
  'financial_access',
  'transactions',
  'security',
  'login_attempts',
  'sessions',
  'deletions',
  'emails',
  'email_templates',
  'notifications',
  'broadcasts',
  'feedback',
  'complaints',
  'support',
  'legal',
  'analytics',
  'ai',
  'system',
  'database',
  'backups',
  'audit_logs',
  'settings',
  'roles',
  'features',
  'website_control',
  'staff_tasks',
  'app_management',
  'app_branding',
  'app_pwa',
  'app_push',
  'app_config',
  'app_preview',
  'app_history',
]);

export function normalizeAdminSection(raw?: string | null): AdminSectionKey {
  const val = (raw || '').trim().toLowerCase();
  if (VALID_SECTIONS.has(val)) {
    return val as AdminSectionKey;
  }
  return 'dashboard';
}

export function mapAdminNotificationTargetToSection(input: {
  url?: string | null;
  category?: string | null;
  eventType?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
}): { section: AdminSectionKey; recordId: string | null } {
  let rawSection = '';
  let recordId: string | null = input.relatedEntityId ? String(input.relatedEntityId) : null;

  if (input.url) {
    const rawUrl = String(input.url).trim();
    if (rawUrl.startsWith('admin:')) {
      const rest = rawUrl.slice('admin:'.length);
      const [sec, idPart] = rest.split(':');
      if (sec) rawSection = sec;
      if (idPart && !recordId) recordId = idPart;
    } else {
      try {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'https://admin.nileshbarela.site';
        const parsed = new URL(rawUrl, origin);
        const qTab = parsed.searchParams.get('tab');
        const qId = parsed.searchParams.get('id');
        if (qTab) rawSection = qTab;
        if (qId && !recordId) recordId = qId;
        if (!rawSection && parsed.hash.startsWith('#admin=')) {
          rawSection = parsed.hash.replace('#admin=', '').split('&')[0];
        }
      } catch {
        // Ignore URL parsing errors
      }
    }
  }

  if (!rawSection) {
    const key = `${input.eventType || ''} ${input.category || ''} ${input.relatedEntityType || ''}`.toLowerCase();
    if (key.includes('complaint')) rawSection = 'complaints';
    else if (key.includes('feedback')) rawSection = 'feedback';
    else if (key.includes('support') || key.includes('ticket')) rawSection = 'support';
    else if (key.includes('user')) rawSection = 'users';
    else if (key.includes('security') || key.includes('suspicious')) rawSection = 'security';
    else if (key.includes('payment')) rawSection = 'transactions';
    else if (key.includes('system')) rawSection = 'system';
    else rawSection = 'notifications';
  }

  return {
    section: normalizeAdminSection(rawSection),
    recordId,
  };
}
