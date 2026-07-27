import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEntries, useEmployees, useTeams } from "@/lib/data";
import { LEAVE_TYPES, LEAVE_MAP, fmtISO } from "@/lib/leave";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/requests")({
  component: RequestsPage,
});

function RequestsPage() {
  const year = new Date().getFullYear();
  const { profile } = useAuth();
  const entries = useEntries(year);
  const employees = useEmployees();
  const teams = useTeams();
  const qc = useQueryClient();

  const pending = useMemo(
    () => (entries.data ?? []).filter((e) => e.status === "pending").sort((a, b) => a.date.localeCompare(b.date)),
    [entries.data],
  );

  const decide = async (ids: string[], status: "approved" | "rejected") => {
    const { error } = await supabase
      .from("leave_entries")
      .update({ status, approved_by: profile?.id ?? null, approved_at: new Date().toISOString() })
      .in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(status === "approved" ? "Approved" : "Rejected");
    void qc.invalidateQueries({ queryKey: ["entries", year] });
  };

  // Group pending by employee + contiguous range
  const grouped = useMemo(() => {
    const byEmp = new Map<string, typeof pending>();
    for (const p of pending) {
      if (!byEmp.has(p.employee_id)) byEmp.set(p.employee_id, []);
      byEmp.get(p.employee_id)!.push(p);
    }
    return Array.from(byEmp.entries());
  }, [pending]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leave requests</h1>
          <p className="text-sm text-muted-foreground">Submit a request, or approve pending ones.</p>
        </div>
        <NewRequestDialog />
      </div>

      <Card className="p-4">
        <div className="mb-3 text-sm font-medium">Pending approvals ({pending.length})</div>
        {grouped.length === 0 && <div className="text-sm text-muted-foreground">Nothing to approve.</div>}
        <div className="space-y-3">
          {grouped.map(([empId, items]) => {
            const emp = (employees.data ?? []).find((e) => e.id === empId);
            const team = (teams.data ?? []).find((t) => t.id === emp?.team_id);
            const ids = items.map((i) => i.id);
            const dates = items.map((i) => i.date).sort();
            return (
              <div key={empId} className="flex flex-wrap items-center justify-between gap-3 border rounded-md p-3">
                <div className="min-w-0">
                  <div className="font-medium">{emp?.full_name}</div>
                  <div className="text-xs text-muted-foreground">{team?.name}</div>
                  <div className="mt-1 text-xs">
                    {dates[0]} → {dates[dates.length - 1]} · {items.length} day{items.length > 1 ? "s" : ""}
                    <span className="ml-2 inline-flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: LEAVE_MAP[items[0].leave_code as keyof typeof LEAVE_MAP]?.colour }} />
                      {LEAVE_MAP[items[0].leave_code as keyof typeof LEAVE_MAP]?.label}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => decide(ids, "rejected")}>Reject</Button>
                  <Button size="sm" onClick={() => decide(ids, "approved")}>Approve</Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 text-sm font-medium">Recent activity</div>
        <div className="divide-y">
          {(entries.data ?? []).slice(-20).reverse().map((e) => {
            const emp = (employees.data ?? []).find((x) => x.id === e.employee_id);
            return (
              <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                <div>{emp?.full_name} · {e.date} · <b>{e.leave_code}</b></div>
                <Badge variant={e.status === "approved" ? "default" : e.status === "pending" ? "secondary" : "destructive"}>{e.status}</Badge>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function NewRequestDialog() {
  const [open, setOpen] = useState(false);
  const [empId, setEmpId] = useState("");
  const [code, setCode] = useState("L");
  const [start, setStart] = useState(fmtISO(new Date()));
  const [end, setEnd] = useState(fmtISO(new Date()));
  const [note, setNote] = useState("");
  const { profile } = useAuth();
  const employees = useEmployees();
  const qc = useQueryClient();

  const submit = async () => {
    const s = new Date(start);
    const e = new Date(end);
    if (e < s) return toast.error("End date is before start date");
    const requester = profile?.id ?? null;
    const target = empId || profile?.id;
    if (!target) return toast.error("Choose an employee");
    const rows: { employee_id: string; date: string; leave_code: string; note: string | null; status: "pending"; requested_by: string | null }[] = [];
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      rows.push({ employee_id: target, date: fmtISO(d), leave_code: code, note: note || null, status: "pending", requested_by: requester });
    }
    const { error } = await supabase.from("leave_entries").upsert(rows, { onConflict: "employee_id,date" });
    if (error) return toast.error(error.message);
    toast.success("Request submitted");
    setOpen(false);
    void qc.invalidateQueries({ queryKey: ["entries", new Date().getFullYear()] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>New request</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New leave request</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Employee</Label>
            <Select value={empId} onValueChange={setEmpId}>
              <SelectTrigger><SelectValue placeholder={profile?.full_name ?? "Choose"} /></SelectTrigger>
              <SelectContent>
                {(employees.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Leave type</Label>
            <Select value={code} onValueChange={setCode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.filter((t) => t.category !== "holiday").map((t) => (
                  <SelectItem key={t.code} value={t.code}>{t.code} — {t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div><Label>End</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <div><Label>Reason (optional)</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={submit}>Submit</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}