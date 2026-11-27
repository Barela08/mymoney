-- ==============================================================================
-- Migration: 20261126_udhar_security_and_settlement_hardening
-- Purpose:
--   1. Add settled_by audit column alongside deleted_at, deleted_by, deletion_reason.
--   2. Provide atomic PostgreSQL RPCs for lender-only settlement, safe soft-delete,
--      and non-admin People Search directory queries.
--   3. Tighten participant-only RLS policies on Udhar tables.
-- Safe & Idempotent: Preserves all existing data without truncation or resets.
-- ==============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_transactions') THEN
    ALTER TABLE public.udhar_transactions ADD COLUMN IF NOT EXISTS settled_by UUID;
    ALTER TABLE public.udhar_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE public.udhar_transactions ADD COLUMN IF NOT EXISTS deleted_by UUID;
    ALTER TABLE public.udhar_transactions ADD COLUMN IF NOT EXISTS deletion_reason TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_udhar_tx_user_active
  ON public.udhar_transactions (user_id, status)
  WHERE deleted_at IS NULL AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_udhar_tx_link_id
  ON public.udhar_transactions (link_id);

-- Strictly participant-only RLS on Udhar ledger tables
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_transactions') THEN
    ALTER TABLE public.udhar_transactions ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "udhar_tx_select_participant" ON public.udhar_transactions;
    CREATE POLICY "udhar_tx_select_participant" ON public.udhar_transactions
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id OR auth.uid() = counterpart_user_id);

    DROP POLICY IF EXISTS "udhar_tx_insert_owner" ON public.udhar_transactions;
    CREATE POLICY "udhar_tx_insert_owner" ON public.udhar_transactions
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "udhar_tx_update_lender_enforced" ON public.udhar_transactions;
    CREATE POLICY "udhar_tx_update_lender_enforced" ON public.udhar_transactions
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (
        auth.uid() = user_id
        AND (
          counterpart_user_id IS NULL
          OR direction = 'gave'
          OR status NOT IN ('settled', 'cancelled')
        )
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_repayments') THEN
    ALTER TABLE public.udhar_repayments ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "udhar_rep_select_participant" ON public.udhar_repayments;
    CREATE POLICY "udhar_rep_select_participant" ON public.udhar_repayments
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.udhar_transactions ut
          WHERE ut.link_id = udhar_repayments.link_id
            AND (ut.user_id = auth.uid() OR ut.counterpart_user_id = auth.uid())
        )
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_edit_history') THEN
    ALTER TABLE public.udhar_edit_history ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "udhar_hist_select_participant" ON public.udhar_edit_history;
    CREATE POLICY "udhar_hist_select_participant" ON public.udhar_edit_history
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.udhar_transactions ut
          WHERE ut.link_id = udhar_edit_history.link_id
            AND (ut.user_id = auth.uid() OR ut.counterpart_user_id = auth.uid())
        )
      );
  END IF;
END $$;

-- Atomic single-transaction settlement RPC (lender-only, prevents double settlement)
CREATE OR REPLACE FUNCTION public.settle_udhar_atomic(
  p_tx_id UUID,
  p_actor_id UUID,
  p_notes TEXT DEFAULT 'Settled in full',
  p_payment_method TEXT DEFAULT 'UPI',
  p_settle_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx public.udhar_transactions%ROWTYPE;
  v_bal NUMERIC(14, 2);
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_tx
  FROM public.udhar_transactions
  WHERE id = p_tx_id AND user_id = p_actor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 404, 'message', 'Transaction not found.');
  END IF;

  IF v_tx.counterpart_user_id IS NOT NULL AND v_tx.direction = 'took' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'status', 403,
      'message', 'Only the lender who gave the money can mark an Udhar as settled.'
    );
  END IF;

  IF v_tx.status = 'disputed' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 409, 'message', 'Disputed Udhar transactions cannot be settled until resolved.');
  END IF;

  IF v_tx.status = 'cancelled' OR v_tx.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'message', 'Cannot settle a cancelled transaction.');
  END IF;

  v_bal := ROUND(COALESCE(v_tx.current_balance, 0)::numeric, 2);
  IF v_tx.status = 'settled' OR v_bal <= 0.01 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'message', 'This transaction is already settled.');
  END IF;

  INSERT INTO public.udhar_repayments (
    link_id, udhar_id, recorded_by_user_id, amount, repayment_date,
    payment_method, notes, status, confirmed_at, confirmed_by
  ) VALUES (
    v_tx.link_id, v_tx.id, p_actor_id, v_bal, COALESCE(p_settle_date, CURRENT_DATE),
    COALESCE(NULLIF(TRIM(p_payment_method), ''), 'UPI'),
    COALESCE(NULLIF(TRIM(p_notes), ''), 'Settled in full'),
    'confirmed', v_now, p_actor_id
  );

  UPDATE public.udhar_transactions
  SET current_balance = 0,
      paid_amount = original_amount,
      status = 'settled',
      settled_at = v_now,
      settled_by = p_actor_id,
      updated_at = v_now
  WHERE link_id = v_tx.link_id
    AND status NOT IN ('settled', 'cancelled');

  RETURN jsonb_build_object(
    'ok', TRUE,
    'status', 200,
    'link_id', v_tx.link_id,
    'settled_amount', v_bal,
    'settled_at', v_now
  );
END;
$$;

-- Atomic single-transaction soft-delete RPC (lender-only, preserves financial audit history)
CREATE OR REPLACE FUNCTION public.cancel_udhar_atomic(
  p_tx_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx public.udhar_transactions%ROWTYPE;
  v_rep_count INTEGER := 0;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_tx
  FROM public.udhar_transactions
  WHERE id = p_tx_id AND user_id = p_actor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 404, 'message', 'Transaction not found.');
  END IF;

  IF v_tx.counterpart_user_id IS NOT NULL AND v_tx.direction = 'took' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'status', 403,
      'message', 'Only the lender who gave the money can delete or cancel an Udhar transaction.'
    );
  END IF;

  IF v_tx.status IN ('cancelled', 'settled', 'disputed') OR v_tx.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'status', 409,
      'message', 'Settled, disputed, or already cancelled Udhar records cannot be deleted.'
    );
  END IF;

  SELECT COUNT(*) INTO v_rep_count
  FROM public.udhar_repayments
  WHERE link_id = v_tx.link_id
    AND status IN ('confirmed', 'pending_confirmation');

  IF COALESCE(v_tx.paid_amount, 0) > 0.01 OR v_rep_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'status', 409,
      'message', 'Cannot delete an Udhar that already has repayments recorded.'
    );
  END IF;

  UPDATE public.udhar_transactions
  SET status = 'cancelled',
      current_balance = 0,
      deleted_at = v_now,
      deleted_by = p_actor_id,
      deletion_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
      updated_at = v_now
  WHERE link_id = v_tx.link_id
    AND status <> 'cancelled';

  RETURN jsonb_build_object(
    'ok', TRUE,
    'status', 200,
    'link_id', v_tx.link_id,
    'deleted_at', v_now
  );
END;
$$;

-- Server-side discoverable normal users query (strictly excludes all admin/staff accounts)
CREATE OR REPLACE FUNCTION public.search_discoverable_users(
  p_query TEXT,
  p_caller_id UUID
)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  username TEXT,
  avatar_url TEXT,
  is_verified BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.full_name, u.username, u.avatar_url, COALESCE(u.is_verified, TRUE) AS is_verified
  FROM public.app_users u
  WHERE u.id <> p_caller_id
    AND u.status = 'active'
    AND COALESCE(u.deletion_status, 'none') = 'none'
    AND LOWER(COALESCE(u.role, 'user')) = 'user'
    AND LOWER(COALESCE(u.email, '')) NOT IN ('hackifypro@gmail.com', 'admin@mymoney.com')
    AND (
      u.full_name ILIKE '%' || COALESCE(TRIM(p_query), '') || '%'
      OR COALESCE(u.username, '') ILIKE '%' || COALESCE(TRIM(p_query), '') || '%'
    )
  ORDER BY u.full_name ASC
  LIMIT 15;
$$;
