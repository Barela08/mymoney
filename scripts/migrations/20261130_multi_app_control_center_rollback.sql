-- =============================================================================
-- Rollback: Multi-App Control Center, Branding Assets & Staff Tasks
-- =============================================================================

DROP TABLE IF EXISTS public.staff_tasks CASCADE;
DROP TABLE IF EXISTS public.branding_assets CASCADE;
DROP TABLE IF EXISTS public.platform_config_versions CASCADE;
