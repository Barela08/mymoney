-- ==============================================================================
-- Rollback for 20261124_pwa_push_notifications.sql
-- Safely removes only columns & indexes added in 20261124 (preserves existing tables/data).
-- ==============================================================================

DROP INDEX IF EXISTS public.idx_user_notifications_user_dedupe;
DROP INDEX IF EXISTS public.idx_push_subscriptions_user_active;
DROP INDEX IF EXISTS public.idx_notif_logs_user_channel;

ALTER TABLE IF EXISTS public.user_notifications
  DROP COLUMN IF EXISTS dedupe_key;

ALTER TABLE IF EXISTS public.user_notification_preferences
  DROP COLUMN IF EXISTS notify_budget,
  DROP COLUMN IF EXISTS notify_bills,
  DROP COLUMN IF EXISTS notify_savings,
  DROP COLUMN IF EXISTS notify_receipts,
  DROP COLUMN IF EXISTS notify_security;

ALTER TABLE IF EXISTS public.push_subscriptions
  DROP COLUMN IF EXISTS device_name,
  DROP COLUMN IF EXISTS browser,
  DROP COLUMN IF EXISTS os,
  DROP COLUMN IF EXISTS is_active,
  DROP COLUMN IF EXISTS failure_count,
  DROP COLUMN IF EXISTS last_used_at;
