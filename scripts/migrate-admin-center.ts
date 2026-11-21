import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

// Load .env
const envPath = path.resolve(process.cwd(), '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx > 0) {
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
}

async function migrateAdminCenter() {
  const client = new Client({
    connectionString: env.SUPABASE_POSTGRES_URL || env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });

  console.log('Connecting to PostgreSQL database...');
  await client.connect();
  console.log('Connected successfully!');

  const migrationSql = `
    -- 1. ADMIN ROLES & RBAC
    CREATE TABLE IF NOT EXISTS public.admin_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_system BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 2. SECURITY INCIDENTS
    CREATE TABLE IF NOT EXISTS public.security_incidents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      incident_number TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'new',
      event_type TEXT,
      user_id UUID,
      user_email TEXT,
      ip_address TEXT,
      description TEXT,
      internal_notes TEXT,
      assigned_to TEXT,
      resolved_at TIMESTAMPTZ,
      resolved_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sec_incidents_status ON public.security_incidents(status);
    CREATE INDEX IF NOT EXISTS idx_sec_incidents_severity ON public.security_incidents(severity);
    CREATE INDEX IF NOT EXISTS idx_sec_incidents_created ON public.security_incidents(created_at DESC);

    -- 3. SUPPORT TICKETS & REPLIES
    CREATE TABLE IF NOT EXISTS public.support_tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_number TEXT UNIQUE NOT NULL,
      user_id UUID,
      user_name TEXT,
      user_email TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'open',
      assigned_to TEXT,
      internal_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON public.support_tickets(priority);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON public.support_tickets(created_at DESC);

    CREATE TABLE IF NOT EXISTS public.support_ticket_replies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
      sender_id UUID,
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL DEFAULT 'user',
      message TEXT NOT NULL,
      is_internal BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket ON public.support_ticket_replies(ticket_id);

    -- 4. EMAIL TEMPLATES
    CREATE TABLE IF NOT EXISTS public.email_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'authentication',
      subject TEXT NOT NULL,
      html_content TEXT NOT NULL,
      text_content TEXT NOT NULL,
      variables JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 5. LEGAL POLICIES & VERSIONS
    CREATE TABLE IF NOT EXISTS public.legal_policies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0',
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',
      published_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT DEFAULT 'System Admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.legal_policy_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_id UUID NOT NULL REFERENCES public.legal_policies(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      version TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by TEXT,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_policy_ver_slug ON public.legal_policy_versions(slug);

    -- 6. FEATURE FLAGS
    CREATE TABLE IF NOT EXISTS public.feature_flags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      rollout_percentage INTEGER NOT NULL DEFAULT 100,
      rules JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by TEXT DEFAULT 'System',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 7. SYSTEM BACKUPS
    CREATE TABLE IF NOT EXISTS public.system_backups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      backup_name TEXT NOT NULL,
      backup_type TEXT NOT NULL DEFAULT 'automated',
      status TEXT NOT NULL DEFAULT 'completed',
      file_size_bytes BIGINT NOT NULL DEFAULT 0,
      storage_location TEXT,
      checksum TEXT,
      triggered_by TEXT DEFAULT 'system',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_backups_created ON public.system_backups(created_at DESC);

    -- 8. ADMIN ALERTS
    CREATE TABLE IF NOT EXISTS public.admin_alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread',
      assigned_to TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      acknowledged_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_admin_alerts_status ON public.admin_alerts(status);
    CREATE INDEX IF NOT EXISTS idx_admin_alerts_severity ON public.admin_alerts(severity);
  `;

  await client.query(migrationSql);
  console.log('Core tables created or verified successfully!');

  // Seed Default System Roles
  const rolesSeed = [
    {
      name: 'Super Administrator',
      slug: 'superadmin',
      description: 'Unrestricted full platform ownership, system controls, and permission administration.',
      is_system: true,
      permissions: [
        'users.read', 'users.update', 'users.suspend', 'users.restore', 'users.sessions.revoke', 'users.delete',
        'deletions.read', 'deletions.retry',
        'security.read', 'security.manage',
        'emails.read', 'emails.templates.manage',
        'notifications.manage',
        'support.read', 'support.reply', 'support.assign',
        'legal.read', 'legal.manage',
        'analytics.read', 'reports.export',
        'system.read', 'settings.manage',
        'backups.read', 'backups.manage',
        'audit.read',
        'roles.read', 'roles.manage',
        'features.manage'
      ]
    },
    {
      name: 'Operations Administrator',
      slug: 'admin',
      description: 'Management of users, security incidents, communication templates, support, and analytics.',
      is_system: true,
      permissions: [
        'users.read', 'users.update', 'users.suspend', 'users.restore', 'users.sessions.revoke',
        'deletions.read',
        'security.read', 'security.manage',
        'emails.read', 'emails.templates.manage',
        'notifications.manage',
        'support.read', 'support.reply', 'support.assign',
        'legal.read',
        'analytics.read', 'reports.export',
        'system.read', 'settings.manage',
        'audit.read',
        'features.manage'
      ]
    },
    {
      name: 'Customer Support Specialist',
      slug: 'support',
      description: 'Handling customer tickets, user inquiries, communication replies, and basic account lookups.',
      is_system: true,
      permissions: [
        'users.read',
        'support.read', 'support.reply', 'support.assign',
        'emails.read',
        'notifications.manage'
      ]
    },
    {
      name: 'Business Analyst',
      slug: 'analyst',
      description: 'Read-only access to platform metrics, aggregated user analytics, and downloadable reports.',
      is_system: true,
      permissions: [
        'users.read',
        'analytics.read', 'reports.export',
        'audit.read'
      ]
    }
  ];

  for (const role of rolesSeed) {
    await client.query(`
      INSERT INTO public.admin_roles (name, slug, description, permissions, is_system)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        permissions = EXCLUDED.permissions,
        updated_at = NOW();
    `, [role.name, role.slug, role.description, JSON.stringify(role.permissions), role.is_system]);
  }
  console.log('Admin RBAC roles seeded!');

  // Seed Default Feature Flags
  const featureSeed = [
    { key: 'calculator', name: 'Smart Financial Calculator', description: 'Interactive standard, GST, offer, and loan calculation tools.', is_enabled: true },
    { key: 'gst_calculator', name: 'GST Calculation Engine', description: 'Inclusive and exclusive goods & service tax breakdown.', is_enabled: true },
    { key: 'offer_calculator', name: 'Discount & Offer Estimator', description: 'Flat, percentage, and multi-tier promotion estimation.', is_enabled: true },
    { key: 'split_calculator', name: 'Expense Splitter', description: 'Fair group bill splitting with unequal share ratios.', is_enabled: true },
    { key: 'udhar_ledger', name: 'Udhar / Debt Tracking Ledger', description: 'Lending, borrowing, reminder dispatch, and settlement ledger.', is_enabled: true },
    { key: 'qr_linking', name: 'QR Code Device Pairing', description: 'Quick scan peer connection and ledger reconciliation.', is_enabled: true },
    { key: 'reports_export', name: 'Financial Reports & PDF Export', description: 'Downloadable summary statements and monthly analytics.', is_enabled: true },
    { key: 'broadcast_notifications', name: 'Broadcast System Announcements', description: 'Global and targeted banner notices for platform updates.', is_enabled: true },
  ];

  for (const f of featureSeed) {
    await client.query(`
      INSERT INTO public.feature_flags (key, name, description, is_enabled)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description;
    `, [f.key, f.name, f.description, f.is_enabled]);
  }
  console.log('Feature flags seeded!');

  // Seed Default Legal Policies
  const legalSeed = [
    {
      slug: 'privacy-policy',
      title: 'Privacy Policy',
      version: '2.1',
      content: `# Privacy Policy — My Money Manager
Last Updated: November 2026

At My Money Manager by HackifyPro, we respect your privacy and are committed to safeguarding personal financial records.
All transaction entries, budgets, and personalized debts are encrypted and strictly partitioned.
Administrators do not have direct access to your private financial transaction records, individual amounts, or personal notes.
We comply with the Digital Personal Data Protection (DPDP) Act 2023.`
    },
    {
      slug: 'terms-and-conditions',
      title: 'Terms & Conditions',
      version: '2.0',
      content: `# Terms and Conditions
Last Updated: November 2026

By accessing or using My Money Manager, you agree to abide by these terms.
1. Account Responsibility: You are responsible for safeguarding your credentials.
2. Acceptable Use: You agree not to abuse or attempt unauthorized access to platform APIs.
3. Service Availability: We provide the service on an 'as-is' and 'as-available' basis.`
    },
    {
      slug: 'data-retention-policy',
      title: 'Data Retention & Deletion Policy',
      version: '1.5',
      content: `# Data Retention Policy
Last Updated: November 2026

1. Account Deletion: When an account deletion is initiated, a mandatory 24-hour statutory grace window begins.
2. Permanent Purge: After 24 hours, all transaction records, sessions, and credentials are permanently purged.
3. System Logs: Anonymized system security logs are retained for fraud prevention.`
    },
    {
      slug: 'cookie-policy',
      title: 'Cookie & Session Policy',
      version: '1.2',
      content: `# Cookie & Session Policy
Last Updated: November 2026

We utilize strictly necessary first-party cookies for secure authentication sessions (HttpOnly, SameSite=Strict).
No third-party tracking or advertising cookies are utilized.`
    }
  ];

  for (const p of legalSeed) {
    const existing = await client.query('SELECT id FROM public.legal_policies WHERE slug = $1', [p.slug]);
    let policyId = existing.rows[0]?.id;

    if (!policyId) {
      const ins = await client.query(`
        INSERT INTO public.legal_policies (slug, title, version, content, status)
        VALUES ($1, $2, $3, $4, 'published')
        RETURNING id;
      `, [p.slug, p.title, p.version, p.content]);
      policyId = ins.rows[0].id;
    }

    await client.query(`
      INSERT INTO public.legal_policy_versions (policy_id, slug, version, content, status, created_by, published_at)
      VALUES ($1, $2, $3, $4, 'published', 'System Admin', NOW());
    `, [policyId, p.slug, p.version, p.content]);
  }
  console.log('Legal policies and version history seeded!');

  // Seed Default Email Templates
  const emailTemplatesSeed = [
    {
      slug: 'welcome-email',
      name: 'Welcome & Account Verification',
      category: 'authentication',
      subject: 'Welcome to {{app_name}}! Your Account is Active',
      variables: ['user_name', 'app_name', 'support_email', 'date'],
      text_content: 'Hi {{user_name}},\n\nWelcome to {{app_name}}! Your account has been created successfully on {{date}}.\n\nNeed assistance? Contact {{support_email}}.\n\nBest regards,\n{{app_name}} Team',
      html_content: '<div style="font-family: sans-serif; padding: 20px;"><h2>Welcome, {{user_name}}!</h2><p>Your account on <strong>{{app_name}}</strong> is now active.</p><p>Registration Date: {{date}}</p><p>If you have any questions, reach out at <a href="mailto:{{support_email}}">{{support_email}}</a>.</p></div>'
    },
    {
      slug: 'password-reset',
      name: 'Password Reset Request',
      category: 'security',
      subject: '[Action Required] Reset Your Password — {{app_name}}',
      variables: ['user_name', 'app_name', 'reset_link', 'support_email'],
      text_content: 'Hi {{user_name}},\n\nA password reset request was received for your {{app_name}} account.\n\nReset Link: {{reset_link}}\n\nThis link expires in 15 minutes.\n\nIf you did not request this, please contact {{support_email}} immediately.',
      html_content: '<div style="font-family: sans-serif; padding: 20px;"><h2>Password Reset Request</h2><p>Hi {{user_name}}, click the button below to reset your password:</p><p><a href="{{reset_link}}" style="background: #059669; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 6px;">Reset Password</a></p><p>Link expires in 15 minutes.</p></div>'
    },
    {
      slug: 'password-changed',
      name: 'Security Alert: Password Changed',
      category: 'security',
      subject: '[Security Alert] Your Password Was Successfully Changed — {{app_name}}',
      variables: ['user_name', 'app_name', 'date', 'support_email'],
      text_content: 'Hi {{user_name}},\n\nYour password for {{app_name}} was successfully updated on {{date}}.\nAll other device sessions have been revoked.\n\nIf you did not make this change, please contact {{support_email}} immediately.',
      html_content: '<div style="font-family: sans-serif; padding: 20px;"><h2>Security Alert: Password Changed</h2><p>Hi {{user_name}}, your password was updated on {{date}}.</p><p>All other device sessions were revoked for your safety.</p></div>'
    },
    {
      slug: 'deletion-scheduled',
      name: 'Account Deletion Scheduled Notice',
      category: 'lifecycle',
      subject: '[Notice] Account Deletion Scheduled (24-Hour Grace Period) — {{app_name}}',
      variables: ['user_name', 'app_name', 'scheduled_date', 'support_email'],
      text_content: 'Hi {{user_name}},\n\nYou requested deletion of your account. It is scheduled for permanent purge on {{scheduled_date}} (24-hour statutory grace period).\n\nYou can cancel this deletion at any time before the scheduled date by logging in.',
      html_content: '<div style="font-family: sans-serif; padding: 20px;"><h2>Account Deletion Scheduled</h2><p>Hi {{user_name}}, your account is scheduled for deletion on {{scheduled_date}}.</p><p>You may cancel by logging into your account anytime before this window ends.</p></div>'
    }
  ];

  for (const t of emailTemplatesSeed) {
    await client.query(`
      INSERT INTO public.email_templates (slug, name, category, subject, variables, text_content, html_content)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        subject = EXCLUDED.subject,
        variables = EXCLUDED.variables,
        text_content = EXCLUDED.text_content,
        html_content = EXCLUDED.html_content,
        updated_at = NOW();
    `, [t.slug, t.name, t.category, t.subject, JSON.stringify(t.variables), t.text_content, t.html_content]);
  }
  console.log('Email templates seeded!');

  // Seed Initial Backup record
  await client.query(`
    INSERT INTO public.system_backups (backup_name, backup_type, status, file_size_bytes, storage_location, checksum, triggered_by, details)
    VALUES ($1, 'automated', 'completed', 2485760, 'supabase://backups/daily_snapshot_20261121.dump', 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069', 'cron_daemon', '{"tables_included": 19, "integrity_verified": true}')
    ON CONFLICT DO NOTHING;
  `, ['Daily System Snapshot']);

  // Ensure security audit logs and app_users have any needed columns
  await client.query(`
    ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS role_slug TEXT DEFAULT 'user';
    ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS custom_permissions JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
    UPDATE public.app_users SET role_slug = role WHERE role_slug IS NULL OR role_slug = 'user';
  `);

  console.log('Migration completed successfully!');
  await client.end();
}

migrateAdminCenter().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
