-- User reported successful application via another chat. Do not reapply.
-- Kept as a record, not an automatic migration.
-- Intended target: imgearpizizqkutzrpuz ONLY, verified outside SQL.
-- Before execution: verify no shidoroku_goals name collision, membership table,
-- pg_catalog.gen_random_uuid(), approved shidoroku_stamp_record() definition,
-- and absence of interfering DDL event triggers. Do not replace existing objects.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.shidoroku_goals (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.shidoroku_memberships (user_id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  target_date date,
  status text NOT NULL DEFAULT 'in_progress',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT shidoroku_goal_title_valid CHECK (
    pg_catalog.char_length(title) BETWEEN 1 AND 120
    AND title = pg_catalog.btrim(title) AND title ~ '[^[:space:]]'
  ),
  CONSTRAINT shidoroku_goal_description_valid CHECK (pg_catalog.char_length(description) <= 2000),
  CONSTRAINT shidoroku_goal_status_valid CHECK (status IN ('in_progress', 'achieved')),
  CONSTRAINT shidoroku_goal_date_valid CHECK (
    target_date IS NULL OR target_date BETWEEN '0001-01-01'::date AND '9999-12-31'::date
  )
);

CREATE INDEX shidoroku_goals_owner_created_idx
ON public.shidoroku_goals (user_id, created_at DESC, id ASC);

CREATE TRIGGER shidoroku_goals_stamp
BEFORE INSERT OR UPDATE ON public.shidoroku_goals
FOR EACH ROW EXECUTE FUNCTION public.shidoroku_stamp_record();

ALTER TABLE public.shidoroku_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.shidoroku_goals
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.shidoroku_goals TO authenticated;
-- Stable client UUID allows re-reading an uncertain INSERT outcome without
-- creating a second logical goal. No UPSERT or client UPDATE of id/user_id.
GRANT INSERT (id, user_id, title, description, target_date, status)
ON public.shidoroku_goals TO authenticated;
GRANT UPDATE (title, description, target_date, status)
ON public.shidoroku_goals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shidoroku_goals TO service_role;

CREATE POLICY shidoroku_goals_select_active_self
ON public.shidoroku_goals FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid()) AND membership.status = 'active'
  )
);

CREATE POLICY shidoroku_goals_insert_active_self
ON public.shidoroku_goals FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid()) AND membership.status = 'active'
  )
);

CREATE POLICY shidoroku_goals_update_active_self
ON public.shidoroku_goals FOR UPDATE TO authenticated
USING (
  user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid()) AND membership.status = 'active'
  )
)
WITH CHECK (
  user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid()) AND membership.status = 'active'
  )
);

-- No authenticated DELETE/TRUNCATE or updates of IDs/timestamps. No anon grants.
-- Creation and permission changes must be applied as this whole transaction.
COMMIT;
