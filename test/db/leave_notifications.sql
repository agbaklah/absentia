BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.as_user(_email text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE uid uuid;
BEGIN
  SELECT auth_user_id INTO uid FROM public.profiles WHERE email = _email;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('role', 'postgres', true); END $$;
CREATE OR REPLACE FUNCTION pg_temp.check(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(_cond, false) THEN RAISE EXCEPTION 'CHECK FAILED: %', _msg; END IF; END $$;
DO $$
DECLARE
  kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');
  ama uuid := (SELECT id FROM profiles WHERE email='ama@verve-energyresources.com');
  esi uuid := (SELECT id FROM profiles WHERE email='esi@verve-energyresources.com');
  kwame uuid := (SELECT id FROM profiles WHERE email='kwame@verve-energyresources.com');
  n int;
BEGIN
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id, date, leave_code, status, requested_by) VALUES
    (kofi, '2026-10-05', 'L', 'pending', kofi),
    (kofi, '2026-10-06', 'L', 'pending', kofi),
    (kofi, '2026-10-07', 'L', 'pending', kofi);
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM notifications WHERE kind='leave.requested' AND recipient_id=ama;
  PERFORM pg_temp.check(n = 1, 'manager got exactly one notification for a 3-day request, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE kind='leave.requested' AND recipient_id=esi;
  PERFORM pg_temp.check(n = 1, 'admin got one, got ' || n);
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
