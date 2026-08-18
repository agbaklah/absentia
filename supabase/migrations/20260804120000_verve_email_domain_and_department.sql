-- Company email policy + sign-up department.
--
-- 1) Every new account must use an @verve-energyresources.com email — enforced
--    hard in the signup trigger (blocks the auth.users insert) and defensively
--    by a CHECK constraint on profiles.email.
-- 2) Sign-up now captures the new hire's department (team) from user metadata.
-- 3) The team list is readable by anon so the sign-up page can offer departments.

-- Signup trigger: reject non-work emails, attach the chosen department.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE existing_id UUID;
        meta_team_id UUID;
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
    INSERT INTO public.profiles (auth_user_id, full_name, email, role, team_id)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
      NEW.email,
      'admin', -- first signups become admin for convenience
      meta_team_id
    );
  END IF;
  RETURN NEW;
END;$$;

-- Defense in depth: every stored profile email must carry the work domain.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_email_domain;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_email_domain CHECK (lower(email) ~ '^[^@]+@verve-energyresources\.com$');

-- Let unauthenticated visitors read the team list so sign-up can ask for a department.
GRANT SELECT ON public.teams TO anon;
CREATE POLICY "teams_read_anon" ON public.teams FOR SELECT TO anon USING (true);
