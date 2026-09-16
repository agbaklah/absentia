import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeAudit } from "./audit";

const names = new Map([["e1", "Kofi Boateng"]]);
const base = { id: "1", actor_id: null, entity_id: null, before: null, ts: "2026-09-16T00:00:00Z" };

describe("describeAudit", () => {
  it("summarises petty cash rows", () => {
    assert.equal(
      describeAudit(
        {
          ...base,
          entity: "expense_claim",
          action: "paid",
          after: { claim_no: 1005, title: "Fuel", currency: "GHS", amount: 350.5 },
        },
        names,
      ),
      "#1005 Fuel · GHS 350.5",
    );
  });
  it("summarises leave decisions with a range and note", () => {
    const t = describeAudit(
      {
        ...base,
        entity: "leave_request",
        action: "approved",
        entity_id: "e1",
        after: { leave_code: "L", from: "2026-10-05", to: "2026-10-07", days: 3, note: "ok" },
      },
      names,
    );
    assert.equal(t, "Kofi Boateng · L · 2026-10-05 → 2026-10-07 · 3d · “ok”");
  });
  it("falls back to json for unknown entities", () => {
    assert.match(
      describeAudit({ ...base, entity: "x", action: "y", after: { a: 1 } }, names),
      /"a":1/,
    );
  });
});
