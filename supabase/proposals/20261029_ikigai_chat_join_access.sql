-- IKIGAI production: ebozxwiuujrnvmxienat. Run once in the SQL Editor.
-- Preserves all existing message bodies. Adds timestamp metadata and guarded RPCs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $guard$
BEGIN
  IF pg_catalog.to_regprocedure('public.ikigai_chat_room_v1()') IS NOT NULL
     OR pg_catalog.to_regclass('public.ikigai_chat_times_v1') IS NOT NULL THEN
    RAISE EXCEPTION 'Chat access migration already exists; inspect it before reapplying.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id='2f33aba5-4e00-4c12-90e6-3396edeae91d'::uuid)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.documents'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'Production owner or existing RLS does not match. No changes applied.';
  END IF;
END;
$guard$;
LOCK TABLE public.documents IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.ikigai_chat_times_v1 (
  sender_id uuid NOT NULL,
  message_id text NOT NULL,
  accepted_at timestamptz NOT NULL,
  PRIMARY KEY(sender_id,message_id)
);
ALTER TABLE public.ikigai_chat_times_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ikigai_chat_times_v1 FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.ikigai_chat_parse_time_v1(p_value text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path='' SET timezone='UTC' AS $f$
BEGIN RETURN p_value::timestamptz; EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
$f$;
-- Freeze legacy timestamps once; future client timestamps cannot expose old content to later joiners.
INSERT INTO public.ikigai_chat_times_v1(sender_id,message_id,accepted_at)
SELECT pg_catalog.substr(d.path,7)::uuid,m.item->>'id',
       LEAST(public.ikigai_chat_parse_time_v1(m.item->>'at'),pg_catalog.statement_timestamp())
FROM public.documents d
CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(d.data->'msgs')='array' THEN d.data->'msgs' ELSE '[]'::jsonb END) m(item)
WHERE d.path ~ '^chats/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND pg_catalog.jsonb_typeof(m.item->'id')='string' AND pg_catalog.length(m.item->>'id') BETWEEN 1 AND 120
  AND public.ikigai_chat_parse_time_v1(m.item->>'at') IS NOT NULL
ON CONFLICT(sender_id,message_id) DO NOTHING;
CREATE FUNCTION public.ikigai_chat_access_since_v1() RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE joined timestamptz;
BEGIN
  IF auth.uid() IS NULL OR public.is_member() IS DISTINCT FROM true
     OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Approved membership required' USING ERRCODE='42501';
  END IF;
  SELECT approved_at INTO joined FROM public.approved_members WHERE user_id=auth.uid();
  IF joined IS NULL AND public.is_host() THEN SELECT created_at INTO joined FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL; END IF;
  IF joined IS NULL THEN RAISE EXCEPTION 'Admission time unavailable' USING ERRCODE='42501'; END IF;
  -- Round upward to preserve this boundary in millisecond browser/Worker timestamps.
  IF joined>pg_catalog.date_trunc('milliseconds',joined) THEN joined:=pg_catalog.date_trunc('milliseconds',joined)+interval '1 millisecond'; END IF;
  RETURN joined;
END;
$f$;
CREATE FUNCTION public.ikigai_chat_room_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $f$
DECLARE since_at timestamptz:=public.ikigai_chat_access_since_v1(); rows_out jsonb;
BEGIN
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('path',d.path,'data',pg_catalog.jsonb_build_object(
    'msgs',COALESCE((SELECT pg_catalog.jsonb_agg(q.msg ORDER BY q.accepted_at) FROM (
       SELECT t.accepted_at,pg_catalog.jsonb_build_object('id',m.item->>'id','text',CASE WHEN m.item->>'unsent'='true' THEN '' ELSE pg_catalog.left(COALESCE(m.item->>'text',''),300) END,
         'type',CASE WHEN m.item->>'type'='give' THEN 'give' ELSE 'msg' END,
         'to',CASE WHEN m.item->>'to' ~ '^[0-9a-fA-F-]{36}$' THEN m.item->>'to' ELSE '' END,
         'unsent',COALESCE(m.item->>'unsent'='true',false),
         'at',pg_catalog.to_char(t.accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) msg
       FROM pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(d.data->'msgs')='array' THEN d.data->'msgs' ELSE '[]'::jsonb END) m(item)
       JOIN public.ikigai_chat_times_v1 t ON t.sender_id=pg_catalog.substr(d.path,7)::uuid AND t.message_id=m.item->>'id'
       WHERE t.accepted_at>=since_at ORDER BY t.accepted_at DESC LIMIT 200
    ) q),'[]'::jsonb),
    'readAt',pg_catalog.to_char(public.ikigai_chat_parse_time_v1(d.data->>'readAt') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'giveReadAt',pg_catalog.to_char(public.ikigai_chat_parse_time_v1(d.data->>'giveReadAt') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ))),'[]'::jsonb) INTO rows_out
  FROM public.documents d WHERE d.path ~ '^chats/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  RETURN rows_out;
END;
$f$;
CREATE FUNCTION public.ikigai_chat_write_v1(p_messages jsonb,p_read_at text DEFAULT NULL,p_give_read_at text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $f$
DECLARE actor uuid:=auth.uid(); existing jsonb; stored jsonb; item jsonb; found jsonb; mid text; accepted timestamptz; r timestamptz; gr timestamptz;
BEGIN
  PERFORM public.ikigai_chat_access_since_v1();
  IF pg_catalog.jsonb_typeof(p_messages)<>'array' OR p_messages IS NULL THEN RAISE EXCEPTION 'Message array required' USING ERRCODE='22023'; END IF;
  IF pg_catalog.jsonb_array_length(p_messages)>200 THEN RAISE EXCEPTION 'Too many messages' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ikigai-chat:'||actor::text,0));
  SELECT data INTO existing FROM public.documents WHERE path='chats/'||actor::text FOR UPDATE;
  existing:=COALESCE(existing,'{}'::jsonb); stored:=CASE WHEN pg_catalog.jsonb_typeof(existing->'msgs')='array' THEN existing->'msgs' ELSE '[]'::jsonb END;
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_messages) LOOP
    mid:=item->>'id';
    IF pg_catalog.jsonb_typeof(item->'id')<>'string' OR mid IS NULL OR pg_catalog.length(mid) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Invalid message ID' USING ERRCODE='22023'; END IF;
    SELECT value INTO found FROM pg_catalog.jsonb_array_elements(stored) WHERE value->>'id'=mid LIMIT 1;
    IF found IS NOT NULL THEN
      IF item->>'unsent'='true' THEN
        SELECT COALESCE(pg_catalog.jsonb_agg(CASE WHEN value->>'id'=mid THEN value||'{"unsent":true,"text":""}'::jsonb ELSE value END),'[]'::jsonb) INTO stored FROM pg_catalog.jsonb_array_elements(stored);
      END IF;
    ELSE
      IF pg_catalog.jsonb_typeof(item->'text')<>'string' OR item->>'text' IS NULL OR pg_catalog.length(item->>'text')>300
         OR (pg_catalog.btrim(item->>'text')='' AND COALESCE(item->>'unsent','false')<>'true') THEN RAISE EXCEPTION 'Invalid message text' USING ERRCODE='22023'; END IF;
      accepted:=pg_catalog.statement_timestamp();
      INSERT INTO public.ikigai_chat_times_v1 VALUES(actor,mid,accepted);
      stored:=stored||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',mid,'text',CASE WHEN item->>'unsent'='true' THEN '' ELSE item->>'text' END,
        'type',CASE WHEN item->>'type'='give' THEN 'give' ELSE 'msg' END,
        'to',CASE WHEN item->>'to' ~ '^[0-9a-fA-F-]{36}$' THEN item->>'to' ELSE '' END,
        'unsent',COALESCE(item->>'unsent'='true',false),
        'at',pg_catalog.to_char(accepted AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
    END IF;
  END LOOP;
  r:=public.ikigai_chat_parse_time_v1(existing->>'readAt');gr:=public.ikigai_chat_parse_time_v1(existing->>'giveReadAt');
  IF public.ikigai_chat_parse_time_v1(p_read_at) IS NOT NULL THEN r:=GREATEST(r,LEAST(public.ikigai_chat_parse_time_v1(p_read_at),pg_catalog.statement_timestamp())); END IF;
  IF public.ikigai_chat_parse_time_v1(p_give_read_at) IS NOT NULL THEN gr:=GREATEST(gr,LEAST(public.ikigai_chat_parse_time_v1(p_give_read_at),pg_catalog.statement_timestamp())); END IF;
  INSERT INTO public.documents(path,data,updated_at) VALUES('chats/'||actor::text,existing||pg_catalog.jsonb_build_object('msgs',stored,'readAt',r,'giveReadAt',gr),pg_catalog.statement_timestamp())
    ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data,updated_at=EXCLUDED.updated_at;
END;
$f$;
CREATE FUNCTION public.ikigai_chat_delete_own_v1() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ikigai-chat:'||auth.uid()::text,0));
  DELETE FROM public.documents WHERE path='chats/'||auth.uid()::text;
  DELETE FROM public.ikigai_chat_times_v1 WHERE sender_id=auth.uid();
END;
$f$;
-- Realtime carries only a change signal, never raw historical message arrays.
CREATE TABLE public.ikigai_chat_activity_v1(id integer PRIMARY KEY CHECK(id=1),changed_at timestamptz NOT NULL);
ALTER TABLE public.ikigai_chat_activity_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ikigai_chat_activity_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ikigai_chat_activity_v1 TO authenticated;
CREATE POLICY ikigai_chat_activity_read_v1 ON public.ikigai_chat_activity_v1 FOR SELECT TO authenticated USING(public.is_member());
INSERT INTO public.ikigai_chat_activity_v1 VALUES(1,pg_catalog.statement_timestamp());
CREATE FUNCTION public.ikigai_chat_signal_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE changed_path text;
BEGIN
  IF TG_OP='DELETE' THEN changed_path:=OLD.path; ELSE changed_path:=NEW.path; END IF;
  IF changed_path LIKE 'chats/%' THEN UPDATE public.ikigai_chat_activity_v1 SET changed_at=pg_catalog.clock_timestamp() WHERE id=1; END IF;
  RETURN NULL;
END;
$f$;
ALTER FUNCTION public.ikigai_chat_signal_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ikigai_chat_signal_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ikigai_chat_signal_v1 AFTER INSERT OR UPDATE OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.ikigai_chat_signal_v1();
DO $publication$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_publication WHERE pubname='supabase_realtime' AND NOT puballtables) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ikigai_chat_activity_v1;
  END IF;
END;
$publication$;
-- Restrictive policy composes with existing policies; no existing policy is replaced.
CREATE POLICY ikigai_chat_legacy_access_v1 ON public.documents AS RESTRICTIVE FOR ALL TO authenticated,anon
USING(path<>'chats' AND path NOT LIKE 'chats/%') WITH CHECK(path<>'chats' AND path NOT LIKE 'chats/%');
ALTER FUNCTION public.ikigai_chat_parse_time_v1(text) OWNER TO postgres;
ALTER FUNCTION public.ikigai_chat_access_since_v1() OWNER TO postgres;
ALTER FUNCTION public.ikigai_chat_room_v1() OWNER TO postgres;
ALTER FUNCTION public.ikigai_chat_write_v1(jsonb,text,text) OWNER TO postgres;
ALTER FUNCTION public.ikigai_chat_delete_own_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ikigai_chat_parse_time_v1(text),public.ikigai_chat_access_since_v1(),public.ikigai_chat_room_v1(),public.ikigai_chat_write_v1(jsonb,text,text),public.ikigai_chat_delete_own_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ikigai_chat_access_since_v1(),public.ikigai_chat_room_v1(),public.ikigai_chat_write_v1(jsonb,text,text),public.ikigai_chat_delete_own_v1() TO authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
