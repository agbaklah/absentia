-- Clearer balance messages: say what is available and what is needed, in
-- that order ("Only 3 days available; this request needs 5").
CREATE OR REPLACE FUNCTION public.validate_leave_request(_employee UUID, _dates DATE[], _leave_code TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  pol public.leave_policies;
  lt public.leave_types;
  emp public.profiles;
  errors TEXT[] := '{}';
  warnings TEXT[] := '{}';
  first_day DATE;
  last_day DATE;
  requested NUMERIC;
  yr INT;
  available NUMERIC;
  b RECORD;
  cov RECORD;
  max_abs INT;
  is_mgmt BOOLEAN := public.can_approve_for(_employee);
BEGIN
  IF _dates IS NULL OR array_length(_dates, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array('No working days in that range.'), 'warnings', '[]'::jsonb);
  END IF;
  SELECT * INTO emp FROM public.profiles WHERE id = _employee;
  SELECT * INTO lt FROM public.leave_types WHERE code = _leave_code;
  pol := public.policy_for(_employee);
  first_day := (SELECT MIN(d) FROM unnest(_dates) d);
  last_day := (SELECT MAX(d) FROM unnest(_dates) d);
  requested := array_length(_dates, 1) * COALESCE(lt.counts_as_days, 1);
  yr := EXTRACT(YEAR FROM first_day);

  IF pol.waiting_period_days > 0 AND lt.category = 'vacation'
     AND first_day < emp.employment_start_date + pol.waiting_period_days THEN
    errors := errors || format('Vacation can be taken from %s (%s-day waiting period).',
      to_char(emp.employment_start_date + pol.waiting_period_days, 'DD Mon YYYY'), pol.waiting_period_days);
  END IF;

  IF pol.min_notice_days > 0 AND lt.category = 'vacation' AND first_day < CURRENT_DATE + pol.min_notice_days THEN
    IF is_mgmt THEN
      warnings := warnings || format('Less than the %s-day notice period.', pol.min_notice_days);
    ELSE
      errors := errors || format('Vacation needs at least %s days'' notice (earliest %s).',
        pol.min_notice_days, to_char(CURRENT_DATE + pol.min_notice_days, 'DD Mon'));
    END IF;
  END IF;

  IF pol.max_consecutive_days IS NOT NULL AND array_length(_dates, 1) > pol.max_consecutive_days THEN
    IF is_mgmt THEN
      warnings := warnings || format('Longer than the %s-day maximum for a single request.', pol.max_consecutive_days);
    ELSE
      errors := errors || format('A single request may cover at most %s working days.', pol.max_consecutive_days);
    END IF;
  END IF;

  FOR b IN
    SELECT bp.*, t.name AS team_name FROM public.blackout_periods bp
    LEFT JOIN public.teams t ON t.id = bp.team_id
    WHERE (bp.team_id IS NULL OR bp.team_id = emp.team_id)
      AND bp.start_date <= last_day AND bp.end_date >= first_day
  LOOP
    IF is_mgmt THEN
      warnings := warnings || format('Overlaps blackout “%s” (%s → %s).', b.reason, to_char(b.start_date,'DD Mon'), to_char(b.end_date,'DD Mon'));
    ELSE
      errors := errors || format('%s → %s is blocked: %s%s.', to_char(b.start_date,'DD Mon'), to_char(b.end_date,'DD Mon'), b.reason,
        CASE WHEN b.team_name IS NOT NULL THEN ' (' || b.team_name || ')' ELSE '' END);
    END IF;
  END LOOP;

  IF lt.category = 'vacation' THEN
    available := public.accrued_allowance(_employee, yr, last_day) - public.vacation_used(_employee, yr);
    IF requested > available THEN
      IF pol.allow_negative_balance OR is_mgmt THEN
        warnings := warnings || format('Over the vacation balance: %s day%s available by %s, this request needs %s (balance would be %s).',
          available, CASE WHEN available = 1 THEN '' ELSE 's' END, to_char(last_day, 'DD Mon'), requested, available - requested);
      ELSE
        errors := errors || format('Only %s vacation day%s available by %s; this request needs %s.',
          available, CASE WHEN available = 1 THEN '' ELSE 's' END, to_char(last_day, 'DD Mon'), requested);
      END IF;
    END IF;
  END IF;

  SELECT max_concurrent_absent INTO max_abs FROM public.app_settings WHERE key = 'default';
  IF emp.team_id IS NOT NULL AND lt.category <> 'wfh' THEN
    FOR cov IN
      SELECT e.date, string_agg(p.full_name, ', ' ORDER BY p.full_name) AS names, COUNT(*) AS n
      FROM public.leave_entries e
      JOIN public.profiles p ON p.id = e.employee_id
      JOIN public.leave_types t ON t.code = e.leave_code
      WHERE e.date = ANY(_dates) AND e.status IN ('approved','pending')
        AND p.team_id = emp.team_id AND p.id <> _employee AND t.category NOT IN ('wfh','holiday')
      GROUP BY e.date
      HAVING COUNT(*) + 1 > COALESCE(max_abs, 3)
      ORDER BY e.date
      LIMIT 3
    LOOP
      warnings := warnings || format('%s: %s already off — team limit is %s.', to_char(cov.date, 'Dy DD Mon'), cov.names, max_abs);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', array_length(errors, 1) IS NULL,
    'errors', to_jsonb(errors),
    'warnings', to_jsonb(warnings),
    'requested_days', requested,
    'available_days', available
  );
END;$$;
