import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, Trash2 } from "lucide-react";
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
import { useDelegations, useEmployees } from "@/lib/data";
import { addDaysISO, fmtDayShort, fmtISO } from "@/lib/leave";

/**
 * "While I'm away, X approves for me." Managers/admins delegate their own
 * approvals; admins can also see and remove anyone's delegation.
 */
export function DelegationCard() {
  const { profile, isAdmin, isManagement } = useAuth();
  const employees = useEmployees();
  const delegations = useDelegations();
  const qc = useQueryClient();
  const [delegate, setDelegate] = useState("");
  const [start, setStart] = useState(fmtISO(new Date()));
  const [end, setEnd] = useState(addDaysISO(fmtISO(new Date()), 7));
  const [busy, setBusy] = useState(false);
  const today = fmtISO(new Date());

  const names = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e.full_name])),
    [employees.data],
  );
  const visible = useMemo(
    () =>
      (delegations.data ?? []).filter(
        (d) => d.end_date >= today && (isAdmin || d.delegator_id === profile?.id),
      ),
    [delegations.data, isAdmin, profile?.id, today],
  );

  if (!isManagement) return null;

  const add = async () => {
    if (!profile || !delegate) return toast.error("Choose who approves on your behalf");
    if (end < start) return toast.error("End date is before start date");
    setBusy(true);
    const { error } = await supabase.from("approval_delegations").insert({
      delegator_id: profile.id,
      delegate_id: delegate,
      start_date: start,
      end_date: end,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${names.get(delegate)} can approve for you until ${fmtDayShort(end)}`);
    setDelegate("");
    void qc.invalidateQueries({ queryKey: ["delegations"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("approval_delegations").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Delegation removed");
    void qc.invalidateQueries({ queryKey: ["delegations"] });
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <ArrowRightLeft className="h-4 w-4 text-emerald-700" />
        Approval delegation
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Going on leave yourself? Delegate your approvals so requests don't wait.
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <div className="space-y-1">
          <Label className="text-xs">Delegate to</Label>
          <Select value={delegate} onValueChange={setDelegate}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Choose a colleague" />
            </SelectTrigger>
            <SelectContent>
              {(employees.data ?? [])
                .filter((e) => e.id !== profile?.id)
                .map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            className="h-9"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" className="h-9" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <Button size="sm" className="h-9" onClick={add} disabled={busy}>
          Delegate
        </Button>
      </div>
      {visible.length > 0 && (
        <ul className="mt-3 divide-y text-sm">
          {visible.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2">
              <span>
                <b>{names.get(d.delegator_id) ?? "?"}</b> → {names.get(d.delegate_id) ?? "?"}
                <span className="ml-2 text-xs text-muted-foreground">
                  {fmtDayShort(d.start_date)} → {fmtDayShort(d.end_date)}
                </span>
              </span>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => remove(d.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
