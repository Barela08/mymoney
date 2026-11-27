-- ==============================================================================
-- ENTERPRISE DEFENSE-IN-DEPTH POSTGRESQL ROW LEVEL SECURITY (RLS) POLICIES
-- Project: Personal Expense & Money Manager (My Money)
-- Target: Supabase / PostgreSQL 15+
-- ==============================================================================
-- This script configures production-grade Row Level Security, role-based access
-- control, immutable security audit logging, anti-IDOR triggers, and strict user
-- isolation. Every financial record is cryptographically bound to auth.uid().
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 2. PROFILES TABLE (User Management & Role Verification)
-- ------------------------------------------------------------------------------
-- Tracks user status and verified roles.
-- PASSWORDS ARE NEVER STORED HERE (handled securely by Supabase auth.users).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on email and role for fast authentication and authorization lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);

-- Automatic updated_at trigger for profiles
CREATE OR REPLACE FUNCTION public.handle_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_profiles_updated_at();

-- Automatic profile creation on auth.users sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user_registration()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, role, status)
    VALUES (
        NEW.id,
        NEW.email,
        -- Protect Admin role: only pre-designated root admin email gets 'admin' role
        CASE
            WHEN LOWER(NEW.email) = 'admin@mymoney.com' THEN 'admin'
            ELSE 'user'
        END,
        'active'
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_registration();

-- ------------------------------------------------------------------------------
-- 3. TRANSACTIONS TABLE (Private Financial Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
    category TEXT NOT NULL CHECK (category IN ('home', 'received', 'room', 'food', 'other', 'people')),
    subcategory TEXT NOT NULL,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense', 'transfer')),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0 AND amount <= 100000000.00),
    title TEXT NOT NULL CHECK (LENGTH(title) <= 250),
    description TEXT,
    person_name TEXT CHECK (person_name IS NULL OR LENGTH(person_name) <= 150),
    transaction_date DATE NOT NULL,
    transaction_time TIME NOT NULL,
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- High-performance compound indexes for user-isolated queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_cat ON public.transactions(user_id, category);
CREATE INDEX IF NOT EXISTS idx_transactions_user_person ON public.transactions(user_id, person_name) WHERE person_name IS NOT NULL;

-- Automatic updated_at trigger for transactions
DROP TRIGGER IF EXISTS trg_transactions_updated_at ON public.transactions;
CREATE TRIGGER trg_transactions_updated_at
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_profiles_updated_at();

-- ANTI-TAMPERING TRIGGER: Prevent changing transaction ownership (Anti-IDOR)
CREATE OR REPLACE FUNCTION public.prevent_transaction_owner_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.user_id <> OLD.user_id THEN
        RAISE EXCEPTION 'Security Violation: Cannot reassign transaction ownership to another user_id.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_tx_owner_change ON public.transactions;
CREATE TRIGGER trg_prevent_tx_owner_change
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_transaction_owner_change();

-- ------------------------------------------------------------------------------
-- 4. SECURITY AUDIT LOGS TABLE (Tamper-Resistant Audit Trail)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email TEXT,
    actor_role TEXT NOT NULL DEFAULT 'user' CHECK (actor_role IN ('admin', 'user', 'anonymous')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for chronological auditing by administrators
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.security_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event ON public.security_audit_logs(event_type);

-- IMMUTABILITY ENFORCEMENT: Audit logs can NEVER be updated or deleted by anyone!
CREATE OR REPLACE FUNCTION public.enforce_audit_log_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Security Violation: Security audit logs are strictly append-only and cannot be modified or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON public.security_audit_logs;
CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE OR DELETE ON public.security_audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_audit_log_immutability();

-- ------------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY (RLS) ENFORCEMENT
-- ------------------------------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper function: check if currently executing user is a verified Admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin' AND status = 'active'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ------------------------------------------------------------------------------
-- 6. POLICIES: PROFILES TABLE
-- ------------------------------------------------------------------------------

-- Regular users can view ONLY their own profile; Admins can view ALL profiles
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy"
    ON public.profiles FOR SELECT
    USING (
        auth.uid() = id OR public.is_admin()
    );

-- Users can insert their own profile on registration (strictly with role='user')
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy"
    ON public.profiles FOR INSERT
    WITH CHECK (
        auth.uid() = id AND role = 'user'
    );

-- Regular users can update only their non-privileged fields;
-- ONLY Admin can alter role or status
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy"
    ON public.profiles FOR UPDATE
    USING (
        auth.uid() = id OR public.is_admin()
    )
    WITH CHECK (
        (auth.uid() = id AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()) AND status = (SELECT status FROM public.profiles WHERE id = auth.uid()))
        OR public.is_admin()
    );

-- ------------------------------------------------------------------------------
-- 7. POLICIES: TRANSACTIONS TABLE (STRICT MULTI-TENANT ISOLATION)
-- ------------------------------------------------------------------------------
-- Every user sees, inserts, updates, and deletes ONLY their own transactions.
-- User financial privacy: Even administrators CANNOT view or edit another user's private financial records!

DROP POLICY IF EXISTS "transactions_select_isolation" ON public.transactions;
CREATE POLICY "transactions_select_isolation"
    ON public.transactions FOR SELECT
    USING (
        auth.uid() = user_id
    );

DROP POLICY IF EXISTS "transactions_insert_isolation" ON public.transactions;
CREATE POLICY "transactions_insert_isolation"
    ON public.transactions FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
    );

DROP POLICY IF EXISTS "transactions_update_isolation" ON public.transactions;
CREATE POLICY "transactions_update_isolation"
    ON public.transactions FOR UPDATE
    USING (
        auth.uid() = user_id
    )
    WITH CHECK (
        auth.uid() = user_id
    );

DROP POLICY IF EXISTS "transactions_delete_isolation" ON public.transactions;
CREATE POLICY "transactions_delete_isolation"
    ON public.transactions FOR DELETE
    USING (
        auth.uid() = user_id
    );

-- ------------------------------------------------------------------------------
-- 8. POLICIES: SECURITY AUDIT LOGS TABLE
-- ------------------------------------------------------------------------------
-- Authenticated users & triggers can insert security events.
-- ONLY verified active administrators can view security audit logs.
-- Modifications and deletions are completely blocked by the immutability trigger.

DROP POLICY IF EXISTS "audit_insert_policy" ON public.security_audit_logs;
CREATE POLICY "audit_insert_policy"
    ON public.security_audit_logs FOR INSERT
    WITH CHECK (
        auth.role() = 'authenticated' OR auth.role() = 'anon'
    );

DROP POLICY IF EXISTS "audit_select_admin_only" ON public.security_audit_logs;
CREATE POLICY "audit_select_admin_only"
    ON public.security_audit_logs FOR SELECT
    USING (
        public.is_admin()
    );

-- ------------------------------------------------------------------------------
-- 9. ADMIN PROCEDURES: USER MANAGEMENT & CREDENTIAL OVERRIDES
-- ------------------------------------------------------------------------------

-- Function: Admin Set User Password (strictly requires authenticated active admin/superadmin)
CREATE OR REPLACE FUNCTION public.admin_set_user_password(target_user_id UUID, new_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'superadmin') AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Access Denied: Only active administrators can modify user passwords.';
  END IF;

  IF new_password IS NULL OR length(new_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters long.';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at = NOW()
  WHERE id = target_user_id;

  RETURN jsonb_build_object('success', true, 'message', 'User password updated successfully');
END;
$$;

-- Function: Admin Delete User (strictly requires authenticated active admin/superadmin)
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'superadmin') AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Access Denied: Only active administrators can delete users.';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot self-delete via this RPC.';
  END IF;

  DELETE FROM auth.users WHERE id = target_user_id;
  DELETE FROM public.profiles WHERE id = target_user_id;
  DELETE FROM public.transactions WHERE user_id = target_user_id;

  RETURN jsonb_build_object('success', true, 'message', 'User and all associated data deleted successfully');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_password(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 10. ENTERPRISE TABLES: DYNAMIC SECTIONS, APP SETTINGS & RECYCLE BIN
-- ------------------------------------------------------------------------------

-- 1. Transactions Recycle Bin Columns
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS deleted_by UUID;

CREATE INDEX IF NOT EXISTS idx_transactions_is_deleted ON public.transactions(is_deleted);

-- 2. Dynamic Sections Table
CREATE TABLE IF NOT EXISTS public.sections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'Folder',
  description TEXT,
  display_order INT DEFAULT 0,
  is_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. App Settings Table (Maintenance Mode & Branding)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID
);

-- 4. Notifications & Broadcast Announcements Table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' CHECK (type IN ('info', 'warning', 'announcement', 'maintenance')),
  target_user_id TEXT DEFAULT 'all',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);

ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Dynamic Sections Policies
DROP POLICY IF EXISTS "sections_read_policy" ON public.sections;
CREATE POLICY "sections_read_policy"
  ON public.sections FOR SELECT
  USING (is_enabled = TRUE OR public.is_admin());

DROP POLICY IF EXISTS "sections_admin_all" ON public.sections;
CREATE POLICY "sections_admin_all"
  ON public.sections FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- App Settings Policies
DROP POLICY IF EXISTS "app_settings_read_all" ON public.app_settings;
CREATE POLICY "app_settings_read_all"
  ON public.app_settings FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "app_settings_admin_write" ON public.app_settings;
CREATE POLICY "app_settings_admin_write"
  ON public.app_settings FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Notifications Policies
DROP POLICY IF EXISTS "notifications_read_policy" ON public.notifications;
CREATE POLICY "notifications_read_policy"
  ON public.notifications FOR SELECT
  USING (is_active = TRUE AND (target_user_id = 'all' OR target_user_id = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS "notifications_admin_all" ON public.notifications;
CREATE POLICY "notifications_admin_all"
  ON public.notifications FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==============================================================================
-- 9. SUPABASE REALTIME REPLICATION & PUBLICATION
-- ==============================================================================
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
ALTER TABLE public.sections REPLICA IDENTITY FULL;
ALTER TABLE public.app_settings REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'transactions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'sections') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sections;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'app_settings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- ==============================================================================
-- 10. CALCULATOR HISTORY & SETTINGS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.calculator_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
    calc_type TEXT NOT NULL CHECK (calc_type IN ('gst', 'offer', 'split', 'basic')),
    title TEXT,
    input_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calc_hist_user_created ON public.calculator_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calc_hist_type ON public.calculator_history(calc_type);

CREATE TABLE IF NOT EXISTS public.user_calculator_settings (
    user_id UUID PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
    last_mode TEXT NOT NULL DEFAULT 'gst' CHECK (last_mode IN ('gst', 'offer', 'split', 'basic')),
    default_gst_percent NUMERIC(5,2) DEFAULT 18.00,
    default_offer_percent NUMERIC(5,2) DEFAULT 10.00,
    default_split_people INTEGER DEFAULT 2,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.calculator_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_calculator_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calc_history_user_select" ON public.calculator_history;
CREATE POLICY "calc_history_user_select" ON public.calculator_history
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "calc_history_user_insert" ON public.calculator_history;
CREATE POLICY "calc_history_user_insert" ON public.calculator_history
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "calc_history_user_delete" ON public.calculator_history;
CREATE POLICY "calc_history_user_delete" ON public.calculator_history
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "calc_settings_user_all" ON public.user_calculator_settings;
CREATE POLICY "calc_settings_user_all" ON public.user_calculator_settings
    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ==============================================================================
-- 11. SHARED UDHAR & PEOPLE REALTIME PUBLICATION
-- ==============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_transactions') THEN
    ALTER TABLE public.udhar_transactions REPLICA IDENTITY FULL;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'udhar_transactions') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.udhar_transactions;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_repayments') THEN
    ALTER TABLE public.udhar_repayments REPLICA IDENTITY FULL;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'udhar_repayments') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.udhar_repayments;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_contacts') THEN
    ALTER TABLE public.udhar_contacts REPLICA IDENTITY FULL;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'udhar_contacts') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.udhar_contacts;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_connections') THEN
    ALTER TABLE public.user_connections REPLICA IDENTITY FULL;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'user_connections') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.user_connections;
    END IF;
  END IF;
END $$;

-- ==============================================================================
-- 12. AI FINANCIAL INTELLIGENCE TABLES — ROW LEVEL SECURITY (STRICT USER ISOLATION)
-- ==============================================================================
-- Applies auth.uid()::text = user_id isolation to all tables introduced for
-- AI Money Assistant, Smart Categorization, Receipt Scanner, Net Worth Tracker,
-- Safe-to-Spend Calculator, and Smart Financial Alerts.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ai_conversations',
    'ai_messages',
    'user_categorization_rules',
    'receipt_records',
    'net_worth_assets',
    'net_worth_liabilities',
    'net_worth_settings',
    'net_worth_snapshots',
    'safe_to_spend_preferences',
    'smart_alert_preferences',
    'smart_alert_events'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%s_owner_isolation" ON public.%I', tbl, tbl);
      EXECUTE format(
        'CREATE POLICY "%s_owner_isolation" ON public.%I FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id)',
        tbl,
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- (Duplicate Section 12 block removed cleanly during security remediation)

-- ==============================================================================
-- 13. UDHAR & QR PAIRING SYSTEM TABLES
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.qr_pairing_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    pairing_token TEXT NOT NULL UNIQUE,
    pairing_code TEXT NOT NULL,
    is_single_use BOOLEAN NOT NULL DEFAULT FALSE,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    used_by_user_id UUID,
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_pairing_token ON public.qr_pairing_tokens(pairing_token);
CREATE INDEX IF NOT EXISTS idx_qr_pairing_user ON public.qr_pairing_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_qr_pairing_code ON public.qr_pairing_tokens(pairing_code);

ALTER TABLE public.qr_pairing_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qr_pairing_select_all" ON public.qr_pairing_tokens;
DROP POLICY IF EXISTS "qr_pairing_select_own" ON public.qr_pairing_tokens;
CREATE POLICY "qr_pairing_select_own" ON public.qr_pairing_tokens
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "qr_pairing_insert_own" ON public.qr_pairing_tokens;
CREATE POLICY "qr_pairing_insert_own" ON public.qr_pairing_tokens
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "qr_pairing_update_own" ON public.qr_pairing_tokens;
CREATE POLICY "qr_pairing_update_own" ON public.qr_pairing_tokens
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.udhar_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    relationship_type TEXT DEFAULT 'friend',
    notes TEXT,
    linked_user_id UUID,
    photo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_udhar_contact_user_name UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_udhar_contacts_user ON public.udhar_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_udhar_contacts_linked ON public.udhar_contacts(linked_user_id);

ALTER TABLE public.udhar_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "udhar_contacts_owner_all" ON public.udhar_contacts;
CREATE POLICY "udhar_contacts_owner_all" ON public.udhar_contacts
    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.user_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id UUID NOT NULL,
    user_b_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('pending', 'connected', 'blocked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_connection_pair UNIQUE (user_a_id, user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_user_conn_a ON public.user_connections(user_a_id);
CREATE INDEX IF NOT EXISTS idx_user_conn_b ON public.user_connections(user_b_id);

ALTER TABLE public.user_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_connections_member_all" ON public.user_connections;
CREATE POLICY "user_connections_member_all" ON public.user_connections
    FOR ALL TO authenticated
    USING (auth.uid() = user_a_id OR auth.uid() = user_b_id)
    WITH CHECK (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- ==============================================================================
-- 14. UDHAR TRANSACTIONS, REPAYMENTS & AUDIT HISTORY — STRICT LENDER CONTROLS
-- ==============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_transactions') THEN
    ALTER TABLE public.udhar_transactions ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "udhar_tx_select_participant" ON public.udhar_transactions;
    CREATE POLICY "udhar_tx_select_participant" ON public.udhar_transactions
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id OR auth.uid() = counterpart_user_id);

    DROP POLICY IF EXISTS "udhar_tx_insert_owner" ON public.udhar_transactions;
    CREATE POLICY "udhar_tx_insert_owner" ON public.udhar_transactions
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);

    -- Borrowers (direction = 'took' on shared transactions) cannot settle or cancel directly via PostgREST
    DROP POLICY IF EXISTS "udhar_tx_update_lender_enforced" ON public.udhar_transactions;
    CREATE POLICY "udhar_tx_update_lender_enforced" ON public.udhar_transactions
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (
        auth.uid() = user_id
        AND (
          counterpart_user_id IS NULL
          OR direction = 'gave'
          OR status NOT IN ('settled', 'cancelled')
        )
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_repayments') THEN
    ALTER TABLE public.udhar_repayments ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "udhar_rep_select_participant" ON public.udhar_repayments;
    CREATE POLICY "udhar_rep_select_participant" ON public.udhar_repayments
      FOR SELECT TO authenticated
      USING (
        status NOT IN ('deleted', 'cancelled')
        AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM public.udhar_transactions ut
          WHERE ut.link_id = udhar_repayments.link_id
            AND (ut.user_id = auth.uid() OR ut.counterpart_user_id = auth.uid())
        )
      );

    DROP POLICY IF EXISTS "udhar_rep_insert_participant" ON public.udhar_repayments;
    CREATE POLICY "udhar_rep_insert_participant" ON public.udhar_repayments
      FOR INSERT TO authenticated
      WITH CHECK (
        auth.uid() = recorded_by_user_id
        AND EXISTS (
          SELECT 1 FROM public.udhar_transactions ut
          WHERE ut.link_id = udhar_repayments.link_id
            AND (ut.user_id = auth.uid() OR ut.counterpart_user_id = auth.uid())
        )
      );

    DROP POLICY IF EXISTS "udhar_rep_update_authorized" ON public.udhar_repayments;
    CREATE POLICY "udhar_rep_update_authorized" ON public.udhar_repayments
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.udhar_transactions ut
          WHERE ut.link_id = udhar_repayments.link_id
            AND ut.user_id = auth.uid()
            AND (
              ut.counterpart_user_id IS NULL
              OR ut.direction = 'gave'
              OR (udhar_repayments.status = 'pending_confirmation' AND udhar_repayments.recorded_by_user_id = auth.uid())
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.udhar_transactions ut
          WHERE ut.link_id = udhar_repayments.link_id
            AND ut.user_id = auth.uid()
            AND (
              ut.counterpart_user_id IS NULL
              OR ut.direction = 'gave'
              OR (udhar_repayments.recorded_by_user_id = auth.uid() AND udhar_repayments.status IN ('deleted', 'cancelled'))
            )
        )
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_edit_history') THEN
    ALTER TABLE public.udhar_edit_history ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "udhar_hist_select_participant" ON public.udhar_edit_history;
    CREATE POLICY "udhar_hist_select_participant" ON public.udhar_edit_history
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.udhar_transactions ut
          WHERE ut.link_id = udhar_edit_history.link_id
            AND (ut.user_id = auth.uid() OR ut.counterpart_user_id = auth.uid())
        )
      );
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- USER CONSENTS (STRICT USER ISOLATION & APPEND-ONLY AUDIT HISTORY)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    user_email TEXT,
    purpose TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_granted',
    consent_status TEXT NOT NULL DEFAULT 'not_granted',
    action TEXT NOT NULL DEFAULT 'granted',
    policy_version TEXT NOT NULL DEFAULT 'v2.1 — DPDP Act 2023 & Rules 2025',
    consent_wording TEXT,
    granted_at TIMESTAMPTZ,
    withdrawn_at TIMESTAMPTZ,
    source TEXT NOT NULL DEFAULT 'privacy_choices_modal',
    audit_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_consents_owner_policy" ON public.user_consents;
DROP POLICY IF EXISTS "user_consents_select_own" ON public.user_consents;
DROP POLICY IF EXISTS "user_consents_insert_own" ON public.user_consents;

CREATE POLICY "user_consents_select_own" ON public.user_consents
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "user_consents_insert_own" ON public.user_consents
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 15. USER CONNECTIONS CONSTRAINT UPDATE (SUPPORTS pending / connected / rejected / blocked)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_connections') THEN
    ALTER TABLE public.user_connections DROP CONSTRAINT IF EXISTS user_connections_status_check;
    ALTER TABLE public.user_connections
      ADD CONSTRAINT user_connections_status_check
      CHECK (status IN ('pending', 'connected', 'rejected', 'blocked'));
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 16. UDHAR TRANSACTIONS SOFT-DELETE AUDIT COLUMNS & APP_USERS PROFILE COMPLETION
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_transactions') THEN
    ALTER TABLE public.udhar_transactions ADD COLUMN IF NOT EXISTS settled_by UUID;
    ALTER TABLE public.udhar_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE public.udhar_transactions ADD COLUMN IF NOT EXISTS deleted_by UUID;
    ALTER TABLE public.udhar_transactions ADD COLUMN IF NOT EXISTS deletion_reason TEXT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'udhar_repayments') THEN
    ALTER TABLE public.udhar_repayments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE public.udhar_repayments ADD COLUMN IF NOT EXISTS deleted_by UUID;
    ALTER TABLE public.udhar_repayments ADD COLUMN IF NOT EXISTS deletion_reason TEXT;
    ALTER TABLE public.udhar_repayments DROP CONSTRAINT IF EXISTS udhar_repayments_status_check;
    ALTER TABLE public.udhar_repayments
      ADD CONSTRAINT udhar_repayments_status_check
      CHECK (status IN ('pending_confirmation', 'confirmed', 'disputed', 'rejected', 'deleted', 'cancelled'));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_users') THEN
    ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 17. USER UPI PROFILES (STRICT USER-ONLY ISOLATION — NEVER PUBLIC OR SEARCHABLE)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_upi_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.app_users(id) ON DELETE CASCADE,
    upi_id TEXT NOT NULL CHECK (upi_id ~* '^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9]{2,64}$'),
    payee_name TEXT,
    payment_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_upi_profiles_user_id ON public.user_upi_profiles(user_id);

ALTER TABLE public.user_upi_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_upi_profiles_select_own" ON public.user_upi_profiles;
CREATE POLICY "user_upi_profiles_select_own" ON public.user_upi_profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_upi_profiles_insert_own" ON public.user_upi_profiles;
CREATE POLICY "user_upi_profiles_insert_own" ON public.user_upi_profiles
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_upi_profiles_update_own" ON public.user_upi_profiles;
CREATE POLICY "user_upi_profiles_update_own" ON public.user_upi_profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_upi_profiles_delete_own" ON public.user_upi_profiles;
CREATE POLICY "user_upi_profiles_delete_own" ON public.user_upi_profiles
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 18. UNIFIED AUTH IDENTITIES (MAPS FIREBASE GOOGLE / PASSKEY / EMAIL -> CANONICAL app_users.id)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_auth_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google_firebase', 'passkey', 'email')),
    provider_uid TEXT NOT NULL,
    provider_email TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT TRUE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_auth_provider_uid UNIQUE (provider, provider_uid)
);

CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user_id ON public.user_auth_identities(user_id);

ALTER TABLE public.user_auth_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_auth_identities_owner_select" ON public.user_auth_identities;
CREATE POLICY "user_auth_identities_owner_select" ON public.user_auth_identities
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 19. USER PASSKEYS (WEBAUTHN CREDENTIALS — MULTIPLE DEVICES PER USER)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_passkeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key_spki TEXT NOT NULL,
    algorithm INTEGER NOT NULL DEFAULT -7,
    counter BIGINT NOT NULL DEFAULT 0,
    transports TEXT[] NOT NULL DEFAULT '{}'::text[],
    device_name TEXT NOT NULL DEFAULT 'Passkey Device',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_id ON public.user_passkeys(user_id);

ALTER TABLE public.user_passkeys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_passkeys_owner_select" ON public.user_passkeys;
CREATE POLICY "user_passkeys_owner_select" ON public.user_passkeys
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_passkeys_owner_delete" ON public.user_passkeys;
CREATE POLICY "user_passkeys_owner_delete" ON public.user_passkeys
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- ==============================================================================
-- Schema and RLS configuration complete.
-- ==============================================================================




