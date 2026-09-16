import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GitCommitHorizontal, Plus } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useEmploymentHistory, useTeams } from "@/lib/data";
import { CHANGE_KIND_LABEL, EMPLOYMENT_TYPE_LABEL } from "@/lib/people";
import { fmtDayShort, fmtISO } from "@/lib/leave";
import { cn } from "@/lib/utils";

/** Job history timeline — auto-tracked on changes; admins can add notes (promotions etc). */
export function HistoryCard({ profileId }: { profileId: string }) {
  const { isAdmin } = useAuth();
  const history = useEmploymentHistory(profileId);
  const teams = useTeams();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    effective_date: fmtISO(new Date()),
    change_kind: "promotion",
    job_title: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    const { error } = await supabase.from("employment_history").insert({
      profile_id: profileId,
      effective_date: f.effective_date,
      change_kind: f.change_kind,
      job_title: f.job_title.trim() || null,
      note: f.note.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("History entry added");
    void qc.invalidateQueries({ queryKey: ["history", profileId] });
    setOpen(false);
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <GitCommitHorizontal className="h-4 w-4 text-emerald-700" />
        <div className="text-sm font-medium">Job history</div>
        {isAdmin && (
          <Button variant="outline" size="sm" className="ml-auto h-8" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add entry
          </Button>
        )}
      </div>
      <ol className="relative ml-2 border-l pl-4 text-sm">
        {(history.data ?? []).map((h) => (
          <li key={h.id} className="relative pb-4 last:pb-0">
            <span
              className={cn(
                "absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background",
                h.change_kind === "left"
                  ? "bg-red-500"
                  : h.change_kind === "hired"
                    ? "bg-emerald-600"
                    : "bg-primary",
              )}
            />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{CHANGE_KIND_LABEL[h.change_kind]}</span>
              <span className="text-xs text-muted-foreground">{fmtDayShort(h.effective_date)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {[
                h.job_title,
                h.team_id ? (teams.data ?? []).find((t) => t.id === h.team_id)?.name : null,
                h.employment_type ? EMPLOYMENT_TYPE_LABEL[h.employment_type] : null,
              ]
                .filter(Boolean)
                .join(" · ") || "—"}
              {h.note && <div className="italic">“{h.note}”</div>}
            </div>
          </li>
        ))}
        {(history.data ?? []).length === 0 && (
          <li className="text-xs text-muted-foreground">No history yet.</li>
        )}
      </ol>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add history entry</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={f.change_kind} onValueChange={(v) => setF({ ...f, change_kind: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CHANGE_KIND_LABEL).map(([k, l]) => (
                    <SelectItem key={k} value={k}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Effective date</Label>
              <Input
                type="date"
                value={f.effective_date}
                onChange={(e) => setF({ ...f, effective_date: e.target.value })}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>New job title (optional)</Label>
              <Input
                value={f.job_title}
                onChange={(e) => setF({ ...f, job_title: e.target.value })}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Note</Label>
              <Input
                value={f.note}
                onChange={(e) => setF({ ...f, note: e.target.value })}
                placeholder="e.g. Promoted after Q2 review"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={add} disabled={busy}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
