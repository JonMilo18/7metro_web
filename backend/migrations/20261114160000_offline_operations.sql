BEGIN;

CREATE TABLE public.offline_operations (
  user_id integer NOT NULL REFERENCES public.erabiltzaileak(id_erabiltzailea) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  team_id integer NOT NULL REFERENCES public.taldeak(id_taldea) ON DELETE CASCADE,
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation_id)
);
ALTER TABLE public.offline_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offline_operations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.offline_operations TO service_role;

CREATE FUNCTION public.read_offline_operation(
  p_user_id integer, p_team_id integer, p_operation_id uuid, p_request jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_record public.offline_operations%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.team_memberships WHERE team_id=p_team_id AND user_id=p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Ez zara talde horretako kidea'; END IF;
  SELECT * INTO v_record FROM public.offline_operations WHERE user_id=p_user_id AND operation_id=p_operation_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_record.team_id<>p_team_id OR v_record.request IS DISTINCT FROM p_request THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Gordetze bera beste datu batzuekin bidali da';
  END IF;
  RETURN v_record.result;
END;
$$;

-- The API supplies already validated, normalized rows. The ledger and every child
-- insert commit together, including when a retry follows a lost HTTP response.
CREATE FUNCTION public.commit_offline_operation(
  p_user_id integer, p_team_id integer, p_operation_id uuid, p_request jsonb, p_data jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb; v_id integer; v_row jsonb; v_session jsonb; v_action text; v_micro integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_operation_id::text,0));
  v_result:=public.read_offline_operation(p_user_id,p_team_id,p_operation_id,p_request);
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  v_action:=p_request->>'action';
  IF v_action='pwa_create_session' THEN
    v_session:=p_data->'session';
    v_micro:=(v_session->>'id_mikroziklo')::integer;
    IF v_micro IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.mikrozikloak WHERE id_mikroziklo=v_micro AND id_taldea=p_team_id) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Ez da taldeko mikrozikloa aurkitu';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'details') d WHERE d->>'id_ariketa' IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.ariketak a WHERE a.id_ariketa=(d->>'id_ariketa')::integer AND a.id_erabiltzailea=p_user_id
    )) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Ariketa bat ez da aurkitu zure liburutegian'; END IF;
    INSERT INTO public.saioak(id_taldea,id_erabiltzailea,id_mikroziklo,data_ordua,lekua,rpe_aurreikusia,helburu_taktikoa)
      VALUES(p_team_id,p_user_id,v_micro,v_session->>'data_ordua',v_session->>'lekua',
        (v_session->>'rpe_aurreikusia')::integer,v_session->>'helburu_taktikoa') RETURNING id_saio INTO v_id;
    INSERT INTO public.saio_xehetasuna(id_saio,id_ariketa,ordena,iraupena_minutuak,taldea,aldaerak,paraleloa)
      SELECT v_id,(d->>'id_ariketa')::integer,n,(d->>'iraupena_minutuak')::integer,d->>'taldea',d->>'aldaerak',COALESCE((d->>'paraleloa')::integer,0)
      FROM jsonb_array_elements(p_data->'details') WITH ORDINALITY AS entries(d,n);
    v_result:=jsonb_build_object('ok',true,'id',v_id);
  ELSIF v_action IN ('pwa_update_session','pwa_duplicate_session') THEN
    v_result:=public.save_team_session(p_team_id,p_user_id,(p_data->>'source_id')::integer,
      v_action='pwa_duplicate_session',p_data->'session',p_data->'details',p_data->'expected');
    v_result:=v_result||jsonb_build_object('ok',true);
  ELSIF v_action='pwa_create_match' THEN
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'players') d WHERE NOT EXISTS(
      SELECT 1 FROM public.jokalariak j WHERE j.id_jokalaria=(d->>'id_jokalaria')::integer AND j.id_taldea=p_team_id
    )) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Jokalari bat ez da taldekoa'; END IF;
    v_row:=p_data->'match';
    INSERT INTO public.partidak(id_taldea,id_erabiltzailea,data_ordua,aurkaria,lekua,emaitza_geurea,emaitza_aurkaria,xehetasun_maila,estatistika_aurreratuak)
      VALUES(p_team_id,p_user_id,v_row->>'data_ordua',v_row->>'aurkaria',v_row->>'lekua',
        (v_row->>'emaitza_geurea')::integer,(v_row->>'emaitza_aurkaria')::integer,1,v_row->>'estatistika_aurreratuak') RETURNING id_partida INTO v_id;
    INSERT INTO public.partida_jokalariak(id_partida,id_jokalaria,golak,jaurtiketak)
      SELECT v_id,id_jokalaria,golak,jaurtiketak FROM jsonb_to_recordset(p_data->'players') AS p(id_jokalaria integer,golak integer,jaurtiketak integer);
    INSERT INTO public.partidu_zigorrak(id_partida,id_jokalaria,mota,minutua)
      SELECT v_id,id_jokalaria,mota,0 FROM jsonb_to_recordset(p_data->'sanctions') AS s(id_jokalaria integer,mota text);
    INSERT INTO public.partidu_jaurtiketak(id_partida,id_jokalaria,minutua,mota,taldea,jatorri_x,jatorri_y,helburu_x,helburu_y)
      SELECT v_id,id_jokalaria,minutua,mota,taldea,jatorri_x,jatorri_y,helburu_x,helburu_y FROM jsonb_to_recordset(p_data->'shots') AS s(
        id_jokalaria integer,minutua integer,mota text,taldea text,jatorri_x double precision,jatorri_y double precision,helburu_x double precision,helburu_y double precision);
    v_result:=jsonb_build_object('ok',true,'id',v_id,'event_records_saved',p_data->'events_saved');
  ELSE RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Ekintza ez da baliozkoa';
  END IF;
  INSERT INTO public.offline_operations(user_id,operation_id,team_id,request,result)
    VALUES(p_user_id,p_operation_id,p_team_id,p_request,v_result);
  RETURN v_result;
EXCEPTION WHEN serialization_failure THEN
  -- An optimistic edit conflict is not a transient database failure. PostgREST
  -- retries SQLSTATE 40001, so return an explicit HTTP conflict instead.
  RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE=SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.read_offline_operation(integer,integer,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.commit_offline_operation(integer,integer,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_offline_operation(integer,integer,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_offline_operation(integer,integer,uuid,jsonb,jsonb) TO service_role;
COMMIT;
