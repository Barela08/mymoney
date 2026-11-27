-- ============================================================================
-- Migration: 20261129_udhar_people_connections_lifecycle.sql
-- Purpose: Safe, idempotent lifecycle enhancements for Udhaar People Connections:
--          - Statuses: pending, connected, rejected, cancelled, deleted, blocked
--          - Method metadata: connection_method (SEARCH / QR_CODE / CONFIRMATION_CODE)
--          - Lifecycle timestamps & actor tracking (responded_at, cancelled_at, deleted_at, deleted_by)
--          - Realtime replication identity for user_connections, udhar_contacts, user_notifications
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_connections'
  ) THEN
    ALTER TABLE public.user_connections
      ADD COLUMN IF NOT EXISTS relationship_type TEXT DEFAULT 'Friend',
      ADD COLUMN IF NOT EXISTS requested_via TEXT DEFAULT 'search',
      ADD COLUMN IF NOT EXISTS connection_method TEXT,
      ADD COLUMN IF NOT EXISTS consented_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deleted_by UUID,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

    ALTER TABLE public.user_connections DROP CONSTRAINT IF EXISTS user_connections_status_check;
    ALTER TABLE public.user_connections
      ADD CONSTRAINT user_connections_status_check
      CHECK (status IN ('pending', 'connected', 'rejected', 'cancelled', 'deleted', 'blocked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_connections_pair
  ON public.user_connections (user_a_id, user_b_id);

CREATE INDEX IF NOT EXISTS idx_user_connections_target_status
  ON public.user_connections (user_b_id, status);

CREATE INDEX IF NOT EXISTS idx_user_connections_requester_status
  ON public.user_connections (user_a_id, status);

-- Ensure full row payloads & Realtime publication for instant two-sided sync
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_connections') THEN
    EXECUTE 'ALTER TABLE public.user_connections REPLICA IDENTITY FULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_contacts') THEN
    EXECUTE 'ALTER TABLE public.udhar_contacts REPLICA IDENTITY FULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_notifications') THEN
    EXECUTE 'ALTER TABLE public.user_notifications REPLICA IDENTITY FULL';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.user_connections;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.udhar_contacts;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
