import { query } from '../server/db';

async function migrateAdminSystem() {
  console.log('🔄 Running Admin System Migration...');

  // 1. Create financial_data_access_requests table if not exists
  await query(`
    CREATE TABLE IF NOT EXISTS public.financial_data_access_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      requesting_admin_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
      requesting_admin_email TEXT NOT NULL,
      target_user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
      target_user_email TEXT NOT NULL,
      reason TEXT NOT NULL,
      purpose TEXT NOT NULL,
      data_scopes JSONB NOT NULL DEFAULT '["balance", "transactions"]',
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, revoked, expired
      approved_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
      approved_by_email TEXT,
      approved_at TIMESTAMPTZ,
      rejected_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
      rejected_by_email TEXT,
      rejection_reason TEXT,
      rejected_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      revoked_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
      revoked_by_email TEXT,
      revocation_reason TEXT,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('✅ financial_data_access_requests table ready');

  // 2. Create financial_data_access_logs table if not exists
  await query(`
    CREATE TABLE IF NOT EXISTS public.financial_data_access_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id UUID REFERENCES public.financial_data_access_requests(id) ON DELETE SET NULL,
      admin_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
      admin_email TEXT NOT NULL,
      target_user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
      target_user_email TEXT NOT NULL,
      data_scope TEXT NOT NULL,
      action TEXT NOT NULL, -- view_balance, view_transactions, view_udhar, export_financial_data
      ip_address TEXT,
      details JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('✅ financial_data_access_logs table ready');

  // Indexes for high performance
  await query(`
    CREATE INDEX IF NOT EXISTS idx_fin_access_target ON public.financial_data_access_requests(target_user_id);
    CREATE INDEX IF NOT EXISTS idx_fin_access_status ON public.financial_data_access_requests(status);
    CREATE INDEX IF NOT EXISTS idx_fin_access_req_admin ON public.financial_data_access_requests(requesting_admin_id);
    CREATE INDEX IF NOT EXISTS idx_fin_access_logs_target ON public.financial_data_access_logs(target_user_id);
    CREATE INDEX IF NOT EXISTS idx_fin_access_logs_admin ON public.financial_data_access_logs(admin_id);
  `);

  // 3. Ensure all 7 AI Financial Intelligence features and core feature flags exist in feature_flags table
  const defaultFeatures = [
    { key: 'ai_money_assistant', name: 'AI Money Assistant', description: 'Intelligent conversational assistant for spending insights and guidance' },
    { key: 'smart_categorization', name: 'Smart Transaction Categorization', description: 'Auto-detecting category & subcategory from merchant and description' },
    { key: 'expense_calendar', name: 'Expense Calendar View', description: 'Day-by-day interactive financial timeline and spending heatmap' },
    { key: 'smart_financial_alerts', name: 'Smart Financial Alerts', description: 'Proactive budget threshold warning and anomaly detection' },
    { key: 'receipt_scanner_ocr', name: 'Receipt Scanner OCR', description: 'Optical character recognition to parse paper bills and receipts' },
    { key: 'net_worth_tracker', name: 'Net Worth Tracker', description: 'Consolidated asset, savings, and liability calculation' },
    { key: 'safe_to_spend', name: 'Safe-to-Spend Calculator', description: 'Real-time liquidity buffer calculation after committed bills' },
    { key: 'budget_planner', name: 'Category Budget Limits', description: 'Monthly spending thresholds with visual progress tracking' },
    { key: 'savings_goals', name: 'Savings Goals Tracker', description: 'Target-based savings milestones and contribution logging' },
    { key: 'recurring_bills', name: 'Recurring Bills & Subscriptions', description: 'Scheduled dues, utility bills, and reminder schedules' },
    { key: 'push_notifications', name: 'Web Push Notifications', description: 'PWA Web Push notifications for instantaneous alerts' },
    { key: 'pwa_installation', name: 'Progressive Web App Install', description: 'Offline install prompt and service worker caching' },
  ];

  for (const feat of defaultFeatures) {
    await query(`
      INSERT INTO public.feature_flags (key, name, description, is_enabled, rollout_percentage)
      VALUES ($1, $2, $3, TRUE, 100)
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description;
    `, [feat.key, feat.name, feat.description]);
  }
  console.log('✅ Feature flags initialized for 7 AI modules and core platform features');

  // 4. Update admin_roles with all standardized granular permissions
  const standardPermissions = {
    superadmin: ['*'],
    admin: [
      'dashboard.view',
      'users.view',
      'users.create',
      'users.update',
      'users.suspend',
      'users.financial_data.request',
      'admins.view',
      'roles.view',
      'analytics.view',
      'notifications.view',
      'notifications.send',
      'notifications.schedule',
      'features.manage',
      'settings.manage',
      'security.view',
      'audit_logs.view',
      'database.view',
      'backup.manage',
      'maintenance.manage',
      'support.manage',
      'ai.manage'
    ],
    support: [
      'dashboard.view',
      'users.view',
      'support.manage',
      'users.financial_data.request',
      'notifications.view',
      'audit_logs.view'
    ],
    analyst: [
      'dashboard.view',
      'users.view',
      'analytics.view',
      'audit_logs.view',
      'database.view'
    ]
  };

  for (const [slug, perms] of Object.entries(standardPermissions)) {
    await query(`
      UPDATE public.admin_roles 
      SET permissions = $1, updated_at = NOW() 
      WHERE slug = $2;
    `, [JSON.stringify(perms), slug]);
  }
  console.log('✅ Admin roles synchronized with standard granular permissions');

  console.log('🎉 Admin System Migration Finished Successfully!');
}

migrateAdminSystem()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
