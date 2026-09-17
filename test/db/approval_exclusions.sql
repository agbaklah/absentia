BEGIN;
DO $$
DECLARE
  kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');
  yaw  uuid := (SELECT id FROM profiles WHERE email='yaw@verve-energyresources.com');
  esi  uuid := (SELECT id FROM profiles WHERE email='esi@verve-energyresources.com'); -- admin
  d date := CURRENT_DATE + 40; n int;
BEGIN
  WHILE EXTRACT(ISODOW FROM d) > 5 LOOP d := d + 1; END LOOP;
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM leave_entries;
  UPDATE profiles SET employment_start_date='2024-01-01' WHERE id IN (kofi, yaw);
  UPDATE leave_policies SET min_notice_days = 0 WHERE is_default;
  -- Esi (admin) is excluded from Kofi; only a super admin may create the row.
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    format('INSERT INTO approval_exclusions(approver_id, employee_id) VALUES (%L,%L)', esi, kofi), 'row-level security');
  PERFORM pg_temp.as_user('verveit@verve-energyresources.com');
  INSERT INTO approval_exclusions(approver_id, employee_id, reason) VALUES (esi, kofi, 'peer');
  -- Kofi and Yaw both request leave.
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by) VALUES (kofi, d, 'L', 'pending', kofi);
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by) VALUES (yaw, d, 'L', 'pending', yaw);
  -- Esi sees Yaw's request but not Kofi's, cannot approve Kofi's, was not notified.
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT count(*) FROM leave_entries WHERE employee_id=yaw) = 1, 'admin sees non-excluded');
  PERFORM pg_temp.check((SELECT count(*) FROM leave_entries WHERE employee_id=kofi) = 0, 'admin cannot see excluded employee');
  PERFORM pg_temp.check(can_approve_for(yaw) AND NOT can_approve_for(kofi), 'can approve yaw, not kofi');
  UPDATE leave_entries SET status='approved' WHERE employee_id=kofi;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT status FROM leave_entries WHERE employee_id=kofi) = 'pending', 'excluded approval silently filtered');
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=esi AND kind='leave.requested';
  PERFORM pg_temp.check(n = 1, 'esi notified once (yaw only), got ' || n);
  -- Super admin is never excluded.
  PERFORM pg_temp.as_user('verveit@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT count(*) FROM leave_entries WHERE employee_id=kofi) = 1, 'super admin sees all');
  -- Kofi still sees his own.
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT count(*) FROM leave_entries WHERE employee_id=kofi) = 1, 'owner sees own');
  RAISE NOTICE 'ALL APPROVAL EXCLUSION TESTS PASSED';
END $$;
ROLLBACK;
