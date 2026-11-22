import { query } from '../server/db.js';

async function migrate() {
  console.log('🔄 Running Udhar Upgrade Schema Migration...');

  // 1. Create udhar_edit_history table
  await query(`
    CREATE TABLE IF NOT EXISTS public.udhar_edit_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      udhar_id UUID NOT NULL,
      link_id UUID NOT NULL,
      edited_by_user_id UUID NOT NULL,
      previous_amount NUMERIC(14, 2),
      new_amount NUMERIC(14, 2),
      previous_notes TEXT,
      new_notes TEXT,
      previous_date DATE,
      new_date DATE,
      previous_due_date DATE,
      new_due_date DATE,
      reason_for_edit TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ Table public.udhar_edit_history checked/created');

  // 2. Add columns to udhar_repayments if missing
  await query(`
    ALTER TABLE public.udhar_repayments 
    ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'UPI',
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS confirmed_by UUID;
  `);
  console.log('✅ Added payment_method, rejection_reason, confirmed_at to public.udhar_repayments');

  // 3. Add columns to udhar_transactions if missing
  await query(`
    ALTER TABLE public.udhar_transactions 
    ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_edited_by UUID,
    ADD COLUMN IF NOT EXISTS edit_reason TEXT;
  `);
  console.log('✅ Added paid_amount, last_edited_at to public.udhar_transactions');

  // 4. Update paid_amount on existing udhar_transactions where original_amount > current_balance
  await query(`
    UPDATE public.udhar_transactions
    SET paid_amount = GREATEST(0, original_amount - current_balance)
    WHERE paid_amount IS NULL OR paid_amount = 0;
  `);
  console.log('✅ Calculated paid_amount for existing transactions');

  // 5. Create helpful indexes
  await query(`
    CREATE INDEX IF NOT EXISTS idx_udhar_edit_history_link ON public.udhar_edit_history(link_id);
    CREATE INDEX IF NOT EXISTS idx_udhar_edit_history_tx ON public.udhar_edit_history(udhar_id);
    CREATE INDEX IF NOT EXISTS idx_udhar_repay_link_status ON public.udhar_repayments(link_id, status);
  `);
  console.log('✅ Created indexes on udhar_edit_history and udhar_repayments');

  console.log('🎉 Udhar Upgrade Schema Migration completed successfully!');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
