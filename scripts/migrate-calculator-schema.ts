import pg from 'pg';
import fs from 'fs';
import path from 'path';

// Parse .env if not loaded
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  console.warn('Notice loading .env in migrate-calculator-schema.ts:', e);
}

const connectionString = process.env.DATABASE_URL || '';
if (!connectionString) {
  console.error('DATABASE_URL is not set in environment or .env');
  process.exit(1);
}

async function migrate() {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to PostgreSQL for Calculator Schema Migration...');

  try {
    await client.query('BEGIN');

    // 1. Calculator History Table
    console.log('Creating public.calculator_history table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.calculator_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
        calc_type TEXT NOT NULL CHECK (calc_type IN ('gst', 'offer', 'split', 'basic')),
        title TEXT,
        input_values JSONB NOT NULL DEFAULT '{}'::jsonb,
        result_values JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_calc_hist_user_created ON public.calculator_history(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_calc_hist_type ON public.calculator_history(calc_type);
    `);

    // 2. User Calculator Settings Table
    console.log('Creating public.user_calculator_settings table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.user_calculator_settings (
        user_id UUID PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
        last_mode TEXT NOT NULL DEFAULT 'gst' CHECK (last_mode IN ('gst', 'offer', 'split', 'basic')),
        default_gst_percent NUMERIC(5,2) DEFAULT 18.00,
        default_offer_percent NUMERIC(5,2) DEFAULT 10.00,
        default_split_people INTEGER DEFAULT 2,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 3. Row Level Security enablement
    await client.query(`
      ALTER TABLE public.calculator_history ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.user_calculator_settings ENABLE ROW LEVEL SECURITY;
    `);

    // Create RLS policies for Supabase direct access if needed
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE tablename = 'calculator_history' AND policyname = 'Users can view own calculation history'
        ) THEN
          CREATE POLICY "Users can view own calculation history" ON public.calculator_history
            FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE tablename = 'calculator_history' AND policyname = 'Users can insert own calculation history'
        ) THEN
          CREATE POLICY "Users can insert own calculation history" ON public.calculator_history
            FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE tablename = 'calculator_history' AND policyname = 'Users can delete own calculation history'
        ) THEN
          CREATE POLICY "Users can delete own calculation history" ON public.calculator_history
            FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE tablename = 'user_calculator_settings' AND policyname = 'Users can manage own calculator settings'
        ) THEN
          CREATE POLICY "Users can manage own calculator settings" ON public.user_calculator_settings
            FOR ALL USING (auth.uid() = user_id);
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
    console.log('✅ Calculator Schema Migration Completed Successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
