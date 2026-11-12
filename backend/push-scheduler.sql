-- Install after metro-push and the encrypted vault secret 7metro_push_worker_token are configured.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
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
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='7metro-push-retry') THEN
  PERFORM cron.schedule('7metro-push-retry','* * * * *','SELECT public.push_wake_worker();');
 END IF;
END $$;
