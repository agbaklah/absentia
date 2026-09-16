import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { type ChecklistRow, type TaskRow } from "@/lib/data";
import { checklistProgress, daysUntil } from "@/lib/people";
import { fmtDayShort, fmtISO } from "@/lib/leave";
import { cn } from "@/lib/utils";

/** One onboarding/offboarding checklist with tickable tasks. */
export function ChecklistCard({
  checklist,
  tasks,
  names,
  personName,
  onStart,
}: {
  checklist: ChecklistRow;
  tasks: TaskRow[];
  names: Map<string, string>;
  personName?: string;
  onStart?: () => void;
}) {
  const { profile, isAdmin } = useAuth();
  const qc = useQueryClient();
  const today = fmtISO(new Date());
  const progress = checklistProgress(tasks);

  const toggle = async (t: TaskRow, done: boolean) => {
    const { data, error } = await supabase
      .from("checklist_tasks")
      .update({ done_at: done ? new Date().toISOString() : null })
      .eq("id", t.id)
      .select("id");
    if (error) return toast.error(error.message);
    if (!data?.length) return toast.error("Only the assignee or an admin can tick this task.");
    void qc.invalidateQueries({ queryKey: ["checklists"] });
  };

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-emerald-700" />
        <div className="text-sm font-medium capitalize">
          {checklist.kind}
          {personName ? ` · ${personName}` : ""}
        </div>
        <Badge
          variant={checklist.completed_at ? "default" : "secondary"}
          className="ml-auto tabular"
        >
          {progress.done}/{progress.total}
        </Badge>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-emerald-600 transition-all"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
      <ul className="space-y-1.5">
        {tasks.map((t) => {
          const due = daysUntil(t.due_date, today);
          const mine = t.assignee_id === profile?.id;
          return (
            <li key={t.id} className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={!!t.done_at}
                disabled={!(mine || isAdmin)}
                onCheckedChange={(v) => toggle(t, v === true)}
              />
              <div className="min-w-0 flex-1">
                <div
                  className={cn("leading-tight", t.done_at && "text-muted-foreground line-through")}
                >
                  {t.title}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t.assignee_id ? (names.get(t.assignee_id) ?? "—") : "Unassigned"}
                  {t.due_date && (
                    <>
                      {" · "}
                      <span
                        className={cn(
                          !t.done_at && due !== null && due < 0 && "font-medium text-red-600",
                        )}
                      >
                        due {fmtDayShort(t.due_date)}
                        {!t.done_at && due !== null && due < 0 ? ` (${-due}d overdue)` : ""}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {onStart && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onStart}>
          Start checklist
        </Button>
      )}
    </Card>
  );
}
