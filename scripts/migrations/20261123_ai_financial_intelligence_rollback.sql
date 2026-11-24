-- ==============================================================================
-- Rollback Script: 20261123_ai_financial_intelligence_rollback.sql
-- Project: My Money Manager by HackifyPro
-- Description: Safely removes ONLY the tables added by the 7 AI Financial
--              Intelligence features. Existing core tables (app_users,
--              transactions, budgets, recurring_bills, savings_goals, udhar_*)
--              are NEVER touched.
-- ==============================================================================

BEGIN;

DROP TABLE IF EXISTS public.ai_messages;
DROP TABLE IF EXISTS public.ai_conversations;
DROP TABLE IF EXISTS public.user_categorization_rules;
DROP TABLE IF EXISTS public.receipt_records;
DROP TABLE IF EXISTS public.net_worth_snapshots;
DROP TABLE IF EXISTS public.net_worth_settings;
DROP TABLE IF EXISTS public.net_worth_liabilities;
DROP TABLE IF EXISTS public.net_worth_assets;
DROP TABLE IF EXISTS public.safe_to_spend_preferences;
DROP TABLE IF EXISTS public.smart_alert_events;
DROP TABLE IF EXISTS public.smart_alert_preferences;

COMMIT;
