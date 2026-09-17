BEGIN;
DO $$
DECLARE kofi uuid := (SELECT id FROM profiles WHERE email='kofi@verve-energyresources.com');
BEGIN
  -- End users cannot flip password-security columns on their own row.
  PERFORM pg_temp.as_user('kofi@verve-energyresources.com');
  PERFORM pg_temp.expect_error(
    format('UPDATE profiles SET force_password_change = true WHERE id = %L', kofi),
    'force_password_change');
  -- Employees may still edit their own phone (self-edit path unaffected).
  UPDATE profiles SET phone = '+233 20 000 0000' WHERE id = kofi;
  PERFORM pg_temp.check((SELECT phone FROM profiles WHERE id = kofi) = '+233 20 000 0000', 'self phone edit works');
  -- Service role (server functions) may set them.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'postgres', true);
  UPDATE profiles SET force_password_change = true WHERE id = kofi;
  PERFORM pg_temp.check((SELECT force_password_change FROM profiles WHERE id = kofi), 'service role can set flag');
  -- leave-attachments bucket must be private.
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.check((SELECT NOT public FROM storage.buckets WHERE id = 'leave-attachments'), 'leave-attachments bucket private');
  RAISE NOTICE 'ALL SECURITY HARDENING TESTS PASSED';
END $$;
ROLLBACK;
