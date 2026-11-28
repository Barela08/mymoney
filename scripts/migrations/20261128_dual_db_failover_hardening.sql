-- =============================================================================
-- Migration: Dual-Database Failover Hardening, Bidirectional Outbox, Identity
-- Mapping & Supabase Nano Performance Indexes (Backward-Compatible & Idempotent)
-- =============================================================================

-- 1. Extend sync_outbox for bidirectional replication & fencing epoch tracking
CREATE TABLE IF NOT EXISTS public.sync_outbox (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  collection_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_version BIGINT NOT NULL DEFAULT 1,
  source_db TEXT NOT NULL DEFAULT 'supabase',
  target_db TEXT NOT NULL DEFAULT 'firebase',
  provider_epoch BIGINT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed', 'conflict')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 10,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sync_outbox ADD COLUMN IF NOT EXISTS target_db TEXT NOT NULL DEFAULT 'firebase';
ALTER TABLE public.sync_outbox ADD COLUMN IF NOT EXISTS provider_epoch BIGINT NOT NULL DEFAULT 1;
ALTER TABLE public.sync_outbox ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 10;

CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending
  ON public.sync_outbox (status, next_retry_at)
  WHERE status <> 'synced';

-- 2. Distributed Failover Lease & History
CREATE TABLE IF NOT EXISTS public.failover_state (
  id TEXT PRIMARY KEY DEFAULT 'primary_lease',
  active_provider TEXT NOT NULL DEFAULT 'supabase',
  provider_epoch BIGINT NOT NULL DEFAULT 1,
  lease_until TIMESTAMPTZ,
  last_failover_at TIMESTAMPTZ,
  last_recovery_at TIMESTAMPTZ,
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.failover_history (
  id BIGSERIAL PRIMARY KEY,
  from_provider TEXT NOT NULL,
  to_provider TEXT NOT NULL,
  provider_epoch BIGINT NOT NULL,
  reason TEXT,
  downtime_ms BIGINT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Independent Health Check Logs & Alert Delivery Log
CREATE TABLE IF NOT EXISTS public.service_health_logs (
  id BIGSERIAL PRIMARY KEY,
  service_name TEXT NOT NULL,
  status TEXT NOT NULL,
  response_time_ms INT,
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_health_logs_recent
  ON public.service_health_logs (service_name, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.alert_delivery_logs (
  id TEXT PRIMARY KEY,
  service_key TEXT NOT NULL,
  transition TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'high',
  subject TEXT NOT NULL,
  email_status TEXT NOT NULL DEFAULT 'pending',
  in_app_status TEXT NOT NULL DEFAULT 'pending',
  downtime_ms BIGINT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Verified Logical Backup Snapshots
CREATE TABLE IF NOT EXISTS public.backup_snapshots (
  id TEXT PRIMARY KEY,
  backup_type TEXT NOT NULL DEFAULT 'logical_snapshot',
  checksum_sha256 TEXT NOT NULL,
  record_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  byte_size BIGINT NOT NULL DEFAULT 0,
  storage_location TEXT,
  restore_verified BOOLEAN NOT NULL DEFAULT FALSE,
  balance_verified BOOLEAN NOT NULL DEFAULT FALSE,
  restore_verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'completed',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.backup_snapshots ADD COLUMN IF NOT EXISTS byte_size BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.backup_snapshots ADD COLUMN IF NOT EXISTS storage_location TEXT;
ALTER TABLE public.backup_snapshots ADD COLUMN IF NOT EXISTS balance_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- 5. Stable Cross-Provider Identity Mapping (Supabase/Canonical User ID <-> Firebase UID)
CREATE TABLE IF NOT EXISTS public.identity_mappings (
  canonical_user_id TEXT PRIMARY KEY,
  firebase_uid TEXT UNIQUE,
  supabase_auth_uid TEXT UNIQUE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Supabase Nano Performance Indexes (reduce seq scans, CPU & RAM pressure on PostgREST)
CREATE INDEX IF NOT EXISTS idx_transactions_user_active_date
  ON public.transactions (user_id, transaction_date DESC, transaction_time DESC)
  WHERE COALESCE(is_deleted, FALSE) = FALSE;

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread
  ON public.user_notifications (user_id, created_at DESC)
  WHERE COALESCE(is_deleted, FALSE) = FALSE;

CREATE INDEX IF NOT EXISTS idx_udhar_transactions_user_created
  ON public.udhar_transactions (user_id, created_at DESC);

-- 7. Reload PostgREST schema cache cleanly after migration
NOTIFY pgrst, 'reload schema';
