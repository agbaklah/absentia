-- Track the admin-initiated temporary password so we can enforce expiration
-- and prevent reuse when the employee changes their password.
-- temp_password_hash   : SHA-256 hex of the generated temporary password
-- temp_password_expires_at : when the temporary password stops working
-- password_changed_at   : last time the password was changed/reset (for audit)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS temp_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS temp_password_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
