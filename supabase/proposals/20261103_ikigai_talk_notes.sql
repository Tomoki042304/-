-- Install after 20261103_ikigai_talk_introduction.sql. No member is deleted.
BEGIN;
SET LOCAL lock_timeout='5s';
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
CREATE FUNCTION public.ikigai_talk_notes_v1() RETURNS jsonb
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
COMMIT;
