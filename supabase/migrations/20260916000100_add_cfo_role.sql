-- Chief Financial Officer role. Employee-level leave permissions plus full
-- authority over petty-cash claims (review, approve, reject, reimburse).
-- Separate migration: an enum value cannot be used in the transaction that
-- adds it — the guards/policies live in 20260916000200_foundations.sql.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cfo';
