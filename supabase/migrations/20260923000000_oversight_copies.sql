-- Super admins are copied on every leave request and petty-cash claim for
-- oversight. Approval routing is unchanged: the department head (or the CFO
-- for money) still decides; the copy is informational.

CREATE OR REPLACE FUNCTION public.leave_approvers_for(_employee UUID)
RETURNS SETOF UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH emp AS (
    SELECT e.team_id, t.manager_id AS head
    FROM public.profiles e LEFT JOIN public.teams t ON t.id = e.team_id
    WHERE e.id = _employee
  ),
  direct AS (
    SELECT head AS id FROM emp WHERE head IS NOT NULL
    UNION
    SELECT p.id FROM public.profiles p, emp
    WHERE p.active AND p.id <> _employee
      AND emp.head IS NULL
      AND (p.role IN ('admin','super_admin','cfo')
           OR (p.role = 'manager' AND p.team_id IS NOT NULL AND p.team_id = emp.team_id))
    UNION
    -- Oversight copy: super admins always hear about leave requests.
    SELECT p.id FROM public.profiles p WHERE p.active AND p.role = 'super_admin'
  ),
  all_approvers AS (
    SELECT id FROM direct WHERE id <> _employee
    UNION
    SELECT d.delegate_id FROM public.approval_delegations d
    JOIN direct ON direct.id = d.delegator_id
    WHERE CURRENT_DATE BETWEEN d.start_date AND d.end_date AND d.delegate_id <> _employee
  )
  SELECT a.id FROM all_approvers a
  JOIN public.profiles p ON p.id = a.id AND p.active AND p.role <> 'viewer'
  WHERE NOT EXISTS (SELECT 1 FROM public.approval_exclusions x
                    WHERE x.approver_id = a.id AND x.employee_id = _employee);
$$;

-- Petty cash: every active CFO plus super admins (never the claimant).
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
  END IF;
  RETURN NULL;
END;$$;
