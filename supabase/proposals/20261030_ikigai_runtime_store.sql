-- Production: ebozxwiuujrnvmxienat. Add a private server-only table; no existing data is changed.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id='2f33aba5-4e00-4c12-90e6-3396edeae91d'::uuid)
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.documents'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'Production owner or existing RLS does not match';
 END IF;
 IF to_regclass('public.ikigai_runtime_values_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'Runtime storage already exists; inspect before reapplying';
 END IF;
END;
$guard$;
CREATE TABLE public.ikigai_runtime_values_v1(
 key text COLLATE "C" PRIMARY KEY CHECK(octet_length(key) BETWEEN 1 AND 512),
 value text NOT NULL,
 expires_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ikigai_runtime_expiry_v1 ON public.ikigai_runtime_values_v1(expires_at) WHERE expires_at IS NOT NULL;
ALTER TABLE public.ikigai_runtime_values_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ikigai_runtime_values_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ikigai_runtime_values_v1 TO service_role;
COMMENT ON TABLE public.ikigai_runtime_values_v1 IS 'Server-only operational records. Authorization and encryption stay in the application APIs; browser roles have no access.';
NOTIFY pgrst,'reload schema';
COMMIT;
