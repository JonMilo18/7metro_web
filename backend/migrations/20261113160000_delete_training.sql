BEGIN;

-- Serialize responses against deletion because event_id is a polymorphic reference.
CREATE OR REPLACE FUNCTION public.check_session_response_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'session' THEN
    PERFORM 1 FROM public.saioak WHERE id_saio = NEW.event_id FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Jarduera ez dago erabilgarri';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_session_response_event() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER check_session_response_event BEFORE INSERT OR UPDATE ON public.portal_event_responses
  FOR EACH ROW EXECUTE FUNCTION public.check_session_response_event();

CREATE OR REPLACE FUNCTION public.delete_team_session(p_team_id integer, p_user_id integer, p_session_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.team_memberships
    WHERE team_id = p_team_id AND user_id = p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Ez zara talde horretako kidea';
  END IF;
  PERFORM 1 FROM public.saioak
    WHERE id_saio = p_session_id AND id_taldea = p_team_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Ez da taldeko entrenamendua aurkitu';
  END IF;
  DELETE FROM public.portal_event_responses WHERE kind = 'session' AND event_id = p_session_id;
  DELETE FROM public.saioak WHERE id_saio = p_session_id AND id_taldea = p_team_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_team_session(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_team_session(integer, integer, integer) TO service_role;

COMMIT;
