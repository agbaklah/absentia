-- Add a distinct top-tier role. Kept in its own migration because an enum
-- value added with ALTER TYPE cannot be *used* in the same transaction that
-- added it; the guards live in 20260818000001_super_admin_guards.sql.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
