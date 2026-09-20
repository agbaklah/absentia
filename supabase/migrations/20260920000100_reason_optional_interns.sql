-- 1. Per-employee waiver of the "reason required" rule for regular leave
--    (sick leave still needs a doctor's report). Set by admins only.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS leave_reason_optional BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.limit_self_profile_edits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me UUID := public.current_profile_id();
BEGIN
  IF me IS NULL OR public.has_role('admin') THEN RETURN NEW; END IF;
  IF me = OLD.id THEN
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.team_id IS DISTINCT FROM OLD.team_id
       OR NEW.active IS DISTINCT FROM OLD.active OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.employment_start_date IS DISTINCT FROM OLD.employment_start_date
       OR NEW.employment_end_date IS DISTINCT FROM OLD.employment_end_date
       OR NEW.employment_type IS DISTINCT FROM OLD.employment_type
       OR NEW.job_title IS DISTINCT FROM OLD.job_title
       OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
       OR NEW.custom_fields IS DISTINCT FROM OLD.custom_fields
       OR NEW.leave_reason_optional IS DISTINCT FROM OLD.leave_reason_optional THEN
      RAISE EXCEPTION 'You can only change your own name, phone and location.';
    END IF;
  END IF;
  RETURN NEW;
END;$$;

-- 2. Interns department.
INSERT INTO public.teams (name) VALUES ('Interns') ON CONFLICT (name) DO NOTHING;
