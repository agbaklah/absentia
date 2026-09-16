BEGIN;
DO $$
DECLARE
  kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');
  ama  uuid := (SELECT id FROM profiles WHERE email='ama@verve-energyresources.com');
  yaw  uuid := (SELECT id FROM profiles WHERE email='yaw@verve-energyresources.com');
  esi  uuid := (SELECT id FROM profiles WHERE email='esi@verve-energyresources.com');
  kwame uuid := (SELECT id FROM profiles WHERE email='kwame@verve-energyresources.com');
  logistics uuid := (SELECT id FROM teams WHERE name='Logistics');
  newp uuid; cl uuid; n int; t uuid;
BEGIN
  PERFORM pg_temp.as_service();
  DELETE FROM notifications; DELETE FROM checklists; DELETE FROM employee_private;

  -- Self edits: allowed for phone, blocked for role/team/title ---------------
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  UPDATE profiles SET phone = '+233 24 000 0000' WHERE id = kofi;
  PERFORM pg_temp.check((SELECT phone FROM profiles WHERE id = kofi) = '+233 24 000 0000', 'self phone edit');
  PERFORM pg_temp.expect_error(format('UPDATE profiles SET job_title = ''CEO'' WHERE id = %L', kofi), 'only change your own');
  PERFORM pg_temp.expect_error(format('UPDATE profiles SET team_id = %L WHERE id = %L', logistics, kofi), 'only change your own');

  -- Private record: owner writes, other employee cannot read, cfo reads payout view
  INSERT INTO employee_private(profile_id, date_of_birth, emergency_name, emergency_phone, momo_network, momo_number, national_id_number)
  VALUES (kofi, '1995-05-05', 'Adwoa Boateng', '+233 20 111 2222', 'mtn', '0241234567', 'GHA-123456789-0');
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT count(*) FROM employee_private WHERE profile_id = kofi) = 0, 'colleague cannot read private record');
  PERFORM pg_temp.as_user('kwame@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT momo_number FROM employee_payout_details WHERE profile_id = kofi) = '0241234567', 'cfo reads payout details');
  UPDATE employee_private SET momo_number = 'x' WHERE profile_id = kofi; -- RLS filters to 0 rows
  PERFORM pg_temp.check((SELECT momo_number FROM employee_payout_details WHERE profile_id = kofi) = '0241234567', 'cfo cannot edit private record');
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  UPDATE employee_private SET bank_name = 'GCB' WHERE profile_id = kofi;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT updated_by FROM employee_private WHERE profile_id = kofi) = esi, 'updated_by stamped');
  SELECT count(*) INTO n FROM audit_log WHERE entity='employee_private' AND entity_id = kofi::text;
  PERFORM pg_temp.check(n = 2, 'private record audited (insert + update), got ' || n);
  PERFORM pg_temp.check((SELECT after->'fields_changed' FROM audit_log WHERE entity='employee_private' AND action='update' ORDER BY ts DESC LIMIT 1) = '["bank_name"]'::jsonb, 'audit lists changed field only');

  -- Job history auto-tracking ------------------------------------------------
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  UPDATE profiles SET job_title = 'Senior Engineer' WHERE id = kofi;
  UPDATE profiles SET team_id = logistics WHERE id = kofi;
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM employment_history WHERE profile_id = kofi;
  PERFORM pg_temp.check(n = 3, 'hired + change + transfer rows, got ' || n);
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM employment_history WHERE profile_id = kofi AND change_kind = 'transfer' AND team_id = logistics), 'team-only change = transfer');
  UPDATE profiles SET team_id = (SELECT id FROM teams WHERE name='Engineers') WHERE id = kofi;

  -- Onboarding auto-start on new hire ----------------------------------------
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  INSERT INTO profiles(full_name, email, role, team_id, employment_start_date)
  VALUES ('New Hire', 'newhire@verve-energyresources.com', 'employee', (SELECT id FROM teams WHERE name='Engineers'), CURRENT_DATE)
  RETURNING id INTO newp;
  PERFORM pg_temp.as_service();
  SELECT id INTO cl FROM checklists WHERE profile_id = newp AND kind = 'onboarding';
  PERFORM pg_temp.check(cl IS NOT NULL, 'onboarding checklist created');
  SELECT count(*) INTO n FROM checklist_tasks WHERE checklist_id = cl;
  PERFORM pg_temp.check(n = 8, '8 onboarding tasks, got ' || n);
  PERFORM pg_temp.check((SELECT assignee_id FROM checklist_tasks WHERE checklist_id = cl AND assignee_role = 'manager' LIMIT 1) = ama, 'manager tasks go to team manager');
  PERFORM pg_temp.check((SELECT assignee_id FROM checklist_tasks WHERE checklist_id = cl AND assignee_role = 'employee' LIMIT 1) = newp, 'employee tasks go to the new hire');
  SELECT count(*) INTO n FROM notifications WHERE kind = 'checklist.task' AND recipient_id = ama;
  PERFORM pg_temp.check(n = 2, 'manager notified of 2 tasks, got ' || n);

  -- Assignee ticks own task; cannot retitle; colleague cannot see ------------
  PERFORM pg_temp.as_user('ama@verve-energyresources.com');
  SELECT id INTO t FROM checklist_tasks WHERE checklist_id = cl AND assignee_id = ama LIMIT 1;
  UPDATE checklist_tasks SET done_at = now() WHERE id = t;
  PERFORM pg_temp.check((SELECT done_by FROM checklist_tasks WHERE id = t) = ama, 'done_by stamped');
  PERFORM pg_temp.expect_error(format('UPDATE checklist_tasks SET title = ''x'' WHERE id = %L', t), 'Only the done state');
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT count(*) FROM checklist_tasks WHERE checklist_id = cl) = 0, 'unrelated employee sees no tasks');
  -- Complete all → checklist completed
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  UPDATE checklist_tasks SET done_at = now() WHERE checklist_id = cl;
  PERFORM pg_temp.check((SELECT completed_at IS NOT NULL FROM checklists WHERE id = cl), 'checklist auto-completed');
  UPDATE checklist_tasks SET done_at = NULL WHERE id = t;
  PERFORM pg_temp.check((SELECT completed_at IS NULL FROM checklists WHERE id = cl), 'checklist reopened when a task is unticked');

  -- Offboarding on archive ---------------------------------------------------
  UPDATE profiles SET active = false, employment_end_date = CURRENT_DATE + 14 WHERE id = newp;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM checklists WHERE profile_id = newp AND kind = 'offboarding'), 'offboarding checklist created');
  PERFORM pg_temp.check((SELECT assignee_id FROM checklist_tasks t JOIN checklists c ON c.id = t.checklist_id
                          WHERE c.profile_id = newp AND c.kind = 'offboarding' AND t.assignee_role = 'cfo' LIMIT 1) = kwame, 'cfo tasks go to cfo');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM employment_history WHERE profile_id = newp AND change_kind = 'left'), 'left row on archive');

  -- Documents: owner path rule, admin sees all, colleague sees none ----------
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  INSERT INTO employee_documents(profile_id, kind, title, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  VALUES (kofi, 'certificate', 'First aid', kofi || '/first-aid.pdf', 'first-aid.pdf', 'application/pdf', 100, kofi);
  PERFORM pg_temp.expect_error(
    format('INSERT INTO employee_documents(profile_id, title, storage_path, file_name, mime_type, size_bytes) VALUES (%L,''x'',%L,''x.pdf'',''application/pdf'',1)', kofi, yaw || '/x.pdf'),
    'row-level security');
  PERFORM pg_temp.as_user('esi@verve-energyresources.com');
  INSERT INTO employee_documents(profile_id, kind, title, storage_path, file_name, mime_type, size_bytes, visible_to_employee, uploaded_by)
  VALUES (kofi, 'other', 'Internal note', kofi || '/note.pdf', 'note.pdf', 'application/pdf', 100, false, esi);
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT count(*) FROM employee_documents WHERE profile_id = kofi) = 1, 'employee sees only visible docs');
  PERFORM pg_temp.as_user('yaw@verve-energyresources.com');
  PERFORM pg_temp.check((SELECT count(*) FROM employee_documents WHERE profile_id = kofi) = 0, 'colleague sees no docs');

  RAISE NOTICE 'ALL PEOPLE RECORDS TESTS PASSED';
END $$;
ROLLBACK;
