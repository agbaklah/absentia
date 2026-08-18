-- Employees can edit their own leave entries (e.g. notes) and file or
-- re-submit requests as 'pending', but they must NOT be able to approve or
-- reject their own leave — that is the manager/admin's job.
--
-- Two layers:
--   1. INSERT policy: self-service rows must stay 'pending'.
--   2. A BEFORE UPDATE trigger blocks status changes on your own rows
--      (RLS policies can't compare the old row to the new row, so the
--      status-change rule can't live in a policy alone).
-- Admins and same-team managers are exempt from both.

-- INSERT: self-service rows must stay pending. Admins and same-team managers
-- may insert with any status (calendar edits, backdated entries, etc.).
DROP POLICY IF EXISTS "entries_self_write" ON public.leave_entries;
CREATE POLICY "entries_self_write" ON public.leave_entries FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role('admin')
    OR (public.has_role('manager') AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = employee_id AND p.team_id = public.current_team_id()
    ))
    OR (employee_id = public.current_profile_id() AND status = 'pending')
  );

-- UPDATE: restore the original row-level access (own rows, admins,
-- same-team managers). Status changes are policed by the trigger below.
DROP POLICY IF EXISTS "entries_update" ON public.leave_entries;
CREATE POLICY "entries_update" ON public.leave_entries FOR UPDATE TO authenticated
  USING (
    employee_id = public.current_profile_id()
    OR public.has_role('admin')
    OR (public.has_role('manager') AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = employee_id AND p.team_id = public.current_team_id()
    ))
  )
  WITH CHECK (true);

-- Trigger: nobody may flip the status of their own leave to approved/rejected
-- unless they are an admin or the employee's team manager. Re-submitting a
-- rejected day back to 'pending' stays allowed.
CREATE OR REPLACE FUNCTION public.prevent_self_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status <> 'pending'
     AND NOT public.has_role('admin')
     AND NOT (public.has_role('manager') AND EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = NEW.employee_id AND p.team_id = public.current_team_id()
     )) THEN
    RAISE EXCEPTION 'Employees cannot change the status of their own leave.';
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS prevent_self_status_change ON public.leave_entries;
CREATE TRIGGER prevent_self_status_change
  BEFORE UPDATE OF status ON public.leave_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_status_change();
