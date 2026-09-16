-- Phase 3: People & Records (BambooHR "Employees" module).
--   1. Public-ish profile fields (job title, phone, custom fields)
--   2. Private record (DOB, address, emergency contact, ID, bank/MoMo)
--   3. Job history (auto-tracked on title/team change)
--   4. Employee documents (private bucket)
--   5. Onboarding / offboarding checklists from templates
--   6. Custom field definitions

-- ---------------------------------------------------------------------------
-- 1. Profile fields visible to the whole org (directory)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'full_time'
    CHECK (employment_type IN ('full_time','part_time','contract','intern')),
  ADD COLUMN IF NOT EXISTS employment_end_date DATE,
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Employees may edit their own contact details but not role/team/etc. The
-- existing profiles_self_update policy grants row access; this trigger limits
-- which columns a non-admin can touch on their own row.
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
       OR NEW.custom_fields IS DISTINCT FROM OLD.custom_fields THEN
      RAISE EXCEPTION 'You can only change your own name, phone and location.';
    END IF;
  END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS limit_self_profile_edits ON public.profiles;
CREATE TRIGGER limit_self_profile_edits
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.limit_self_profile_edits();

-- ---------------------------------------------------------------------------
-- 2. Private record — one row per profile, tighter RLS than the directory.
--    Owner: read + edit. Admin: read + edit. CFO: read bank/MoMo (payouts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_private (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  date_of_birth DATE,
  gender TEXT CHECK (gender IS NULL OR gender IN ('female','male','other','prefer_not_to_say')),
  address TEXT,
  personal_email TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  emergency_relationship TEXT,
  national_id_type TEXT CHECK (national_id_type IS NULL OR national_id_type IN ('ghana_card','passport','voter_id','drivers_licence','other')),
  national_id_number TEXT,
  ssnit_number TEXT,
  tin TEXT,
  bank_name TEXT,
  bank_branch TEXT,
  bank_account_name TEXT,
  bank_account_number TEXT,
  momo_network TEXT CHECK (momo_network IS NULL OR momo_network IN ('mtn','telecel','airteltigo')),
  momo_number TEXT,
  momo_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE ON public.employee_private TO authenticated;
GRANT ALL ON public.employee_private TO service_role;
ALTER TABLE public.employee_private ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS private_read ON public.employee_private;
CREATE POLICY private_read ON public.employee_private FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id() OR public.has_role('admin') OR public.has_role('cfo'));
DROP POLICY IF EXISTS private_write ON public.employee_private;
CREATE POLICY private_write ON public.employee_private FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id() OR public.has_role('admin'));
DROP POLICY IF EXISTS private_update ON public.employee_private;
CREATE POLICY private_update ON public.employee_private FOR UPDATE TO authenticated
  USING (profile_id = public.current_profile_id() OR public.has_role('admin'))
  WITH CHECK (profile_id = public.current_profile_id() OR public.has_role('admin'));

-- CFO sees only payout fields: expose them through a view (RLS on the base
-- table still applies; the view just narrows the columns for that role).
CREATE OR REPLACE VIEW public.employee_payout_details
WITH (security_invoker = true) AS
  SELECT profile_id, bank_name, bank_branch, bank_account_name, bank_account_number,
         momo_network, momo_number, momo_name
  FROM public.employee_private;
GRANT SELECT ON public.employee_payout_details TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_employee_private()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := public.current_profile_id();
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS touch_employee_private ON public.employee_private;
CREATE TRIGGER touch_employee_private
  BEFORE INSERT OR UPDATE ON public.employee_private
  FOR EACH ROW EXECUTE FUNCTION public.touch_employee_private();

-- Audit every change to private data (who touched whose record; no values).
CREATE OR REPLACE FUNCTION public.audit_employee_private()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.audit_log(actor_id, action, entity, entity_id, after)
  VALUES (public.current_profile_id(), lower(TG_OP), 'employee_private', NEW.profile_id::text,
          jsonb_build_object('fields_changed', (
            SELECT jsonb_agg(key) FROM jsonb_each(to_jsonb(NEW)) n
            WHERE TG_OP = 'INSERT' OR n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key)
              AND n.key NOT IN ('updated_at','updated_by')
          )));
  RETURN NULL;
END;$$;
DROP TRIGGER IF EXISTS audit_employee_private ON public.employee_private;
CREATE TRIGGER audit_employee_private
  AFTER INSERT OR UPDATE ON public.employee_private
  FOR EACH ROW EXECUTE FUNCTION public.audit_employee_private();

-- ---------------------------------------------------------------------------
-- 3. Job history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  job_title TEXT,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  employment_type TEXT,
  change_kind TEXT NOT NULL DEFAULT 'change'
    CHECK (change_kind IN ('hired','change','promotion','transfer','left','rehired')),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employment_history_profile_idx ON public.employment_history(profile_id, effective_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employment_history TO authenticated;
GRANT ALL ON public.employment_history TO service_role;
ALTER TABLE public.employment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS history_read ON public.employment_history;
CREATE POLICY history_read ON public.employment_history FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id() OR public.has_role('admin') OR public.has_role('manager'));
DROP POLICY IF EXISTS history_admin_write ON public.employment_history;
CREATE POLICY history_admin_write ON public.employment_history FOR ALL TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Auto-record title / team / type changes and hires.
CREATE OR REPLACE FUNCTION public.track_employment_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.employment_history(profile_id, effective_date, job_title, team_id, employment_type, change_kind, created_by)
    VALUES (NEW.id, NEW.employment_start_date, NEW.job_title, NEW.team_id, NEW.employment_type, 'hired', public.current_profile_id());
    RETURN NEW;
  END IF;
  IF NEW.job_title IS DISTINCT FROM OLD.job_title OR NEW.team_id IS DISTINCT FROM OLD.team_id
     OR NEW.employment_type IS DISTINCT FROM OLD.employment_type THEN
    INSERT INTO public.employment_history(profile_id, job_title, team_id, employment_type, change_kind, created_by)
    VALUES (NEW.id, NEW.job_title, NEW.team_id, NEW.employment_type,
            CASE WHEN NEW.team_id IS DISTINCT FROM OLD.team_id AND NEW.job_title IS NOT DISTINCT FROM OLD.job_title THEN 'transfer' ELSE 'change' END,
            public.current_profile_id());
  END IF;
  IF NEW.active = false AND OLD.active = true THEN
    INSERT INTO public.employment_history(profile_id, effective_date, job_title, team_id, change_kind, created_by)
    VALUES (NEW.id, COALESCE(NEW.employment_end_date, CURRENT_DATE), NEW.job_title, NEW.team_id, 'left', public.current_profile_id());
  ELSIF NEW.active = true AND OLD.active = false THEN
    INSERT INTO public.employment_history(profile_id, job_title, team_id, change_kind, created_by)
    VALUES (NEW.id, NEW.job_title, NEW.team_id, 'rehired', public.current_profile_id());
  END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS track_employment_changes ON public.profiles;
CREATE TRIGGER track_employment_changes
  AFTER INSERT OR UPDATE OF job_title, team_id, employment_type, active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.track_employment_changes();

-- Backfill a 'hired' row for existing staff.
INSERT INTO public.employment_history(profile_id, effective_date, job_title, team_id, employment_type, change_kind)
SELECT p.id, p.employment_start_date, p.job_title, p.team_id, p.employment_type, 'hired'
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.employment_history h WHERE h.profile_id = p.id);

-- ---------------------------------------------------------------------------
-- 4. Employee documents
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('employee-docs', 'employee-docs', false, 20971520,
        ARRAY['image/jpeg','image/png','image/webp','application/pdf',
              'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'other'
    CHECK (kind IN ('contract','id','certificate','medical','policy_ack','payslip','other')),
  title TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,   -- <profile id>/<file>
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL CHECK (size_bytes > 0),
  expires_at DATE,
  visible_to_employee BOOLEAN NOT NULL DEFAULT true,
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_documents_profile_idx ON public.employee_documents(profile_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_documents TO authenticated;
GRANT ALL ON public.employee_documents TO service_role;
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS docs_read ON public.employee_documents;
CREATE POLICY docs_read ON public.employee_documents FOR SELECT TO authenticated
  USING (public.has_role('admin') OR (profile_id = public.current_profile_id() AND visible_to_employee));
DROP POLICY IF EXISTS docs_insert ON public.employee_documents;
CREATE POLICY docs_insert ON public.employee_documents FOR INSERT TO authenticated
  WITH CHECK ((public.has_role('admin') OR profile_id = public.current_profile_id())
              AND split_part(storage_path, '/', 1) = profile_id::text);
DROP POLICY IF EXISTS docs_delete ON public.employee_documents;
CREATE POLICY docs_delete ON public.employee_documents FOR DELETE TO authenticated
  USING (public.has_role('admin') OR (profile_id = public.current_profile_id() AND uploaded_by = public.current_profile_id()));
DROP POLICY IF EXISTS docs_admin_update ON public.employee_documents;
CREATE POLICY docs_admin_update ON public.employee_documents FOR UPDATE TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

DROP POLICY IF EXISTS employee_docs_read ON storage.objects;
CREATE POLICY employee_docs_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'employee-docs' AND (
    public.has_role('admin') OR (storage.foldername(name))[1] = public.current_profile_id()::text));
DROP POLICY IF EXISTS employee_docs_insert ON storage.objects;
CREATE POLICY employee_docs_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-docs' AND (
    public.has_role('admin') OR (storage.foldername(name))[1] = public.current_profile_id()::text));
DROP POLICY IF EXISTS employee_docs_delete ON storage.objects;
CREATE POLICY employee_docs_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'employee-docs' AND (
    public.has_role('admin') OR (storage.foldername(name))[1] = public.current_profile_id()::text));

-- ---------------------------------------------------------------------------
-- 5. Onboarding / offboarding checklists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('onboarding','offboarding')),
  -- [{ "title": "...", "assignee": "employee|manager|admin|cfo", "due_days": 3 }]
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS checklist_templates_default ON public.checklist_templates(kind) WHERE is_default;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_templates TO authenticated;
GRANT ALL ON public.checklist_templates TO service_role;
ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS templates_read ON public.checklist_templates;
CREATE POLICY templates_read ON public.checklist_templates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS templates_admin ON public.checklist_templates;
CREATE POLICY templates_admin ON public.checklist_templates FOR ALL TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

CREATE TABLE IF NOT EXISTS public.checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('onboarding','offboarding')),
  template_id UUID REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS checklists_profile_idx ON public.checklists(profile_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklists TO authenticated;
GRANT ALL ON public.checklists TO service_role;
ALTER TABLE public.checklists ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.checklist_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assignee_role TEXT,
  due_date DATE,
  position INT NOT NULL DEFAULT 0,
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS checklist_tasks_assignee_idx ON public.checklist_tasks(assignee_id) WHERE done_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_tasks TO authenticated;
GRANT ALL ON public.checklist_tasks TO service_role;
ALTER TABLE public.checklist_tasks ENABLE ROW LEVEL SECURITY;

-- Visibility: the employee it's about, anyone assigned a task on it, managers, admins.
CREATE OR REPLACE FUNCTION public.can_see_checklist(_checklist UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_role('admin') OR public.has_role('manager')
    OR EXISTS (SELECT 1 FROM public.checklists c WHERE c.id = _checklist AND c.profile_id = public.current_profile_id())
    OR EXISTS (SELECT 1 FROM public.checklist_tasks t WHERE t.checklist_id = _checklist AND t.assignee_id = public.current_profile_id());
$$;
DROP POLICY IF EXISTS checklists_read ON public.checklists;
CREATE POLICY checklists_read ON public.checklists FOR SELECT TO authenticated USING (public.can_see_checklist(id));
DROP POLICY IF EXISTS checklists_admin ON public.checklists;
CREATE POLICY checklists_admin ON public.checklists FOR ALL TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
DROP POLICY IF EXISTS tasks_read ON public.checklist_tasks;
CREATE POLICY tasks_read ON public.checklist_tasks FOR SELECT TO authenticated USING (public.can_see_checklist(checklist_id));
DROP POLICY IF EXISTS tasks_admin ON public.checklist_tasks;
CREATE POLICY tasks_admin ON public.checklist_tasks FOR ALL TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
-- Assignees may tick their own tasks.
DROP POLICY IF EXISTS tasks_assignee_update ON public.checklist_tasks;
CREATE POLICY tasks_assignee_update ON public.checklist_tasks FOR UPDATE TO authenticated
  USING (assignee_id = public.current_profile_id()) WITH CHECK (assignee_id = public.current_profile_id());

CREATE OR REPLACE FUNCTION public.guard_task_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me UUID := public.current_profile_id();
BEGIN
  IF me IS NULL OR public.has_role('admin') THEN
    IF NEW.done_at IS NOT NULL AND OLD.done_at IS NULL THEN NEW.done_by := COALESCE(NEW.done_by, me); END IF;
    RETURN NEW;
  END IF;
  -- Assignee: only done_at may change.
  IF NEW.title <> OLD.title OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
     OR NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.checklist_id <> OLD.checklist_id THEN
    RAISE EXCEPTION 'Only the done state can be changed on an assigned task.';
  END IF;
  IF NEW.done_at IS NOT NULL AND OLD.done_at IS NULL THEN NEW.done_by := me; END IF;
  IF NEW.done_at IS NULL THEN NEW.done_by := NULL; END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS guard_task_update ON public.checklist_tasks;
CREATE TRIGGER guard_task_update BEFORE UPDATE ON public.checklist_tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_update();

-- Mark the checklist complete when the last task is ticked.
CREATE OR REPLACE FUNCTION public.complete_checklist_if_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.checklists c
     SET completed_at = CASE WHEN NOT EXISTS (SELECT 1 FROM public.checklist_tasks t WHERE t.checklist_id = c.id AND t.done_at IS NULL)
                             THEN COALESCE(c.completed_at, now()) ELSE NULL END
   WHERE c.id = NEW.checklist_id;
  RETURN NULL;
END;$$;
DROP TRIGGER IF EXISTS complete_checklist_if_done ON public.checklist_tasks;
CREATE TRIGGER complete_checklist_if_done AFTER INSERT OR UPDATE OF done_at ON public.checklist_tasks
  FOR EACH ROW EXECUTE FUNCTION public.complete_checklist_if_done();

-- Resolve a template role to a concrete assignee for a given employee.
CREATE OR REPLACE FUNCTION public.resolve_assignee(_employee UUID, _role TEXT)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE _role
    WHEN 'employee' THEN _employee
    WHEN 'manager' THEN COALESCE(
      (SELECT t.manager_id FROM public.profiles e JOIN public.teams t ON t.id = e.team_id WHERE e.id = _employee),
      (SELECT p.id FROM public.profiles p JOIN public.profiles e ON e.team_id = p.team_id
        WHERE e.id = _employee AND p.role = 'manager' AND p.active AND p.id <> _employee LIMIT 1),
      (SELECT id FROM public.profiles WHERE role IN ('admin','super_admin') AND active ORDER BY created_at LIMIT 1))
    WHEN 'cfo' THEN COALESCE(
      (SELECT id FROM public.profiles WHERE role = 'cfo' AND active LIMIT 1),
      (SELECT id FROM public.profiles WHERE role IN ('admin','super_admin') AND active ORDER BY created_at LIMIT 1))
    ELSE (SELECT id FROM public.profiles WHERE role IN ('admin','super_admin') AND active ORDER BY created_at LIMIT 1)
  END;
$$;

-- Start a checklist for an employee from a template (default for the kind if
-- none given). Returns the checklist id. Admin only (or system).
CREATE OR REPLACE FUNCTION public.start_checklist(_employee UUID, _kind TEXT, _template UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  tpl public.checklist_templates;
  cl UUID;
  item JSONB;
  i INT := 0;
  assignee UUID;
  base DATE;
BEGIN
  IF public.current_profile_id() IS NOT NULL AND NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Only admins can start checklists.';
  END IF;
  SELECT * INTO tpl FROM public.checklist_templates
   WHERE id = COALESCE(_template, (SELECT id FROM public.checklist_templates WHERE kind = _kind AND is_default LIMIT 1));
  IF tpl.id IS NULL THEN RETURN NULL; END IF;
  SELECT CASE WHEN _kind = 'onboarding' THEN employment_start_date ELSE COALESCE(employment_end_date, CURRENT_DATE) END
    INTO base FROM public.profiles WHERE id = _employee;
  INSERT INTO public.checklists(profile_id, kind, template_id) VALUES (_employee, _kind, tpl.id) RETURNING id INTO cl;
  FOR item IN SELECT * FROM jsonb_array_elements(tpl.items) LOOP
    assignee := public.resolve_assignee(_employee, COALESCE(item->>'assignee', 'admin'));
    INSERT INTO public.checklist_tasks(checklist_id, title, assignee_id, assignee_role, due_date, position)
    VALUES (cl, item->>'title', assignee, item->>'assignee',
            base + COALESCE((item->>'due_days')::int, 0), i);
    IF assignee IS NOT NULL AND assignee <> public.current_profile_id() THEN
      PERFORM public.notify(assignee, 'checklist.task',
        _kind || ' task: ' || (item->>'title'),
        'For ' || (SELECT full_name FROM public.profiles WHERE id = _employee) ||
          ' · due ' || to_char(base + COALESCE((item->>'due_days')::int, 0), 'DD Mon'),
        '/onboarding');
    END IF;
    i := i + 1;
  END LOOP;
  RETURN cl;
END;$$;
GRANT EXECUTE ON FUNCTION public.start_checklist(UUID, TEXT, UUID) TO authenticated;

-- Auto-start: onboarding on hire (profile insert), offboarding on archive.
CREATE OR REPLACE FUNCTION public.auto_start_checklists()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.start_checklist(NEW.id, 'onboarding');
  ELSIF NEW.active = false AND OLD.active = true THEN
    PERFORM public.start_checklist(NEW.id, 'offboarding');
  END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS auto_start_checklists ON public.profiles;
CREATE TRIGGER auto_start_checklists
  AFTER INSERT OR UPDATE OF active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_start_checklists();

-- Default templates.
INSERT INTO public.checklist_templates (name, kind, is_default, items) VALUES
('Standard onboarding', 'onboarding', true, '[
  {"title": "Sign employment contract", "assignee": "employee", "due_days": 0},
  {"title": "Provide Ghana Card / ID and SSNIT number", "assignee": "employee", "due_days": 2},
  {"title": "Add bank or MoMo details for reimbursements", "assignee": "employee", "due_days": 2},
  {"title": "Add emergency contact", "assignee": "employee", "due_days": 2},
  {"title": "Create email account and system access", "assignee": "admin", "due_days": 0},
  {"title": "Issue ID card / PPE / equipment", "assignee": "admin", "due_days": 3},
  {"title": "Welcome meeting and team introduction", "assignee": "manager", "due_days": 1},
  {"title": "30-day check-in", "assignee": "manager", "due_days": 30}
]'::jsonb),
('Standard offboarding', 'offboarding', true, '[
  {"title": "Return equipment, ID card and keys", "assignee": "employee", "due_days": 0},
  {"title": "Hand over open work and documents", "assignee": "employee", "due_days": 0},
  {"title": "Settle outstanding petty cash claims", "assignee": "cfo", "due_days": 3},
  {"title": "Final pay and leave balance settlement", "assignee": "cfo", "due_days": 7},
  {"title": "Revoke system and email access", "assignee": "admin", "due_days": 0},
  {"title": "Exit interview", "assignee": "manager", "due_days": 2}
]'::jsonb)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Custom profile fields (definitions; values live in profiles.custom_fields)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_field_definitions (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','number','date','select','boolean')),
  options TEXT[] DEFAULT NULL,        -- for 'select'
  visible_to TEXT NOT NULL DEFAULT 'management' CHECK (visible_to IN ('everyone','employee','management')),
  position INT NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_field_definitions TO authenticated;
GRANT ALL ON public.profile_field_definitions TO service_role;
ALTER TABLE public.profile_field_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fields_read ON public.profile_field_definitions;
CREATE POLICY fields_read ON public.profile_field_definitions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS fields_admin ON public.profile_field_definitions;
CREATE POLICY fields_admin ON public.profile_field_definitions FOR ALL TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
