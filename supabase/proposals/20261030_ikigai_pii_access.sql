-- IKIGAI production: ebozxwiuujrnvmxienat. Additive preparation; no existing rows are changed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
 IF to_regclass('public.ikigai_pii_state_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'PII preparation already exists. Do not run twice.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id='2f33aba5-4e00-4c12-90e6-3396edeae91d'::uuid)
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.documents'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'Existing owner or RLS does not match.';
 END IF;
END;
$guard$;
CREATE TABLE public.ikigai_pii_state_v1(id boolean PRIMARY KEY DEFAULT true CHECK(id),enforced boolean NOT NULL DEFAULT false);
INSERT INTO public.ikigai_pii_state_v1(id,enforced) VALUES(true,false);
ALTER TABLE public.ikigai_pii_state_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ikigai_pii_state_v1 FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.ikigai_pii_fields_v1(p_path text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $f$
 SELECT CASE
 WHEN p_path ~ '^(members/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|data/users/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/profile)$' THEN ARRAY['nick','aff']
 WHEN p_path ~ '^applications/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN ARRAY['name','email','referrer','age','job','sns','reason']
 ELSE NULL END;
$f$;
CREATE FUNCTION public.ikigai_pii_valid_v1(p_path text,p_data jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $f$
DECLARE fields text[]:=public.ikigai_pii_fields_v1(p_path);field text;e jsonb;
BEGIN
 IF fields IS NULL THEN RETURN false; END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR p_data->>'_piiVersion' IS DISTINCT FROM '1'
 OR jsonb_typeof(p_data->'_pii') IS DISTINCT FROM 'object' OR p_data ?| fields THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_data->'_pii'))<>cardinality(fields) THEN RETURN false; END IF;
 FOREACH field IN ARRAY fields LOOP
  e:=p_data->'_pii'->field;
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->>'format' IS DISTINCT FROM 'ikigai-pii'
   OR e->>'version' IS DISTINCT FROM '1' OR COALESCE(e->>'kid','') !~ '^[a-zA-Z0-9_-]{1,40}$'
   OR COALESCE(e->>'iv','') !~ '^[A-Za-z0-9+/]{16}$'
   OR COALESCE(e->>'ciphertext','') !~ '^[A-Za-z0-9+/]+={0,2}$' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END;
$f$;
CREATE FUNCTION public.ikigai_pii_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE fields text[]:=public.ikigai_pii_fields_v1(NEW.path);must_encrypt boolean;
BEGIN
 IF TG_OP='UPDATE' AND public.ikigai_pii_fields_v1(OLD.path) IS NOT NULL AND NEW.path IS DISTINCT FROM OLD.path THEN
  RAISE EXCEPTION 'Protected document paths are immutable' USING ERRCODE='42501';
 END IF;
 IF fields IS NULL THEN RETURN NEW; END IF;
 SELECT enforced INTO must_encrypt FROM public.ikigai_pii_state_v1 WHERE id;
 IF TG_OP='UPDATE' THEN must_encrypt:=must_encrypt OR OLD.data ? '_piiVersion'; END IF;
 IF (must_encrypt OR NEW.data ? '_piiVersion') AND NOT public.ikigai_pii_valid_v1(NEW.path,NEW.data) THEN
  RAISE EXCEPTION 'Refresh the app before saving protected information' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$f$;
CREATE TRIGGER ikigai_pii_guard_v1 BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.ikigai_pii_guard_v1();
-- Compare-and-swap, under the caller's existing RLS. It cannot alter unrelated fields or recreate a deleted row.
CREATE FUNCTION public.ikigai_pii_replace_v1(p_path text,p_expected jsonb,p_encrypted jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE fields text[]:=public.ikigai_pii_fields_v1(p_path);affected integer;
BEGIN
 IF NOT public.ikigai_pii_valid_v1(p_path,p_encrypted)
 OR (p_expected-fields-ARRAY['_pii','_piiVersion']) IS DISTINCT FROM (p_encrypted-ARRAY['_pii','_piiVersion']) THEN
  RAISE EXCEPTION 'Invalid protected-field migration' USING ERRCODE='22023';
 END IF;
 UPDATE public.documents SET data=p_encrypted WHERE path=p_path AND data=p_expected;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END;
$f$;
CREATE FUNCTION public.ikigai_pii_status_v1(p_enforce boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE remaining bigint;locked boolean;
BEGIN
 IF auth.uid() IS NULL OR public.is_host() IS DISTINCT FROM true
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
 END IF;
 IF p_enforce THEN LOCK TABLE public.documents IN SHARE ROW EXCLUSIVE MODE; END IF;
 SELECT count(*) INTO remaining FROM public.documents WHERE public.ikigai_pii_fields_v1(path) IS NOT NULL AND NOT public.ikigai_pii_valid_v1(path,data);
 IF p_enforce THEN
  IF remaining<>0 THEN RAISE EXCEPTION 'Protected records remain unconverted'; END IF;
  UPDATE public.ikigai_pii_state_v1 SET enforced=true WHERE id;
 END IF;
 SELECT enforced INTO locked FROM public.ikigai_pii_state_v1 WHERE id;
 RETURN jsonb_build_object('remaining',remaining,'enforced',locked);
END;
$f$;
-- Existing roster RPC is preserved. The new RPC returns only the name envelope, never a whole private profile.
CREATE FUNCTION public.ikigai_admin_member_status_pii_v1()
RETURNS TABLE(user_id uuid,is_admin boolean,display_name text,avatar text,check_day date,checked_today boolean,name_path text,name_field text,name_cipher jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF auth.uid() IS NULL OR public.is_host() IS DISTINCT FROM true
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT r.user_id,r.is_admin,r.display_name,r.avatar,r.check_day,r.checked_today,
 CASE WHEN p.data->'_pii'->'nick' IS NOT NULL THEN p.path WHEN m.data->'_pii'->'nick' IS NOT NULL THEN m.path ELSE ap.path END,
 CASE WHEN p.data->'_pii'->'nick' IS NOT NULL OR m.data->'_pii'->'nick' IS NOT NULL THEN 'nick' ELSE 'name' END,
 COALESCE(p.data->'_pii'->'nick',m.data->'_pii'->'nick',ap.data->'_pii'->'name')
 FROM public.ikigai_admin_member_status_v1() r
 LEFT JOIN public.documents p ON p.path='data/users/'||r.user_id::text||'/profile'
 LEFT JOIN public.documents m ON m.path='members/'||r.user_id::text
 LEFT JOIN public.documents ap ON ap.path='applications/'||r.user_id::text;
END;
$f$;
ALTER FUNCTION public.ikigai_pii_guard_v1() OWNER TO postgres;
ALTER FUNCTION public.ikigai_pii_status_v1(boolean) OWNER TO postgres;
ALTER FUNCTION public.ikigai_admin_member_status_pii_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ikigai_pii_fields_v1(text),public.ikigai_pii_valid_v1(text,jsonb),public.ikigai_pii_guard_v1(),public.ikigai_pii_replace_v1(text,jsonb,jsonb),public.ikigai_pii_status_v1(boolean),public.ikigai_admin_member_status_pii_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ikigai_pii_fields_v1(text),public.ikigai_pii_valid_v1(text,jsonb),public.ikigai_pii_replace_v1(text,jsonb,jsonb),public.ikigai_pii_status_v1(boolean),public.ikigai_admin_member_status_pii_v1() TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
