-- Install AFTER deploying the MFA-capable application, BEFORE enabling email login.
-- No member/profile/post data is changed. The previous maintenance/erasure hook is preserved.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF to_regclass('public.ikigai_login_security_state_v1') IS NOT NULL THEN RAISE EXCEPTION 'Login security already installed; inspect instead of running twice'; END IF;
 IF to_regclass('public.admins') IS NULL OR to_regclass('public.documents') IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id='2f33aba5-4e00-4c12-90e6-3396edeae91d'::uuid)
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.documents'::regclass AND relrowsecurity)
 THEN RAISE EXCEPTION 'Production prerequisites do not match'; END IF;
END $guard$;
CREATE TABLE public.ikigai_login_security_state_v1(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),enforced boolean NOT NULL DEFAULT true,previous_hook text
);
ALTER TABLE public.ikigai_login_security_state_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ikigai_login_security_state_v1 FROM PUBLIC,anon,authenticated;
INSERT INTO public.ikigai_login_security_state_v1(id,enforced) VALUES(true,true);

CREATE FUNCTION public.ikigai_login_aal_allowed_v1() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT NOT COALESCE((SELECT enforced FROM public.ikigai_login_security_state_v1 WHERE id),true)
 OR auth.uid() IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid())
 OR COALESCE(auth.jwt()->>'aal','')='aal2';
$f$;
-- Returns only the caller's role/assurance. It cannot read another person's account.
CREATE FUNCTION public.ikigai_login_security_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE admin boolean;enforced boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login required' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid()) INTO admin;
 SELECT s.enforced INTO enforced FROM public.ikigai_login_security_state_v1 s WHERE id;
 RETURN jsonb_build_object('uid',auth.uid(),'admin',admin,'mfaRequired',admin AND enforced AND COALESCE(auth.jwt()->>'aal','')<>'aal2');
END $f$;
-- Only boolean deployment metadata is public; it contains no user or secret information.
CREATE FUNCTION public.ikigai_login_security_ready_v1() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT COALESCE((SELECT enforced FROM public.ikigai_login_security_state_v1 WHERE id),false)
 AND EXISTS(SELECT 1 FROM pg_roles,unnest(rolconfig) v WHERE rolname='authenticator' AND v='pgrst.db_pre_request=public.ikigai_login_security_pre_request_v1')
 AND EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.documents'::regclass AND polname='ikigai_admin_aal2_v1' AND NOT polpermissive);
$f$;
REVOKE ALL ON FUNCTION public.ikigai_login_aal_allowed_v1(),public.ikigai_login_security_v1(),public.ikigai_login_security_ready_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ikigai_login_aal_allowed_v1() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ikigai_login_security_v1() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ikigai_login_security_ready_v1() TO anon,authenticated,service_role;

DO $install$ DECLARE previous text;hook regprocedure;call text;item record;
BEGIN
 SELECT substr(v,length('pgrst.db_pre_request=')+1) INTO previous
 FROM pg_roles,unnest(rolconfig) v WHERE rolname='authenticator' AND starts_with(v,'pgrst.db_pre_request=');
 IF previous IS DISTINCT FROM 'public.ikigai_account_pre_request_v1' THEN RAISE EXCEPTION 'Inspect existing maintenance/erasure hook before installation'; END IF;
 hook=to_regprocedure(previous||'()');IF hook IS NULL THEN RAISE EXCEPTION 'Previous hook missing'; END IF;
 SELECT format('PERFORM %I.%I();',n.nspname,p.proname) INTO call FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=hook;
 UPDATE public.ikigai_login_security_state_v1 SET previous_hook=previous WHERE id;
 EXECUTE format($definition$
 CREATE FUNCTION public.ikigai_login_security_pre_request_v1() RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
 BEGIN
  %s
  IF current_user='authenticated'
   AND current_setting('request.path',true) IS DISTINCT FROM '/rpc/ikigai_login_security_v1'
   AND current_setting('request.path',true) IS DISTINCT FROM '/rpc/ikigai_login_security_ready_v1'
   AND NOT public.ikigai_login_aal_allowed_v1()
  THEN RAISE SQLSTATE 'PT403' USING MESSAGE='ADMIN_MFA_REQUIRED'; END IF;
 END $body$ $definition$,call);
 REVOKE ALL ON FUNCTION public.ikigai_login_security_pre_request_v1() FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION public.ikigai_login_security_pre_request_v1() TO anon,authenticated,service_role;
 ALTER ROLE authenticator SET pgrst.db_pre_request='public.ikigai_login_security_pre_request_v1';
 -- Restrictive policies also protect direct Storage/Realtime reads; existing permissive RLS remains.
 FOR item IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relrowsecurity AND c.relkind IN ('r','p')
 AND (n.nspname='public' OR (n.nspname='storage' AND c.relname='objects'))
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
 LOOP
  EXECUTE format('CREATE POLICY ikigai_admin_aal2_v1 ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING(public.ikigai_login_aal_allowed_v1()) WITH CHECK(public.ikigai_login_aal_allowed_v1())',item.nspname,item.relname);
 END LOOP;
END $install$;
NOTIFY pgrst,'reload config';
NOTIFY pgrst,'reload schema';
COMMIT;
