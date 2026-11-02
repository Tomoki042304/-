-- Production: ebozxwiuujrnvmxienat. Daily 02:00-02:30 Asia/Tokyo.
-- Additive, transactional. Run as postgres in Supabase SQL Editor.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id='2f33aba5-4e00-4c12-90e6-3396edeae91d'::uuid)
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.documents'::regclass AND relrowsecurity)
 OR to_regclass('public.ikigai_runtime_values_v1') IS NULL THEN
  RAISE EXCEPTION 'Production owner, RLS or runtime storage does not match';
 END IF;
 IF to_regclass('public.ikigai_maintenance_config_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'Already installed; do not overwrite operational configuration';
 END IF;
END $$;
CREATE TABLE public.ikigai_maintenance_config_v1(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),enabled boolean NOT NULL DEFAULT true,
 critical_hold boolean NOT NULL DEFAULT false,hold_on_critical boolean NOT NULL DEFAULT false,
 lease_until timestamptz,last_checked_at timestamptz,previous_hook text
);
ALTER TABLE public.ikigai_maintenance_config_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ikigai_maintenance_config_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.ikigai_maintenance_config_v1 TO service_role;
INSERT INTO public.ikigai_maintenance_config_v1(id) VALUES(true);
CREATE FUNCTION public.ikigai_maintenance_active_v1() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT critical_hold OR (enabled AND (statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::time >= time '02:00'
 AND (statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::time < time '02:30')
 FROM public.ikigai_maintenance_config_v1 WHERE id
$$;
REVOKE ALL ON FUNCTION public.ikigai_maintenance_active_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ikigai_maintenance_active_v1() TO anon,authenticated,service_role;
CREATE FUNCTION public.ikigai_maintenance_state_v1() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('configured',true,'enabled',enabled,'criticalHold',critical_hold,
 'holdOnCritical',hold_on_critical,'lastCheckedAt',last_checked_at)
 FROM public.ikigai_maintenance_config_v1 WHERE id
$$;
REVOKE ALL ON FUNCTION public.ikigai_maintenance_state_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ikigai_maintenance_state_v1() TO service_role;
-- Preserve a pre-existing PostgREST hook and its original caller privileges.
DO $install$
DECLARE old_hook text; hook_oid regprocedure; old_call text=''; item record;
BEGIN
 SELECT substring(setting FROM length('pgrst.db_pre_request=')+1) INTO old_hook
 FROM pg_roles,unnest(rolconfig) setting WHERE rolname='authenticator' AND setting LIKE 'pgrst.db_pre_request=%';
 IF old_hook IS NOT NULL AND old_hook<>'' THEN
  hook_oid=to_regprocedure(old_hook||'()');
  IF hook_oid IS NULL OR old_hook='public.ikigai_maintenance_pre_request_v1' THEN RAISE EXCEPTION 'Inspect existing pre-request hook'; END IF;
  SELECT format('PERFORM %I.%I();',n.nspname,p.proname) INTO old_call
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=hook_oid;
 END IF;
 UPDATE public.ikigai_maintenance_config_v1 SET previous_hook=old_hook;
 EXECUTE format($function$
 CREATE FUNCTION public.ikigai_maintenance_pre_request_v1() RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER AS $body$
 BEGIN
  IF current_user IN ('anon','authenticated') AND public.ikigai_maintenance_active_v1() THEN
   RAISE SQLSTATE 'PGRST' USING
    MESSAGE='{"code":"APP_MAINTENANCE","message":"System maintenance","details":null,"hint":null}',
    DETAIL='{"status":503,"headers":{"Retry-After":"30","Cache-Control":"no-store"}}';
  END IF;
  %s
 END $body$ $function$,old_call);
 REVOKE ALL ON FUNCTION public.ikigai_maintenance_pre_request_v1() FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION public.ikigai_maintenance_pre_request_v1() TO anon,authenticated,service_role;
 ALTER ROLE authenticator SET pgrst.db_pre_request='public.ikigai_maintenance_pre_request_v1';
 -- Restrictive policies also cover direct Storage/Realtime authorization checks.
 -- Do not enable RLS or change permissive application policies on existing tables.
 FOR item IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relrowsecurity AND c.relkind IN ('r','p')
 AND (n.nspname='public' OR (n.nspname='storage' AND c.relname='objects'))
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
 LOOP
  EXECUTE format('CREATE POLICY ikigai_daily_maintenance_v1 ON %I.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING (NOT public.ikigai_maintenance_active_v1()) WITH CHECK (NOT public.ikigai_maintenance_active_v1())',item.nspname,item.relname);
 END LOOP;
END $install$;
CREATE FUNCTION public.ikigai_maintenance_audit_v1(p_claim boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE claimed boolean=false; private_ok boolean; docs_ok boolean; policies_ok boolean; bucket_ok boolean; hook_ok boolean;
BEGIN
 IF p_claim THEN
  UPDATE public.ikigai_maintenance_config_v1 SET lease_until=statement_timestamp()+interval '3 minutes'
  WHERE id AND (lease_until IS NULL OR lease_until<statement_timestamp());
  claimed=FOUND;
 END IF;
 SELECT NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('ikigai_runtime_values_v1','ikigai_member_plans_v1','ikigai_zoom_private_v1','ikigai_maintenance_config_v1')
 AND (NOT c.relrowsecurity OR EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated')) roles(name)
 WHERE has_table_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 OR has_any_column_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))) INTO private_ok;
 SELECT relrowsecurity INTO docs_ok FROM pg_class WHERE oid='public.documents'::regclass;
 SELECT NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relrowsecurity AND c.relkind IN ('r','p') AND (n.nspname='public' OR (n.nspname='storage' AND c.relname='objects'))
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
 AND NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='ikigai_daily_maintenance_v1' AND NOT p.polpermissive)) INTO policies_ok;
 SELECT NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='ikigai-growth-photos' AND public) INTO bucket_ok;
 SELECT EXISTS(SELECT 1 FROM pg_roles,unnest(rolconfig) v WHERE rolname='authenticator' AND v='pgrst.db_pre_request=public.ikigai_maintenance_pre_request_v1') INTO hook_ok;
 RETURN jsonb_build_object('claimed',claimed,'privateTablesProtected',private_ok,'documentsRls',docs_ok,
 'maintenancePolicies',policies_ok,'privatePhotoBucket',bucket_ok,'databaseGateConfigured',hook_ok);
END $$;
CREATE FUNCTION public.ikigai_maintenance_finish_v1(p_critical boolean DEFAULT false) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE public.ikigai_maintenance_config_v1 SET last_checked_at=statement_timestamp(),lease_until=NULL,
 critical_hold=critical_hold OR (hold_on_critical AND p_critical) WHERE id
$$;
-- SQL Editor only operational recovery: release hold without altering the daily window.
CREATE FUNCTION public.ikigai_maintenance_release_v1() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE public.ikigai_maintenance_config_v1 SET critical_hold=false WHERE id
$$;
REVOKE ALL ON FUNCTION public.ikigai_maintenance_audit_v1(boolean),public.ikigai_maintenance_finish_v1(boolean),public.ikigai_maintenance_release_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ikigai_maintenance_audit_v1(boolean),public.ikigai_maintenance_finish_v1(boolean),public.ikigai_maintenance_release_v1() TO service_role;
NOTIFY pgrst,'reload config';
NOTIFY pgrst,'reload schema';
COMMIT;
