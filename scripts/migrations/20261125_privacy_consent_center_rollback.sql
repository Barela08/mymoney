-- ============================================================================
-- Rollback: 20261125_privacy_consent_center_rollback.sql
-- Purpose: Safely roll back trigger and unique idempotency index while
--          strictly preserving all historical user_consents data rows.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_user_consents_append_only ON public.user_consents;
DROP FUNCTION IF EXISTS public.prevent_user_consents_mutation();
DROP INDEX IF EXISTS public.idx_user_consents_idempotency;
