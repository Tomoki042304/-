-- Production ebozxwiuujrnvmxienat. Run once as postgres; never removes any member by itself.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id='2f33aba5-4e00-4c12-90e6-3396edeae91d') OR to_regclass('public.ikigai_runtime_values_v1') IS NULL OR to_regclass('public.ikigai_maintenance_config_v1') IS NULL THEN RAISE EXCEPTION 'Production prerequisites do not match';END IF;
 IF to_regclass('public.ikigai_member_erasure_jobs_v1') IS NOT NULL THEN RAISE EXCEPTION 'Already installed; inspect before reapplying';END IF;
END $$;
CREATE TABLE public.ikigai_member_erasure_jobs_v1(id uuid PRIMARY KEY,target uuid UNIQUE NOT NULL,phase text NOT NULL DEFAULT 'photos',cursor text,meta jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),verify_after timestamptz);
ALTER TABLE public.ikigai_member_erasure_jobs_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ikigai_member_erasure_jobs_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ikigai_member_erasure_jobs_v1 TO service_role;
CREATE POLICY ikigai_daily_maintenance_v1 ON public.ikigai_member_erasure_jobs_v1 AS RESTRICTIVE FOR ALL TO anon,authenticated USING(NOT public.ikigai_maintenance_active_v1()) WITH CHECK(NOT public.ikigai_maintenance_active_v1());
INSERT INTO public.ikigai_runtime_values_v1(key,value) VALUES('system:member-erasure-guard:v1','1');
-- Actor locking prevents writes authorized before revocation from committing after it.
CREATE FUNCTION public.ikigai_account_live_v1(p_uid uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF p_uid IS NULL THEN RETURN false;END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('ikigai-account:'||p_uid::text,0));
 RETURN EXISTS(SELECT 1 FROM auth.users WHERE id=p_uid) AND NOT EXISTS(SELECT 1 FROM public.ikigai_member_erasure_jobs_v1 WHERE target=p_uid);
END $$;
CREATE FUNCTION public.ikigai_current_account_live_v1() RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.ikigai_account_live_v1(auth.uid()) $$;
CREATE FUNCTION public.ikigai_erasure_json_v1(v jsonb,u text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;part record;child jsonb;
BEGIN
 IF jsonb_typeof(v)='string' THEN RETURN CASE WHEN strpos(v#>>'{}',u)>0 THEN NULL ELSE v END;END IF;
 IF jsonb_typeof(v)='array' THEN result='[]';FOR part IN SELECT value FROM jsonb_array_elements(v) LOOP child=public.ikigai_erasure_json_v1(part.value,u);IF child IS NOT NULL THEN result=result||jsonb_build_array(child);END IF;END LOOP;RETURN result;END IF;
 IF jsonb_typeof(v)='object' THEN
  IF EXISTS(SELECT 1 FROM jsonb_each(v) WHERE key IN ('uid','senderUid','ownerUid','hostUid','memberUid','authorUid','user_id','by','key','postKey','threadId','id') AND jsonb_typeof(value)='string' AND strpos(value#>>'{}',u)>0) THEN RETURN NULL;END IF;
  result='{}';FOR part IN SELECT key,value FROM jsonb_each(v) LOOP IF strpos(part.key,u)>0 THEN CONTINUE;END IF;child=public.ikigai_erasure_json_v1(part.value,u);IF child IS NOT NULL THEN result=result||jsonb_build_object(part.key,child);END IF;END LOOP;RETURN result;
 END IF;RETURN v;
END $$;
CREATE FUNCTION public.ikigai_erasure_parse_v1(v text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$ BEGIN RETURN v::jsonb;EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;END $$;
CREATE FUNCTION public.ikigai_erasure_key_v1(k text,u text,m jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE x text;r jsonb;
BEGIN
 IF strpos(k,u)>0 THEN RETURN true;END IF;
 FOR x IN SELECT jsonb_array_elements_text(COALESCE(m->'groups','[]')) LOOP IF k LIKE 'group:%' AND strpos(k,x)>0 THEN RETURN true;END IF;END LOOP;
 FOR x IN SELECT jsonb_array_elements_text(COALESCE(m->'reactions','[]')) LOOP IF starts_with(k,x) THEN RETURN true;END IF;END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(m->'messages','[]')) LOOP
 IF k IN ('group:message:v1:'||(r->>'groupId')||':'||(r->>'id'),'group:unsent:v1:'||(r->>'groupId')||':'||(r->>'id')) OR starts_with(k,'group:reaction:v1:'||(r->>'groupId')||':'||(r->>'id')||':') OR (starts_with(k,'group:timeline:v1:'||(r->>'groupId')||':') AND right(k,length(r->>'id')+1)=':'||(r->>'id')) THEN RETURN true;END IF;
 END LOOP;RETURN false;
END $$;
-- Remove stale structured references on later writes; no permanent deleted-user list is retained.
CREATE FUNCTION public.ikigai_dead_refs_v1(v jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;part record;child jsonb;s text;candidate text;
BEGIN
 IF jsonb_typeof(v)='string' THEN s=v#>>'{}';
 IF s ~ '^(like|comment)\|' THEN
  FOREACH candidate IN ARRAY ARRAY[split_part(s,'|',2),split_part(split_part(s,'|',3),':',1)] LOOP
   IF candidate ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' AND NOT public.ikigai_account_live_v1(candidate::uuid) THEN RETURN NULL;END IF;
  END LOOP;
 END IF;
 IF s ~ '^[0-9a-fA-F-]{36}:' THEN candidate=substr(s,1,36);IF candidate ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' AND NOT public.ikigai_account_live_v1(candidate::uuid) THEN RETURN NULL;END IF;END IF;RETURN v;END IF;
 IF jsonb_typeof(v)='array' THEN result='[]';FOR part IN SELECT value FROM jsonb_array_elements(v) LOOP child=public.ikigai_dead_refs_v1(part.value);IF child IS NOT NULL THEN result=result||jsonb_build_array(child);END IF;END LOOP;RETURN result;END IF;
 IF jsonb_typeof(v)='object' THEN
  FOR part IN SELECT key,value FROM jsonb_each(v) WHERE key IN ('uid','senderUid','ownerUid','hostUid','memberUid','authorUid','user_id','by') AND jsonb_typeof(value)='string' LOOP
   s=part.value#>>'{}';IF s ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' AND NOT public.ikigai_account_live_v1(s::uuid) THEN RETURN NULL;END IF;
  END LOOP;
  result='{}';FOR part IN SELECT key,value FROM jsonb_each(v) LOOP child=public.ikigai_dead_refs_v1(part.value);IF child IS NOT NULL THEN result=result||jsonb_build_object(part.key,child);END IF;END LOOP;RETURN result;
 END IF;RETURN v;
END $$;
CREATE FUNCTION public.ikigai_erasure_document_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE job record;v jsonb;section text;receipts jsonb; BEGIN
 v=NEW.data;FOR job IN SELECT target FROM public.ikigai_member_erasure_jobs_v1 LOOP IF strpos(NEW.path,job.target::text)>0 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNT_ERASURE_IN_PROGRESS';END IF;v=public.ikigai_erasure_json_v1(v,job.target::text);END LOOP;
 v=public.ikigai_dead_refs_v1(v);IF v IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='REMOVED_ACCOUNT_REFERENCE';END IF;
 FOREACH section IN ARRAY ARRAY['members','applications'] LOOP
  IF jsonb_typeof(v#>ARRAY['adminSectionSeen',section])='object' THEN
   SELECT COALESCE(jsonb_object_agg(key,value),'{}') INTO receipts FROM jsonb_each(v#>ARRAY['adminSectionSeen',section]) WHERE CASE WHEN key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN public.ikigai_account_live_v1(key::uuid) ELSE true END;
   v=jsonb_set(v,ARRAY['adminSectionSeen',section],receipts);
  END IF;
 END LOOP;NEW.data=v;RETURN NEW;
END $$;
CREATE TRIGGER ikigai_erasure_document_guard_v1 BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.ikigai_erasure_document_guard_v1();
CREATE FUNCTION public.ikigai_erasure_runtime_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.key ~ '^(group|dm|reaction|inquiry|inquiry-history|push|announcement):' AND current_setting('ikigai.runtime_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GUARDED_RUNTIME_WRITE_REQUIRED';END IF;RETURN NEW;
END $$;
CREATE TRIGGER ikigai_erasure_runtime_guard_v1 BEFORE INSERT OR UPDATE ON public.ikigai_runtime_values_v1 FOR EACH ROW EXECUTE FUNCTION public.ikigai_erasure_runtime_guard_v1();
CREATE FUNCTION public.ikigai_runtime_write_guarded_v1(p_actor uuid,p_key text,p_value text,p_expires timestamptz DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job record;v jsonb;candidate text;gid text;
BEGIN
 IF NOT public.ikigai_account_live_v1(p_actor) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNT_REMOVED';END IF;
 IF octet_length(p_key) NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'INVALID_KEY';END IF;
 v=public.ikigai_erasure_parse_v1(p_value);
 FOR job IN SELECT target,meta FROM public.ikigai_member_erasure_jobs_v1 LOOP
  IF public.ikigai_erasure_key_v1(p_key,job.target::text,job.meta) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='REMOVED_ACCOUNT_REFERENCE';END IF;
  IF v IS NOT NULL THEN v=public.ikigai_erasure_json_v1(v,job.target::text);IF v IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='REMOVED_ACCOUNT_REFERENCE';END IF;END IF;
 END LOOP;
 IF p_key LIKE 'dm:%' THEN
  FOR candidate IN SELECT (regexp_matches(p_key,'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}','g'))[1] LIMIT 2 LOOP
   IF NOT public.ikigai_account_live_v1(candidate::uuid) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNT_REMOVED';END IF;
  END LOOP;
 END IF;
 IF p_key ~ '^group:(member|message|timeline|read|reaction|unsent):v1:' THEN
  gid=split_part(p_key,':',4);IF NOT EXISTS(SELECT 1 FROM public.ikigai_runtime_values_v1 WHERE key='group:room:v1:'||gid) OR EXISTS(SELECT 1 FROM public.ikigai_runtime_values_v1 WHERE key='group:deleted:v1:'||gid) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GROUP_REMOVED';END IF;
  IF p_key LIKE 'group:reaction:v1:%' AND NOT EXISTS(SELECT 1 FROM public.ikigai_runtime_values_v1 WHERE key='group:message:v1:'||gid||':'||split_part(p_key,':',5)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='MESSAGE_REMOVED';END IF;
 END IF;
 IF v IS NOT NULL THEN v=public.ikigai_dead_refs_v1(v);IF v IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNT_REMOVED';END IF;p_value=v::text;END IF;
 PERFORM set_config('ikigai.runtime_write','allowed',true);
 INSERT INTO public.ikigai_runtime_values_v1(key,value,expires_at,updated_at) VALUES(p_key,p_value,p_expires,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,expires_at=EXCLUDED.expires_at,updated_at=EXCLUDED.updated_at;
 RETURN p_value;
END $$;
-- Preserve the installed maintenance hook; account removal also invalidates old JWT access.
DO $hooks$ DECLARE previous text;h regprocedure;call text;item record;BEGIN
 SELECT substr(v,length('pgrst.db_pre_request=')+1) INTO previous FROM pg_roles,unnest(rolconfig) v WHERE rolname='authenticator' AND starts_with(v,'pgrst.db_pre_request=');
 IF previous IS DISTINCT FROM 'public.ikigai_maintenance_pre_request_v1' THEN RAISE EXCEPTION 'Inspect existing maintenance hook';END IF;
 h=to_regprocedure(previous||'()');IF h IS NULL THEN RAISE EXCEPTION 'Inspect existing pre-request hook';END IF;
 SELECT format('PERFORM %I.%I();',n.nspname,p.proname) INTO call FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=h;
 EXECUTE format($definition$ CREATE FUNCTION public.ikigai_account_pre_request_v1() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $body$ BEGIN
 IF current_user='authenticated' AND NOT public.ikigai_current_account_live_v1() THEN RAISE SQLSTATE 'PT401' USING MESSAGE='ACCOUNT_REMOVED';END IF;%s END $body$ $definition$,call);
 REVOKE ALL ON FUNCTION public.ikigai_account_pre_request_v1() FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.ikigai_account_pre_request_v1() TO anon,authenticated,service_role;
 ALTER ROLE authenticator SET pgrst.db_pre_request='public.ikigai_account_pre_request_v1';
 FOR item IN SELECT c.oid,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relrowsecurity AND c.relkind IN ('r','p') AND (n.nspname='public' OR (n.nspname='storage' AND c.relname='objects')) AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') LOOP
 EXECUTE format('CREATE POLICY ikigai_live_account_v1 ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING(public.ikigai_current_account_live_v1()) WITH CHECK(public.ikigai_current_account_live_v1())',item.nspname,item.relname);
 END LOOP;
END $hooks$;
-- Even a service-role upload started before deletion must not recreate the file.
CREATE FUNCTION public.ikigai_erasure_photo_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE owner_text text;BEGIN
 IF NEW.bucket_id='ikigai-growth-photos' THEN owner_text=split_part(NEW.name,'/',1);
 IF owner_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' OR NOT public.ikigai_account_live_v1(owner_text::uuid) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNT_REMOVED';END IF;END IF;RETURN NEW;
END $$;
CREATE TRIGGER ikigai_erasure_photo_guard_v1 BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.ikigai_erasure_photo_guard_v1();
-- This RPC is service-only. p_actor always comes from verified server authentication.
CREATE FUNCTION public.ikigai_member_erasure_v1(p_actor uuid,p_action text,p_target uuid DEFAULT NULL,p_job uuid DEFAULT NULL,p_cursor text DEFAULT NULL,p_meta jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.ikigai_member_erasure_jobs_v1;u text;m jsonb;row record;v jsonb;clean jsonb;last_key text;seen int=0;gid text;mid text;thread text;sender text;other_data boolean;refs jsonb='[]';groups jsonb='[]';messages jsonb='[]';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.admins a JOIN auth.users u ON u.id=a.user_id WHERE a.user_id=p_actor) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ADMIN_REQUIRED';END IF;
 IF p_action='list' THEN RETURN jsonb_build_object('jobs',COALESCE((SELECT jsonb_agg(to_jsonb(x)-'meta') FROM public.ikigai_member_erasure_jobs_v1 x),'[]'));END IF;
 IF p_action='start' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('ikigai-erasure-start',0));
  IF EXISTS(SELECT 1 FROM public.ikigai_member_erasure_jobs_v1 WHERE target<>p_target) THEN RAISE EXCEPTION 'ANOTHER_ERASURE_RUNNING';END IF;
  IF p_target IS NULL OR p_target=p_actor OR EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_target) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ADMIN_ACCOUNT_PROTECTED';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ikigai-account:'||p_target::text,0));
  SELECT * INTO j FROM public.ikigai_member_erasure_jobs_v1 WHERE target=p_target;IF FOUND THEN RETURN to_jsonb(j);END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_target) THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND';END IF;
  IF EXISTS(SELECT 1 FROM storage.objects s WHERE bucket_id<>'ikigai-growth-photos' AND COALESCE(to_jsonb(s)->>'owner_id',to_jsonb(s)->>'owner')=p_target::text) THEN RAISE EXCEPTION 'OTHER_STORAGE_REQUIRES_REVIEW';END IF;
  u=p_target::text;
  FOR row IN SELECT c.relname,a.attname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (a.atttypid='uuid'::regtype OR a.attname IN ('user_id','sender_id','owner_id','account_id','member_id','recipient_id','author_id','actor_id','uid')) AND NOT a.attisdropped AND c.relname NOT IN ('admins','approved_members','ikigai_member_plans_v1','ikigai_chat_times_v1') LOOP
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I::text=$1)',row.relname,row.attname) INTO other_data USING u;
   IF other_data THEN RAISE EXCEPTION 'OTHER_APP_DATA_REQUIRES_REVIEW';END IF;
  END LOOP;seen=0;
  SELECT COALESCE(jsonb_agg(public.ikigai_erasure_parse_v1(value)->>'id'),'[]') INTO groups FROM public.ikigai_runtime_values_v1 WHERE key LIKE 'group:room:v1:%' AND public.ikigai_erasure_parse_v1(value)->>'ownerUid'=u;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('groupId',public.ikigai_erasure_parse_v1(value)->>'groupId','id',public.ikigai_erasure_parse_v1(value)->>'id')),'[]') INTO messages FROM public.ikigai_runtime_values_v1 WHERE key LIKE 'group:message:v1:%' AND public.ikigai_erasure_parse_v1(value)->>'senderUid'=u;
  FOR row IN SELECT value AS item FROM jsonb_array_elements(COALESCE((SELECT data->'msgs' FROM public.documents WHERE path='chats/'||u),'[]')) LOOP
   mid=row.item->>'id';IF mid IS NOT NULL THEN refs=refs||jsonb_build_array('reaction:v1:'||encode(sha256(convert_to(array_to_json(ARRAY['group','',u,mid])::text,'UTF8')),'hex')||':');END IF;
  END LOOP;
  FOR row IN SELECT public.ikigai_erasure_parse_v1(value) AS item FROM public.ikigai_runtime_values_v1 WHERE key LIKE 'dm:message:v1:%' AND strpos(key,u)>0 LOOP
   mid=row.item->>'id';thread=row.item->>'threadId';sender=row.item->>'senderUid';IF mid IS NOT NULL AND thread IS NOT NULL AND sender IS NOT NULL THEN refs=refs||jsonb_build_array('reaction:v1:'||encode(sha256(convert_to(array_to_json(ARRAY['direct',thread,sender,mid])::text,'UTF8')),'hex')||':');END IF;
  END LOOP;
  INSERT INTO public.ikigai_member_erasure_jobs_v1(id,target,meta) VALUES(p_job,p_target,jsonb_build_object('groups',groups,'messages',messages,'reactions',refs)) RETURNING * INTO j;
  DELETE FROM public.approved_members WHERE user_id=p_target;
  RETURN to_jsonb(j);
 END IF;
 SELECT * INTO j FROM public.ikigai_member_erasure_jobs_v1 WHERE id=p_job FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('missing',true);END IF;u=j.target::text;
 IF p_action='get' THEN RETURN to_jsonb(j);END IF;
 IF p_action='advance' THEN
  IF j.phase='photos' THEN j.phase='inventory';j.cursor=NULL;
  ELSIF j.phase='inventory' THEN j.cursor=p_cursor;IF p_meta IS NOT NULL THEN j.meta=j.meta||p_meta;END IF;IF p_cursor IS NULL THEN j.phase='legacy';END IF;
  ELSIF j.phase='legacy' THEN j.cursor=p_cursor;IF p_cursor IS NULL THEN j.phase='legacy-wait';j.verify_after=now()+interval '70 seconds';END IF;
  ELSIF j.phase='legacy-verify' THEN j.cursor=p_cursor;IF p_cursor IS NULL THEN j.phase='auth';END IF;
  ELSIF j.phase='auth' THEN j.phase='documents';j.cursor=NULL;
  ELSE RAISE EXCEPTION 'INVALID_PHASE';END IF;
 ELSIF p_action='verify-legacy' THEN
  IF j.phase<>'legacy-wait' OR now()<j.verify_after THEN RETURN to_jsonb(j);END IF;j.phase='legacy-verify';j.cursor=NULL;
 ELSIF p_action='legacy-retry' THEN j.phase='legacy';j.cursor=NULL;
 ELSIF p_action='purge' AND j.phase IN ('documents','runtime') THEN
  PERFORM set_config('ikigai.runtime_write','allowed',true);
  IF j.phase='documents' THEN
   FOR row IN SELECT path,data FROM public.documents WHERE j.cursor IS NULL OR path>j.cursor ORDER BY path LIMIT 100 LOOP
    seen=seen+1;last_key=row.path;
    IF strpos(row.path,u)>0 THEN DELETE FROM public.documents WHERE path=row.path;
    ELSIF strpos(row.data::text,u)>0 THEN clean=public.ikigai_erasure_json_v1(row.data,u);IF clean IS NULL THEN DELETE FROM public.documents WHERE path=row.path;ELSE UPDATE public.documents SET data=clean,updated_at=now() WHERE path=row.path;END IF;END IF;
   END LOOP;
  ELSE
   FOR row IN SELECT key,value FROM public.ikigai_runtime_values_v1 WHERE j.cursor IS NULL OR key>j.cursor ORDER BY key LIMIT 100 LOOP
    seen=seen+1;last_key=row.key;v=public.ikigai_erasure_parse_v1(row.value);
    IF public.ikigai_erasure_key_v1(row.key,u,j.meta) THEN DELETE FROM public.ikigai_runtime_values_v1 WHERE key=row.key;
    ELSIF strpos(row.value,u)>0 THEN
     IF row.key LIKE 'group:deleted:v1:%' AND v->>'by'=u THEN clean=v-'by';ELSE clean=public.ikigai_erasure_json_v1(v,u);END IF;
     IF clean IS NULL THEN DELETE FROM public.ikigai_runtime_values_v1 WHERE key=row.key;ELSE UPDATE public.ikigai_runtime_values_v1 SET value=clean::text WHERE key=row.key;END IF;
    END IF;
   END LOOP;
  END IF;
  j.cursor=last_key;IF seen<100 THEN j.phase=CASE WHEN j.phase='documents' THEN 'runtime' ELSE 'finish' END;j.cursor=NULL;END IF;
 ELSIF p_action='finish' AND j.phase='finish' THEN
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=j.target) OR EXISTS(SELECT 1 FROM public.documents WHERE strpos(path,u)>0 OR strpos(data::text,u)>0) OR EXISTS(SELECT 1 FROM public.ikigai_runtime_values_v1 WHERE public.ikigai_erasure_key_v1(key,u,j.meta) OR strpos(value,u)>0) OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='ikigai-growth-photos' AND starts_with(name,u||'/')) THEN RAISE EXCEPTION 'ERASURE_NOT_COMPLETE';END IF;
  DELETE FROM public.approved_members WHERE user_id=j.target;
  IF to_regclass('public.ikigai_member_plans_v1') IS NOT NULL THEN DELETE FROM public.ikigai_member_plans_v1 WHERE user_id=j.target;END IF;
  IF to_regclass('public.ikigai_chat_times_v1') IS NOT NULL THEN DELETE FROM public.ikigai_chat_times_v1 WHERE sender_id=j.target;END IF;
  DELETE FROM public.ikigai_member_erasure_jobs_v1 WHERE id=j.id;RETURN jsonb_build_object('done',true);
 ELSE RAISE EXCEPTION 'INVALID_PHASE';END IF;
 UPDATE public.ikigai_member_erasure_jobs_v1 SET phase=j.phase,cursor=j.cursor,meta=j.meta,verify_after=j.verify_after WHERE id=j.id;RETURN to_jsonb(j);
END $$;
-- Keep the existing nightly audit aware of the new wrapper and private job table.
DO $audit$ DECLARE definition text;changed text;BEGIN
 definition=pg_get_functiondef('public.ikigai_maintenance_audit_v1(boolean)'::regprocedure);
 changed=replace(definition,'v=''pgrst.db_pre_request=public.ikigai_maintenance_pre_request_v1''','v IN (''pgrst.db_pre_request=public.ikigai_maintenance_pre_request_v1'',''pgrst.db_pre_request=public.ikigai_account_pre_request_v1'')');
 IF changed=definition THEN RAISE EXCEPTION 'Inspect nightly audit hook check';END IF;
 changed=replace(changed,'''ikigai_maintenance_config_v1'')','''ikigai_maintenance_config_v1'',''ikigai_member_erasure_jobs_v1'')');
 EXECUTE changed;
END $audit$;
-- Lock down all internal routines, then expose only the boolean needed by RLS.
REVOKE ALL ON FUNCTION public.ikigai_account_live_v1(uuid),public.ikigai_current_account_live_v1(),public.ikigai_erasure_json_v1(jsonb,text),public.ikigai_erasure_parse_v1(text),public.ikigai_erasure_key_v1(text,text,jsonb),public.ikigai_dead_refs_v1(jsonb),public.ikigai_erasure_document_guard_v1(),public.ikigai_erasure_runtime_guard_v1(),public.ikigai_erasure_photo_guard_v1(),public.ikigai_runtime_write_guarded_v1(uuid,text,text,timestamptz),public.ikigai_member_erasure_v1(uuid,text,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ikigai_current_account_live_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ikigai_runtime_write_guarded_v1(uuid,text,text,timestamptz),public.ikigai_member_erasure_v1(uuid,text,uuid,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload config';NOTIFY pgrst,'reload schema';
COMMIT;
