-- Employees can cancel their own leave (pending, or approved-but-future).
-- Separate migration: the enum value cannot be referenced in the transaction
-- that adds it — rules live in 20260916000500_leave_policies.sql.
ALTER TYPE public.leave_status ADD VALUE IF NOT EXISTS 'cancelled';
