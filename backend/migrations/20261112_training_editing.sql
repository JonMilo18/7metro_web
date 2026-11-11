-- Save a training and all its details together; attendance and planning links stay intact.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_team_session(
  p_team_id INTEGER, p_user_id INTEGER, p_source_id INTEGER, p_duplicate BOOLEAN,
  p_session JSONB, p_details JSONB, p_expected JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.saioak%ROWTYPE;
  v_details JSONB;
  v_id INTEGER;
  v_micro INTEGER;
BEGIN
  PERFORM 1 FROM public.team_memberships
    WHERE team_id = p_team_id AND user_id = p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Ez zara talde horretako kidea';
  END IF;
  SELECT * INTO v_source FROM public.saioak
    WHERE id_saio = p_source_id AND id_taldea = p_team_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Ez da taldeko entrenamendua aurkitu';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.ordena ASC NULLS LAST, d.id_xehetasuna), '[]'::JSONB)
    INTO v_details FROM public.saio_xehetasuna d WHERE d.id_saio = p_source_id;
  IF p_expected IS DISTINCT FROM jsonb_build_object('session', to_jsonb(v_source), 'details', v_details) THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'Entrenamendua beste gailu batean aldatu da. Birkargatu editatu aurretik';
  END IF;
  IF p_duplicate IS NULL OR jsonb_typeof(p_session) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_details) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_details) > 1000
    OR COALESCE(p_session->>'data_ordua', '') !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
    OR length(COALESCE(p_session->>'lekua', '')) > 250
    OR length(COALESCE(p_session->>'helburu_taktikoa', '')) > 250 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Entrenamenduaren data edo ariketa-zerrenda ez da baliozkoa';
  END IF;
  v_micro := (p_session->>'id_mikroziklo')::INTEGER;
  IF v_micro IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.mikrozikloak WHERE id_mikroziklo = v_micro AND id_taldea = p_team_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ez da taldeko mikrozikloa aurkitu';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_details) AS d(
      id_ariketa INTEGER, iraupena_minutuak INTEGER, taldea TEXT, aldaerak TEXT, paraleloa INTEGER
    ) WHERE d.iraupena_minutuak IS NULL OR d.iraupena_minutuak < 0 OR d.iraupena_minutuak > 999
      OR length(COALESCE(d.taldea, '')) > 60 OR length(COALESCE(d.aldaerak, '')) > 3000
      OR d.paraleloa IS NULL OR d.paraleloa NOT IN (0, 1)
      OR (d.id_ariketa IS NULL AND btrim(COALESCE(d.taldea, '')) = '')
      OR (d.id_ariketa IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.ariketak a WHERE a.id_ariketa = d.id_ariketa
          AND (a.id_erabiltzailea = p_user_id OR EXISTS (
            SELECT 1 FROM public.saio_xehetasuna old
              WHERE old.id_saio = p_source_id AND old.id_ariketa = a.id_ariketa
          ))
      ))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Entrenamenduaren data edo ariketa-zerrenda ez da baliozkoa';
  END IF;

  IF p_duplicate THEN
    INSERT INTO public.saioak (id_mikroziklo, data_ordua, lekua, rpe_aurreikusia,
      helburu_taktikoa, id_erabiltzailea, id_taldea)
    VALUES (v_micro, p_session->>'data_ordua', p_session->>'lekua', v_source.rpe_aurreikusia,
      p_session->>'helburu_taktikoa', p_user_id, p_team_id) RETURNING id_saio INTO v_id;
  ELSE
    v_id := p_source_id;
    UPDATE public.saioak SET id_mikroziklo = v_micro, data_ordua = p_session->>'data_ordua',
      lekua = p_session->>'lekua', helburu_taktikoa = p_session->>'helburu_taktikoa'
      WHERE id_saio = v_id AND id_taldea = p_team_id;
    DELETE FROM public.saio_xehetasuna WHERE id_saio = v_id;
  END IF;
  INSERT INTO public.saio_xehetasuna (id_saio, id_ariketa, ordena, iraupena_minutuak, taldea, aldaerak, paraleloa)
    SELECT v_id, (entry->>'id_ariketa')::INTEGER, position::INTEGER,
      (entry->>'iraupena_minutuak')::INTEGER, entry->>'taldea', entry->>'aldaerak',
      (entry->>'paraleloa')::INTEGER
    FROM jsonb_array_elements(p_details) WITH ORDINALITY AS items(entry, position);
  RETURN jsonb_build_object('id', v_id,
    'session', (SELECT to_jsonb(s) FROM public.saioak s WHERE s.id_saio = v_id),
    'details', (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.ordena, d.id_xehetasuna), '[]'::JSONB)
      FROM public.saio_xehetasuna d WHERE d.id_saio = v_id));
END;
$$;

REVOKE ALL ON FUNCTION public.save_team_session(INTEGER, INTEGER, INTEGER, BOOLEAN, JSONB, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_team_session(INTEGER, INTEGER, INTEGER, BOOLEAN, JSONB, JSONB, JSONB)
  TO service_role;

COMMIT;
