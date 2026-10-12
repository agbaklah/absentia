-- Read-only window onto the scheduled jobs, so a deploy can prove that the
-- reminder (and the mailer) are really scheduled. Service role only; it
-- exposes job names and schedules, never the command text, which can carry
-- secrets such as CRON_SECRET.
CREATE OR REPLACE FUNCTION public.cron_job_status()
RETURNS TABLE (jobname TEXT, schedule TEXT, active BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE
    'SELECT j.jobname::text, j.schedule::text, j.active FROM cron.job j ORDER BY j.jobname';
END$$;
REVOKE ALL ON FUNCTION public.cron_job_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_job_status() TO service_role;
