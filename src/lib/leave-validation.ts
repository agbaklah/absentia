import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LeaveValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  requested_days: number | null;
  available_days: number | null;
};

/** Normalise the RPC's JSON into a typed result (tolerates missing keys). */
export function parseValidation(raw: unknown): LeaveValidation {
  const o = (raw ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    ok: o.ok === true,
    errors: list(o.errors),
    warnings: list(o.warnings),
    requested_days: num(o.requested_days),
    available_days: num(o.available_days),
  };
}

/**
 * Ask the database to validate a leave request (policy, notice, blackout,
 * balance, team coverage) so the dialog can show errors/warnings before the
 * user submits. Debounced; the trigger re-checks on insert regardless.
 */
export function useLeaveValidation(employeeId: string, dates: string[], leaveCode: string) {
  const [result, setResult] = useState<LeaveValidation | null>(null);
  const [checking, setChecking] = useState(false);
  const key = `${employeeId}|${leaveCode}|${dates.join(",")}`;

  useEffect(() => {
    if (!employeeId || dates.length === 0) {
      setResult(null);
      return;
    }
    let alive = true;
    setChecking(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("validate_leave_request", {
        _employee: employeeId,
        _dates: dates,
        _leave_code: leaveCode,
      });
      if (!alive) return;
      setChecking(false);
      setResult(
        error
          ? {
              ok: true,
              errors: [],
              warnings: [error.message],
              requested_days: null,
              available_days: null,
            }
          : parseValidation(data),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { result, checking };
}
