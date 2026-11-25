-- ============================================================================
-- Rollback: 20261125_admin_settings_secrets_rollback.sql
-- ============================================================================

DROP INDEX IF EXISTS public.idx_admin_secrets_updated_at;
DROP TABLE IF EXISTS public.admin_secrets;
