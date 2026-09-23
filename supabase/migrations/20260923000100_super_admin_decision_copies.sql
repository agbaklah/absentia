-- Super admins also receive a copy of every decision (leave approved /
-- rejected / cancelled, claim approved / rejected / paid), so the super admin
-- mailbox carries the full trail: request in, decision out.

CREATE OR REPLACE FUNCTION public.notify_leave_decided()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r RECORD; sa UUID;
BEGIN
  FOR r IN
    SELECT n.employee_id, n.status, n.leave_code, MIN(n.date) AS first_day, MAX(n.date) AS last_day,
           COUNT(*) AS days, lt.label,
           (SELECT full_name FROM public.profiles WHERE id = MAX(n.approved_by::text)::uuid) AS by_name,
           (SELECT full_name FROM public.profiles WHERE id = n.employee_id) AS emp_name
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
    -- Oversight copy.
    FOR sa IN SELECT id FROM public.profiles
              WHERE active AND role = 'super_admin' AND id <> r.employee_id
    LOOP
      PERFORM public.notify(sa, 'leave.' || r.status,
        r.emp_name || ' · ' || r.label || ' ' || r.status,
        r.days || ' day' || CASE WHEN r.days = 1 THEN '' ELSE 's' END || ' · ' ||
          to_char(r.first_day, 'DD Mon') ||
          CASE WHEN r.first_day <> r.last_day THEN ' → ' || to_char(r.last_day, 'DD Mon') ELSE '' END ||
          COALESCE(' · by ' || r.by_name, ''),
        '/requests');
    END LOOP;
  END LOOP;
  RETURN NULL;
END;$$;

CREATE OR REPLACE FUNCTION public.expense_claim_after_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  me UUID := public.current_profile_id();
  claimant_name TEXT;
  reviewer UUID;
  amount_txt TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN RETURN NULL; END IF;

  INSERT INTO public.audit_log(actor_id, action, entity, entity_id, before, after)
  VALUES (
    me,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE NEW.status::text END,
    'expense_claim', NEW.id::text,
    CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('status', OLD.status) END,
    jsonb_build_object('status', NEW.status, 'claim_no', NEW.claim_no, 'amount', NEW.amount,
                       'currency', NEW.currency, 'title', NEW.title)
  );

  IF TG_OP = 'INSERT' THEN RETURN NULL; END IF;

  SELECT full_name INTO claimant_name FROM public.profiles WHERE id = NEW.claimant_id;
  amount_txt := NEW.currency || ' ' || to_char(NEW.amount, 'FM999,999,990.00');

  IF NEW.status = 'submitted' THEN
    FOR reviewer IN
      SELECT id FROM public.profiles
      WHERE active AND role IN ('cfo','super_admin') AND id <> NEW.claimant_id
    LOOP
      PERFORM public.notify(reviewer, 'expense.submitted',
        claimant_name || ' submitted a petty cash claim',
        '#' || NEW.claim_no || ' · ' || NEW.title || ' · ' || amount_txt, '/expenses/review');
    END LOOP;
  ELSIF NEW.status IN ('approved','rejected','paid') THEN
    PERFORM public.notify(NEW.claimant_id, 'expense.' || NEW.status,
      'Claim #' || NEW.claim_no || ' ' || NEW.status,
      NEW.title || ' · ' || amount_txt ||
        CASE WHEN NEW.status = 'paid' AND NEW.payment_method IS NOT NULL
             THEN ' · via ' || replace(NEW.payment_method::text, '_', ' ') ELSE '' END ||
        COALESCE(' · “' || NULLIF(btrim(NEW.decision_note), '') || '”', ''),
      '/expenses');
    -- Oversight copy.
    FOR reviewer IN
      SELECT id FROM public.profiles
      WHERE active AND role = 'super_admin' AND id <> NEW.claimant_id
    LOOP
      PERFORM public.notify(reviewer, 'expense.' || NEW.status,
        claimant_name || ' · claim #' || NEW.claim_no || ' ' || NEW.status,
        NEW.title || ' · ' || amount_txt ||
          CASE WHEN NEW.status = 'paid' AND NEW.payment_method IS NOT NULL
               THEN ' · via ' || replace(NEW.payment_method::text, '_', ' ') ELSE '' END,
        '/expenses/review');
    END LOOP;
  END IF;
  RETURN NULL;
END;$$;
