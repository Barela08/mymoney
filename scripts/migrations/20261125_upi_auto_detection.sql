-- ==============================================================================
-- MIGRATION: Automatic UPI Payment Detection & Instant Expense Categorization
-- Product: My Money Manager by HackifyPro
-- Target: PostgreSQL 15+ / Supabase
-- Idempotent: Safe to run multiple times
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. EXPENSE DETECTION SETTINGS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expense_detection_settings (
    user_id UUID PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    auto_popup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
    supported_apps JSONB NOT NULL DEFAULT '{
        "google_pay": true,
        "phonepe": true,
        "paytm": true,
        "bhim": true,
        "amazon_pay": true,
        "cred": true,
        "generic_upi": false
    }'::jsonb,
    last_detection_at TIMESTAMPTZ,
    retention_days INTEGER NOT NULL DEFAULT 90 CHECK (retention_days >= 7 AND retention_days <= 365),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 2. DETECTED TRANSACTIONS TABLE
-- ------------------------------------------------------------------------------
-- Stores normalized outgoing UPI payment notifications prior to and after
-- linking with public.transactions. Monetary amounts are stored strictly as
-- integer paise (minor currency units) to avoid floating-point drift.
CREATE TABLE IF NOT EXISTS public.detected_transactions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0 AND amount_paise <= 10000000000),
    currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
    source_app TEXT NOT NULL,
    source_app_id TEXT NOT NULL,
    source_package TEXT NOT NULL,
    transaction_direction TEXT NOT NULL DEFAULT 'outgoing' CHECK (transaction_direction IN ('outgoing', 'incoming', 'unknown')),
    merchant_name TEXT,
    upi_id TEXT,
    upi_transaction_id TEXT,
    utr_number TEXT,
    rrn TEXT,
    transaction_timestamp TIMESTAMPTZ NOT NULL,
    notification_timestamp TIMESTAMPTZ NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'completed' CHECK (payment_status IN ('completed', 'pending', 'failed', 'reversed', 'unknown')),
    raw_data_hash TEXT NOT NULL,
    detection_confidence NUMERIC(3, 2) NOT NULL DEFAULT 0.60 CHECK (detection_confidence >= 0 AND detection_confidence <= 1),
    verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified', 'unverified', 'partial', 'test_sample')),
    categorization_status TEXT NOT NULL DEFAULT 'pending' CHECK (categorization_status IN ('pending', 'categorized', 'dismissed', 'remind_later')),
    parser_version TEXT NOT NULL DEFAULT '1.0.0',
    parser_used TEXT NOT NULL DEFAULT 'GenericUpiNotificationParser',
    linked_expense_id TEXT,
    selected_category TEXT,
    description TEXT,
    is_test_sample BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast user isolation, pending queue queries, and deduplication
CREATE INDEX IF NOT EXISTS idx_detected_tx_user_status
    ON public.detected_transactions (user_id, categorization_status, notification_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_detected_tx_user_hash
    ON public.detected_transactions (user_id, raw_data_hash);

CREATE INDEX IF NOT EXISTS idx_detected_tx_user_linked
    ON public.detected_transactions (user_id, linked_expense_id)
    WHERE linked_expense_id IS NOT NULL;

-- Unique partial indexes prevent duplicate records on provider transaction references
CREATE UNIQUE INDEX IF NOT EXISTS uq_detected_tx_user_upi_txn_id
    ON public.detected_transactions (user_id, LOWER(upi_transaction_id))
    WHERE upi_transaction_id IS NOT NULL AND LENGTH(TRIM(upi_transaction_id)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_detected_tx_user_utr
    ON public.detected_transactions (user_id, LOWER(utr_number))
    WHERE utr_number IS NOT NULL AND LENGTH(TRIM(utr_number)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_detected_tx_user_rrn
    ON public.detected_transactions (user_id, LOWER(rrn))
    WHERE rrn IS NOT NULL AND LENGTH(TRIM(rrn)) > 0;

-- ------------------------------------------------------------------------------
-- 3. TRANSACTION DETECTION EVENTS TABLE (Append-Only Audit Trail)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transaction_detection_events (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL,
    detected_transaction_id TEXT REFERENCES public.detected_transactions(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'received', 'parsed', 'rejected', 'deduplicated',
            'popup_shown', 'categorized', 'dismissed',
            'remind_later', 'edited', 'test_run'
        )
    ),
    source_package TEXT NOT NULL,
    parser_used TEXT NOT NULL,
    parser_version TEXT NOT NULL DEFAULT '1.0.0',
    raw_data_hash TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detection_events_user_created
    ON public.transaction_detection_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_detection_events_detected_id
    ON public.transaction_detection_events (detected_transaction_id)
    WHERE detected_transaction_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 4. UPDATED_AT TRIGGERS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_upi_detection_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expense_detection_settings_updated_at ON public.expense_detection_settings;
CREATE TRIGGER trg_expense_detection_settings_updated_at
    BEFORE UPDATE ON public.expense_detection_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_upi_detection_updated_at();

DROP TRIGGER IF EXISTS trg_detected_transactions_updated_at ON public.detected_transactions;
CREATE TRIGGER trg_detected_transactions_updated_at
    BEFORE UPDATE ON public.detected_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_upi_detection_updated_at();

-- ------------------------------------------------------------------------------
-- 5. STRICT ROW LEVEL SECURITY (RLS) — MULTI-TENANT ISOLATION
-- ------------------------------------------------------------------------------
ALTER TABLE public.expense_detection_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detected_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_detection_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_detection_settings_owner_all" ON public.expense_detection_settings;
CREATE POLICY "expense_detection_settings_owner_all"
    ON public.expense_detection_settings
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "detected_transactions_owner_all" ON public.detected_transactions;
CREATE POLICY "detected_transactions_owner_all"
    ON public.detected_transactions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "transaction_detection_events_owner_select" ON public.transaction_detection_events;
CREATE POLICY "transaction_detection_events_owner_select"
    ON public.transaction_detection_events
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "transaction_detection_events_owner_insert" ON public.transaction_detection_events;
CREATE POLICY "transaction_detection_events_owner_insert"
    ON public.transaction_detection_events
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "transaction_detection_events_owner_delete" ON public.transaction_detection_events;
CREATE POLICY "transaction_detection_events_owner_delete"
    ON public.transaction_detection_events
    FOR DELETE
    USING (auth.uid() = user_id);
