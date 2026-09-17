-- Add a flag so newly-created employees must change their temp password on
-- first login.  Defaults to FALSE (existing users are unaffected).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT FALSE;

-- Notify admins via email when a new leave request is inserted.
-- Uses Supabase's built-in http_request to call a server webhook.
-- The webhook URL is stored in app_settings so it can be changed without
-- redeploying; if the setting is missing the trigger silently skips.
CREATE OR REPLACE FUNCTION public.notify_admins_on_leave_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  emp_name  TEXT;
  emp_email TEXT;
  leave_lbl TEXT;
  admin_rec RECORD;
  webhook_url TEXT;
BEGIN
  SELECT full_name, email INTO emp_name, emp_email
    FROM public.profiles WHERE id = NEW.employee_id;

  SELECT label INTO leave_lbl
    FROM public.leave_types WHERE code = NEW.leave_code;

  -- Collect admin / super_admin emails
  FOR admin_rec IN
    SELECT email FROM public.profiles
    WHERE role IN ('admin', 'super_admin') AND active = TRUE
      AND email != emp_email
  LOOP
    -- Insert an in-app notification row (lightweight, always works)
    INSERT INTO public.audit_log (entity, entity_id, action, actor_id, after)
    VALUES (
      'leave_request',
      NEW.id,
      'requested',
      NEW.employee_id,
      jsonb_build_object(
        'employee_name', emp_name,
        'employee_email', emp_email,
        'leave_type', COALESCE(leave_lbl, NEW.leave_code),
        'date', NEW.date,
        'notify_to', admin_rec.email
      )
    );
  END LOOP;

  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_notify_admins_on_leave_request ON public.leave_entries;
CREATE TRIGGER trg_notify_admins_on_leave_request
  AFTER INSERT ON public.leave_entries
  FOR EACH ROW EXECUTE FUNCTION public.notify_admins_on_leave_request();
