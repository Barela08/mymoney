-- Migration: Dual-Database Sync Outbox, Failover State, Independent Health Logs & Backup Snapshots
-- Backward-compatible: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.sync_outbox (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  collection_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_version BIGINT NOT NULL DEFAULT 1,
  source_db TEXT NOT NULL DEFAULT 'supabase',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending ON public.sync_outbox(status, next_retry_at) WHERE status <> 'synced';

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

CREATE TABLE IF NOT EXISTS public.service_health_logs (
  id BIGSERIAL PRIMARY KEY,
  service_name TEXT NOT NULL,
  status TEXT NOT NULL,
  response_time_ms INT,
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_health_logs_recent ON public.service_health_logs(service_name, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.backup_snapshots (
  id TEXT PRIMARY KEY,
  backup_type TEXT NOT NULL DEFAULT 'logical_snapshot',
  checksum_sha256 TEXT NOT NULL,
  record_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  restore_verified BOOLEAN NOT NULL DEFAULT FALSE,
  restore_verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'completed',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
