import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useEntries, useAllowances } from "@/lib/data";
import { LEAVE_MAP } from "@/lib/leave";
import { useAuth } from "@/lib/auth-context";
import { Plane, Stethoscope, AlertTriangle } from "lucide-react";

/**
 * Compact leave balance widget for the employee dashboard.
 * Shows vacation and sick leave side by side with progress bars,
 * remaining days, and annual limits.
 */
export function LeaveBalanceWidget() {
  const { profile } = useAuth();
  const year = new Date().getFullYear();
  const entries = useEntries(year);
  const allowances = useAllowances(year);

  const mine = useMemo(
    () => (entries.data ?? []).filter((e) => e.employee_id === profile?.id),
    [entries.data, profile?.id],
  );

  const balance = useMemo(() => {
    const approved = mine.filter((e) => e.status === "approved");
    const sum = (cat: string) =>
      approved.reduce((s, e) => {
        const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
        return s + (t && t.category === cat ? t.days : 0);
      }, 0);
    const a = (allowances.data ?? []).find((x) => x.employee_id === profile?.id);
    const vacationAllowance = a
      ? Number(a.vacation_allowance_days) +
        Number(a.carried_over_days) +
        Number(a.adjustment_days)
      : 21;
    const sickAllowance = a?.sick_leave_allowance_days ?? 5;
    const vacation = sum("vacation");
    const sick = sum("sick");
    return {
      vacation: { used: vacation, total: vacationAllowance, remaining: vacationAllowance - vacation },
      sick: { used: sick, total: sickAllowance, remaining: sickAllowance - sick },
    };
  }, [mine, allowances.data, profile?.id]);

  return (
    <Card className="p-4">
      <div className="mb-3 text-sm font-medium">Leave Balance</div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Vacation */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600/10">
              <Plane className="h-3.5 w-3.5 text-emerald-700" />
            </span>
            <div className="flex-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-muted-foreground">Vacation</span>
                <span className="tabular text-xs text-muted-foreground">
                  {balance.vacation.remaining.toFixed(1)}d left
                </span>
              </div>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 transition-all duration-500"
              style={{
                width: `${balance.vacation.total > 0 ? Math.min(100, (balance.vacation.used / balance.vacation.total) * 100) : 0}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span className="tabular">{balance.vacation.used.toFixed(1)} used</span>
            <span className="tabular">{balance.vacation.total} days</span>
          </div>
        </div>

        {/* Sick */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-red-600/10">
              <Stethoscope className="h-3.5 w-3.5 text-red-700" />
            </span>
            <div className="flex-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-muted-foreground">Sick</span>
                <span className="tabular text-xs text-muted-foreground">
                  {balance.sick.remaining.toFixed(1)}d left
                </span>
              </div>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-red-600 to-red-500 transition-all duration-500"
              style={{
                width: `${balance.sick.total > 0 ? Math.min(100, (balance.sick.used / balance.sick.total) * 100) : 0}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span className="tabular">{balance.sick.used.toFixed(1)} used</span>
            <span className="tabular">{balance.sick.total} days</span>
          </div>
          {balance.sick.remaining <= 0 && (
            <div className="flex items-center gap-1 text-[11px] text-red-600">
              <AlertTriangle className="h-3 w-3" />
              <span>Sick leave exhausted</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
