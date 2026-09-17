import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useEmployees } from "@/lib/data";

type ExclusionRow = { approver_id: string; employee_id: string; reason: string | null };

/**
 * Approval exclusions: an approver (admin/manager) who must not see or act on
 * a particular employee's leave. Super admins manage these.
 */
export function ExclusionCard() {
  const { profile, isSuperAdmin } = useAuth();
  const employees = useEmployees();
  const qc = useQueryClient();
  const [approver, setApprover] = useState("");
  const [employee, setEmployee] = useState("");
  const [reason, setReason] = useState("");
  const rows = useQuery({
    queryKey: ["exclusions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("approval_exclusions").select("*");
      if (error) throw error;
      return (data ?? []) as ExclusionRow[];
    },
  });
  const names = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e.full_name])),
    [employees.data],
  );
  const approvers = (employees.data ?? []).filter((e) =>
    ["admin", "manager", "super_admin"].includes(e.role),
  );

  if (!isSuperAdmin) return null;

  const add = async () => {
    if (!approver || !employee) return toast.error("Choose an approver and an employee");
    if (approver === employee) return toast.error("Choose two different people");
    const { error } = await supabase.from("approval_exclusions").insert({
      approver_id: approver,
      employee_id: employee,
      reason: reason.trim() || null,
      created_by: profile?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success(`${names.get(approver)} will no longer see ${names.get(employee)}'s leave`);
    setEmployee("");
    setReason("");
    void qc.invalidateQueries({ queryKey: ["exclusions"] });
  };

  const remove = async (r: ExclusionRow) => {
    const { error } = await supabase
      .from("approval_exclusions")
      .delete()
      .eq("approver_id", r.approver_id)
      .eq("employee_id", r.employee_id);
    if (error) return toast.error(error.message);
    void qc.invalidateQueries({ queryKey: ["exclusions"] });
  };

  return (
    <Card className="card-dense p-5">
      <div className="mb-3 flex items-center gap-2">
        <EyeOff className="h-4 w-4 text-emerald-700" />
        <div className="text-sm font-medium">Approval exclusions</div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Stop a specific approver from seeing, approving or being notified about a specific
        employee's leave (e.g. peers of equal seniority). Super admins are never excluded.
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label className="text-xs">Approver</Label>
          <Select value={approver} onValueChange={setApprover}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Admin / manager" />
            </SelectTrigger>
            <SelectContent>
              {approvers.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Must not handle</Label>
          <Select value={employee} onValueChange={setEmployee}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Employee" />
            </SelectTrigger>
            <SelectContent>
              {(employees.data ?? [])
                .filter((e) => e.id !== approver)
                .map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Reason (optional)</Label>
          <Input className="h-9" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <Button size="sm" className="h-9" onClick={add}>
          Add
        </Button>
      </div>
      <ul className="mt-3 divide-y text-sm">
        {(rows.data ?? []).map((r) => (
          <li
            key={r.approver_id + r.employee_id}
            className="flex items-center justify-between py-2"
          >
            <span>
              <b>{names.get(r.approver_id) ?? "?"}</b> ↛ {names.get(r.employee_id) ?? "?"}
              {r.reason && <span className="ml-2 text-xs text-muted-foreground">{r.reason}</span>}
            </span>
            <Button variant="ghost" size="sm" className="h-7" onClick={() => remove(r)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
        {(rows.data ?? []).length === 0 && (
          <li className="py-3 text-xs text-muted-foreground">No exclusions.</li>
        )}
      </ul>
    </Card>
  );
}
