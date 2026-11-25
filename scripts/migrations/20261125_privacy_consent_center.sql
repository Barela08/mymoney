-- ============================================================================
-- Migration: 20261125_privacy_consent_center.sql
-- Purpose: Extend public.user_consents for granular Privacy Choices & Consent
--          Center (My Money Manager by HackifyPro), harden RLS policies,
--          enforce append-only audit history, prevent duplicate clicks via
--          idempotency keys, and default promotional offers to FALSE.
-- Safe & Idempotent: Preserves all existing historical consent rows intact.
-- ============================================================================

-- 1. Ensure public.user_consents exists with full audit schema
CREATE TABLE IF NOT EXISTS public.user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_email TEXT,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_granted',
  consent_status TEXT NOT NULL DEFAULT 'not_granted',
  action TEXT NOT NULL DEFAULT 'granted',
  policy_version TEXT NOT NULL DEFAULT 'v2.1 — DPDP Act 2023 & Rules 2025',
  consent_wording TEXT,
  granted_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'privacy_choices_modal',
  audit_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Add new columns idempotently to pre-existing user_consents tables
ALTER TABLE public.user_consents
  ADD COLUMN IF NOT EXISTS consent_status TEXT,
  ADD COLUMN IF NOT EXISTS granted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'privacy_choices_modal',
  ADD COLUMN IF NOT EXISTS audit_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- 3. Backfill new columns for existing historical rows without altering status/timestamps
UPDATE public.user_consents
SET
  consent_status = COALESCE(consent_status, status),
  granted_at = CASE WHEN status = 'granted' AND granted_at IS NULL THEN created_at ELSE granted_at END,
  withdrawn_at = CASE WHEN status = 'withdrawn' AND withdrawn_at IS NULL THEN created_at ELSE withdrawn_at END
WHERE consent_status IS NULL
   OR (status = 'granted' AND granted_at IS NULL)
   OR (status = 'withdrawn' AND withdrawn_at IS NULL);

-- Set NOT NULL default on consent_status after backfill
ALTER TABLE public.user_consents
  ALTER COLUMN consent_status SET DEFAULT 'not_granted';

-- 4. Indexes for fast per-user history & duplicate click prevention
CREATE INDEX IF NOT EXISTS idx_user_consents_user_purpose_created
  ON public.user_consents (user_id, purpose, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_consents_idempotency
  ON public.user_consents (user_id, purpose, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 5. Harden Row Level Security (strict user isolation — no anonymous access!)
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_consents_owner_policy ON public.user_consents;
DROP POLICY IF EXISTS user_consents_select_own ON public.user_consents;
DROP POLICY IF EXISTS user_consents_insert_own ON public.user_consents;

CREATE POLICY user_consents_select_own
  ON public.user_consents
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY user_consents_insert_own
  ON public.user_consents
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 6. Preserve historical consent records (append-only for regular users)
CREATE OR REPLACE FUNCTION public.prevent_user_consents_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Disallow modifying historical status, user_id, purpose, or timestamps
    IF NEW.user_id <> OLD.user_id
       OR NEW.purpose <> OLD.purpose
       OR NEW.status <> OLD.status
       OR COALESCE(NEW.consent_status, '') <> COALESCE(OLD.consent_status, '')
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'Consent history is append-only; insert a new consent event instead of mutating historical rows.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_consents_append_only ON public.user_consents;
CREATE TRIGGER trg_user_consents_append_only
  BEFORE UPDATE ON public.user_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_user_consents_mutation();

-- 7. Ensure promotional notifications default to FALSE for new rows
-- (Does not alter existing users' saved preferences!)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_preferences'
      AND column_name = 'notify_offers'
  ) THEN
    ALTER TABLE public.notification_preferences
      ALTER COLUMN notify_offers SET DEFAULT FALSE;
  END IF;
END $$;
