import { useMemo, useRef, useState, type ReactNode } from "react";
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
import { Info, Upload, X, FileText } from "lucide-react";
import {
  LEAVE_TYPES,
  fmtISO,
  leaveGuidance,
  parseISODate,
  eachDayISO,
  yearOfISO,
  isWorkingDayISO,
} from "@/lib/leave";
import { useHolidays, useEmployees, useAllowances } from "@/lib/data";
import { useAuth } from "@/lib/auth-context";
import { LEAVE_MAP } from "@/lib/leave"

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
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSick = LEAVE_MAP[code as keyof typeof LEAVE_MAP]?.category === "sick";

  const employees = useEmployees({ enabled: isManagement });

  // The employee this request is filed for.
  const selectedEmployeeId = isManagement
    ? targetEmployeeId || profile?.id || ""
    : profile?.id || "";

  // Sick leave allowance tracking
  const year = yearOfISO(start);
  const allowances = useAllowances(year);
  const sickUsed = useMemo(() => {
    const entries = qc.getQueryData(["entries", year]) as
      | { employee_id: string; leave_code: string; status: string }[]
      | undefined;
    if (!entries || !selectedEmployeeId) return 0;
    return entries
      .filter(
        (e) =>
          e.employee_id === selectedEmployeeId &&
          LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP]?.category === "sick" &&
          e.status !== "rejected",
      )
      .reduce((s, e) => s + (LEAVE_MAP[e.leave_code as keyof typeof LEAVE_MAP]?.days ?? 1), 0);
  }, [qc, year, selectedEmployeeId]);
  const sickAllowance = useMemo(() => {
    const a = (allowances.data ?? []).find((x) => x.employee_id === selectedEmployeeId);
    return a?.sick_leave_allowance_days ?? 5;
  }, [allowances.data, selectedEmployeeId]);
  const sickRemaining = sickAllowance - sickUsed;

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

    // Sick leave validation
    if (isSick) {
      const s = parseISODate(start);
      const e = parseISODate(end);
      const sickDays = eachDayISO(start, end).filter(
        (d) => !isWorkingDayISO(d, holidaySet),
      ).length;
      if (sickDays > sickRemaining)
        return toast.error(
          `Sick leave exceeds remaining allowance. ${sickRemaining.toFixed(1)} day${sickRemaining !== 1 ? "s" : ""} remaining of ${sickAllowance} annual limit.`,
        );
      if (!file)
        return toast.error("A doctor's report attachment is required for sick leave.");
    }
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
      attachment_url: string | null;
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
        attachment_url: null,
      });
    }
    if (rows.length === 0)
      return toast.error(
        "That range has no working days (weekends and public holidays are excluded).",
      );
    setBusy(true);

    // Upload attachment if sick leave
    let attachmentUrl: string | null = null;
    if (isSick && file && profile?.id) {
      // Server-side file validation
      const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "doc", "docx"];
      const ALLOWED_MIME_TYPES = [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        setBusy(false);
        return toast.error(`File type ".${ext}" is not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(", ")}`);
      }
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        setBusy(false);
        return toast.error(`File type "${file.type}" is not allowed.`);
      }
      if (file.size > MAX_FILE_SIZE) {
        setBusy(false);
        return toast.error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`);
      }

      // Use only safe characters in path to prevent path traversal
      const safeExt = ext.replace(/[^a-z0-9]/g, "");
      const path = `${profile.id}/${Date.now()}.${safeExt}`;
      const { error: uploadErr } = await supabase.storage
        .from("leave-attachments")
        .upload(path, file, { contentType: file.type });
      if (uploadErr) {
        setBusy(false);
        return toast.error(`Upload failed: ${uploadErr.message}`);
      }
      attachmentUrl = path;
    }

    // Set attachment_url on all rows
    if (attachmentUrl) {
      for (const row of rows) row.attachment_url = attachmentUrl;
    }

    const { error } = await supabase
      .from("leave_entries")
      .upsert(rows, { onConflict: "employee_id,date" });
    setBusy(false);
    if (error) return toast.error(error.message);

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
    setFile(null);
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
          {isSick && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              <span className="font-medium">Sick leave allowance:</span> {sickRemaining.toFixed(1)} day{sickRemaining !== 1 ? "s" : ""} remaining of {sickAllowance} annual limit.
            </div>
          )}
          {isSick && (
            <div>
              <Label>Doctor's report <span className="text-red-500">*</span></Label>
              {file ? (
                <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate text-sm">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(0)} KB
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-red-600"
                    onClick={() => setFile(null)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50"
                >
                  <Upload className="h-4 w-4" />
                  <span>Attach doctor's report (required for sick leave)</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    if (f.size > 5 * 1024 * 1024) {
                      toast.error("File must be under 5 MB");
                      return;
                    }
                    setFile(f);
                  }
                }}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">PDF, JPG, PNG, or DOC — max 5 MB</p>
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
            <Label>Reason <span className="text-red-500">*</span></Label>
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
