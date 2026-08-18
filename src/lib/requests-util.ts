import type { EntryRow } from "@/lib/data";
import { LEAVE_MAP, addDaysISO } from "@/lib/leave";

export function nextDay(iso: string): string {
  return addDaysISO(iso, 1);
}

export type LeaveGroup = {
  start: string;
  end: string;
  days: number;
  code: string;
  status: EntryRow["status"];
  note: string | null; // reviewer's decision comment, if any
};

/**
 * Collapse per-day entries into contiguous ranges that share the same leave code
 * and status. Returned most-recent-first.
 */
export function groupEntries(entries: EntryRow[]): LeaveGroup[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const groups: LeaveGroup[] = [];
  for (const e of sorted) {
    const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
    const days = t?.days ?? 1;
    const last = groups[groups.length - 1];
    if (
      last &&
      last.code === e.leave_code &&
      last.status === e.status &&
      nextDay(last.end) === e.date
    ) {
      last.end = e.date;
      last.days += days;
      if (!last.note && e.decision_note) last.note = e.decision_note;
    } else {
      groups.push({
        start: e.date,
        end: e.date,
        days,
        code: e.leave_code,
        status: e.status,
        note: e.decision_note ?? null,
      });
    }
  }
  return groups.reverse();
}

/** Split entries into per-employee, contiguous same-code requests (approval unit). */
export function toRequests(entries: EntryRow[]): { empId: string; items: EntryRow[] }[] {
  const byEmp = new Map<string, EntryRow[]>();
  for (const p of entries) {
    const arr = byEmp.get(p.employee_id) ?? [];
    arr.push(p);
    byEmp.set(p.employee_id, arr);
  }
  const reqs: { empId: string; items: EntryRow[] }[] = [];
  for (const [empId, items] of byEmp) {
    const sorted = items.sort((a, b) => a.date.localeCompare(b.date));
    let run: EntryRow[] = [];
    const flush = () => {
      if (run.length) reqs.push({ empId, items: run });
      run = [];
    };
    for (const e of sorted) {
      const last = run[run.length - 1];
      if (last && last.leave_code === e.leave_code && nextDay(last.date) === e.date) run.push(e);
      else {
        flush();
        run = [e];
      }
    }
    flush();
  }
  return reqs;
}

/**
 * Number of pending requests needing attention. Pass an employeeId to count only
 * that person's pending requests (employee view); omit it for the org-wide
 * approvals queue (management view).
 */
export function pendingRequestCount(entries: EntryRow[], employeeId?: string): number {
  const pending = entries.filter(
    (e) => e.status === "pending" && (!employeeId || e.employee_id === employeeId),
  );
  return toRequests(pending).length;
}
