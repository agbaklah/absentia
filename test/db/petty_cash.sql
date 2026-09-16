BEGIN;
DO $$
DECLARE
  kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');
  kwame uuid := (SELECT id FROM profiles WHERE email='kwame@verve-energyresources.com');
  yaw uuid := (SELECT id FROM profiles WHERE email='yaw@verve-energyresources.com');
  claim uuid;
  n int;
BEGIN
  -- Start from a clean slate (rolled back at the end anyway).
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM expense_claims; DELETE FROM audit_log;

  -- Kofi (employee) creates a draft ---------------------------------------
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id, title, category, amount, expense_date)
  VALUES (kofi, 'Fuel for site visit', 'fuel', 350.00, CURRENT_DATE) RETURNING id INTO claim;
  PERFORM pg_temp.check((SELECT status FROM expense_claims WHERE id=claim) = 'draft', 'new claim is draft');

  -- cannot create a claim for someone else, nor non-draft
  PERFORM pg_temp.expect_error(
    format('INSERT INTO expense_claims(claimant_id,title,amount) VALUES (%L,''x'',10)', yaw),
    'row-level security');
  PERFORM pg_temp.expect_error(
    format('INSERT INTO expense_claims(claimant_id,title,amount,status) VALUES (%L,''x'',10,''submitted'')', kofi),
    'row-level security');

  -- submit without receipt is rejected
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET status=''submitted'' WHERE id=%L', claim),
    'Attach at least one receipt');

  -- attach receipt (path must be <claimant>/<claim>/file)
  PERFORM pg_temp.expect_error(
    format('INSERT INTO expense_receipts(claim_id,storage_path,file_name,mime_type,size_bytes) VALUES (%L,%L,''r.jpg'',''image/jpeg'',100)',
           claim, yaw || '/' || claim || '/r.jpg'),
    'row-level security');
  INSERT INTO expense_receipts(claim_id,storage_path,file_name,mime_type,size_bytes)
  VALUES (claim, kofi || '/' || claim || '/r.jpg', 'r.jpg', 'image/jpeg', 12345);

  -- over-limit amount is blocked at submit
  UPDATE expense_claims SET amount = 999999 WHERE id = claim;
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET status=''submitted'' WHERE id=%L', claim),
    'exceeds the petty cash limit');
  UPDATE expense_claims SET amount = 350 WHERE id = claim;

  -- claimant cannot self-approve
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET status=''approved'' WHERE id=%L', claim),
    'Cannot move a claim from draft to approved');

  -- submit
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.check((SELECT submitted_at IS NOT NULL FROM expense_claims WHERE id=claim), 'submitted_at set');
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET status=''approved'' WHERE id=%L', claim),
    'Only the CFO can approve');
  -- no edits after submit
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET amount=1 WHERE id=%L', claim),
    'only be edited by the claimant while it is a draft');
  -- receipts locked after submit
  PERFORM pg_temp.expect_error(
    format('INSERT INTO expense_receipts(claim_id,storage_path,file_name,mime_type,size_bytes) VALUES (%L,%L,''r2.jpg'',''image/jpeg'',100)',
           claim, kofi || '/' || claim || '/r2.jpg'),
    'row-level security');
  -- draft delete only
  DELETE FROM expense_receipts WHERE claim_id = claim;
  PERFORM pg_temp.check((SELECT count(*) FROM expense_receipts WHERE claim_id=claim) = 1, 'receipt not deletable once submitted');
  DELETE FROM expense_claims WHERE id = claim;
  PERFORM pg_temp.check((SELECT count(*) FROM expense_claims WHERE id=claim) = 1, 'submitted claim not deletable');

  -- CFO notified exactly once
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=kwame AND kind='expense.submitted';
  PERFORM pg_temp.check(n = 1, 'cfo got one submitted notification, got ' || n);

  -- Yaw (another employee) cannot see Kofi's claim -------------------------
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT count(*) FROM expense_claims WHERE id=claim) = 0, 'other employee cannot see claim');
  PERFORM pg_temp.check((SELECT count(*) FROM expense_receipts WHERE claim_id=claim) = 0, 'other employee cannot see receipts');

  -- Esi (admin) can read but not decide ------------------------------------
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT count(*) FROM expense_claims WHERE id=claim) = 1, 'admin can read claim');
  UPDATE expense_claims SET status='approved' WHERE id=claim;
  PERFORM pg_temp.check((SELECT status FROM expense_claims WHERE id=claim) = 'submitted', 'admin update filtered by RLS');

  -- Kwame (CFO) approves then pays -----------------------------------------
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT count(*) FROM expense_receipts WHERE claim_id=claim) = 1, 'cfo can see receipts');
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET status=''paid'' WHERE id=%L', claim),
    'Cannot move a claim from submitted to paid');
  UPDATE expense_claims SET status='approved', decision_note='OK' WHERE id=claim;
  PERFORM pg_temp.check((SELECT reviewed_by = kwame FROM expense_claims WHERE id=claim), 'reviewed_by = cfo');
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET status=''paid'' WHERE id=%L', claim),
    'Choose a payment method');
  UPDATE expense_claims SET status='paid', payment_method='momo', payment_ref='MTN-12345' WHERE id=claim;
  PERFORM pg_temp.check((SELECT paid_by = kwame AND paid_at IS NOT NULL FROM expense_claims WHERE id=claim), 'paid fields set');
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET payment_ref=''tamper'' WHERE id=%L', claim),
    'cannot be modified');

  -- claimant notified of approve + paid
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=kofi AND kind IN ('expense.approved','expense.paid');
  PERFORM pg_temp.check(n = 2, 'claimant got approved+paid notifications, got ' || n);
  SELECT count(*) INTO n FROM audit_log WHERE entity='expense_claim' AND entity_id=claim::text;
  PERFORM pg_temp.check(n = 4, 'audit rows created/submitted/approved/paid, got ' || n);

  -- CFO cannot approve own claim; super admin can ---------------------------
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id, title, amount) VALUES (kwame, 'Taxi', 40) RETURNING id INTO claim;
  INSERT INTO expense_receipts(claim_id,storage_path,file_name,mime_type,size_bytes)
  VALUES (claim, kwame || '/' || claim || '/t.pdf', 't.pdf', 'application/pdf', 999);
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET status=''approved'' WHERE id=%L', claim),
    'never their own');
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM notifications WHERE kind='expense.submitted'
    AND recipient_id = (SELECT id FROM profiles WHERE email='verveit@verve-energyresources.com');
  PERFORM pg_temp.check(n = 1, 'super admin notified when the CFO is the claimant, got ' || n);
  PERFORM pg_temp.as_user('verveit@verve-energyresources.com');
  UPDATE expense_claims SET status='rejected', decision_note='Use company car' WHERE id=claim;
  PERFORM pg_temp.check((SELECT status FROM expense_claims WHERE id=claim) = 'rejected', 'super admin rejected cfo claim');
  -- reopen + resubmit path
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  UPDATE expense_claims SET status='draft' WHERE id=claim;
  UPDATE expense_claims SET amount=35 WHERE id=claim;
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.check((SELECT decision_note IS NULL FROM expense_claims WHERE id=claim), 'decision note cleared on resubmit');

  -- Notification hygiene: recipient can mark read, cannot tamper -----------
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  UPDATE notifications SET read_at = now() WHERE recipient_id = kofi;
  PERFORM pg_temp.check((SELECT count(*) FROM notifications WHERE recipient_id=kofi AND read_at IS NULL) = 0, 'marked read');
  PERFORM pg_temp.expect_error('UPDATE notifications SET title=''x'' WHERE recipient_id=' || quote_literal(kofi), 'Only read_at');
  PERFORM pg_temp.check((SELECT count(*) FROM notifications WHERE recipient_id<>kofi) = 0, 'cannot see others'' notifications');

  RAISE NOTICE 'ALL PETTY CASH DB TESTS PASSED';
END $$;
ROLLBACK;
