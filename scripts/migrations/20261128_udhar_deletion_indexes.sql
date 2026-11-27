-- Migration: Performance Indexes for Fast Udhar History & Repayment Deletion
-- Project: My Money Manager by HackifyPro

CREATE INDEX IF NOT EXISTS idx_udhar_tx_user_person
  ON public.udhar_transactions (user_id, LOWER(person_name));

CREATE INDEX IF NOT EXISTS idx_udhar_tx_link_id
  ON public.udhar_transactions (link_id);

CREATE INDEX IF NOT EXISTS idx_udhar_rep_link_id
  ON public.udhar_repayments (link_id);

CREATE INDEX IF NOT EXISTS idx_user_notif_related_entity
  ON public.user_notifications (related_entity_id)
  WHERE related_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_user_category_person
  ON public.transactions (user_id, category, LOWER(person_name));
