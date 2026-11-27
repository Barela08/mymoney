-- ============================================================================
-- Migration: Udhaar Manual Confirmation, Instant QR/Code Lifecycle & Indexes
-- Product: My Money Manager by HackifyPro
-- Safe, idempotent migration preserving all existing user records.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'udhar_transactions'
  ) THEN
    ALTER TABLE public.udhar_transactions
      ADD COLUMN IF NOT EXISTS creation_method TEXT NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS accepted_by UUID NULL,
      ADD COLUMN IF NOT EXISTS rejected_by UUID NULL,
      ADD COLUMN IF NOT EXISTS cancelled_by UUID NULL,
      ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL,
      ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;

    -- Replace legacy check constraints so full lifecycle statuses persist natively
    ALTER TABLE public.udhar_transactions
      DROP CONSTRAINT IF EXISTS udhar_transactions_status_check;

    ALTER TABLE public.udhar_transactions
      ADD CONSTRAINT udhar_transactions_status_check
      CHECK (status IN (
        'pending_confirmation',
        'confirmed',
        'rejected',
        'cancelled',
        'disputed',
        'settled',
        'deleted'
      ));

    ALTER TABLE public.udhar_transactions
      DROP CONSTRAINT IF EXISTS udhar_transactions_confirmation_status_check;

    ALTER TABLE public.udhar_transactions
      ADD CONSTRAINT udhar_transactions_confirmation_status_check
      CHECK (confirmation_status IN (
        'pending',
        'confirmed',
        'rejected',
        'disputed',
        'cancelled'
      ));

    CREATE INDEX IF NOT EXISTS idx_udhar_transactions_user_status
      ON public.udhar_transactions (user_id, status)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_udhar_transactions_link_id
      ON public.udhar_transactions (link_id);

    CREATE INDEX IF NOT EXISTS idx_udhar_transactions_idempotency
      ON public.udhar_transactions (user_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  END IF;
END $$;
