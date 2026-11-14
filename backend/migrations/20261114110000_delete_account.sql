BEGIN;

CREATE OR REPLACE FUNCTION public.account_deletion_preview(p_user_id integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('username',u.izena,'owned_teams',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',t.id_taldea,'name',t.izena,
      'recipient_id',recipient.user_id,'recipient_name',recipient.username,
      'members',(SELECT COALESCE(jsonb_agg(m.user_id ORDER BY m.user_id),'[]'::jsonb)
        FROM public.team_memberships m WHERE m.team_id=t.id_taldea)) ORDER BY t.id_taldea)
    FROM public.taldeak t LEFT JOIN LATERAL (
      SELECT m.user_id,e.izena AS username FROM public.team_memberships m
      JOIN public.erabiltzaileak e ON e.id_erabiltzailea=m.user_id
      LEFT JOIN public.team_invitations i ON i.team_id=m.team_id AND i.invited_user_id=m.user_id
      WHERE m.team_id=t.id_taldea AND m.user_id<>p_user_id
      ORDER BY COALESCE(i.created_at,m.created_at),m.created_at,m.user_id LIMIT 1
    ) recipient ON true WHERE t.id_erabiltzailea=p_user_id
  ),'[]'::jsonb)) FROM public.erabiltzaileak u WHERE u.id_erabiltzailea=p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.account_deletion_action(
  p_user_id integer,p_session_hash text,p_action text,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_username text; v_password text; v_valid boolean := false; v_preview jsonb; v_team jsonb; v_table text;
BEGIN
  SELECT izena,pasahitza INTO v_username,v_password FROM public.erabiltzaileak WHERE id_erabiltzailea=p_user_id FOR UPDATE;
  PERFORM 1 FROM public.api_sessions WHERE user_id=p_user_id AND token_hash=p_session_hash
    AND expires_at>extract(epoch FROM now()) FOR UPDATE;
  IF v_username IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Saioa iraungi da; hasi berriro';
  END IF;
  IF p_action='account_delete_preview' THEN
    RETURN jsonb_build_object('ok',true,'user',jsonb_build_object('id_erabiltzailea',p_user_id,'izena',v_username),
      'preview',public.account_deletion_preview(p_user_id));
  END IF;
  IF p_action IS DISTINCT FROM 'account_delete' OR p_payload->>'confirmation' IS DISTINCT FROM v_username THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Baieztatzeko, idatzi zure erabiltzaile-izena';
  END IF;
  IF length(COALESCE(p_payload->>'current_password','')) NOT BETWEEN 1 AND 1024 THEN
    RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='Oraingo pasahitza ez da zuzena';
  END IF;
  IF left(v_password,4) IN ('$2a$','$2b$','$2y$') THEN
    IF octet_length(p_payload->>'current_password')<=72 THEN
      v_valid:=extensions.crypt(p_payload->>'current_password',v_password)=v_password;
    END IF;
  ELSIF v_password ~ '^[0-9a-fA-F]{64}$' THEN
    v_valid:=lower(v_password)=encode(extensions.digest(convert_to(p_payload->>'current_password','UTF8'),'sha256'),'hex');
  ELSE
    v_valid:=v_password=p_payload->>'current_password';
  END IF;
  IF v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='Oraingo pasahitza ez da zuzena';
  END IF;
  PERFORM 1 FROM public.taldeak WHERE id_erabiltzailea=p_user_id ORDER BY id_taldea FOR UPDATE;
  PERFORM 1 FROM public.team_memberships WHERE team_id IN (
    SELECT id_taldea FROM public.taldeak WHERE id_erabiltzailea=p_user_id
  ) ORDER BY team_id,user_id FOR UPDATE;
  v_preview:=public.account_deletion_preview(p_user_id);
  IF v_preview IS DISTINCT FROM p_payload->'preview' THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Taldeen egoera aldatu da. Itxi eta ireki berriro kontua ezabatzeko aukera';
  END IF;
  FOR v_team IN SELECT value FROM jsonb_array_elements(v_preview->'owned_teams') LOOP
    IF v_team->>'recipient_id' IS NOT NULL THEN
      UPDATE public.taldeak SET id_erabiltzailea=(v_team->>'recipient_id')::integer WHERE id_taldea=(v_team->>'id')::integer;
      UPDATE public.team_memberships SET role='owner' WHERE team_id=(v_team->>'id')::integer AND user_id=(v_team->>'recipient_id')::integer;
    ELSE
      -- Exercises are account-wide and can also be referenced by other teams.
      UPDATE public.ariketak SET id_taldea=NULL WHERE id_taldea=(v_team->>'id')::integer;
      DELETE FROM public.portal_event_responses WHERE
        (kind='session' AND event_id IN (SELECT id_saio FROM public.saioak WHERE id_taldea=(v_team->>'id')::integer)) OR
        (kind='match' AND event_id IN (SELECT id_partida FROM public.partidak WHERE id_taldea=(v_team->>'id')::integer));
      INSERT INTO public.team_memberships(team_id,user_id,role) VALUES((v_team->>'id')::integer,p_user_id,'owner')
        ON CONFLICT(team_id,user_id) DO UPDATE SET role='owner';
      PERFORM public.delete_team_owned((v_team->>'id')::integer,p_user_id);
    END IF;
  END LOOP;
  -- Keep the data of surviving shared teams under their current owner.
  FOREACH v_table IN ARRAY ARRAY['jokalariak','plangintzak','progresioak','makrozikloak','mikrozikloak','saioak','partidak','txapelketak'] LOOP
    EXECUTE format('UPDATE public.%I d SET id_erabiltzailea=t.id_erabiltzailea FROM public.taldeak t WHERE d.id_taldea=t.id_taldea AND d.id_erabiltzailea=$1',v_table) USING p_user_id;
  END LOOP;
  DELETE FROM public.portal_event_responses WHERE
    (kind='session' AND event_id IN (SELECT id_saio FROM public.saioak WHERE id_erabiltzailea=p_user_id)) OR
    (kind='match' AND event_id IN (SELECT id_partida FROM public.partidak WHERE id_erabiltzailea=p_user_id));
  DELETE FROM public.saio_plangintzak WHERE id_saio IN (SELECT id_saio FROM public.saioak WHERE id_erabiltzailea=p_user_id)
    OR id_plangintza IN (SELECT id_plangintza FROM public.plangintzak WHERE id_erabiltzailea=p_user_id);
  DELETE FROM public.partida_plangintzak WHERE id_partida IN (SELECT id_partida FROM public.partidak WHERE id_erabiltzailea=p_user_id)
    OR id_plangintza IN (SELECT id_plangintza FROM public.plangintzak WHERE id_erabiltzailea=p_user_id);
  DELETE FROM public.partidak WHERE id_erabiltzailea=p_user_id;
  DELETE FROM public.saioak WHERE id_erabiltzailea=p_user_id;
  DELETE FROM public.txapelketak WHERE id_erabiltzailea=p_user_id;
  DELETE FROM public.mikrozikloak WHERE id_erabiltzailea=p_user_id;
  DELETE FROM public.makrozikloak WHERE id_erabiltzailea=p_user_id;
  DELETE FROM public.plangintzak WHERE id_erabiltzailea=p_user_id;
  DELETE FROM public.progresioak WHERE id_erabiltzailea=p_user_id;
  DELETE FROM public.jokalariak WHERE id_erabiltzailea=p_user_id;
  -- Retain exercises already used or saved by other people, without the deleted author.
  UPDATE public.ariketak a SET id_erabiltzailea=NULL WHERE a.id_erabiltzailea=p_user_id AND (
    EXISTS(SELECT 1 FROM public.saio_xehetasuna d WHERE d.id_ariketa=a.id_ariketa) OR
    EXISTS(SELECT 1 FROM public.progresioak_has_ariketak d WHERE d.ariketak_id_ariketa=a.id_ariketa) OR
    EXISTS(SELECT 1 FROM public.exercise_saves s WHERE s.exercise_id=a.id_ariketa AND s.saved_by<>p_user_id) OR
    a.id_taldea IS NOT NULL);
  DELETE FROM public.ariketak WHERE id_erabiltzailea=p_user_id;
  DELETE FROM public.api_sessions WHERE user_id=p_user_id;
  DELETE FROM public.erabiltzaileak WHERE id_erabiltzailea=p_user_id;
  RETURN jsonb_build_object('ok',true);
END;
$$;

REVOKE ALL ON FUNCTION public.account_deletion_preview(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_action(integer,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_preview(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_action(integer,text,text,jsonb) TO service_role;
COMMIT;
