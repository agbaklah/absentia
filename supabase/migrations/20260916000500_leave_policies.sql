-- Phase 2: Time Off parity.
--   1. Leave policies (accrual, waiting period, notice, carry-over, sick days)
--   2. Blackout periods
--   3. Approval delegation
--   4. Balance ledger (adjustments / carry-over / expiry — an auditable history)
--   5. Cancel own leave
--   6. Request validation RPC + hard rules in a trigger
--   7. Year-end rollover
--   8. Audit-log hygiene for the legacy "requested" rows

-- ---------------------------------------------------------------------------
-- 1. Leave policies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  -- 'annual': full entitlement available from 1 Jan (or start date).
  -- 'monthly': entitlement accrues 1/12 per completed month of the year.
  accrual_method TEXT NOT NULL DEFAULT 'annual' CHECK (accrual_method IN ('annual','monthly')),
  annual_days NUMERIC(4,1) NOT NULL DEFAULT 24 CHECK (annual_days >= 0),
  sick_days NUMERIC(4,1) NOT NULL DEFAULT 5 CHECK (sick_days >= 0),
  carryover_cap_days NUMERIC(4,1) NOT NULL DEFAULT 5 CHECK (carryover_cap_days >= 0),
  waiting_period_days INT NOT NULL DEFAULT 0 CHECK (waiting_period_days >= 0),
  min_notice_days INT NOT NULL DEFAULT 0 CHECK (min_notice_days >= 0),
  max_consecutive_days INT CHECK (max_consecutive_days IS NULL OR max_consecutive_days > 0),
  allow_negative_balance BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS leave_policies_one_default ON public.leave_policies(is_default) WHERE is_default;
GRANT SELECT ON public.leave_policies TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.leave_policies TO authenticated;
GRANT ALL ON public.leave_policies TO service_role;
ALTER TABLE public.leave_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS policies_read ON public.leave_policies;
CREATE POLICY policies_read ON public.leave_policies FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS policies_admin_write ON public.leave_policies;
CREATE POLICY policies_admin_write ON public.leave_policies FOR ALL TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Seed the default policy from the current org settings.
INSERT INTO public.leave_policies (name, description, annual_days, sick_days, carryover_cap_days, is_default)
SELECT 'Standard', 'Default policy for all staff.',
       s.default_allowance_days, 5, s.carryover_cap_days, true
FROM public.app_settings s WHERE s.key = 'default'
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS policy_id UUID REFERENCES public.leave_policies(id) ON DELETE SET NULL;

-- Effective policy for an employee (explicit, else the default).
CREATE OR REPLACE FUNCTION public.policy_for(_employee UUID)
RETURNS public.leave_policies LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT lp.* FROM public.leave_policies lp
  WHERE lp.id = COALESCE((SELECT policy_id FROM public.profiles WHERE id = _employee),
                         (SELECT id FROM public.leave_policies WHERE is_default LIMIT 1))
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 2. Blackout periods (org-wide when team_id is NULL)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blackout_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL CHECK (end_date >= start_date),
  reason TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blackout_periods_dates_idx ON public.blackout_periods(start_date, end_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blackout_periods TO authenticated;
GRANT ALL ON public.blackout_periods TO service_role;
ALTER TABLE public.blackout_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blackout_read ON public.blackout_periods;
CREATE POLICY blackout_read ON public.blackout_periods FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS blackout_admin_write ON public.blackout_periods;
CREATE POLICY blackout_admin_write ON public.blackout_periods FOR ALL TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- ---------------------------------------------------------------------------
-- 3. Approval delegation: while active, the delegate can approve anything the
--    delegator could.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.approval_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delegator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delegate_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL CHECK (end_date >= start_date),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (delegator_id <> delegate_id)
);
CREATE INDEX IF NOT EXISTS delegations_delegate_idx ON public.approval_delegations(delegate_id, start_date, end_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_delegations TO authenticated;
GRANT ALL ON public.approval_delegations TO service_role;
ALTER TABLE public.approval_delegations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delegations_read ON public.approval_delegations;
CREATE POLICY delegations_read ON public.approval_delegations FOR SELECT TO authenticated USING (true);
-- Managers/admins manage their own delegations; admins can manage anyone's.
DROP POLICY IF EXISTS delegations_write ON public.approval_delegations;
CREATE POLICY delegations_write ON public.approval_delegations FOR ALL TO authenticated
  USING (delegator_id = public.current_profile_id() OR public.has_role('admin'))
  WITH CHECK (
    (delegator_id = public.current_profile_id() AND (public.has_role('manager') OR public.has_role('admin')))
    OR public.has_role('admin')
  );

-- Can the current user approve leave for _employee? Admin, the employee's
-- team manager, or an active delegate of either.
CREATE OR REPLACE FUNCTION public.can_approve_for(_employee UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  me UUID := public.current_profile_id();
  emp_team UUID;
BEGIN
  IF me IS NULL OR me = _employee THEN RETURN false; END IF;
  IF public.has_role('admin') THEN RETURN true; END IF;
  SELECT team_id INTO emp_team FROM public.profiles WHERE id = _employee;
  -- Direct: manager of the same team.
  IF public.has_role('manager') AND emp_team IS NOT NULL AND emp_team = public.current_team_id() THEN
    RETURN true;
  END IF;
  -- Delegated: someone who could approve has delegated to me for today.
  RETURN EXISTS (
    SELECT 1 FROM public.approval_delegations d
    JOIN public.profiles g ON g.id = d.delegator_id AND g.active
    WHERE d.delegate_id = me
      AND CURRENT_DATE BETWEEN d.start_date AND d.end_date
      AND (
        g.role IN ('admin','super_admin')
        OR (g.role = 'manager' AND g.team_id IS NOT NULL AND g.team_id = emp_team)
      )
  );
END;$$;

-- Rewire the existing self-approval guard onto can_approve_for (adds delegates).
CREATE OR REPLACE FUNCTION public.prevent_self_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me UUID := public.current_profile_id();
BEGIN
  IF me IS NULL THEN RETURN NEW; END IF; -- service role / migrations
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Cancellation is the employee's own right (rules in guard_leave_cancel).
    IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;
    IF NEW.status <> 'pending' AND NOT public.can_approve_for(NEW.employee_id) THEN
      RAISE EXCEPTION 'You cannot approve or reject this leave request.';
    END IF;
    -- Re-opening a cancelled/approved entry back to pending is only for the owner/approvers.
    IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled'
       AND NOT (me = NEW.employee_id OR public.can_approve_for(NEW.employee_id)) THEN
      RAISE EXCEPTION 'Cancelled leave cannot be reopened by you.';
    END IF;
  END IF;
  RETURN NEW;
END;$$;

-- Update the entries RLS so delegates get row access too.
DROP POLICY IF EXISTS "entries_update" ON public.leave_entries;
CREATE POLICY "entries_update" ON public.leave_entries FOR UPDATE TO authenticated
  USING (employee_id = public.current_profile_id() OR public.can_approve_for(employee_id))
  WITH CHECK (true);
DROP POLICY IF EXISTS "entries_self_write" ON public.leave_entries;
CREATE POLICY "entries_self_write" ON public.leave_entries FOR INSERT TO authenticated
  WITH CHECK (
    public.can_approve_for(employee_id)
    OR (employee_id = public.current_profile_id() AND status = 'pending')
  );
DROP POLICY IF EXISTS "entries_delete" ON public.leave_entries;
CREATE POLICY "entries_delete" ON public.leave_entries FOR DELETE TO authenticated
  USING (employee_id = public.current_profile_id() OR public.can_approve_for(employee_id));

-- Notifications: include active delegates of an approver.
CREATE OR REPLACE FUNCTION public.leave_approvers_for(_employee UUID)
RETURNS SETOF UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH direct AS (
    SELECT DISTINCT p.id
    FROM public.profiles p
    WHERE p.active AND p.id <> _employee
      AND (
        p.role IN ('admin','super_admin')
        OR (p.role = 'manager' AND p.team_id IS NOT NULL
            AND p.team_id = (SELECT team_id FROM public.profiles WHERE id = _employee))
        OR p.id = (SELECT t.manager_id FROM public.profiles e JOIN public.teams t ON t.id = e.team_id
                   WHERE e.id = _employee)
      )
  )
  SELECT id FROM direct
  UNION
  SELECT d.delegate_id FROM public.approval_delegations d
  JOIN direct ON direct.id = d.delegator_id
  WHERE CURRENT_DATE BETWEEN d.start_date AND d.end_date AND d.delegate_id <> _employee;
$$;

-- ---------------------------------------------------------------------------
-- 4. Balance ledger: every non-usage movement of an employee's vacation
--    balance, with who/why. Usage itself is derived from approved entries.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_balance_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year INT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('adjustment','carryover','expiry','allowance')),
  days NUMERIC(5,1) NOT NULL,
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lbt_employee_year_idx ON public.leave_balance_transactions(employee_id, year, created_at);
GRANT SELECT, INSERT ON public.leave_balance_transactions TO authenticated;
GRANT ALL ON public.leave_balance_transactions TO service_role;
ALTER TABLE public.leave_balance_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lbt_read ON public.leave_balance_transactions;
CREATE POLICY lbt_read ON public.leave_balance_transactions FOR SELECT TO authenticated
  USING (employee_id = public.current_profile_id() OR public.has_role('admin') OR public.has_role('manager'));
DROP POLICY IF EXISTS lbt_admin_insert ON public.leave_balance_transactions;
CREATE POLICY lbt_admin_insert ON public.leave_balance_transactions FOR INSERT TO authenticated
  WITH CHECK (public.has_role('admin') AND kind = 'adjustment');

-- Keep leave_allowances in step with manual adjustments so existing balance
-- maths (allowance + carried + adjustment − usage) stays the single truth.
CREATE OR REPLACE FUNCTION public.apply_balance_transaction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE default_days NUMERIC;
BEGIN
  SELECT annual_days INTO default_days FROM public.policy_for(NEW.employee_id);
  INSERT INTO public.leave_allowances (employee_id, year, vacation_allowance_days)
  VALUES (NEW.employee_id, NEW.year, COALESCE(default_days, 24))
  ON CONFLICT (employee_id, year) DO NOTHING;

  IF NEW.kind = 'adjustment' THEN
    UPDATE public.leave_allowances SET adjustment_days = adjustment_days + NEW.days
    WHERE employee_id = NEW.employee_id AND year = NEW.year;
  ELSIF NEW.kind = 'carryover' THEN
    UPDATE public.leave_allowances SET carried_over_days = carried_over_days + NEW.days
    WHERE employee_id = NEW.employee_id AND year = NEW.year;
  ELSIF NEW.kind = 'allowance' THEN
    UPDATE public.leave_allowances SET vacation_allowance_days = NEW.days
    WHERE employee_id = NEW.employee_id AND year = NEW.year;
  END IF;
  -- 'expiry' is informational: days lost at year end (already excluded from carry-over).
  IF NEW.created_by IS NULL THEN NEW.created_by := public.current_profile_id(); END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS apply_balance_transaction ON public.leave_balance_transactions;
CREATE TRIGGER apply_balance_transaction
  BEFORE INSERT ON public.leave_balance_transactions
  FOR EACH ROW EXECUTE FUNCTION public.apply_balance_transaction();

-- ---------------------------------------------------------------------------
-- 5. Cancel own leave: pending anytime; approved only if the day is today or
--    later. Approvers may cancel any future day. Notifies the other side.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_leave_cancel()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me UUID := public.current_profile_id();
BEGIN
  IF me IS NULL OR NEW.status <> 'cancelled' OR OLD.status = 'cancelled' THEN RETURN NEW; END IF;
  IF OLD.status = 'rejected' THEN
    RAISE EXCEPTION 'A rejected day cannot be cancelled.';
  END IF;
  IF me = OLD.employee_id THEN
    IF OLD.status = 'approved' AND OLD.date < CURRENT_DATE THEN
      RAISE EXCEPTION 'Leave that has already been taken cannot be cancelled — ask your manager.';
    END IF;
  ELSIF NOT public.can_approve_for(OLD.employee_id) THEN
    RAISE EXCEPTION 'You cannot cancel this leave.';
  END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS guard_leave_cancel ON public.leave_entries;
CREATE TRIGGER guard_leave_cancel
  BEFORE UPDATE OF status ON public.leave_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_leave_cancel();

CREATE OR REPLACE FUNCTION public.notify_leave_cancelled()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r RECORD; approver UUID; me UUID := public.current_profile_id();
BEGIN
  FOR r IN
    SELECT n.employee_id, n.leave_code, o.status AS was, MIN(n.date) AS first_day, MAX(n.date) AS last_day,
           COUNT(*) AS days, p.full_name, lt.label
    FROM new_rows n JOIN old_rows o ON o.id = n.id
    JOIN public.profiles p ON p.id = n.employee_id
    JOIN public.leave_types lt ON lt.code = n.leave_code
    WHERE n.status = 'cancelled' AND o.status <> 'cancelled'
    GROUP BY n.employee_id, n.leave_code, o.status, p.full_name, lt.label
  LOOP
    IF me = r.employee_id THEN
      -- Employee cancelled: tell approvers (only matters if it had been approved or was pending).
      FOR approver IN SELECT * FROM public.leave_approvers_for(r.employee_id) LOOP
        PERFORM public.notify(approver, 'leave.cancelled',
          r.full_name || ' cancelled ' || r.label,
          r.days || ' day' || CASE WHEN r.days = 1 THEN '' ELSE 's' END || ' · ' ||
            to_char(r.first_day, 'DD Mon') ||
            CASE WHEN r.first_day <> r.last_day THEN ' → ' || to_char(r.last_day, 'DD Mon') ELSE '' END ||
            ' (was ' || r.was || ')',
          '/requests');
      END LOOP;
    ELSE
      PERFORM public.notify(r.employee_id, 'leave.cancelled',
        r.label || ' cancelled by ' || COALESCE((SELECT full_name FROM public.profiles WHERE id = me), 'management'),
        r.days || ' day' || CASE WHEN r.days = 1 THEN '' ELSE 's' END || ' · ' ||
          to_char(r.first_day, 'DD Mon') ||
          CASE WHEN r.first_day <> r.last_day THEN ' → ' || to_char(r.last_day, 'DD Mon') ELSE '' END,
        '/requests');
    END IF;
  END LOOP;
  RETURN NULL;
END;$$;
DROP TRIGGER IF EXISTS notify_leave_cancelled ON public.leave_entries;
CREATE TRIGGER notify_leave_cancelled
  AFTER UPDATE ON public.leave_entries
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_leave_cancelled();

-- ---------------------------------------------------------------------------
-- 6. Request validation. One RPC the UI calls before submitting (to show
--    warnings), and a trigger that enforces the hard rules for self-service
--    requests so nothing can bypass them.
-- ---------------------------------------------------------------------------
-- Accrued vacation entitlement for a year as of a date (policy-aware, pro-rata
-- for monthly accrual and for mid-year starters).
CREATE OR REPLACE FUNCTION public.accrued_allowance(_employee UUID, _year INT, _as_of DATE DEFAULT CURRENT_DATE)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  pol public.leave_policies;
  alw public.leave_allowances;
  start_date DATE;
  base NUMERIC;
  months_in_year INT;
  months_done INT;
BEGIN
  pol := public.policy_for(_employee);
  SELECT * INTO alw FROM public.leave_allowances WHERE employee_id = _employee AND year = _year;
  SELECT employment_start_date INTO start_date FROM public.profiles WHERE id = _employee;
  base := COALESCE(alw.vacation_allowance_days, pol.annual_days, 24);

  -- Mid-year starters get a pro-rata share of the annual entitlement.
  IF start_date IS NOT NULL AND EXTRACT(YEAR FROM start_date) = _year THEN
    months_in_year := 12 - EXTRACT(MONTH FROM start_date)::int + 1;
    base := round(base * months_in_year / 12.0, 1);
  END IF;

  IF pol.accrual_method = 'monthly' AND EXTRACT(YEAR FROM _as_of) = _year THEN
    months_done := EXTRACT(MONTH FROM _as_of)::int;
    IF start_date IS NOT NULL AND EXTRACT(YEAR FROM start_date) = _year THEN
      months_done := months_done - EXTRACT(MONTH FROM start_date)::int + 1;
      base := round(COALESCE(alw.vacation_allowance_days, pol.annual_days, 24) * GREATEST(months_done, 0) / 12.0, 1);
    ELSE
      base := round(base * months_done / 12.0, 1);
    END IF;
  ELSIF pol.accrual_method = 'monthly' AND EXTRACT(YEAR FROM _as_of) < _year THEN
    base := 0;
  END IF;

  RETURN base + COALESCE(alw.carried_over_days, 0) + COALESCE(alw.adjustment_days, 0);
END;$$;

-- Approved vacation days already booked in a year (half days count 0.5).
CREATE OR REPLACE FUNCTION public.vacation_used(_employee UUID, _year INT)
RETURNS NUMERIC LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(SUM(lt.counts_as_days), 0)
  FROM public.leave_entries e JOIN public.leave_types lt ON lt.code = e.leave_code
  WHERE e.employee_id = _employee AND e.status = 'approved' AND lt.category = 'vacation'
    AND EXTRACT(YEAR FROM e.date) = _year;
$$;

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

  -- Waiting period (new joiners).
  IF pol.waiting_period_days > 0 AND lt.category = 'vacation'
     AND first_day < emp.employment_start_date + pol.waiting_period_days THEN
    errors := errors || format('Vacation can be taken from %s (%s-day waiting period).',
      to_char(emp.employment_start_date + pol.waiting_period_days, 'DD Mon YYYY'), pol.waiting_period_days);
  END IF;

  -- Minimum notice (vacation only — sickness is unplanned).
  IF pol.min_notice_days > 0 AND lt.category = 'vacation' AND first_day < CURRENT_DATE + pol.min_notice_days THEN
    IF is_mgmt THEN
      warnings := warnings || format('Less than the %s-day notice period.', pol.min_notice_days);
    ELSE
      errors := errors || format('Vacation needs at least %s days'' notice (earliest %s).',
        pol.min_notice_days, to_char(CURRENT_DATE + pol.min_notice_days, 'DD Mon'));
    END IF;
  END IF;

  -- Max consecutive days.
  IF pol.max_consecutive_days IS NOT NULL AND array_length(_dates, 1) > pol.max_consecutive_days THEN
    IF is_mgmt THEN
      warnings := warnings || format('Longer than the %s-day maximum for a single request.', pol.max_consecutive_days);
    ELSE
      errors := errors || format('A single request may cover at most %s working days.', pol.max_consecutive_days);
    END IF;
  END IF;

  -- Blackout periods (org-wide or the employee's team).
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

  -- Balance (vacation only).
  IF lt.category = 'vacation' THEN
    available := public.accrued_allowance(_employee, yr, last_day) - public.vacation_used(_employee, yr);
    IF requested > available THEN
      IF pol.allow_negative_balance OR is_mgmt THEN
        warnings := warnings || format('Exceeds available balance (%s of %s days left).', available, requested);
      ELSE
        errors := errors || format('Only %s vacation day%s available by %s; this request needs %s.',
          available, CASE WHEN available = 1 THEN '' ELSE 's' END, to_char(last_day, 'DD Mon'), requested);
      END IF;
    END IF;
  END IF;

  -- Team coverage: who else is already off on the same days.
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
GRANT EXECUTE ON FUNCTION public.validate_leave_request(UUID, DATE[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accrued_allowance(UUID, INT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vacation_used(UUID, INT) TO authenticated;

-- Hard enforcement for self-service inserts (statement-level so the whole
-- request is validated as one, including balance across all its days).
CREATE OR REPLACE FUNCTION public.enforce_leave_rules()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r RECORD; v JSONB; me UUID := public.current_profile_id();
BEGIN
  IF me IS NULL THEN RETURN NULL; END IF;
  FOR r IN
    SELECT employee_id, leave_code, array_agg(date ORDER BY date) AS dates
    FROM new_rows WHERE status = 'pending'
    GROUP BY employee_id, leave_code
  LOOP
    IF public.can_approve_for(r.employee_id) THEN CONTINUE; END IF; -- managers can override
    v := public.validate_leave_request(r.employee_id, r.dates, r.leave_code);
    IF NOT (v->>'ok')::boolean THEN
      RAISE EXCEPTION '%', (SELECT string_agg(x, ' ') FROM jsonb_array_elements_text(v->'errors') x);
    END IF;
  END LOOP;
  RETURN NULL;
END;$$;
DROP TRIGGER IF EXISTS enforce_leave_rules ON public.leave_entries;
CREATE TRIGGER enforce_leave_rules
  AFTER INSERT ON public.leave_entries
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_leave_rules();

-- ---------------------------------------------------------------------------
-- 7. Year-end rollover. Idempotent per employee (skips anyone who already has
--    a carry-over ledger row for the target year). Admin only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_year_end_rollover(_from_year INT, _dry_run BOOLEAN DEFAULT true)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  emp RECORD;
  pol public.leave_policies;
  entitlement NUMERIC;
  used NUMERIC;
  remaining NUMERIC;
  carry NUMERIC;
  lost NUMERIC;
  rows JSONB := '[]'::jsonb;
  n_done INT := 0;
  me UUID := public.current_profile_id();
BEGIN
  IF me IS NOT NULL AND NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Only admins can run the year-end rollover.';
  END IF;
  FOR emp IN SELECT * FROM public.profiles WHERE active ORDER BY full_name LOOP
    IF EXISTS (SELECT 1 FROM public.leave_balance_transactions
               WHERE employee_id = emp.id AND year = _from_year + 1 AND kind = 'carryover') THEN
      CONTINUE;
    END IF;
    pol := public.policy_for(emp.id);
    entitlement := public.accrued_allowance(emp.id, _from_year, make_date(_from_year, 12, 31));
    used := public.vacation_used(emp.id, _from_year);
    remaining := GREATEST(entitlement - used, 0);
    carry := LEAST(remaining, pol.carryover_cap_days);
    lost := remaining - carry;
    rows := rows || jsonb_build_object('employee_id', emp.id, 'name', emp.full_name,
              'entitlement', entitlement, 'used', used, 'carry', carry, 'lost', lost);
    IF NOT _dry_run THEN
      INSERT INTO public.leave_allowances (employee_id, year, vacation_allowance_days, sick_leave_allowance_days)
      VALUES (emp.id, _from_year + 1, pol.annual_days, pol.sick_days)
      ON CONFLICT (employee_id, year) DO NOTHING;
      INSERT INTO public.leave_balance_transactions (employee_id, year, kind, days, note, created_by)
      VALUES (emp.id, _from_year + 1, 'carryover', carry,
              format('Carried over from %s (%s unused, cap %s)', _from_year, remaining, pol.carryover_cap_days), me);
      IF lost > 0 THEN
        INSERT INTO public.leave_balance_transactions (employee_id, year, kind, days, note, created_by)
        VALUES (emp.id, _from_year, 'expiry', -lost, format('Expired at end of %s (over carry-over cap)', _from_year), me);
      END IF;
      n_done := n_done + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('dry_run', _dry_run, 'processed', n_done, 'employees', rows);
END;$$;
GRANT EXECUTE ON FUNCTION public.run_year_end_rollover(INT, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Legacy trigger wrote one audit row per admin per day ("notify_to"). Real
--    notifications now exist, so record a single audit row per day instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_admins_on_leave_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.audit_log (entity, entity_id, action, actor_id, after)
  VALUES ('leave_entry', NEW.id, 'requested', COALESCE(public.current_profile_id(), NEW.requested_by),
          jsonb_build_object('employee_id', NEW.employee_id, 'leave_code', NEW.leave_code,
                             'date', NEW.date, 'status', NEW.status));
  RETURN NEW;
END;$$;

-- Audit status decisions too (approve/reject/cancel), one row per statement group.
CREATE OR REPLACE FUNCTION public.audit_leave_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.employee_id, n.leave_code, n.status, o.status AS was,
           MIN(n.date) AS first_day, MAX(n.date) AS last_day, COUNT(*) AS days, MAX(n.decision_note) AS note
    FROM new_rows n JOIN old_rows o ON o.id = n.id
    WHERE n.status <> o.status
    GROUP BY n.employee_id, n.leave_code, n.status, o.status
  LOOP
    INSERT INTO public.audit_log (actor_id, action, entity, entity_id, before, after)
    VALUES (public.current_profile_id(), r.status::text, 'leave_request', r.employee_id::text,
            jsonb_build_object('status', r.was),
            jsonb_build_object('status', r.status, 'leave_code', r.leave_code, 'from', r.first_day,
                               'to', r.last_day, 'days', r.days, 'note', r.note));
  END LOOP;
  RETURN NULL;
END;$$;
DROP TRIGGER IF EXISTS audit_leave_status ON public.leave_entries;
CREATE TRIGGER audit_leave_status
  AFTER UPDATE ON public.leave_entries
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_leave_status();

-- Audit-log readers: admins (existing) — also let managers read.
DROP POLICY IF EXISTS audit_read_admin ON public.audit_log;
CREATE POLICY audit_read_admin ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role('admin'));
