BEGIN;
DO $$
DECLARE kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');
        yaw  uuid := (SELECT id FROM profiles WHERE email='yaw@verve-energyresources.com');
        ama  uuid := (SELECT id FROM profiles WHERE email='ama@verve-energyresources.com');
        kwame uuid := (SELECT id FROM profiles WHERE email='kwame@verve-energyresources.com');
        sa   uuid := (SELECT id FROM profiles WHERE email='verveit@verve-energyresources.com');
        claim uuid; n int; st text;
BEGIN
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM expense_claims;

  -- An approved claim the CFO has not paid ---------------------------------
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount,kind)
    VALUES (kofi,'Site fuel',300,'advance') RETURNING id INTO claim;
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  UPDATE expense_claims SET status='approved' WHERE id=claim;

  -- Too soon: the CFO still owns the record for the first 24 hours.
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET status=''paid'', payment_method=''momo'' WHERE id=%L', claim),
    '24 hours after approval');

  -- Age it past the delay.
  PERFORM pg_temp.as_service();
  UPDATE expense_claims SET approved_at = now() - interval '25 hours' WHERE id=claim;

  -- Still needs to say how the money arrived.
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET status=''paid'' WHERE id=%L', claim),
    'Choose a payment method');

  -- Now the claimant can close it.
  DELETE FROM notifications;
  UPDATE expense_claims SET status='paid', payment_method='momo' WHERE id=claim;
  PERFORM pg_temp.as_service();
  SELECT status INTO st FROM expense_claims WHERE id=claim;
  PERFORM pg_temp.check(st='paid', 'the claimant can close a stale approved claim, got ' || st);
  PERFORM pg_temp.check((SELECT paid_by FROM expense_claims WHERE id=claim)=kofi,
    'paid_by records who closed it');
  PERFORM pg_temp.check((SELECT paid_confirmed_by_recipient FROM expense_claims WHERE id=claim),
    'the row remembers this was the recipient confirming, not the CFO recording');

  -- The CFO is told, because the books still need the reference.
  SELECT count(*) INTO n FROM notifications
   WHERE recipient_id=kwame AND kind='expense.receipt_confirmed';
  PERFORM pg_temp.check(n=1, 'the CFO is told to reconcile, got ' || n);
  SELECT count(*) INTO n FROM notifications
   WHERE recipient_id=sa AND kind='expense.receipt_confirmed';
  PERFORM pg_temp.check(n=1, 'super admin copied, got ' || n);
  SELECT count(*) INTO n FROM notifications
   WHERE recipient_id=ama AND kind='expense.receipt_confirmed';
  PERFORM pg_temp.check(n=1, 'the head who approved it is told, got ' || n);
  PERFORM pg_temp.check(
    (SELECT body FROM notifications
      WHERE recipient_id=kwame AND kind='expense.receipt_confirmed') LIKE '%reconcile%',
    'the CFO is asked to reconcile and add the reference');

  -- It stops the 24-hour chase, which was the point.
  PERFORM pg_temp.check(public.remind_stale_expense_claims()=0,
    'a closed claim is no longer chased');

  -- Nobody else can confirm on your behalf ---------------------------------
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM expense_claims;
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount,kind)
    VALUES (kofi,'Second run',120,'advance') RETURNING id INTO claim;
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  UPDATE expense_claims SET status='approved' WHERE id=claim;
  PERFORM pg_temp.as_service();
  UPDATE expense_claims SET approved_at = now() - interval '30 hours' WHERE id=claim;

  -- The department head cannot: approving is not paying.
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET status=''paid'', payment_method=''cash'' WHERE id=%L', claim),
    'Only the CFO, or the claimant confirming receipt');

  -- An unrelated employee cannot even see the row.
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  UPDATE expense_claims SET status='paid', payment_method='cash' WHERE id=claim;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT status FROM expense_claims WHERE id=claim)='approved',
    'an unrelated employee changes nothing');

  -- The CFO path is untouched, and is not flagged as self-confirmed --------
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  UPDATE expense_claims SET status='paid', payment_method='bank_transfer', payment_ref='TRX-77'
   WHERE id=claim;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT paid_by FROM expense_claims WHERE id=claim)=kwame,
    'the CFO is still the payer on the normal path');
  PERFORM pg_temp.check(
    NOT (SELECT paid_confirmed_by_recipient FROM expense_claims WHERE id=claim),
    'a CFO payment is not marked as recipient-confirmed');

  -- A claim that was never approved cannot be confirmed --------------------
  PERFORM pg_temp.as_service();
  DELETE FROM expense_claims;
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount,kind)
    VALUES (kofi,'Not yet approved',90,'advance') RETURNING id INTO claim;
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET status=''paid'', payment_method=''cash'' WHERE id=%L', claim),
    'Cannot move a claim from submitted to paid');

  -- …and a closed claim cannot be quietly edited afterwards ----------------
  PERFORM pg_temp.as_service();
  DELETE FROM expense_claims;
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount,kind)
    VALUES (kofi,'Closed out',60,'advance') RETURNING id INTO claim;
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  UPDATE expense_claims SET status='approved' WHERE id=claim;
  PERFORM pg_temp.as_service();
  UPDATE expense_claims SET approved_at = now() - interval '26 hours' WHERE id=claim;
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  UPDATE expense_claims SET status='paid', payment_method='cash' WHERE id=claim;
  PERFORM pg_temp.expect_error(
    format('UPDATE expense_claims SET paid_confirmed_by_recipient=false WHERE id=%L', claim),
    'cannot be modified');

  RAISE NOTICE 'ALL RECEIPT CONFIRMATION TESTS PASSED';
END $$;
ROLLBACK;
