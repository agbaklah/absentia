import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actionsFor,
  canSubmit,
  claimsToCsv,
  formatMoney,
  paidInMonth,
  parseAmount,
  receiptPath,
  sanitizeFileName,
  totalsByStatus,
  validateReceiptFile,
  type ClaimRow,
} from "./expenses";

const base: ClaimRow = {
  id: "c1",
  claim_no: 1001,
  claimant_id: "emp",
  title: "Fuel",
  description: null,
  category: "fuel",
  amount: 350,
  currency: "GHS",
  expense_date: "2026-09-10",
  status: "draft",
  submitted_at: null,
  reviewed_by: null,
  reviewed_at: null,
  decision_note: null,
  paid_by: null,
  paid_at: null,
  payment_method: null,
  payment_ref: null,
  created_at: "2026-09-10T08:00:00Z",
  updated_at: "2026-09-10T08:00:00Z",
};

describe("formatMoney / parseAmount", () => {
  it("formats with thousands and two decimals", () => {
    assert.equal(formatMoney(1234.5), "GHS 1,234.50");
    assert.equal(formatMoney(0), "GHS 0.00");
    assert.equal(formatMoney(NaN, "USD"), "USD 0.00");
  });
  it("parses lenient input, rejects junk and non-positive", () => {
    assert.equal(parseAmount("1,250.5"), 1250.5);
    assert.equal(parseAmount(" 40 "), 40);
    assert.equal(parseAmount("0"), null);
    assert.equal(parseAmount("12.345"), null);
    assert.equal(parseAmount("abc"), null);
    assert.equal(parseAmount("-5"), null);
  });
});

describe("file naming", () => {
  it("sanitizes names and keeps extension", () => {
    assert.equal(sanitizeFileName("My Receipt (1).JPG"), "My-Receipt-1.jpg");
    assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
    assert.equal(sanitizeFileName("ééé.png"), "eee.png");
    assert.equal(sanitizeFileName(""), "receipt");
    assert.equal(sanitizeFileName(".hidden"), "hidden");
  });
  it("receipt path follows <claimant>/<claim>/<nonce>-<file>", () => {
    assert.equal(receiptPath("emp", "c1", "a b.pdf", "123"), "emp/c1/123-a-b.pdf");
  });
  it("validates type and size", () => {
    assert.equal(validateReceiptFile({ type: "image/jpeg", size: 100 }), null);
    assert.match(validateReceiptFile({ type: "text/plain", size: 100 }) ?? "", /Only/);
    assert.match(validateReceiptFile({ type: "image/png", size: 0 }) ?? "", /empty/);
    assert.match(
      validateReceiptFile({ type: "application/pdf", size: 11 * 1024 * 1024 }) ?? "",
      /10 MB/,
    );
  });
});

describe("canSubmit", () => {
  it("requires title, amount, receipt, and respects limit", () => {
    assert.deepEqual(canSubmit({ title: "", amount: 1 }, 1, null), {
      ok: false,
      reason: "Give the claim a title.",
    });
    assert.equal(canSubmit({ title: "x", amount: 0 }, 1, null).ok, false);
    assert.deepEqual(canSubmit({ title: "x", amount: 10 }, 0, null), {
      ok: false,
      reason: "Attach at least one receipt.",
    });
    assert.equal(canSubmit({ title: "x", amount: 6000 }, 1, 5000).ok, false);
    assert.equal(canSubmit({ title: "x", amount: 6000 }, 1, 0).ok, true);
    assert.deepEqual(canSubmit({ title: "x", amount: 10 }, 1, 5000), { ok: true });
  });
});

describe("actionsFor", () => {
  const owner = { profileId: "emp", canDecide: false };
  const cfo = { profileId: "cfo", canDecide: true };
  const other = { profileId: "x", canDecide: false };
  it("draft: owner edits/submits/deletes, nobody else", () => {
    assert.deepEqual(actionsFor({ ...base, status: "draft" }, owner), ["edit", "submit", "delete"]);
    assert.deepEqual(actionsFor({ ...base, status: "draft" }, cfo), []);
  });
  it("submitted: owner withdraws, cfo decides", () => {
    assert.deepEqual(actionsFor({ ...base, status: "submitted" }, owner), ["withdraw"]);
    assert.deepEqual(actionsFor({ ...base, status: "submitted" }, cfo), ["approve", "reject"]);
    assert.deepEqual(actionsFor({ ...base, status: "submitted" }, other), []);
  });
  it("cfo never decides their own claim", () => {
    assert.deepEqual(actionsFor({ ...base, claimant_id: "cfo", status: "submitted" }, cfo), [
      "withdraw",
    ]);
  });
  it("approved → pay/reject by cfo; rejected → reopen by owner; paid → nothing", () => {
    assert.deepEqual(actionsFor({ ...base, status: "approved" }, cfo), ["pay", "reject"]);
    assert.deepEqual(actionsFor({ ...base, status: "approved" }, owner), []);
    assert.deepEqual(actionsFor({ ...base, status: "rejected" }, owner), ["reopen"]);
    assert.deepEqual(actionsFor({ ...base, status: "paid" }, cfo), []);
  });
});

describe("totals + csv", () => {
  const claims: ClaimRow[] = [
    { ...base, id: "1", status: "submitted", amount: 100 },
    { ...base, id: "2", status: "submitted", amount: 50.25 },
    { ...base, id: "3", status: "paid", amount: 200, paid_at: "2026-09-02T10:00:00Z" },
    { ...base, id: "4", status: "paid", amount: 10, paid_at: "2026-08-30T10:00:00Z" },
  ];
  it("totalsByStatus sums counts and amounts", () => {
    const t = totalsByStatus(claims);
    assert.deepEqual(t.submitted, { count: 2, amount: 150.25 });
    assert.equal(t.paid.count, 2);
    assert.equal(t.draft.count, 0);
  });
  it("paidInMonth filters by paid_at month", () => {
    assert.equal(paidInMonth(claims, "2026-09"), 200);
    assert.equal(paidInMonth(claims, "2026-08"), 10);
  });
  it("csv escapes commas/quotes and resolves names", () => {
    const csv = claimsToCsv(
      [
        {
          ...base,
          title: 'Taxi, "airport"',
          status: "paid",
          paid_by: "cfo",
          payment_method: "momo",
        },
      ],
      new Map([
        ["emp", "Kofi Boateng"],
        ["cfo", "Kwame Mensah"],
      ]),
    );
    const lines = csv.split("\n");
    assert.equal(lines[0].startsWith("Claim #,Claimant,Title"), true);
    assert.ok(lines[1].includes('1001,Kofi Boateng,"Taxi, ""airport""",Fuel'));
    assert.ok(lines[1].includes("Kwame Mensah"));
    assert.ok(lines[1].includes("Mobile money"));
  });
});
