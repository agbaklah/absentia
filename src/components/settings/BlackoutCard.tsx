import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Trash2 } from "lucide-react";
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
import { useBlackouts, useTeams } from "@/lib/data";
import { addDaysISO, fmtDayShort, fmtISO } from "@/lib/leave";

/** Blackout periods: dates when vacation can't be requested (org-wide or per team). */
export function BlackoutCard() {
  const { profile } = useAuth();
  const teams = useTeams();
  const blackouts = useBlackouts();
  const qc = useQueryClient();
  const [team, setTeam] = useState("all");
  const [start, setStart] = useState(fmtISO(new Date()));
  const [end, setEnd] = useState(addDaysISO(fmtISO(new Date()), 6));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const today = fmtISO(new Date());

  const add = async () => {
    if (!reason.trim()) return toast.error("Give the blackout a reason (shown to employees)");
    if (end < start) return toast.error("End date is before start date");
    setBusy(true);
    const { error } = await supabase.from("blackout_periods").insert({
      team_id: team === "all" ? null : team,
      start_date: start,
      end_date: end,
      reason: reason.trim(),
      created_by: profile?.id ?? null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Blackout period added");
    setReason("");
    void qc.invalidateQueries({ queryKey: ["blackouts"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("blackout_periods").delete().eq("id", id);
    if (error) return toast.error(error.message);
    void qc.invalidateQueries({ queryKey: ["blackouts"] });
  };

  const upcoming = (blackouts.data ?? []).filter((b) => b.end_date >= today);

  return (
    <Card className="card-dense p-5">
      <div className="mb-3 flex items-center gap-2">
        <Ban className="h-4 w-4 text-emerald-700" />
        <div className="text-sm font-medium">Blackout periods</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-1">
          <Label className="text-xs">Reason</Label>
          <Input
            className="h-9"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Year-end stock count"
          />
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
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Applies to</Label>
          <Select value={team} onValueChange={setTeam}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Whole organisation</SelectItem>
              {(teams.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="h-9" onClick={add} disabled={busy}>
          Add blackout
        </Button>
      </div>
      <ul className="mt-3 divide-y text-sm">
        {upcoming.map((b) => (
          <li key={b.id} className="flex items-center justify-between py-2">
            <div>
              <div className="font-medium">{b.reason}</div>
              <div className="text-xs text-muted-foreground">
                {fmtDayShort(b.start_date)} → {fmtDayShort(b.end_date)} ·{" "}
                {b.team_id
                  ? (teams.data ?? []).find((t) => t.id === b.team_id)?.name
                  : "Whole organisation"}
              </div>
            </div>
            <Button variant="ghost" size="sm" className="h-7" onClick={() => remove(b.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
        {upcoming.length === 0 && (
          <li className="py-3 text-xs text-muted-foreground">No upcoming blackout periods.</li>
        )}
      </ul>
    </Card>
  );
}
