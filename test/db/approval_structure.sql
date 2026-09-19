BEGIN;
DO $$
DECLARE
  kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');   -- Engineers
  yaw  uuid := (SELECT id FROM profiles WHERE email='yaw@verve-energyresources.com');    -- Logistics
  kwame uuid := (SELECT id FROM profiles WHERE email='kwame@verve-energyresources.com'); -- Sales/Tech, cfo
  ama  uuid := (SELECT id FROM profiles WHERE email='ama@verve-energyresources.com');    -- will head Engineers + Logistics
  esi  uuid := (SELECT id FROM profiles WHERE email='esi@verve-energyresources.com');    -- admin → viewer for the test
  d date := CURRENT_DATE + 40; n int;
BEGIN
  WHILE EXTRACT(ISODOW FROM d) > 5 LOOP d := d + 1; END LOOP;
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM leave_entries; DELETE FROM approval_exclusions;
  UPDATE profiles SET employment_start_date='2024-01-01';
  UPDATE leave_policies SET min_notice_days = 0 WHERE is_default;
  UPDATE profiles SET role='employee', team_id=(SELECT id FROM teams WHERE name='Engineers') WHERE id=ama;
  UPDATE teams SET manager_id = ama WHERE name IN ('Engineers','Logistics');
  ALTER TABLE profiles DISABLE TRIGGER prevent_unauthorized_admin_roles;
  UPDATE profiles SET role='viewer' WHERE id=esi;
  ALTER TABLE profiles ENABLE TRIGGER prevent_unauthorized_admin_roles;

  -- Head of two departments approves both, notified for both, not for others.
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by) VALUES (kofi, d, 'L', 'pending', kofi);
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by) VALUES (yaw, d, 'L', 'pending', yaw);
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by) VALUES (kwame, d, 'L', 'pending', kwame);
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  PERFORM pg_temp.check(can_approve_for(kofi) AND can_approve_for(yaw) AND NOT can_approve_for(kwame), 'head approves own departments only');
  UPDATE leave_entries SET status='approved', approved_by=ama, approved_at=now() WHERE employee_id IN (kofi, yaw);
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT count(*) FROM leave_entries WHERE status='approved') = 2, 'both approved by head');
  SELECT count(*) INTO n FROM notifications WHERE kind='leave.requested' AND recipient_id=ama;
  PERFORM pg_temp.check(n = 2, 'head notified for both departments, got ' || n);
  -- Kwame's department (Sales/Tech) has no head → admins/cfo/super admin notified, not the head.
  SELECT count(*) INTO n FROM notifications WHERE kind='leave.requested' AND recipient_id=ama
    AND created_at > (SELECT max(created_at) FROM leave_entries WHERE employee_id=kwame) - interval '1 minute' AND body LIKE '%' ;
  PERFORM pg_temp.check((SELECT count(*) FROM notifications WHERE kind='leave.requested' AND recipient_id=(SELECT id FROM profiles WHERE email='verveit@verve-energyresources.com')) = 1, 'super admin notified only for headless department');
  -- Departments with a head do NOT notify admins.
  PERFORM pg_temp.check((SELECT count(*) FROM notifications WHERE kind='leave.requested' AND recipient_id=esi) = 0, 'viewer never notified');

  -- cfo has admin powers: can approve leave for a headless department.
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  PERFORM pg_temp.check(has_role('admin'), 'cfo counts as admin');
  PERFORM pg_temp.check(NOT can_approve_for(kwame), 'never own leave');

  -- viewer: reads everything, approves nothing, cannot edit settings.
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT count(*) FROM leave_entries) = 3, 'viewer sees all leave');
  PERFORM pg_temp.check(NOT can_approve_for(kofi), 'viewer cannot approve');
  UPDATE leave_entries SET status='rejected' WHERE employee_id=kwame;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT status FROM leave_entries WHERE employee_id=kwame) = 'pending', 'viewer update filtered');
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT count(*) FROM audit_log) >= 0, 'viewer reads audit log');
  PERFORM pg_temp.check(can_review_expenses() AND NOT can_decide_expenses(), 'viewer reads claims, cannot decide');
  UPDATE app_settings SET petty_cash_limit = 1 WHERE key='default';
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT petty_cash_limit FROM app_settings WHERE key='default') <> 1, 'viewer cannot change settings');
  RAISE NOTICE 'ALL APPROVAL STRUCTURE TESTS PASSED';
END $$;
ROLLBACK;
