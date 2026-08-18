-- Only the very first account in the organisation becomes admin; every later
-- sign-up starts as an employee. Pre-registered profiles keep the role that
-- was assigned to them (the attach-existing-profile branch never rewrites it).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE existing_id UUID;
        meta_team_id UUID;
        new_role   public.app_role;
BEGIN
  IF lower(NEW.email) !~ '^[^@]+@verve-energyresources\.com$' THEN
    RAISE EXCEPTION 'Only @verve-energyresources.com email addresses are allowed to sign up.';
  END IF;

  meta_team_id := NULLIF(NEW.raw_user_meta_data->>'team_id', '')::uuid;

  -- If a profile with this email exists and has no auth link, attach it.
  SELECT id INTO existing_id FROM public.profiles WHERE lower(email) = lower(NEW.email) AND auth_user_id IS NULL LIMIT 1;
  IF existing_id IS NOT NULL THEN
    -- An admin-assigned team (or existing record) wins over a self-selected one.
    UPDATE public.profiles
       SET auth_user_id = NEW.id,
           team_id = COALESCE(team_id, meta_team_id)
     WHERE id = existing_id;
  ELSE
    -- Bootstrap: the first account becomes admin for convenience; everyone
    -- else joins as an employee.
    new_role := CASE WHEN EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin')
                     THEN 'employee'::public.app_role
                     ELSE 'admin'::public.app_role
                END;
    INSERT INTO public.profiles (auth_user_id, full_name, email, role, team_id)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
      NEW.email,
      new_role,
      meta_team_id
    );
  END IF;
  RETURN NEW;
END;$$;
