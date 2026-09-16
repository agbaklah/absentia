import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { Role } from "@/lib/auth-context";
import type { ClaimRow, ReceiptRow } from "@/lib/expenses";

export type EmployeeRow = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  team_id: string | null;
  employment_start_date: string;
  active: boolean;
  auth_user_id: string | null;
  policy_id: string | null;
};
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type TeamRow = { id: string; name: string; manager_id: string | null };
export type EntryRow = {
  id: string;
  employee_id: string;
  date: string;
  leave_code: string;
  status: LeaveStatus;
  note: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  decision_note: string | null;
};
export type HolidayRow = { id: string; date: string; name: string; region: string };
export type AllowanceRow = {
  id: string;
  employee_id: string;
  year: number;
  vacation_allowance_days: number;
  carried_over_days: number;
  adjustment_days: number;
};

export const useTeams = () =>
  useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as TeamRow[];
    },
  });

export const useEmployees = (opts?: { enabled?: boolean }) =>
  useQuery({
    queryKey: ["employees"],
    enabled: opts?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, full_name, email, role, team_id, employment_start_date, active, auth_user_id, policy_id",
        )
        .eq("active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as EmployeeRow[];
    },
  });

export const useHolidays = (year: number) =>
  useQuery({
    queryKey: ["holidays", year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("public_holidays")
        .select("*")
        .gte("date", `${year}-01-01`)
        .lte("date", `${year}-12-31`);
      if (error) throw error;
      return (data ?? []) as HolidayRow[];
    },
  });

export const useEntries = (year: number) =>
  useQuery({
    queryKey: ["entries", year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_entries")
        .select("*")
        .gte("date", `${year}-01-01`)
        .lte("date", `${year}-12-31`);
      if (error) throw error;
      return (data ?? []) as EntryRow[];
    },
  });

export const useAllowances = (year: number, opts?: { enabled?: boolean }) =>
  useQuery({
    queryKey: ["allowances", year],
    enabled: opts?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.from("leave_allowances").select("*").eq("year", year);
      if (error) throw error;
      return (data ?? []) as AllowanceRow[];
    },
  });

export type SettingsRow = {
  key: string;
  default_allowance_days: number;
  carryover_cap_days: number;
  working_days: number[];
  max_concurrent_absent: number;
  sick_threshold_days: number;
  company_name: string;
  currency: string;
  petty_cash_limit: number;
  holiday_region: string;
};

export const useSettings = () =>
  useQuery({
    queryKey: ["settings"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("*")
        .eq("key", "default")
        .maybeSingle();
      if (error) throw error;
      return data as SettingsRow | null;
    },
  });

export type NotificationRow = {
  id: string;
  recipient_id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

/** Latest notifications for the signed-in user (RLS scopes to recipient). */
export const useNotifications = (opts?: { enabled?: boolean }) =>
  useQuery({
    queryKey: ["notifications"],
    enabled: opts?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as NotificationRow[];
    },
  });

// ---------------------------------------------------------------------------
// Petty cash
// ---------------------------------------------------------------------------
const claimCols =
  "id, claim_no, claimant_id, title, description, category, amount, currency, expense_date, status, submitted_at, reviewed_by, reviewed_at, decision_note, paid_by, paid_at, payment_method, payment_ref, created_at, updated_at";

/** Claims visible to the caller: own for employees, everything for reviewers. */
export const useClaims = (opts?: { enabled?: boolean }) =>
  useQuery({
    queryKey: ["claims"],
    enabled: opts?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_claims")
        .select(claimCols)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c) => ({ ...c, amount: Number(c.amount) })) as ClaimRow[];
    },
  });

export const useReceipts = (claimId: string | null) =>
  useQuery({
    queryKey: ["receipts", claimId],
    enabled: !!claimId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_receipts")
        .select("*")
        .eq("claim_id", claimId!)
        .order("uploaded_at");
      if (error) throw error;
      return (data ?? []) as ReceiptRow[];
    },
  });

// ---------------------------------------------------------------------------
// Leave policy engine
// ---------------------------------------------------------------------------
export type PolicyRow = {
  id: string;
  name: string;
  description: string | null;
  accrual_method: "annual" | "monthly";
  annual_days: number;
  sick_days: number;
  carryover_cap_days: number;
  waiting_period_days: number;
  min_notice_days: number;
  max_consecutive_days: number | null;
  allow_negative_balance: boolean;
  is_default: boolean;
};

export const usePolicies = () =>
  useQuery({
    queryKey: ["policies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leave_policies").select("*").order("name");
      if (error) throw error;
      return (data ?? []).map((p) => ({
        ...p,
        annual_days: Number(p.annual_days),
        sick_days: Number(p.sick_days),
        carryover_cap_days: Number(p.carryover_cap_days),
      })) as PolicyRow[];
    },
  });

export type BlackoutRow = {
  id: string;
  team_id: string | null;
  start_date: string;
  end_date: string;
  reason: string;
  created_by: string | null;
};

export const useBlackouts = () =>
  useQuery({
    queryKey: ["blackouts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blackout_periods")
        .select("*")
        .order("start_date");
      if (error) throw error;
      return (data ?? []) as BlackoutRow[];
    },
  });

export type DelegationRow = {
  id: string;
  delegator_id: string;
  delegate_id: string;
  start_date: string;
  end_date: string;
};

export const useDelegations = () =>
  useQuery({
    queryKey: ["delegations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approval_delegations")
        .select("*")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DelegationRow[];
    },
  });

export type BalanceTxRow = {
  id: string;
  employee_id: string;
  year: number;
  kind: "adjustment" | "carryover" | "expiry" | "allowance";
  days: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export const useBalanceTransactions = (employeeId: string | null) =>
  useQuery({
    queryKey: ["balance-tx", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_balance_transactions")
        .select("*")
        .eq("employee_id", employeeId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, days: Number(r.days) })) as BalanceTxRow[];
    },
  });

export type AuditRow = {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ts: string;
};

export const useAuditLog = (opts: { enabled: boolean; limit?: number }) =>
  useQuery({
    queryKey: ["audit", opts.limit ?? 300],
    enabled: opts.enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("*")
        .order("ts", { ascending: false })
        .limit(opts.limit ?? 300);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });
