-- Admission notification cutoff; atomic chat and introduction note storage.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$ BEGIN
 IF to_regprocedure('public.ikigai_push_allowed_v2(jsonb)') IS NULL THEN RAISE EXCEPTION 'Install device notification setup first';END IF;
 IF to_regprocedure('public.ikigai_notification_cutoff_v1(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Admission notification setup already installed';END IF;
END $guard$;
DO $install$ BEGIN
 IF to_regprocedure('public.ikigai_talk_introduction_v1(text,jsonb)') IS NULL THEN
 EXECUTE $intro_install$
-- Run once in the production SQL Editor. Existing messages are preserved.


CREATE FUNCTION public.ikigai_valid_introduction_v1(t text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(t ~ '^【自己紹介】\n名前：[^\n\r]{1,40}\n職業：[^\n\r]{1,60}\n一年後目標：[^\n\r]{1,100}\n一言：[^\n\r]{1,60}$' AND t !~ '(^|\n)(名前|職業|一年後目標|一言)：[[:blank:]]*(\n|$)',false)
$$;
CREATE FUNCTION public.ikigai_introduction_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous jsonb;item jsonb;introduced boolean=false;
BEGIN
 IF NEW.path NOT LIKE 'chats/%' THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' THEN previous=OLD.data;ELSE SELECT data INTO previous FROM public.documents WHERE path=NEW.path;END IF;
 IF previous->>'talkIntroduction'='true' THEN NEW.data=jsonb_set(NEW.data,'{talkIntroduction}','true');RETURN NEW;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.data->'msgs','[]')) LOOP
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(previous->'msgs','[]')) prior(item_value) WHERE prior.item_value->>'id'=item->>'id') THEN CONTINUE;END IF;
  IF item->>'unsent'='true' OR NOT public.ikigai_valid_introduction_v1(item->>'text') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='TALK_INTRODUCTION_REQUIRED';END IF;
  introduced=true;
 END LOOP;
 NEW.data=jsonb_set(NEW.data,'{talkIntroduction}',to_jsonb(introduced));RETURN NEW;
END $$;
CREATE TRIGGER ikigai_talk_introduction_guard_v1 BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.ikigai_introduction_guard_v1();
CREATE FUNCTION public.ikigai_talk_introduction_v1(p_action text,p_fields jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid=auth.uid();ready boolean;body text;field text;limits int[]=ARRAY[40,60,100,60];keys text[]=ARRAY['name','occupation','goal','message'];i int;
BEGIN
 PERFORM public.ikigai_chat_access_since_v1();
 PERFORM pg_advisory_xact_lock(hashtextextended('ikigai-chat:'||actor::text,0));
 SELECT data->>'talkIntroduction'='true' INTO ready FROM public.documents WHERE path='chats/'||actor::text;
 IF p_action='status' THEN RETURN jsonb_build_object('introduced',COALESCE(ready,false));END IF;
 IF p_action<>'submit' THEN RAISE EXCEPTION 'INVALID_ACTION';END IF;
 IF ready THEN RETURN jsonb_build_object('introduced',true);END IF;
 FOR i IN 1..4 LOOP
  field=p_fields->>keys[i];IF jsonb_typeof(p_fields->keys[i]) IS DISTINCT FROM 'string' OR field IS NULL OR length(btrim(field)) NOT BETWEEN 1 AND limits[i] OR field ~ '[\n\r]' THEN RAISE EXCEPTION 'INVALID_INTRODUCTION';END IF;
 END LOOP;
 body='【自己紹介】'||chr(10)||'名前：'||btrim(p_fields->>'name')||chr(10)||'職業：'||btrim(p_fields->>'occupation')||chr(10)||'一年後目標：'||btrim(p_fields->>'goal')||chr(10)||'一言：'||btrim(p_fields->>'message');
 PERFORM public.ikigai_chat_write_v1(jsonb_build_array(jsonb_build_object('id','intro-'||gen_random_uuid()::text,'text',body,'type','msg')),NULL,NULL);
 RETURN jsonb_build_object('introduced',true);
END $$;
ALTER FUNCTION public.ikigai_chat_room_v1() RENAME TO ikigai_chat_room_before_introduction_v1;
CREATE FUNCTION public.ikigai_chat_room_v1() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM public.ikigai_chat_access_since_v1();
 IF NOT EXISTS(SELECT 1 FROM public.documents WHERE path='chats/'||auth.uid()::text AND data->>'talkIntroduction'='true') THEN RETURN '[]'::jsonb;END IF;
 RETURN public.ikigai_chat_room_before_introduction_v1();
END $$;
REVOKE ALL ON FUNCTION public.ikigai_chat_room_before_introduction_v1(),public.ikigai_valid_introduction_v1(text),public.ikigai_introduction_guard_v1(),public.ikigai_talk_introduction_v1(text,jsonb),public.ikigai_chat_room_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ikigai_talk_introduction_v1(text,jsonb),public.ikigai_chat_room_v1() TO authenticated;
NOTIFY pgrst,'reload schema';

$intro_install$;
 END IF;
END $install$;
-- Install after 20261103_ikigai_talk_introduction.sql. No member is deleted.


DO $$ BEGIN
 IF to_regprocedure('public.ikigai_talk_introduction_v1(text,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'Install the talk introduction SQL first';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.ikigai_introduction_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE previous jsonb;item jsonb;introduced boolean=false;note jsonb;
BEGIN
 IF NEW.path NOT LIKE 'chats/%' THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' THEN previous=OLD.data;
 ELSE SELECT data INTO previous FROM public.documents WHERE path=NEW.path;END IF;
 -- Preserve the saved introduction even when its chat message is unsent later.
 note=previous->'talkIntroductionNote';
 IF jsonb_typeof(note) IS DISTINCT FROM 'object' THEN
  SELECT jsonb_build_object(
   'name',substr(split_part(value->>'text',chr(10),2),4),
   'occupation',substr(split_part(value->>'text',chr(10),3),4),
   'goal',substr(split_part(value->>'text',chr(10),4),7),
   'message',substr(split_part(value->>'text',chr(10),5),4),
   'at',value->>'at'
  ) INTO note
  FROM jsonb_array_elements(COALESCE(previous->'msgs','[]')||COALESCE(NEW.data->'msgs','[]'))
  WHERE public.ikigai_valid_introduction_v1(value->>'text')
   AND COALESCE(value->>'unsent','false')<>'true'
  LIMIT 1;
 END IF;
 IF note IS NOT NULL THEN
  NEW.data=jsonb_set(NEW.data,'{talkIntroductionNote}',note);
 ELSE
  NEW.data=NEW.data-'talkIntroductionNote';
 END IF;
 IF previous->>'talkIntroduction'='true' THEN
  NEW.data=jsonb_set(NEW.data,'{talkIntroduction}','true');RETURN NEW;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.data->'msgs','[]')) LOOP
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(previous->'msgs','[]')) prior(item_value)
   WHERE prior.item_value->>'id'=item->>'id') THEN CONTINUE;END IF;
  IF item->>'unsent'='true' OR NOT public.ikigai_valid_introduction_v1(item->>'text') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='TALK_INTRODUCTION_REQUIRED';
  END IF;
  introduced=true;
 END LOOP;
 NEW.data=jsonb_set(NEW.data,'{talkIntroduction}',to_jsonb(introduced));RETURN NEW;
END $$;
-- Recover introductions already submitted and still present in the chat history.
UPDATE public.documents SET data=data
WHERE path ~ '^chats/[0-9a-fA-F-]{36}$'
 AND data->>'talkIntroduction'='true'
 AND jsonb_typeof(data->'talkIntroductionNote') IS DISTINCT FROM 'object';
CREATE OR REPLACE FUNCTION public.ikigai_talk_notes_v1() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE notes jsonb;
BEGIN
 PERFORM public.ikigai_chat_access_since_v1();
 IF NOT EXISTS(SELECT 1 FROM public.documents
  WHERE path='chats/'||auth.uid()::text AND data->>'talkIntroduction'='true') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='TALK_INTRODUCTION_REQUIRED';
 END IF;
 SELECT COALESCE(jsonb_agg(note ORDER BY COALESCE(note->>'at','') DESC,note->>'uid'),'[]')
 INTO notes FROM (
  SELECT (d.data->'talkIntroductionNote')||jsonb_build_object('uid',u.id::text) AS note
  FROM public.documents d JOIN auth.users u ON d.path='chats/'||u.id::text
  WHERE d.data->>'talkIntroduction'='true'
   AND jsonb_typeof(d.data->'talkIntroductionNote')='object'
   AND (EXISTS(SELECT 1 FROM public.approved_members a WHERE a.user_id=u.id)
    OR EXISTS(SELECT 1 FROM public.admins a WHERE a.user_id=u.id))
 ) saved;
 RETURN jsonb_build_object('notes',notes);
END $$;
REVOKE ALL ON FUNCTION public.ikigai_talk_notes_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ikigai_talk_notes_v1() TO authenticated;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.ikigai_talk_introduction_v1(p_action text,p_fields jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid=auth.uid();ready boolean;body text;field text;limits int[]=ARRAY[40,60,100,60];keys text[]=ARRAY['name','occupation','goal','message'];i int;
BEGIN
 PERFORM public.ikigai_chat_access_since_v1();
 PERFORM pg_advisory_xact_lock(hashtextextended('ikigai-chat:'||actor::text,0));
 SELECT data->>'talkIntroduction'='true' INTO ready FROM public.documents WHERE path='chats/'||actor::text;
 IF p_action='status' THEN RETURN jsonb_build_object('introduced',COALESCE(ready,false),'noteSaved',EXISTS(SELECT 1 FROM public.documents WHERE path='chats/'||actor::text AND jsonb_typeof(data->'talkIntroductionNote')='object'));END IF;
 IF p_action<>'submit' THEN RAISE EXCEPTION 'INVALID_ACTION';END IF;
 IF ready THEN RETURN jsonb_build_object('introduced',true,'noteSaved',EXISTS(SELECT 1 FROM public.documents WHERE path='chats/'||actor::text AND jsonb_typeof(data->'talkIntroductionNote')='object'));END IF;
 FOR i IN 1..4 LOOP
  field=p_fields->>keys[i];IF jsonb_typeof(p_fields->keys[i]) IS DISTINCT FROM 'string' OR field IS NULL OR length(btrim(field)) NOT BETWEEN 1 AND limits[i] OR field ~ '[\n\r]' THEN RAISE EXCEPTION 'INVALID_INTRODUCTION';END IF;
 END LOOP;
 body='【自己紹介】'||chr(10)||'名前：'||btrim(p_fields->>'name')||chr(10)||'職業：'||btrim(p_fields->>'occupation')||chr(10)||'一年後目標：'||btrim(p_fields->>'goal')||chr(10)||'一言：'||btrim(p_fields->>'message');
 PERFORM public.ikigai_chat_write_v1(jsonb_build_array(jsonb_build_object('id','intro-'||gen_random_uuid()::text,'text',body,'type','msg')),NULL,NULL);
 IF NOT EXISTS(SELECT 1 FROM public.documents WHERE path='chats/'||actor::text AND jsonb_typeof(data->'talkIntroductionNote')='object' AND data->'talkIntroductionNote'->>'name'=btrim(p_fields->>'name') AND data->'talkIntroductionNote'->>'occupation'=btrim(p_fields->>'occupation') AND data->'talkIntroductionNote'->>'goal'=btrim(p_fields->>'goal') AND data->'talkIntroductionNote'->>'message'=btrim(p_fields->>'message')) THEN RAISE EXCEPTION 'INTRODUCTION_SAVE_INCOMPLETE';END IF;
 RETURN jsonb_build_object('introduced',true,'noteSaved',true);
END $$;


CREATE FUNCTION public.ikigai_notification_cutoff_v1(p_uid uuid) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT COALESCE((SELECT approved_at FROM public.approved_members WHERE user_id=p_uid),(SELECT created_at FROM auth.users WHERE id=p_uid AND EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_uid)))
$$;
ALTER FUNCTION public.ikigai_push_allowed_v2(jsonb) RENAME TO ikigai_push_allowed_before_admission_v2;
CREATE FUNCTION public.ikigai_push_allowed_v2(e jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE cutoff timestamptz;occurred timestamptz;
BEGIN
 cutoff=public.ikigai_notification_cutoff_v1((e->>'uid')::uuid);
 IF (e->'context') ? 'eventAt' THEN occurred=NULLIF(e->'context'->>'eventAt','')::timestamptz;ELSE occurred=(e->>'at')::timestamptz;END IF;
 IF cutoff IS NULL OR occurred IS NULL OR occurred<cutoff THEN RETURN false;END IF;
 RETURN public.ikigai_push_allowed_before_admission_v2(e);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.ikigai_notification_cutoff_v1(uuid),public.ikigai_push_allowed_before_admission_v2(jsonb),public.ikigai_push_allowed_v2(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.ikigai_push_document_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior jsonb='{}';item jsonb;owner uuid;post_owner uuid;post_id text;entry text;src uuid;
BEGIN
 IF TG_OP='UPDATE' THEN prior=OLD.data;END IF;
 IF NEW.path !~ '^(posts|chats)/[0-9a-fA-F-]{36}$' THEN RETURN NEW;END IF;
 src=split_part(NEW.path,'/',2)::uuid;
 IF NEW.path LIKE 'posts/%' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.data->'posts','[]')) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(prior->'posts','[]')) p WHERE p->>'id'=item->>'id') THEN PERFORM public.ikigai_push_enqueue_v2('log',src,NULL,jsonb_build_object('postKey',src::text||':'||(item->>'id'),'eventAt',item->>'at'),NEW.path||':'||(item->>'id'));END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.data->'comments','[]')) LOOP
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(prior->'comments','[]')) p WHERE p->>'id'=item->>'id') THEN CONTINUE;END IF;
   entry=item->>'key';IF split_part(entry,':',1) !~ '^[0-9a-fA-F-]{36}$' THEN CONTINUE;END IF;post_owner=split_part(entry,':',1)::uuid;
   IF EXISTS(SELECT 1 FROM public.documents d,jsonb_array_elements(COALESCE(d.data->'posts','[]')) p WHERE d.path='posts/'||post_owner::text AND p->>'id'=split_part(entry,':',2)) THEN PERFORM public.ikigai_push_enqueue_v2('comment',src,post_owner,jsonb_build_object('postKey',entry,'eventAt',item->>'at'),src::text||':'||(item->>'id'));END IF;
  END LOOP;
  FOR entry IN SELECT jsonb_array_elements_text(COALESCE(NEW.data->'likes','[]')) LOOP
   IF COALESCE(prior->'likes','[]') ? entry THEN CONTINUE;END IF;
   IF split_part(entry,':',1) !~ '^[0-9a-fA-F-]{36}$' THEN CONTINUE;END IF;post_owner=split_part(entry,':',1)::uuid;
   IF EXISTS(SELECT 1 FROM public.documents d,jsonb_array_elements(COALESCE(d.data->'posts','[]')) p WHERE d.path='posts/'||post_owner::text AND p->>'id'=split_part(entry,':',2)) THEN PERFORM public.ikigai_push_enqueue_v2('like',src,post_owner,jsonb_build_object('postKey',entry,'eventAt',NEW.data->'likeTimes'->>entry),src::text||':'||entry||':'||COALESCE(NEW.data->'likeTimes'->>entry,now()::text));END IF;
  END LOOP;
 ELSE
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.data->'msgs','[]')) LOOP
   IF COALESCE(item->>'unsent','false')<>'true' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(prior->'msgs','[]')) p WHERE p->>'id'=item->>'id') THEN PERFORM public.ikigai_push_enqueue_v2('talk',src,NULL,jsonb_build_object('publicTalk',true,'eventAt',item->>'at'),NEW.path||':'||(item->>'id'));END IF;
  END LOOP;
 END IF;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.ikigai_push_runtime_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
 PERFORM public.ikigai_push_enqueue_v2(kind,src,target,ctx||jsonb_build_object('eventAt',v->>'at'),NEW.key||':'||COALESCE(v->>'at',''));
 RETURN NEW;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
