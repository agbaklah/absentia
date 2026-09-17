-- Approval exclusions: named employees an approver must never see or act on
-- (e.g. peers of equal seniority). Enforced in RLS + can_approve_for() +
-- notification fan-out, so the exclusion holds everywhere, not just in the UI.

CREATE TABLE IF NOT EXISTS public.approval_exclusions (
  approver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (approver_id, employee_id),
  CHECK (approver_id <> employee_id)
);
GRANT SELECT, INSERT, DELETE ON public.approval_exclusions TO authenticated;
GRANT ALL ON public.approval_exclusions TO service_role;
ALTER TABLE public.approval_exclusions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exclusions_read ON public.approval_exclusions;
CREATE POLICY exclusions_read ON public.approval_exclusions FOR SELECT TO authenticated
  USING (public.has_role('admin'));
-- Only super admins may create or remove exclusions (they concern admins themselves).
DROP POLICY IF EXISTS exclusions_super_admin ON public.approval_exclusions;
CREATE POLICY exclusions_super_admin ON public.approval_exclusions FOR ALL TO authenticated
  USING (public.has_role('super_admin')) WITH CHECK (public.has_role('super_admin'));

CREATE OR REPLACE FUNCTION public.is_excluded_from(_employee UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.approval_exclusions
                 WHERE approver_id = public.current_profile_id() AND employee_id = _employee);
$$;

-- can_approve_for: exclusions win over every other rule (super admins exempt).
CREATE OR REPLACE FUNCTION public.can_approve_for(_employee UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  me UUID := public.current_profile_id();
  emp_team UUID;
BEGIN
  IF me IS NULL OR me = _employee THEN RETURN false; END IF;
  IF NOT public.has_role('super_admin') AND public.is_excluded_from(_employee) THEN RETURN false; END IF;
  IF public.has_role('admin') THEN RETURN true; END IF;
  SELECT team_id INTO emp_team FROM public.profiles WHERE id = _employee;
  IF public.has_role('manager') AND emp_team IS NOT NULL AND emp_team = public.current_team_id() THEN
    RETURN true;
  END IF;
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

-- Excluded approvers cannot even see that employee's leave (queue, calendar, drawer).
DROP POLICY IF EXISTS "entries_read" ON public.leave_entries;
CREATE POLICY "entries_read" ON public.leave_entries FOR SELECT TO authenticated
  USING (employee_id = public.current_profile_id()
         OR public.has_role('super_admin')
         OR NOT public.is_excluded_from(employee_id));

-- Notifications never go to an excluded approver.
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
  ),
  all_approvers AS (
    SELECT id FROM direct
    UNION
    SELECT d.delegate_id FROM public.approval_delegations d
    JOIN direct ON direct.id = d.delegator_id
    WHERE CURRENT_DATE BETWEEN d.start_date AND d.end_date AND d.delegate_id <> _employee
  )
  SELECT a.id FROM all_approvers a
  WHERE NOT EXISTS (SELECT 1 FROM public.approval_exclusions x
                    WHERE x.approver_id = a.id AND x.employee_id = _employee);
$$;
