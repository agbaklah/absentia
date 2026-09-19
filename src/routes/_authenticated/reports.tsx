import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Download, Stethoscope, TrendingUp, Users, Wallet } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { useAuth } from "@/lib/auth-context";
import {
  useAllProfiles,
  useAllowances,
  useClaims,
  useEmployees,
  useEntries,
  useSettings,
  useTeams,
} from "@/lib/data";
import { CATEGORY_LABEL, formatMoney } from "@/lib/expenses";
import { MONTHS_SHORT } from "@/lib/leave";
import {
  REPORT_SERIES,
  balanceLiability,
  headcountByMonth,
  leaveByTeam,
  monthlyTrend,
  rowsToCsv,
  sickBreaches,
  spendByCategory,
  spendByMonth,
} from "@/lib/reports";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

function download(name: string, csv: string) {
  if (!csv) return;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const axis = { fontSize: 11, fill: "var(--muted-foreground)" } as const;
const grid = "color-mix(in oklch, var(--border) 70%, transparent)";

/** Management reports: leave usage, liability, sickness, petty cash, headcount. */
function ReportsPage() {
  const { loading, isManagement, isAdmin, isViewer, canReviewExpenses, profile } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [teamId, setTeamId] = useState("all");
  const teams = useTeams();
  const employees = useEmployees();
  const allProfiles = useAllProfiles({ enabled: isManagement });
  const entries = useEntries(year);
  const allowances = useAllowances(year);
  const settings = useSettings();
  const claims = useClaims({ enabled: canReviewExpenses });

  // Department heads / managers only see the departments they are responsible
  // for; admins, the CFO and reports-only viewers see the whole organisation.
  const scopeAll = isAdmin || isViewer;
  const myTeamIds = useMemo(
    () =>
      new Set(
        (teams.data ?? [])
          .filter((t) => t.manager_id === profile?.id || t.id === profile?.team_id)
          .map((t) => t.id),
      ),
    [teams.data, profile?.id, profile?.team_id],
  );
  const inScope = useCallback(
    (tid: string | null) => scopeAll || (tid != null && myTeamIds.has(tid)),
    [scopeAll, myTeamIds],
  );

  const emps = useMemo(
    () =>
      (employees.data ?? []).filter(
        (e) => inScope(e.team_id) && (teamId === "all" || e.team_id === teamId),
      ),
    [employees.data, teamId, inScope],
  );
  const empIds = useMemo(() => new Set(emps.map((e) => e.id)), [emps]);
  const ents = useMemo(
    () => (entries.data ?? []).filter((e) => empIds.has(e.employee_id)),
    [entries.data, empIds],
  );
  const teamList = useMemo(
    () => (teams.data ?? []).filter((t) => inScope(t.id)),
    [teams.data, inScope],
  );

  const byTeam = useMemo(() => leaveByTeam(ents, emps, teamList), [ents, emps, teamList]);
  const trend = useMemo(() => monthlyTrend(ents, year), [ents, year]);
  const liability = useMemo(
    () =>
      balanceLiability(
        emps,
        ents,
        allowances.data ?? [],
        teamList,
        settings.data?.default_allowance_days ?? 24,
      ),
    [emps, ents, allowances.data, teamList, settings.data],
  );
  const breaches = useMemo(
    () => sickBreaches(emps, ents, settings.data?.sick_threshold_days ?? 8),
    [emps, ents, settings.data],
  );
  const spendCat = useMemo(() => spendByCategory(claims.data ?? [], year), [claims.data, year]);
  const spendMonth = useMemo(() => spendByMonth(claims.data ?? [], year), [claims.data, year]);
  const headcount = useMemo(
    () =>
      headcountByMonth(
        (allProfiles.data ?? []).filter(
          (p) => inScope(p.team_id) && (teamId === "all" || p.team_id === teamId),
        ),
        year,
      ),
    [allProfiles.data, teamId, year, inScope],
  );
  const currency = settings.data?.currency ?? "GHS";
  const totalRemaining = liability.reduce((s, r) => s + Math.max(0, r.remaining), 0);
  const avgUsed = liability.length
    ? Math.round(liability.reduce((s, r) => s + r.pctUsed, 0) / liability.length)
    : 0;
  const paidYtd = spendCat.reduce((s, r) => s + r.amount, 0);
  const joiners = headcount.reduce((s, m) => s + m.joiners, 0);
  const leavers = headcount.reduce((s, m) => s + m.leavers, 0);

  if (loading) return null;
  if (!isManagement) return <Navigate to="/dashboard" />;

  const trendRows = trend.map(({ month, ...r }) => ({ month: MONTHS_SHORT[month - 1], ...r }));
  const spendRows = spendMonth.map((r) => ({
    month: MONTHS_SHORT[r.month - 1],
    amount: Math.round(r.amount * 100) / 100,
  }));
  const headRows = headcount.map(({ month, ...r }) => ({ month: MONTHS_SHORT[month - 1], ...r }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Leave usage, balance liability, sickness, petty cash and headcount."
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
        <Select value={teamId} onValueChange={setTeamId}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{scopeAll ? "All teams" : "My departments"}</SelectItem>
            {teamList.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Headcount"
          value={String(emps.length)}
          hint={`${joiners} joined · ${leavers} left in ${year}`}
          icon={Users}
        />
        <KpiCard
          label="Vacation used"
          value={`${avgUsed}%`}
          hint={`${totalRemaining.toFixed(1)} days still owed`}
          icon={TrendingUp}
          tone="info"
        />
        <KpiCard
          label="Sick threshold breaches"
          value={String(breaches.length)}
          hint={`≥ ${settings.data?.sick_threshold_days ?? 8} sick days`}
          icon={Stethoscope}
          tone={breaches.length ? "danger" : "neutral"}
        />
        {canReviewExpenses && (
          <KpiCard
            label={`Petty cash paid ${year}`}
            value={formatMoney(paidYtd, currency)}
            hint={`${spendCat.reduce((s, r) => s + r.count, 0)} claims`}
            icon={Wallet}
            tone="accent"
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Leave days by team"
          onExport={() => download(`leave-by-team-${year}.csv`, rowsToCsv(byTeam))}
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={byTeam}
              margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
              barCategoryGap="30%"
            >
              <CartesianGrid vertical={false} stroke={grid} />
              <XAxis dataKey="team" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "color-mix(in oklch, var(--muted) 60%, transparent)" }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              {REPORT_SERIES.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="a"
                  fill={s.colour}
                  stroke="var(--card)"
                  strokeWidth={2}
                  radius={i === REPORT_SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <Table
            rows={byTeam.map((r) => ({
              Team: r.team,
              ...Object.fromEntries(REPORT_SERIES.map((s) => [s.label, r[s.key]])),
              Total: r.total,
            }))}
          />
        </Section>

        <Section
          title="Monthly absence trend"
          onExport={() => download(`absence-trend-${year}.csv`, rowsToCsv(trendRows))}
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trendRows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={grid} />
              <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} />
              <Tooltip />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              {REPORT_SERIES.slice(0, 4).map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.colour}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <Table
            rows={trendRows.map((r) => ({
              Month: r.month,
              Vacation: r.vacation,
              WFH: r.wfh,
              TOIL: r.toil,
              Sick: r.sick,
              Parental: r.parental,
              Compassionate: r.compassionate,
            }))}
            compact
          />
        </Section>
      </div>

      <Section
        title="Vacation balance liability"
        subtitle="Days each employee is still owed this year — what the company carries if they all took it."
        onExport={() =>
          download(
            `balance-liability-${year}.csv`,
            rowsToCsv(liability.map(({ id: _id, ...r }) => r)),
          )
        }
      >
        <Table
          rows={liability.map((r) => ({
            Employee: r.name,
            Team: r.team,
            Allowance: r.allowance,
            Used: r.used,
            Pending: r.pending,
            Remaining: r.remaining,
            "Used %": `${r.pctUsed}%`,
          }))}
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Sickness threshold"
          subtitle={`Employees with ≥ ${settings.data?.sick_threshold_days ?? 8} approved sick days.`}
          onExport={() =>
            download(`sick-breaches-${year}.csv`, rowsToCsv(breaches.map(({ id: _id, ...r }) => r)))
          }
        >
          {breaches.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Nobody over the threshold.
            </div>
          ) : (
            <Table rows={breaches.map((r) => ({ Employee: r.name, "Sick days": r.sickDays }))} />
          )}
        </Section>

        <Section
          title="Headcount"
          onExport={() => download(`headcount-${year}.csv`, rowsToCsv(headRows))}
        >
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={headRows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={grid} />
              <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip />
              <Line
                type="stepAfter"
                dataKey="headcount"
                name="Headcount"
                stroke="#15803d"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
          <Table
            rows={headRows.map((r) => ({
              Month: r.month,
              Headcount: r.headcount,
              Joined: r.joiners,
              Left: r.leavers,
            }))}
            compact
          />
        </Section>
      </div>

      {canReviewExpenses && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="Petty cash by category"
            onExport={() =>
              download(
                `petty-cash-categories-${year}.csv`,
                rowsToCsv(
                  spendCat.map((r) => ({
                    category: CATEGORY_LABEL[r.category] ?? r.category,
                    claims: r.count,
                    amount: r.amount,
                  })),
                ),
              )
            }
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={spendCat.map((r) => ({
                  ...r,
                  label: CATEGORY_LABEL[r.category] ?? r.category,
                }))}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 24, bottom: 0 }}
                barCategoryGap="30%"
              >
                <CartesianGrid horizontal={false} stroke={grid} />
                <XAxis type="number" tick={axis} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={axis}
                  axisLine={false}
                  tickLine={false}
                  width={110}
                />
                <Tooltip
                  formatter={(v) => formatMoney(Number(v), currency)}
                  cursor={{ fill: "color-mix(in oklch, var(--muted) 60%, transparent)" }}
                />
                <Bar dataKey="amount" name="Paid" fill="#d97706" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <Table
              rows={spendCat.map((r) => ({
                Category: CATEGORY_LABEL[r.category] ?? r.category,
                Claims: r.count,
                Paid: formatMoney(r.amount, currency),
              }))}
              compact
            />
          </Section>
          <Section
            title="Petty cash by month"
            onExport={() => download(`petty-cash-monthly-${year}.csv`, rowsToCsv(spendRows))}
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={spendRows}
                margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
                barCategoryGap="30%"
              >
                <CartesianGrid vertical={false} stroke={grid} />
                <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
                <YAxis tick={axis} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v) => formatMoney(Number(v), currency)}
                  cursor={{ fill: "color-mix(in oklch, var(--muted) 60%, transparent)" }}
                />
                <Bar dataKey="amount" name="Paid" fill="#d97706" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <Table
              rows={spendRows.map((r) => ({
                Month: r.month,
                Paid: formatMoney(r.amount, currency),
              }))}
              compact
            />
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  onExport,
  children,
}: {
  title: string;
  subtitle?: string;
  onExport: () => void;
  children: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{title}</div>
          {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onExport}>
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </div>
      {children}
    </Card>
  );
}

/** Table view under each chart (the accessible / print fallback). */
function Table({ rows, compact }: { rows: Record<string, unknown>[]; compact?: boolean }) {
  if (rows.length === 0)
    return <div className="py-4 text-center text-xs text-muted-foreground">No data.</div>;
  const keys = Object.keys(rows[0]);
  return (
    <details className={compact ? "mt-1" : "mt-2"} open={!compact}>
      <summary className="cursor-pointer text-xs text-muted-foreground">Table view</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 text-left">
            <tr>
              {keys.map((k) => (
                <th key={k} className="px-2 py-1.5 font-medium">
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {keys.map((k) => (
                  <td
                    key={k}
                    className={`px-2 py-1 ${typeof r[k] === "number" ? "text-right tabular" : ""}`}
                  >
                    {typeof r[k] === "number"
                      ? Math.round((r[k] as number) * 10) / 10
                      : String(r[k] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
