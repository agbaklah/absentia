import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileCheck2, Pencil, Plus, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { usePolicies, type PolicyRow } from "@/lib/data";

type PolicyForm = Omit<PolicyRow, "id">;

const blank: PolicyForm = {
  name: "",
  description: null,
  accrual_method: "annual",
  annual_days: 24,
  sick_days: 5,
  carryover_cap_days: 5,
  waiting_period_days: 0,
  min_notice_days: 0,
  max_consecutive_days: null,
  allow_negative_balance: false,
  is_default: false,
};

/** Leave policies: accrual, notice, waiting period, caps. Admin-only card. */
export function PolicyCard() {
  const policies = usePolicies();
  const [editing, setEditing] = useState<PolicyRow | PolicyForm | null>(null);

  return (
    <Card className="card-dense p-5">
      <div className="mb-3 flex items-center gap-2">
        <FileCheck2 className="h-4 w-4 text-emerald-700" />
        <div className="text-sm font-medium">Leave policies</div>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-8"
          onClick={() => setEditing({ ...blank })}
        >
          <Plus className="h-3.5 w-3.5" />
          New policy
        </Button>
      </div>
      <ul className="divide-y">
        {(policies.data ?? []).map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium">
                {p.name}
                {p.is_default && (
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <Star className="h-3 w-3" /> Default
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {p.annual_days}d/yr ·{" "}
                {p.accrual_method === "monthly" ? "accrues monthly" : "available 1 Jan"} · carry
                over ≤{p.carryover_cap_days}d · {p.sick_days}d sick
                {p.min_notice_days > 0 && ` · ${p.min_notice_days}d notice`}
                {p.waiting_period_days > 0 && ` · ${p.waiting_period_days}d waiting`}
                {p.max_consecutive_days && ` · max ${p.max_consecutive_days}d/request`}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0"
              onClick={() => setEditing(p)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          </li>
        ))}
        {(policies.data ?? []).length === 0 && (
          <li className="py-4 text-sm text-muted-foreground">No policies yet.</li>
        )}
      </ul>
      {editing && (
        <PolicyDialog
          key={"id" in editing ? editing.id : "new"}
          policy={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function PolicyDialog({
  policy,
  onClose,
}: {
  policy: PolicyRow | PolicyForm;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PolicyForm>(() => ({ ...blank, ...policy }));
  const [busy, setBusy] = useState(false);
  const id = "id" in policy ? policy.id : null;

  const set = <K extends keyof PolicyForm>(k: K, v: PolicyForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  const save = async () => {
    if (!form.name.trim()) return toast.error("Give the policy a name");
    setBusy(true);
    const payload = {
      ...form,
      name: form.name.trim(),
      description: form.description?.trim() || null,
    };
    // Only one default: clear the flag elsewhere first.
    if (payload.is_default) {
      await supabase.from("leave_policies").update({ is_default: false }).eq("is_default", true);
    }
    const { error } = id
      ? await supabase.from("leave_policies").update(payload).eq("id", id)
      : await supabase.from("leave_policies").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(id ? "Policy updated" : "Policy created");
    void qc.invalidateQueries({ queryKey: ["policies"] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{id ? "Edit policy" : "New leave policy"}</DialogTitle>
          <DialogDescription>
            Rules are enforced when employees request leave; managers can override with a warning.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Senior staff"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea
              rows={2}
              value={form.description ?? ""}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Vacation days / year</Label>
              <Input
                type="number"
                step="0.5"
                min={0}
                value={form.annual_days}
                onChange={(e) => set("annual_days", num(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Accrual</Label>
              <Select
                value={form.accrual_method}
                onValueChange={(v) => set("accrual_method", v as "annual" | "monthly")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">All available from 1 January</SelectItem>
                  <SelectItem value="monthly">Accrues 1/12 each month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Sick days / year</Label>
              <Input
                type="number"
                step="0.5"
                min={0}
                value={form.sick_days}
                onChange={(e) => set("sick_days", num(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Carry-over cap (days)</Label>
              <Input
                type="number"
                step="0.5"
                min={0}
                value={form.carryover_cap_days}
                onChange={(e) => set("carryover_cap_days", num(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Waiting period (days from start)</Label>
              <Input
                type="number"
                min={0}
                value={form.waiting_period_days}
                onChange={(e) => set("waiting_period_days", num(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Minimum notice (days)</Label>
              <Input
                type="number"
                min={0}
                value={form.min_notice_days}
                onChange={(e) => set("min_notice_days", num(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Max days per request (blank = none)</Label>
              <Input
                type="number"
                min={1}
                value={form.max_consecutive_days ?? ""}
                onChange={(e) =>
                  set("max_consecutive_days", e.target.value === "" ? null : Number(e.target.value))
                }
              />
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>
              Allow requests beyond the accrued balance
              <span className="block text-xs text-muted-foreground">
                Shown as a warning instead of blocked.
              </span>
            </span>
            <Switch
              checked={form.allow_negative_balance}
              onCheckedChange={(v) => set("allow_negative_balance", v)}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>
              Default policy
              <span className="block text-xs text-muted-foreground">
                Applies to employees without an explicit policy.
              </span>
            </span>
            <Switch checked={form.is_default} onCheckedChange={(v) => set("is_default", v)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
