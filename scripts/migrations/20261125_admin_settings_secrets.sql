-- ============================================================================
-- Migration: 20261125_admin_settings_secrets.sql
-- Purpose:
--   1. Create server-only encrypted secret table public.admin_secrets for
--      admin-managed API keys (never readable by anon/authenticated clients).
--   2. Ensure default maintenance_mode and app_download_popup entries exist
--      in public.app_settings without overwriting existing admin configuration.
-- Safe & Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_secrets (
  key TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  masked_preview TEXT NOT NULL,
  is_encrypted BOOLEAN NOT NULL DEFAULT TRUE,
  last_validation_status TEXT,
  last_validation_message TEXT,
  last_validated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

-- Strictly enable Row Level Security with zero public policies so client-side
-- Supabase anon/authenticated roles can NEVER read or mutate API keys.
ALTER TABLE public.admin_secrets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_secrets FROM PUBLIC;
REVOKE ALL ON public.admin_secrets FROM anon;
REVOKE ALL ON public.admin_secrets FROM authenticated;

CREATE INDEX IF NOT EXISTS idx_admin_secrets_updated_at
  ON public.admin_secrets (updated_at DESC);

-- Ensure public.app_settings exists if running standalone
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

-- Seed default maintenance_mode & app_download_popup entries idempotently
INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  (
    'maintenance_mode',
    '{"isEnabled":false,"title":"My Money Manager is Under Scheduled Maintenance","message":"We are upgrading our secure financial infrastructure to deliver better performance and security. Normal services will resume shortly.","expectedRestoration":"Within 2 hours"}'::jsonb,
    NOW()
  ),
  (
    'app_download_popup',
    '{"enabled":true,"downloadUrl":"https://mymoney.nileshbarela.site/#install","title":"Get My Money Manager App","description":"Track expenses, Udhar & smart insights faster with the app.","buttonLabel":"Download App"}'::jsonb,
    NOW()
  )
ON CONFLICT (key) DO NOTHING;
