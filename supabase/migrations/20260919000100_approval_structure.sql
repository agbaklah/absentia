-- Approval structure:
--   * Department heads are recorded in teams.manager_id; one person may head
--     several departments (Aaron: Engineering/Solar + Fleet/Logistics).
--   * cfo carries admin powers ("Admin + CFO").
--   * viewer: read-only oversight of leave, petty cash, reports and audit log;
--     never an approver, never notified as one.

-- 1. has_role('admin') is also true for cfo (and super_admin, as before).
CREATE OR REPLACE FUNCTION public.has_role(_role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid()
      AND (role = _role OR (_role = 'admin' AND role IN ('super_admin','cfo')))
  );
$$;

-- 2. Department head = teams.manager_id, regardless of the head's role.
CREATE OR REPLACE FUNCTION public.heads_team_of(_employee UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles e JOIN public.teams t ON t.id = e.team_id
    WHERE e.id = _employee AND t.manager_id = public.current_profile_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_approve_for(_employee UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  me UUID := public.current_profile_id();
  emp_team UUID;
BEGIN
  IF me IS NULL OR me = _employee THEN RETURN false; END IF;
  IF public.has_role('viewer') THEN RETURN false; END IF;
  IF NOT public.has_role('super_admin') AND public.is_excluded_from(_employee) THEN RETURN false; END IF;
  IF public.has_role('admin') THEN RETURN true; END IF;
  IF public.heads_team_of(_employee) THEN RETURN true; END IF;
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
        g.role IN ('admin','super_admin','cfo')
        OR (g.role = 'manager' AND g.team_id IS NOT NULL AND g.team_id = emp_team)
        OR EXISTS (SELECT 1 FROM public.profiles e JOIN public.teams t ON t.id = e.team_id
                   WHERE e.id = _employee AND t.manager_id = g.id)
      )
  );
END;$$;

-- 3. Notifications: a department head is notified only for their departments;
--    admins (incl. cfo/super admin) get everything except departments that
--    have a head; viewers never.
CREATE OR REPLACE FUNCTION public.leave_approvers_for(_employee UUID)
RETURNS SETOF UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH emp AS (
    SELECT e.team_id, t.manager_id AS head
    FROM public.profiles e LEFT JOIN public.teams t ON t.id = e.team_id
    WHERE e.id = _employee
  ),
  direct AS (
    -- The department head, when there is one …
    SELECT head AS id FROM emp WHERE head IS NOT NULL
    UNION
    -- … otherwise fall back to admins (+ same-team managers).
    SELECT p.id FROM public.profiles p, emp
    WHERE p.active AND p.id <> _employee
      AND emp.head IS NULL
      AND (p.role IN ('admin','super_admin','cfo')
           OR (p.role = 'manager' AND p.team_id IS NOT NULL AND p.team_id = emp.team_id))
  ),
  all_approvers AS (
    SELECT id FROM direct WHERE id <> _employee
    UNION
    SELECT d.delegate_id FROM public.approval_delegations d
    JOIN direct ON direct.id = d.delegator_id
    WHERE CURRENT_DATE BETWEEN d.start_date AND d.end_date AND d.delegate_id <> _employee
  )
  SELECT a.id FROM all_approvers a
  JOIN public.profiles p ON p.id = a.id AND p.active AND p.role <> 'viewer'
  WHERE NOT EXISTS (SELECT 1 FROM public.approval_exclusions x
                    WHERE x.approver_id = a.id AND x.employee_id = _employee);
$$;

-- 4. Viewer read access.
CREATE OR REPLACE FUNCTION public.can_review_expenses()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_role('cfo') OR public.has_role('admin') OR public.has_role('viewer');
$$;
DROP POLICY IF EXISTS audit_read_admin ON public.audit_log;
CREATE POLICY audit_read_admin ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role('admin') OR public.has_role('viewer'));
DROP POLICY IF EXISTS lbt_read ON public.leave_balance_transactions;
CREATE POLICY lbt_read ON public.leave_balance_transactions FOR SELECT TO authenticated
  USING (employee_id = public.current_profile_id() OR public.has_role('admin')
         OR public.has_role('manager') OR public.has_role('viewer'));
DROP POLICY IF EXISTS history_read ON public.employment_history;
CREATE POLICY history_read ON public.employment_history FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id() OR public.has_role('admin')
         OR public.has_role('manager') OR public.has_role('viewer'));

-- Role guard: viewer is assignable by admins (it grants no write power);
-- admin / super_admin / cfo still need a super admin.
CREATE OR REPLACE FUNCTION public.prevent_unauthorized_admin_roles()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role NOT IN ('admin','super_admin','cfo') THEN RETURN NEW; END IF;
    IF public.has_role('super_admin') THEN RETURN NEW; END IF;
    IF NEW.role <> 'cfo'
       AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE role IN ('admin','super_admin')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only a super admin can assign admin or CFO roles.';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     AND (NEW.role IN ('admin','super_admin','cfo') OR OLD.role IN ('admin','super_admin','cfo'))
     AND NOT public.has_role('super_admin') THEN
    RAISE EXCEPTION 'Only a super admin can change admin or CFO roles.';
  END IF;
  RETURN NEW;
END;$$;
