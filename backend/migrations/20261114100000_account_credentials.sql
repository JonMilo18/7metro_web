BEGIN;

CREATE OR REPLACE FUNCTION public.update_account_credentials(
  p_user_id integer, p_session_hash text, p_current_password text,
  p_expected_username text, p_username text, p_new_password text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_user public.erabiltzaileak%ROWTYPE;
  v_username text := lower(trim(COALESCE(p_username, '')));
  v_valid boolean := false;
BEGIN
  IF length(v_username) < 3 OR length(v_username) > 200
    OR p_current_password IS NULL OR length(p_current_password) = 0 OR length(p_current_password) > 1024
    OR p_expected_username IS NULL
    OR (p_new_password IS NOT NULL AND (length(p_new_password) < 8 OR octet_length(p_new_password) > 72)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kontuaren datuak ez dira baliozkoak';
  END IF;
  SELECT * INTO v_user FROM public.erabiltzaileak WHERE id_erabiltzailea = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Saioa iraungi da; hasi berriro';
  END IF;
  PERFORM 1 FROM public.api_sessions WHERE user_id = p_user_id AND token_hash = p_session_hash
    AND expires_at > extract(epoch FROM now()) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Saioa iraungi da; hasi berriro';
  END IF;
  IF left(v_user.pasahitza, 4) IN ('$2a$', '$2b$', '$2y$') THEN
    v_valid := extensions.crypt(p_current_password, v_user.pasahitza) = v_user.pasahitza;
  ELSIF v_user.pasahitza ~ '^[0-9a-fA-F]{64}$' THEN
    v_valid := lower(v_user.pasahitza) = encode(extensions.digest(convert_to(p_current_password, 'UTF8'), 'sha256'), 'hex');
  ELSE
    v_valid := v_user.pasahitza = p_current_password;
  END IF;
  IF v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Oraingo pasahitza ez da zuzena';
  END IF;
  IF v_user.izena IS DISTINCT FROM p_expected_username THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Kontua beste gailu batean aldatu da. Itxi eta ireki berriro kontuaren ezarpenak';
  END IF;
  -- Use the same name lock as registration so simultaneous signup and renames stay unique.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_username, 0));
  IF EXISTS(SELECT 1 FROM public.erabiltzaileak WHERE lower(izena) = v_username AND id_erabiltzailea <> p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Erabiltzaile-izen hori erabilita dago';
  END IF;
  UPDATE public.erabiltzaileak SET izena = v_username,
    pasahitza = CASE WHEN p_new_password IS NULL THEN pasahitza
      ELSE extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)) END
    WHERE id_erabiltzailea = p_user_id;
  IF p_new_password IS NOT NULL THEN
    DELETE FROM public.api_sessions WHERE user_id = p_user_id AND token_hash <> p_session_hash;
  END IF;
  RETURN jsonb_build_object('ok', true, 'user', jsonb_build_object('id_erabiltzailea', p_user_id, 'izena', v_username));
END;
$$;

REVOKE ALL ON FUNCTION public.update_account_credentials(integer,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_account_credentials(integer,text,text,text,text,text) TO service_role;

COMMIT;
