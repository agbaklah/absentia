-- Baseline sync: objects that exist in production but were never captured in
-- a migration (added via the dashboard). Everything here is idempotent so it
-- is a no-op on production and brings fresh local/branch databases in line.

ALTER TABLE public.leave_allowances
  ADD COLUMN IF NOT EXISTS sick_leave_allowance_days NUMERIC NOT NULL DEFAULT 5;

ALTER TABLE public.leave_entries
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS decision_note TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS temp_password_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS temp_password_hash TEXT;

-- Records a "requested" audit row per admin whenever a leave day is filed.
CREATE OR REPLACE FUNCTION public.notify_admins_on_leave_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  emp_name  TEXT;
  emp_email TEXT;
  leave_lbl TEXT;
  admin_rec RECORD;
BEGIN
  SELECT full_name, email INTO emp_name, emp_email
    FROM public.profiles WHERE id = NEW.employee_id;

  SELECT label INTO leave_lbl
    FROM public.leave_types WHERE code = NEW.leave_code;

  FOR admin_rec IN
    SELECT email FROM public.profiles
    WHERE role IN ('admin', 'super_admin') AND active = TRUE
      AND email != emp_email
  LOOP
    INSERT INTO public.audit_log (entity, entity_id, action, actor_id, after)
    VALUES (
      'leave_request', NEW.id, 'requested', NEW.employee_id,
      jsonb_build_object(
        'employee_name', emp_name, 'employee_email', emp_email,
        'leave_type', COALESCE(leave_lbl, NEW.leave_code),
        'date', NEW.date, 'notify_to', admin_rec.email
      )
    );
  END LOOP;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_notify_admins_on_leave_request ON public.leave_entries;
CREATE TRIGGER trg_notify_admins_on_leave_request
  AFTER INSERT ON public.leave_entries
  FOR EACH ROW EXECUTE FUNCTION public.notify_admins_on_leave_request();
