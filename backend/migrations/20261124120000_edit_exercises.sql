BEGIN;
CREATE FUNCTION public.edit_owned_exercise(p_user_id integer,p_team_id integer,p_action text,p_id integer,p_data jsonb DEFAULT NULL,p_expected jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_exercise ariketak%ROWTYPE; v_links jsonb; v_categories jsonb; v_primary integer;
BEGIN
 PERFORM 1 FROM team_memberships WHERE team_id=p_team_id AND user_id=p_user_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Ez zara talde horretako kidea'; END IF;
 SELECT * INTO v_exercise FROM ariketak WHERE id_ariketa=p_id AND id_erabiltzailea=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Ez da zure ariketa aurkitu'; END IF;
 SELECT COALESCE(jsonb_agg(kategoriak_id_kategoria ORDER BY kategoriak_id_kategoria),'[]') INTO v_links FROM kategoriak_has_ariketak WHERE ariketak_id_ariketa=p_id;
 IF p_action='get' THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id_kategoria',k.id_kategoria,'izena',k.izena) ORDER BY k.id_kategoria),'[]') INTO v_categories
   FROM kategoriak k WHERE k.id_kategoria IN(SELECT kategoriak_id_kategoria FROM kategoriak_has_ariketak WHERE ariketak_id_ariketa=p_id);
  RETURN jsonb_build_object('ok',true,'exercise',to_jsonb(v_exercise),'categories',v_categories,'snapshot',jsonb_build_object('exercise',to_jsonb(v_exercise),'categories',v_links));
 END IF;
 IF p_action<>'update' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Ekintza ez da baliozkoa'; END IF;
 IF p_expected IS DISTINCT FROM jsonb_build_object('exercise',to_jsonb(v_exercise),'categories',v_links) THEN
  RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Ariketa beste gailu batean aldatu da. Birkargatu editatu aurretik';
 END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR btrim(COALESCE(p_data->>'izena',''))='' OR length(p_data->>'izena')>140
 OR (p_data->>'jokalari_kopurua' IS NOT NULL AND (p_data->>'jokalari_kopurua')::integer NOT BETWEEN 1 AND 100)
 OR jsonb_typeof(p_data->'categories') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'categories')>100 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Ariketaren datuak ez dira baliozkoak';
 END IF;
 SELECT resolve_category_names(ARRAY(SELECT jsonb_array_elements_text(p_data->'categories')),false) INTO v_categories;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_categories)c WHERE NOT EXISTS(SELECT 1 FROM user_categories WHERE user_id=p_user_id AND category_id=(c->>'id_kategoria')::integer)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Aukeratutako kategoria ez dago zure zerrendan';
 END IF;
 v_primary=(v_categories->0->>'id_kategoria')::integer;
 DELETE FROM kategoriak_has_ariketak WHERE ariketak_id_ariketa=p_id;
 UPDATE ariketak SET izena=p_data->>'izena',deskribapena=p_data->>'deskribapena',jokalari_kopurua=(p_data->>'jokalari_kopurua')::integer,
  bideo_url=p_data->>'bideo_url',arbela_datuak=p_data->>'arbela_datuak',id_kategoria=v_primary,kategoria=NULL
  WHERE id_ariketa=p_id;
 INSERT INTO kategoriak_has_ariketak SELECT (c->>'id_kategoria')::integer,p_id FROM jsonb_array_elements(v_categories)c ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('ok',true,'id',p_id,'exercise',(SELECT to_jsonb(a) FROM ariketak a WHERE id_ariketa=p_id));
END $$;
REVOKE ALL ON FUNCTION public.edit_owned_exercise(integer,integer,text,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_owned_exercise(integer,integer,text,integer,jsonb,jsonb) TO service_role;
COMMIT;
