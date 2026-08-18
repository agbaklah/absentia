import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

export type EmployeeRow = {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "manager" | "employee" | "super_admin";
  team_id: string | null;
  employment_start_date: string;
  active: boolean;
  auth_user_id: string | null;
};
export type TeamRow = { id: string; name: string; manager_id: string | null };
export type EntryRow = {
  id: string;
  employee_id: string;
  date: string;
  leave_code: string;
  status: "pending" | "approved" | "rejected";
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
        .select("id, full_name, email, role, team_id, employment_start_date, active, auth_user_id")
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
