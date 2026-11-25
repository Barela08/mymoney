-- ============================================================================
-- Migration: 20261125_udhar_consent_pairing.sql
-- Purpose: Safe, idempotent schema enhancements for Consent-Based Udhar Pairing,
--          Connection Requests (pending/connected/rejected/disconnected), and
--          Granular User Privacy Consents (My Money Manager by HackifyPro)
-- ============================================================================

-- 1. Enhance user_connections with explicit consent metadata & timestamps (idempotent)
ALTER TABLE IF EXISTS public.user_connections
  ADD COLUMN IF NOT EXISTS relationship_type TEXT DEFAULT 'Friend',
  ADD COLUMN IF NOT EXISTS requested_via TEXT DEFAULT 'search',
  ADD COLUMN IF NOT EXISTS consented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_user_connections_target_status
  ON public.user_connections (user_b_id, status);

CREATE INDEX IF NOT EXISTS idx_user_connections_requester_status
  ON public.user_connections (user_a_id, status);

-- 2. Enhance qr_pairing_tokens lookup performance for resolve & revocation
CREATE INDEX IF NOT EXISTS idx_qr_pairing_tokens_code
  ON public.qr_pairing_tokens (pairing_code);

CREATE INDEX IF NOT EXISTS idx_qr_pairing_tokens_user_active
  ON public.qr_pairing_tokens (user_id, used, expires_at DESC);

-- 3. Ensure user_consents supports granular category audit logs
CREATE TABLE IF NOT EXISTS public.user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_email TEXT,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_granted',
  action TEXT NOT NULL DEFAULT 'granted',
  policy_version TEXT NOT NULL DEFAULT 'v2.0 - DPDP Act 2023',
  consent_wording TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user_purpose_created
  ON public.user_consents (user_id, purpose, created_at DESC);
