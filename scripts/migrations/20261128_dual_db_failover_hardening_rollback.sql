-- =============================================================================
-- Rollback for 20261128_dual_db_failover_hardening.sql
-- Safe non-destructive rollback: drops only newly added auxiliary tables/indexes.
-- Never drops user financial data tables (`app_users`, `transactions`, `udhar_*`).
-- =============================================================================

DROP INDEX IF EXISTS public.idx_udhar_transactions_user_created;
DROP INDEX IF EXISTS public.idx_user_notifications_user_unread;
DROP INDEX IF EXISTS public.idx_transactions_user_active_date;

DROP TABLE IF EXISTS public.identity_mappings;
DROP TABLE IF EXISTS public.alert_delivery_logs;
DROP TABLE IF EXISTS public.failover_history;

NOTIFY pgrst, 'reload schema';
