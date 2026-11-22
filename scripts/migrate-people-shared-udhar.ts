import { query } from '../server/db';

async function runMigration() {
  console.log('--- Running People, QR & Shared Udhar Database Migration ---');

  try {
    // 1. Invitations Table
    await query(`
      CREATE TABLE IF NOT EXISTS public.invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        inviter_user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
        invited_person_id UUID REFERENCES public.udhar_contacts(id) ON DELETE CASCADE,
        recipient_email TEXT NOT NULL,
        recipient_name TEXT,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(recipient_email);
      CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations(token_hash);
      CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON public.invitations(inviter_user_id);
    `);
    console.log('✓ Invitations table verified');

    // 2. Notifications Table Column Enhancements
    await query(`
      ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
      ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS related_entity_id TEXT;
      ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS actor_user_id UUID;
    `);
    // Drop restrictive type check constraint if present
    await query(`
      ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    `).catch(() => {});
    console.log('✓ Notifications table enhanced');

    // 3. Udhar Contacts & App Users Enhancements
    await query(`
      ALTER TABLE public.udhar_contacts ADD COLUMN IF NOT EXISTS photo_url TEXT;
      ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS username TEXT;
      ALTER TABLE public.udhar_transactions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
      ALTER TABLE public.udhar_repayments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
    `);
    console.log('✓ Udhar contacts, users, and transactions columns enhanced');

    console.log('✅ Migration completed successfully!');
  } catch (err: any) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

runMigration();
