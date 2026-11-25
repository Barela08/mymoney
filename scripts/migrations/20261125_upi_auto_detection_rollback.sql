-- ==============================================================================
-- ROLLBACK MIGRATION: Automatic UPI Payment Detection
-- Product: My Money Manager by HackifyPro
-- ==============================================================================

DROP TRIGGER IF EXISTS trg_detected_transactions_updated_at ON public.detected_transactions;
DROP TRIGGER IF EXISTS trg_expense_detection_settings_updated_at ON public.expense_detection_settings;
DROP FUNCTION IF EXISTS public.touch_upi_detection_updated_at();

DROP TABLE IF EXISTS public.transaction_detection_events;
DROP TABLE IF EXISTS public.detected_transactions;
DROP TABLE IF EXISTS public.expense_detection_settings;
