-- Leave requests nobody has decided get the same 24-hour chase as petty cash.
--
-- Routing follows the approval structure rather than a fixed list, so each
-- approver is chased only for what they can actually act on:
--   Engineering & Solar, Fleet/Logistics → their head (the CTO)
--   Sales/Tech                           → their head (the CFO)
--   a team with no head (Interns, …)     → admins, CFO, super admins
-- Delegations and approval exclusions are honoured, because this reuses
-- leave_approvers_for(). Every super admin is copied either way.
--
-- A request is one submission: the per-day rows written together share an
-- employee, a leave code and a created_at, which is what groups them here.

ALTER TABLE public.leave_entries
  ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.leave_entries.last_reminded_at IS
  'When a pending-request reminder was last sent for this day. NULL = never chased.';

CREATE OR REPLACE FUNCTION public.remind_stale_leave_requests()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  r RECORD;
  recipient UUID;
  sa UUID;
  hours INTEGER;
  age_txt TEXT;
  span_txt TEXT;
  chased INTEGER := 0;
BEGIN
  FOR r IN
    SELECT e.employee_id, e.leave_code, e.created_at,
           MIN(e.date) AS first_day, MAX(e.date) AS last_day, COUNT(*) AS days,
           MAX(e.last_reminded_at) AS last_reminded,
           p.full_name AS emp_name, lt.label
    FROM public.leave_entries e
    JOIN public.profiles p ON p.id = e.employee_id
    JOIN public.leave_types lt ON lt.code = e.leave_code
    WHERE e.status = 'pending'
    GROUP BY e.employee_id, e.leave_code, e.created_at, p.full_name, lt.label
    HAVING now() - GREATEST(
             e.created_at,
             COALESCE(MAX(e.last_reminded_at), '-infinity'::timestamptz)
           ) >= interval '24 hours'
    ORDER BY e.created_at
  LOOP
    hours := FLOOR(EXTRACT(EPOCH FROM (now() - r.created_at)) / 3600)::int;
    age_txt := CASE WHEN hours >= 48 THEN (hours / 24)::text || ' days'
                    ELSE hours::text || ' hours' END;
    span_txt := r.days || ' day' || CASE WHEN r.days = 1 THEN '' ELSE 's' END || ' · ' ||
                to_char(r.first_day, 'DD Mon') ||
                CASE WHEN r.first_day <> r.last_day
                     THEN ' → ' || to_char(r.last_day, 'DD Mon') ELSE '' END;

    FOR recipient IN SELECT public.leave_approvers_for(r.employee_id) LOOP
      PERFORM public.notify(recipient, 'leave.reminder',
        'Reminder · ' || r.emp_name || ' · ' || r.label ||
          ' waiting for approval for ' || age_txt,
        span_txt, '/requests');
    END LOOP;

    -- Oversight copy, unless they were already told as the acting approver.
    FOR sa IN
      SELECT id FROM public.profiles
      WHERE active AND role = 'super_admin' AND id <> r.employee_id
        AND id NOT IN (SELECT public.leave_approvers_for(r.employee_id))
    LOOP
      PERFORM public.notify(sa, 'leave.reminder',
        'Reminder · ' || r.emp_name || ' · ' || r.label ||
          ' waiting for approval for ' || age_txt,
        span_txt, '/requests');
    END LOOP;

    UPDATE public.leave_entries
       SET last_reminded_at = now()
     WHERE employee_id = r.employee_id
       AND leave_code = r.leave_code
       AND created_at = r.created_at
       AND status = 'pending';

    INSERT INTO public.audit_log(actor_id, action, entity, entity_id, after)
    VALUES (NULL, 'reminded', 'leave_request', r.employee_id::text,
      jsonb_build_object('from', r.first_day, 'to', r.last_day, 'days', r.days,
                         'leave_code', r.leave_code, 'waiting_hours', hours));

    chased := chased + 1;
  END LOOP;

  RETURN chased;
END;$$;
REVOKE ALL ON FUNCTION public.remind_stale_leave_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remind_stale_leave_requests() TO service_role;

-- Hourly, like the petty cash chase, so a request is chased as soon as it
-- crosses its own 24-hour mark. Offset so the two do not start together.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('absentia-leave-reminders')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'absentia-leave-reminders');
    PERFORM cron.schedule('absentia-leave-reminders', '22 * * * *',
      'SELECT public.remind_stale_leave_requests()');
  ELSE
    RAISE NOTICE 'pg_cron is not installed — schedule remind_stale_leave_requests() yourself.';
  END IF;
END$$;
