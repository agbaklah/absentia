-- Reports-only role (oversight): reads everything, approves nothing.
-- Separate migration: enum values cannot be used in the same transaction.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'viewer';
