BEGIN;
LOCK TABLE public.kategoriak,public.ariketak,public.kategoriak_has_ariketak IN SHARE ROW EXCLUSIVE MODE;
CREATE OR REPLACE FUNCTION public.category_name_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
 SELECT regexp_replace(normalize(lower(regexp_replace(btrim(value),'[[:space:]]+',' ','g')),NFD),U&'[\0300-\036f]','','g')
$$;

-- Preserve the semantic association set, including both legacy representations.
CREATE TEMP TABLE category_expected ON COMMIT DROP AS
 SELECT a.ariketak_id_ariketa exercise_id,public.category_name_key(k.izena) name_key
 FROM public.kategoriak_has_ariketak a JOIN public.kategoriak k ON k.id_kategoria=a.kategoriak_id_kategoria
 UNION SELECT a.id_ariketa,public.category_name_key(k.izena)
 FROM public.ariketak a JOIN public.kategoriak k ON k.id_kategoria=a.id_kategoria
 UNION SELECT a.id_ariketa,public.category_name_key(COALESCE(k.izena,a.kategoria))
 FROM public.ariketak a LEFT JOIN public.kategoriak k ON k.id_kategoria::text=btrim(a.kategoria)
 WHERE NULLIF(btrim(a.kategoria),'') IS NOT NULL;
CREATE TEMP TABLE category_exercise_count ON COMMIT DROP AS SELECT count(*) n FROM public.ariketak;
SELECT setval(pg_get_serial_sequence('public.kategoriak','id_kategoria'),
 GREATEST((SELECT COALESCE(max(id_kategoria),1) FROM public.kategoriak),(SELECT last_value FROM public.kategoriak_id_kategoria_seq)),true);
INSERT INTO public.kategoriak(izena)
 SELECT min(regexp_replace(btrim(a.kategoria),'[[:space:]]+',' ','g')) FROM public.ariketak a
 WHERE NULLIF(btrim(a.kategoria),'') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.kategoriak k WHERE k.id_kategoria::text=btrim(a.kategoria)
 OR public.category_name_key(k.izena)=public.category_name_key(a.kategoria))
 GROUP BY public.category_name_key(a.kategoria);
CREATE TEMP TABLE category_mapping ON COMMIT DROP AS
 SELECT id_kategoria old_id,min(id_kategoria) OVER(PARTITION BY public.category_name_key(izena)) canonical_id FROM public.kategoriak;
CREATE TABLE public.category_id_aliases(old_id integer PRIMARY KEY,category_id integer NOT NULL REFERENCES public.kategoriak(id_kategoria));
ALTER TABLE public.category_id_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.category_id_aliases FROM anon,authenticated;
INSERT INTO public.category_id_aliases SELECT old_id,canonical_id FROM category_mapping WHERE old_id<>canonical_id;
INSERT INTO public.kategoriak_has_ariketak(kategoriak_id_kategoria,ariketak_id_ariketa)
 SELECT DISTINCT m.canonical_id,e.exercise_id FROM category_expected e JOIN public.kategoriak k ON public.category_name_key(k.izena)=e.name_key
 JOIN category_mapping m ON m.old_id=k.id_kategoria ON CONFLICT DO NOTHING;
UPDATE public.ariketak a SET id_kategoria=m.canonical_id FROM category_mapping m WHERE a.id_kategoria=m.old_id;
DELETE FROM public.kategoriak k USING category_mapping m WHERE k.id_kategoria=m.old_id AND m.old_id<>m.canonical_id;
UPDATE public.ariketak a SET kategoria=NULL,id_kategoria=COALESCE(a.id_kategoria,
 (SELECT min(kategoriak_id_kategoria) FROM public.kategoriak_has_ariketak WHERE ariketak_id_ariketa=a.id_ariketa));
UPDATE public.kategoriak SET izena=regexp_replace(btrim(izena),'[[:space:]]+',' ','g');
ALTER TABLE public.kategoriak ADD COLUMN name_key text GENERATED ALWAYS AS (public.category_name_key(izena)) STORED;
ALTER TABLE public.kategoriak ADD CONSTRAINT kategoriak_name_key_unique UNIQUE(name_key);
ALTER TABLE public.kategoriak ADD CONSTRAINT kategoriak_name_nonempty CHECK(name_key<>'');
ALTER TABLE public.ariketak ADD CONSTRAINT ariketak_category_fk FOREIGN KEY(id_kategoria) REFERENCES public.kategoriak(id_kategoria);
CREATE INDEX IF NOT EXISTS exercise_category_lookup ON public.kategoriak_has_ariketak(ariketak_id_ariketa,kategoriak_id_kategoria);
DO $$ BEGIN
 IF EXISTS(SELECT * FROM category_expected EXCEPT SELECT a.ariketak_id_ariketa,public.category_name_key(k.izena)
 FROM public.kategoriak_has_ariketak a JOIN public.kategoriak k ON k.id_kategoria=a.kategoriak_id_kategoria)
 OR (SELECT n FROM category_exercise_count)<>(SELECT count(*) FROM public.ariketak)
 THEN RAISE EXCEPTION 'Category migration lost data'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_category_names(p_names text[],p_create boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_name text; v_row kategoriak%ROWTYPE; v_result jsonb='[]';
BEGIN
 IF cardinality(p_names)>100 THEN RAISE EXCEPTION 'Too many categories'; END IF;
 FOREACH v_name IN ARRAY COALESCE(p_names,ARRAY[]::text[]) LOOP
  v_name=regexp_replace(btrim(v_name),'[[:space:]]+',' ','g');
  IF v_name IS NULL OR v_name='' OR length(v_name)>80 THEN RAISE EXCEPTION 'Invalid category name'; END IF;
  SELECT * INTO v_row FROM kategoriak WHERE name_key=category_name_key(v_name);
  IF NOT FOUND AND p_create THEN
   INSERT INTO kategoriak(izena) VALUES(v_name) ON CONFLICT(name_key) DO UPDATE SET izena=kategoriak.izena RETURNING * INTO v_row;
  ELSIF NOT FOUND THEN
   RAISE EXCEPTION 'Unknown category';
  END IF;
  IF NOT v_result @> jsonb_build_array(jsonb_build_object('id_kategoria',v_row.id_kategoria)) THEN
   v_result=v_result||jsonb_build_array(jsonb_build_object('id_kategoria',v_row.id_kategoria,'izena',v_row.izena));
  END IF;
 END LOOP;
 RETURN v_result;
END $$;

-- Accept retired remote IDs and legacy desktop text without duplicating the catalog.
CREATE OR REPLACE FUNCTION public.normalize_exercise_category() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_category jsonb;
BEGIN
 IF NULLIF(btrim(NEW.kategoria),'') IS NOT NULL THEN
  SELECT k.id_kategoria INTO NEW.id_kategoria FROM kategoriak k WHERE k.id_kategoria::text=btrim(NEW.kategoria);
  IF NEW.id_kategoria IS NULL THEN
   SELECT category_id INTO NEW.id_kategoria FROM category_id_aliases WHERE old_id::text=btrim(NEW.kategoria);
  END IF;
  IF NEW.id_kategoria IS NULL THEN
   v_category=resolve_category_names(ARRAY[NEW.kategoria],true);
   NEW.id_kategoria=(v_category->0->>'id_kategoria')::integer;
  END IF;
 END IF;
 NEW.id_kategoria=COALESCE((SELECT category_id FROM category_id_aliases WHERE old_id=NEW.id_kategoria),NEW.id_kategoria);
 NEW.kategoria=NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER normalize_exercise_category BEFORE INSERT OR UPDATE OF id_kategoria,kategoria ON public.ariketak
 FOR EACH ROW EXECUTE FUNCTION public.normalize_exercise_category();
CREATE OR REPLACE FUNCTION public.link_primary_exercise_category() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.id_kategoria IS NOT NULL THEN
  INSERT INTO kategoriak_has_ariketak VALUES(NEW.id_kategoria,NEW.id_ariketa) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER link_primary_exercise_category AFTER INSERT OR UPDATE OF id_kategoria ON public.ariketak
 FOR EACH ROW EXECUTE FUNCTION public.link_primary_exercise_category();
CREATE OR REPLACE FUNCTION public.normalize_category_link() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 NEW.kategoriak_id_kategoria=COALESCE((SELECT category_id FROM category_id_aliases WHERE old_id=NEW.kategoriak_id_kategoria),NEW.kategoriak_id_kategoria);
 RETURN NEW;
END $$;
CREATE TRIGGER normalize_category_link BEFORE INSERT OR UPDATE ON public.kategoriak_has_ariketak
 FOR EACH ROW EXECUTE FUNCTION public.normalize_category_link();

CREATE OR REPLACE FUNCTION public.create_categorized_exercise(p_user_id integer,p_team_id integer,p_data jsonb,p_names text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_categories jsonb; v_id integer;
BEGIN
 PERFORM 1 FROM team_memberships WHERE team_id=p_team_id AND user_id=p_user_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='No team membership'; END IF;
 v_categories=resolve_category_names(p_names,false);
 INSERT INTO ariketak(izena,deskribapena,jokalari_kopurua,arbela_datuak,bideo_url,id_erabiltzailea,id_kategoria)
 VALUES(p_data->>'izena',p_data->>'deskribapena',(p_data->>'jokalari_kopurua')::integer,
 p_data->>'arbela_datuak',p_data->>'bideo_url',p_user_id,(v_categories->0->>'id_kategoria')::integer) RETURNING id_ariketa INTO v_id;
 INSERT INTO kategoriak_has_ariketak SELECT (c->>'id_kategoria')::integer,v_id FROM jsonb_array_elements(v_categories)c ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('id_ariketa',v_id);
END $$;
CREATE OR REPLACE FUNCTION public.detach_user_category(p_user_id integer,p_team_id integer,p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id integer; v_count integer;
BEGIN
 PERFORM 1 FROM team_memberships WHERE team_id=p_team_id AND user_id=p_user_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='No team membership'; END IF;
 SELECT id_kategoria INTO v_id FROM kategoriak WHERE name_key=category_name_key(p_name);
 PERFORM 1 FROM ariketak WHERE id_erabiltzailea=p_user_id ORDER BY id_ariketa FOR UPDATE;
 DELETE FROM kategoriak_has_ariketak l USING ariketak a WHERE l.ariketak_id_ariketa=a.id_ariketa
 AND a.id_erabiltzailea=p_user_id AND l.kategoriak_id_kategoria=v_id;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 UPDATE ariketak a SET id_kategoria=(SELECT min(kategoriak_id_kategoria) FROM kategoriak_has_ariketak WHERE ariketak_id_ariketa=a.id_ariketa)
 WHERE a.id_erabiltzailea=p_user_id AND a.id_kategoria=v_id;
 RETURN jsonb_build_object('deleted',v_count);
END $$;
REVOKE ALL ON FUNCTION public.resolve_category_names(text[],boolean),public.create_categorized_exercise(integer,integer,jsonb,text[]),public.detach_user_category(integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_category_names(text[],boolean),public.create_categorized_exercise(integer,integer,jsonb,text[]),public.detach_user_category(integer,integer,text) TO service_role;
COMMIT;
