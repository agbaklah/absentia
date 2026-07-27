
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin','manager','employee');
CREATE TYPE public.leave_status AS ENUM ('pending','approved','rejected');

-- Teams
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  manager_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- Profiles: employees (may or may not have an auth user)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role public.app_role NOT NULL DEFAULT 'employee',
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  employment_start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX profiles_team_idx ON public.profiles(team_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.teams
  ADD CONSTRAINT teams_manager_fk FOREIGN KEY (manager_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Leave types
CREATE TABLE public.leave_types (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  counts_as_days NUMERIC(3,1) NOT NULL DEFAULT 1,
  colour_hex TEXT NOT NULL
);
GRANT SELECT ON public.leave_types TO authenticated, anon;
GRANT ALL ON public.leave_types TO service_role;
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leave_types_read" ON public.leave_types FOR SELECT USING (true);

-- Leave entries
CREATE TABLE public.leave_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  leave_code TEXT NOT NULL REFERENCES public.leave_types(code),
  note TEXT,
  status public.leave_status NOT NULL DEFAULT 'approved',
  requested_by UUID REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, date)
);
CREATE INDEX leave_entries_date_idx ON public.leave_entries(date);
CREATE INDEX leave_entries_employee_idx ON public.leave_entries(employee_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_entries TO authenticated;
GRANT ALL ON public.leave_entries TO service_role;
ALTER TABLE public.leave_entries ENABLE ROW LEVEL SECURITY;

-- Allowances
CREATE TABLE public.leave_allowances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year INT NOT NULL,
  vacation_allowance_days NUMERIC(4,1) NOT NULL DEFAULT 24,
  carried_over_days NUMERIC(4,1) NOT NULL DEFAULT 0,
  adjustment_days NUMERIC(4,1) NOT NULL DEFAULT 0,
  UNIQUE(employee_id, year)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_allowances TO authenticated;
GRANT ALL ON public.leave_allowances TO service_role;
ALTER TABLE public.leave_allowances ENABLE ROW LEVEL SECURITY;

-- Public holidays
CREATE TABLE public.public_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'UK',
  UNIQUE(date, region)
);
GRANT SELECT ON public.public_holidays TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.public_holidays TO authenticated;
GRANT ALL ON public.public_holidays TO service_role;
ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hols_read" ON public.public_holidays FOR SELECT USING (true);

-- Audit log
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before JSONB,
  after JSONB,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Settings (single row keyed by 'default')
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  default_allowance_days NUMERIC(4,1) NOT NULL DEFAULT 24,
  carryover_cap_days NUMERIC(4,1) NOT NULL DEFAULT 5,
  working_days INT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5], -- Mon..Fri (ISO dow)
  max_concurrent_absent INT NOT NULL DEFAULT 3,
  sick_threshold_days NUMERIC(4,1) NOT NULL DEFAULT 8
);
GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_read" ON public.app_settings FOR SELECT USING (true);
INSERT INTO public.app_settings(key) VALUES ('default') ON CONFLICT DO NOTHING;

-- Helper: current user's profile id
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS public.app_role LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT role FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_team_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT team_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE auth_user_id = auth.uid() AND role = _role);
$$;

-- Profiles RLS
CREATE POLICY "profiles_self_read" ON public.profiles FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR public.has_role('admin')
    OR public.has_role('manager')
    OR true  -- everyone in the org can see the directory (names/teams)
  );
CREATE POLICY "profiles_admin_write" ON public.profiles FOR ALL TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid());

-- Teams RLS
CREATE POLICY "teams_read_all" ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "teams_admin_write" ON public.teams FOR ALL TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Leave entries RLS
CREATE POLICY "entries_read" ON public.leave_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "entries_self_write" ON public.leave_entries FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = public.current_profile_id()
    OR public.has_role('admin')
    OR (public.has_role('manager') AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = employee_id AND p.team_id = public.current_team_id()
    ))
  );
CREATE POLICY "entries_update" ON public.leave_entries FOR UPDATE TO authenticated
  USING (
    employee_id = public.current_profile_id()
    OR public.has_role('admin')
    OR (public.has_role('manager') AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = employee_id AND p.team_id = public.current_team_id()
    ))
  ) WITH CHECK (true);
CREATE POLICY "entries_delete" ON public.leave_entries FOR DELETE TO authenticated
  USING (
    employee_id = public.current_profile_id()
    OR public.has_role('admin')
    OR (public.has_role('manager') AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = employee_id AND p.team_id = public.current_team_id()
    ))
  );

-- Allowances RLS
CREATE POLICY "allow_read" ON public.leave_allowances FOR SELECT TO authenticated USING (true);
CREATE POLICY "allow_admin" ON public.leave_allowances FOR ALL TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Public holidays admin write
CREATE POLICY "hols_admin_write" ON public.public_holidays FOR ALL TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- App settings admin write
CREATE POLICY "settings_admin_write" ON public.app_settings FOR ALL TO authenticated
  USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Audit log write open (server logs); read admin only
CREATE POLICY "audit_insert" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "audit_read_admin" ON public.audit_log FOR SELECT TO authenticated USING (public.has_role('admin'));

-- Handle auth signup: create/attach profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE existing_id UUID;
BEGIN
  -- If a demo profile with this email exists and has no auth link, attach it.
  SELECT id INTO existing_id FROM public.profiles WHERE lower(email) = lower(NEW.email) AND auth_user_id IS NULL LIMIT 1;
  IF existing_id IS NOT NULL THEN
    UPDATE public.profiles SET auth_user_id = NEW.id WHERE id = existing_id;
  ELSE
    INSERT INTO public.profiles (auth_user_id, full_name, email, role)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email, 'admin'); -- first signups become admin for convenience
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed leave types
INSERT INTO public.leave_types (code, label, category, counts_as_days, colour_hex) VALUES
  ('L','Vacation Leave (Full Day)','vacation',1,'#166534'),
  ('L1','Vacation Leave (Morning)','vacation',0.5,'#22c55e'),
  ('L2','Vacation Leave (Afternoon)','vacation',0.5,'#4ade80'),
  ('S','Sickness Leave (Full Day)','sick',1,'#dc2626'),
  ('S1','Sickness Leave (Morning)','sick',0.5,'#f87171'),
  ('S2','Sickness Leave (Afternoon)','sick',0.5,'#fca5a5'),
  ('P','Maternity or Paternity','parental',1,'#8b5cf6'),
  ('C','Compassionate Leave','compassionate',1,'#0ea5e9'),
  ('T','TOIL (Time Off In Lieu)','toil',1,'#d97706'),
  ('W','Work From Home','wfh',1,'#64748b'),
  ('B','Bank Holiday','holiday',0,'#94a3b8');

-- Seed teams
INSERT INTO public.teams (name) VALUES ('Engineers'), ('Sales/Tech'), ('Logistics');

-- Seed 2026 UK bank holidays
INSERT INTO public.public_holidays (date, name) VALUES
  ('2026-01-01','New Year''s Day'),
  ('2026-04-03','Good Friday'),
  ('2026-04-06','Easter Monday'),
  ('2026-05-04','Early May Bank Holiday'),
  ('2026-05-25','Spring Bank Holiday'),
  ('2026-08-31','Summer Bank Holiday'),
  ('2026-12-25','Christmas Day'),
  ('2026-12-28','Boxing Day (Substitute)');
