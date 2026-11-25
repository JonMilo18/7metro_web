BEGIN;
CREATE FUNCTION public.session_elapsed_minutes(p_details jsonb) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE v_row jsonb; v_previous jsonb; v_block integer=0; v_total integer=0; v_minutes integer;
BEGIN
 FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_details,'[]')) LOOP
  IF v_row->>'id_ariketa' IS NULL OR v_row->>'is_separator'='true' THEN
   v_total=v_total+v_block;v_block=0;v_previous=NULL;CONTINUE;
  END IF;
  v_minutes=GREATEST(COALESCE((v_row->>'iraupena_minutuak')::integer,0),0);
  IF v_previous IS NULL OR COALESCE(v_row->>'paraleloa','0') NOT IN ('1','true')
   OR COALESCE(v_row->>'taldea','')<>COALESCE(v_previous->>'taldea','') THEN
   v_total=v_total+v_block;v_block=v_minutes;
  ELSE v_block=GREATEST(v_block,v_minutes); END IF;
  v_previous=v_row;
 END LOOP;
 RETURN v_total+v_block;
END $$;
-- Keep template summaries consistent with the editor without changing stored drills.
DO $$ DECLARE v_original text;v_updated text;BEGIN
 v_original=pg_get_functiondef('public.session_template_action(integer,integer,text,jsonb,jsonb)'::regprocedure);
 v_updated=replace(v_original,'(SELECT COALESCE(sum((d->>''iraupena_minutuak'')::integer),0) FROM jsonb_array_elements(t.details)d WHERE d->>''id_ariketa'' IS NOT NULL)',
  'public.session_elapsed_minutes(t.details)');
 IF v_updated=v_original THEN RAISE EXCEPTION 'Template duration patch did not match';END IF;
 EXECUTE v_updated;
END $$;
REVOKE ALL ON FUNCTION public.session_elapsed_minutes(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.session_elapsed_minutes(jsonb) TO service_role;
COMMIT;
