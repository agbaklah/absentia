import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Info } from "lucide-react";
import {
  LEAVE_TYPES,
  fmtISO,
  leaveGuidance,
  parseISODate,
  eachDayISO,
  yearOfISO,
  isWorkingDayISO,
} from "@/lib/leave";
import { useHolidays, useEmployees } from "@/lib/data";
import { useAuth } from "@/lib/auth-context";
import { notifyAdminsOnRequest } from "@/lib/notify-admins";
import { LEAVE_MAP } from "@/lib/leave";

/**
 * Leave request dialog.
 *
 * - **Employees**: files against their own profile.
 * - **Managers / admins / super admins**: can pick an employee from a
 *   selector to request on their behalf (the `requested_by` column tracks
 *   who filed the request).
 * - **Super admins only**: requesting for *themselves* is blocked — they
 *   have no leave allowance and can only file on behalf of others.
 */
export function RequestLeaveDialog({ trigger }: { trigger?: ReactNode }) {
  const { profile, isAdmin, isSuperAdmin, isManagement } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("L");
  const [start, setStart] = useState(fmtISO(new Date()));
  const [end, setEnd] = useState(fmtISO(new Date()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [targetEmployeeId, setTargetEmployeeId] = useState<string>("");

  const employees = useEmployees({ enabled: isManagement });

  // The employee this request is filed for.
  const selectedEmployeeId = isManagement
    ? targetEmployeeId || profile?.id || ""
    : profile?.id || "";

  // Public holidays for any year the range might touch, so they're excluded too.
  const hStart = useHolidays(yearOfISO(start));
  const hEnd = useHolidays(yearOfISO(end));
  const holidaySet = useMemo(
    () => new Set([...(hStart.data ?? []), ...(hEnd.data ?? [])].map((h) => h.date)),
    [hStart.data, hEnd.data],
  );

  const submit = async () => {
    if (!selectedEmployeeId) return toast.error("Select an employee to file the request for");
    if (isSuperAdmin && selectedEmployeeId === profile?.id)
      return toast.error("Super admins cannot request leave for themselves");
    if (!note.trim()) return toast.error("Please provide a reason for this leave request");
    const s = parseISODate(start);
    const e = parseISODate(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()))
      return toast.error("Choose valid start and end dates");
    if (e < s) return toast.error("End date is before start date");
    const rows: {
      employee_id: string;
      date: string;
      leave_code: string;
      note: string | null;
      status: "pending";
      requested_by: string | null;
    }[] = [];
    for (const date of eachDayISO(start, end)) {
      if (!isWorkingDayISO(date, holidaySet)) continue; // business days only
      rows.push({
        employee_id: selectedEmployeeId,
        date,
        leave_code: code,
        note: note || null,
        status: "pending",
        requested_by: profile?.id ?? null,
      });
    }
    if (rows.length === 0)
      return toast.error(
        "That range has no working days (weekends and public holidays are excluded).",
      );
    setBusy(true);
    const { error } = await supabase
      .from("leave_entries")
      .upsert(rows, { onConflict: "employee_id,date" });
    setBusy(false);
    if (error) return toast.error(error.message);

    // Notify admins via email (fire-and-forget)
    const empName =
      isManagement && selectedEmployeeId !== profile?.id
        ? ((employees.data ?? []).find((e) => e.id === selectedEmployeeId)?.full_name ?? "employee")
        : (profile?.full_name ?? "employee");
    const empEmail =
      isManagement && selectedEmployeeId !== profile?.id
        ? ((employees.data ?? []).find((e) => e.id === selectedEmployeeId)?.email ?? "")
        : (profile?.email ?? "");
    const leaveLabel = LEAVE_MAP[code as keyof typeof LEAVE_MAP]?.label ?? code;
    void notifyAdminsOnRequest({
      data: {
        employeeName: empName,
        employeeEmail: empEmail,
        leaveType: leaveLabel,
        startDate: start,
        endDate: end,
        dayCount: rows.length,
        note: note || undefined,
      },
    });

    const targetName =
      isManagement && selectedEmployeeId !== profile?.id
        ? ((employees.data ?? []).find((e) => e.id === selectedEmployeeId)?.full_name ?? "employee")
        : "you";
    toast.success(
      `Request submitted for ${targetName} — ${rows.length} working day${rows.length > 1 ? "s" : ""}`,
    );
    setOpen(false);
    setNote("");
    setTargetEmployeeId("");
    void qc.invalidateQueries({ queryKey: ["entries", new Date().getFullYear()] });
  };

  // For super admins: only show other employees (not themselves).
  // For managers: show their team members + themselves.
  // For employees: no selector (always self).
  const selectableEmployees = useMemo(() => {
    if (!isManagement) return [];
    const list = (employees.data ?? []).filter((e) => e.id !== profile?.id);
    return list;
  }, [isManagement, employees.data, profile?.id]);

  // For super admins, pre-select the first available employee so the dialog
  // isn't in a "no selection" state.
  const selectedName =
    isManagement && selectedEmployeeId && selectedEmployeeId !== profile?.id
      ? (employees.data ?? []).find((e) => e.id === selectedEmployeeId)?.full_name
      : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button>Request leave</Button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isManagement && targetEmployeeId
              ? `Request leave for ${selectedName ?? "employee"}`
              : "Request leave"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isManagement && (
            <div>
              <Label>Employee</Label>
              <Select value={targetEmployeeId} onValueChange={setTargetEmployeeId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      isSuperAdmin
                        ? "Select employee (required for super admin)"
                        : "Select employee (or leave blank for yourself)"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {!isSuperAdmin && (
                    <SelectItem value={profile?.id ?? ""}>
                      {profile?.full_name ?? "Myself"}
                    </SelectItem>
                  )}
                  {selectableEmployees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isSuperAdmin && !targetEmployeeId && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Super admins can only request leave on behalf of others.
                </p>
              )}
            </div>
          )}
          <div>
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
          {leaveGuidance(code) && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{leaveGuidance(code)}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label>End</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Reason</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Please provide a reason for this leave request" required />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || !note.trim()}>
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
