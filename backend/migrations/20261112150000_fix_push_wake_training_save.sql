BEGIN;
CREATE OR REPLACE FUNCTION public.push_wake_worker() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_token text;v_nonce uuid;v_timestamp bigint;v_signature text;
BEGIN
 IF current_setting('metro.push_woken',true)='1' THEN RETURN; END IF;
 DELETE FROM public.push_events WHERE created_at<now()-interval '7 days';
 DELETE FROM public.push_worker_wakes WHERE issued_at<extract(epoch FROM now())-180;
 DELETE FROM public.push_subscriptions s WHERE NOT EXISTS(SELECT 1 FROM public.api_sessions a WHERE a.token_hash=s.session_hash AND a.user_id=s.user_id AND a.expires_at>extract(epoch FROM now()));
 IF NOT EXISTS(SELECT 1 FROM public.push_deliveries WHERE state='queued' AND next_attempt<=now()) THEN RETURN; END IF;
 SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name='7metro_push_worker_token' LIMIT 1;
 IF v_token IS NULL THEN RETURN; END IF;
 PERFORM set_config('metro.push_woken','1',true);
 v_nonce=gen_random_uuid();v_timestamp=floor(extract(epoch FROM now()))::bigint;
 INSERT INTO public.push_worker_wakes(nonce,issued_at) VALUES(v_nonce,v_timestamp);
 v_signature=encode(extensions.hmac(v_timestamp::text||':'||v_nonce::text,v_token,'sha256'),'hex');
 -- pg_net's request queue may be readable by platform roles. Never put a reusable secret in it.
 PERFORM net.http_post(url:='https://txkjflrtoziscqcytpbc.supabase.co/functions/v1/metro-push',
  headers:=jsonb_build_object('Content-Type','application/json','x-7metro-push-signature',v_signature),
  body:=jsonb_build_object('nonce',v_nonce,'timestamp',v_timestamp),timeout_milliseconds:=60000);
END $$;
REVOKE ALL ON FUNCTION public.push_wake_worker() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.push_enqueue(p_user integer,p_kind text,p_target jsonb,p_key text,p_subscription bigint DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.push_subscriptions s JOIN public.api_sessions a ON a.token_hash=s.session_hash AND a.user_id=s.user_id
   WHERE s.user_id=p_user AND a.expires_at>extract(epoch FROM now()) AND (p_subscription IS NULL OR s.id=p_subscription)
   AND (p_kind='test' OR s.preferences->>p_kind='true')) THEN RETURN; END IF;
 INSERT INTO public.push_events(user_id,kind,target,dedupe_key) VALUES(p_user,p_kind,p_target,p_key)
 ON CONFLICT(user_id,dedupe_key) DO NOTHING RETURNING id INTO v_event;
 IF v_event IS NULL THEN RETURN; END IF;
 INSERT INTO public.push_deliveries(event_id,subscription_id)
 SELECT v_event,s.id FROM public.push_subscriptions s JOIN public.api_sessions a ON a.token_hash=s.session_hash AND a.user_id=s.user_id
 WHERE s.user_id=p_user AND a.expires_at>extract(epoch FROM now()) AND (p_subscription IS NULL OR s.id=p_subscription)
 AND (p_kind='test' OR s.preferences->>p_kind='true');
 -- Keep durable deliveries when the optional network wake fails; cron retries them.
 BEGIN
  PERFORM public.push_wake_worker();
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Push worker wake failed (SQLSTATE %); deliveries remain queued',SQLSTATE;
 END;
END $$;
REVOKE ALL ON FUNCTION public.push_enqueue(integer,text,jsonb,text,bigint) FROM PUBLIC,anon,authenticated;

COMMIT;
