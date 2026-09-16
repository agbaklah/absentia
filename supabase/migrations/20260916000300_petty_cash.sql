-- Petty cash / expense reimbursement.
--
-- Lifecycle:  draft → submitted → approved → paid
--                       ↓            ↓
--                    rejected     rejected
--   claimant: create draft, edit/delete draft, submit (needs ≥1 receipt),
--             withdraw (submitted → draft), reopen rejected (→ draft).
--   reviewer (cfo, or super_admin as fallback): approve / reject a submitted
--             claim, reject an approved-but-unpaid claim, mark approved as
--             paid (payment method + reference). Never their own claim.
--   admin:    read-only visibility of all claims (reporting).
-- Every rule below is enforced in the database, not just the UI.

CREATE TYPE public.expense_status AS ENUM ('draft','submitted','approved','rejected','paid');
CREATE TYPE public.payment_method AS ENUM ('cash','momo','bank_transfer');

CREATE SEQUENCE IF NOT EXISTS public.expense_claim_no_seq START 1001;

CREATE TABLE public.expense_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_no INT NOT NULL UNIQUE DEFAULT nextval('public.expense_claim_no_seq'),
  claimant_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  description TEXT,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('fuel','transport','meals','supplies','accommodation','communication','maintenance','other')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'GHS',
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status public.expense_status NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  decision_note TEXT,
  paid_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  payment_method public.payment_method,
  payment_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expense_claims_claimant_idx ON public.expense_claims(claimant_id, created_at DESC);
CREATE INDEX expense_claims_status_idx ON public.expense_claims(status, submitted_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_claims TO authenticated;
GRANT ALL ON public.expense_claims TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.expense_claim_no_seq TO authenticated;
ALTER TABLE public.expense_claims ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.expense_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES public.expense_claims(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,   -- <claimant profile id>/<claim id>/<file>
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL CHECK (size_bytes > 0),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expense_receipts_claim_idx ON public.expense_receipts(claim_id);
GRANT SELECT, INSERT, DELETE ON public.expense_receipts TO authenticated;
GRANT ALL ON public.expense_receipts TO service_role;
ALTER TABLE public.expense_receipts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------------
-- Who may decide on claims: the CFO, with super admin as fallback (e.g. for
-- the CFO's own claims). Plain admins only read.
CREATE OR REPLACE FUNCTION public.can_decide_expenses()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_role('cfo') OR public.has_role('super_admin');
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
CREATE POLICY claims_read ON public.expense_claims FOR SELECT TO authenticated
  USING (claimant_id = public.current_profile_id() OR public.can_review_expenses());

CREATE POLICY claims_insert_own_draft ON public.expense_claims FOR INSERT TO authenticated
  WITH CHECK (claimant_id = public.current_profile_id() AND status = 'draft');

-- Row access for update; the transition trigger polices *what* changes.
CREATE POLICY claims_update ON public.expense_claims FOR UPDATE TO authenticated
  USING (claimant_id = public.current_profile_id() OR public.can_decide_expenses())
  WITH CHECK (true);

CREATE POLICY claims_delete_own_draft ON public.expense_claims FOR DELETE TO authenticated
  USING (claimant_id = public.current_profile_id() AND status = 'draft');

CREATE POLICY receipts_read ON public.expense_receipts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.expense_claims c WHERE c.id = claim_id
      AND (c.claimant_id = public.current_profile_id() OR public.can_review_expenses())
  ));

-- Receipts can only be attached / removed while the claim is still a draft.
CREATE POLICY receipts_insert_draft ON public.expense_receipts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.expense_claims c WHERE c.id = claim_id
      AND c.claimant_id = public.current_profile_id() AND c.status = 'draft'
  ) AND split_part(storage_path, '/', 1) = public.current_profile_id()::text
    AND split_part(storage_path, '/', 2) = claim_id::text);

CREATE POLICY receipts_delete_draft ON public.expense_receipts FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.expense_claims c WHERE c.id = claim_id
      AND c.claimant_id = public.current_profile_id() AND c.status = 'draft'
  ));

-- ---------------------------------------------------------------------------
-- State machine + audit + notifications
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expense_claim_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  me UUID := public.current_profile_id();
  is_owner BOOLEAN := (me = OLD.claimant_id);
  is_reviewer BOOLEAN := public.can_decide_expenses() AND me <> OLD.claimant_id;
  limit_amt NUMERIC;
  content_changed BOOLEAN;
BEGIN
  -- service_role / migrations bypass (no user session).
  IF me IS NULL THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.claimant_id <> OLD.claimant_id OR NEW.claim_no <> OLD.claim_no OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Claim identity cannot be changed.';
  END IF;

  content_changed :=
       NEW.title <> OLD.title OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.category <> OLD.category OR NEW.amount <> OLD.amount
    OR NEW.currency <> OLD.currency OR NEW.expense_date <> OLD.expense_date;

  -- Content edits: owner only, and only while the claim is (or is returning to) a draft.
  IF content_changed AND NOT (is_owner AND OLD.status = 'draft' AND NEW.status = 'draft') THEN
    RAISE EXCEPTION 'Claim details can only be edited by the claimant while it is a draft.';
  END IF;

  IF NEW.status = OLD.status THEN
    -- No transition: only drafts may change, and only content (handled above).
    IF OLD.status <> 'draft' AND (
         NEW.decision_note IS DISTINCT FROM OLD.decision_note
      OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR NEW.payment_ref IS DISTINCT FROM OLD.payment_ref
      OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
      OR NEW.paid_by IS DISTINCT FROM OLD.paid_by) THEN
      RAISE EXCEPTION 'A % claim cannot be modified.', OLD.status;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Transitions -------------------------------------------------------------
  IF OLD.status = 'draft' AND NEW.status = 'submitted' THEN
    IF NOT is_owner THEN RAISE EXCEPTION 'Only the claimant can submit a claim.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.expense_receipts WHERE claim_id = OLD.id) THEN
      RAISE EXCEPTION 'Attach at least one receipt before submitting.';
    END IF;
    SELECT petty_cash_limit INTO limit_amt FROM public.app_settings WHERE key = 'default';
    IF limit_amt IS NOT NULL AND limit_amt > 0 AND NEW.amount > limit_amt THEN
      RAISE EXCEPTION 'Claim exceeds the petty cash limit of %.', limit_amt;
    END IF;
    NEW.submitted_at := now();
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.decision_note := NULL;

  ELSIF OLD.status = 'submitted' AND NEW.status = 'draft' THEN
    IF NOT is_owner THEN RAISE EXCEPTION 'Only the claimant can withdraw a claim.'; END IF;
    NEW.submitted_at := NULL;

  ELSIF OLD.status = 'rejected' AND NEW.status = 'draft' THEN
    IF NOT is_owner THEN RAISE EXCEPTION 'Only the claimant can reopen a rejected claim.'; END IF;
    NEW.submitted_at := NULL;

  ELSIF OLD.status = 'submitted' AND NEW.status IN ('approved','rejected') THEN
    IF NOT is_reviewer THEN
      RAISE EXCEPTION 'Only the CFO can approve or reject claims (never their own).';
    END IF;
    NEW.reviewed_by := me; NEW.reviewed_at := now();

  ELSIF OLD.status = 'approved' AND NEW.status = 'rejected' THEN
    IF NOT is_reviewer THEN RAISE EXCEPTION 'Only the CFO can reject an approved claim.'; END IF;
    NEW.reviewed_by := me; NEW.reviewed_at := now();

  ELSIF OLD.status = 'approved' AND NEW.status = 'paid' THEN
    IF NOT is_reviewer THEN RAISE EXCEPTION 'Only the CFO can mark a claim as paid.'; END IF;
    IF NEW.payment_method IS NULL THEN RAISE EXCEPTION 'Choose a payment method.'; END IF;
    NEW.paid_by := me; NEW.paid_at := now();

  ELSE
    RAISE EXCEPTION 'Cannot move a claim from % to %.', OLD.status, NEW.status;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS expense_claim_transition ON public.expense_claims;
CREATE TRIGGER expense_claim_transition
  BEFORE UPDATE ON public.expense_claims
  FOR EACH ROW EXECUTE FUNCTION public.expense_claim_transition();

-- Audit + notify after the fact.
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
    -- Tell every CFO; if there is no active CFO, fall back to super admins.
    FOR reviewer IN
      SELECT id FROM public.profiles WHERE active AND role = 'cfo' AND id <> NEW.claimant_id
    LOOP
      PERFORM public.notify(reviewer, 'expense.submitted',
        claimant_name || ' submitted a petty cash claim',
        '#' || NEW.claim_no || ' · ' || NEW.title || ' · ' || amount_txt, '/expenses/review');
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE active AND role = 'cfo' AND id <> NEW.claimant_id) THEN
      FOR reviewer IN
        SELECT id FROM public.profiles WHERE active AND role = 'super_admin' AND id <> NEW.claimant_id
      LOOP
        PERFORM public.notify(reviewer, 'expense.submitted',
          claimant_name || ' submitted a petty cash claim',
          '#' || NEW.claim_no || ' · ' || NEW.title || ' · ' || amount_txt, '/expenses/review');
      END LOOP;
    END IF;
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

DROP TRIGGER IF EXISTS expense_claim_after_change ON public.expense_claims;
CREATE TRIGGER expense_claim_after_change
  AFTER INSERT OR UPDATE ON public.expense_claims
  FOR EACH ROW EXECUTE FUNCTION public.expense_claim_after_change();
