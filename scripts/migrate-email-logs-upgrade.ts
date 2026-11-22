import { query, pool } from '../server/db';

async function run() {
  console.log('Upgrading public.email_dispatch_logs schema...');
  await query(`
    ALTER TABLE public.email_dispatch_logs 
      DROP CONSTRAINT IF EXISTS email_dispatch_logs_status_check;

    ALTER TABLE public.email_dispatch_logs 
      ADD COLUMN IF NOT EXISTS reference_id TEXT,
      ADD COLUMN IF NOT EXISTS trigger_event TEXT,
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_email_dispatch_ref ON public.email_dispatch_logs(reference_id);
    CREATE INDEX IF NOT EXISTS idx_email_dispatch_event ON public.email_dispatch_logs(trigger_event);
  `);
  console.log('✅ public.email_dispatch_logs schema upgraded successfully.');
  await pool.end();
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
