import pg from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

async function main() {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to PostgreSQL...');

  const ddl = `
    CREATE TABLE IF NOT EXISTS public.feedbacks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      user_name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      user_phone TEXT,
      type TEXT NOT NULL CHECK (type IN ('feedback', 'complaint')),
      category TEXT,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
      urgency TEXT DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high', 'urgent')),
      dpdp_consent BOOLEAN NOT NULL DEFAULT FALSE,
      dpdp_consent_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed')),
      admin_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

    CREATE INDEX IF NOT EXISTS idx_feedbacks_user_id ON public.feedbacks(user_id);
    CREATE INDEX IF NOT EXISTS idx_feedbacks_type ON public.feedbacks(type);
    CREATE INDEX IF NOT EXISTS idx_feedbacks_status ON public.feedbacks(status);
    CREATE INDEX IF NOT EXISTS idx_feedbacks_created_at ON public.feedbacks(created_at DESC);

    DROP POLICY IF EXISTS "feedbacks_insert_policy" ON public.feedbacks;
    CREATE POLICY "feedbacks_insert_policy"
      ON public.feedbacks FOR INSERT
      WITH CHECK (true);

    DROP POLICY IF EXISTS "feedbacks_select_policy" ON public.feedbacks;
    CREATE POLICY "feedbacks_select_policy"
      ON public.feedbacks FOR SELECT
      USING (auth.uid() = user_id OR public.is_admin());

    DROP POLICY IF EXISTS "feedbacks_update_policy" ON public.feedbacks;
    CREATE POLICY "feedbacks_update_policy"
      ON public.feedbacks FOR UPDATE
      USING (public.is_admin())
      WITH CHECK (public.is_admin());

    DROP POLICY IF EXISTS "feedbacks_delete_policy" ON public.feedbacks;
    CREATE POLICY "feedbacks_delete_policy"
      ON public.feedbacks FOR DELETE
      USING (public.is_admin());

    ALTER TABLE public.feedbacks REPLICA IDENTITY FULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'feedbacks'
      ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.feedbacks;
      END IF;
    END $$;
  `;

  await client.query(ddl);
  console.log('Successfully executed feedbacks DDL!');

  const check = await client.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'feedbacks'"
  );
  console.log('Columns in feedbacks table:', check.rows.map((r) => r.column_name));

  await client.end();
}

main().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
