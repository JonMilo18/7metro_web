BEGIN;

CREATE OR REPLACE FUNCTION public.player_portal_action(p_user_id integer,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_team integer; v_player integer; v_id integer; v_user integer; v_kind text; v_date text;
  v_invite public.portal_player_invites%ROWTYPE; v_ids integer[]; v_result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.erabiltzaileak WHERE id_erabiltzailea=p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Saioa iraungi da; hasi berriro';
  END IF;
  IF p_action='portal_bootstrap' THEN
    RETURN jsonb_build_object('ok',true,'coach',EXISTS(SELECT 1 FROM public.team_memberships WHERE user_id=p_user_id),
      'links',COALESCE((SELECT jsonb_agg(jsonb_build_object('player_id',l.player_id,'team_id',l.team_id,'team_name',t.izena,'name',j.izena,'surname',j.abizena,'number',j.dortsala))
        FROM public.portal_player_links l JOIN public.jokalariak j ON j.id_jokalaria=l.player_id AND j.id_taldea=l.team_id
        JOIN public.taldeak t ON t.id_taldea=l.team_id WHERE l.user_id=p_user_id),'[]'::jsonb),
      'invites',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'team_name',t.izena,'name',j.izena,'surname',j.abizena,'expires_at',i.expires_at))
        FROM public.portal_player_invites i JOIN public.jokalariak j ON j.id_jokalaria=i.player_id AND j.id_taldea=i.team_id
        JOIN public.taldeak t ON t.id_taldea=i.team_id WHERE i.user_id=p_user_id AND i.expires_at>now()),'[]'::jsonb));
  END IF;
  IF p_action='portal_invite_answer' THEN
    SELECT * INTO v_invite FROM public.portal_player_invites WHERE id=(p_payload->>'id')::bigint AND user_id=p_user_id FOR UPDATE;
    IF NOT FOUND OR v_invite.expires_at<=now() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Gonbidapena ez dago erabilgarri'; END IF;
    IF p_payload->>'accept'='true' THEN
      PERFORM 1 FROM public.jokalariak WHERE id_jokalaria=v_invite.player_id AND id_taldea=v_invite.team_id FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Gonbidapena ez dago erabilgarri'; END IF;
      INSERT INTO public.portal_player_links(player_id,team_id,user_id) VALUES(v_invite.player_id,v_invite.team_id,p_user_id);
    END IF;
    DELETE FROM public.portal_player_invites WHERE id=v_invite.id;
    RETURN jsonb_build_object('ok',true);
  END IF;

  IF p_action IN ('portal_coach_snapshot','portal_invite','portal_revoke','portal_publish_callup','portal_create_notice','portal_delete_notice') THEN
    v_team=(p_payload->>'team_id')::integer;
    PERFORM 1 FROM public.team_memberships WHERE team_id=v_team AND user_id=p_user_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Ez zara talde horretako kidea'; END IF;
    IF p_action='portal_invite' THEN
      v_player=(p_payload->>'player_id')::integer;
      PERFORM 1 FROM public.jokalariak WHERE id_jokalaria=v_player AND id_taldea=v_team FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Ez da taldeko jokalaria aurkitu'; END IF;
      IF EXISTS(SELECT 1 FROM public.portal_player_links WHERE player_id=v_player) THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Jokalariak kontua lotuta dauka jada'; END IF;
      SELECT id_erabiltzailea INTO v_user FROM public.erabiltzaileak WHERE izena=lower(trim(p_payload->>'username'));
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Jokalariak kontua sortu behar du lehenik'; END IF;
      INSERT INTO public.portal_player_invites(player_id,team_id,user_id) VALUES(v_player,v_team,v_user)
        ON CONFLICT(player_id) DO UPDATE SET user_id=excluded.user_id,team_id=excluded.team_id,expires_at=now()+interval '7 days';
    ELSIF p_action='portal_revoke' THEN
      v_player=(p_payload->>'player_id')::integer;
      DELETE FROM public.portal_player_invites WHERE player_id=v_player AND team_id=v_team;
      DELETE FROM public.portal_player_links WHERE player_id=v_player AND team_id=v_team;
    ELSIF p_action='portal_publish_callup' THEN
      v_id=(p_payload->>'match_id')::integer;
      PERFORM 1 FROM public.partidak WHERE id_partida=v_id AND id_taldea=v_team FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Ez da taldeko partida aurkitu'; END IF;
      IF jsonb_typeof(p_payload->'player_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'player_ids')>100 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Deialdiko jokalariak ez dira baliozkoak'; END IF;
      SELECT COALESCE(array_agg(DISTINCT x::integer),'{}'::integer[]) INTO v_ids FROM jsonb_array_elements_text(p_payload->'player_ids') x;
      IF EXISTS(SELECT 1 FROM unnest(v_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.jokalariak WHERE id_jokalaria=x AND id_taldea=v_team)) THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Deialdiko jokalariak ez dira taldekoak'; END IF;
      IF COALESCE(p_payload->>'meeting_time','')<>'' AND COALESCE(p_payload->>'meeting_time','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Data ez da baliozkoa'; END IF;
      IF COALESCE(p_payload->>'meeting_time','')<>'' THEN PERFORM (p_payload->>'meeting_time')::timestamp; END IF;
      -- Keep replies and notes for players who remain in the callup.
      DELETE FROM public.portal_event_responses r WHERE r.kind='match' AND r.event_id=v_id
        AND r.player_id IN (SELECT id_jokalaria FROM public.jokalariak WHERE id_taldea=v_team)
        AND NOT(r.player_id=ANY(v_ids));
      DELETE FROM public.portal_callups WHERE match_id=v_id AND NOT(player_id=ANY(v_ids));
      INSERT INTO public.portal_callups(match_id,player_id,meeting_time,meeting_place,note)
        SELECT v_id,x,COALESCE(p_payload->>'meeting_time',''),COALESCE(p_payload->>'meeting_place',''),COALESCE(p_payload->>'note','') FROM unnest(v_ids) x
        ON CONFLICT(match_id,player_id) DO UPDATE SET meeting_time=excluded.meeting_time,meeting_place=excluded.meeting_place,note=excluded.note,published_at=now();
    ELSIF p_action='portal_create_notice' THEN
      INSERT INTO public.portal_notices(team_id,title,body) VALUES(v_team,trim(p_payload->>'title'),trim(p_payload->>'body'));
    ELSIF p_action='portal_delete_notice' THEN
      DELETE FROM public.portal_notices WHERE id=(p_payload->>'id')::bigint AND team_id=v_team;
    ELSE
      RETURN jsonb_build_object('ok',true,
        'links',COALESCE((SELECT jsonb_agg(jsonb_build_object('player_id',l.player_id,'username',u.izena)) FROM public.portal_player_links l JOIN public.erabiltzaileak u ON u.id_erabiltzailea=l.user_id WHERE l.team_id=v_team),'[]'::jsonb),
        'invites',COALESCE((SELECT jsonb_agg(jsonb_build_object('player_id',i.player_id,'username',u.izena,'expires_at',i.expires_at)) FROM public.portal_player_invites i JOIN public.erabiltzaileak u ON u.id_erabiltzailea=i.user_id WHERE i.team_id=v_team AND i.expires_at>now()),'[]'::jsonb),
        'responses',COALESCE((SELECT jsonb_agg(to_jsonb(r)-'user_id') FROM public.portal_event_responses r JOIN public.jokalariak j ON j.id_jokalaria=r.player_id WHERE j.id_taldea=v_team),'[]'::jsonb),
        'callups',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.portal_callups c JOIN public.partidak m ON m.id_partida=c.match_id WHERE m.id_taldea=v_team),'[]'::jsonb),
        'notices',COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM (SELECT n.*,COALESCE((SELECT jsonb_agg(r.player_id) FROM public.portal_notice_reads r WHERE r.notice_id=n.id),'[]'::jsonb) AS readers FROM public.portal_notices n WHERE n.team_id=v_team ORDER BY created_at DESC,id DESC LIMIT 30) n),'[]'::jsonb));
    END IF;
    RETURN jsonb_build_object('ok',true);
  END IF;

  IF p_action IN ('portal_player_snapshot','portal_respond','portal_read_notice') THEN
    v_player=(p_payload->>'player_id')::integer;
    SELECT l.team_id INTO v_team FROM public.portal_player_links l JOIN public.jokalariak j ON j.id_jokalaria=l.player_id AND j.id_taldea=l.team_id
      WHERE l.player_id=v_player AND l.user_id=p_user_id FOR KEY SHARE OF l;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Ez duzu jokalari honen baimenik'; END IF;
    IF p_action='portal_respond' THEN
      v_kind=p_payload->>'kind'; v_id=(p_payload->>'event_id')::integer;
      IF v_kind='session' THEN SELECT data_ordua INTO v_date FROM public.saioak WHERE id_saio=v_id AND id_taldea=v_team;
      ELSIF v_kind='match' THEN SELECT m.data_ordua INTO v_date FROM public.partidak m JOIN public.portal_callups c ON c.match_id=m.id_partida AND c.player_id=v_player WHERE m.id_partida=v_id AND m.id_taldea=v_team;
      ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Jarduera ez da baliozkoa'; END IF;
      IF v_date IS NULL OR left(v_date,10)<to_char(current_date,'YYYY-MM-DD') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Jarduera ez dago erabilgarri'; END IF;
      INSERT INTO public.portal_event_responses(player_id,kind,event_id,user_id,response,note)
        VALUES(v_player,v_kind,v_id,p_user_id,p_payload->>'response',trim(COALESCE(p_payload->>'note','')))
        ON CONFLICT(player_id,kind,event_id) DO UPDATE SET user_id=excluded.user_id,response=excluded.response,note=excluded.note,updated_at=now();
    ELSIF p_action='portal_read_notice' THEN
      v_id=(p_payload->>'id')::integer;
      PERFORM 1 FROM public.portal_notices WHERE id=v_id AND team_id=v_team FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Abisua ez dago erabilgarri'; END IF;
      INSERT INTO public.portal_notice_reads(notice_id,player_id,user_id) VALUES(v_id,v_player,p_user_id)
        ON CONFLICT(notice_id,player_id) DO UPDATE SET user_id=excluded.user_id,read_at=now();
    ELSE
      RETURN jsonb_build_object('ok',true,
        'player',(SELECT jsonb_build_object('id',j.id_jokalaria,'name',j.izena,'surname',j.abizena,'number',j.dortsala,'position',j.posizioa,'team_name',t.izena) FROM public.jokalariak j JOIN public.taldeak t ON t.id_taldea=j.id_taldea WHERE j.id_jokalaria=v_player),
        'sessions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id_saio,'date',s.data_ordua,'place',s.lekua,'title',s.helburu_taktikoa) ORDER BY s.data_ordua) FROM public.saioak s WHERE s.id_taldea=v_team AND left(s.data_ordua,10) BETWEEN to_char(current_date-7,'YYYY-MM-DD') AND to_char(current_date+90,'YYYY-MM-DD')),'[]'::jsonb),
        'matches',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id_partida,'date',m.data_ordua,'place',m.lekua,'opponent',m.aurkaria,'callup',CASE WHEN c.player_id IS NULL THEN NULL ELSE jsonb_build_object('meeting_time',c.meeting_time,'meeting_place',c.meeting_place,'note',c.note) END) ORDER BY m.data_ordua) FROM public.partidak m LEFT JOIN public.portal_callups c ON c.match_id=m.id_partida AND c.player_id=v_player WHERE m.id_taldea=v_team AND left(m.data_ordua,10) BETWEEN to_char(current_date-7,'YYYY-MM-DD') AND to_char(current_date+90,'YYYY-MM-DD')),'[]'::jsonb),
        'responses',COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',r.kind,'event_id',r.event_id,'response',r.response,'note',r.note)) FROM public.portal_event_responses r WHERE r.player_id=v_player AND r.user_id=p_user_id),'[]'::jsonb),
        'notices',COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM (SELECT n.id,n.title,n.body,n.created_at,EXISTS(SELECT 1 FROM public.portal_notice_reads r WHERE r.notice_id=n.id AND r.player_id=v_player AND r.user_id=p_user_id) AS read FROM public.portal_notices n WHERE n.team_id=v_team ORDER BY n.created_at DESC,n.id DESC LIMIT 30) n),'[]'::jsonb));
    END IF;
    RETURN jsonb_build_object('ok',true);
  END IF;
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Ekintza ez da baliozkoa';
END;
$$;
REVOKE ALL ON FUNCTION public.player_portal_action(integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.player_portal_action(integer,text,jsonb) TO service_role;
COMMIT;
