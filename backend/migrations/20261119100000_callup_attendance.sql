BEGIN;
CREATE OR REPLACE FUNCTION public.apply_session_response_attendance(p_team_id integer,p_user_id integer,p_session_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_rows jsonb; v_confirmed integer; v_copied integer;
BEGIN
  PERFORM 1 FROM public.team_memberships WHERE team_id=p_team_id AND user_id=p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Ez zara talde horretako kidea'; END IF;
  PERFORM 1 FROM public.saioak WHERE id_saio=p_session_id AND id_taldea=p_team_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Ez da taldeko entrenamendua aurkitu'; END IF;
  SELECT count(*) INTO v_confirmed FROM public.portal_event_responses r
    JOIN public.jokalariak j ON j.id_jokalaria=r.player_id AND j.id_taldea=p_team_id
    JOIN public.portal_player_links l ON l.player_id=j.id_jokalaria AND l.team_id=p_team_id AND l.user_id=r.user_id
    WHERE r.kind='session' AND r.event_id=p_session_id AND r.response IN ('yes','no');
  WITH inserted AS (
    INSERT INTO public.saio_bertaratzea(id_saio,id_jokalaria,bertaratu,atzerapena_min,atzerapena_mota)
    SELECT p_session_id,r.player_id,CASE r.response WHEN 'yes' THEN 1 ELSE 0 END,0,''
    FROM public.portal_event_responses r
    JOIN public.jokalariak j ON j.id_jokalaria=r.player_id AND j.id_taldea=p_team_id
    JOIN public.portal_player_links l ON l.player_id=j.id_jokalaria AND l.team_id=p_team_id AND l.user_id=r.user_id
    WHERE r.kind='session' AND r.event_id=p_session_id AND r.response IN ('yes','no')
    ON CONFLICT(id_saio,id_jokalaria) DO NOTHING RETURNING *
  ) SELECT COALESCE(jsonb_agg(to_jsonb(inserted)),'[]'::jsonb) INTO v_rows FROM inserted;
  v_copied=jsonb_array_length(v_rows);
  SELECT COALESCE(jsonb_agg(to_jsonb(a)),'[]'::jsonb) INTO v_rows FROM public.saio_bertaratzea a
    JOIN public.jokalariak j ON j.id_jokalaria=a.id_jokalaria AND j.id_taldea=p_team_id WHERE a.id_saio=p_session_id;
  RETURN jsonb_build_object('ok',true,'copied',v_copied,'preserved',v_confirmed-v_copied,'rows',v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_session_response_attendance(integer,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_session_response_attendance(integer,integer,integer) TO service_role;
COMMIT;
