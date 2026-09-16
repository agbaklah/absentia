BEGIN;
DO $$
DECLARE
  kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');
  ama  uuid := (SELECT id FROM profiles WHERE email='ama@verve-energyresources.com');
  yaw  uuid := (SELECT id FROM profiles WHERE email='yaw@verve-energyresources.com');
  esi  uuid := (SELECT id FROM profiles WHERE email='esi@verve-energyresources.com');
  eng  uuid := (SELECT id FROM teams WHERE name='Engineers');
  v jsonb; n int; d date;
  far date := (CURRENT_DATE + 60);
BEGIN
  -- Make the calendar deterministic: pick a Monday ≥ 60 days out.
  WHILE EXTRACT(ISODOW FROM far) <> 1 LOOP far := far + 1; END LOOP;

  -- Policy: 3 days notice, 5-day max, 20-day waiting period ------------------
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM leave_entries; DELETE FROM leave_balance_transactions;
  UPDATE profiles SET employment_start_date = '2024-01-01' WHERE id IN (kofi, ama, esi);
  UPDATE leave_policies SET min_notice_days = 3, max_consecutive_days = 5, waiting_period_days = 20 WHERE is_default;
  UPDATE profiles SET employment_start_date = CURRENT_DATE - 10 WHERE id = yaw; -- new joiner
  INSERT INTO leave_allowances (employee_id, year, vacation_allowance_days) VALUES (kofi, EXTRACT(YEAR FROM far)::int, 24)
    ON CONFLICT (employee_id, year) DO UPDATE SET vacation_allowance_days = 24;

  -- validate: notice ---------------------------------------------------------
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  v := validate_leave_request(kofi, ARRAY[CURRENT_DATE + 1], 'L');
  PERFORM pg_temp.check((v->>'ok')::bool = false AND v->'errors'->>0 LIKE '%notice%', 'notice error: ' || v::text);
  -- sickness ignores notice
  v := validate_leave_request(kofi, ARRAY[CURRENT_DATE + 1], 'S');
  PERFORM pg_temp.check((v->>'ok')::bool, 'sick ignores notice: ' || v::text);
  -- max consecutive
  v := validate_leave_request(kofi, ARRAY[far, far+1, far+2, far+3, far+4, far+7], 'L');
  PERFORM pg_temp.check((v->>'ok')::bool = false AND v->'errors'->>0 LIKE '%at most 5%', 'max consecutive: ' || v::text);
  -- ok request
  v := validate_leave_request(kofi, ARRAY[far, far+1], 'L');
  PERFORM pg_temp.check((v->>'ok')::bool AND (v->>'requested_days')::numeric = 2, 'ok request: ' || v::text);

  -- hard enforcement on insert
  PERFORM pg_temp.expect_error(
    format('INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by) VALUES (%L,%L,''L'',''pending'',%L)', kofi, CURRENT_DATE+1, kofi),
    'notice');
  -- manager override: Ama files for Kofi with short notice → allowed
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by) VALUES (kofi, CURRENT_DATE+1, 'L', 'pending', ama);
  DELETE FROM leave_entries WHERE employee_id = kofi AND date = CURRENT_DATE+1;

  -- waiting period for Yaw ---------------------------------------------------
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  v := validate_leave_request(yaw, ARRAY[CURRENT_DATE + 5], 'L');
  PERFORM pg_temp.check((v->>'ok')::bool = false AND v::text LIKE '%waiting period%', 'waiting period: ' || v::text);

  -- blackout ----------------------------------------------------------------
  PERFORM pg_temp.as_service();
  INSERT INTO blackout_periods(team_id, start_date, end_date, reason) VALUES (eng, far, far+4, 'Quarter close');
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  v := validate_leave_request(kofi, ARRAY[far+2], 'L');
  PERFORM pg_temp.check((v->>'ok')::bool = false AND v::text LIKE '%Quarter close%', 'blackout: ' || v::text);
  -- other team unaffected
  PERFORM pg_temp.as_service();
  UPDATE profiles SET employment_start_date = CURRENT_DATE - 400 WHERE id = yaw;
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  v := validate_leave_request(yaw, ARRAY[far+2], 'L');
  PERFORM pg_temp.check((v->>'ok')::bool, 'blackout team-scoped: ' || v::text);
  PERFORM pg_temp.as_service();
  DELETE FROM blackout_periods;

  -- balance -----------------------------------------------------------------
  PERFORM pg_temp.as_service();
  UPDATE leave_allowances SET vacation_allowance_days = 2 WHERE employee_id = kofi AND year = EXTRACT(YEAR FROM far)::int;
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  v := validate_leave_request(kofi, ARRAY[far, far+1, far+2], 'L');
  PERFORM pg_temp.check((v->>'ok')::bool = false AND v::text LIKE '%available%', 'balance: ' || v::text);
  PERFORM pg_temp.check((v->>'available_days')::numeric = 2, 'available = 2: ' || v::text);
  PERFORM pg_temp.as_service();
  UPDATE leave_allowances SET vacation_allowance_days = 24 WHERE employee_id = kofi AND year = EXTRACT(YEAR FROM far)::int;

  -- monthly accrual: Kofi on a monthly policy mid-year ------------------------
  INSERT INTO leave_policies(name, accrual_method, annual_days) VALUES ('Monthly', 'monthly', 24);
  UPDATE profiles SET policy_id = (SELECT id FROM leave_policies WHERE name='Monthly') WHERE id = kofi;
  PERFORM pg_temp.check(accrued_allowance(kofi, 2026, '2026-06-30') = 12, 'monthly accrual June = 12, got ' || accrued_allowance(kofi, 2026, '2026-06-30'));
  PERFORM pg_temp.check(accrued_allowance(kofi, 2026, '2026-12-31') = 24, 'monthly accrual Dec = 24');
  UPDATE profiles SET policy_id = NULL WHERE id = kofi;
  -- pro-rata starter (annual policy): starts 1 Oct → 3/12 of 24 = 6
  UPDATE profiles SET employment_start_date = '2026-10-01' WHERE id = kofi;
  PERFORM pg_temp.check(accrued_allowance(kofi, 2026, '2026-12-31') = 6, 'pro-rata starter = 6, got ' || accrued_allowance(kofi, 2026, '2026-12-31'));
  UPDATE profiles SET employment_start_date = '2024-01-01' WHERE id = kofi;

  -- coverage warning --------------------------------------------------------
  PERFORM pg_temp.as_service();
  UPDATE app_settings SET max_concurrent_absent = 1 WHERE key='default';
  INSERT INTO leave_entries(employee_id,date,leave_code,status) VALUES (ama, far, 'L', 'approved');
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  v := validate_leave_request(kofi, ARRAY[far], 'L');
  PERFORM pg_temp.check((v->>'ok')::bool AND v->'warnings'->>0 LIKE '%Ama Owusu already off%', 'coverage warning: ' || v::text);
  PERFORM pg_temp.as_service();
  UPDATE app_settings SET max_concurrent_absent = 3 WHERE key='default';

  -- cancel rules ------------------------------------------------------------
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by) VALUES (kofi, far+7, 'L', 'pending', kofi);
  UPDATE leave_entries SET status='cancelled' WHERE employee_id=kofi AND date=far+7;
  PERFORM pg_temp.check((SELECT status FROM leave_entries WHERE employee_id=kofi AND date=far+7) = 'cancelled', 'own pending cancelled');
  -- approved past day cannot be cancelled by employee
  PERFORM pg_temp.as_service();
  INSERT INTO leave_entries(employee_id,date,leave_code,status) VALUES (kofi, CURRENT_DATE-3, 'L', 'approved');
  INSERT INTO leave_entries(employee_id,date,leave_code,status) VALUES (kofi, far+8, 'L', 'approved');
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    format('UPDATE leave_entries SET status=''cancelled'' WHERE employee_id=%L AND date=%L', kofi, CURRENT_DATE-3),
    'already been taken');
  UPDATE leave_entries SET status='cancelled' WHERE employee_id=kofi AND date=far+8;
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM notifications WHERE kind='leave.cancelled' AND recipient_id=ama;
  PERFORM pg_temp.check(n >= 1, 'manager notified of cancellation');
  -- employee still cannot self-approve
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO leave_entries(employee_id,date,leave_code,status,requested_by) VALUES (kofi, far+9, 'L', 'pending', kofi);
  PERFORM pg_temp.expect_error(
    format('UPDATE leave_entries SET status=''approved'' WHERE employee_id=%L AND date=%L', kofi, far+9),
    'cannot approve');

  -- delegation: Ama delegates to Yaw (Logistics employee) ---------------------
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  UPDATE leave_entries SET status='approved' WHERE employee_id=kofi AND date=far+9;
  PERFORM pg_temp.check((SELECT status FROM leave_entries WHERE employee_id=kofi AND date=far+9) = 'pending', 'yaw cannot approve before delegation (RLS filtered)');
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  INSERT INTO approval_delegations(delegator_id, delegate_id, start_date, end_date) VALUES (ama, yaw, CURRENT_DATE, CURRENT_DATE+7);
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  PERFORM pg_temp.check(can_approve_for(kofi), 'yaw can approve for kofi via delegation');
  UPDATE leave_entries SET status='approved', approved_by=yaw, approved_at=now() WHERE employee_id=kofi AND date=far+9;
  PERFORM pg_temp.check((SELECT status FROM leave_entries WHERE employee_id=kofi AND date=far+9) = 'approved', 'delegate approved');
  -- delegation does not reach other teams
  PERFORM pg_temp.check(NOT can_approve_for(esi), 'delegation scoped to delegator''s team');
  -- employee cannot create a delegation
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    format('INSERT INTO approval_delegations(delegator_id, delegate_id, end_date) VALUES (%L,%L,CURRENT_DATE+1)', kofi, yaw),
    'row-level security');

  -- ledger adjustment updates the allowance ----------------------------------
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  INSERT INTO leave_balance_transactions(employee_id, year, kind, days, note) VALUES (kofi, 2026, 'adjustment', 2.5, 'Worked public holiday');
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT adjustment_days FROM leave_allowances WHERE employee_id=kofi AND year=2026) = 2.5, 'adjustment applied to allowance');
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    format('INSERT INTO leave_balance_transactions(employee_id, year, kind, days) VALUES (%L, 2026, ''adjustment'', 99)', kofi),
    'row-level security');

  -- rollover ----------------------------------------------------------------
  PERFORM pg_temp.as_service();
  DELETE FROM leave_entries WHERE employee_id = kofi;
  DELETE FROM leave_balance_transactions;
  UPDATE leave_allowances SET vacation_allowance_days = 24, carried_over_days = 0, adjustment_days = 0 WHERE employee_id = kofi AND year = 2026;
  INSERT INTO leave_allowances(employee_id, year, vacation_allowance_days) VALUES (kofi, 2026, 24) ON CONFLICT DO NOTHING;
  -- Kofi used 10 of 24 → 14 remaining, cap 5 → carry 5, expire 9
  n := 0; d := make_date(2026, 3, 2);
  WHILE n < 10 LOOP
    IF EXTRACT(ISODOW FROM d) <= 5 THEN
      INSERT INTO leave_entries(employee_id,date,leave_code,status) VALUES (kofi, d, 'L', 'approved');
      n := n + 1;
    END IF;
    d := d + 1;
  END LOOP;
  PERFORM pg_temp.check(vacation_used(kofi, 2026) = 10, 'used 10, got ' || vacation_used(kofi, 2026));
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  v := run_year_end_rollover(2026, true);
  PERFORM pg_temp.check((v->>'processed')::int = 0 AND jsonb_array_length(v->'employees') >= 1, 'dry run processes nothing');
  v := run_year_end_rollover(2026, false);
  PERFORM pg_temp.check((v->>'processed')::int >= 1, 'rollover ran');
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT carried_over_days FROM leave_allowances WHERE employee_id=kofi AND year=2027) = 5, 'carry 5');
  PERFORM pg_temp.check((SELECT days FROM leave_balance_transactions WHERE employee_id=kofi AND year=2026 AND kind='expiry') = -9, 'expired 9');
  v := run_year_end_rollover(2026, false);
  PERFORM pg_temp.check((v->>'processed')::int = 0, 'rollover idempotent');
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  PERFORM pg_temp.expect_error('SELECT run_year_end_rollover(2026, false)', 'Only admins');

  RAISE NOTICE 'ALL LEAVE POLICY TESTS PASSED';
END $$;
ROLLBACK;
