import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actionsFor,
  canApproveClaimFor,
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
  kind: "out_of_pocket",
  status: "draft",
  submitted_at: null,
  reviewed_by: null,
  reviewed_at: null,
  decision_note: null,
  approved_by: null,
  approved_at: null,
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
  const owner = { profileId: "emp", canApprove: false, canPay: false };
  const head = { profileId: "head", canApprove: true, canPay: false };
  const cfo = { profileId: "cfo", canApprove: false, canPay: true };
  const other = { profileId: "x", canApprove: false, canPay: false };
  it("draft: owner edits/submits/deletes, nobody else", () => {
    assert.deepEqual(actionsFor({ ...base, status: "draft" }, owner), ["edit", "submit", "delete"]);
    assert.deepEqual(actionsFor({ ...base, status: "draft" }, head), []);
    assert.deepEqual(actionsFor({ ...base, status: "draft" }, cfo), []);
  });
  it("submitted: owner withdraws, the department head decides — not the CFO", () => {
    assert.deepEqual(actionsFor({ ...base, status: "submitted" }, owner), ["withdraw"]);
    assert.deepEqual(actionsFor({ ...base, status: "submitted" }, head), ["approve", "reject"]);
    assert.deepEqual(actionsFor({ ...base, status: "submitted" }, cfo), []);
    assert.deepEqual(actionsFor({ ...base, status: "submitted" }, other), []);
  });
  it("nobody decides their own claim — they are only its owner", () => {
    assert.deepEqual(actionsFor({ ...base, claimant_id: "head", status: "submitted" }, head), [
      "withdraw",
    ]);
    assert.deepEqual(actionsFor({ ...base, claimant_id: "cfo", status: "approved" }, cfo), []);
  });
  it("approved: the CFO pays, and either hand may still stop it", () => {
    assert.deepEqual(actionsFor({ ...base, status: "approved" }, cfo), ["pay", "reject"]);
    assert.deepEqual(actionsFor({ ...base, status: "approved" }, head), ["reject"]);
    assert.deepEqual(actionsFor({ ...base, status: "approved" }, owner), []);
  });
  it("rejected → reopen by owner; paid → nothing", () => {
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
    // Kind sits between the title and the category, so finance can tell an
    // advance from money the employee has already spent.
    assert.ok(lines[1].includes('1001,Kofi Boateng,"Taxi, ""airport""",Out-of-pocket,Fuel'));
    assert.ok(lines[1].includes("Kwame Mensah"));
    assert.ok(lines[1].includes("Mobile money"));
  });
});

describe("canApproveClaimFor", () => {
  const teams = [
    { id: "eng", manager_id: "aaron" },
    { id: "sales", manager_id: "kwame" },
    { id: "interns", manager_id: null },
  ];
  const people = [
    { id: "kofi", team_id: "eng" },
    { id: "theo", team_id: "sales" },
    { id: "dorcas", team_id: "interns" },
    { id: "aaron", team_id: "eng" },
    { id: "kwame", team_id: "finance" },
  ];

  it("lets the department head approve their own team", () => {
    assert.equal(
      canApproveClaimFor("kofi", { profileId: "aaron", role: "manager" }, teams, people),
      true,
    );
  });

  it("does not let another department's head approve", () => {
    assert.equal(
      canApproveClaimFor("theo", { profileId: "aaron", role: "manager" }, teams, people),
      false,
    );
  });

  it("does not let the CFO approve a team that has its own head", () => {
    assert.equal(
      canApproveClaimFor("kofi", { profileId: "kwame", role: "cfo" }, teams, people),
      false,
    );
  });

  it("falls back to org-wide authority when the team has no head", () => {
    assert.equal(
      canApproveClaimFor("dorcas", { profileId: "kwame", role: "cfo" }, teams, people),
      true,
    );
    assert.equal(
      canApproveClaimFor("dorcas", { profileId: "aaron", role: "manager" }, teams, people),
      false,
    );
  });

  it("never lets anyone approve their own claim", () => {
    assert.equal(
      canApproveClaimFor("aaron", { profileId: "aaron", role: "manager" }, teams, people),
      false,
    );
  });

  it("sends a head's own claim to org-wide authority instead", () => {
    assert.equal(
      canApproveClaimFor("aaron", { profileId: "kwame", role: "cfo" }, teams, people),
      true,
    );
  });

  it("treats someone with no team as org-wide business", () => {
    assert.equal(
      canApproveClaimFor("ghost", { profileId: "kwame", role: "cfo" }, teams, people),
      true,
    );
    assert.equal(
      canApproveClaimFor("ghost", { profileId: "kofi", role: "employee" }, teams, people),
      false,
    );
  });
});
