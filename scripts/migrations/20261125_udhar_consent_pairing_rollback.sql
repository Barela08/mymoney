-- ============================================================================
-- Rollback: 20261125_udhar_consent_pairing_rollback.sql
-- Purpose: Non-destructive rollback of indexes added by 20261125_udhar_consent_pairing.sql
-- Note: Preserves user_connections and user_consents data rows intact.
-- ============================================================================

DROP INDEX IF EXISTS public.idx_user_connections_target_status;
DROP INDEX IF EXISTS public.idx_user_connections_requester_status;
DROP INDEX IF EXISTS public.idx_qr_pairing_tokens_code;
DROP INDEX IF EXISTS public.idx_qr_pairing_tokens_user_active;
DROP INDEX IF EXISTS public.idx_user_consents_user_purpose_created;
