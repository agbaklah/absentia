import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Info, CheckCircle2, XCircle, Clock3 } from "lucide-react";
import { useEntries, useEmployees, useTeams, useHolidays, type EntryRow } from "@/lib/data";
import {
  LEAVE_TYPES,
  LEAVE_MAP,
  fmtISO,
  leaveGuidance,
  parseISODate,
  addDaysISO,
  eachDayISO,
  yearOfISO,
  fmtDayShort,
  fmtDayFull,
  fmtTimestamp,
  isWeekendISO,
  isWorkingDayISO,
} from "@/lib/leave";
import { toRequests, groupEntries, nextDay } from "@/lib/requests-util";
import { useAuth } from "@/lib/auth-context";
import { RequestLeaveDialog } from "@/components/RequestLeaveDialog";
import { PageHeader } from "@/components/PageHeader";
import { InitialsAvatar } from "@/components/InitialsAvatar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/requests")({
  component: RequestsRoute,
});

function RequestsRoute() {
  const { isManagement } = useAuth();
  return isManagement ? <ManagementRequests /> : <EmployeeRequests />;
}

const statusVariant: Record<EntryRow["status"], "default" | "secondary" | "destructive"> = {
  approved: "default",
  pending: "secondary",
  rejected: "destructive",
};

function prevDay(iso: string): string {
  return addDaysISO(iso, -1);
}

/** Next business day after a date (skips weekends) — when the employee returns. */
function nextWorkingDay(iso: string): string {
  let d = iso;
  do {
    d = addDaysISO(d, 1);
  } while (isWeekendISO(d));
  return d;
}

/**
 * The full leave period a single day belongs to: the contiguous run of the same
 * employee + leave code (any status). Returns first day, last day, return day
 * (next working day after the last), and total working days.
 */
function leavePeriod(all: EntryRow[], target: EntryRow) {
  const dates = new Set(
    all
      .filter((e) => e.employee_id === target.employee_id && e.leave_code === target.leave_code)
      .map((e) => e.date),
  );
  let start = target.date;
  while (dates.has(prevDay(start))) start = prevDay(start);
  let end = target.date;
  while (dates.has(nextDay(end))) end = nextDay(end);
  const t = LEAVE_MAP[target.leave_code as keyof typeof LEAVE_MAP];
  const days = all
    .filter(
      (e) =>
        e.employee_id === target.employee_id &&
        e.leave_code === target.leave_code &&
        e.date >= start &&
        e.date <= end,
    )
    .reduce((s) => s + (t?.days ?? 1), 0);
  return { start, end, returns: nextWorkingDay(end), days };
}

// ---------------------------------------------------------------------------
// Management view: approvals queue with approve / deny / reduce
// ---------------------------------------------------------------------------
function ManagementRequests() {
  const year = new Date().getFullYear();
  const { profile } = useAuth();
  const entries = useEntries(year);
  const employees = useEmployees();
  const teams = useTeams();
  const qc = useQueryClient();

  const [comments, setComments] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<EntryRow | null>(null);

  const pending = useMemo(
    () => (entries.data ?? []).filter((e) => e.status === "pending"),
    [entries.data],
  );
  const requests = useMemo(() => toRequests(pending), [pending]);

  const setStatus = async (ids: string[], status: "approved" | "rejected", note?: string) => {
    if (ids.length === 0) return { error: null };
    const patch: {
      status: "approved" | "rejected";
      approved_by: string | null;
      approved_at: string;
      decision_note?: string | null;
    } = {
      status,
      approved_by: profile?.id ?? null,
      approved_at: new Date().toISOString(),
    };
    if (note !== undefined) patch.decision_note = note.trim() || null;
    const { data, error } = await supabase
      .from("leave_entries")
      .update(patch)
      .in("id", ids)
      .select("id");
    if (error) return { error: error.message };
    // Row-level security can silently filter the update down to zero rows
    // (e.g. a manager acting on another team's request) — report that instead
    // of pretending the decision went through.
    if (!data || data.length !== ids.length) {
      return { error: "No changes were made — you can only manage requests for your own team." };
    }
    void qc.invalidateQueries({ queryKey: ["entries", year] });
    return { error: null };
  };

  const decide = async (ids: string[], status: "approved" | "rejected", note?: string) => {
    const res = await setStatus(ids, status, note);
    if (res?.error) return toast.error(res.error);
    toast.success(status === "approved" ? "Approved" : "Rejected");
  };

  const reduce = async (approveIds: string[], rejectIds: string[], note?: string) => {
    const results = await Promise.all([
      setStatus(approveIds, "approved", note),
      setStatus(rejectIds, "rejected", note),
    ]);
    const failed = results.find((r) => r?.error);
    if (failed) {
      toast.error(failed.error);
      return;
    }
    toast.success(
      `Approved ${approveIds.length} day${approveIds.length !== 1 ? "s" : ""}, rejected ${rejectIds.length}`,
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Leave requests" description="Approve, deny, or reduce pending requests.">
        <ManagementRequestDialog />
      </PageHeader>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Clock3 className="h-4 w-4 text-amber-600" />
          Pending approvals
          <Badge variant="secondary" className="tabular">
            {pending.length}
          </Badge>
        </div>
        {requests.length === 0 && (
          <div className="text-sm text-muted-foreground">Nothing to approve.</div>
        )}
        <div className="space-y-3">
          {requests.map((req) => {
            const emp = (employees.data ?? []).find((e) => e.id === req.empId);
            const team = (teams.data ?? []).find((t) => t.id === emp?.team_id);
            const ids = req.items.map((i) => i.id);
            const dates = req.items.map((i) => i.date).sort();
            const code = req.items[0].leave_code;
            const t = LEAVE_MAP[code as keyof typeof LEAVE_MAP];
            const guidance = leaveGuidance(code);
            const key = req.items[0].id;
            const comment = comments[key] ?? "";
            return (
              <div
                key={key}
                className="space-y-2 rounded-lg border bg-card/60 p-3 transition-colors hover:bg-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <InitialsAvatar
                      name={emp?.full_name ?? "?"}
                      className="mt-0.5 h-9 w-9 text-xs"
                    />
                    <div className="min-w-0">
                      <div className="font-medium">{emp?.full_name ?? "Unknown"}</div>
                      <div className="text-xs text-muted-foreground">{team?.name ?? "—"}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
                        <span className="tabular">
                          {dates[0]} → {dates[dates.length - 1]}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span>
                          {req.items.length} day{req.items.length > 1 ? "s" : ""}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ background: t?.colour }}
                          />
                          {t?.label ?? code}
                        </span>
                      </div>
                      {req.items[0].note && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Employee note: “{req.items[0].note}”
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => decide(ids, "rejected", comment)}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Deny
                    </Button>
                    {req.items.length > 1 && (
                      <ReduceDialog
                        req={req}
                        empName={emp?.full_name ?? "employee"}
                        comment={comment}
                        onReduce={reduce}
                      />
                    )}
                    <Button size="sm" onClick={() => decide(ids, "approved", comment)}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve
                    </Button>
                  </div>
                </div>

                {guidance && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{guidance}</span>
                  </div>
                )}

                <Textarea
                  rows={2}
                  placeholder="Add a comment for the employee (optional) — e.g. request a doctor's report…"
                  value={comment}
                  onChange={(ev) => setComments((c) => ({ ...c, [key]: ev.target.value }))}
                  className="text-sm"
                />
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 text-sm font-medium">Recent activity</div>
        <div className="divide-y">
          {(entries.data ?? [])
            .slice(-20)
            .reverse()
            .map((e) => {
              const emp = (employees.data ?? []).find((x) => x.id === e.employee_id);
              const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setSelected(e)}
                  className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: t?.colour }}
                    />
                    <div className="min-w-0">
                      <div className="truncate">
                        {emp?.full_name} · {fmtDayShort(e.date)} · <b>{t?.label ?? e.leave_code}</b>
                      </div>
                      {e.decision_note && (
                        <div className="truncate text-xs italic text-muted-foreground">
                          “{e.decision_note}”
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge variant={statusVariant[e.status]}>{e.status}</Badge>
                </button>
              );
            })}
          {(entries.data ?? []).length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">No activity yet.</div>
          )}
        </div>
      </Card>

      <ActivityDetailDialog
        entry={selected}
        allEntries={entries.data ?? []}
        employees={employees.data ?? []}
        teams={teams.data ?? []}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

/** Rich detail popup for a single leave-activity record. */
function ActivityDetailDialog({
  entry,
  allEntries,
  employees,
  teams,
  onClose,
}: {
  entry: EntryRow | null;
  allEntries: EntryRow[];
  employees: { id: string; full_name: string; email: string; team_id: string | null }[];
  teams: { id: string; name: string }[];
  onClose: () => void;
}) {
  const emp = entry ? employees.find((x) => x.id === entry.employee_id) : undefined;
  const team = emp ? teams.find((t) => t.id === emp.team_id) : undefined;
  const t = entry ? LEAVE_MAP[entry.leave_code as keyof typeof LEAVE_MAP] : undefined;
  const period = entry ? leavePeriod(allEntries, entry) : null;
  const requestedBy = entry?.requested_by
    ? (employees.find((x) => x.id === entry.requested_by)?.full_name ?? "—")
    : "—";
  const reviewedBy = entry?.approved_by
    ? (employees.find((x) => x.id === entry.approved_by)?.full_name ?? "—")
    : null;
  const reviewedAt = fmtTimestamp(entry?.approved_at ?? null);
  const isSelf = entry?.requested_by && entry.requested_by === entry.employee_id;

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {entry && period && (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between gap-3">
                <DialogTitle className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: t?.colour }}
                  />
                  {t?.label ?? entry.leave_code}
                </DialogTitle>
                <Badge variant={statusVariant[entry.status]}>{entry.status}</Badge>
              </div>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <InitialsAvatar name={emp?.full_name ?? "?"} className="h-10 w-10 text-sm" />
                <div className="min-w-0">
                  <div className="font-semibold">{emp?.full_name ?? "Unknown employee"}</div>
                  <div className="text-sm text-muted-foreground">
                    Department:{" "}
                    <span className="font-medium text-foreground">
                      {team?.name ?? "Unassigned"}
                    </span>
                  </div>
                  {emp?.email && <div className="text-xs text-muted-foreground">{emp.email}</div>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Leave date
                  </div>
                  <div className="mt-0.5 font-medium">{fmtDayFull(period.start)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Returns to work
                  </div>
                  <div className="mt-0.5 font-medium">{fmtDayFull(period.returns)}</div>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Detail label="Last day of leave">{fmtDayFull(period.end)}</Detail>
                <Detail label="Working days">{period.days}</Detail>
                <Detail label="Leave code">{entry.leave_code}</Detail>
                <Detail label="Category" className="capitalize">
                  {t?.category ?? "—"}
                </Detail>
                <Detail label="Requested by">{isSelf ? "Self" : requestedBy}</Detail>
                {reviewedBy && <Detail label="Reviewed by">{reviewedBy}</Detail>}
                {reviewedAt && <Detail label="Reviewed at">{reviewedAt}</Detail>}
              </dl>

              {entry.note && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Employee reason
                  </div>
                  <p className="mt-1 rounded-md border bg-background p-2 text-sm">{entry.note}</p>
                </div>
              )}

              {entry.decision_note && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Reviewer comment
                  </div>
                  <p className="mt-1 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">
                    {entry.decision_note}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 font-medium", className)}>{children}</dd>
    </div>
  );
}

/** Reduce = partial approval: pick which days to approve; the rest are rejected. */
function ReduceDialog({
  req,
  empName,
  comment,
  onReduce,
}: {
  req: { items: EntryRow[] };
  empName: string;
  comment: string;
  onReduce: (approveIds: string[], rejectIds: string[], note?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [approved, setApproved] = useState<Set<string>>(() => new Set(req.items.map((i) => i.id)));

  const toggle = (id: string) =>
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    const approveIds = req.items.filter((i) => approved.has(i.id)).map((i) => i.id);
    const rejectIds = req.items.filter((i) => !approved.has(i.id)).map((i) => i.id);
    await onReduce(approveIds, rejectIds, comment);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Reduce
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reduce request — {empName}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Tick the days to approve. Unticked days are rejected.
        </p>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {req.items.map((i) => (
            <label
              key={i.id}
              className="flex cursor-pointer items-center gap-3 rounded-md border p-2 text-sm"
            >
              <Checkbox checked={approved.has(i.id)} onCheckedChange={() => toggle(i.id)} />
              <span className="tabular">{i.date}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {LEAVE_MAP[i.leave_code as keyof typeof LEAVE_MAP]?.label ?? i.leave_code}
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">
            {approved.size} approve · {req.items.length - approved.size} reject
          </span>
          <Button onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Management can file a request on behalf of any employee. */
function ManagementRequestDialog() {
  const [open, setOpen] = useState(false);
  const [empId, setEmpId] = useState("");
  const [code, setCode] = useState("L");
  const [start, setStart] = useState(fmtISO(new Date()));
  const [end, setEnd] = useState(fmtISO(new Date()));
  const [note, setNote] = useState("");
  const { profile } = useAuth();
  const employees = useEmployees();
  const qc = useQueryClient();
  const hStart = useHolidays(yearOfISO(start));
  const hEnd = useHolidays(yearOfISO(end));
  const holidaySet = useMemo(
    () => new Set([...(hStart.data ?? []), ...(hEnd.data ?? [])].map((h) => h.date)),
    [hStart.data, hEnd.data],
  );

  const submit = async () => {
    const s = parseISODate(start);
    const e = parseISODate(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()))
      return toast.error("Choose valid start and end dates");
    if (e < s) return toast.error("End date is before start date");
    if (!empId) return toast.error("Choose an employee");
    if (!note.trim()) return toast.error("Please provide a reason for this leave request");
    const rows = [];
    for (const date of eachDayISO(start, end)) {
      if (!isWorkingDayISO(date, holidaySet)) continue; // business days only
      rows.push({
        employee_id: empId,
        date,
        leave_code: code,
        note: note || null,
        status: "pending" as const,
        requested_by: profile?.id ?? null,
      });
    }
    if (rows.length === 0)
      return toast.error(
        "That range has no working days (weekends and public holidays are excluded).",
      );
    const { error } = await supabase
      .from("leave_entries")
      .upsert(rows, { onConflict: "employee_id,date" });
    if (error) return toast.error(error.message);

    toast.success(`Request submitted — ${rows.length} working day${rows.length > 1 ? "s" : ""}`);
    setOpen(false);
    void qc.invalidateQueries({ queryKey: ["entries", new Date().getFullYear()] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New request</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New leave request</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Employee</Label>
            <Select value={empId} onValueChange={setEmpId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose employee" />
              </SelectTrigger>
              <SelectContent>
                {(employees.data ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Leave type</Label>
            <Select value={code} onValueChange={setCode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.filter((t) => t.category !== "holiday").map((t) => (
                  <SelectItem key={t.code} value={t.code}>
                    {t.code} — {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Please provide a reason for this leave request" required />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!note.trim()}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Employee view: my requests + status
// ---------------------------------------------------------------------------
function EmployeeRequests() {
  const year = new Date().getFullYear();
  const { profile } = useAuth();
  const entries = useEntries(year);

  const mine = useMemo(
    () => (entries.data ?? []).filter((e) => e.employee_id === profile?.id),
    [entries.data, profile?.id],
  );
  const requests = useMemo(() => groupEntries(mine), [mine]);
  const summary = useMemo(() => {
    const c = { approved: 0, pending: 0, rejected: 0 };
    for (const e of mine) {
      const t = LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP];
      c[e.status] += t?.days ?? 1;
    }
    return c;
  }, [mine]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My requests"
        description="Submit leave and track exactly which days were approved."
      >
        <RequestLeaveDialog />
      </PageHeader>

      {requests.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="default" className="tabular">
            {summary.approved} day{summary.approved !== 1 ? "s" : ""} approved
          </Badge>
          <Badge variant="secondary" className="tabular">
            {summary.pending} pending
          </Badge>
          <Badge variant="destructive" className="tabular">
            {summary.rejected} rejected
          </Badge>
        </div>
      )}

      <Card className="p-4">
        <div className="mb-3 text-sm font-medium">History</div>
        {requests.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No requests yet — use “Request leave” to submit one.
          </div>
        )}
        <div className="divide-y">
          {requests.map((g, i) => {
            const t = LEAVE_MAP[g.code as keyof typeof LEAVE_MAP];
            const single = g.start === g.end;
            return (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="inline-block h-8 w-1.5 rounded-full"
                    style={{ background: t?.colour }}
                  />
                  <div>
                    <div className="font-medium">{t?.label ?? g.code}</div>
                    <div className="text-xs text-muted-foreground">
                      {single
                        ? fmtDayShort(g.start)
                        : `${fmtDayShort(g.start)} → ${fmtDayShort(g.end)}`}
                      {" · "}
                      {g.days} working day{g.days !== 1 ? "s" : ""}
                    </div>
                    {g.note && (
                      <div className="mt-1 text-xs italic text-muted-foreground">
                        Reviewer: “{g.note}”
                      </div>
                    )}
                  </div>
                </div>
                <Badge variant={statusVariant[g.status]}>{g.status}</Badge>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
