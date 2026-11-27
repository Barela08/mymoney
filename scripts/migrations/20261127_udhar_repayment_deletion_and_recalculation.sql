-- ==============================================================================
-- Migration: 20261127_udhar_repayment_deletion_and_recalculation
-- Purpose:
--   1. Add soft-delete audit columns (deleted_at, deleted_by, deletion_reason)
--      to public.udhar_repayments and expand status check constraint to support
--      'rejected', 'deleted', and 'cancelled'.
--   2. Update cancel_udhar_atomic so authorized lenders/owners can delete any
--      eligible individual Udhar (including Fully Settled or partial entries
--      with repayments) while soft-deleting its associated repayments cleanly.
--   3. Add atomic delete_udhar_repayment_atomic RPC so deleting a single
--      repayment soft-deletes only that repayment, recomputes paid_amount and
--      current_balance across both mirrored rows, and reopens status from
--      'settled' to 'confirmed' when balance > 0.
-- Safe & Idempotent: Preserves all existing data without truncation or resets.
-- ==============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_repayments') THEN
    ALTER TABLE public.udhar_repayments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE public.udhar_repayments ADD COLUMN IF NOT EXISTS deleted_by UUID;
    ALTER TABLE public.udhar_repayments ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

    ALTER TABLE public.udhar_repayments DROP CONSTRAINT IF EXISTS udhar_repayments_status_check;
    ALTER TABLE public.udhar_repayments
      ADD CONSTRAINT udhar_repayments_status_check
      CHECK (status IN ('pending_confirmation', 'confirmed', 'disputed', 'rejected', 'deleted', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_udhar_repay_link_active
  ON public.udhar_repayments (link_id, status)
  WHERE deleted_at IS NULL AND status NOT IN ('deleted', 'cancelled');

-- Enforce participant-only visibility (hiding soft-deleted repayments) and authorized updates
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_repayments') THEN
    ALTER TABLE public.udhar_repayments ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "udhar_rep_select_participant" ON public.udhar_repayments;
    CREATE POLICY "udhar_rep_select_participant" ON public.udhar_repayments
      FOR SELECT TO authenticated
      USING (
        deleted_at IS NULL
        AND status NOT IN ('deleted', 'cancelled')
        AND EXISTS (
          SELECT 1 FROM public.udhar_transactions ut
          WHERE ut.link_id = udhar_repayments.link_id
            AND (ut.user_id = auth.uid() OR ut.counterpart_user_id = auth.uid())
        )
      );

    DROP POLICY IF EXISTS "udhar_rep_update_authorized" ON public.udhar_repayments;
    CREATE POLICY "udhar_rep_update_authorized" ON public.udhar_repayments
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.udhar_transactions ut
          WHERE ut.link_id = udhar_repayments.link_id
            AND ut.user_id = auth.uid()
            AND (
              ut.counterpart_user_id IS NULL
              OR ut.direction = 'gave'
              OR (udhar_repayments.recorded_by_user_id = auth.uid() AND udhar_repayments.status = 'pending_confirmation')
            )
        )
      );
  END IF;
END $$;

-- Updated atomic single-Udhar soft-delete RPC (lender/owner-only, supports pending, partial & settled entries)
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
  v_now TIMESTAMPTZ := NOW();
  v_clean_reason TEXT := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  v_deleted_repayments INTEGER := 0;
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
      'message', 'Only the lender who gave the money can delete an Udhar transaction.'
    );
  END IF;

  IF v_tx.status = 'cancelled' OR v_tx.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'status', 409,
      'message', 'This Udhar entry is already deleted.'
    );
  END IF;

  IF v_tx.status = 'disputed' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'status', 409,
      'message', 'Disputed Udhar records cannot be deleted until resolved.'
    );
  END IF;

  -- Soft-delete associated repayments first so orphaned repayments never remain active
  UPDATE public.udhar_repayments
  SET status = 'deleted',
      deleted_at = v_now,
      deleted_by = p_actor_id,
      deletion_reason = COALESCE(v_clean_reason, 'Parent Udhar transaction deleted')
  WHERE link_id = v_tx.link_id
    AND deleted_at IS NULL
    AND status NOT IN ('deleted', 'cancelled');
  GET DIAGNOSTICS v_deleted_repayments = ROW_COUNT;

  -- Soft-delete both lender & borrower mirrored rows for this individual Udhar only
  UPDATE public.udhar_transactions
  SET status = 'cancelled',
      current_balance = 0,
      paid_amount = 0,
      deleted_at = v_now,
      deleted_by = p_actor_id,
      deletion_reason = v_clean_reason,
      updated_at = v_now
  WHERE link_id = v_tx.link_id
    AND status <> 'cancelled';

  RETURN jsonb_build_object(
    'ok', TRUE,
    'status', 200,
    'link_id', v_tx.link_id,
    'deleted_at', v_now,
    'deleted_repayments_count', v_deleted_repayments
  );
END;
$$;

-- Atomic single-repayment soft-delete RPC with automatic parent Udhar balance & status recalculation
CREATE OR REPLACE FUNCTION public.delete_udhar_repayment_atomic(
  p_repayment_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rep public.udhar_repayments%ROWTYPE;
  v_tx public.udhar_transactions%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_clean_reason TEXT := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  v_confirmed_paid NUMERIC(14, 2) := 0;
  v_orig_amt NUMERIC(14, 2) := 0;
  v_new_balance NUMERIC(14, 2) := 0;
  v_is_settled BOOLEAN := FALSE;
  v_new_status TEXT := 'confirmed';
BEGIN
  SELECT * INTO v_rep
  FROM public.udhar_repayments
  WHERE id = p_repayment_id
  FOR UPDATE;

  IF NOT FOUND OR v_rep.deleted_at IS NOT NULL OR v_rep.status IN ('deleted', 'cancelled') THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 404, 'message', 'Repayment record not found.');
  END IF;

  SELECT * INTO v_tx
  FROM public.udhar_transactions
  WHERE link_id = v_rep.link_id AND user_id = p_actor_id
  FOR UPDATE;

  IF NOT FOUND OR v_tx.status = 'cancelled' OR v_tx.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 404, 'message', 'Associated Udhar transaction not found.');
  END IF;

  IF v_tx.status = 'disputed' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 409, 'message', 'Repayments on a disputed Udhar cannot be deleted until resolved.');
  END IF;

  -- Authorization: lender/manual owner can delete any repayment; borrower cannot delete confirmed or lender-recorded repayments
  IF v_tx.counterpart_user_id IS NOT NULL AND v_tx.direction = 'took' THEN
    IF v_rep.recorded_by_user_id <> p_actor_id OR v_rep.status <> 'pending_confirmation' THEN
      RETURN jsonb_build_object(
        'ok', FALSE,
        'status', 403,
        'message', 'Only the lender can delete confirmed repayments.'
      );
    END IF;
  END IF;

  UPDATE public.udhar_repayments
  SET status = 'deleted',
      deleted_at = v_now,
      deleted_by = p_actor_id,
      deletion_reason = v_clean_reason
  WHERE id = v_rep.id;

  SELECT COALESCE(SUM(amount), 0) INTO v_confirmed_paid
  FROM public.udhar_repayments
  WHERE link_id = v_tx.link_id
    AND status = 'confirmed'
    AND deleted_at IS NULL;

  v_confirmed_paid := ROUND(v_confirmed_paid, 2);
  v_orig_amt := ROUND(COALESCE(v_tx.original_amount, 0)::numeric, 2);
  v_new_balance := GREATEST(0, ROUND(v_orig_amt - v_confirmed_paid, 2));
  v_is_settled := v_new_balance <= 0.01;
  IF v_is_settled THEN
    v_new_balance := 0;
    v_confirmed_paid := v_orig_amt;
    v_new_status := 'settled';
  ELSE
    v_new_status := 'confirmed';
  END IF;

  UPDATE public.udhar_transactions
  SET paid_amount = v_confirmed_paid,
      current_balance = v_new_balance,
      status = v_new_status,
      settled_at = CASE WHEN v_is_settled THEN COALESCE(settled_at, v_now) ELSE NULL END,
      settled_by = CASE WHEN v_is_settled THEN COALESCE(settled_by, p_actor_id) ELSE NULL END,
      updated_at = v_now
  WHERE link_id = v_tx.link_id
    AND status <> 'cancelled'
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'status', 200,
    'deleted_repayment_id', v_rep.id,
    'link_id', v_tx.link_id,
    'paid_amount', v_confirmed_paid,
    'remaining_balance', v_new_balance,
    'udhar_status', v_new_status,
    'is_settled', v_is_settled
  );
END;
$$;
