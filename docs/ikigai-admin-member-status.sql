-- Target: production ebozxwiuujrnvmxienat. Verify Project ID before execution.
-- Add one read-only RPC. Existing data, RLS, five functions and Auth stay unchanged.
BEGIN;
DO $guard$
BEGIN
  IF pg_catalog.to_regprocedure('public.ikigai_admin_member_status_v1()') IS NOT NULL THEN
    RAISE EXCEPTION 'RPC already exists. Inspect its definition before reapplying.';
  END IF;
END;
$guard$;
CREATE FUNCTION public.ikigai_admin_member_status_v1()
RETURNS TABLE (
  user_id uuid,
  is_admin boolean,
  display_name text,
  avatar text,
  check_day date,
  checked_today boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  day_jst date := (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_host()
    OR NOT EXISTS (SELECT 1 FROM auth.users AS caller WHERE caller.id = auth.uid() AND caller.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH roster AS (
    SELECT a.user_id FROM public.admins AS a
    UNION
    SELECT m.user_id FROM public.approved_members AS m
  )
  SELECT
    r.user_id,
    EXISTS (SELECT 1 FROM public.admins AS a WHERE a.user_id = r.user_id),
    pg_catalog.left(COALESCE(NULLIF(p.data->>'nick', ''), NULLIF(m.data->>'nick', ''), NULLIF(ap.data->>'name', ''), '名前未設定'), 80),
    COALESCE(p.data->>'avatar', m.data->>'avatar', ''),
    day_jst,
    CASE
      WHEN pg_catalog.jsonb_typeof(p.data->'checks') = 'object'
        THEN COALESCE((p.data->'checks'->>day_jst::text) = 'true', false)
      ELSE NULL
    END
  FROM roster AS r
  JOIN auth.users AS account ON account.id = r.user_id AND account.deleted_at IS NULL
  LEFT JOIN public.documents AS p ON p.path = 'data/users/' || r.user_id::text || '/profile'
  LEFT JOIN public.documents AS m ON m.path = 'members/' || r.user_id::text
  LEFT JOIN public.documents AS ap ON ap.path = 'applications/' || r.user_id::text
  ORDER BY r.user_id;
END;
$function$;
ALTER FUNCTION public.ikigai_admin_member_status_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ikigai_admin_member_status_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ikigai_admin_member_status_v1() TO authenticated, service_role;
COMMENT ON FUNCTION public.ikigai_admin_member_status_v1() IS
  'IKIGAI: hosts only; roster and today JST check status. Does not expose private record bodies.';
COMMIT;
