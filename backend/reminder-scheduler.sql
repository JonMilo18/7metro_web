-- Run after deploying the inbox migration and the updated metro-push worker.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='7metro-callup-reminders') THEN
    PERFORM cron.schedule('7metro-callup-reminders','*/5 * * * *','SELECT public.send_callup_reminders();');
  END IF;
END $$;
