BEGIN;
CREATE TABLE public.user_categories (
 user_id integer NOT NULL REFERENCES public.erabiltzaileak(id_erabiltzailea) ON DELETE CASCADE,
 category_id integer NOT NULL REFERENCES public.kategoriak(id_kategoria) ON DELETE CASCADE,
 origin text NOT NULL DEFAULT 'used' CHECK(origin IN ('created','legacy','used')),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,category_id)
);
ALTER TABLE public.user_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_categories FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.user_categories TO service_role;
-- Historic catalog entries had no author. Infer only from each author's own drills.
INSERT INTO public.user_categories(user_id,category_id,origin)
 SELECT DISTINCT a.id_erabiltzailea,l.kategoriak_id_kategoria,'legacy' FROM public.ariketak a
 JOIN public.kategoriak_has_ariketak l ON l.ariketak_id_ariketa=a.id_ariketa
 JOIN public.erabiltzaileak u ON u.id_erabiltzailea=a.id_erabiltzailea
 UNION SELECT DISTINCT a.id_erabiltzailea,a.id_kategoria,'legacy' FROM public.ariketak a
 JOIN public.erabiltzaileak u ON u.id_erabiltzailea=a.id_erabiltzailea WHERE a.id_kategoria IS NOT NULL
 ON CONFLICT DO NOTHING;

CREATE FUNCTION public.user_category_catalog(p_user_id integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id_kategoria',k.id_kategoria,'izena',k.izena) ORDER BY k.izena),'[]')
 FROM kategoriak k JOIN user_categories uc ON uc.category_id=k.id_kategoria WHERE uc.user_id=p_user_id
$$;
CREATE FUNCTION public.resolve_user_category_names(p_user_id integer,p_names text[],p_register boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_name text; v_category jsonb; v_result jsonb='[]'; v_existed boolean; v_id integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erabiltzaileak WHERE id_erabiltzailea=p_user_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Erabiltzailea ez da baliozkoa'; END IF;
 IF cardinality(p_names)>100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Kategoria gehiegi'; END IF;
 FOREACH v_name IN ARRAY COALESCE(p_names,ARRAY[]::text[]) LOOP
  SELECT EXISTS(SELECT 1 FROM kategoriak WHERE name_key=category_name_key(v_name)) INTO v_existed;
  v_category=resolve_category_names(ARRAY[v_name],true)->0; v_id=(v_category->>'id_kategoria')::integer;
  -- A legacy desktop catalog can contain everybody's old entries. Do not adopt it wholesale.
  IF p_register OR NOT v_existed THEN
   INSERT INTO user_categories(user_id,category_id,origin) VALUES(p_user_id,v_id,'created')
   ON CONFLICT(user_id,category_id) DO UPDATE SET origin='created';
  END IF;
  IF NOT v_result @> jsonb_build_array(jsonb_build_object('id_kategoria',v_id)) THEN v_result=v_result||jsonb_build_array(v_category); END IF;
 END LOOP;
 RETURN v_result;
END $$;
CREATE FUNCTION public.register_used_category() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO user_categories(user_id,category_id,origin)
 SELECT a.id_erabiltzailea,NEW.kategoriak_id_kategoria,'used' FROM ariketak a
 JOIN erabiltzaileak u ON u.id_erabiltzailea=a.id_erabiltzailea WHERE a.id_ariketa=NEW.ariketak_id_ariketa
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER register_used_category AFTER INSERT OR UPDATE ON public.kategoriak_has_ariketak FOR EACH ROW EXECUTE FUNCTION public.register_used_category();

CREATE OR REPLACE FUNCTION public.create_categorized_exercise(p_user_id integer,p_team_id integer,p_data jsonb,p_names text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_categories jsonb; v_id integer;
BEGIN
 PERFORM 1 FROM team_memberships WHERE team_id=p_team_id AND user_id=p_user_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='No team membership'; END IF;
 v_categories=resolve_category_names(p_names,false);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_categories)c WHERE NOT EXISTS(SELECT 1 FROM user_categories WHERE user_id=p_user_id AND category_id=(c->>'id_kategoria')::integer)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Aukeratutako kategoria ez dago zure zerrendan';
 END IF;
 INSERT INTO ariketak(izena,deskribapena,jokalari_kopurua,arbela_datuak,bideo_url,id_erabiltzailea,id_kategoria)
 VALUES(p_data->>'izena',p_data->>'deskribapena',(p_data->>'jokalari_kopurua')::integer,p_data->>'arbela_datuak',p_data->>'bideo_url',p_user_id,(v_categories->0->>'id_kategoria')::integer) RETURNING id_ariketa INTO v_id;
 INSERT INTO kategoriak_has_ariketak SELECT (c->>'id_kategoria')::integer,v_id FROM jsonb_array_elements(v_categories)c ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('id_ariketa',v_id);
END $$;
ALTER FUNCTION public.detach_user_category(integer,integer,text) RENAME TO detach_user_category_links;
CREATE FUNCTION public.detach_user_category(p_user_id integer,p_team_id integer,p_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
 v_result=detach_user_category_links(p_user_id,p_team_id,p_name);
 DELETE FROM user_categories uc USING kategoriak k WHERE uc.user_id=p_user_id AND uc.category_id=k.id_kategoria AND k.name_key=category_name_key(p_name);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.user_category_catalog(integer),public.resolve_user_category_names(integer,text[],boolean),public.register_used_category(),public.detach_user_category(integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.user_category_catalog(integer),public.resolve_user_category_names(integer,text[],boolean),public.detach_user_category(integer,integer,text) TO service_role;
COMMIT;
