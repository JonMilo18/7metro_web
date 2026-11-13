BEGIN;

CREATE TABLE public.team_training_schedules (
  team_id integer PRIMARY KEY REFERENCES public.taldeak(id_taldea) ON DELETE CASCADE,
  slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.team_training_publications (
  team_id integer NOT NULL REFERENCES public.taldeak(id_taldea) ON DELETE CASCADE,
  scheduled_at text NOT NULL,
  session_id integer REFERENCES public.saioak(id_saio) ON DELETE SET NULL,
  PRIMARY KEY(team_id,scheduled_at)
);
ALTER TABLE public.team_training_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_training_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_training_schedules,public.team_training_publications FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.team_training_schedules,public.team_training_publications TO service_role;

CREATE FUNCTION public.weekly_training_action(p_user integer,p_team integer,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_schedule public.team_training_schedules%ROWTYPE;
  v_slots jsonb;
  v_slot jsonb;
  v_week date;
  v_date text;
  v_id integer;
  v_ids jsonb := '[]'::jsonb;
  v_skipped integer := 0;
BEGIN
  PERFORM 1 FROM public.team_memberships WHERE user_id=p_user AND team_id=p_team FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Ez zara talde horretako kidea';
  END IF;
  IF p_action NOT IN ('get','save','publish') OR p_action IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Datuak ez dira baliozkoak';
  END IF;
  IF COALESCE(p_data->>'week_start','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Aukeratu aste bat';
  END IF;
  BEGIN
    v_week := (p_data->>'week_start')::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Aukeratu aste bat';
  END;
  IF extract(isodow FROM v_week)<>1 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Aukeratu aste bat';
  END IF;

  INSERT INTO public.team_training_schedules(team_id) VALUES(p_team) ON CONFLICT DO NOTHING;
  -- Serialize publication and schedule changes for this team, including retries.
  SELECT * INTO v_schedule FROM public.team_training_schedules WHERE team_id=p_team FOR UPDATE;
  IF p_action<>'get' AND (p_data->>'version') IS DISTINCT FROM v_schedule.version::text THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Ordutegia beste gailu batean aldatu da. Birkargatu ordutegia';
  END IF;
  IF p_action='save' THEN
    v_slots := p_data->'slots';
    IF jsonb_typeof(v_slots) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Ordutegiaren datuak ez dira baliozkoak';
    END IF;
    IF jsonb_array_length(v_slots)>28 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Gehienez 28 entrenamendu sar daitezke astean';
    END IF;
    FOR v_slot IN SELECT value FROM jsonb_array_elements(v_slots) LOOP
      IF jsonb_typeof(v_slot) IS DISTINCT FROM 'object'
        OR COALESCE(v_slot->>'weekday','') !~ '^[1-7]$'
        OR COALESCE(v_slot->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR jsonb_typeof(v_slot->'lekua') IS DISTINCT FROM 'string'
        OR length(btrim(COALESCE(v_slot->>'lekua','')))=0 OR length(v_slot->>'lekua')>250
        OR jsonb_typeof(v_slot->'helburu_taktikoa') IS DISTINCT FROM 'string'
        OR length(v_slot->>'helburu_taktikoa')>250 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Ordutegiaren datuak ez dira baliozkoak';
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_slots) s GROUP BY s->>'weekday',s->>'time' HAVING count(*)>1) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Egun eta ordu bereko entrenamendua errepikatuta dago';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('weekday',(s->>'weekday')::integer,'time',s->>'time',
      'lekua',btrim(s->>'lekua'),'helburu_taktikoa',btrim(s->>'helburu_taktikoa'))
      ORDER BY (s->>'weekday')::integer,s->>'time'),'[]'::jsonb) INTO v_slots FROM jsonb_array_elements(v_slots) s;
    UPDATE public.team_training_schedules SET slots=v_slots,version=version+1,updated_at=now()
      WHERE team_id=p_team RETURNING * INTO v_schedule;
  ELSIF p_action='publish' THEN
    IF jsonb_array_length(v_schedule.slots)=0 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Gorde ohiko ordutegia lehenik';
    END IF;
    FOR v_slot IN SELECT value FROM jsonb_array_elements(v_schedule.slots) LOOP
      v_date := to_char(v_week+(v_slot->>'weekday')::integer-1,'YYYY-MM-DD')||'T'||(v_slot->>'time');
      SELECT session_id INTO v_id FROM public.team_training_publications WHERE team_id=p_team AND scheduled_at=v_date;
      IF v_id IS NULL THEN
        SELECT id_saio INTO v_id FROM public.saioak WHERE id_taldea=p_team
          AND replace(left(data_ordua,16),' ','T')=v_date ORDER BY id_saio LIMIT 1;
      END IF;
      IF v_id IS NULL THEN
        INSERT INTO public.saioak(id_taldea,id_erabiltzailea,data_ordua,lekua,helburu_taktikoa,rpe_aurreikusia)
        VALUES(p_team,p_user,v_date,v_slot->>'lekua',NULLIF(v_slot->>'helburu_taktikoa',''),5)
        RETURNING id_saio INTO v_id;
        v_ids := v_ids||jsonb_build_array(v_id);
      ELSE
        v_skipped := v_skipped+1;
      END IF;
      INSERT INTO public.team_training_publications(team_id,scheduled_at,session_id) VALUES(p_team,v_date,v_id)
        ON CONFLICT(team_id,scheduled_at) DO UPDATE SET session_id=excluded.session_id;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('slots',v_schedule.slots,'version',v_schedule.version,
    'created_ids',v_ids,'skipped',v_skipped,'publications',COALESCE((SELECT jsonb_agg(
      jsonb_build_object('scheduled_at',p.scheduled_at,'session_id',p.session_id))
      FROM public.team_training_publications p WHERE p.team_id=p_team AND p.session_id IS NOT NULL
      AND left(p.scheduled_at,10)>=v_week::text AND left(p.scheduled_at,10)<(v_week+7)::text),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.weekly_training_action(integer,integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_training_action(integer,integer,text,jsonb) TO service_role;
COMMIT;
