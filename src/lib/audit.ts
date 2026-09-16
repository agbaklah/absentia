import type { AuditRow } from "@/lib/data";

/** One-line human summary of an audit row's payload. */
export function describeAudit(r: AuditRow, names: Map<string, string>): string {
  const a = (r.after ?? {}) as Record<string, unknown>;
  if (r.entity === "expense_claim") {
    return `#${a.claim_no ?? "?"} ${a.title ?? ""} · ${a.currency ?? ""} ${a.amount ?? ""}`.trim();
  }
  if (r.entity === "leave_request") {
    const who = names.get(String(r.entity_id)) ?? "employee";
    const range = a.from && a.to && a.from !== a.to ? `${a.from} → ${a.to}` : String(a.from ?? "");
    return `${who} · ${a.leave_code ?? ""} · ${range} · ${a.days ?? ""}d${a.note ? ` · “${a.note}”` : ""}`;
  }
  if (r.entity === "leave_entry") {
    const who = names.get(String(a.employee_id)) ?? a.employee_name ?? "employee";
    return `${who} · ${a.leave_type ?? a.leave_code ?? ""} · ${a.date ?? ""}`;
  }
  return JSON.stringify(a).slice(0, 120);
}
