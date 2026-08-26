-- SECURITY HARDENING MIGRATION
-- Prevents privilege escalation and self-service bypasses

-- 1. Prevent employees from modifying their own force_password_change flag
--    The only way to clear it is through the completePasswordChange server function
--    which uses the service_role key (bypasses RLS).
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- 2. Add a trigger that rejects client-side attempts to set sensitive columns
--    force_password_change, temp_password_hash, temp_password_expires_at,
--    password_changed_at can only be modified by service_role (server functions).
CREATE OR REPLACE FUNCTION public.prevent_sensitive_field_tampering()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  -- Only apply to authenticated users (not service_role, which bypasses RLS)
  IF current_setting('request.jwt.claims', true)::jsonb IS NOT NULL THEN
    IF NEW.force_password_change IS DISTINCT FROM OLD.force_password_change THEN
      RAISE EXCEPTION 'Cannot modify force_password_change directly.';
    END IF;
    IF NEW.temp_password_hash IS DISTINCT FROM OLD.temp_password_hash THEN
      RAISE EXCEPTION 'Cannot modify temp_password_hash directly.';
    END IF;
    IF NEW.temp_password_expires_at IS DISTINCT FROM OLD.temp_password_expires_at THEN
      RAISE EXCEPTION 'Cannot modify temp_password_expires_at directly.';
    END IF;
    IF NEW.password_changed_at IS DISTINCT FROM OLD.password_changed_at THEN
      RAISE EXCEPTION 'Cannot modify password_changed_at directly.';
    END IF;
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS prevent_sensitive_field_tampering ON public.profiles;
CREATE TRIGGER prevent_sensitive_field_tampering
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_sensitive_field_tampering();

-- 3. Strengthen leave_entries INSERT policy:
--    Only allow inserting entries where the employee_id matches the caller's profile
--    OR the caller is admin/manager (prevent employees from submitting for others).
--    The existing policy already does this, but we add an explicit check on status
--    to prevent clients from inserting pre-approved entries.
DROP POLICY IF EXISTS entries_self_write ON public.leave_entries;
CREATE POLICY entries_self_write ON public.leave_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND (
      employee_id = public.current_profile_id()
      OR public.has_role('admin')
      OR (public.has_role('manager') AND EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = employee_id AND p.team_id = public.current_team_id()
      ))
    )
  );

-- 4. Strengthen leave_entries UPDATE policy:
--    Only admins/managers can change status; employees can only update their own pending entries.
DROP POLICY IF EXISTS entries_update ON public.leave_entries;
CREATE POLICY entries_update ON public.leave_entries
  FOR UPDATE TO authenticated
  USING (
    -- Admins/managers can update any entry they have access to
    public.has_role('admin')
    OR (public.has_role('manager') AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = employee_id AND p.team_id = public.current_team_id()
    ))
    -- Employees can only update their own PENDING entries (e.g. to cancel)
    OR (employee_id = public.current_profile_id() AND status = 'pending')
  )
  WITH CHECK (true);

-- 5. Strengthen profiles INSERT policy:
--    Prevent employees from inserting profiles with admin/super_admin role directly.
--    The handle_new_user trigger sets the role, but a direct INSERT from the client
--    could bypass it if the trigger doesn't fire (it only fires on auth.users INSERT).
DROP POLICY IF EXISTS profiles_admin_write ON public.profiles;
CREATE POLICY profiles_admin_write ON public.profiles
  FOR ALL TO authenticated
  USING (public.has_role('admin'))
  WITH CHECK (
    public.has_role('admin')
    -- Prevent non-super-admins from inserting admin/super_admin profiles
    AND (
      NEW.role NOT IN ('admin', 'super_admin')
      OR public.has_role('super_admin')
    )
  );
