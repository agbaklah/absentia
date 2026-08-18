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
import { useHolidays } from "@/lib/data";
import { useAuth } from "@/lib/auth-context";

/**
 * Self-service leave request for the signed-in employee. Always files against
 * the current user's own profile — employees can't request on behalf of others.
 */
export function RequestLeaveDialog({ trigger }: { trigger?: ReactNode }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("L");
  const [start, setStart] = useState(fmtISO(new Date()));
  const [end, setEnd] = useState(fmtISO(new Date()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Public holidays for any year the range might touch, so they're excluded too.
  const hStart = useHolidays(yearOfISO(start));
  const hEnd = useHolidays(yearOfISO(end));
  const holidaySet = useMemo(
    () => new Set([...(hStart.data ?? []), ...(hEnd.data ?? [])].map((h) => h.date)),
    [hStart.data, hEnd.data],
  );

  const submit = async () => {
    if (!profile?.id) return toast.error("No profile found for your account");
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
        employee_id: profile.id,
        date,
        leave_code: code,
        note: note || null,
        status: "pending",
        requested_by: profile.id,
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
    toast.success(`Request submitted — ${rows.length} working day${rows.length > 1 ? "s" : ""}`);
    setOpen(false);
    setNote("");
    void qc.invalidateQueries({ queryKey: ["entries", new Date().getFullYear()] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button>Request leave</Button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request leave</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
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
            <Label>Reason (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
