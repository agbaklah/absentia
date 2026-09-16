-- Shared helpers for DB tests (prepended by test/db/run.sh).
CREATE OR REPLACE FUNCTION pg_temp.as_user(_email text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE uid uuid;
BEGIN
  SELECT auth_user_id INTO uid FROM public.profiles WHERE email = _email;
  IF uid IS NULL THEN RAISE EXCEPTION 'no auth user for %', _email; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('role', 'postgres', true); END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(_sql text, _needle text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RAISE EXCEPTION 'EXPECTED FAILURE but succeeded: %', _sql;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%EXPECTED FAILURE%' THEN RAISE; END IF;
  IF position(_needle in SQLERRM) = 0 THEN
    RAISE EXCEPTION 'wrong error for [%]: got "%", wanted "%"', _sql, SQLERRM, _needle;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.check(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(_cond, false) THEN RAISE EXCEPTION 'CHECK FAILED: %', _msg; END IF; END $$;
