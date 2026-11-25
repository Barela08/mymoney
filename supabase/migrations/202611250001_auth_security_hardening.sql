-- My Money Manager: authentication and exposed-table hardening
-- Apply only after review against a staging database and the application API contract.
-- No user rows are deleted or rewritten by this migration.

BEGIN;

-- 1) Close direct Data API access to credential/session/admin-control tables.
-- The application server uses its private PostgreSQL connection for these operations.
-- Browser clients must use authenticated server endpoints, never a publishable key to
-- read password hashes, reset tokens, or server sessions.
REVOKE ALL PRIVILEGES ON TABLE
  public.app_users,
  public.admin_roles,
  public.password_resets,
  public.user_sessions,
  public.account_deletion_requests
FROM PUBLIC, anon, authenticated;

GRANT ALL PRIVILEGES ON TABLE
  public.app_users,
  public.admin_roles,
  public.password_resets,
  public.user_sessions,
  public.account_deletion_requests
TO service_role;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- 2) Admin-only destructive/password functions are not exposed through PostgREST RPC.
-- The current app performs administrative actions through server-side APIs.
REVOKE ALL PRIVILEGES ON FUNCTION public.admin_delete_user(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.admin_set_user_password(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- is_admin is used by authenticated RLS policies, but must never be callable anonymously.
REVOKE ALL PRIVILEGES ON FUNCTION public.is_admin()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- 3) Trigger functions are invoked by their table triggers, not by browser RPC calls.
REVOKE ALL PRIVILEGES ON FUNCTION public.auto_confirm_new_user()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.handle_new_user_registration()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.handle_profiles_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.prevent_transaction_owner_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.enforce_audit_log_immutability()
  FROM PUBLIC, anon, authenticated, service_role;

-- 4) Pin search_path on SECURITY DEFINER functions to prevent object shadowing.
ALTER FUNCTION public.admin_delete_user(uuid)
  SET search_path = pg_catalog, public, auth, extensions;
ALTER FUNCTION public.admin_set_user_password(uuid, text)
  SET search_path = pg_catalog, public, auth, extensions;
ALTER FUNCTION public.is_admin()
  SET search_path = pg_catalog, public, auth, extensions;
ALTER FUNCTION public.auto_confirm_new_user()
  SET search_path = pg_catalog, public, auth, extensions;
ALTER FUNCTION public.handle_new_user_registration()
  SET search_path = pg_catalog, public, auth, extensions;
ALTER FUNCTION public.handle_profiles_updated_at()
  SET search_path = pg_catalog, public, auth, extensions;
ALTER FUNCTION public.prevent_transaction_owner_change()
  SET search_path = pg_catalog, public, auth, extensions;
ALTER FUNCTION public.enforce_audit_log_immutability()
  SET search_path = pg_catalog, public, auth, extensions;

-- 5) Stop silently marking newly created Supabase Auth emails as verified.
CREATE OR REPLACE FUNCTION public.auto_confirm_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, extensions
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;

-- 6) Do not copy user-editable metadata into privileged role or plaintext-password fields.
-- Existing profile roles are preserved on conflict; new accounts always start as 'user'.
CREATE OR REPLACE FUNCTION public.handle_new_user_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, extensions
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, role, status)
  VALUES (NEW.id, NEW.email, 'user', 'active')
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;
  RETURN NEW;
END;
$function$;

-- 7) Pin the remaining trigger/helper function paths explicitly.
ALTER FUNCTION public.prevent_transaction_owner_change()
  SET search_path = pg_catalog, public, auth, extensions;
ALTER FUNCTION public.enforce_audit_log_immutability()
  SET search_path = pg_catalog, public, auth, extensions;

COMMIT;
