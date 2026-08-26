import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Year-end carryover processing.
 *
 * For every active employee:
 *   1. Look up the previous year's leave_allowances record.
 *   2. Calculate remaining vacation days:
 *        remaining = vacation_allowance + carried_over + adjustment - vacation_days_used
 *   3. Cap remaining at carryover_cap_days (from app_settings).
 *   4. Create or update the next year's allowance with the capped carryover.
 *
 * Only callable by admin or super_admin.
 */
export const processYearEndCarryover = createServerFn({ method: "POST" })
  .validator((d: { targetYear: number }) => d)
  .handler(async ({ data }) => {
    // Bounds-check targetYear to prevent abuse
    const currentYear = new Date().getFullYear();
    if (data.targetYear < currentYear || data.targetYear > currentYear + 2) {
      return { error: "Target year must be within 2 years of the current year." } as const;
    }
    // --- caller auth ---
    const authHeader = getRequest()?.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return { error: "Unauthorized" } as const;

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const {
      data: { user: caller },
      error: callerError,
    } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !caller) return { error: "Unauthorized" } as const;

    const { data: callerProfile, error: callerProfileError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, role")
        .eq("auth_user_id", caller.id)
        .maybeSingle();
    if (callerProfileError || !callerProfile)
      return { error: "Unauthorized" } as const;

    if (
      callerProfile.role !== "super_admin" &&
      callerProfile.role !== "admin"
    ) {
      return {
        error: "You do not have permission to process carryover.",
      } as const;
    }

    const prevYear = data.targetYear - 1;
    const nextYear = data.targetYear;

    // --- fetch carryover cap from settings ---
    const { data: settings } = await supabaseAdmin
      .from("app_settings")
      .select("carryover_cap_days")
      .eq("key", "default")
      .maybeSingle();
    const carryoverCap = settings
      ? Number(settings.carryover_cap_days)
      : 5;

    // --- fetch previous year's allowances ---
    const { data: prevAllowances, error: prevErr } = await supabaseAdmin
      .from("leave_allowances")
      .select("*")
      .eq("year", prevYear);
    if (prevErr) return { error: prevErr.message } as const;

    // --- fetch previous year's leave entries (approved only) ---
    const { data: prevEntries, error: entryErr } = await supabaseAdmin
      .from("leave_entries")
      .select("employee_id, leave_code")
      .gte("date", `${prevYear}-01-01`)
      .lte("date", `${prevYear}-12-31`)
      .eq("status", "approved");
    if (entryErr) return { error: entryErr.message } as const;

    // --- fetch active employees ---
    const { data: employees, error: empErr } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("active", true);
    if (empErr) return { error: empErr.message } as const;

    // --- fetch existing next year allowances (to avoid duplicates) ---
    const { data: nextAllowances } = await supabaseAdmin
      .from("leave_allowances")
      .select("*")
      .eq("year", nextYear);
    const nextMap = new Map(
      (nextAllowances ?? []).map((a) => [a.employee_id, a])
    );

    let processed = 0;
    let capped = 0;

    for (const emp of employees ?? []) {
      const prev = prevAllowances?.find((a) => a.employee_id === emp.id);

      // Previous year vacation used (approved entries with vacation-type codes)
      const VACATION_CODES = new Set(["V", "L1", "L2"]);
      const vacationUsed = (prevEntries ?? [])
        .filter(
          (e) =>
            e.employee_id === emp.id && VACATION_CODES.has(e.leave_code)
        )
        .length;

      // Calculate previous year's remaining
      const prevAllowance = prev ? Number(prev.vacation_allowance_days) : 21;
      const prevCarry = prev ? Number(prev.carried_over_days) : 0;
      const prevAdj = prev ? Number(prev.adjustment_days) : 0;
      const remaining = Math.max(
        0,
        prevAllowance + prevCarry + prevAdj - vacationUsed
      );

      // Cap at carryover limit
      const carryover = Math.min(remaining, carryoverCap);
      if (remaining > carryoverCap) capped++;

      // Create or update next year's allowance
      const existing = nextMap.get(emp.id);
      if (existing) {
        // Update carryover only — don't overwrite manual adjustments
        await supabaseAdmin
          .from("leave_allowances")
          .update({ carried_over_days: carryover })
          .eq("id", existing.id);
      } else {
        await supabaseAdmin.from("leave_allowances").insert({
          employee_id: emp.id,
          year: nextYear,
          vacation_allowance_days: prevAllowance,
          carried_over_days: carryover,
          adjustment_days: 0,
        });
      }

      processed++;
    }

    // --- audit log ---
    await supabaseAdmin.from("audit_log").insert({
      actor_id: callerProfile.id,
      action: "year_end_carryover",
      entity: "leave_allowances",
      after: {
        target_year: nextYear,
        processed,
        capped,
        carryover_cap: carryoverCap,
      },
    });

    return {
      error: null,
      processed,
      capped,
      carryoverCap,
    } as const;
  });
