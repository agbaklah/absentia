import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEmployees, useEntries, useTeams, useAllowances } from "@/lib/data";
import { LEAVE_MAP } from "@/lib/leave";

export const Route = createFileRoute("/_authenticated/yearly")({
  component: Yearly,
});

function Yearly() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const teams = useTeams();
  const employees = useEmployees();
  const entries = useEntries(year);
  const allowances = useAllowances(year);

  const rows = useMemo(() => {
    const alwMap = new Map((allowances.data ?? []).map((a) => [a.employee_id, a]));
    return (employees.data ?? []).map((emp) => {
      const empEntries = (entries.data ?? []).filter((e) => e.employee_id === emp.id && e.status === "approved");
      const cat = { vacation: 0, sick: 0, parental: 0, compassionate: 0, toil: 0, wfh: 0 };
      for (const e of empEntries) {
        const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
        if (!t || t.category === "holiday") continue;
        (cat as Record<string, number>)[t.category] += t.days;
      }
      const a = alwMap.get(emp.id);
      const allowance = a ? Number(a.vacation_allowance_days) : 24;
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
    const header = ["Team","Employee","Vacation Taken","Allowance","Remaining","Sick","Parental","Compassionate","TOIL","WFH","Total Absence"];
    const lines = [header.join(",")];
    for (const r of rows) {
      const t = (teams.data ?? []).find((x) => x.id === r.emp.team_id);
      lines.push([t?.name ?? "", r.emp.full_name, r.vacation, r.allowance, r.remaining, r.sick, r.parental, r.compassionate, r.toil, r.wfh, r.total].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `yearly-summary-${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Yearly summary</h1>
          <p className="text-sm text-muted-foreground">Vacation, sickness and other leave totals for the whole year.</p>
        </div>
        <div className="flex gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCSV}>Export CSV</Button>
        </div>
      </div>

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
                  { vacation: 0, allowance: 0, remaining: 0, sick: 0, parental: 0, compassionate: 0, toil: 0, wfh: 0, total: 0 },
                );
                return (
                  <>
                    <tr key={`h-${team.id}`} className="bg-primary/5">
                      <td colSpan={10} className="px-3 py-2 font-semibold">{team.name}</td>
                    </tr>
                    {trows.map((r) => (
                      <tr key={r.emp.id} className="border-t">
                        <td className="px-3 py-2">{r.emp.full_name}</td>
                        <td className="px-3 py-2 text-right">{r.vacation.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right">{r.allowance.toFixed(1)}</td>
                        <td className={`px-3 py-2 text-right ${r.remaining < 0 ? "text-destructive" : ""}`}>{r.remaining.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right">{r.sick.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right">{r.parental.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right">{r.compassionate.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right">{r.toil.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right">{r.wfh.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right font-medium">{r.total.toFixed(1)}</td>
                      </tr>
                    ))}
                    <tr className="border-t bg-muted/40 font-medium">
                      <td className="px-3 py-2">Subtotal</td>
                      <td className="px-3 py-2 text-right">{sub.vacation.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right">{sub.allowance.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right">{sub.remaining.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right">{sub.sick.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right">{sub.parental.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right">{sub.compassionate.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right">{sub.toil.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right">{sub.wfh.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right">{sub.total.toFixed(1)}</td>
                    </tr>
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}