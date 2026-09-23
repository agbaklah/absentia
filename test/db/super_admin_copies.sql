BEGIN;
DO $$
DECLARE kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');
        ama uuid := (SELECT id FROM profiles WHERE email='ama@verve-energyresources.com');
        sa uuid := (SELECT id FROM profiles WHERE email='verveit@verve-energyresources.com');
        claim uuid; d date := CURRENT_DATE + 45; n int;
BEGIN
  WHILE EXTRACT(ISODOW FROM d) > 5 LOOP d := d + 1; END LOOP;
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM leave_entries; DELETE FROM expense_claims;
  UPDATE profiles SET employment_start_date='2024-01-01';
  UPDATE leave_policies SET min_notice_days=0 WHERE is_default;
  ALTER TABLE profiles DISABLE TRIGGER prevent_unauthorized_admin_roles;
  UPDATE profiles SET role='admin' WHERE id=ama;
  ALTER TABLE profiles ENABLE TRIGGER prevent_unauthorized_admin_roles;
  -- leave: request then decision
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by) VALUES (kofi, d, 'L', 'pending', kofi);
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  UPDATE leave_entries SET status='approved', approved_by=ama, approved_at=now() WHERE employee_id=kofi;
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=sa AND kind='leave.requested';
  PERFORM pg_temp.check(n=1, 'super admin got the request, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=sa AND kind='leave.approved';
  PERFORM pg_temp.check(n=1, 'super admin got the decision, got ' || n);
  PERFORM pg_temp.check((SELECT count(*) FROM notifications WHERE recipient_id=kofi AND kind='leave.approved')=1, 'employee still told');
  -- petty cash: submit, approve, pay
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO expense_claims(claimant_id,title,amount) VALUES (kofi,'Taxi',50) RETURNING id INTO claim;
  INSERT INTO expense_receipts(claim_id,storage_path,file_name,mime_type,size_bytes) VALUES (claim, kofi||'/'||claim||'/r.jpg','r.jpg','image/jpeg',10);
  UPDATE expense_claims SET status='submitted' WHERE id=claim;
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  UPDATE expense_claims SET status='approved' WHERE id=claim;
  UPDATE expense_claims SET status='paid', payment_method='momo' WHERE id=claim;
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=sa AND kind LIKE 'expense.%';
  PERFORM pg_temp.check(n=3, 'super admin got submitted+approved+paid, got ' || n);
  RAISE NOTICE 'ALL SUPER ADMIN COPY TESTS PASSED';
END $$;
ROLLBACK;
