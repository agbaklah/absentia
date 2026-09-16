# Absentia Roadmap — BambooHR-level HR + Petty Cash

**Status (16 Sep 2026): Phases 0–5 built and tested locally; not yet pushed to
production.** Deferred: hourly leave (day-level + AM/PM half days cover current
needs), PWA/offline. See `docs/DEPLOYMENT.md` for the rollout checklist.

Target: bring Absentia to parity with BambooHR's Time Off module, add the core of
its People/Records module, and add a **Petty Cash** reimbursement workflow
(employees upload receipts → CFO reviews → reimburses).

Stack stays as-is: TanStack Start, React 19, Tailwind v4, shadcn, Supabase
(Postgres + RLS + Storage + Edge Functions), Bun.

Conventions carried forward:
- One migration per feature under `supabase/migrations/`, RLS on every table.
- Data hooks live in `src/lib/*.ts` (TanStack Query), pure logic in `src/lib/*.ts`
  with a sibling `*.test.ts` (bun test).
- Routes are file-based under `src/routes/_authenticated/`.
- Roles are modelled, never people. Kwame gets the `cfo` role; the code never
  references him by name.

---

## Phase 0 — Foundations (unblocks everything else)

| # | Item | Notes |
|---|------|-------|
| 0.1 | Add `cfo` to `app_role`; extend `has_role()` / `profile_role()` guards | `cfo` = employee permissions + full Petty Cash authority. Admin/super_admin cannot approve expenses unless also CFO. |
| 0.2 | `notifications` table + in-app bell | `(id, recipient_id, kind, title, body, link, read_at, created_at)`. Realtime subscription in the sidebar. |
| 0.3 | Email edge function (`send-notification`) | Resend via Supabase Edge Function; DB trigger enqueues, function delivers. Templates: request submitted / approved / rejected, expense submitted / approved / paid / rejected. |
| 0.4 | Private Storage bucket `receipts` | RLS: owner can upload/read own; `cfo`, `admin`, `super_admin` can read all. 10 MB cap, image/pdf only. |
| 0.5 | `app_settings` gains `currency` (default `GHS`), `company_name`, `petty_cash_limit` | |

## Phase 1 — Petty Cash (the new module)

**Schema**
```
expense_claims
  id, claimant_id → profiles, title, description,
  amount NUMERIC(12,2), currency TEXT DEFAULT 'GHS',
  category TEXT (fuel, transport, meals, supplies, other),
  expense_date DATE, status expense_status,
  submitted_at, reviewed_by, reviewed_at, decision_note,
  paid_at, paid_by, payment_method (cash | momo | bank_transfer), payment_ref,
  created_at

expense_receipts
  id, claim_id → expense_claims, storage_path, file_name, mime_type, size_bytes, uploaded_at

expense_status ENUM: draft, submitted, approved, rejected, paid
```
State machine: `draft → submitted → (approved → paid) | rejected`. Employee can
edit/delete only in `draft`; can withdraw in `submitted`. Only `cfo` can move
`submitted → approved/rejected` and `approved → paid`. Enforced by trigger +
RLS, mirroring `prevent_self_status_change()` for leave.

**UI**
- `/expenses` (employee): my claims list with status chips, "New claim" dialog
  (amount, category, date, description, drag-drop receipt upload with preview),
  claim detail sheet showing receipts + timeline.
- `/expenses/review` (cfo): queue tabbed by status, totals per status, claim
  detail with receipt viewer (image/PDF), Approve / Reject (with note) /
  Mark paid (method + reference). Bulk "mark paid".
- Dashboard KPI cards for cfo: pending count & total, paid this month.
- Sidebar: "Petty Cash" for everyone; "Expense Review" for cfo.
- Audit log rows on every status change.
- CSV export of claims for a date range (finance reconciliation).

## Phase 2 — Time Off to BambooHR parity

| # | Feature | Schema / notes |
|---|---------|----------------|
| 2.1 | Team coverage warnings | Enforce `max_concurrent_absent` at request time; show who else is off. RPC `coverage_for_range(team_id, from, to)`. |
| 2.2 | Half-day (AM/PM) leave | `leave_entries.day_part` (`full`,`am`,`pm`); `counts_as_days` × 0.5. Calendar renders split cells. |
| 2.3 | Cancel own leave | Employee cancels pending, or approved-but-future entries; manager notified. New status `cancelled`. |
| 2.4 | Leave policies | `leave_policies` (accrual: annual/monthly, waiting_period_days, min_notice_days, max_balance_days, carryover_cap). `profiles.policy_id`. |
| 2.5 | Balance ledger | `leave_balance_transactions` (employee, date, kind: accrual/usage/adjustment/carryover/expiry, days, ref). Balance = SUM. Backfill from current allowances. |
| 2.6 | Blackout dates | `blackout_periods` (team_id nullable, from, to, reason). Request dialog blocks/warns. |
| 2.7 | Year-end rollover | Scheduled edge function (`pg_cron`): apply carry-over cap, write ledger rows, seed next year. |
| 2.8 | Multi-level approval + delegation | `approval_chains` per team (manager → admin); `approval_delegations` (from, to, from_date, to_date). |
| 2.9 | Public holiday import | Fetch from Nager.Date by country (GH default) into `public_holidays`; settings page button. |
| 2.10 | Audit log viewer | `/audit` for admin/super_admin; filter by actor/entity/date. |

## Phase 3 — People & Records (BambooHR "Employees")

| # | Feature | Notes |
|---|---------|-------|
| 3.1 | Rich employee profile | `profiles` gains job_title, phone, date_of_birth, address, emergency contact, national_id (masked), bank/MoMo details (masked, cfo-visible for reimbursement). |
| 3.2 | Job history | `employment_history` (title, team, effective_date, salary optional). Timeline on profile. |
| 3.3 | Documents | Storage bucket `employee-docs`; `employee_documents` (contract, ID, certifications). Owner + admin visibility. |
| 3.4 | Org chart & directory | Tree from `teams.manager_id` + `profiles.team_id`; searchable directory with photo/initials. |
| 3.5 | Onboarding / offboarding checklists | `checklist_templates`, `checklist_tasks` (assignee, due, done). Triggered on hire / `active=false`. |
| 3.6 | Custom fields | `profile_field_definitions` + `profile_field_values` (jsonb). |

## Phase 4 — Reporting

- `/reports`: leave usage by team/type, PTO liability (ledger × day-rate optional),
  absence trends, sick-threshold breaches, petty cash spend by category/month.
- Every report exports CSV; charts follow the dataviz palette.
- Headcount & turnover from `employment_history`.

## Phase 5 — Polish

- PWA / mobile layout pass (receipt upload from phone camera).
- Weekly manager digest email (who's out next week, pending approvals).
- Settings: company branding, fiscal year start, working-days per team.

---

## Build order

1. Phase 0 (roles, notifications, storage, settings)
2. Phase 1 Petty Cash end-to-end
3. Phase 2 items 2.1 → 2.3 → 2.10 (quick wins), then 2.4/2.5 (policy engine), then the rest
4. Phase 3
5. Phase 4, 5

Each phase ships as its own commit series with migrations applied via
`supabase db push` and a `bun test` + `bun run build` gate.
