import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  balanceLiability,
  headcountByMonth,
  leaveByTeam,
  monthlyTrend,
  rowsToCsv,
  sickBreaches,
  spendByCategory,
  spendByMonth,
} from "./reports";
import type { EmployeeRow, EntryRow, TeamRow } from "./data";
import type { ClaimRow } from "./expenses";

const teams: TeamRow[] = [
  { id: "t1", name: "Engineers", manager_id: null },
  { id: "t2", name: "Logistics", manager_id: null },
];
const emp = (
  id: string,
  team: string | null,
  start = "2024-01-01",
  end: string | null = null,
  active = true,
): EmployeeRow =>
  ({
    id,
    full_name: id.toUpperCase(),
    email: `${id}@x`,
    role: "employee",
    team_id: team,
    employment_start_date: start,
    active,
    auth_user_id: null,
    policy_id: null,
    job_title: null,
    phone: null,
    location: null,
    employment_type: "full_time",
    employment_end_date: end,
    custom_fields: {},
  }) as EmployeeRow;
const entry = (
  empId: string,
  date: string,
  code: string,
  status: EntryRow["status"] = "approved",
): EntryRow =>
  ({
    id: `${empId}-${date}`,
    employee_id: empId,
    date,
    leave_code: code,
    status,
    note: null,
    requested_by: null,
    approved_by: null,
    approved_at: null,
    decision_note: null,
  }) as EntryRow;
const employees = [emp("a", "t1"), emp("b", "t1"), emp("c", "t2")];
const entries = [
  entry("a", "2026-03-02", "L"),
  entry("a", "2026-03-03", "L1"),
  entry("a", "2026-05-10", "S"),
  entry("b", "2026-03-04", "W"),
  entry("b", "2026-06-01", "L", "pending"),
  entry("c", "2026-07-07", "S"),
  entry("c", "2026-07-08", "S"),
  entry("c", "2026-07-09", "B"),
];

describe("reports", () => {
  it("leaveByTeam splits by category and sorts by total", () => {
    const r = leaveByTeam(entries, employees, teams);
    assert.equal(r[0].team, "Engineers");
    assert.equal(r[0].vacation, 1.5);
    assert.equal(r[0].sick, 1);
    assert.equal(r[0].wfh, 1);
    assert.equal(r[0].total, 3.5);
    assert.equal(r[1].team, "Logistics");
    assert.equal(r[1].sick, 2);
  });
  it("monthlyTrend counts approved days per month (holidays and pending ignored)", () => {
    const t = monthlyTrend(entries, 2026);
    assert.equal(t[2].vacation, 1.5);
    assert.equal(t[6].sick, 2);
    assert.equal(t[5].vacation, 0);
  });
  it("balanceLiability uses allowances and default", () => {
    const r = balanceLiability(
      employees,
      entries,
      [
        {
          id: "x",
          employee_id: "a",
          year: 2026,
          vacation_allowance_days: 20,
          carried_over_days: 2,
          adjustment_days: 0,
        },
      ],
      teams,
    );
    const a = r.find((x) => x.id === "a")!;
    assert.equal(a.allowance, 22);
    assert.equal(a.used, 1.5);
    assert.equal(a.remaining, 20.5);
    const b = r.find((x) => x.id === "b")!;
    assert.equal(b.allowance, 24);
    assert.equal(b.pending, 1);
  });
  it("sickBreaches respects the threshold", () => {
    assert.deepEqual(
      sickBreaches(employees, entries, 2).map((r) => r.name),
      ["C"],
    );
    assert.equal(sickBreaches(employees, entries, 0).length, 0);
  });
  it("petty cash spend by category / month", () => {
    const claims = [
      { status: "paid", paid_at: "2026-02-10T00:00:00Z", category: "fuel", amount: 100 },
      { status: "paid", paid_at: "2026-02-20T00:00:00Z", category: "fuel", amount: 50 },
      { status: "paid", paid_at: "2026-03-01T00:00:00Z", category: "meals", amount: 20 },
      { status: "approved", paid_at: null, category: "meals", amount: 999 },
    ] as ClaimRow[];
    assert.deepEqual(spendByCategory(claims, 2026), [
      { category: "fuel", count: 2, amount: 150 },
      { category: "meals", count: 1, amount: 20 },
    ]);
    assert.equal(spendByMonth(claims, 2026)[1].amount, 150);
    assert.equal(spendByMonth(claims, 2026)[2].count, 1);
  });
  it("headcountByMonth handles joiners and leavers", () => {
    const people = [
      emp("a", null, "2025-06-01"),
      emp("b", null, "2026-03-15"),
      emp("c", null, "2024-01-01", "2026-05-20", false),
    ];
    const h = headcountByMonth(people, 2026);
    assert.equal(h[0].headcount, 2);
    assert.equal(h[2].joiners, 1);
    assert.equal(h[2].headcount, 3);
    assert.equal(h[4].leavers, 1);
    assert.equal(h[5].headcount, 2);
  });
  it("rowsToCsv escapes and relabels headers", () => {
    const csv = rowsToCsv([{ name: "A, B", n: 1.234 }], { n: "Count" });
    assert.equal(csv, 'name,Count\n"A, B",1.23');
    assert.equal(rowsToCsv([]), "");
  });
});
