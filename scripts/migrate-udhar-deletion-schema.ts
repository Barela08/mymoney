import pg from 'pg';
import fs from 'fs';
import path from 'path';

// Parse .env
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
  console.warn('Notice loading .env:', e);
}

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:Nilu@2006080@db.frgrfajnrzqwnevhlrio.supabase.co:5432/postgres';

async function migrate() {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to PostgreSQL for Udhar & Account Deletion Migration...');

  try {
    await client.query('BEGIN');

    // 1. Account Deletion Columns in app_users
    await client.query(`
      ALTER TABLE public.app_users 
      ADD COLUMN IF NOT EXISTS deletion_status TEXT NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS deletion_scheduled_for TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deletion_request_id UUID;
    `);

    // 2. Account Deletion Requests Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL,
        cancellation_token_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'executed')),
        scheduled_for TIMESTAMPTZ NOT NULL,
        reason TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        cancelled_at TIMESTAMPTZ,
        executed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_acc_del_user ON public.account_deletion_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_acc_del_status ON public.account_deletion_requests(status);
      CREATE INDEX IF NOT EXISTS idx_acc_del_sched ON public.account_deletion_requests(scheduled_for);
    `);

    // 3. Udhar Contacts (Saved People)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.udhar_contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        linked_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
        relationship_type TEXT DEFAULT 'Friend',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_udhar_contact_user_name UNIQUE (user_id, name)
      );

      CREATE INDEX IF NOT EXISTS idx_udhar_contacts_user ON public.udhar_contacts(user_id);
      CREATE INDEX IF NOT EXISTS idx_udhar_contacts_linked ON public.udhar_contacts(linked_user_id);
    `);

    // 4. QR Pairing Tokens
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.qr_pairing_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
        pairing_token TEXT NOT NULL UNIQUE,
        pairing_code TEXT NOT NULL,
        is_single_use BOOLEAN NOT NULL DEFAULT FALSE,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        used_by_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
        used_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_qr_pairing_token ON public.qr_pairing_tokens(pairing_token);
      CREATE INDEX IF NOT EXISTS idx_qr_pairing_user ON public.qr_pairing_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_qr_pairing_code ON public.qr_pairing_tokens(pairing_code);
    `);

    // 5. User Connections (Linked Registered Users)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.user_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_a_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
        user_b_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'blocked')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_user_connection_pair UNIQUE (user_a_id, user_b_id)
      );

      CREATE INDEX IF NOT EXISTS idx_user_conn_a ON public.user_connections(user_a_id);
      CREATE INDEX IF NOT EXISTS idx_user_conn_b ON public.user_connections(user_b_id);
    `);

    // 6. Udhar Transactions (Two-sided & Linked)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.udhar_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        link_id UUID NOT NULL,
        user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
        counterpart_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
        counterpart_name TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('gave', 'took')),
        original_amount NUMERIC(14, 2) NOT NULL CHECK (original_amount > 0),
        current_balance NUMERIC(14, 2) NOT NULL CHECK (current_balance >= 0),
        transaction_date DATE NOT NULL,
        due_date DATE,
        notes TEXT,
        attachment_url TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending_confirmation', 'confirmed', 'disputed', 'settled', 'cancelled')),
        confirmation_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (confirmation_status IN ('pending', 'confirmed', 'disputed')),
        is_initiator BOOLEAN NOT NULL DEFAULT TRUE,
        dispute_reason TEXT,
        disputed_at TIMESTAMPTZ,
        disputed_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
        settled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_udhar_tx_user ON public.udhar_transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_udhar_tx_link ON public.udhar_transactions(link_id);
      CREATE INDEX IF NOT EXISTS idx_udhar_tx_counterpart ON public.udhar_transactions(counterpart_user_id);
      CREATE INDEX IF NOT EXISTS idx_udhar_tx_status ON public.udhar_transactions(status);
      CREATE INDEX IF NOT EXISTS idx_udhar_tx_date ON public.udhar_transactions(transaction_date);
    `);

    // 7. Udhar Repayments
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.udhar_repayments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        link_id UUID NOT NULL,
        udhar_id UUID NOT NULL REFERENCES public.udhar_transactions(id) ON DELETE CASCADE,
        recorded_by_user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
        amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
        repayment_date DATE NOT NULL,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending_confirmation', 'confirmed', 'disputed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_udhar_repay_link ON public.udhar_repayments(link_id);
      CREATE INDEX IF NOT EXISTS idx_udhar_repay_udhar ON public.udhar_repayments(udhar_id);
    `);

    await client.query('COMMIT');
    console.log('✅ Udhar & Account Deletion Migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    await client.end();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
