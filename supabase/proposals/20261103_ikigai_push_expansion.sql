-- Durable device notifications. Run once as postgres in production.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$BEGIN
 IF to_regclass('public.ikigai_runtime_values_v1') IS NULL OR to_regclass('public.ikigai_zoom_private_v1') IS NULL OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id='2f33aba5-4e00-4c12-90e6-3396edeae91d') THEN RAISE EXCEPTION 'Production notification prerequisites do not match';END IF;
 IF EXISTS(SELECT 1 FROM public.ikigai_runtime_values_v1 WHERE key='system:push-outbox:v2') THEN RAISE EXCEPTION 'Notifications already installed';END IF;
END $$;
CREATE FUNCTION public.ikigai_push_json_v2(t text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$ BEGIN RETURN t::jsonb;EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;END $$;
CREATE FUNCTION public.ikigai_push_member_v2(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=u) AND (EXISTS(SELECT 1 FROM public.approved_members WHERE user_id=u) OR EXISTS(SELECT 1 FROM public.admins WHERE user_id=u))
$$;
CREATE FUNCTION public.ikigai_push_allowed_v2(e jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE recipient uuid=(e->>'uid')::uuid;source uuid=NULLIF(e->>'source','')::uuid;ctx jsonb=e->'context';room jsonb;member jsonb;since_at timestamptz;meeting jsonb;
BEGIN
 IF NOT public.ikigai_push_member_v2(recipient) OR recipient=source OR (source IS NOT NULL AND NOT public.ikigai_push_member_v2(source)) THEN RETURN false;END IF;
 IF e->>'kind'='morning' THEN
  SELECT data INTO meeting FROM public.ikigai_zoom_private_v1 WHERE id;
  RETURN (EXISTS(SELECT 1 FROM public.admins WHERE user_id=recipient) OR EXISTS(SELECT 1 FROM public.ikigai_member_plans_v1 WHERE user_id=recipient AND plan='premium')) AND meeting->>'reminderEnabled'='true' AND meeting->>'startsAt'=ctx->>'startsAt' AND now()<(ctx->>'startsAt')::timestamptz AND meeting->>'url'<>'';
 END IF;
 IF ctx->>'groupId' IS NOT NULL THEN
  SELECT public.ikigai_push_json_v2(value) INTO room FROM public.ikigai_runtime_values_v1 WHERE key='group:room:v1:'||(ctx->>'groupId');
  IF room IS NULL OR EXISTS(SELECT 1 FROM public.ikigai_runtime_values_v1 WHERE key='group:deleted:v1:'||(ctx->>'groupId')) THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM public.admins WHERE user_id=recipient) THEN RETURN true;END IF;
  SELECT approved_at INTO since_at FROM public.approved_members WHERE user_id=recipient;
  IF room->>'ownerUid'=recipient::text AND (room->>'at')::timestamptz>=since_at THEN RETURN true;END IF;
  SELECT public.ikigai_push_json_v2(value) INTO member FROM public.ikigai_runtime_values_v1 WHERE key='group:member:v1:'||(ctx->>'groupId')||':'||recipient::text;
  RETURN COALESCE(member->>'uid'=recipient::text AND (member->>'at')::timestamptz>=since_at,false);
 END IF;
 IF ctx->>'threadId' IS NOT NULL THEN RETURN recipient::text IN (split_part(ctx->>'threadId',':',1),split_part(ctx->>'threadId',':',2)) AND source::text IN (split_part(ctx->>'threadId',':',1),split_part(ctx->>'threadId',':',2));END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format THEN RETURN false;
END $$;
CREATE FUNCTION public.ikigai_push_enqueue_v2(kind text,source uuid,target uuid,ctx jsonb,event_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE recipient uuid;e jsonb;k text;previous_setting text=current_setting('ikigai.runtime_write',true);
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('ikigai-erasure-data',0));
 PERFORM set_config('ikigai.runtime_write','allowed',true);
 FOR recipient IN SELECT user_id FROM public.approved_members WHERE target IS NULL OR user_id=target UNION SELECT user_id FROM public.admins WHERE target IS NULL OR user_id=target LOOP
  e=jsonb_build_object('uid',recipient,'source',source,'senderUid',source,'kind',kind,'context',COALESCE(ctx,'{}'),'at',now(),'attempts',0);
  IF NOT public.ikigai_push_allowed_v2(e) THEN CONTINUE;END IF;
  k='push:queue:v2:'||recipient::text||':'||encode(sha256(convert_to(kind||':'||event_id,'UTF8')),'hex');
  IF EXISTS(SELECT 1 FROM public.ikigai_runtime_values_v1 WHERE key=replace(k,'push:queue:','push:done:') AND expires_at>now()) THEN CONTINUE;END IF;
  INSERT INTO public.ikigai_runtime_values_v1(key,value,expires_at,updated_at) VALUES(k,e::text,CASE WHEN kind='morning' THEN (ctx->>'startsAt')::timestamptz ELSE now()+interval '24 hours' END,now()) ON CONFLICT(key) DO NOTHING;
 END LOOP;
 PERFORM set_config('ikigai.runtime_write',COALESCE(previous_setting,''),true);
END $$;
CREATE FUNCTION public.ikigai_push_document_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior jsonb='{}';item jsonb;owner uuid;post_owner uuid;post_id text;entry text;src uuid;
BEGIN
 IF TG_OP='UPDATE' THEN prior=OLD.data;END IF;
 IF NEW.path !~ '^(posts|chats)/[0-9a-fA-F-]{36}$' THEN RETURN NEW;END IF;
 src=split_part(NEW.path,'/',2)::uuid;
 IF NEW.path LIKE 'posts/%' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.data->'posts','[]')) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(prior->'posts','[]')) p WHERE p->>'id'=item->>'id') THEN PERFORM public.ikigai_push_enqueue_v2('log',src,NULL,jsonb_build_object('postKey',src::text||':'||(item->>'id')),NEW.path||':'||(item->>'id'));END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.data->'comments','[]')) LOOP
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(prior->'comments','[]')) p WHERE p->>'id'=item->>'id') THEN CONTINUE;END IF;
   entry=item->>'key';IF split_part(entry,':',1) !~ '^[0-9a-fA-F-]{36}$' THEN CONTINUE;END IF;post_owner=split_part(entry,':',1)::uuid;
   IF EXISTS(SELECT 1 FROM public.documents d,jsonb_array_elements(COALESCE(d.data->'posts','[]')) p WHERE d.path='posts/'||post_owner::text AND p->>'id'=split_part(entry,':',2)) THEN PERFORM public.ikigai_push_enqueue_v2('comment',src,post_owner,jsonb_build_object('postKey',entry),src::text||':'||(item->>'id'));END IF;
  END LOOP;
  FOR entry IN SELECT jsonb_array_elements_text(COALESCE(NEW.data->'likes','[]')) LOOP
   IF COALESCE(prior->'likes','[]') ? entry THEN CONTINUE;END IF;
   IF split_part(entry,':',1) !~ '^[0-9a-fA-F-]{36}$' THEN CONTINUE;END IF;post_owner=split_part(entry,':',1)::uuid;
   IF EXISTS(SELECT 1 FROM public.documents d,jsonb_array_elements(COALESCE(d.data->'posts','[]')) p WHERE d.path='posts/'||post_owner::text AND p->>'id'=split_part(entry,':',2)) THEN PERFORM public.ikigai_push_enqueue_v2('like',src,post_owner,jsonb_build_object('postKey',entry),src::text||':'||entry||':'||COALESCE(NEW.data->'likeTimes'->>entry,now()::text));END IF;
  END LOOP;
 ELSE
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.data->'msgs','[]')) LOOP
   IF COALESCE(item->>'unsent','false')<>'true' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(prior->'msgs','[]')) p WHERE p->>'id'=item->>'id') THEN PERFORM public.ikigai_push_enqueue_v2('talk',src,NULL,jsonb_build_object('publicTalk',true),NEW.path||':'||(item->>'id'));END IF;
  END LOOP;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER ikigai_push_document_v2 AFTER INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.ikigai_push_document_v2();
CREATE FUNCTION public.ikigai_push_join_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN PERFORM public.ikigai_push_enqueue_v2('member',NEW.user_id,NULL,'{}',NEW.user_id::text||':'||NEW.approved_at::text);RETURN NEW;END $$;
CREATE TRIGGER ikigai_push_join_v2 AFTER INSERT ON public.approved_members FOR EACH ROW EXECUTE FUNCTION public.ikigai_push_join_v2();
CREATE FUNCTION public.ikigai_push_runtime_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb;prior jsonb;src uuid;target uuid;ctx jsonb='{}';kind text;gid text;mid text;message jsonb;
BEGIN
 IF NEW.key !~ '^(group:message:v1:|dm:message:v1:|announcement:item:v1:|reaction:v1:|group:reaction:v1:)' THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' THEN prior=public.ikigai_push_json_v2(OLD.value);END IF;v=public.ikigai_push_json_v2(NEW.value);IF v IS NULL THEN RETURN NEW;END IF;
 IF NEW.key LIKE 'group:reaction:v1:%' THEN
  IF COALESCE(v->>'emoji','')='' OR v->>'emoji'=prior->>'emoji' THEN RETURN NEW;END IF;
  gid=split_part(NEW.key,':',4);mid=split_part(NEW.key,':',5);src=split_part(NEW.key,':',6)::uuid;
  SELECT public.ikigai_push_json_v2(value) INTO message FROM public.ikigai_runtime_values_v1 WHERE key='group:message:v1:'||gid||':'||mid;IF message IS NULL OR message->>'unsent'='true' THEN RETURN NEW;END IF;
  target=(message->>'senderUid')::uuid;kind='reaction';ctx=jsonb_build_object('groupId',gid);
 ELSIF NEW.key LIKE 'reaction:v1:%' THEN
  IF COALESCE(v->>'emoji','')='' OR v->>'emoji'=prior->>'emoji' OR v->>'senderUid' IS NULL THEN RETURN NEW;END IF;
  src=split_part(NEW.key,':',4)::uuid;target=(v->>'senderUid')::uuid;kind='reaction';
  IF v->>'scope'='direct' THEN ctx=jsonb_build_object('threadId',v->>'threadId');ELSE ctx=jsonb_build_object('publicTalk',true);END IF;
 ELSIF NEW.key LIKE 'announcement:item:v1:%' THEN
  IF TG_OP='UPDATE' THEN RETURN NEW;END IF;src=(v->>'authorUid')::uuid;kind='announcement';ctx=jsonb_build_object('announcementId',v->>'id');
 ELSE
  IF TG_OP='UPDATE' OR v->>'unsent'='true' THEN RETURN NEW;END IF;
  src=(v->>'senderUid')::uuid;kind='talk';
  IF NEW.key LIKE 'dm:message:v1:%' THEN ctx=jsonb_build_object('threadId',v->>'threadId');target=CASE WHEN split_part(v->>'threadId',':',1)=src::text THEN split_part(v->>'threadId',':',2)::uuid ELSE split_part(v->>'threadId',':',1)::uuid END;
  ELSE ctx=jsonb_build_object('groupId',v->>'groupId');END IF;
 END IF;
 PERFORM public.ikigai_push_enqueue_v2(kind,src,target,ctx,NEW.key||':'||COALESCE(v->>'at',''));
 RETURN NEW;
END $$;
CREATE TRIGGER ikigai_push_runtime_v2 AFTER INSERT OR UPDATE ON public.ikigai_runtime_values_v1 FOR EACH ROW EXECUTE FUNCTION public.ikigai_push_runtime_v2();
-- Structured start time in UTC; the admin form uses Japan time.
CREATE OR REPLACE FUNCTION public.ikigai_zoom_write_v1(p_meeting jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb;starts timestamptz;enabled boolean=COALESCE(p_meeting->>'reminderEnabled','false')='true';
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.is_host(),false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Host required';END IF;
 IF p_meeting IS NULL OR jsonb_typeof(p_meeting)<>'object' OR jsonb_typeof(p_meeting->'url') IS DISTINCT FROM 'string' OR jsonb_typeof(p_meeting->'when') IS DISTINCT FROM 'string' OR jsonb_typeof(p_meeting->'memo') IS DISTINCT FROM 'string' OR length(p_meeting->>'url')>2000 OR length(p_meeting->>'when')>60 OR length(p_meeting->>'memo')>200 OR (p_meeting->>'url'<>'' AND p_meeting->>'url' !~* '^https://[^[:space:]<>"'']+$') THEN RAISE EXCEPTION 'Invalid Zoom settings';END IF;
 IF NULLIF(p_meeting->>'startsAt','') IS NOT NULL THEN starts=(p_meeting->>'startsAt')::timestamptz;END IF;
 IF enabled AND (starts IS NULL OR starts<=now() OR p_meeting->>'url'='') THEN RAISE EXCEPTION 'Future start time and URL required';END IF;
 v=jsonb_build_object('url',p_meeting->>'url','when',p_meeting->>'when','memo',p_meeting->>'memo','startsAt',CASE WHEN starts IS NULL THEN NULL ELSE to_char(starts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,'reminderEnabled',enabled,'reminderMinutes',30);
 UPDATE public.ikigai_zoom_private_v1 SET data=v,updated_at=now() WHERE id;RETURN jsonb_build_object('saved',true);
END $$;
CREATE FUNCTION public.ikigai_push_claim_v2() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE meeting jsonb;starts timestamptz;r record;e jsonb;out jsonb='[]';subscriptions jsonb;lease text=gen_random_uuid()::text;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('ikigai-erasure-data',0));PERFORM set_config('ikigai.runtime_write','allowed',true);
 SELECT data INTO meeting FROM public.ikigai_zoom_private_v1 WHERE id;
 IF meeting->>'reminderEnabled'='true' AND NULLIF(meeting->>'startsAt','') IS NOT NULL THEN
  starts=(meeting->>'startsAt')::timestamptz;
  IF now()>=starts-interval '30 minutes' AND now()<starts THEN PERFORM public.ikigai_push_enqueue_v2('morning',NULL,NULL,jsonb_build_object('startsAt',meeting->>'startsAt'),meeting->>'startsAt');END IF;
 END IF;
 DELETE FROM public.ikigai_runtime_values_v1 WHERE key LIKE 'push:%:v2:%' AND expires_at<now();
 FOR r IN SELECT key,value FROM public.ikigai_runtime_values_v1 WHERE key LIKE 'push:queue:v2:%' AND expires_at>now() AND COALESCE((public.ikigai_push_json_v2(value)->>'retryAt')::timestamptz,'-infinity')<=now() ORDER BY CASE WHEN public.ikigai_push_json_v2(value)->>'kind'='morning' THEN 0 ELSE 1 END,updated_at LIMIT 10 FOR UPDATE SKIP LOCKED LOOP
  e=public.ikigai_push_json_v2(r.value);IF NOT public.ikigai_push_allowed_v2(e) THEN DELETE FROM public.ikigai_runtime_values_v1 WHERE key=r.key;CONTINUE;END IF;
  SELECT COALESCE(jsonb_agg(x.entry),'[]') INTO subscriptions FROM (
   SELECT jsonb_build_object('key',sub.key,'subscription',public.ikigai_push_json_v2(sub.value),'vapid',public.ikigai_push_json_v2(vapid.value),'receipt','push:delivery:v2:'||(e->>'uid')||':'||encode(sha256(convert_to(r.key||'|'||sub.key,'UTF8')),'hex')) AS entry
   FROM public.ikigai_runtime_values_v1 sub LEFT JOIN public.ikigai_runtime_values_v1 vapid ON vapid.key='push:key:v1:'||(public.ikigai_push_json_v2(sub.value)->>'keyId')
   WHERE sub.key LIKE 'push:subscription:v1:'||(e->>'uid')||':%' AND NOT EXISTS(SELECT 1 FROM public.ikigai_runtime_values_v1 receipt WHERE receipt.key='push:delivery:v2:'||(e->>'uid')||':'||encode(sha256(convert_to(r.key||'|'||sub.key,'UTF8')),'hex') AND receipt.expires_at>now()) ORDER BY sub.key LIMIT 3
  ) x;
  e=e||jsonb_build_object('lease',lease,'retryAt',now()+interval '2 minutes');UPDATE public.ikigai_runtime_values_v1 SET value=e::text WHERE key=r.key;out=out||jsonb_build_array(e||jsonb_build_object('key',r.key,'subscriptions',subscriptions));
 END LOOP;RETURN out;
END $$;
CREATE FUNCTION public.ikigai_push_finish_v2(p_key text,p_lease text,p_ok boolean,p_receipts jsonb DEFAULT '[]',p_expired jsonb DEFAULT '[]') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e jsonb;receipt text;expired text;BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('ikigai-erasure-data',0));PERFORM set_config('ikigai.runtime_write','allowed',true);
 SELECT public.ikigai_push_json_v2(value) INTO e FROM public.ikigai_runtime_values_v1 WHERE key=p_key AND key LIKE 'push:queue:v2:%' FOR UPDATE;
 IF e IS NULL OR e->>'lease' IS DISTINCT FROM p_lease THEN RETURN;END IF;
 FOR receipt IN SELECT jsonb_array_elements_text(p_receipts) LOOP
  IF receipt LIKE 'push:delivery:v2:'||(e->>'uid')||':%' THEN INSERT INTO public.ikigai_runtime_values_v1(key,value,expires_at) VALUES(receipt,'1',now()+interval '2 days') ON CONFLICT(key) DO NOTHING;END IF;
 END LOOP;
 FOR expired IN SELECT jsonb_array_elements_text(p_expired) LOOP IF expired LIKE 'push:subscription:v1:'||(e->>'uid')||':%' THEN DELETE FROM public.ikigai_runtime_values_v1 WHERE key=expired;END IF;END LOOP;
 IF p_ok THEN INSERT INTO public.ikigai_runtime_values_v1(key,value,expires_at) VALUES(replace(p_key,'push:queue:','push:done:'),'1',now()+interval '2 days') ON CONFLICT(key) DO NOTHING;DELETE FROM public.ikigai_runtime_values_v1 WHERE key=p_key;
 ELSE UPDATE public.ikigai_runtime_values_v1 SET value=(e||jsonb_build_object('attempts',COALESCE((e->>'attempts')::int,0)+1,'retryAt',now()+interval '2 minutes'))::text WHERE key=p_key;END IF;
END $$;
CREATE FUNCTION public.ikigai_push_check_v2(p_key text,p_lease text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT COALESCE((SELECT public.ikigai_push_allowed_v2(public.ikigai_push_json_v2(value)) FROM public.ikigai_runtime_values_v1 WHERE key=p_key AND public.ikigai_push_json_v2(value)->>'lease'=p_lease),false) $$;
INSERT INTO public.ikigai_runtime_values_v1(key,value) VALUES('system:push-dispatch-token:v2',replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','')),('system:push-outbox:v2','1');
CREATE FUNCTION public.ikigai_push_auth_v2(p_token text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT COALESCE((SELECT encode(sha256(convert_to(value,'UTF8')),'hex')=encode(sha256(convert_to(p_token,'UTF8')),'hex') FROM public.ikigai_runtime_values_v1 WHERE key='system:push-dispatch-token:v2'),false) $$;
-- Internal routines are unavailable to browser roles.
DO $$DECLARE r record;BEGIN FOR r IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'ikigai_push_%_v2' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);END LOOP;END $$;
GRANT EXECUTE ON FUNCTION public.ikigai_push_auth_v2(text),public.ikigai_push_claim_v2(),public.ikigai_push_finish_v2(text,text,boolean,jsonb,jsonb),public.ikigai_push_check_v2(text,text) TO service_role;
-- Supabase invokes the authenticated dispatcher every minute, without an open app.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE FUNCTION public.ikigai_push_tick_v2() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT net.http_post(url:='https://ikigai-shidoroku.pages.dev/api/push-dispatch',headers:=jsonb_build_object('Content-Type','application/json','X-IKIGAI-Scheduler',(SELECT value FROM public.ikigai_runtime_values_v1 WHERE key='system:push-dispatch-token:v2')),body:='{}'::jsonb,timeout_milliseconds:=30000)
$$;
REVOKE ALL ON FUNCTION public.ikigai_push_tick_v2() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('ikigai-device-notifications-v2','* * * * *','SELECT public.ikigai_push_tick_v2()');
NOTIFY pgrst,'reload schema';
COMMIT;
