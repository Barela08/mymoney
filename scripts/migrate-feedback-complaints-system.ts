import { query } from '../server/db';

async function migrate() {
  console.log('Running Feedback, Complaint & Support System Migration...');

  // 1. UPDATE / ENHANCE public.feedbacks TABLE
  await query(`
    CREATE TABLE IF NOT EXISTS public.feedbacks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      user_name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      user_phone TEXT,
      type TEXT NOT NULL DEFAULT 'feedback',
      category TEXT,
      subject TEXT,
      message TEXT NOT NULL,
      rating INTEGER,
      urgency TEXT DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'new',
      admin_notes TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE public.feedbacks ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
    ALTER TABLE public.feedbacks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
    ALTER TABLE public.feedbacks ADD COLUMN IF NOT EXISTS admin_notes TEXT;

    CREATE INDEX IF NOT EXISTS idx_feedbacks_user_id ON public.feedbacks(user_id);
    CREATE INDEX IF NOT EXISTS idx_feedbacks_rating ON public.feedbacks(rating);
    CREATE INDEX IF NOT EXISTS idx_feedbacks_status ON public.feedbacks(status);
    CREATE INDEX IF NOT EXISTS idx_feedbacks_created ON public.feedbacks(created_at DESC);
  `);
  console.log('✅ public.feedbacks verified and enhanced');

  // 2. UPDATE / ENHANCE public.support_tickets TABLE
  await query(`
    CREATE TABLE IF NOT EXISTS public.support_tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_number TEXT UNIQUE NOT NULL,
      user_id UUID,
      user_name TEXT,
      user_email TEXT NOT NULL,
      ticket_type TEXT NOT NULL DEFAULT 'complaint',
      category TEXT NOT NULL DEFAULT 'other',
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'open',
      assigned_to TEXT,
      attachment_url TEXT,
      internal_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );

    ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS ticket_type TEXT NOT NULL DEFAULT 'complaint';
    ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS attachment_url TEXT;

    CREATE INDEX IF NOT EXISTS idx_support_tickets_type ON public.support_tickets(ticket_type);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON public.support_tickets(user_id);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON public.support_tickets(priority);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON public.support_tickets(created_at DESC);
  `);
  console.log('✅ public.support_tickets verified and enhanced');

  // 3. UPDATE / ENHANCE public.support_ticket_replies TABLE
  await query(`
    CREATE TABLE IF NOT EXISTS public.support_ticket_replies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
      sender_id UUID,
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL DEFAULT 'admin',
      sender_type TEXT NOT NULL DEFAULT 'admin',
      message TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'admin_reply',
      is_internal BOOLEAN NOT NULL DEFAULT FALSE,
      email_status TEXT NOT NULL DEFAULT 'none',
      email_provider_id TEXT,
      delivery_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE public.support_ticket_replies ADD COLUMN IF NOT EXISTS sender_type TEXT NOT NULL DEFAULT 'admin';
    ALTER TABLE public.support_ticket_replies ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'admin_reply';
    ALTER TABLE public.support_ticket_replies ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'none';
    ALTER TABLE public.support_ticket_replies ADD COLUMN IF NOT EXISTS email_provider_id TEXT;
    ALTER TABLE public.support_ticket_replies ADD COLUMN IF NOT EXISTS delivery_error TEXT;

    CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket ON public.support_ticket_replies(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_replies_created ON public.support_ticket_replies(created_at ASC);
  `);
  console.log('✅ public.support_ticket_replies verified and enhanced');

  // 4. CREATE public.ticket_status_history TABLE
  await query(`
    CREATE TABLE IF NOT EXISTS public.ticket_status_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
      old_status TEXT,
      new_status TEXT NOT NULL,
      changed_by UUID,
      changed_by_name TEXT,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ticket_status_hist_ticket ON public.ticket_status_history(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_status_hist_created ON public.ticket_status_history(created_at DESC);
  `);
  console.log('✅ public.ticket_status_history created');

  console.log('Migration completed successfully!');
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
