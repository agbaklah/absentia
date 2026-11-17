-- The claimant can close out a claim the CFO has paid but never recorded.
--
-- The gap this fills: the CFO pays by mobile money or transfer outside the
-- app and forgets to press "Mark as paid". The money is in the employee's
-- hands, but the claim sits in "approved" forever, and the 24-hour chase
-- keeps firing at a CFO who has already done the work.
--
-- What the claimant does is NOT the same act as the CFO's. The CFO attests
-- that money left the company; the claimant attests that money reached them.
-- Both land the claim in 'paid', but the row remembers which one happened,
-- so the CFO can still reconcile against the bank and nobody has to guess
-- whether a payment reference was ever captured.
--
--   paid_confirmed_by_recipient = false  the CFO recorded the payment
--   paid_confirmed_by_recipient = true   the employee confirmed receipt
--
-- Guards: only the claimant themselves, only on their own claim, only once
-- the claim has been approved for 24 hours (so the CFO has had a full day
-- and at least one reminder to record it properly first), and they must say
-- how the money arrived.

ALTER TABLE public.expense_claims
  ADD COLUMN IF NOT EXISTS paid_confirmed_by_recipient BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.expense_claims.paid_confirmed_by_recipient IS
  'true = the employee confirmed the money reached them; false = the CFO recorded the payment.';

-- How long the CFO keeps the sole right to record the payment.
CREATE OR REPLACE FUNCTION public.receipt_confirmation_delay()
RETURNS INTERVAL LANGUAGE SQL IMMUTABLE AS $$ SELECT interval '24 hours' $$;

-- May the caller confirm they received this claim's money?
CREATE OR REPLACE FUNCTION public.can_confirm_receipt(_claim UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.expense_claims c
    WHERE c.id = _claim
      AND c.status = 'approved'
      AND c.claimant_id = public.current_profile_id()
      AND c.approved_at IS NOT NULL
      AND now() - c.approved_at >= public.receipt_confirmation_delay()
  );
$$;

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
      OR NEW.paid_by IS DISTINCT FROM OLD.paid_by
      OR NEW.paid_confirmed_by_recipient IS DISTINCT FROM OLD.paid_confirmed_by_recipient) THEN
      RAISE EXCEPTION 'A % claim cannot be modified.', OLD.status;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Transitions -------------------------------------------------------------
  IF OLD.status = 'draft' AND NEW.status = 'submitted' THEN
    IF NOT is_owner THEN RAISE EXCEPTION 'Only the claimant can submit a claim.'; END IF;
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
    IF NOT (is_approver OR is_payer) THEN
      RAISE EXCEPTION 'Only the department head or the CFO can reject an approved claim.';
    END IF;
    NEW.reviewed_by := me; NEW.reviewed_at := now();

  ELSIF OLD.status = 'approved' AND NEW.status = 'paid' THEN
    IF NEW.payment_method IS NULL THEN RAISE EXCEPTION 'Choose a payment method.'; END IF;
    IF is_payer THEN
      -- The CFO recording that the money left.
      NEW.paid_by := me; NEW.paid_at := now();
      NEW.paid_confirmed_by_recipient := false;
    ELSIF is_owner THEN
      -- The employee confirming the money arrived, once the CFO has had a day.
      IF OLD.approved_at IS NULL
         OR now() - OLD.approved_at < public.receipt_confirmation_delay() THEN
        RAISE EXCEPTION
          'You can confirm you were paid 24 hours after approval, if the CFO has not recorded it by then.';
      END IF;
      NEW.paid_by := me; NEW.paid_at := now();
      NEW.paid_confirmed_by_recipient := true;
    ELSE
      RAISE EXCEPTION 'Only the CFO, or the claimant confirming receipt, can mark a claim as paid.';
    END IF;

  ELSE
    RAISE EXCEPTION 'Cannot move a claim from % to %.', OLD.status, NEW.status;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;$$;

-- ---------------------------------------------------------------------------
-- Notifications: a self-confirmed payment has to reach the CFO, because the
-- books still need the reference the employee cannot supply.
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
    CASE WHEN TG_OP = 'INSERT' THEN 'created'
         WHEN NEW.status = 'paid' AND NEW.paid_confirmed_by_recipient THEN 'receipt_confirmed'
         ELSE NEW.status::text END,
    'expense_claim', NEW.id::text,
    CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('status', OLD.status) END,
    jsonb_build_object('status', NEW.status, 'claim_no', NEW.claim_no, 'amount', NEW.amount,
                       'currency', NEW.currency, 'title', NEW.title, 'kind', NEW.kind,
                       'confirmed_by_recipient', NEW.paid_confirmed_by_recipient)
  );

  IF TG_OP = 'INSERT' THEN RETURN NULL; END IF;

  SELECT full_name INTO claimant_name FROM public.profiles WHERE id = NEW.claimant_id;
  amount_txt := NEW.currency || ' ' || to_char(NEW.amount, 'FM999,999,990.00');
  kind_txt := CASE WHEN NEW.kind = 'advance' THEN 'cash advance' ELSE 'out-of-pocket claim' END;

  IF NEW.status = 'submitted' THEN
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
    FOR recipient IN
      SELECT id FROM public.profiles
      WHERE active AND role IN ('cfo','super_admin') AND id <> NEW.claimant_id
    LOOP
      PERFORM public.notify(recipient, 'expense.approved',
        claimant_name || ' · claim #' || NEW.claim_no || ' approved — ready to pay',
        NEW.title || ' · ' || amount_txt, '/expenses/review');
    END LOOP;

  ELSIF NEW.status = 'paid' AND NEW.paid_confirmed_by_recipient THEN
    -- The employee closed it themselves. The CFO still has to reconcile it.
    FOR recipient IN
      SELECT id FROM public.profiles
      WHERE active AND role IN ('cfo','super_admin') AND id <> NEW.claimant_id
      UNION
      SELECT NEW.approved_by WHERE NEW.approved_by IS NOT NULL
         AND NEW.approved_by <> NEW.claimant_id
    LOOP
      PERFORM public.notify(recipient, 'expense.receipt_confirmed',
        claimant_name || ' confirmed they were paid · claim #' || NEW.claim_no,
        NEW.title || ' · ' || amount_txt ||
          CASE WHEN NEW.payment_method IS NOT NULL
               THEN ' · they say via ' || replace(NEW.payment_method::text, '_', ' ') ELSE '' END ||
          ' · reconcile and add the reference',
        '/expenses/review');
    END LOOP;
    PERFORM public.notify(NEW.claimant_id, 'expense.paid',
      'Claim #' || NEW.claim_no || ' closed',
      NEW.title || ' · ' || amount_txt || ' · you confirmed you were paid', '/expenses');

  ELSIF NEW.status IN ('rejected','paid') THEN
    PERFORM public.notify(NEW.claimant_id, 'expense.' || NEW.status,
      'Claim #' || NEW.claim_no || ' ' || NEW.status,
      NEW.title || ' · ' || amount_txt ||
        CASE WHEN NEW.status = 'paid' AND NEW.payment_method IS NOT NULL
             THEN ' · via ' || replace(NEW.payment_method::text, '_', ' ') ELSE '' END ||
        COALESCE(' · “' || NULLIF(btrim(NEW.decision_note), '') || '”', ''),
      '/expenses');
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
