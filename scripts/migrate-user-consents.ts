import { query, pool } from '../server/db';

async function migrateUserConsents() {
  console.log('--- Migrating user_consents table for DPDP Act Compliance ---');

  await query(`
    CREATE TABLE IF NOT EXISTS public.user_consents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      user_email TEXT,
      purpose TEXT NOT NULL DEFAULT 'optional_feedback_support',
      status TEXT NOT NULL CHECK (status IN ('granted', 'withdrawn', 'not_granted')),
      action TEXT NOT NULL CHECK (action IN ('granted', 'withdrawn')),
      policy_version TEXT NOT NULL DEFAULT 'v1.2 - DPDP Act 2023',
      consent_wording TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_user_consents_user_purpose 
    ON public.user_consents (user_id, purpose, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_user_consents_email 
    ON public.user_consents (user_email);

    ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'user_consents' AND policyname = 'user_consents_owner_policy'
      ) THEN
        CREATE POLICY user_consents_owner_policy ON public.user_consents
          FOR ALL
          USING (auth.uid() = user_id OR auth.uid() IS NULL);
      END IF;
    END $$;
  `);

  console.log('✅ public.user_consents table created and verified successfully.');
}

migrateUserConsents()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Migration failed:', err);
    await pool.end();
    process.exit(1);
  });
