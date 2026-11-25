-- ============================================================================
-- Consent-based Udhar account pairing
-- Adds connection requests (pending -> accepted/rejected) on top of the
-- existing qr_pairing_tokens / user_connections / udhar_contacts tables.
-- Safe to run multiple times. Does not modify or delete existing records.
-- ============================================================================

-- 1. Ensure the pairing token table exists with the columns the API expects.
CREATE TABLE IF NOT EXISTS public.qr_pairing_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  pairing_token TEXT NOT NULL UNIQUE,
  pairing_code TEXT NOT NULL,
  is_single_use BOOLEAN NOT NULL DEFAULT FALSE,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  used_by_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_pairing_token ON public.qr_pairing_tokens(pairing_token);
CREATE INDEX IF NOT EXISTS idx_qr_pairing_user ON public.qr_pairing_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_qr_pairing_code ON public.qr_pairing_tokens(pairing_code);

-- 2. Connection requests: consent is recorded on the row that creates it.
CREATE TABLE IF NOT EXISTS public.udhar_connection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'Friend',
  source TEXT NOT NULL DEFAULT 'search' CHECK (source IN ('qr', 'search', 'manual')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  consent_text TEXT,
  consent_version TEXT,
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT udhar_connection_requests_no_self CHECK (requester_user_id <> target_user_id)
);

-- Duplicate pending requests between the same two users are impossible.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_udhar_conn_request_pending
  ON public.udhar_connection_requests (requester_user_id, target_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_udhar_conn_request_target
  ON public.udhar_connection_requests (target_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_udhar_conn_request_requester
  ON public.udhar_connection_requests (requester_user_id, status, created_at DESC);

ALTER TABLE public.udhar_connection_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'udhar_connection_requests'
      AND policyname = 'udhar_connection_requests_participant_read'
  ) THEN
    CREATE POLICY udhar_connection_requests_participant_read
      ON public.udhar_connection_requests
      FOR SELECT
      USING (auth.uid() = requester_user_id OR auth.uid() = target_user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'udhar_connection_requests'
      AND policyname = 'udhar_connection_requests_requester_insert'
  ) THEN
    CREATE POLICY udhar_connection_requests_requester_insert
      ON public.udhar_connection_requests
      FOR INSERT
      WITH CHECK (auth.uid() = requester_user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'udhar_connection_requests'
      AND policyname = 'udhar_connection_requests_target_update'
  ) THEN
    CREATE POLICY udhar_connection_requests_target_update
      ON public.udhar_connection_requests
      FOR UPDATE
      USING (auth.uid() = target_user_id OR auth.uid() = requester_user_id)
      WITH CHECK (auth.uid() = target_user_id OR auth.uid() = requester_user_id);
  END IF;
END $$;

-- 3. Consent audit records (extends the existing DPDP consent log).
CREATE TABLE IF NOT EXISTS public.user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_email TEXT,
  purpose TEXT NOT NULL DEFAULT 'udhar_connection',
  status TEXT NOT NULL CHECK (status IN ('granted', 'withdrawn', 'not_granted')),
  action TEXT NOT NULL CHECK (action IN ('granted', 'withdrawn')),
  policy_version TEXT NOT NULL DEFAULT 'v1.2 - DPDP Act 2023',
  consent_wording TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_consents' AND policyname = 'user_consents_owner_policy'
  ) THEN
    CREATE POLICY user_consents_owner_policy ON public.user_consents
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;
