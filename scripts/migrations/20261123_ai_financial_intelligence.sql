-- ==============================================================================
-- Migration: 20261123_ai_financial_intelligence.sql
-- Project: My Money Manager by HackifyPro
-- Description: Non-destructive, idempotent schema & Row Level Security (RLS)
--              for the 7 AI Financial Intelligence features.
-- Safety: NEVER drops or modifies existing tables or user financial records.
-- ==============================================================================

BEGIN;

-- 1. AI Money Assistant Conversations
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (LENGTH(title) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated
  ON public.ai_conversations (user_id, updated_at DESC);

-- 2. AI Money Assistant Messages
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (LENGTH(content) <= 20000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conv
  ON public.ai_messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_user
  ON public.ai_messages (user_id, created_at DESC);

-- 3. User-Learned Transaction Categorization Rules
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
CREATE INDEX IF NOT EXISTS idx_user_cat_rules_user
  ON public.user_categorization_rules (user_id, usage_count DESC);

-- 4. Scanned Receipt Duplicate Registry & Audit Metadata
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
CREATE INDEX IF NOT EXISTS idx_receipt_records_user_hash
  ON public.receipt_records (user_id, file_hash);
CREATE INDEX IF NOT EXISTS idx_receipt_records_user_created
  ON public.receipt_records (user_id, created_at DESC);

-- 5. Net Worth Assets
CREATE TABLE IF NOT EXISTS public.net_worth_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (LENGTH(name) <= 120),
  category TEXT NOT NULL,
  current_value NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (current_value >= 0 AND current_value <= 10000000000.00),
  valuation_date DATE NOT NULL,
  notes TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nw_assets_user
  ON public.net_worth_assets (user_id, is_archived);

-- 6. Net Worth Liabilities
CREATE TABLE IF NOT EXISTS public.net_worth_liabilities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (LENGTH(name) <= 120),
  category TEXT NOT NULL,
  current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0 AND current_balance <= 10000000000.00),
  valuation_date DATE NOT NULL,
  notes TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nw_liabilities_user
  ON public.net_worth_liabilities (user_id, is_archived);

-- 7. Net Worth Inclusion Settings (Prevents Double-Counting)
CREATE TABLE IF NOT EXISTS public.net_worth_settings (
  user_id TEXT PRIMARY KEY,
  include_liquid_balance BOOLEAN NOT NULL DEFAULT TRUE,
  include_udhar_receivables BOOLEAN NOT NULL DEFAULT TRUE,
  include_udhar_payables BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Net Worth Historical Snapshots (Real Persisted Snapshots Only)
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
CREATE INDEX IF NOT EXISTS idx_nw_snapshots_user_date
  ON public.net_worth_snapshots (user_id, snapshot_date ASC);

-- 9. Safe-to-Spend Reserve Preferences
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

-- 10. Smart Alert Preferences
CREATE TABLE IF NOT EXISTS public.smart_alert_preferences (
  user_id TEXT PRIMARY KEY,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Smart Alert Event Deduplication & Read/Dismiss State
CREATE TABLE IF NOT EXISTS public.smart_alert_events (
  user_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('read', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, dedupe_key)
);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) — STRICT PER-USER ISOLATION (Supabase / PostgreSQL)
-- ==============================================================================

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_categorization_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.net_worth_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.net_worth_liabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.net_worth_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.net_worth_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safe_to_spend_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_alert_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_alert_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ai_conversations',
    'ai_messages',
    'user_categorization_rules',
    'receipt_records',
    'net_worth_assets',
    'net_worth_liabilities',
    'net_worth_settings',
    'net_worth_snapshots',
    'safe_to_spend_preferences',
    'smart_alert_preferences',
    'smart_alert_events'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_owner_isolation" ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "%s_owner_isolation" ON public.%I FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id)',
      tbl,
      tbl
    );
  END LOOP;
END $$;

COMMIT;
