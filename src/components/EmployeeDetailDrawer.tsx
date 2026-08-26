import { useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InitialsAvatar } from "@/components/InitialsAvatar";
import { useEntries, useTeams, useAllowances, type EmployeeRow, type EntryRow } from "@/lib/data";
import { LEAVE_MAP, fmtDayShort } from "@/lib/leave";
import { groupEntries } from "@/lib/requests-util";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Mail, Users } from "lucide-react";

const statusVariant: Record<EntryRow["status"], "default" | "secondary" | "destructive"> = {
  approved: "default",
  pending: "secondary",
  rejected: "destructive",
};

const roleTone: Record<string, "secondary" | "outline" | "default"> = {
  employee: "secondary",
  manager: "outline",
  admin: "default",
  super_admin: "default",
};

const roleLabel: Record<string, string> = {
  employee: "Employee",
  manager: "Manager",
  admin: "Admin",
  super_admin: "Super Admin",
};

/**
 * Side drawer with an employee's allowance breakdown, leave history for the
 * year, and recent activity. Rendered by the employees page and opened via the
 * command palette (search param `view=<employeeId>`).
 */
export function EmployeeDetailDrawer({
  employee,
  onClose,
}: {
  employee: EmployeeRow | null;
  onClose: () => void;
}) {
  const year = new Date().getFullYear();
  const { isAdmin } = useAuth();
  const teams = useTeams();
  const entries = useEntries(year);
  const qc = useQueryClient();
  // Only fetch allowances once there's an employee to show.
  const allowances = useAllowances(year, { enabled: !!employee });

  const team = (teams.data ?? []).find((t) => t.id === employee?.team_id);
  const mine = useMemo(
    () => (entries.data ?? []).filter((e) => e.employee_id === employee?.id),
    [entries.data, employee?.id],
  );

  const stats = useMemo(() => {
    const approved = mine.filter((e) => e.status === "approved");
    const sum = (cat: string) =>
      approved.reduce((s, e) => {
        const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
        return s + (t && t.category === cat ? t.days : 0);
      }, 0);
    const a = (allowances.data ?? []).find((x) => x.employee_id === employee?.id);
    const allowance = a
      ? Number(a.vacation_allowance_days) + Number(a.carried_over_days) + Number(a.adjustment_days)
      : 21;
    const vacation = sum("vacation");
    return {
      allowance,
      vacation,
      remaining: allowance - vacation,
      sick: sum("sick"),
      wfh: sum("wfh"),
      parental: sum("parental"),
      pending: mine.filter((e) => e.status === "pending").length,
      approvedCount: approved.length,
    };
  }, [mine, allowances.data, employee?.id]);

  const groups = useMemo(() => groupEntries(mine), [mine]);

  const pctUsed = stats.allowance > 0 ? Math.min(100, (stats.vacation / stats.allowance) * 100) : 0;

  // Per-category approved days for the mini breakdown list.
  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of mine) {
      if (e.status !== "approved") continue;
      const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
      if (!t || t.category === "holiday") continue;
      map.set(t.category, (map.get(t.category) ?? 0) + t.days);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [mine]);

  // All individual entries, newest first.
  const recent = useMemo(
    () => [...mine].sort((a, b) => b.date.localeCompare(a.date)),
    [mine],
  );

  const changeTeam = async (id: string, teamId: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({ team_id: teamId || null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    const teamName = (teams.data ?? []).find((t) => t.id === teamId)?.name ?? "Unassigned";
    toast.success(`Moved to ${teamName}`);
    void qc.invalidateQueries({ queryKey: ["employees"] });
  };

  return (
    <Sheet open={!!employee} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {employee && (
          <>
            <SheetHeader className="border-b pb-4">
              <div className="flex items-center gap-3">
                <InitialsAvatar name={employee.full_name} className="h-12 w-12 text-base" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <SheetTitle className="text-lg truncate">{employee.full_name}</SheetTitle>
                    <Badge variant={roleTone[employee.role] ?? "secondary"} className="shrink-0">
                      {roleLabel[employee.role] ?? employee.role}
                    </Badge>
                  </div>
                  <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {employee.email}
                    </span>
                    <span className="text-muted-foreground/50">·</span>
                    {isAdmin ? (
                      <Select
                        value={employee.team_id ?? ""}
                        onValueChange={(v) => changeTeam(employee.id, v)}
                      >
                        <SelectTrigger
                          className="h-6 w-auto min-w-[8rem] border-0 bg-transparent p-0 text-xs text-muted-foreground hover:bg-muted"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Unassigned</SelectItem>
                          {(teams.data ?? []).map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {team?.name ?? "Unassigned"}
                      </span>
                    )}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="space-y-6 pt-4">
              {/* Allowance breakdown */}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium">Allowance — {year}</h3>
                  <Badge variant="secondary" className="tabular">
                    {Math.round(pctUsed)}% used
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Annual allowance" value={`${stats.allowance.toFixed(1)}d`} />
                  <Stat label="Vacation taken" value={`${stats.vacation.toFixed(1)}d`} />
                  <Stat
                    label="Remaining"
                    value={`${stats.remaining.toFixed(1)}d`}
                    accent={stats.remaining < 0}
                  />
                  <Stat label="Sick" value={`${stats.sick.toFixed(1)}d`} />
                  <Stat label="WFH" value={`${stats.wfh.toFixed(1)}d`} />
                  <Stat label="Pending" value={String(stats.pending)} />
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      stats.remaining < 0
                        ? "bg-red-500"
                        : "bg-gradient-to-r from-emerald-600 to-emerald-500",
                    )}
                    style={{ width: `${pctUsed}%` }}
                  />
                </div>
                {byType.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    {byType.map(([cat, days]) => (
                      <div key={cat} className="flex items-center justify-between text-xs">
                        <span className="capitalize text-muted-foreground">{cat}</span>
                        <span className="tabular font-medium">{days.toFixed(1)}d</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Leave history for the year */}
              <section>
                <h3 className="mb-2 text-sm font-medium">Leave history</h3>
                {groups.length === 0 ? (
                  <p className="rounded-md border bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
                    No leave recorded this year.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {groups.map((g, i) => {
                      const t = LEAVE_MAP[g.code as keyof typeof LEAVE_MAP];
                      return (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="inline-block h-8 w-1.5 shrink-0 rounded-full"
                              style={{ background: t?.colour }}
                            />
                            <div className="min-w-0">
                              <div className="truncate font-medium">{t?.label ?? g.code}</div>
                              <div className="text-xs text-muted-foreground">
                                {g.start}
                                {g.end !== g.start ? ` → ${g.end}` : ""} · {g.days} day
                                {g.days !== 1 ? "s" : ""}
                              </div>
                            </div>
                          </div>
                          <Badge variant={statusVariant[g.status]} className="shrink-0">
                            {g.status}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* Recent activity */}
              <section>
                <h3 className="mb-2 text-sm font-medium">Recent activity</h3>
                {recent.length === 0 ? (
                  <p className="rounded-md border bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
                    No entries yet this year.
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {recent.map((e) => {
                      const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
                      return (
                        <li
                          key={e.id}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <div className="truncate">
                                {fmtDayShort(e.date)} · <b>{t?.label ?? e.leave_code}</b>
                              </div>
                              {e.decision_note && (
                                <div className="truncate text-xs italic text-muted-foreground">
                                  “{e.decision_note}”
                                </div>
                              )}
                            </div>
                          </div>
                          <Badge variant={statusVariant[e.status]} className="shrink-0">
                            {e.status}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <p className="text-xs text-muted-foreground">
                Employed since {employee.employment_start_date} · data for {year}
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "tabular mt-0.5 font-display text-lg font-semibold",
          accent && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}
