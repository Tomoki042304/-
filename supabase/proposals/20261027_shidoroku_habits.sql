-- User reported applied to test project; actual API tests passed 2026-10-27.
-- Historical proposal. DO NOT REAPPLY.
-- Target: imgearpizizqkutzrpuz ONLY, verified outside SQL.
-- Preflight: no conflicting table/type/function/index names; verify memberships,
-- pg_catalog.gen_random_uuid(), approved INVOKER shidoroku_stamp_record(), and
-- absence of interfering DDL event triggers. Do not replace existing objects.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.shidoroku_habits (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.shidoroku_memberships (user_id) ON DELETE CASCADE,
  name text NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT shidoroku_habit_owner_unique UNIQUE (id, user_id),
  CONSTRAINT shidoroku_habit_name_valid CHECK (
    pg_catalog.char_length(name) BETWEEN 1 AND 120
    AND name = pg_catalog.btrim(name) AND name ~ '[^[:space:]]'
  ),
  CONSTRAINT shidoroku_habit_note_valid CHECK (pg_catalog.char_length(note) <= 1000),
  CONSTRAINT shidoroku_habit_status_valid CHECK (status IN ('active', 'paused'))
);

CREATE TABLE public.shidoroku_habit_logs (
  habit_id uuid NOT NULL,
  user_id uuid NOT NULL,
  log_date date NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (habit_id, log_date),
  CONSTRAINT shidoroku_habit_log_owner_fk FOREIGN KEY (habit_id, user_id)
    REFERENCES public.shidoroku_habits (id, user_id) ON DELETE CASCADE,
  CONSTRAINT shidoroku_habit_log_date_valid CHECK (
    log_date BETWEEN '0001-01-01'::date AND '9999-12-31'::date
  )
);

CREATE INDEX shidoroku_habits_owner_created_idx
ON public.shidoroku_habits (user_id, created_at DESC, id ASC);
CREATE INDEX shidoroku_habit_logs_owner_date_idx
ON public.shidoroku_habit_logs (user_id, log_date DESC);

CREATE TRIGGER shidoroku_habits_stamp
BEFORE INSERT OR UPDATE ON public.shidoroku_habits
FOR EACH ROW EXECUTE FUNCTION public.shidoroku_stamp_record();

ALTER TABLE public.shidoroku_habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shidoroku_habit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.shidoroku_habits, public.shidoroku_habit_logs
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.shidoroku_habits, public.shidoroku_habit_logs TO authenticated;
GRANT INSERT (id, user_id, name, note, status) ON public.shidoroku_habits TO authenticated;
GRANT UPDATE (name, note, status) ON public.shidoroku_habits TO authenticated;
GRANT INSERT (habit_id, user_id, log_date) ON public.shidoroku_habit_logs TO authenticated;
GRANT DELETE ON TABLE public.shidoroku_habit_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shidoroku_habits, public.shidoroku_habit_logs TO service_role;

CREATE POLICY shidoroku_habits_select_active_self
ON public.shidoroku_habits FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS m
    WHERE m.user_id = (SELECT auth.uid()) AND m.status = 'active'
  )
);
CREATE POLICY shidoroku_habits_insert_active_self
ON public.shidoroku_habits FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS m
    WHERE m.user_id = (SELECT auth.uid()) AND m.status = 'active'
  )
);
CREATE POLICY shidoroku_habits_update_active_self
ON public.shidoroku_habits FOR UPDATE TO authenticated
USING (
  user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS m
    WHERE m.user_id = (SELECT auth.uid()) AND m.status = 'active'
  )
)
WITH CHECK (
  user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS m
    WHERE m.user_id = (SELECT auth.uid()) AND m.status = 'active'
  )
);

CREATE POLICY shidoroku_habit_logs_select_active_self
ON public.shidoroku_habit_logs FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS m
    WHERE m.user_id = (SELECT auth.uid()) AND m.status = 'active'
  )
);
CREATE POLICY shidoroku_habit_logs_insert_today_active_habit
ON public.shidoroku_habit_logs FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND log_date = (SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date)
  AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS m
    WHERE m.user_id = (SELECT auth.uid()) AND m.status = 'active'
  )
  AND EXISTS (
    SELECT 1 FROM public.shidoroku_habits AS h
    WHERE h.id = habit_id AND h.user_id = (SELECT auth.uid()) AND h.status = 'active'
  )
);
-- Paused habits retain history; today's existing record can still be undone.
CREATE POLICY shidoroku_habit_logs_delete_today_self
ON public.shidoroku_habit_logs FOR DELETE TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND log_date = (SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date)
  AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS m
    WHERE m.user_id = (SELECT auth.uid()) AND m.status = 'active'
  )
);

-- No client habit DELETE, log UPDATE, ID/owner/timestamp changes, or past/future
-- log writes. Only today's owned log DELETE is granted, enforced by RLS.
COMMIT;
