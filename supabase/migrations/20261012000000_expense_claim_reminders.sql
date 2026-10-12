-- Petty cash claims that nobody has acted on get a reminder every 24 hours.
--
-- A claim is "waiting" in two places:
--   submitted → waiting for the CFO to approve or reject
--   approved  → waiting for the CFO to mark it paid
-- In both cases the reminder goes to whoever can act (active CFOs, falling
-- back to super admins when there is no CFO) and every super admin is copied,
-- so the oversight mailbox carries the chase as well as the request.
--
-- Rows land in public.notifications like any other alert, so the existing
-- per-minute mailer delivers them; nothing new has to be scheduled to send.

ALTER TABLE public.expense_claims
  ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.expense_claims.last_reminded_at IS
  'When a stale-claim reminder was last sent. NULL = never chased.';

-- ---------------------------------------------------------------------------
-- Who can act on a claim right now: CFOs, or super admins when no CFO exists.
-- The claimant is never asked to chase themselves.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expense_deciders_for(_claimant UUID)
RETURNS SETOF UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM public.profiles
  WHERE active AND role = 'cfo' AND id <> _claimant
  UNION
  SELECT id FROM public.profiles
  WHERE active AND role = 'super_admin' AND id <> _claimant
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE active AND role = 'cfo' AND id <> _claimant
    );
$$;
REVOKE ALL ON FUNCTION public.expense_deciders_for(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Chase every claim that has sat unactioned for 24 hours or more. Safe to run
-- as often as you like: each claim is chased at most once per 24 hours, and
-- the clock restarts from the last reminder, not from submission.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remind_stale_expense_claims()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  c RECORD;
  recipient UUID;
  sa UUID;
  amount_txt TEXT;
  waiting_for TEXT;
  waiting_since TIMESTAMPTZ;
  hours INTEGER;
  age_txt TEXT;
  chased INTEGER := 0;
BEGIN
  FOR c IN
    SELECT ec.*, p.full_name AS claimant_name
    FROM public.expense_claims ec
    JOIN public.profiles p ON p.id = ec.claimant_id
    WHERE ec.status IN ('submitted', 'approved')
      -- 24h since the claim started waiting, or since we last chased it.
      AND now() - GREATEST(
            CASE WHEN ec.status = 'submitted' THEN ec.submitted_at ELSE ec.reviewed_at END,
            COALESCE(ec.last_reminded_at, '-infinity'::timestamptz)
          ) >= interval '24 hours'
    ORDER BY ec.claim_no
  LOOP
    amount_txt := c.currency || ' ' || to_char(c.amount, 'FM999,999,990.00');
    waiting_since := CASE WHEN c.status = 'submitted' THEN c.submitted_at ELSE c.reviewed_at END;
    hours := FLOOR(EXTRACT(EPOCH FROM (now() - waiting_since)) / 3600)::int;
    age_txt := CASE
      WHEN hours >= 48 THEN (hours / 24)::text || ' days'
      ELSE hours::text || ' hours'
    END;
    waiting_for := CASE
      WHEN c.status = 'submitted' THEN 'waiting for approval'
      ELSE 'approved but not paid'
    END;

    FOR recipient IN SELECT public.expense_deciders_for(c.claimant_id) LOOP
      PERFORM public.notify(recipient, 'expense.reminder',
        'Reminder · claim #' || c.claim_no || ' ' || waiting_for || ' for ' || age_txt,
        c.claimant_name || ' · ' || c.title || ' · ' || amount_txt,
        '/expenses/review');
    END LOOP;

    -- Oversight copy, so the super admin mailbox sees the chase too. Skipped
    -- when they were already told above as the acting decider.
    FOR sa IN
      SELECT id FROM public.profiles
      WHERE active AND role = 'super_admin' AND id <> c.claimant_id
        AND id NOT IN (SELECT public.expense_deciders_for(c.claimant_id))
    LOOP
      PERFORM public.notify(sa, 'expense.reminder',
        'Reminder · claim #' || c.claim_no || ' ' || waiting_for || ' for ' || age_txt,
        c.claimant_name || ' · ' || c.title || ' · ' || amount_txt,
        '/expenses/review');
    END LOOP;

    UPDATE public.expense_claims SET last_reminded_at = now() WHERE id = c.id;

    INSERT INTO public.audit_log(actor_id, action, entity, entity_id, after)
    VALUES (NULL, 'reminded', 'expense_claim', c.id::text,
      jsonb_build_object('status', c.status, 'claim_no', c.claim_no,
                         'waiting_hours', hours, 'waiting_for', waiting_for));

    chased := chased + 1;
  END LOOP;

  RETURN chased;
END;$$;
REVOKE ALL ON FUNCTION public.remind_stale_expense_claims() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remind_stale_expense_claims() TO service_role;

-- ---------------------------------------------------------------------------
-- Run it hourly. Hourly (not daily) so a claim is chased as soon as it crosses
-- its own 24-hour mark, rather than waiting for a fixed time of day. No HTTP
-- call and no secret: the rows it writes are mailed by the existing job.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('absentia-expense-reminders')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'absentia-expense-reminders');
    PERFORM cron.schedule('absentia-expense-reminders', '7 * * * *',
      'SELECT public.remind_stale_expense_claims()');
  ELSE
    RAISE NOTICE 'pg_cron is not installed — schedule remind_stale_expense_claims() yourself.';
  END IF;
END$$;
