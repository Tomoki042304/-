-- User reported successful application via another chat. Do not reapply.
-- Kept as a record, not an automatic migration.
-- Target: imgearpizizqkutzrpuz ONLY. Verify project ID outside SQL before running.
-- Preflight: verify no conflicting shidoroku_mottos object exists and verify
-- public.shidoroku_stamp_record() is the previously approved INVOKER trigger
-- function with empty search_path and immutable user_id/created_at handling.
-- Do not replace any existing table, function, policy, or default privileges.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.shidoroku_mottos (
  user_id uuid PRIMARY KEY
    REFERENCES public.shidoroku_memberships (user_id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT shidoroku_motto_content_valid CHECK (
    pg_catalog.char_length(content) BETWEEN 1 AND 500
    AND content = pg_catalog.btrim(content)
    AND content ~ '[^[:space:]]'
  )
);

CREATE TRIGGER shidoroku_mottos_stamp
BEFORE INSERT OR UPDATE ON public.shidoroku_mottos
FOR EACH ROW EXECUTE FUNCTION public.shidoroku_stamp_record();

ALTER TABLE public.shidoroku_mottos ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.shidoroku_mottos
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.shidoroku_mottos TO authenticated;
GRANT INSERT (user_id, content) ON public.shidoroku_mottos TO authenticated;
GRANT UPDATE (content) ON public.shidoroku_mottos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shidoroku_mottos TO service_role;

CREATE POLICY shidoroku_mottos_select_active_self
ON public.shidoroku_mottos FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid()) AND membership.status = 'active'
  )
);

CREATE POLICY shidoroku_mottos_insert_active_self
ON public.shidoroku_mottos FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid()) AND membership.status = 'active'
  )
);

CREATE POLICY shidoroku_mottos_update_active_self
ON public.shidoroku_mottos FOR UPDATE TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid()) AND membership.status = 'active'
  )
)
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.shidoroku_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid()) AND membership.status = 'active'
  )
);

-- No anon access or authenticated DELETE, TRUNCATE, or owner/timestamp updates.
-- Do not run CREATE alone: table creation and ACL/RLS changes must commit together.
COMMIT;
