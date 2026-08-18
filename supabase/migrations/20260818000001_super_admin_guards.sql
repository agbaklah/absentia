-- Super admin guards. A super admin has every admin power (has_role('admin')
-- is true for super_admin too) and is the ONLY role that can assign or change
-- admin/super_admin roles, or modify admin profile rows.

-- 1. has_role: 'admin' checks also pass for super_admin.
CREATE OR REPLACE FUNCTION public.has_role(_role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid()
      AND (role = _role OR (_role = 'admin' AND role = 'super_admin'))
  );
$$;

-- 2. First-account bootstrap: an existing super_admin also counts as "an
--    admin exists", so later sign-ups always start as employees.
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
    UPDATE public.profiles
       SET auth_user_id = NEW.id,
           team_id = COALESCE(team_id, meta_team_id)
     WHERE id = existing_id;
  ELSE
    new_role := CASE WHEN EXISTS (SELECT 1 FROM public.profiles WHERE role IN ('admin','super_admin'))
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

-- 3. Helper used by the RLS guard below (SECURITY DEFINER so the subquery is
--    not subject to RLS — avoids infinite recursion in the policy).
CREATE OR REPLACE FUNCTION public.profile_role(_profile_id UUID)
RETURNS public.app_role LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT role FROM public.profiles WHERE id = _profile_id;
$$;

-- 4. Only super admins may create or change admin/super_admin roles.
--    (RLS policies can't compare the old row to the new row, so this lives
--    in a trigger. The INSERT branch still allows the first-account bootstrap
--    when no admin exists yet.)
CREATE OR REPLACE FUNCTION public.prevent_unauthorized_admin_roles()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role NOT IN ('admin','super_admin') THEN
      RETURN NEW;
    END IF;
    IF public.has_role('super_admin') THEN
      RETURN NEW;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role IN ('admin','super_admin')) THEN
      RETURN NEW; -- first account becomes admin
    END IF;
    RAISE EXCEPTION 'Only a super admin can assign admin roles.';
  END IF;

  -- UPDATE: role changes to/from admin/super_admin require super_admin.
  IF NEW.role IS DISTINCT FROM OLD.role
     AND (NEW.role IN ('admin','super_admin') OR OLD.role IN ('admin','super_admin'))
     AND NOT public.has_role('super_admin') THEN
    RAISE EXCEPTION 'Only a super admin can change admin roles.';
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS prevent_unauthorized_admin_roles ON public.profiles;
CREATE TRIGGER prevent_unauthorized_admin_roles
  BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_admin_roles();

-- 5. Regular admins cannot UPDATE or DELETE admin/super_admin profile rows
--    (team moves, archiving, etc.). Role changes are guarded by the trigger.
DROP POLICY IF EXISTS profiles_super_admin_guard_update ON public.profiles;
CREATE POLICY profiles_super_admin_guard_update ON public.profiles AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (
    NOT (
      public.has_role('admin')
      AND NOT public.has_role('super_admin')
      AND public.profile_role(id) IN ('admin','super_admin')
    )
  );

DROP POLICY IF EXISTS profiles_super_admin_guard_delete ON public.profiles;
CREATE POLICY profiles_super_admin_guard_delete ON public.profiles AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (
    NOT (
      public.has_role('admin')
      AND NOT public.has_role('super_admin')
      AND public.profile_role(id) IN ('admin','super_admin')
    )
  );

-- 6. Promote the verveit account to super_admin (trigger disabled for this
--    one-time statement — the migration runs with no user session, so the
--    trigger's super-admin check would otherwise reject it).
ALTER TABLE public.profiles DISABLE TRIGGER prevent_unauthorized_admin_roles;
UPDATE public.profiles SET role = 'super_admin' WHERE email = 'verveit@verve-energyresources.com';
ALTER TABLE public.profiles ENABLE TRIGGER prevent_unauthorized_admin_roles;
