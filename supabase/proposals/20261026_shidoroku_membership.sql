-- REVIEW DRAFT ONLY: do not run automatically or move into migrations yet.
-- User reported this SQL was already applied via another chat; do not reapply.
-- Intended target: imgearpizizqkutzrpuz (ikigai test) ONLY.
-- Never apply to ebozxwiuujrnvmxienat or another project.
-- The executor must verify the selected project ID before executing this file.
-- A SQL connection cannot reliably prove the Supabase project ID by database name.
-- No users, memberships, profiles, or administrator accounts are created here.
-- Existing tables, functions, default privileges, and Auth settings are not altered.
-- Existing project-wide event triggers may still run on DDL: inspect before approval.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Plain CREATE intentionally fails on collisions. Never overwrite existing objects.
CREATE TABLE public.shidoroku_memberships (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  member_id text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'suspended',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT shidoroku_member_id_valid CHECK (
    pg_catalog.char_length(member_id) BETWEEN 1 AND 64
    AND member_id = pg_catalog.btrim(member_id)
  ),
  CONSTRAINT shidoroku_membership_role_valid CHECK (role IN ('member', 'admin')),
  CONSTRAINT shidoroku_membership_status_valid CHECK (status IN ('active', 'suspended'))
);

CREATE TABLE public.shidoroku_profiles (
  user_id uuid PRIMARY KEY
    REFERENCES public.shidoroku_memberships (user_id) ON DELETE CASCADE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT shidoroku_display_name_valid CHECK (
    pg_catalog.char_length(display_name) BETWEEN 1 AND 80
    AND display_name = pg_catalog.btrim(display_name)
  )
);

-- Applies only to the two new tables. Not attached to auth.users or existing tables.
CREATE FUNCTION public.shidoroku_stamp_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Changing the record owner is not permitted'
        USING ERRCODE = '23514';
    END IF;
    NEW.created_at := OLD.created_at;
  ELSE
    NEW.created_at := pg_catalog.now();
  END IF;
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

-- CREATE FUNCTION may inherit broad EXECUTE grants. No public RPC is needed.
REVOKE ALL PRIVILEGES ON FUNCTION public.shidoroku_stamp_record()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER shidoroku_memberships_stamp
BEFORE INSERT OR UPDATE ON public.shidoroku_memberships
FOR EACH ROW EXECUTE FUNCTION public.shidoroku_stamp_record();

CREATE TRIGGER shidoroku_profiles_stamp
BEFORE INSERT OR UPDATE ON public.shidoroku_profiles
FOR EACH ROW EXECUTE FUNCTION public.shidoroku_stamp_record();

ALTER TABLE public.shidoroku_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shidoroku_profiles ENABLE ROW LEVEL SECURITY;

-- Cancel inherited table-level defaults before granting only what is necessary.
-- These statements affect ONLY the new tables, not ALTER DEFAULT PRIVILEGES.
REVOKE ALL PRIVILEGES ON TABLE
  public.shidoroku_memberships, public.shidoroku_profiles
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.shidoroku_memberships TO authenticated;
GRANT SELECT ON TABLE public.shidoroku_profiles TO authenticated;
GRANT INSERT (user_id, display_name) ON public.shidoroku_profiles TO authenticated;
GRANT UPDATE (display_name) ON public.shidoroku_profiles TO authenticated;

-- Future trusted server operations only. Never expose a service-role credential.
-- No application admin API or browser writes to memberships are enabled here.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.shidoroku_memberships, public.shidoroku_profiles TO service_role;

-- Suspended users may read only their own membership to explain the denial.
CREATE POLICY shidoroku_memberships_select_self
ON public.shidoroku_memberships
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

-- No SECURITY DEFINER helper or legacy membership function is needed.
-- This subquery is itself subject to the memberships self-only SELECT policy.
CREATE POLICY shidoroku_profiles_select_active_self
ON public.shidoroku_profiles
FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid())
      AND membership.status = 'active'
  )
);

CREATE POLICY shidoroku_profiles_insert_active_self
ON public.shidoroku_profiles
FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid())
      AND membership.status = 'active'
  )
);

CREATE POLICY shidoroku_profiles_update_active_self
ON public.shidoroku_profiles
FOR UPDATE TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid())
      AND membership.status = 'active'
  )
)
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid())
      AND membership.status = 'active'
  )
);

-- No DELETE policy or grant for authenticated. No anon policies or grants.
-- No membership INSERT/UPDATE/DELETE policies for authenticated, including admins.
-- All changes become visible together only if every statement succeeds.
COMMIT;
