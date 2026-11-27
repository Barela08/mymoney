-- Migration: Token Bucket Rate Limiting & Progressive Security Restrictions
-- Backward-compatible: adds token bucket columns and security_restrictions table.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 1,
  tokens DOUBLE PRECISION,
  last_refill_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.rate_limits
  ADD COLUMN IF NOT EXISTS tokens DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_refill_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON public.rate_limits(reset_at);

CREATE TABLE IF NOT EXISTS public.security_restrictions (
  restriction_key TEXT PRIMARY KEY,
  dimension TEXT NOT NULL, -- 'ip' | 'device' | 'account' | 'ip_device'
  identifier TEXT NOT NULL,
  violation_level INT NOT NULL DEFAULT 1,
  violation_count INT NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  last_violation_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restricted_until TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  released_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_restrictions_until
  ON public.security_restrictions(restricted_until)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_security_audit_logs_event_created
  ON public.security_audit_logs(event_type, created_at DESC);
