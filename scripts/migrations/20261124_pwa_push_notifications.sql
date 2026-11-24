-- ==============================================================================
-- My Money Manager — PWA & Real Web Push Notification Safe Additive Migration
-- Date: 2026-11-24
-- Safety: Strictly additive & idempotent. Preserves all existing tables & rows.
-- ==============================================================================

-- 1. Ensure core notification tables exist without overwriting existing data
CREATE TABLE IF NOT EXISTS public.user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  type VARCHAR(50) NOT NULL DEFAULT 'info',
  related_entity_type VARCHAR(50) NULL,
  related_entity_id TEXT NULL,
  deep_link TEXT NULL,
  dedupe_key VARCHAR(200) NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(200) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notifications_user_dedupe
  ON public.user_notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_active
  ON public.user_notifications (user_id, is_deleted, created_at DESC);

-- 2. Extend user_notification_preferences with financial intelligence & security categories
CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id UUID PRIMARY KEY,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notify_income BOOLEAN NOT NULL DEFAULT TRUE,
  notify_expense BOOLEAN NOT NULL DEFAULT TRUE,
  notify_budget BOOLEAN NOT NULL DEFAULT TRUE,
  notify_bills BOOLEAN NOT NULL DEFAULT TRUE,
  notify_udhar BOOLEAN NOT NULL DEFAULT TRUE,
  notify_savings BOOLEAN NOT NULL DEFAULT TRUE,
  notify_receipts BOOLEAN NOT NULL DEFAULT TRUE,
  notify_security BOOLEAN NOT NULL DEFAULT TRUE,
  notify_support BOOLEAN NOT NULL DEFAULT TRUE,
  notify_announcements BOOLEAN NOT NULL DEFAULT TRUE,
  notify_offers BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_hours_start VARCHAR(10) DEFAULT '22:00',
  quiet_hours_end VARCHAR(10) DEFAULT '07:00',
  privacy_hide_amounts BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_notification_preferences
  ADD COLUMN IF NOT EXISTS notify_budget BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_bills BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_savings BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_receipts BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_security BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.user_notification_preferences
  ALTER COLUMN privacy_hide_amounts SET DEFAULT TRUE;

-- 3. Extend push_subscriptions with multi-device metadata & health tracking
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NULL,
  device_name VARCHAR(120) NULL,
  browser VARCHAR(60) NULL,
  os VARCHAR(60) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failure_count INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS device_name VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS browser VARCHAR(60) NULL,
  ADD COLUMN IF NOT EXISTS os VARCHAR(60) NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS failure_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_active
  ON public.push_subscriptions (user_id, is_active, updated_at DESC);

-- 4. Ensure delivery logs table exists
CREATE TABLE IF NOT EXISTS public.notification_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NULL,
  notification_id UUID NULL,
  user_id UUID NOT NULL,
  channel VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'sent',
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_logs_user_channel
  ON public.notification_delivery_logs (user_id, channel, created_at DESC);

-- 5. Enable strict Row Level Security (user isolation) on all push & notification tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'user_notifications',
    'user_notification_preferences',
    'push_subscriptions',
    'notification_delivery_logs'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%s_owner_isolation" ON public.%I', tbl, tbl);
      EXECUTE format(
        'CREATE POLICY "%s_owner_isolation" ON public.%I FOR ALL USING (auth.uid()::text = user_id::text) WITH CHECK (auth.uid()::text = user_id::text)',
        tbl,
        tbl
      );
    END IF;
  END LOOP;
END $$;
