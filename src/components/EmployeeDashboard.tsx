import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEntries, useAllowances, type EntryRow } from "@/lib/data";
import { LEAVE_MAP } from "@/lib/leave";
import { groupEntries } from "@/lib/requests-util";
import { useAuth } from "@/lib/auth-context";
import { RequestLeaveDialog } from "@/components/RequestLeaveDialog";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { Plane, Hourglass, Clock3, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_COLOUR: Record<string, string> = {
  vacation: "#166534",
  sick: "#dc2626",
  parental: "#8b5cf6",
  compassionate: "#0ea5e9",
  toil: "#d97706",
  wfh: "#64748b",
};
const CATEGORY_LABEL: Record<string, string> = {
  vacation: "Vacation",
  sick: "Sick",
  parental: "Parental",
  compassionate: "Compassionate",
  toil: "TOIL",
  wfh: "WFH",
};

const statusVariant: Record<EntryRow["status"], "default" | "secondary" | "destructive"> = {
  approved: "default",
  pending: "secondary",
  rejected: "destructive",
};

export function EmployeeDashboard() {
  const { profile } = useAuth();
  const year = new Date().getFullYear();
  const entries = useEntries(year);
  const allowances = useAllowances(year);

  const mine = useMemo(
    () => (entries.data ?? []).filter((e) => e.employee_id === profile?.id),
    [entries.data, profile?.id],
  );

  const stats = useMemo(() => {
    const approved = mine.filter((e) => e.status === "approved");
    const sum = (cat: string) =>
      approved.reduce((s, e) => {
        const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
        return s + (t && t.category === cat ? t.days : 0);
      }, 0);
    const a = (allowances.data ?? []).find((x) => x.employee_id === profile?.id);
    const allowance = a
      ? Number(a.vacation_allowance_days) + Number(a.carried_over_days) + Number(a.adjustment_days)
      : 24;
    const vacation = sum("vacation");
    return {
      allowance,
      vacation,
      remaining: allowance - vacation,
      sick: sum("sick"),
      pending: mine.filter((e) => e.status === "pending").length,
    };
  }, [mine, allowances.data, profile?.id]);

  const groups = useMemo(() => groupEntries(mine), [mine]);

  // Approved leave grouped by category, for the "by type" bar chart.
  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of mine) {
      if (e.status !== "approved") continue;
      const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
      if (!t || t.category === "holiday") continue;
      map.set(t.category, (map.get(t.category) ?? 0) + t.days);
    }
    return Array.from(map.entries()).map(([category, days]) => ({
      name: CATEGORY_LABEL[category] ?? category,
      days,
      fill: CATEGORY_COLOUR[category] ?? "#888",
    }));
  }, [mine]);

  const allowanceDonut = useMemo(
    () => [
      { name: "Taken", value: Math.max(0, stats.vacation), fill: "#166534" },
      { name: "Remaining", value: Math.max(0, stats.remaining), fill: "#d1d5db" },
    ],
    [stats.vacation, stats.remaining],
  );

  const pctUsed = stats.allowance > 0 ? Math.min(100, (stats.vacation / stats.allowance) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Welcome{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</>}
        description={`Your leave balance and request history for ${year}.`}
      >
        <RequestLeaveDialog />
      </PageHeader>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <KpiCard
          label="Annual allowance"
          value={`${stats.allowance.toFixed(1)}d`}
          icon={CalendarDays}
          tone="info"
        />
        <KpiCard
          label="Vacation taken"
          value={stats.vacation.toFixed(1)}
          icon={Plane}
          tone="primary"
        />
        <KpiCard
          label="Vacation remaining"
          value={stats.remaining.toFixed(1)}
          icon={Hourglass}
          tone="accent"
        />
        <KpiCard
          label="Pending requests"
          value={String(stats.pending)}
          icon={Clock3}
          tone="neutral"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Vacation allowance</div>
            <Badge variant="secondary" className="tabular">
              {Math.round(pctUsed)}% used
            </Badge>
          </div>
          <div className="relative h-56">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={allowanceDonut}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={86}
                  startAngle={90}
                  endAngle={-270}
                >
                  {allowanceDonut.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `${v} days`} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="tabular font-display text-3xl font-semibold text-emerald-700">
                {stats.remaining.toFixed(1)}
              </div>
              <div className="text-xs text-muted-foreground">
                days left of {stats.allowance.toFixed(0)}
              </div>
            </div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 transition-all"
              style={{ width: `${pctUsed}%` }}
            />
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Leave taken by type</div>
          <div className="h-60">
            {byType.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No approved leave yet.
              </div>
            ) : (
              <ResponsiveContainer>
                <BarChart data={byType} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} allowDecimals />
                  <Tooltip
                    formatter={(v: number) => `${v} days`}
                    cursor={{ fill: "transparent" }}
                  />
                  <Bar dataKey="days" radius={[4, 4, 0, 0]}>
                    {byType.map((d, i) => (
                      <Cell key={i} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium">My leave &amp; requests</div>
          {groups.length > 0 && (
            <Badge variant="secondary">
              {groups.length} request{groups.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        {groups.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No leave yet — use “Request leave” to submit one.
          </div>
        )}
        <div className="divide-y">
          {groups.map((g, i) => {
            const t = LEAVE_MAP[g.code as keyof typeof LEAVE_MAP];
            return (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn("inline-flex h-8 w-1.5 rounded-full")}
                    style={{ background: t?.colour }}
                  />
                  <div>
                    <div className="font-medium">{t?.label ?? g.code}</div>
                    <div className="text-xs text-muted-foreground">
                      {g.start}
                      {g.end !== g.start ? ` → ${g.end}` : ""} · {g.days} day
                      {g.days !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
                <Badge variant={statusVariant[g.status]}>{g.status}</Badge>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
