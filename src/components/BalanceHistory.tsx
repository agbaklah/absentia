import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useBalanceTransactions, useEmployees, usePolicies, type BalanceTxRow } from "@/lib/data";
import { fmtTimestamp } from "@/lib/leave";
import { cn } from "@/lib/utils";

const kindLabel: Record<BalanceTxRow["kind"], string> = {
  adjustment: "Adjustment",
  carryover: "Carried over",
  expiry: "Expired",
  allowance: "Allowance set",
};

/**
 * Employee's policy + balance movements (adjustments, carry-over, expiry).
 * Admins can assign a policy and add a manual adjustment with a reason.
 */
export function BalanceHistory({
  employeeId,
  policyId,
}: {
  employeeId: string;
  policyId: string | null;
}) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const tx = useBalanceTransactions(employeeId);
  const policies = usePolicies();
  const employees = useEmployees();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const names = new Map((employees.data ?? []).map((e) => [e.id, e.full_name]));
  const defaultPolicy = (policies.data ?? []).find((p) => p.is_default);

  const setPolicy = async (v: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({ policy_id: v === "default" ? null : v })
      .eq("id", employeeId);
    if (error) return toast.error(error.message);
    toast.success("Policy updated");
    void qc.invalidateQueries({ queryKey: ["employees"] });
  };

  const addAdjustment = async () => {
    const n = Number(days);
    if (!Number.isFinite(n) || n === 0) return toast.error("Enter a non-zero number of days");
    if (!note.trim()) return toast.error("A reason is required for the audit trail");
    setBusy(true);
    const { error } = await supabase.from("leave_balance_transactions").insert({
      employee_id: employeeId,
      year,
      kind: "adjustment",
      days: n,
      note: note.trim(),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${n > 0 ? "+" : ""}${n} day${Math.abs(n) === 1 ? "" : "s"} recorded`);
    setDays("");
    setNote("");
    setOpen(false);
    void qc.invalidateQueries({ queryKey: ["balance-tx", employeeId] });
    void qc.invalidateQueries({ queryKey: ["allowances"] });
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <History className="h-3.5 w-3.5" />
          Balance history
        </h3>
        {isAdmin && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)}>
            <Plus className="h-3 w-3" />
            Adjust
          </Button>
        )}
      </div>

      <div className="mb-2 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">Leave policy</span>
        {isAdmin ? (
          <Select value={policyId ?? "default"} onValueChange={setPolicy}>
            <SelectTrigger className="h-8 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default ({defaultPolicy?.name ?? "—"})</SelectItem>
              {(policies.data ?? [])
                .filter((p) => !p.is_default)
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="font-medium">
            {(policies.data ?? []).find((p) => p.id === policyId)?.name ??
              defaultPolicy?.name ??
              "Default"}
          </span>
        )}
      </div>

      {(tx.data ?? []).length === 0 ? (
        <p className="rounded-md border bg-muted/30 px-3 py-3 text-center text-xs text-muted-foreground">
          No adjustments or carry-overs recorded.
        </p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {(tx.data ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate">
                  <span className="font-medium">{kindLabel[t.kind]}</span>
                  <span className="text-xs text-muted-foreground"> · {t.year}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {t.note}
                  {t.created_by && ` — ${names.get(t.created_by) ?? "system"}`}
                  {" · "}
                  {fmtTimestamp(t.created_at)}
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 font-medium tabular",
                  t.days > 0 ? "text-emerald-700" : "text-red-600",
                )}
              >
                {t.days > 0 ? "+" : ""}
                {t.days}d
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust vacation balance</DialogTitle>
            <DialogDescription>
              Adds or removes days for a year. Use a negative number to deduct. The reason is kept
              in the balance history.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Days (± e.g. 2 or -1.5)</Label>
              <Input
                inputMode="decimal"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="2"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value) || year)}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Reason</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Worked the Eid holiday"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={addAdjustment} disabled={busy}>
              {busy ? "Saving…" : "Record adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
