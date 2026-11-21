import { query } from '../server/db';

async function migrateEmailLogs() {
  console.log('Creating email_dispatch_logs table if not exists...');
  const sql = `
    CREATE TABLE IF NOT EXISTS public.email_dispatch_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
      email TEXT NOT NULL,
      email_type TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      recipient_name TEXT,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'retrying')),
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 3,
      last_error TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_email_dispatch_status ON public.email_dispatch_logs(status);
    CREATE INDEX IF NOT EXISTS idx_email_dispatch_user ON public.email_dispatch_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_dispatch_key ON public.email_dispatch_logs(idempotency_key);
  `;

  await query(sql);
  console.log('✅ public.email_dispatch_logs created and indexed successfully!');
}

migrateEmailLogs()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
