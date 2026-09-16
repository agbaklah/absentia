import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildOrgTree,
  checklistProgress,
  daysUntil,
  maskNumber,
  tenure,
  yearsSince,
} from "./people";

describe("people helpers", () => {
  it("masks numbers keeping the last 4", () => {
    assert.equal(maskNumber("0241234567"), "•••• 4567");
    assert.equal(maskNumber("GHA-123456789-0"), "•••• 89-0");
    assert.equal(maskNumber("12"), "•2");
    assert.equal(maskNumber(null), "—");
  });
  it("computes years and tenure", () => {
    const now = new Date(2026, 8, 16);
    assert.equal(yearsSince("1995-05-05", now), 31);
    assert.equal(yearsSince("1995-12-25", now), 30);
    assert.equal(tenure("2024-01-01", now), "2y 8m");
    assert.equal(tenure("2026-07-01", now), "2 mo");
    assert.equal(tenure("2024-09-01", now), "2 yrs");
  });
  it("progress and due-day maths", () => {
    assert.deepEqual(checklistProgress([{ done_at: "x" }, { done_at: null }]), {
      done: 1,
      total: 2,
      pct: 50,
    });
    assert.equal(daysUntil("2026-09-20", "2026-09-16"), 4);
    assert.equal(daysUntil("2026-09-10", "2026-09-16"), -6);
    assert.equal(daysUntil(null, "2026-09-16"), null);
  });
  it("builds an org tree with managers on top and an unassigned bucket", () => {
    const teams = [
      { id: "t1", name: "Engineers", manager_id: "ama" },
      { id: "t2", name: "Logistics", manager_id: null },
    ];
    const people = [
      { id: "ama", full_name: "Ama", job_title: "Lead", team_id: "t1", role: "manager" },
      { id: "kofi", full_name: "Kofi", job_title: null, team_id: "t1", role: "employee" },
      { id: "esi", full_name: "Esi", job_title: null, team_id: "t2", role: "admin" },
      { id: "kwame", full_name: "Kwame", job_title: "CFO", team_id: null, role: "cfo" },
    ];
    const tree = buildOrgTree(people, teams);
    assert.equal(tree.length, 3);
    assert.equal(tree[0].name, "Ama");
    assert.deepEqual(
      tree[0].children.map((c) => c.name),
      ["Kofi"],
    );
    assert.equal(tree[1].id, "team:t2");
    assert.equal(tree[2].id, "team:unassigned");
    assert.deepEqual(
      tree[2].children.map((c) => c.name),
      ["Kwame"],
    );
  });
});
