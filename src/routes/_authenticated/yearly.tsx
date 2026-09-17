import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEmployees, useEntries, useTeams, useAllowances } from "@/lib/data";
import { LEAVE_MAP } from "@/lib/leave";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/yearly")({
  component: Yearly,
});

function Yearly() {
  const { loading: authLoading, isManagement } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const teams = useTeams();
  const employees = useEmployees();
  const entries = useEntries(year);
  const allowances = useAllowances(year);

  const rows = useMemo(() => {
    const alwMap = new Map((allowances.data ?? []).map((a) => [a.employee_id, a]));
    return (employees.data ?? []).map((emp) => {
      const empEntries = (entries.data ?? []).filter(
        (e) => e.employee_id === emp.id && e.status === "approved",
      );
      const cat = { vacation: 0, sick: 0, parental: 0, compassionate: 0, toil: 0, wfh: 0 };
      for (const e of empEntries) {
        const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
        if (!t || t.category === "holiday") continue;
        (cat as Record<string, number>)[t.category] += t.days;
      }
      const a = alwMap.get(emp.id);
      const allowance = a ? Number(a.vacation_allowance_days) : 21;
      const carry = a ? Number(a.carried_over_days) : 0;
      const adj = a ? Number(a.adjustment_days) : 0;
      const remaining = allowance + carry + adj - cat.vacation;
      const total = cat.vacation + cat.sick + cat.parental + cat.compassionate + cat.toil;
      return { emp, ...cat, allowance, remaining, total };
    });
  }, [employees.data, entries.data, allowances.data]);

  const byTeam = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const tId = r.emp.team_id ?? "none";
      if (!map.has(tId)) map.set(tId, []);
      map.get(tId)!.push(r);
    }
    return map;
  }, [rows]);

  const exportCSV = () => {
    const header = [
      "Team",
      "Employee",
      "Vacation Taken",
      "Allowance",
      "Remaining",
      "Sick",
      "Parental",
      "Compassionate",
      "TOIL",
      "WFH",
      "Total Absence",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      const t = (teams.data ?? []).find((x) => x.id === r.emp.team_id);
      lines.push(
        [
          t?.name ?? "",
          r.emp.full_name,
          r.vacation,
          r.allowance,
          r.remaining,
          r.sick,
          r.parental,
          r.compassionate,
          r.toil,
          r.wfh,
          r.total,
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yearly-summary-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (authLoading) return null;
  if (!isManagement) return <Navigate to="/dashboard" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Yearly summary"
        description="Vacation, sickness and other leave totals for the whole year."
      >
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCSV} className="gap-2">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </PageHeader>

      <Card className="overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr className="text-left">
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2 text-right">Vac taken</th>
                <th className="px-3 py-2 text-right">Allowance</th>
                <th className="px-3 py-2 text-right">Remaining</th>
                <th className="px-3 py-2 text-right">Sick</th>
                <th className="px-3 py-2 text-right">Parental</th>
                <th className="px-3 py-2 text-right">Compassionate</th>
                <th className="px-3 py-2 text-right">TOIL</th>
                <th className="px-3 py-2 text-right">WFH</th>
                <th className="px-3 py-2 text-right">Total absence</th>
              </tr>
            </thead>
            <tbody>
              {(teams.data ?? []).map((team) => {
                const trows = byTeam.get(team.id) ?? [];
                if (trows.length === 0) return null;
                const sub = trows.reduce(
                  (s, r) => ({
                    vacation: s.vacation + r.vacation,
                    allowance: s.allowance + r.allowance,
                    remaining: s.remaining + r.remaining,
                    sick: s.sick + r.sick,
                    parental: s.parental + r.parental,
                    compassionate: s.compassionate + r.compassionate,
                    toil: s.toil + r.toil,
                    wfh: s.wfh + r.wfh,
                    total: s.total + r.total,
                  }),
                  {
                    vacation: 0,
                    allowance: 0,
                    remaining: 0,
                    sick: 0,
                    parental: 0,
                    compassionate: 0,
                    toil: 0,
                    wfh: 0,
                    total: 0,
                  },
                );
                return (
                  <Fragment key={`t-${team.id}`}>
                    <tr className="bg-primary/5">
                      <td colSpan={10} className="px-3 py-2 font-semibold">
                        {team.name}
                      </td>
                    </tr>
                    {trows.map((r) => {
                      const usedPct =
                        r.allowance > 0 ? Math.min(100, (r.vacation / r.allowance) * 100) : 0;
                      return (
                        <tr key={r.emp.id} className="border-t transition-colors hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">{r.emp.full_name}</td>
                          <td className="px-3 py-2 text-right tabular">{r.vacation.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right tabular">{r.allowance.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right tabular">
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={cn(
                                    "h-full rounded-full",
                                    r.remaining < 0 ? "bg-red-500" : "bg-emerald-500",
                                  )}
                                  style={{ width: `${usedPct}%` }}
                                />
                              </div>
                              <span
                                className={cn(
                                  r.remaining < 0 ? "font-semibold text-destructive" : "",
                                )}
                              >
                                {r.remaining.toFixed(1)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular">{r.sick.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right tabular">{r.parental.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right tabular">
                            {r.compassionate.toFixed(1)}
                          </td>
                          <td className="px-3 py-2 text-right tabular">{r.toil.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right tabular">{r.wfh.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular">
                            {r.total.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t bg-muted/40 font-medium">
                      <td className="px-3 py-2">Subtotal</td>
                      <td className="px-3 py-2 text-right tabular">{sub.vacation.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular">{sub.allowance.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular">{sub.remaining.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular">{sub.sick.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular">{sub.parental.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular">
                        {sub.compassionate.toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-right tabular">{sub.toil.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular">{sub.wfh.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular">{sub.total.toFixed(1)}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
