BEGIN;
SET LOCAL lock_timeout='5s';
DO $patch$
DECLARE definition text;
BEGIN
 IF to_regprocedure('public.ikigai_register_greeting_v1(jsonb)') IS NULL THEN
  RAISE EXCEPTION '先に登録時の挨拶機能のSQLを実行してください。';
 END IF;
 definition=pg_get_functiondef('public.ikigai_register_greeting_v1(jsonb)'::regprocedure);
 IF strpos(definition,$new$'id','registration-introduction-v1','text',btrim(p_fields->>'message'),'at',stamp$new$)>0 THEN RETURN; END IF;
 IF strpos(definition,$old$'id','registration-introduction-v1','text',body,'at',stamp$old$)=0 THEN
  RAISE EXCEPTION '現在の関数が想定と異なります。変更は適用していません。';
 END IF;
 definition=replace(definition,
  $old$'id','registration-introduction-v1','text',body,'at',stamp$old$,
  $new$'id','registration-introduction-v1','text',btrim(p_fields->>'message'),'at',stamp$new$);
 EXECUTE definition;
END
$patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
