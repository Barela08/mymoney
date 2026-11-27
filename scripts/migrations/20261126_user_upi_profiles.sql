-- Migration: Private User UPI Profiles with Owner-Only RLS
-- Project: My Money Manager by HackifyPro

CREATE TABLE IF NOT EXISTS public.user_upi_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    upi_id TEXT NOT NULL,
    payee_name TEXT,
    payment_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_upi_profiles_user_id ON public.user_upi_profiles(user_id);

ALTER TABLE public.user_upi_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_upi_profiles_select_own" ON public.user_upi_profiles;
DROP POLICY IF EXISTS "user_upi_profiles_insert_own" ON public.user_upi_profiles;
DROP POLICY IF EXISTS "user_upi_profiles_update_own" ON public.user_upi_profiles;
DROP POLICY IF EXISTS "user_upi_profiles_delete_own" ON public.user_upi_profiles;

CREATE POLICY "user_upi_profiles_select_own" ON public.user_upi_profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "user_upi_profiles_insert_own" ON public.user_upi_profiles
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_upi_profiles_update_own" ON public.user_upi_profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_upi_profiles_delete_own" ON public.user_upi_profiles
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);
