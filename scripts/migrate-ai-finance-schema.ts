import { query } from '../server/db';

/**
 * Idempotent PostgreSQL migration for the 7 AI Financial Intelligence features.
 * Mirrors scripts/migrations/20261123_ai_financial_intelligence.sql.
 * Safe to run multiple times without affecting existing tables or data.
 */
async function runMigration() {
  console.log('[Migration] Applying AI Financial Intelligence schema...');

  await query(`
    CREATE TABLE IF NOT EXISTS public.ai_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL CHECK (LENGTH(title) <= 200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated ON public.ai_conversations(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS public.ai_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL CHECK (LENGTH(content) <= 20000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON public.ai_messages(conversation_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS public.user_categorization_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      merchant_pattern TEXT NOT NULL CHECK (LENGTH(merchant_pattern) >= 2 AND LENGTH(merchant_pattern) <= 120),
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense')),
      usage_count INTEGER NOT NULL DEFAULT 1 CHECK (usage_count >= 1),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, merchant_pattern)
    );

    CREATE TABLE IF NOT EXISTS public.receipt_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      transaction_id TEXT,
      file_hash TEXT NOT NULL,
      merchant TEXT,
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0 AND amount <= 100000000.00),
      receipt_date DATE,
      receipt_number TEXT,
      payment_method TEXT,
      confidence NUMERIC(4, 2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_receipt_records_user_hash ON public.receipt_records(user_id, file_hash);

    CREATE TABLE IF NOT EXISTS public.net_worth_assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (LENGTH(name) <= 120),
      category TEXT NOT NULL,
      current_value NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (current_value >= 0),
      valuation_date DATE NOT NULL,
      notes TEXT,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_nw_assets_user ON public.net_worth_assets(user_id, is_archived);

    CREATE TABLE IF NOT EXISTS public.net_worth_liabilities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (LENGTH(name) <= 120),
      category TEXT NOT NULL,
      current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
      valuation_date DATE NOT NULL,
      notes TEXT,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_nw_liabilities_user ON public.net_worth_liabilities(user_id, is_archived);

    CREATE TABLE IF NOT EXISTS public.net_worth_settings (
      user_id TEXT PRIMARY KEY,
      include_liquid_balance BOOLEAN NOT NULL DEFAULT TRUE,
      include_udhar_receivables BOOLEAN NOT NULL DEFAULT TRUE,
      include_udhar_payables BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.net_worth_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      snapshot_date DATE NOT NULL,
      total_assets NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_assets >= 0),
      total_liabilities NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_liabilities >= 0),
      net_worth NUMERIC(14, 2) NOT NULL DEFAULT 0,
      linked_liquid_balance NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (linked_liquid_balance >= 0),
      linked_udhar_receivable NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (linked_udhar_receivable >= 0),
      linked_udhar_payable NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (linked_udhar_payable >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, snapshot_date)
    );

    CREATE TABLE IF NOT EXISTS public.safe_to_spend_preferences (
      user_id TEXT PRIMARY KEY,
      minimum_balance_reserve NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (minimum_balance_reserve >= 0),
      emergency_reserve NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (emergency_reserve >= 0),
      savings_commitment NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (savings_commitment >= 0),
      essential_expense_reserve NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (essential_expense_reserve >= 0),
      expected_remaining_income NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (expected_remaining_income >= 0),
      include_expected_income BOOLEAN NOT NULL DEFAULT FALSE,
      period TEXT NOT NULL DEFAULT 'month' CHECK (period IN ('day', 'week', 'month')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.smart_alert_preferences (
      user_id TEXT PRIMARY KEY,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.smart_alert_events (
      user_id TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('read', 'dismissed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, dedupe_key)
    );
  `);

  console.log('[Migration] AI Financial Intelligence schema ready.');
}

runMigration()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Migration Error]:', err);
    process.exit(1);
  });
