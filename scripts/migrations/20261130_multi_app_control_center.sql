-- =============================================================================
-- Migration: Multi-App Control Center, 4-Identity Branding, Versioning & Staff Tasks
-- Date: 2026-11-30
-- Safe & Idempotent: Preserves all existing users, financial, Udhaar & QR data.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_config_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  config JSONB NOT NULL,
  summary TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_platform_config_versions_status_version
  ON public.platform_config_versions (status, version DESC);

CREATE INDEX IF NOT EXISTS idx_platform_config_versions_created_at
  ON public.platform_config_versions (created_at DESC);

CREATE TABLE IF NOT EXISTS public.branding_assets (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('user_app', 'admin_app', 'staff_app', 'website', 'general')),
  slot TEXT NOT NULL CHECK (slot IN ('logo', 'favicon', 'pwa_icon', 'og_image', 'hero_image', 'banner', 'splash')),
  mime_type TEXT NOT NULL,
  data_content TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branding_assets_scope_slot
  ON public.branding_assets (scope, slot, created_at DESC);

CREATE TABLE IF NOT EXISTS public.staff_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'operations',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'blocked', 'cancelled')),
  assigned_to UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  assigned_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  related_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  related_ticket_id TEXT,
  due_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_tasks_assigned_status
  ON public.staff_tasks (assigned_to, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_tasks_status_priority
  ON public.staff_tasks (status, priority, created_at DESC);

-- Ensure app_users supports status & custom_permissions & role_slug smoothly
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS role_slug TEXT,
  ADD COLUMN IF NOT EXISTS custom_permissions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Row Level Security Policies
ALTER TABLE public.platform_config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branding_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_tasks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'branding_assets' AND policyname = 'Public read branding assets'
  ) THEN
    CREATE POLICY "Public read branding assets"
      ON public.branding_assets FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'platform_config_versions' AND policyname = 'Admin read published config versions'
  ) THEN
    CREATE POLICY "Admin read published config versions"
      ON public.platform_config_versions FOR SELECT
      USING (status = 'published');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'staff_tasks' AND policyname = 'Staff read own tasks'
  ) THEN
    CREATE POLICY "Staff read own tasks"
      ON public.staff_tasks FOR SELECT
      USING (auth.uid() = assigned_to OR auth.uid() = assigned_by);
  END IF;
END $$;

-- Add app_settings & staff_tasks to Realtime publication when available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_tasks;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
