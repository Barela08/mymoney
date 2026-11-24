import { query } from '../server/db';

/**
 * Safe, idempotent migration to upgrade the Shared Udhar & People schema
 * with canonical metadata fields, repayment UTR/time/attachments, edit field diffs,
 * and Supabase Realtime publication.
 */
async function runCanonicalSharedUdharMigration() {
  console.log('Running canonical Shared Udhar & People schema migration...');

  await query(`
    ALTER TABLE public.udhar_transactions
      ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Personal Loan',
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'UPI',
      ADD COLUMN IF NOT EXISTS lender_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS borrower_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
  `);

  await query(`
    ALTER TABLE public.udhar_repayments
      ADD COLUMN IF NOT EXISTS transaction_ref TEXT,
      ADD COLUMN IF NOT EXISTS repayment_time TEXT,
      ADD COLUMN IF NOT EXISTS attachment_url TEXT;
  `);

  await query(`
    ALTER TABLE public.udhar_edit_history
      ADD COLUMN IF NOT EXISTS changed_fields JSONB DEFAULT '[]'::jsonb;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_udhar_tx_link_id ON public.udhar_transactions(link_id);
    CREATE INDEX IF NOT EXISTS idx_udhar_tx_user_status ON public.udhar_transactions(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_udhar_tx_counterpart ON public.udhar_transactions(user_id, counterpart_user_id);
    CREATE INDEX IF NOT EXISTS idx_udhar_repayments_link_status ON public.udhar_repayments(link_id, status);
    CREATE INDEX IF NOT EXISTS idx_user_connections_pair ON public.user_connections(user_a_id, user_b_id, status);
  `);

  // Enable Supabase Realtime publication for instant cross-account sync
  const tables = ['udhar_transactions', 'udhar_repayments', 'udhar_contacts', 'user_connections'];
  for (const table of tables) {
    try {
      await query(`ALTER PUBLICATION supabase_realtime ADD TABLE public.${table};`);
    } catch {
      // Already in publication or publication not present in local Postgres
    }
  }

  console.log('Canonical Shared Udhar & People schema migration completed.');
  process.exit(0);
}

runCanonicalSharedUdharMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
