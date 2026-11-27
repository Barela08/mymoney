-- Rollback for 20261126_udhar_security_and_settlement_hardening.sql
DROP FUNCTION IF EXISTS public.search_discoverable_users(TEXT, UUID);
DROP FUNCTION IF EXISTS public.cancel_udhar_atomic(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.settle_udhar_atomic(UUID, UUID, TEXT, TEXT, DATE);
DROP INDEX IF EXISTS idx_udhar_tx_user_active;
DROP INDEX IF EXISTS idx_udhar_tx_link_id;
