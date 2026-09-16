/**
 * Pure aggregation for the Reports page. Every function takes plain rows and
 * returns plain data so it can be unit-tested and exported as CSV as-is.
 */
import type { AllowanceRow, EmployeeRow, EntryRow, TeamRow } from "@/lib/data";
import type { ClaimRow } from "@/lib/expenses";
import { LEAVE_MAP } from "@/lib/leave";

/** Validated categorical palette (dataviz six-checks, light mode) in fixed order. */
export const REPORT_SERIES = [
  { key: "vacation", label: "Vacation", colour: "#15803d" },
  { key: "wfh", label: "WFH", colour: "#1d4ed8" },
  { key: "toil", label: "TOIL", colour: "#d97706" },
  { key: "sick", label: "Sick", colour: "#b91c1c" },
  { key: "parental", label: "Parental", colour: "#7c3aed" },
  { key: "compassionate", label: "Compassionate", colour: "#0d9488" },
] as const;
export type SeriesKey = (typeof REPORT_SERIES)[number]["key"];

const categoryOf = (code: string): SeriesKey | null => {
  const t = LEAVE_MAP[code as keyof typeof LEAVE_MAP];
  if (!t || t.category === "holiday") return null;
  return t.category as SeriesKey;
};
const daysOf = (code: string) => LEAVE_MAP[code as keyof typeof LEAVE_MAP]?.days ?? 1;

const emptySeries = (): Record<SeriesKey, number> => ({
  vacation: 0,
  wfh: 0,
  toil: 0,
  sick: 0,
  parental: 0,
  compassionate: 0,
});

/** Approved leave days per team, split by category. */
export function leaveByTeam(
  entries: EntryRow[],
  employees: EmployeeRow[],
  teams: TeamRow[],
): ({ team: string; total: number } & Record<SeriesKey, number>)[] {
  const teamOf = new Map(employees.map((e) => [e.id, e.team_id]));
  const acc = new Map<string, Record<SeriesKey, number>>();
  for (const e of entries) {
    if (e.status !== "approved") continue;
    const cat = categoryOf(e.leave_code);
    if (!cat) continue;
    const tid = teamOf.get(e.employee_id) ?? "none";
    const row = acc.get(tid) ?? emptySeries();
    row[cat] += daysOf(e.leave_code);
    acc.set(tid, row);
  }
  return [...acc]
    .map(([tid, row]) => ({
      team: teams.find((t) => t.id === tid)?.name ?? "Unassigned",
      total: Object.values(row).reduce((s, v) => s + v, 0),
      ...row,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Approved days per month (1–12) by category. */
export function monthlyTrend(entries: EntryRow[], year: number) {
  const rows = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...emptySeries() }));
  for (const e of entries) {
    if (e.status !== "approved" || !e.date.startsWith(String(year))) continue;
    const cat = categoryOf(e.leave_code);
    if (!cat) continue;
    rows[Number(e.date.slice(5, 7)) - 1][cat] += daysOf(e.leave_code);
  }
  return rows;
}

/** Per-employee vacation balance: allowance, used, remaining (liability). */
export function balanceLiability(
  employees: EmployeeRow[],
  entries: EntryRow[],
  allowances: AllowanceRow[],
  teams: TeamRow[],
  defaultAllowance = 24,
) {
  const alw = new Map(allowances.map((a) => [a.employee_id, a]));
  return employees
    .map((emp) => {
      const a = alw.get(emp.id);
      const allowance = a
        ? Number(a.vacation_allowance_days) +
          Number(a.carried_over_days) +
          Number(a.adjustment_days)
        : defaultAllowance;
      const used = entries
        .filter(
          (e) =>
            e.employee_id === emp.id &&
            e.status === "approved" &&
            categoryOf(e.leave_code) === "vacation",
        )
        .reduce((s, e) => s + daysOf(e.leave_code), 0);
      const pending = entries
        .filter(
          (e) =>
            e.employee_id === emp.id &&
            e.status === "pending" &&
            categoryOf(e.leave_code) === "vacation",
        )
        .reduce((s, e) => s + daysOf(e.leave_code), 0);
      return {
        id: emp.id,
        name: emp.full_name,
        team: teams.find((t) => t.id === emp.team_id)?.name ?? "—",
        allowance,
        used,
        pending,
        remaining: allowance - used,
        pctUsed: allowance > 0 ? Math.round((used / allowance) * 100) : 0,
      };
    })
    .sort((a, b) => b.remaining - a.remaining);
}

/** Employees whose approved sick days meet or exceed the threshold. */
export function sickBreaches(employees: EmployeeRow[], entries: EntryRow[], threshold: number) {
  return employees
    .map((emp) => ({
      id: emp.id,
      name: emp.full_name,
      sickDays: entries
        .filter(
          (e) =>
            e.employee_id === emp.id &&
            e.status === "approved" &&
            categoryOf(e.leave_code) === "sick",
        )
        .reduce((s, e) => s + daysOf(e.leave_code), 0),
    }))
    .filter((r) => r.sickDays >= threshold && threshold > 0)
    .sort((a, b) => b.sickDays - a.sickDays);
}

/** Petty cash paid, by category, for claims paid in a year. */
export function spendByCategory(claims: ClaimRow[], year: number) {
  const acc = new Map<string, { count: number; amount: number }>();
  for (const c of claims) {
    if (c.status !== "paid" || !c.paid_at?.startsWith(String(year))) continue;
    const cur = acc.get(c.category) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += c.amount;
    acc.set(c.category, cur);
  }
  return [...acc].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.amount - a.amount);
}

/** Petty cash paid per month (1–12). */
export function spendByMonth(claims: ClaimRow[], year: number) {
  const rows = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, amount: 0, count: 0 }));
  for (const c of claims) {
    if (c.status !== "paid" || !c.paid_at?.startsWith(String(year))) continue;
    const m = Number(c.paid_at.slice(5, 7)) - 1;
    rows[m].amount += c.amount;
    rows[m].count += 1;
  }
  return rows;
}

/**
 * Headcount at the end of each month + joiners/leavers in it, from start and
 * end dates. `people` should include archived employees.
 */
export function headcountByMonth(
  people: { employment_start_date: string; employment_end_date: string | null; active: boolean }[],
  year: number,
) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const monthEnd = `${year}-${String(m).padStart(2, "0")}-31`;
    const monthStart = `${year}-${String(m).padStart(2, "0")}-01`;
    const endOf = (p: (typeof people)[number]) =>
      p.active ? null : (p.employment_end_date ?? null);
    const headcount = people.filter(
      (p) => p.employment_start_date <= monthEnd && (endOf(p) === null || endOf(p)! > monthEnd),
    ).length;
    const joiners = people.filter(
      (p) => p.employment_start_date >= monthStart && p.employment_start_date <= monthEnd,
    ).length;
    const leavers = people.filter(
      (p) => endOf(p) !== null && endOf(p)! >= monthStart && endOf(p)! <= monthEnd,
    ).length;
    return { month: m, headcount, joiners, leavers };
  });
}

/** Generic CSV: header from keys of the first row. */
export function rowsToCsv(
  rows: Record<string, unknown>[],
  headers?: Record<string, string>,
): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s =
      v == null ? "" : typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    keys.map((k) => esc(headers?.[k] ?? k)).join(","),
    ...rows.map((r) => keys.map((k) => esc(r[k])).join(",")),
  ].join("\n");
}
