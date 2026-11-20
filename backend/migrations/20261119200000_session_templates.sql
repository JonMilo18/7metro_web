BEGIN;
CREATE TABLE public.session_templates (
 id uuid PRIMARY KEY,team_id integer NOT NULL REFERENCES public.taldeak(id_taldea) ON DELETE CASCADE,
 created_by integer REFERENCES public.erabiltzaileak(id_erabiltzailea) ON DELETE SET NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 session jsonb NOT NULL,details jsonb NOT NULL CHECK(jsonb_typeof(details)='array'),
 total_minutes integer NOT NULL CHECK(total_minutes BETWEEN 0 AND 999),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_templates_team ON public.session_templates(team_id,created_at DESC);
CREATE TABLE public.session_template_exercises (
 template_id uuid NOT NULL REFERENCES public.session_templates(id) ON DELETE CASCADE,
 exercise_id integer NOT NULL REFERENCES public.ariketak(id_ariketa) ON DELETE RESTRICT,
 PRIMARY KEY(template_id,exercise_id)
);
CREATE INDEX session_template_exercise_lookup ON public.session_template_exercises(exercise_id);
ALTER TABLE public.session_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_template_exercises ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_templates,public.session_template_exercises FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.session_templates,public.session_template_exercises TO service_role;

CREATE FUNCTION public.can_use_session_template_exercise(p_team integer,p_user integer,p_exercise integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.ariketak a WHERE a.id_ariketa=p_exercise AND (
 a.id_erabiltzailea=p_user OR EXISTS(SELECT 1 FROM public.saio_xehetasuna d JOIN public.saioak s ON s.id_saio=d.id_saio WHERE d.id_ariketa=a.id_ariketa AND s.id_taldea=p_team)
 OR EXISTS(SELECT 1 FROM public.session_template_exercises e JOIN public.session_templates t ON t.id=e.template_id WHERE e.exercise_id=a.id_ariketa AND t.team_id=p_team)
 OR EXISTS(SELECT 1 FROM public.exercise_shares sh JOIN public.exercise_saves sv ON sv.exercise_id=sh.exercise_id AND sv.saved_by=sh.shared_with WHERE sh.exercise_id=a.id_ariketa AND sh.shared_with=p_user)))
$$;

CREATE FUNCTION public.session_template_action(p_user_id integer,p_team_id integer,p_action text,p_payload jsonb,p_data jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_template session_templates%ROWTYPE; v_result jsonb; v_session jsonb; v_details jsonb;
 v_operation uuid; v_new_id integer; v_micro integer; v_name text; v_minutes integer;
BEGIN
 PERFORM 1 FROM team_memberships WHERE team_id=p_team_id AND user_id=p_user_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Ez zara talde horretako kidea'; END IF;
 IF p_action='list' THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'session',t.session,'total_minutes',t.total_minutes,'created_at',t.created_at,
   'exercise_count',(SELECT count(*) FROM jsonb_array_elements(t.details)d WHERE d->>'id_ariketa' IS NOT NULL),
   'duration',(SELECT COALESCE(sum((d->>'iraupena_minutuak')::integer),0) FROM jsonb_array_elements(t.details)d WHERE d->>'id_ariketa' IS NOT NULL)) ORDER BY t.created_at DESC,t.id),'[]')
   INTO v_result FROM session_templates t WHERE t.team_id=p_team_id;
  RETURN jsonb_build_object('ok',true,'templates',v_result);
 END IF;
 v_id=(p_payload->>'template_id')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Txantiloia ez da baliozkoa'; END IF;
 IF p_action='create' THEN
  v_operation=(p_payload->>'operation_id')::uuid;
  IF v_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Gordetzearen identifikatzailea ez da baliozkoa'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||v_operation::text,0));
  v_result=read_offline_operation(p_user_id,p_team_id,v_operation,p_payload);
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('session-template:'||v_id::text,0));
 SELECT * INTO v_template FROM session_templates WHERE id=v_id AND team_id=p_team_id FOR UPDATE;
 IF p_action<>'save' AND NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Ez da taldeko txantiloia aurkitu'; END IF;
 IF p_action='get' THEN
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id_ariketa),'[]') INTO v_result FROM ariketak a JOIN session_template_exercises e ON e.exercise_id=a.id_ariketa WHERE e.template_id=v_id;
  RETURN jsonb_build_object('ok',true,'template',to_jsonb(v_template),'exercises',v_result);
 ELSIF p_action='delete' THEN
  DELETE FROM session_templates WHERE id=v_id AND team_id=p_team_id;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action NOT IN ('save','create') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Ekintza ez da baliozkoa'; END IF;
 v_session=p_data->'session'; v_details=p_data->'details';
 IF jsonb_typeof(v_session) IS DISTINCT FROM 'object' OR jsonb_typeof(v_details) IS DISTINCT FROM 'array'
 OR jsonb_array_length(v_details)>1000 OR length(COALESCE(v_session->>'lekua',''))>250 OR length(COALESCE(v_session->>'helburu_taktikoa',''))>250 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Txantiloiaren datuak ez dira baliozkoak';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(v_details)d(id_ariketa integer,iraupena_minutuak integer,taldea text,aldaerak text,paraleloa integer)
 WHERE d.iraupena_minutuak IS NULL OR d.iraupena_minutuak NOT BETWEEN 0 AND 999 OR length(COALESCE(d.taldea,''))>60 OR length(COALESCE(d.aldaerak,''))>3000
 OR d.paraleloa IS NULL OR d.paraleloa NOT IN (0,1) OR (d.id_ariketa IS NULL AND (btrim(COALESCE(d.taldea,''))='' OR d.iraupena_minutuak<>0))
 OR (d.id_ariketa IS NOT NULL AND NOT can_use_session_template_exercise(p_team_id,p_user_id,d.id_ariketa))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Ariketa-zerrenda ez da baliozkoa edo ez duzu ariketa bat erabiltzeko baimenik';
 END IF;
 IF p_action='save' THEN
  v_name=btrim(p_data->>'name'); v_minutes=(p_data->>'total_minutes')::integer;
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 120 OR v_minutes IS NULL OR v_minutes NOT BETWEEN 0 AND 999 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Txantiloiaren izena eta iraupena egiaztatu'; END IF;
  -- Immutable content makes a repeated save safe after a lost HTTP response.
  IF v_template.id IS NOT NULL THEN
   IF v_template.created_by=p_user_id AND v_template.name=v_name AND v_template.session=v_session AND v_template.details=v_details AND v_template.total_minutes=v_minutes THEN RETURN jsonb_build_object('ok',true,'id',v_id); END IF;
   RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Gordetze bera beste datu batzuekin bidali da';
  END IF;
  IF EXISTS(SELECT 1 FROM session_templates WHERE id=v_id) THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Gordetzearen identifikatzailea berritu'; END IF;
  IF (SELECT count(*) FROM session_templates WHERE team_id=p_team_id)>=200 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Taldeak gehienez 200 txantiloi gorde ditzake'; END IF;
  INSERT INTO session_templates(id,team_id,created_by,name,session,details,total_minutes) VALUES(v_id,p_team_id,p_user_id,v_name,v_session,v_details,v_minutes);
  INSERT INTO session_template_exercises SELECT DISTINCT v_id,(d->>'id_ariketa')::integer FROM jsonb_array_elements(v_details)d WHERE d->>'id_ariketa' IS NOT NULL;
  RETURN jsonb_build_object('ok',true,'id',v_id);
 END IF;
 IF COALESCE(v_session->>'data_ordua','')!~'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Entrenamenduaren data ez da baliozkoa'; END IF;
 v_micro=(v_session->>'id_mikroziklo')::integer;
 IF v_micro IS NOT NULL AND NOT EXISTS(SELECT 1 FROM mikrozikloak WHERE id_mikroziklo=v_micro AND id_taldea=p_team_id) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Ez da taldeko mikrozikloa aurkitu'; END IF;
 INSERT INTO saioak(id_taldea,id_erabiltzailea,id_mikroziklo,data_ordua,lekua,helburu_taktikoa)
 VALUES(p_team_id,p_user_id,v_micro,v_session->>'data_ordua',v_session->>'lekua',v_session->>'helburu_taktikoa') RETURNING id_saio INTO v_new_id;
 INSERT INTO saio_xehetasuna(id_saio,id_ariketa,ordena,iraupena_minutuak,taldea,aldaerak,paraleloa)
 SELECT v_new_id,(d->>'id_ariketa')::integer,n,(d->>'iraupena_minutuak')::integer,d->>'taldea',d->>'aldaerak',(d->>'paraleloa')::integer FROM jsonb_array_elements(v_details) WITH ORDINALITY AS rows(d,n);
 v_result=jsonb_build_object('ok',true,'id',v_new_id);
 INSERT INTO offline_operations(user_id,operation_id,team_id,request,result) VALUES(p_user_id,v_operation,p_team_id,p_payload,v_result);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.can_use_session_template_exercise(integer,integer,integer),public.session_template_action(integer,integer,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_session_template_exercise(integer,integer,integer),public.session_template_action(integer,integer,text,jsonb,jsonb) TO service_role;

-- Account deletion must retain exercises still used by a surviving team's templates.
DO $$ DECLARE v_definition text; v_original text; BEGIN
 IF to_regprocedure('public.account_deletion_action(integer,text,text,jsonb)') IS NOT NULL THEN
  v_original=pg_get_functiondef('public.account_deletion_action(integer,text,text,jsonb)'::regprocedure);
  v_definition=replace(v_original,'EXISTS(SELECT 1 FROM public.saio_xehetasuna d WHERE d.id_ariketa=a.id_ariketa) OR',
   'EXISTS(SELECT 1 FROM public.session_template_exercises e WHERE e.exercise_id=a.id_ariketa) OR EXISTS(SELECT 1 FROM public.saio_xehetasuna d WHERE d.id_ariketa=a.id_ariketa) OR');
  IF v_definition=v_original THEN RAISE EXCEPTION 'Account deletion template retention patch did not match'; END IF;
  EXECUTE v_definition;
 END IF;
END $$;
COMMIT;
