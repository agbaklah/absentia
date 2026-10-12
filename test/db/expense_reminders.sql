BEGIN;
DO $$
DECLARE kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');
        kwame uuid := (SELECT id FROM profiles WHERE email='kwame@verve-energyresources.com');
        sa uuid := (SELECT id FROM profiles WHERE email='verveit@verve-energyresources.com');
        claim uuid; n int; chased int;
BEGIN
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM expense_claims;

  -- A claim submitted and left alone.
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount) VALUES (kofi,'Taxi',50) RETURNING id INTO claim;
  INSERT INTO expense_receipts(claim_id,storage_path,file_name,mime_type,size_bytes)
    VALUES (claim, kofi||'/'||claim||'/r.jpg','r.jpg','image/jpeg',10);
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; -- ignore the submit alerts; we only want reminders

  -- Fresh claim: nothing to chase yet.
  SELECT public.remind_stale_expense_claims() INTO chased;
  PERFORM pg_temp.check(chased=0, 'a claim under 24h is left alone, chased ' || chased);

  -- Age it past 24 hours.
  UPDATE expense_claims SET submitted_at = now() - interval '25 hours' WHERE id=claim;
  SELECT public.remind_stale_expense_claims() INTO chased;
  PERFORM pg_temp.check(chased=1, 'the stale claim is chased, chased ' || chased);

  -- The CFO is asked to act and the super admin is copied.
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=kwame AND kind='expense.reminder';
  PERFORM pg_temp.check(n=1, 'CFO reminded, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=sa AND kind='expense.reminder';
  PERFORM pg_temp.check(n=1, 'super admin copied, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=kofi AND kind='expense.reminder';
  PERFORM pg_temp.check(n=0, 'the claimant is not chased, got ' || n);
  PERFORM pg_temp.check(
    (SELECT title FROM notifications WHERE recipient_id=kwame AND kind='expense.reminder')
      LIKE '%waiting for approval%', 'the reminder says what is awaited');

  -- Running again straight away must not chase twice.
  SELECT public.remind_stale_expense_claims() INTO chased;
  PERFORM pg_temp.check(chased=0, 'no double chase inside 24h, chased ' || chased);
  SELECT count(*) INTO n FROM notifications WHERE kind='expense.reminder';
  PERFORM pg_temp.check(n=2, 'still just the two reminders, got ' || n);

  -- 24h after the reminder it is chased again.
  UPDATE expense_claims SET last_reminded_at = now() - interval '25 hours' WHERE id=claim;
  SELECT public.remind_stale_expense_claims() INTO chased;
  PERFORM pg_temp.check(chased=1, 'chased again a day later, chased ' || chased);

  -- Approved but unpaid is still chased, with the wording changed.
  DELETE FROM notifications;
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  UPDATE expense_claims SET status='approved' WHERE id=claim;
  PERFORM pg_temp.as_service();
  DELETE FROM notifications;
  UPDATE expense_claims SET reviewed_at = now() - interval '30 hours', last_reminded_at = NULL WHERE id=claim;
  SELECT public.remind_stale_expense_claims() INTO chased;
  PERFORM pg_temp.check(chased=1, 'an approved-but-unpaid claim is chased, chased ' || chased);
  PERFORM pg_temp.check(
    (SELECT title FROM notifications WHERE recipient_id=kwame AND kind='expense.reminder')
      LIKE '%approved but not paid%', 'the wording switches to payment');

  -- Once paid, the chasing stops.
  DELETE FROM notifications;
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  UPDATE expense_claims SET status='paid', payment_method='momo' WHERE id=claim;
  PERFORM pg_temp.as_service();
  UPDATE expense_claims SET paid_at = now() - interval '40 hours', last_reminded_at = NULL WHERE id=claim;
  SELECT public.remind_stale_expense_claims() INTO chased;
  PERFORM pg_temp.check(chased=0, 'a paid claim is never chased, chased ' || chased);

  -- Rejected claims are settled too.
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM expense_claims;
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount) VALUES (kofi,'Fuel',80) RETURNING id INTO claim;
  INSERT INTO expense_receipts(claim_id,storage_path,file_name,mime_type,size_bytes)
    VALUES (claim, kofi||'/'||claim||'/f.jpg','f.jpg','image/jpeg',10);
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  UPDATE expense_claims SET status='rejected' WHERE id=claim;
  PERFORM pg_temp.as_service();
  UPDATE expense_claims SET reviewed_at = now() - interval '40 hours' WHERE id=claim;
  SELECT public.remind_stale_expense_claims() INTO chased;
  PERFORM pg_temp.check(chased=0, 'a rejected claim is never chased, chased ' || chased);

  -- A draft nobody submitted is the employee's business, not the CFO's.
  PERFORM pg_temp.as_service();
  DELETE FROM expense_claims;
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount) VALUES (kofi,'Draft',10) RETURNING id INTO claim;
  PERFORM pg_temp.as_service();
  UPDATE expense_claims SET created_at = now() - interval '5 days' WHERE id=claim;
  SELECT public.remind_stale_expense_claims() INTO chased;
  PERFORM pg_temp.check(chased=0, 'a draft is never chased, chased ' || chased);

  -- Employees must not be able to run the chaser themselves.
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    'SELECT public.remind_stale_expense_claims()', 'permission denied');

  RAISE NOTICE 'ALL EXPENSE REMINDER TESTS PASSED';
END $$;
ROLLBACK;
