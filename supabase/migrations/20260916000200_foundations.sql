-- Phase 0 foundations: org settings, in-app notifications, receipt storage,
-- CFO role guards, and leave-request notification fan-out.

-- ---------------------------------------------------------------------------
-- 1. Organisation settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS company_name TEXT NOT NULL DEFAULT 'Verve Energy Resources',
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'GHS',
  ADD COLUMN IF NOT EXISTS petty_cash_limit NUMERIC(12,2) NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS holiday_region TEXT NOT NULL DEFAULT 'GH';

-- ---------------------------------------------------------------------------
-- 2. CFO role guards: only a super admin may grant or revoke the cfo role
--    (it carries authority over company money).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_unauthorized_admin_roles()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role NOT IN ('admin','super_admin','cfo') THEN
      RETURN NEW;
    END IF;
    IF public.has_role('super_admin') THEN
      RETURN NEW;
    END IF;
    IF NEW.role <> 'cfo'
       AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE role IN ('admin','super_admin')) THEN
      RETURN NEW; -- first account becomes admin
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

-- ---------------------------------------------------------------------------
-- 3. In-app notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                -- e.g. leave.requested, expense.approved
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,                         -- in-app route, e.g. /requests
  read_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON public.notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unsent_idx
  ON public.notifications(created_at) WHERE email_sent_at IS NULL;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_own_read ON public.notifications;
CREATE POLICY notifications_own_read ON public.notifications FOR SELECT TO authenticated
  USING (recipient_id = public.current_profile_id());

-- Recipients may only mark their own notifications read (no other edits).
DROP POLICY IF EXISTS notifications_own_update ON public.notifications;
CREATE POLICY notifications_own_update ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_id = public.current_profile_id())
  WITH CHECK (recipient_id = public.current_profile_id());

CREATE OR REPLACE FUNCTION public.protect_notification_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recipient_id <> OLD.recipient_id OR NEW.kind <> OLD.kind
     OR NEW.title <> OLD.title OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.link IS DISTINCT FROM OLD.link OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Only read_at may be changed on a notification.';
  END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS protect_notification_columns ON public.notifications;
CREATE TRIGGER protect_notification_columns
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW WHEN (current_setting('role', true) = 'authenticated')
  EXECUTE FUNCTION public.protect_notification_columns();

-- Realtime so the bell updates live.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- Server-side helper used by triggers (SECURITY DEFINER: callers never get
-- INSERT on notifications directly). Skips inactive / null recipients.
CREATE OR REPLACE FUNCTION public.notify(
  _recipient UUID, _kind TEXT, _title TEXT, _body TEXT DEFAULT NULL, _link TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF _recipient IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _recipient AND active) THEN RETURN; END IF;
  INSERT INTO public.notifications(recipient_id, kind, title, body, link)
  VALUES (_recipient, _kind, _title, _body, _link);
END;$$;
REVOKE ALL ON FUNCTION public.notify(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Everyone who should hear about an employee's leave: their team manager plus
-- all active admins / super admins, excluding the employee themself.
CREATE OR REPLACE FUNCTION public.leave_approvers_for(_employee UUID)
RETURNS SETOF UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT DISTINCT p.id
  FROM public.profiles p
  WHERE p.active
    AND p.id <> _employee
    AND (
      p.role IN ('admin','super_admin')
      OR (p.role = 'manager' AND p.team_id IS NOT NULL
          AND p.team_id = (SELECT team_id FROM public.profiles WHERE id = _employee))
      OR p.id = (SELECT t.manager_id FROM public.profiles e JOIN public.teams t ON t.id = e.team_id
                 WHERE e.id = _employee)
    );
$$;
REVOKE ALL ON FUNCTION public.leave_approvers_for(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Leave notifications. Statement-level triggers with transition tables so a
--    multi-day request (N rows) produces ONE notification per approver.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_leave_requested()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r RECORD; approver UUID;
BEGIN
  FOR r IN
    SELECT n.employee_id, n.leave_code, MIN(n.date) AS first_day, MAX(n.date) AS last_day,
           COUNT(*) AS days, p.full_name, lt.label
    FROM new_rows n
    JOIN public.profiles p ON p.id = n.employee_id
    JOIN public.leave_types lt ON lt.code = n.leave_code
    WHERE n.status = 'pending'
    GROUP BY n.employee_id, n.leave_code, p.full_name, lt.label
  LOOP
    FOR approver IN SELECT * FROM public.leave_approvers_for(r.employee_id) LOOP
      PERFORM public.notify(
        approver, 'leave.requested',
        r.full_name || ' requested ' || r.label,
        r.days || ' day' || CASE WHEN r.days = 1 THEN '' ELSE 's' END || ' · ' ||
          to_char(r.first_day, 'DD Mon') ||
          CASE WHEN r.first_day <> r.last_day THEN ' → ' || to_char(r.last_day, 'DD Mon') ELSE '' END,
        '/requests');
    END LOOP;
  END LOOP;
  RETURN NULL;
END;$$;

DROP TRIGGER IF EXISTS notify_leave_requested ON public.leave_entries;
CREATE TRIGGER notify_leave_requested
  AFTER INSERT ON public.leave_entries
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_leave_requested();

CREATE OR REPLACE FUNCTION public.notify_leave_decided()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.employee_id, n.status, n.leave_code, MIN(n.date) AS first_day, MAX(n.date) AS last_day,
           COUNT(*) AS days, lt.label,
           (SELECT full_name FROM public.profiles WHERE id = MAX(n.approved_by::text)::uuid) AS by_name
    FROM new_rows n
    JOIN old_rows o ON o.id = n.id
    JOIN public.leave_types lt ON lt.code = n.leave_code
    WHERE n.status <> o.status AND n.status IN ('approved','rejected')
    GROUP BY n.employee_id, n.status, n.leave_code, lt.label
  LOOP
    PERFORM public.notify(
      r.employee_id, 'leave.' || r.status,
      r.label || ' ' || r.status,
      r.days || ' day' || CASE WHEN r.days = 1 THEN '' ELSE 's' END || ' · ' ||
        to_char(r.first_day, 'DD Mon') ||
        CASE WHEN r.first_day <> r.last_day THEN ' → ' || to_char(r.last_day, 'DD Mon') ELSE '' END ||
        COALESCE(' · by ' || r.by_name, ''),
      '/requests');
  END LOOP;
  RETURN NULL;
END;$$;

DROP TRIGGER IF EXISTS notify_leave_decided ON public.leave_entries;
CREATE TRIGGER notify_leave_decided
  AFTER UPDATE ON public.leave_entries
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_leave_decided();

-- ---------------------------------------------------------------------------
-- 5. Receipt storage. Private bucket; object path = <claimant profile id>/<claim id>/<file>.
--    Owners manage their own folder; CFO / admins can read everything.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('receipts', 'receipts', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.can_review_expenses()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_role('cfo') OR public.has_role('admin');
$$;

DROP POLICY IF EXISTS receipts_owner_insert ON storage.objects;
CREATE POLICY receipts_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = public.current_profile_id()::text);

DROP POLICY IF EXISTS receipts_owner_delete ON storage.objects;
CREATE POLICY receipts_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = public.current_profile_id()::text);

DROP POLICY IF EXISTS receipts_read ON storage.objects;
CREATE POLICY receipts_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND (
    (storage.foldername(name))[1] = public.current_profile_id()::text
    OR public.can_review_expenses()
  ));
