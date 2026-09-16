import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { LeaveValidation } from "@/lib/leave-validation";

/** Errors / warnings / balance line under the leave request form. */
export function LeaveValidationNotice({
  result,
  checking,
}: {
  result: LeaveValidation | null;
  checking: boolean;
}) {
  if (checking && !result)
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking policy…
      </div>
    );
  if (!result) return null;
  return (
    <div className="space-y-1.5">
      {result.errors.map((e) => (
        <div
          key={e}
          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{e}</span>
        </div>
      ))}
      {result.warnings.map((w) => (
        <div
          key={w}
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{w}</span>
        </div>
      ))}
      {result.ok && result.errors.length === 0 && result.requested_days != null && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          {result.requested_days} day{result.requested_days === 1 ? "" : "s"}
          {result.available_days != null && (
            <>
              {" · "}
              {Math.max(0, result.available_days - result.requested_days)} left afterwards
            </>
          )}
          {checking && <Loader2 className="h-3 w-3 animate-spin" />}
        </div>
      )}
    </div>
  );
}
