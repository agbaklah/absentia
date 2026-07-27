import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { LEAVE_TYPES, LEAVE_MAP, MONTHS_SHORT, fmtISO } from "@/lib/leave";
import { useEmployees, useEntries, useTeams, useAllowances } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [teamId, setTeamId] = useState<string>("all");

  const teams = useTeams();
  const employees = useEmployees();
  const entries = useEntries(year);
  const allowances = useAllowances(year);

  const filteredEmployees = useMemo(() => {
    const list = employees.data ?? [];
    return teamId === "all" ? list : list.filter((e) => e.team_id === teamId);
  }, [employees.data, teamId]);

  const empIds = useMemo(() => new Set(filteredEmployees.map((e) => e.id)), [filteredEmployees]);
  const filteredEntries = useMemo(
    () => (entries.data ?? []).filter((e) => empIds.has(e.employee_id) && e.status === "approved"),
    [entries.data, empIds],
  );

  const kpis = useMemo(() => {
    const totals = { absence: 0, vacation: 0, sick: 0, wfh: 0, parental: 0 };
    for (const e of filteredEntries) {
      const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
      if (!t || t.category === "holiday") continue;
      totals.absence += t.days;
      if (t.category === "vacation") totals.vacation += t.days;
      if (t.category === "sick") totals.sick += t.days;
      if (t.category === "wfh") totals.wfh += t.days;
      if (t.category === "parental") totals.parental += t.days;
    }
    const alwMap = new Map((allowances.data ?? []).map((a) => [a.employee_id, a]));
    let allowanceTotal = 0;
    for (const emp of filteredEmployees) {
      const a = alwMap.get(emp.id);
      allowanceTotal += a
        ? Number(a.vacation_allowance_days) + Number(a.carried_over_days) + Number(a.adjustment_days)
        : 24;
    }
    const today = fmtISO(new Date());
    const outToday = filteredEntries.filter((e) => e.date === today).length;
    const pending = (entries.data ?? []).filter((e) => empIds.has(e.employee_id) && e.status === "pending").length;
    return {
      absence: totals.absence,
      vacation: totals.vacation,
      remaining: allowanceTotal - totals.vacation,
      sick: totals.sick,
      wfh: totals.wfh,
      outToday,
      pending,
    };
  }, [filteredEntries, filteredEmployees, allowances.data, entries.data, empIds]);

  const monthlyData = useMemo(() => {
    const rows = MONTHS_SHORT.map((m) => {
      const row: Record<string, number | string> = { month: m };
      for (const t of LEAVE_TYPES) if (t.category !== "holiday") row[t.code] = 0;
      return row;
    });
    for (const e of filteredEntries) {
      const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
      if (!t || t.category === "holiday") continue;
      const m = new Date(e.date).getMonth();
      rows[m][t.code] = (rows[m][t.code] as number) + t.days;
    }
    return rows;
  }, [filteredEntries]);

  const teamVac = useMemo(() => {
    const map = new Map<string, { name: string; taken: number; remaining: number }>();
    for (const t of teams.data ?? []) map.set(t.id, { name: t.name, taken: 0, remaining: 0 });
    const alwMap = new Map((allowances.data ?? []).map((a) => [a.employee_id, a]));
    for (const emp of employees.data ?? []) {
      if (!emp.team_id || (teamId !== "all" && emp.team_id !== teamId)) continue;
      const bucket = map.get(emp.team_id);
      if (!bucket) continue;
      const a = alwMap.get(emp.id);
      const allowance = a
        ? Number(a.vacation_allowance_days) + Number(a.carried_over_days) + Number(a.adjustment_days)
        : 24;
      const taken = (entries.data ?? [])
        .filter((e) => e.employee_id === emp.id && e.status === "approved")
        .reduce((s, e) => {
          const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
          return s + (t && t.category === "vacation" ? t.days : 0);
        }, 0);
      bucket.taken += taken;
      bucket.remaining += Math.max(0, allowance - taken);
    }
    return Array.from(map.values()).filter((r) => r.taken + r.remaining > 0);
  }, [teams.data, employees.data, entries.data, allowances.data, teamId]);

  const donut = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filteredEntries) {
      const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
      if (!t || t.category === "holiday") continue;
      map.set(t.category, (map.get(t.category) ?? 0) + t.days);
    }
    const catColour: Record<string, string> = {
      vacation: "#166534", sick: "#dc2626", parental: "#8b5cf6",
      compassionate: "#0ea5e9", toil: "#d97706", wfh: "#64748b",
    };
    return Array.from(map.entries()).map(([name, value]) => ({ name, value, fill: catColour[name] ?? "#888" }));
  }, [filteredEntries]);

  const sickTrend = useMemo(
    () =>
      MONTHS_SHORT.map((m, i) => ({
        month: m,
        sick: filteredEntries
          .filter((e) => {
            const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
            return t && t.category === "sick" && new Date(e.date).getMonth() === i;
          })
          .reduce((s, e) => s + LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP].days, 0),
      })),
    [filteredEntries],
  );

  const top = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filteredEntries) {
      const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
      if (!t || t.category === "holiday") continue;
      map.set(e.employee_id, (map.get(e.employee_id) ?? 0) + t.days);
    }
    return Array.from(map.entries())
      .map(([empId, days]) => ({
        name: filteredEmployees.find((x) => x.id === empId)?.full_name ?? "?",
        days,
      }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 10);
  }, [filteredEntries, filteredEmployees]);

  const today = fmtISO(new Date());
  const offToday = filteredEntries
    .filter((e) => e.date === today)
    .map((e) => {
      const emp = filteredEmployees.find((x) => x.id === e.employee_id);
      const team = (teams.data ?? []).find((t) => t.id === emp?.team_id);
      return { emp, team, code: e.leave_code };
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Organisation-wide absence overview.</p>
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
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All teams" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {(teams.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Absence days YTD" value={kpis.absence.toFixed(1)} />
        <Kpi label="Vacation taken" value={kpis.vacation.toFixed(1)} />
        <Kpi label="Vacation remaining" value={kpis.remaining.toFixed(1)} accent />
        <Kpi label="Sick days YTD" value={kpis.sick.toFixed(1)} />
        <Kpi label="WFH days YTD" value={kpis.wfh.toFixed(1)} />
        <Kpi label="Pending approvals" value={String(kpis.pending)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-2 text-sm font-medium">Absence days by month</div>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                {LEAVE_TYPES.filter((t) => t.category !== "holiday").map((t) => (
                  <Bar key={t.code} dataKey={t.code} stackId="a" fill={t.colour} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Absence mix</div>
          <div className="h-72">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={donut} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90}>
                  {donut.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Vacation taken vs. remaining by team</div>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={teamVac}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Legend />
                <Bar dataKey="taken" stackId="v" fill="#166534" name="Taken" />
                <Bar dataKey="remaining" stackId="v" fill="#d97706" name="Remaining" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Sick leave trend</div>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={sickTrend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Line type="monotone" dataKey="sick" stroke="#dc2626" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 text-sm font-medium">Top 10 by absence days</div>
          <ul className="divide-y">
            {top.map((r) => (
              <li key={r.name} className="flex items-center justify-between py-2 text-sm">
                <span>{r.name}</span>
                <span className="font-medium">{r.days.toFixed(1)}</span>
              </li>
            ))}
            {top.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">No absences yet.</li>}
          </ul>
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">Out today</div>
            <Badge variant="secondary">{kpis.outToday}</Badge>
          </div>
          <ul className="divide-y">
            {offToday.map((r, i) => (
              <li key={i} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">{r.emp?.full_name}</div>
                  <div className="text-xs text-muted-foreground">{r.team?.name}</div>
                </div>
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: LEAVE_MAP[r.code as keyof typeof LEAVE_MAP]?.colour }} />
                  <span className="text-xs">{LEAVE_MAP[r.code as keyof typeof LEAVE_MAP]?.label}</span>
                </span>
              </li>
            ))}
            {offToday.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Nobody is off today.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accent ? "text-accent" : ""}`}>{value}</div>
    </Card>
  );
}