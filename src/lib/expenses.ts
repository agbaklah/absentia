/**
 * Petty cash / expense reimbursement — pure helpers shared by the employee
 * and CFO views. No I/O here; the state machine itself is enforced by the
 * database trigger `expense_claim_transition`, these mirror it for the UI.
 */

export type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "paid";
export type PaymentMethod = "cash" | "momo" | "bank_transfer";

export type ClaimRow = {
  id: string;
  claim_no: number;
  claimant_id: string;
  title: string;
  description: string | null;
  category: string;
  amount: number;
  currency: string;
  expense_date: string;
  status: ExpenseStatus;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
  paid_by: string | null;
  paid_at: string | null;
  payment_method: PaymentMethod | null;
  payment_ref: string | null;
  created_at: string;
  updated_at: string;
};

export type ReceiptRow = {
  id: string;
  claim_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
};

export const EXPENSE_CATEGORIES = [
  { code: "fuel", label: "Fuel" },
  { code: "transport", label: "Transport & taxi" },
  { code: "meals", label: "Meals & refreshments" },
  { code: "supplies", label: "Office supplies" },
  { code: "accommodation", label: "Accommodation" },
  { code: "communication", label: "Airtime & data" },
  { code: "maintenance", label: "Repairs & maintenance" },
  { code: "other", label: "Other" },
] as const;

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.code, c.label]),
);

export const PAYMENT_METHODS: { code: PaymentMethod; label: string }[] = [
  { code: "cash", label: "Cash" },
  { code: "momo", label: "Mobile money" },
  { code: "bank_transfer", label: "Bank transfer" },
];

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  momo: "Mobile money",
  bank_transfer: "Bank transfer",
};

export const STATUS_META: Record<
  ExpenseStatus,
  { label: string; tone: "default" | "secondary" | "destructive" | "outline"; hint: string }
> = {
  draft: { label: "Draft", tone: "outline", hint: "Not yet sent for review." },
  submitted: { label: "Pending", tone: "secondary", hint: "Waiting for the CFO to review." },
  approved: { label: "Approved", tone: "default", hint: "Approved — awaiting reimbursement." },
  rejected: {
    label: "Rejected",
    tone: "destructive",
    hint: "Not approved. You can edit and resubmit.",
  },
  paid: { label: "Paid", tone: "default", hint: "Reimbursed." },
};

export const STATUS_ORDER: ExpenseStatus[] = ["submitted", "approved", "paid", "rejected", "draft"];

/** Accepted receipt uploads (mirrors the storage bucket's allowed_mime_types). */
export const RECEIPT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
];
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

/** "GHS 1,234.50" — currency code first so it reads naturally for GHS. */
export function formatMoney(amount: number, currency = "GHS"): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `${currency} ${n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Parse a typed amount ("1,250.5", " 40 ") → number, or null when invalid / ≤ 0. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 ? n : null;
}

/** Safe file name for storage: ASCII, no path separators, bounded length. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "receipt";
  const dot = base.lastIndexOf(".");
  const ext =
    dot > 0
      ? base
          .slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
      : "";
  let stem = (dot > 0 ? base.slice(0, dot) : base)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining accents
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  if (!stem) stem = "receipt";
  return ext ? `${stem}.${ext}` : stem;
}

/** Storage object path — must match the RLS rule <claimant>/<claim>/<file>. */
export function receiptPath(claimantId: string, claimId: string, fileName: string, nonce: string) {
  return `${claimantId}/${claimId}/${nonce}-${sanitizeFileName(fileName)}`;
}

export function validateReceiptFile(file: { type: string; size: number }): string | null {
  if (!RECEIPT_MIME_TYPES.includes(file.type)) return "Only JPG, PNG, WEBP, HEIC or PDF files.";
  if (file.size <= 0) return "File is empty.";
  if (file.size > RECEIPT_MAX_BYTES) return "File is larger than 10 MB.";
  return null;
}

/** Client-side mirror of the submit rules so users get instant feedback. */
export function canSubmit(
  claim: { amount: number; title: string },
  receiptCount: number,
  limit: number | null,
): { ok: true } | { ok: false; reason: string } {
  if (!claim.title.trim()) return { ok: false, reason: "Give the claim a title." };
  if (!(claim.amount > 0)) return { ok: false, reason: "Enter an amount greater than zero." };
  if (limit && limit > 0 && claim.amount > limit)
    return { ok: false, reason: `Amount exceeds the petty cash limit of ${formatMoney(limit)}.` };
  if (receiptCount === 0) return { ok: false, reason: "Attach at least one receipt." };
  return { ok: true };
}

export type ClaimAction =
  "edit" | "submit" | "withdraw" | "delete" | "reopen" | "approve" | "reject" | "pay";

/** Which buttons a viewer may see for a claim (the DB re-checks all of them). */
export function actionsFor(
  claim: Pick<ClaimRow, "status" | "claimant_id">,
  viewer: { profileId: string | null; canDecide: boolean },
): ClaimAction[] {
  const own = viewer.profileId === claim.claimant_id;
  const reviewer = viewer.canDecide && !own;
  switch (claim.status) {
    case "draft":
      return own ? ["edit", "submit", "delete"] : [];
    case "submitted":
      return [
        ...(own ? (["withdraw"] as ClaimAction[]) : []),
        ...(reviewer ? (["approve", "reject"] as ClaimAction[]) : []),
      ];
    case "approved":
      return reviewer ? ["pay", "reject"] : [];
    case "rejected":
      return own ? ["reopen"] : [];
    case "paid":
      return [];
  }
}

export type StatusTotals = Record<ExpenseStatus, { count: number; amount: number }>;

export function totalsByStatus(claims: Pick<ClaimRow, "status" | "amount">[]): StatusTotals {
  const t: StatusTotals = {
    draft: { count: 0, amount: 0 },
    submitted: { count: 0, amount: 0 },
    approved: { count: 0, amount: 0 },
    rejected: { count: 0, amount: 0 },
    paid: { count: 0, amount: 0 },
  };
  for (const c of claims) {
    t[c.status].count += 1;
    t[c.status].amount += Number(c.amount);
  }
  return t;
}

/** Sum paid in a given calendar month (YYYY-MM), by paid_at. */
export function paidInMonth(claims: Pick<ClaimRow, "status" | "amount" | "paid_at">[], ym: string) {
  return claims
    .filter((c) => c.status === "paid" && c.paid_at && c.paid_at.slice(0, 7) === ym)
    .reduce((s, c) => s + Number(c.amount), 0);
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Finance-friendly CSV of claims for reconciliation. */
export function claimsToCsv(claims: ClaimRow[], names: Map<string, string>): string {
  const header = [
    "Claim #",
    "Claimant",
    "Title",
    "Category",
    "Expense date",
    "Amount",
    "Currency",
    "Status",
    "Submitted",
    "Reviewed by",
    "Reviewed at",
    "Decision note",
    "Paid by",
    "Paid at",
    "Payment method",
    "Payment ref",
  ];
  const rows = claims.map((c) => [
    c.claim_no,
    names.get(c.claimant_id) ?? c.claimant_id,
    c.title,
    CATEGORY_LABEL[c.category] ?? c.category,
    c.expense_date,
    Number(c.amount).toFixed(2),
    c.currency,
    STATUS_META[c.status].label,
    c.submitted_at ?? "",
    c.reviewed_by ? (names.get(c.reviewed_by) ?? c.reviewed_by) : "",
    c.reviewed_at ?? "",
    c.decision_note ?? "",
    c.paid_by ? (names.get(c.paid_by) ?? c.paid_by) : "",
    c.paid_at ?? "",
    c.payment_method ? PAYMENT_LABEL[c.payment_method] : "",
    c.payment_ref ?? "",
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

/** Human file size. */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
