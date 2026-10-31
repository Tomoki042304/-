-- Production ebozxwiuujrnvmxienat. Existing approved members become premium.
-- Zoom settings are copied into a private table before the old public row is scrubbed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id='2f33aba5-4e00-4c12-90e6-3396edeae91d'::uuid)
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.documents'::regclass AND relrowsecurity)
 OR pg_catalog.to_regprocedure('public.is_member()') IS NULL
 OR pg_catalog.to_regprocedure('public.is_host()') IS NULL THEN
  RAISE EXCEPTION 'Production owner, membership helpers, or RLS does not match';
 END IF;
 IF pg_catalog.to_regclass('public.ikigai_member_plans_v1') IS NOT NULL
 OR pg_catalog.to_regclass('public.ikigai_zoom_private_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'Member plans already prepared; inspect before rerunning';
 END IF;
END;
$guard$;
LOCK TABLE public.approved_members IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.documents IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.ikigai_member_plans_v1(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 plan text NOT NULL CHECK(plan IN('premium','basic')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid
);
CREATE TABLE public.ikigai_zoom_private_v1(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ikigai_member_plans_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ikigai_zoom_private_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ikigai_member_plans_v1,public.ikigai_zoom_private_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ikigai_member_plans_v1,public.ikigai_zoom_private_v1 TO service_role;
INSERT INTO public.ikigai_member_plans_v1(user_id,plan)
SELECT user_id,'premium' FROM public.approved_members
UNION SELECT user_id,'premium' FROM public.admins;
INSERT INTO public.ikigai_zoom_private_v1(id,data)
VALUES(true,COALESCE((SELECT data FROM public.documents WHERE path='config/meeting'),'{}'::jsonb));
DO $verify$
BEGIN
 IF EXISTS(SELECT 1 FROM public.documents d WHERE d.path='config/meeting'
 AND d.data IS DISTINCT FROM (SELECT data FROM public.ikigai_zoom_private_v1 WHERE id)) THEN
  RAISE EXCEPTION 'Zoom copy verification failed';
 END IF;
END;
$verify$;
UPDATE public.documents SET data='{"access":"premium","storage":"private"}'::jsonb,updated_at=now() WHERE path='config/meeting';
CREATE POLICY ikigai_zoom_legacy_private_v1 ON public.documents AS RESTRICTIVE FOR ALL TO anon,authenticated
USING(path<>'config/meeting') WITH CHECK(path<>'config/meeting');
CREATE FUNCTION public.ikigai_member_plan_default_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 INSERT INTO public.ikigai_member_plans_v1(user_id,plan,updated_by)
 VALUES(NEW.user_id,'basic',auth.uid()) ON CONFLICT(user_id) DO NOTHING;
 RETURN NEW;
END;
$f$;
CREATE TRIGGER ikigai_member_plan_default_v1 AFTER INSERT ON public.approved_members
FOR EACH ROW EXECUTE FUNCTION public.ikigai_member_plan_default_v1();
CREATE FUNCTION public.ikigai_my_membership_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE v_plan text;v_host boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.is_member(),false) THEN
  RAISE EXCEPTION 'Approved membership required' USING ERRCODE='42501';
 END IF;
 v_host:=COALESCE(public.is_host(),false);
 SELECT plan INTO v_plan FROM public.ikigai_member_plans_v1 WHERE user_id=auth.uid();
 v_plan:=CASE WHEN v_host THEN 'premium' ELSE COALESCE(v_plan,'basic') END;
 RETURN jsonb_build_object('plan',v_plan,'can_zoom',v_plan='premium','can_manage',v_host,'legacy',false);
END;
$f$;
CREATE FUNCTION public.ikigai_admin_member_plans_v1() RETURNS TABLE(user_id uuid,plan text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.is_host(),false) THEN
  RAISE EXCEPTION 'Host required' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT m.user_id,CASE WHEN a.user_id IS NOT NULL THEN 'premium' ELSE COALESCE(p.plan,'basic') END
 FROM (SELECT x.user_id FROM public.approved_members x UNION SELECT x.user_id FROM public.admins x) m
 LEFT JOIN public.ikigai_member_plans_v1 p ON p.user_id=m.user_id
 LEFT JOIN public.admins a ON a.user_id=m.user_id;
END;
$f$;
CREATE FUNCTION public.ikigai_set_member_plan_v1(p_user_id uuid,p_plan text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.is_host(),false) THEN
  RAISE EXCEPTION 'Host required' USING ERRCODE='42501';
 END IF;
 IF p_plan IS NULL OR p_plan NOT IN('premium','basic') THEN RAISE EXCEPTION 'Invalid plan';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.approved_members WHERE user_id=p_user_id)
 AND NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_user_id) THEN
  RAISE EXCEPTION 'Approved member not found';
 END IF;
 IF p_plan='basic' AND EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_user_id) THEN
  RAISE EXCEPTION 'Hosts remain premium';
 END IF;
 INSERT INTO public.ikigai_member_plans_v1(user_id,plan,updated_at,updated_by)
 VALUES(p_user_id,p_plan,now(),auth.uid())
 ON CONFLICT(user_id) DO UPDATE SET plan=EXCLUDED.plan,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
 RETURN jsonb_build_object('user_id',p_user_id,'plan',p_plan);
END;
$f$;
CREATE FUNCTION public.ikigai_approve_member_plan_v1(p_user_id uuid,p_plan text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.is_host(),false) THEN
  RAISE EXCEPTION 'Host required' USING ERRCODE='42501';
 END IF;
 IF p_plan IS NULL OR p_plan NOT IN('premium','basic') THEN RAISE EXCEPTION 'Invalid plan';END IF;
 INSERT INTO public.approved_members(user_id) VALUES(p_user_id) ON CONFLICT(user_id) DO NOTHING;
 RETURN public.ikigai_set_member_plan_v1(p_user_id,p_plan);
END;
$f$;
CREATE FUNCTION public.ikigai_zoom_read_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE v_membership jsonb;v_meeting jsonb;
BEGIN
 v_membership:=public.ikigai_my_membership_v1();
 IF (v_membership->>'can_zoom')::boolean THEN
  SELECT data INTO v_meeting FROM public.ikigai_zoom_private_v1 WHERE id;
 END IF;
 RETURN jsonb_build_object('membership',v_membership,'meeting',v_meeting);
END;
$f$;
CREATE FUNCTION public.ikigai_zoom_write_v1(p_meeting jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE v_data jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.is_host(),false) THEN
  RAISE EXCEPTION 'Host required' USING ERRCODE='42501';
 END IF;
 IF p_meeting IS NULL OR jsonb_typeof(p_meeting)<>'object'
 OR jsonb_typeof(p_meeting->'url') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_meeting->'when') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_meeting->'memo') IS DISTINCT FROM 'string'
 OR length(p_meeting->>'url')>2000 OR length(p_meeting->>'when')>60 OR length(p_meeting->>'memo')>200
 OR ((p_meeting->>'url')<>'' AND (p_meeting->>'url')!~* '^https://[^[:space:]<>"'']+$') THEN
  RAISE EXCEPTION 'Invalid Zoom settings';
 END IF;
 v_data:=jsonb_build_object('url',p_meeting->>'url','when',p_meeting->>'when','memo',p_meeting->>'memo');
 UPDATE public.ikigai_zoom_private_v1 SET data=v_data,updated_at=now() WHERE id;
 RETURN jsonb_build_object('saved',true);
END;
$f$;
ALTER FUNCTION public.ikigai_member_plan_default_v1() OWNER TO postgres;
ALTER FUNCTION public.ikigai_my_membership_v1() OWNER TO postgres;
ALTER FUNCTION public.ikigai_admin_member_plans_v1() OWNER TO postgres;
ALTER FUNCTION public.ikigai_set_member_plan_v1(uuid,text) OWNER TO postgres;
ALTER FUNCTION public.ikigai_approve_member_plan_v1(uuid,text) OWNER TO postgres;
ALTER FUNCTION public.ikigai_zoom_read_v1() OWNER TO postgres;
ALTER FUNCTION public.ikigai_zoom_write_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ikigai_member_plan_default_v1(),public.ikigai_my_membership_v1(),public.ikigai_admin_member_plans_v1(),public.ikigai_set_member_plan_v1(uuid,text),public.ikigai_approve_member_plan_v1(uuid,text),public.ikigai_zoom_read_v1(),public.ikigai_zoom_write_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ikigai_my_membership_v1(),public.ikigai_admin_member_plans_v1(),public.ikigai_set_member_plan_v1(uuid,text),public.ikigai_approve_member_plan_v1(uuid,text),public.ikigai_zoom_read_v1(),public.ikigai_zoom_write_v1(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
