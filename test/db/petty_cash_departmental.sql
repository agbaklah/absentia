BEGIN;
DO $$
DECLARE kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');  -- Engineers
        yaw  uuid := (SELECT id FROM profiles WHERE email='yaw@verve-energyresources.com');   -- Logistics (no head)
        ama  uuid := (SELECT id FROM profiles WHERE email='ama@verve-energyresources.com');   -- heads Engineers
        esi  uuid := (SELECT id FROM profiles WHERE email='esi@verve-energyresources.com');   -- admin
        kwame uuid := (SELECT id FROM profiles WHERE email='kwame@verve-energyresources.com');-- cfo
        sa   uuid := (SELECT id FROM profiles WHERE email='verveit@verve-energyresources.com');
        claim uuid; adv uuid; n int; chased int; st text;
BEGIN
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM expense_claims;

  -- === an out-of-pocket claim still needs a receipt ========================
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount,kind)
    VALUES (kofi,'Taxi I paid for',50,'out_of_pocket') RETURNING id INTO claim;
  PERFORM pg_temp.expect_error(
    'UPDATE expense_claims SET status=''submitted'' WHERE id=''' || claim || '''',
    'Attach at least one receipt');

  -- === an advance does NOT need a receipt =================================
  INSERT INTO expense_claims(claimant_id,title,amount,kind)
    VALUES (kofi,'Float for errands',200,'advance') RETURNING id INTO adv;
  UPDATE expense_claims SET status='submitted' WHERE id=adv;
  PERFORM pg_temp.as_service();
  SELECT status INTO st FROM expense_claims WHERE id=adv;
  PERFORM pg_temp.check(st='submitted', 'an advance submits with no receipt, got ' || st);

  -- the default kind is out_of_pocket, so old behaviour is unchanged
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount) VALUES (kofi,'Default kind',10)
    RETURNING id INTO claim;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT kind FROM expense_claims WHERE id=claim)='out_of_pocket',
    'claims default to out_of_pocket');
  DELETE FROM expense_claims WHERE id=claim;

  -- === approval is DEPARTMENTAL ===========================================
  -- The CFO is not this department's head, so the CFO cannot approve it.
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    'UPDATE expense_claims SET status=''approved'' WHERE id=''' || adv || '''',
    'department''s head');
  -- An unrelated employee cannot even see the row, so the update touches
  -- nothing: RLS stops it before the state machine is reached.
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  UPDATE expense_claims SET status='approved' WHERE id=adv;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT status FROM expense_claims WHERE id=adv)='submitted',
    'an unrelated employee changes nothing');

  -- The head of Engineering can.
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  UPDATE expense_claims SET status='approved' WHERE id=adv;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT approved_by FROM expense_claims WHERE id=adv)=ama,
    'the head is recorded as the approver');

  -- === payment is the CFO's alone =========================================
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    'UPDATE expense_claims SET status=''paid'', payment_method=''momo'' WHERE id=''' || adv || '''',
    'Only the CFO');
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  UPDATE expense_claims SET status='paid', payment_method='momo' WHERE id=adv;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT paid_by FROM expense_claims WHERE id=adv)=kwame,
    'the CFO is recorded as the payer');
  PERFORM pg_temp.check((SELECT approved_by FROM expense_claims WHERE id=adv)=ama,
    'both hands stay on the record');

  -- === a team with no head falls back to org-wide authority ===============
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM expense_claims;
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount,kind)
    VALUES (yaw,'Fuel float',120,'advance') RETURNING id INTO claim;
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  -- Another team's head has no say here, and no sight of it either.
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  UPDATE expense_claims SET status='approved' WHERE id=claim;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT status FROM expense_claims WHERE id=claim)='submitted',
    'another team''s head changes nothing');
  -- The CFO (org-wide) can, because Logistics has no head.
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  UPDATE expense_claims SET status='approved' WHERE id=claim;
  UPDATE expense_claims SET status='paid', payment_method='cash' WHERE id=claim;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT status FROM expense_claims WHERE id=claim)='paid',
    'the headless-team claim completes');

  -- === nobody approves their own ==========================================
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM expense_claims;
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount,kind)
    VALUES (ama,'My own float',75,'advance') RETURNING id INTO claim;
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.expect_error(
    'UPDATE expense_claims SET status=''approved'' WHERE id=''' || claim || '''',
    'department''s head');
  -- It falls to org-wide authority instead.
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  UPDATE expense_claims SET status='approved' WHERE id=claim;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT approved_by FROM expense_claims WHERE id=claim)=esi,
    'a head''s own claim goes to an admin');
  -- …and an admin still cannot pay it.
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    'UPDATE expense_claims SET status=''paid'', payment_method=''cash'' WHERE id=''' || claim || '''',
    'Only the CFO');

  -- === visibility: a head sees their own team's claims only ===============
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM expense_claims;
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount,kind)
    VALUES (kofi,'Engineering errand',30,'advance') RETURNING id INTO claim;
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount,kind)
    VALUES (yaw,'Logistics errand',40,'advance');
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  SELECT count(*) INTO n FROM expense_claims WHERE claimant_id=kofi;
  PERFORM pg_temp.check(n=1, 'the head sees their team member''s claim, got ' || n);
  SELECT count(*) INTO n FROM expense_claims WHERE claimant_id=yaw;
  PERFORM pg_temp.check(n=0, 'the head cannot see another team''s claim, got ' || n);
  -- The claimant still sees their own; the CFO sees everything.
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  SELECT count(*) INTO n FROM expense_claims WHERE claimant_id=yaw;
  PERFORM pg_temp.check(n=1, 'the claimant sees their own, got ' || n);
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  SELECT count(*) INTO n FROM expense_claims;
  PERFORM pg_temp.check(n=2, 'the CFO sees every claim, got ' || n);

  -- === notifications follow the hand that must act ========================
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM expense_claims;
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount,kind)
    VALUES (kofi,'Site run',60,'advance') RETURNING id INTO claim;
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=ama AND kind='expense.submitted';
  PERFORM pg_temp.check(n=1, 'the head is told it was submitted, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=sa AND kind='expense.submitted';
  PERFORM pg_temp.check(n=1, 'super admin copied on submit, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=kwame AND kind='expense.submitted';
  PERFORM pg_temp.check(n=0, 'the CFO is not pestered before approval, got ' || n);

  DELETE FROM notifications;
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  UPDATE expense_claims SET status='approved' WHERE id=claim;
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=kwame AND kind='expense.approved';
  PERFORM pg_temp.check(n=1, 'the CFO is handed it to pay, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=kofi AND kind='expense.approved';
  PERFORM pg_temp.check(n=1, 'the claimant is told, got ' || n);

  -- === the 24h chase follows the same split ===============================
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM expense_claims;
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount,kind)
    VALUES (kofi,'Stale errand',90,'advance') RETURNING id INTO claim;
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.as_service();
  DELETE FROM notifications;
  UPDATE expense_claims SET submitted_at = now() - interval '30 hours' WHERE id=claim;
  SELECT public.remind_stale_expense_claims() INTO chased;
  PERFORM pg_temp.check(chased=1, 'the unapproved claim is chased, chased ' || chased);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=ama AND kind='expense.reminder';
  PERFORM pg_temp.check(n=1, 'waiting for approval chases the head, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=sa AND kind='expense.reminder';
  PERFORM pg_temp.check(n=1, 'super admin copied on the chase, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=kwame AND kind='expense.reminder';
  PERFORM pg_temp.check(n=0, 'the CFO is not chased for an unapproved claim, got ' || n);

  DELETE FROM notifications;
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  UPDATE expense_claims SET status='approved' WHERE id=claim;
  PERFORM pg_temp.as_service();
  DELETE FROM notifications;
  UPDATE expense_claims SET reviewed_at = now() - interval '30 hours', last_reminded_at = NULL
   WHERE id=claim;
  SELECT public.remind_stale_expense_claims() INTO chased;
  PERFORM pg_temp.check(chased=1, 'the unpaid claim is chased, chased ' || chased);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=kwame AND kind='expense.reminder';
  PERFORM pg_temp.check(n=1, 'approved-but-unpaid chases the CFO, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=ama AND kind='expense.reminder';
  PERFORM pg_temp.check(n=0, 'the head is done once approved, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=sa AND kind='expense.reminder';
  PERFORM pg_temp.check(n=1, 'super admin copied here too, got ' || n);

  RAISE NOTICE 'ALL DEPARTMENTAL PETTY CASH TESTS PASSED';
END $$;
ROLLBACK;
