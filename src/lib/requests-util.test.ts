import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { EntryRow } from "@/lib/data";
import { groupEntries, nextDay, pendingRequestCount, toRequests } from "@/lib/requests-util";

/** Build a minimal EntryRow with sensible defaults. */
function entry(overrides: Partial<EntryRow>): EntryRow {
  return {
    id: "e1",
    employee_id: "emp-1",
    date: "2026-01-05",
    leave_code: "L",
    status: "approved",
    note: null,
    requested_by: "emp-1",
    approved_by: null,
    approved_at: null,
    decision_note: null,
    attachment_url: null,
    ...overrides,
  };
}

describe("nextDay", () => {
  it("increments within a month", () => {
    assert.equal(nextDay("2026-01-05"), "2026-01-06");
  });

  it("rolls over a month boundary", () => {
    assert.equal(nextDay("2026-01-31"), "2026-02-01");
  });

  it("rolls over a year boundary", () => {
    assert.equal(nextDay("2026-12-31"), "2027-01-01");
  });
});

describe("groupEntries", () => {
  it("merges contiguous same-code, same-status days into one group", () => {
    const groups = groupEntries([
      entry({ date: "2026-01-01" }),
      entry({ date: "2026-01-02" }),
      entry({ date: "2026-01-03" }),
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0], {
      start: "2026-01-01",
      end: "2026-01-03",
      days: 3,
      code: "L",
      status: "approved",
      note: null,
    });
  });

  it("splits when dates are not contiguous (e.g. a weekend gap)", () => {
    // 2026-01-02 is a Friday, 2026-01-05 the following Monday.
    const groups = groupEntries([entry({ date: "2026-01-02" }), entry({ date: "2026-01-05" })]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].start, "2026-01-05");
    assert.equal(groups[1].start, "2026-01-02");
  });

  it("splits when the status changes mid-run", () => {
    const groups = groupEntries([
      entry({ date: "2026-01-01" }),
      entry({ date: "2026-01-02", status: "pending" }),
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].status, "pending");
    assert.equal(groups[1].status, "approved");
  });

  it("splits when the leave code changes on consecutive days", () => {
    const groups = groupEntries([
      entry({ date: "2026-01-01" }),
      entry({ date: "2026-01-02", leave_code: "S" }),
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].code, "S");
    assert.equal(groups[1].code, "L");
  });

  it("sums half-day codes correctly", () => {
    const groups = groupEntries([
      entry({ date: "2026-01-01", leave_code: "L1" }),
      entry({ date: "2026-01-02", leave_code: "L1" }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].days, 1); // 0.5 + 0.5
  });

  it("returns groups most-recent-first", () => {
    const groups = groupEntries([
      entry({ date: "2026-01-01" }),
      entry({ date: "2026-01-05", leave_code: "S", status: "pending" }),
      entry({ date: "2026-01-06", leave_code: "S", status: "pending" }),
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].start, "2026-01-05");
    assert.equal(groups[1].start, "2026-01-01");
  });

  it("keeps the first non-null decision note on a merged run", () => {
    const groups = groupEntries([
      entry({ date: "2026-01-01", decision_note: "Needs doctor's note" }),
      entry({ date: "2026-01-02", decision_note: null }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].note, "Needs doctor's note");
  });

  it("handles unsorted input", () => {
    const groups = groupEntries([
      entry({ date: "2026-01-03" }),
      entry({ date: "2026-01-01" }),
      entry({ date: "2026-01-02" }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].start, "2026-01-01");
    assert.equal(groups[0].end, "2026-01-03");
    assert.equal(groups[0].days, 3);
  });

  it("returns an empty array for no entries", () => {
    assert.deepEqual(groupEntries([]), []);
  });

  it("picks up a decision note that only appears on a later entry of the run", () => {
    const groups = groupEntries([
      entry({ date: "2026-01-01", decision_note: null }),
      entry({ date: "2026-01-02", decision_note: "Approved with conditions" }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].note, "Approved with conditions");
  });
});

describe("toRequests", () => {
  it("groups contiguous same-code days per employee into one request", () => {
    const reqs = toRequests([
      entry({ employee_id: "emp-1", date: "2026-01-01" }),
      entry({ employee_id: "emp-1", date: "2026-01-02" }),
      entry({ employee_id: "emp-1", date: "2026-01-03" }),
    ]);
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].empId, "emp-1");
    assert.equal(reqs[0].items.length, 3);
  });

  it("separates different employees", () => {
    const reqs = toRequests([
      entry({ id: "a", employee_id: "emp-1", date: "2026-01-01" }),
      entry({ id: "b", employee_id: "emp-2", date: "2026-01-01" }),
    ]);
    assert.equal(reqs.length, 2);
    const empIds = reqs.map((r) => r.empId).sort();
    assert.deepEqual(empIds, ["emp-1", "emp-2"]);
  });

  it("splits non-contiguous days for the same employee", () => {
    const reqs = toRequests([
      entry({ id: "a", employee_id: "emp-1", date: "2026-01-02" }),
      entry({ id: "b", employee_id: "emp-1", date: "2026-01-05" }), // weekend gap
    ]);
    assert.equal(reqs.length, 2);
    assert.deepEqual(
      reqs.map((r) => r.items.length),
      [1, 1],
    );
  });

  it("splits when the leave code changes", () => {
    const reqs = toRequests([
      entry({ id: "a", employee_id: "emp-1", date: "2026-01-01" }),
      entry({ id: "b", employee_id: "emp-1", date: "2026-01-02", leave_code: "S" }),
    ]);
    assert.equal(reqs.length, 2);
  });

  it("returns an empty array for no entries", () => {
    assert.deepEqual(toRequests([]), []);
  });

  it("keeps per-request items in date order", () => {
    const reqs = toRequests([
      entry({ id: "a", employee_id: "emp-1", date: "2026-01-03" }),
      entry({ id: "b", employee_id: "emp-1", date: "2026-01-01" }),
      entry({ id: "c", employee_id: "emp-1", date: "2026-01-02" }),
    ]);
    assert.equal(reqs.length, 1);
    assert.deepEqual(
      reqs[0].items.map((i) => i.date),
      ["2026-01-01", "2026-01-02", "2026-01-03"],
    );
  });
});

describe("pendingRequestCount", () => {
  it("counts contiguous pending runs org-wide", () => {
    const count = pendingRequestCount([
      entry({ id: "a", date: "2026-01-01", status: "pending" }),
      entry({ id: "b", date: "2026-01-02", status: "pending" }),
      entry({ id: "c", date: "2026-01-05", status: "pending" }),
    ]);
    assert.equal(count, 2); // one 2-day run + one single day
  });

  it("ignores approved and rejected entries", () => {
    const count = pendingRequestCount([
      entry({ id: "a", date: "2026-01-01", status: "approved" }),
      entry({ id: "b", date: "2026-01-02", status: "rejected" }),
    ]);
    assert.equal(count, 0);
  });

  it("scopes to a single employee when given an id", () => {
    const count = pendingRequestCount(
      [
        entry({ id: "a", employee_id: "emp-1", date: "2026-01-01", status: "pending" }),
        entry({ id: "b", employee_id: "emp-2", date: "2026-01-01", status: "pending" }),
      ],
      "emp-1",
    );
    assert.equal(count, 1);
  });

  it("returns 0 for no entries", () => {
    assert.equal(pendingRequestCount([]), 0);
  });

  it("returns 0 for an employee with no pending leave", () => {
    const count = pendingRequestCount(
      [entry({ id: "a", employee_id: "emp-2", date: "2026-01-01", status: "pending" })],
      "emp-1",
    );
    assert.equal(count, 0);
  });
});
