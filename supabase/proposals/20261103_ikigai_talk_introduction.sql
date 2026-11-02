-- Run once in the production SQL Editor. Existing messages are preserved.
BEGIN;
SET LOCAL lock_timeout='5s';
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
COMMIT;
