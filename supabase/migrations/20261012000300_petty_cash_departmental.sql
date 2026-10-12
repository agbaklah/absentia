-- Petty cash becomes departmental, and splits into two kinds of request.
--
-- Two kinds
--   advance        money asked for BEFORE the errand. No receipt to submit —
--                  there is nothing to show yet.
--   out_of_pocket  the employee already paid with their own money and wants
--                  it back. At least one receipt is required, as before.
--   Existing rows are all receipt-backed, so they become out_of_pocket.
--
-- Two stages
--   draft → submitted → approved → paid
--                    ↘ rejected ↙
--   submitted → approved|rejected  the claimant's DEPARTMENT HEAD decides
--                                  (Engineering & Solar and Fleet/Logistics
--                                  reach the CTO, Sales/Tech the CFO), falling
--                                  back to admins / CFO / super admins when a
--                                  team has no head, or the head is the one
--                                  claiming. Delegations and approval
--                                  exclusions are honoured.
--   approved → paid                the CFO pays, never their own claim.
--
-- Every rule is enforced here, not only in the UI.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_kind') THEN
    CREATE TYPE public.expense_kind AS ENUM ('advance','out_of_pocket');
  END IF;
END$$;

ALTER TABLE public.expense_claims
  ADD COLUMN IF NOT EXISTS kind public.expense_kind NOT NULL DEFAULT 'out_of_pocket';

COMMENT ON COLUMN public.expense_claims.kind IS
  'advance = money before the errand (no receipt to submit); out_of_pocket = paid with own money, receipt required.';

-- The head approved it; the CFO pays. Recorded separately from reviewed_by so
-- the trail shows both hands.
ALTER TABLE public.expense_claims
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Backfill the trail for claims already approved under the CFO-only rules.
UPDATE public.expense_claims
   SET approved_by = reviewed_by, approved_at = reviewed_at
 WHERE status IN ('approved','paid') AND approved_by IS NULL;

-- ---------------------------------------------------------------------------
-- Who decides on a claim
-- ---------------------------------------------------------------------------
-- Approvers: the claimant's department head, else admins / CFO / super admins.
-- Mirrors leave_approvers_for() so one person's authority means the same thing
-- in both halves of the app.
CREATE OR REPLACE FUNCTION public.expense_approvers_for(_claimant UUID)
RETURNS SETOF UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH claimant AS (
    SELECT c.team_id, t.manager_id AS head
    FROM public.profiles c LEFT JOIN public.teams t ON t.id = c.team_id
    WHERE c.id = _claimant
  ),
  direct AS (
    -- The department head, when there is one and it is not the claimant …
    SELECT head AS id FROM claimant WHERE head IS NOT NULL AND head <> _claimant
    UNION
    -- … otherwise whoever carries org-wide authority.
    SELECT p.id FROM public.profiles p, claimant
    WHERE p.active AND p.id <> _claimant
      AND (claimant.head IS NULL OR claimant.head = _claimant)
      AND p.role IN ('admin','super_admin','cfo')
  ),
  all_approvers AS (
    SELECT id FROM direct WHERE id <> _claimant
    UNION
    SELECT d.delegate_id FROM public.approval_delegations d
    JOIN direct ON direct.id = d.delegator_id
    WHERE CURRENT_DATE BETWEEN d.start_date AND d.end_date AND d.delegate_id <> _claimant
  )
  SELECT a.id FROM all_approvers a
  JOIN public.profiles p ON p.id = a.id AND p.active AND p.role <> 'viewer'
  WHERE NOT EXISTS (SELECT 1 FROM public.approval_exclusions x
                    WHERE x.approver_id = a.id AND x.employee_id = _claimant);
$$;

-- Can the caller approve / reject this particular claim?
CREATE OR REPLACE FUNCTION public.can_approve_claim_for(_claimant UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.current_profile_id() IS NOT NULL
     AND public.current_profile_id() <> _claimant
     AND public.current_profile_id() IN (SELECT public.expense_approvers_for(_claimant));
$$;

-- Payment is the CFO's alone (super admin as fallback), never their own claim.
CREATE OR REPLACE FUNCTION public.can_pay_claims()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_role('cfo') OR public.has_role('super_admin');
$$;

-- A department head needs to see their own team's claims; everyone with
-- org-wide finance visibility keeps what they had.
CREATE OR REPLACE FUNCTION public.can_see_claim_of(_claimant UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.can_review_expenses()
      OR public.has_role('super_admin')
      OR public.has_role('viewer')
      OR EXISTS (
           SELECT 1 FROM public.profiles c JOIN public.teams t ON t.id = c.team_id
           WHERE c.id = _claimant AND t.manager_id = public.current_profile_id()
         )
      OR public.can_approve_claim_for(_claimant);
$$;

-- ---------------------------------------------------------------------------
-- RLS: widen read + update to the department head
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS claims_read ON public.expense_claims;
CREATE POLICY claims_read ON public.expense_claims FOR SELECT TO authenticated
  USING (claimant_id = public.current_profile_id() OR public.can_see_claim_of(claimant_id));

DROP POLICY IF EXISTS claims_update ON public.expense_claims;
CREATE POLICY claims_update ON public.expense_claims FOR UPDATE TO authenticated
  USING (
    claimant_id = public.current_profile_id()
    OR public.can_approve_claim_for(claimant_id)
    OR public.can_pay_claims()
  )
  WITH CHECK (true);

DROP POLICY IF EXISTS receipts_read ON public.expense_receipts;
CREATE POLICY receipts_read ON public.expense_receipts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.expense_claims c WHERE c.id = claim_id
      AND (c.claimant_id = public.current_profile_id() OR public.can_see_claim_of(c.claimant_id))
  ));

-- Receipt files in storage follow the same rule.
DROP POLICY IF EXISTS receipts_read ON storage.objects;
CREATE POLICY receipts_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (
      (storage.foldername(name))[1] = public.current_profile_id()::text
      OR public.can_see_claim_of(((storage.foldername(name))[1])::uuid)
    )
  );

-- ---------------------------------------------------------------------------
-- State machine
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expense_claim_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  me UUID := public.current_profile_id();
  is_owner BOOLEAN := (me = OLD.claimant_id);
  is_approver BOOLEAN := public.can_approve_claim_for(OLD.claimant_id);
  is_payer BOOLEAN := public.can_pay_claims() AND me <> OLD.claimant_id;
  limit_amt NUMERIC;
  content_changed BOOLEAN;
BEGIN
  -- service_role / migrations bypass (no user session).
  IF me IS NULL THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.claimant_id <> OLD.claimant_id OR NEW.claim_no <> OLD.claim_no
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Claim identity cannot be changed.';
  END IF;

  content_changed :=
       NEW.title <> OLD.title OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.category <> OLD.category OR NEW.amount <> OLD.amount
    OR NEW.currency <> OLD.currency OR NEW.expense_date <> OLD.expense_date
    OR NEW.kind <> OLD.kind;

  IF content_changed AND NOT (is_owner AND OLD.status = 'draft' AND NEW.status = 'draft') THEN
    RAISE EXCEPTION 'Claim details can only be edited by the claimant while it is a draft.';
  END IF;

  IF NEW.status = OLD.status THEN
    IF OLD.status <> 'draft' AND (
         NEW.decision_note IS DISTINCT FROM OLD.decision_note
      OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR NEW.payment_ref IS DISTINCT FROM OLD.payment_ref
      OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.paid_by IS DISTINCT FROM OLD.paid_by) THEN
      RAISE EXCEPTION 'A % claim cannot be modified.', OLD.status;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Transitions -------------------------------------------------------------
  IF OLD.status = 'draft' AND NEW.status = 'submitted' THEN
    IF NOT is_owner THEN RAISE EXCEPTION 'Only the claimant can submit a claim.'; END IF;
    -- An advance has nothing to show yet; money already spent must be evidenced.
    IF NEW.kind = 'out_of_pocket'
       AND NOT EXISTS (SELECT 1 FROM public.expense_receipts WHERE claim_id = OLD.id) THEN
      RAISE EXCEPTION 'Attach at least one receipt before submitting.';
    END IF;
    SELECT petty_cash_limit INTO limit_amt FROM public.app_settings WHERE key = 'default';
    IF limit_amt IS NOT NULL AND limit_amt > 0 AND NEW.amount > limit_amt THEN
      RAISE EXCEPTION 'Claim exceeds the petty cash limit of %.', limit_amt;
    END IF;
    NEW.submitted_at := now();
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.decision_note := NULL;
    NEW.approved_by := NULL; NEW.approved_at := NULL;

  ELSIF OLD.status = 'submitted' AND NEW.status = 'draft' THEN
    IF NOT is_owner THEN RAISE EXCEPTION 'Only the claimant can withdraw a claim.'; END IF;
    NEW.submitted_at := NULL;

  ELSIF OLD.status = 'rejected' AND NEW.status = 'draft' THEN
    IF NOT is_owner THEN RAISE EXCEPTION 'Only the claimant can reopen a rejected claim.'; END IF;
    NEW.submitted_at := NULL;
    NEW.approved_by := NULL; NEW.approved_at := NULL;

  ELSIF OLD.status = 'submitted' AND NEW.status IN ('approved','rejected') THEN
    IF NOT is_approver THEN
      RAISE EXCEPTION 'Only this department''s head can approve or reject the claim (never their own).';
    END IF;
    NEW.reviewed_by := me; NEW.reviewed_at := now();
    IF NEW.status = 'approved' THEN
      NEW.approved_by := me; NEW.approved_at := now();
    END IF;

  ELSIF OLD.status = 'approved' AND NEW.status = 'rejected' THEN
    -- Either hand may stop it before the money leaves.
    IF NOT (is_approver OR is_payer) THEN
      RAISE EXCEPTION 'Only the department head or the CFO can reject an approved claim.';
    END IF;
    NEW.reviewed_by := me; NEW.reviewed_at := now();

  ELSIF OLD.status = 'approved' AND NEW.status = 'paid' THEN
    IF NOT is_payer THEN RAISE EXCEPTION 'Only the CFO can mark a claim as paid.'; END IF;
    IF NEW.payment_method IS NULL THEN RAISE EXCEPTION 'Choose a payment method.'; END IF;
    NEW.paid_by := me; NEW.paid_at := now();

  ELSE
    RAISE EXCEPTION 'Cannot move a claim from % to %.', OLD.status, NEW.status;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;$$;

-- ---------------------------------------------------------------------------
-- Notifications: each stage tells the hand that has to act next
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expense_claim_after_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  me UUID := public.current_profile_id();
  claimant_name TEXT;
  recipient UUID;
  amount_txt TEXT;
  kind_txt TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN RETURN NULL; END IF;

  INSERT INTO public.audit_log(actor_id, action, entity, entity_id, before, after)
  VALUES (
    me,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE NEW.status::text END,
    'expense_claim', NEW.id::text,
    CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('status', OLD.status) END,
    jsonb_build_object('status', NEW.status, 'claim_no', NEW.claim_no, 'amount', NEW.amount,
                       'currency', NEW.currency, 'title', NEW.title, 'kind', NEW.kind)
  );

  IF TG_OP = 'INSERT' THEN RETURN NULL; END IF;

  SELECT full_name INTO claimant_name FROM public.profiles WHERE id = NEW.claimant_id;
  amount_txt := NEW.currency || ' ' || to_char(NEW.amount, 'FM999,999,990.00');
  kind_txt := CASE WHEN NEW.kind = 'advance' THEN 'cash advance' ELSE 'out-of-pocket claim' END;

  IF NEW.status = 'submitted' THEN
    -- To whoever approves for this department, plus a super admin copy.
    FOR recipient IN
      SELECT public.expense_approvers_for(NEW.claimant_id)
      UNION
      SELECT id FROM public.profiles
      WHERE active AND role = 'super_admin' AND id <> NEW.claimant_id
    LOOP
      PERFORM public.notify(recipient, 'expense.submitted',
        claimant_name || ' submitted a ' || kind_txt,
        '#' || NEW.claim_no || ' · ' || NEW.title || ' · ' || amount_txt, '/expenses/review');
    END LOOP;

  ELSIF NEW.status = 'approved' THEN
    PERFORM public.notify(NEW.claimant_id, 'expense.approved',
      'Claim #' || NEW.claim_no || ' approved',
      NEW.title || ' · ' || amount_txt || ' · awaiting payment' ||
        COALESCE(' · “' || NULLIF(btrim(NEW.decision_note), '') || '”', ''),
      '/expenses');
    -- Hand over to the CFO: it is their turn to pay.
    FOR recipient IN
      SELECT id FROM public.profiles
      WHERE active AND role IN ('cfo','super_admin') AND id <> NEW.claimant_id
    LOOP
      PERFORM public.notify(recipient, 'expense.approved',
        claimant_name || ' · claim #' || NEW.claim_no || ' approved — ready to pay',
        NEW.title || ' · ' || amount_txt, '/expenses/review');
    END LOOP;

  ELSIF NEW.status IN ('rejected','paid') THEN
    PERFORM public.notify(NEW.claimant_id, 'expense.' || NEW.status,
      'Claim #' || NEW.claim_no || ' ' || NEW.status,
      NEW.title || ' · ' || amount_txt ||
        CASE WHEN NEW.status = 'paid' AND NEW.payment_method IS NOT NULL
             THEN ' · via ' || replace(NEW.payment_method::text, '_', ' ') ELSE '' END ||
        COALESCE(' · “' || NULLIF(btrim(NEW.decision_note), '') || '”', ''),
      '/expenses');
    -- Oversight copy to super admins, and to the head who approved it.
    FOR recipient IN
      SELECT id FROM public.profiles
      WHERE active AND role = 'super_admin' AND id <> NEW.claimant_id
      UNION
      SELECT NEW.approved_by WHERE NEW.approved_by IS NOT NULL
         AND NEW.approved_by <> NEW.claimant_id AND NEW.approved_by <> me
    LOOP
      PERFORM public.notify(recipient, 'expense.' || NEW.status,
        claimant_name || ' · claim #' || NEW.claim_no || ' ' || NEW.status,
        NEW.title || ' · ' || amount_txt ||
          CASE WHEN NEW.status = 'paid' AND NEW.payment_method IS NOT NULL
               THEN ' · via ' || replace(NEW.payment_method::text, '_', ' ') ELSE '' END,
        '/expenses/review');
    END LOOP;
  END IF;
  RETURN NULL;
END;$$;

-- ---------------------------------------------------------------------------
-- The 24-hour chase follows the same split: a submitted claim chases the
-- department head, an approved one chases the CFO who still has to pay.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expense_deciders_for(_claimant UUID)
RETURNS SETOF UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.expense_approvers_for(_claimant);
$$;

CREATE OR REPLACE FUNCTION public.expense_payers_for(_claimant UUID)
RETURNS SETOF UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM public.profiles
  WHERE active AND role IN ('cfo','super_admin') AND id <> _claimant;
$$;

CREATE OR REPLACE FUNCTION public.remind_stale_expense_claims()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  c RECORD;
  recipient UUID;
  amount_txt TEXT;
  waiting_for TEXT;
  waiting_since TIMESTAMPTZ;
  hours INTEGER;
  age_txt TEXT;
  chased INTEGER := 0;
BEGIN
  FOR c IN
    SELECT ec.*, p.full_name AS claimant_name
    FROM public.expense_claims ec
    JOIN public.profiles p ON p.id = ec.claimant_id
    WHERE ec.status IN ('submitted', 'approved')
      AND now() - GREATEST(
            CASE WHEN ec.status = 'submitted' THEN ec.submitted_at ELSE ec.reviewed_at END,
            COALESCE(ec.last_reminded_at, '-infinity'::timestamptz)
          ) >= interval '24 hours'
    ORDER BY ec.claim_no
  LOOP
    amount_txt := c.currency || ' ' || to_char(c.amount, 'FM999,999,990.00');
    waiting_since := CASE WHEN c.status = 'submitted' THEN c.submitted_at ELSE c.reviewed_at END;
    hours := FLOOR(EXTRACT(EPOCH FROM (now() - waiting_since)) / 3600)::int;
    age_txt := CASE WHEN hours >= 48 THEN (hours / 24)::text || ' days'
                    ELSE hours::text || ' hours' END;
    waiting_for := CASE WHEN c.status = 'submitted' THEN 'waiting for approval'
                        ELSE 'approved but not paid' END;

    -- A set-returning function cannot sit inside CASE, so each stage
    -- contributes its own branch and the UNION picks the live one.
    FOR recipient IN
      SELECT public.expense_deciders_for(c.claimant_id) AS id WHERE c.status = 'submitted'
      UNION
      SELECT public.expense_payers_for(c.claimant_id) AS id WHERE c.status = 'approved'
      UNION
      SELECT p.id FROM public.profiles p
      WHERE p.active AND p.role = 'super_admin' AND p.id <> c.claimant_id
    LOOP
      PERFORM public.notify(recipient, 'expense.reminder',
        'Reminder · claim #' || c.claim_no || ' ' || waiting_for || ' for ' || age_txt,
        c.claimant_name || ' · ' || c.title || ' · ' || amount_txt,
        '/expenses/review');
    END LOOP;

    UPDATE public.expense_claims SET last_reminded_at = now() WHERE id = c.id;

    INSERT INTO public.audit_log(actor_id, action, entity, entity_id, after)
    VALUES (NULL, 'reminded', 'expense_claim', c.id::text,
      jsonb_build_object('status', c.status, 'claim_no', c.claim_no,
                         'waiting_hours', hours, 'waiting_for', waiting_for));

    chased := chased + 1;
  END LOOP;

  RETURN chased;
END;$$;
REVOKE ALL ON FUNCTION public.remind_stale_expense_claims() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remind_stale_expense_claims() TO service_role;
