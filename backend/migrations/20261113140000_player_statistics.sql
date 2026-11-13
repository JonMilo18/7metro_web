BEGIN;
CREATE TABLE public.portal_stats_settings (
  team_id integer PRIMARY KEY REFERENCES public.taldeak(id_taldea) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0
);
ALTER TABLE public.portal_stats_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_stats_settings FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.portal_stats_settings TO service_role;

-- Raw calculation inputs are service-role only. metro-api returns a personal summary.
CREATE FUNCTION public.player_statistics_action(p_user integer,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_team integer;
  v_player integer;
  v_enabled boolean := false;
  v_version integer := 0;
  v_today date := (now() AT TIME ZONE 'Europe/Madrid')::date;
  v_start date;
  v_matches integer[];
  v_sessions integer[];
BEGIN
  IF p_action IN ('settings','save_settings') THEN
    v_team := (p_data->>'team_id')::integer;
    PERFORM 1 FROM public.team_memberships WHERE user_id=p_user AND team_id=v_team FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Ez zara talde horretako kidea'; END IF;
    INSERT INTO public.portal_stats_settings(team_id) VALUES(v_team) ON CONFLICT DO NOTHING;
    SELECT enabled,version INTO v_enabled,v_version FROM public.portal_stats_settings WHERE team_id=v_team FOR UPDATE;
    IF p_action='save_settings' THEN
      IF jsonb_typeof(p_data->'enabled') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Datuak ez dira baliozkoak';
      END IF;
      IF p_data->>'version' IS DISTINCT FROM v_version::text THEN
        RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Baimena beste gailu batean aldatu da. Birkargatu';
      END IF;
      UPDATE public.portal_stats_settings SET enabled=(p_data->>'enabled')::boolean,version=version+1
        WHERE team_id=v_team RETURNING enabled,version INTO v_enabled,v_version;
    END IF;
    RETURN jsonb_build_object('enabled',v_enabled,'version',v_version);
  END IF;
  IF p_action NOT IN ('status','get') OR p_action IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Datuak ez dira baliozkoak';
  END IF;
  v_player := (p_data->>'player_id')::integer;
  SELECT l.team_id INTO v_team FROM public.portal_player_links l
    JOIN public.jokalariak j ON j.id_jokalaria=l.player_id AND j.id_taldea=l.team_id
    WHERE l.user_id=p_user AND l.player_id=v_player FOR KEY SHARE OF l;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Ez duzu jokalari honen baimenik'; END IF;
  SELECT enabled INTO v_enabled FROM public.portal_stats_settings WHERE team_id=v_team FOR SHARE;
  v_enabled := COALESCE(v_enabled,false);
  IF p_action='status' THEN RETURN jsonb_build_object('enabled',v_enabled); END IF;
  IF NOT v_enabled THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Entrenatzaileak estatistikak desaktibatuta ditu';
  END IF;
  CASE COALESCE(p_data->>'period','all')
    WHEN 'all' THEN v_start := '0001-01-01'::date;
    WHEN 'month' THEN v_start := v_today-interval '1 month';
    WHEN '3months' THEN v_start := v_today-interval '3 months';
    WHEN 'season' THEN v_start := make_date(extract(year FROM v_today)::integer-
      CASE WHEN extract(month FROM v_today)<8 THEN 1 ELSE 0 END,8,1);
    ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Datuak ez dira baliozkoak';
  END CASE;
  SELECT COALESCE(array_agg(id_partida),'{}'::integer[]) INTO v_matches FROM public.partidak
    WHERE id_taldea=v_team AND left(data_ordua,10) BETWEEN v_start::text AND v_today::text;
  SELECT COALESCE(array_agg(id_saio),'{}'::integer[]) INTO v_sessions FROM public.saioak
    WHERE id_taldea=v_team AND left(data_ordua,10) BETWEEN v_start::text AND v_today::text;
  RETURN jsonb_build_object('enabled',true,'today',v_today,'tables',jsonb_build_object(
    'jokalariak',(SELECT jsonb_build_array(jsonb_build_object('id_jokalaria',j.id_jokalaria,
      'izena',j.izena,'abizena',j.abizena,'dortsala',j.dortsala,'posizioa',j.posizioa)) FROM public.jokalariak j WHERE j.id_jokalaria=v_player),
    'partidak',COALESCE((SELECT jsonb_agg(jsonb_build_object('id_partida',m.id_partida,'data_ordua',m.data_ordua,
      'aurkaria',m.aurkaria,'lekua',m.lekua,'estatistika_aurreratuak',m.estatistika_aurreratuak)) FROM public.partidak m WHERE m.id_partida=ANY(v_matches)),'[]'::jsonb),
    'partida_jokalariak',COALESCE((SELECT jsonb_agg(jsonb_build_object('id_partida',r.id_partida,
      'id_jokalaria',r.id_jokalaria,'golak',r.golak,'jaurtiketak',r.jaurtiketak)) FROM public.partida_jokalariak r WHERE r.id_partida=ANY(v_matches)),'[]'::jsonb),
    'partidu_zigorrak',COALESCE((SELECT jsonb_agg(jsonb_build_object('id_partida',r.id_partida,
      'id_jokalaria',r.id_jokalaria,'mota',r.mota)) FROM public.partidu_zigorrak r WHERE r.id_partida=ANY(v_matches)),'[]'::jsonb),
    'partidu_jaurtiketak',COALESCE((SELECT jsonb_agg(jsonb_build_object('id_partida',r.id_partida,
      'id_jokalaria',r.id_jokalaria,'mota',r.mota,'taldea',r.taldea,'minutua',r.minutua,
      'jatorri_x',r.jatorri_x,'jatorri_y',r.jatorri_y,'helburu_x',r.helburu_x,'helburu_y',r.helburu_y))
      FROM public.partidu_jaurtiketak r WHERE r.id_partida=ANY(v_matches) AND r.id_jokalaria=v_player),'[]'::jsonb),
    'saioak',COALESCE((SELECT jsonb_agg(jsonb_build_object('id_saio',s.id_saio,'data_ordua',s.data_ordua))
      FROM public.saioak s WHERE s.id_saio=ANY(v_sessions)),'[]'::jsonb),
    'saio_bertaratzea',COALESCE((SELECT jsonb_agg(jsonb_build_object('id_saio',r.id_saio,
      'id_jokalaria',r.id_jokalaria,'bertaratu',r.bertaratu,'atzerapena_min',r.atzerapena_min))
      FROM public.saio_bertaratzea r WHERE r.id_saio=ANY(v_sessions) AND r.id_jokalaria=v_player),'[]'::jsonb)
  ));
END $$;
REVOKE ALL ON FUNCTION public.player_statistics_action(integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.player_statistics_action(integer,text,jsonb) TO service_role;
COMMIT;
