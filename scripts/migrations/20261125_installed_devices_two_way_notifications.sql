-- ==============================================================================
-- My Money Manager — Installed Devices & Two-Way Push Notification System
-- Date: 2026-11-25
-- Safety: Additive & Idempotent. Preserves all existing tables & data.
-- ==============================================================================

-- 1. Installed Devices & PWA Installation Tracking
CREATE TABLE IF NOT EXISTS public.installed_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  device_type VARCHAR(50) NOT NULL DEFAULT 'desktop',
  browser VARCHAR(60) NULL,
  os VARCHAR(60) NULL,
  user_agent TEXT NULL,
  installation_status VARCHAR(50) NOT NULL DEFAULT 'browser',
  is_installed BOOLEAN NOT NULL DEFAULT FALSE,
  installed_at TIMESTAMPTZ NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  push_permission VARCHAR(30) NOT NULL DEFAULT 'default',
  push_subscription_status VARCHAR(30) NOT NULL DEFAULT 'none',
  last_delivery_result VARCHAR(50) NOT NULL DEFAULT 'none',
  ip_address VARCHAR(50) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure partial unique index on user + browser + os + device_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' 
      AND tablename = 'installed_devices' 
      AND indexname = 'idx_installed_devices_user_fingerprint'
  ) THEN
    CREATE UNIQUE INDEX idx_installed_devices_user_fingerprint 
      ON public.installed_devices (user_id, browser, os, device_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_installed_devices_user_active
  ON public.installed_devices (user_id, last_active_at DESC);

CREATE INDEX IF NOT EXISTS idx_installed_devices_status
  ON public.installed_devices (is_installed, push_subscription_status);

-- 2. Two-Way Notification: User to Admin Notifications Table
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  user_id UUID NULL,
  user_email TEXT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_event_read
  ON public.admin_notifications (event_type, is_read, created_at DESC);

-- 3. Admin Notification Preferences
CREATE TABLE IF NOT EXISTS public.admin_notification_preferences (
  admin_id UUID PRIMARY KEY,
  alert_new_user_registration BOOLEAN NOT NULL DEFAULT TRUE,
  alert_app_installation BOOLEAN NOT NULL DEFAULT TRUE,
  alert_support_ticket BOOLEAN NOT NULL DEFAULT TRUE,
  alert_critical_security BOOLEAN NOT NULL DEFAULT TRUE,
  alert_push_failure BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_hours_start VARCHAR(10) NOT NULL DEFAULT '22:00',
  quiet_hours_end VARCHAR(10) NOT NULL DEFAULT '07:00',
  delivery_channel VARCHAR(30) NOT NULL DEFAULT 'push_and_inapp',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Enable Row Level Security
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'installed_devices',
    'admin_notifications',
    'admin_notification_preferences'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;
END $$;
