BEGIN;
DO $$
DECLARE
  kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');
  ama uuid := (SELECT id FROM profiles WHERE email='ama@verve-energyresources.com');
  esi uuid := (SELECT id FROM profiles WHERE email='esi@verve-energyresources.com');
  kwame uuid := (SELECT id FROM profiles WHERE email='kwame@verve-energyresources.com');
  n int;
BEGIN
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM leave_entries;
  UPDATE profiles SET employment_start_date = '2024-01-01' WHERE id = kofi;
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id, date, leave_code, status, requested_by) VALUES
    (kofi, '2026-10-05', 'L', 'pending', kofi),
    (kofi, '2026-10-06', 'L', 'pending', kofi),
    (kofi, '2026-10-07', 'L', 'pending', kofi);
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM notifications WHERE kind='leave.requested' AND recipient_id=ama;
  PERFORM pg_temp.check(n = 1, 'manager got exactly one notification for a 3-day request, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE kind='leave.requested' AND recipient_id=esi;
  -- Engineers has a department head (Ama), so admins are not notified.
  PERFORM pg_temp.check(n = 0, 'admin not notified when a head exists, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE kind='leave.requested' AND recipient_id IN (kofi, kwame);
  PERFORM pg_temp.check(n = 0, 'employee/cfo not notified, got ' || n);
  RAISE NOTICE 'body: %', (SELECT body FROM notifications WHERE kind='leave.requested' AND recipient_id=ama);

  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  UPDATE leave_entries SET status='approved', approved_by=ama, approved_at=now()
   WHERE employee_id=kofi AND date BETWEEN '2026-10-05' AND '2026-10-07';
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM notifications WHERE kind='leave.approved' AND recipient_id=kofi;
  PERFORM pg_temp.check(n = 1, 'employee got one approval notification, got ' || n);
  RAISE NOTICE 'body: %', (SELECT body FROM notifications WHERE kind='leave.approved' AND recipient_id=kofi);
  RAISE NOTICE 'ALL LEAVE NOTIFICATION TESTS PASSED';
END $$;
ROLLBACK;
