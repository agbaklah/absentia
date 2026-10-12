BEGIN;
DO $$
DECLARE kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');
        yaw  uuid := (SELECT id FROM profiles WHERE email='yaw@verve-energyresources.com');
        ama  uuid := (SELECT id FROM profiles WHERE email='ama@verve-energyresources.com');
        esi  uuid := (SELECT id FROM profiles WHERE email='esi@verve-energyresources.com');
        kwame uuid := (SELECT id FROM profiles WHERE email='kwame@verve-energyresources.com');
        sa   uuid := (SELECT id FROM profiles WHERE email='verveit@verve-energyresources.com');
        d date := CURRENT_DATE + 40; n int; chased int;
BEGIN
  WHILE EXTRACT(ISODOW FROM d) > 5 LOOP d := d + 1; END LOOP;
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM leave_entries;
  UPDATE profiles SET employment_start_date='2024-01-01';
  UPDATE leave_policies SET min_notice_days=0 WHERE is_default;

  -- Kofi is in a team with a head (the department-head case: a CTO).
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by)
    VALUES (kofi, d, 'L', 'pending', kofi), (kofi, d+1, 'L', 'pending', kofi);
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; -- drop the submit alerts; we only want reminders

  -- Fresh request: not chased yet.
  SELECT public.remind_stale_leave_requests() INTO chased;
  PERFORM pg_temp.check(chased=0, 'a request under 24h is left alone, chased ' || chased);

  -- Age it past 24 hours.
  UPDATE leave_entries SET created_at = now() - interval '26 hours' WHERE employee_id=kofi;
  SELECT public.remind_stale_leave_requests() INTO chased;
  PERFORM pg_temp.check(chased=1, 'the stale request is chased once, chased ' || chased);

  -- The department head is asked to act; the super admin is copied; the
  -- employee is not chased for their own request.
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=ama AND kind='leave.reminder';
  PERFORM pg_temp.check(n=1, 'the head who can approve is reminded, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=sa AND kind='leave.reminder';
  PERFORM pg_temp.check(n=1, 'super admin copied, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=kofi AND kind='leave.reminder';
  PERFORM pg_temp.check(n=0, 'the requester is not chased, got ' || n);
  PERFORM pg_temp.check(
    (SELECT title FROM notifications WHERE recipient_id=ama LIMIT 1) LIKE '%waiting for approval%',
    'the reminder says what is awaited');
  PERFORM pg_temp.check(
    (SELECT body FROM notifications WHERE recipient_id=ama LIMIT 1) LIKE '2 days%',
    'the whole request is one reminder, not one per day');

  -- Not chased twice inside the day; chased again once a day has passed.
  SELECT public.remind_stale_leave_requests() INTO chased;
  PERFORM pg_temp.check(chased=0, 'no double chase inside 24h, chased ' || chased);
  UPDATE leave_entries SET last_reminded_at = now() - interval '25 hours' WHERE employee_id=kofi;
  SELECT public.remind_stale_leave_requests() INTO chased;
  PERFORM pg_temp.check(chased=1, 'chased again a day later, chased ' || chased);

  -- A team with no head falls back to admins + CFO + super admins, so the CFO
  -- is reminded of what reaches them.
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM leave_entries;
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by)
    VALUES (yaw, d, 'L', 'pending', yaw);
  PERFORM pg_temp.as_service();
  DELETE FROM notifications;
  UPDATE leave_entries SET created_at = now() - interval '30 hours' WHERE employee_id=yaw;
  SELECT public.remind_stale_leave_requests() INTO chased;
  PERFORM pg_temp.check(chased=1, 'the headless-team request is chased, chased ' || chased);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=kwame AND kind='leave.reminder';
  PERFORM pg_temp.check(n=1, 'the CFO is reminded, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=esi AND kind='leave.reminder';
  PERFORM pg_temp.check(n=1, 'the admin is reminded, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=sa AND kind='leave.reminder';
  PERFORM pg_temp.check(n=1, 'super admin told exactly once, not twice, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=ama AND kind='leave.reminder';
  PERFORM pg_temp.check(n=0, 'another teams head is not chased, got ' || n);

  -- An approver excluded from someone is not chased about them.
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM leave_entries;
  INSERT INTO approval_exclusions(approver_id, employee_id) VALUES (ama, kofi);
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by)
    VALUES (kofi, d, 'L', 'pending', kofi);
  PERFORM pg_temp.as_service();
  DELETE FROM notifications;
  UPDATE leave_entries SET created_at = now() - interval '30 hours' WHERE employee_id=kofi;
  SELECT public.remind_stale_leave_requests() INTO chased;
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=ama AND kind='leave.reminder';
  PERFORM pg_temp.check(n=0, 'an excluded approver is not chased, got ' || n);
  SELECT count(*) INTO n FROM notifications WHERE recipient_id=sa AND kind='leave.reminder';
  PERFORM pg_temp.check(n=1, 'super admin still copied, got ' || n);
  DELETE FROM approval_exclusions WHERE approver_id=ama AND employee_id=kofi;

  -- Decided requests are never chased.
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM leave_entries;
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by)
    VALUES (kofi, d, 'L', 'pending', kofi);
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  UPDATE leave_entries SET status='approved', approved_by=ama, approved_at=now() WHERE employee_id=kofi;
  PERFORM pg_temp.as_service();
  UPDATE leave_entries SET created_at = now() - interval '40 hours' WHERE employee_id=kofi;
  SELECT public.remind_stale_leave_requests() INTO chased;
  PERFORM pg_temp.check(chased=0, 'an approved request is never chased, chased ' || chased);
  UPDATE leave_entries SET status='cancelled' WHERE employee_id=kofi;
  SELECT public.remind_stale_leave_requests() INTO chased;
  PERFORM pg_temp.check(chased=0, 'a cancelled request is never chased, chased ' || chased);

  -- Employees must not be able to run the chaser themselves.
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    'SELECT public.remind_stale_leave_requests()', 'permission denied');

  RAISE NOTICE 'ALL LEAVE REMINDER TESTS PASSED';
END $$;
ROLLBACK;
