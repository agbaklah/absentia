import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardCheck, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import type { Json } from "@/integrations/supabase/types";
import { useChecklistTemplates, type TemplateItem, type TemplateRow } from "@/lib/data";

const ASSIGNEES: { code: TemplateItem["assignee"]; label: string }[] = [
  { code: "employee", label: "The employee" },
  { code: "manager", label: "Their manager" },
  { code: "admin", label: "HR / admin" },
  { code: "cfo", label: "CFO" },
];

type Draft = {
  id?: string;
  name: string;
  kind: "onboarding" | "offboarding";
  is_default: boolean;
  items: TemplateItem[];
};

/** Onboarding / offboarding templates. Each item resolves to a real assignee when started. */
export function ChecklistTemplateCard() {
  const templates = useChecklistTemplates();
  const [draft, setDraft] = useState<Draft | null>(null);

  return (
    <Card className="card-dense p-5">
      <div className="mb-3 flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-emerald-700" />
        <div className="text-sm font-medium">Onboarding & offboarding templates</div>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-8"
          onClick={() => setDraft({ name: "", kind: "onboarding", is_default: false, items: [] })}
        >
          <Plus className="h-3.5 w-3.5" />
          New template
        </Button>
      </div>
      <ul className="divide-y">
        {(templates.data ?? []).map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium">
                {t.name}
                <Badge variant="outline" className="capitalize text-[10px]">
                  {t.kind}
                </Badge>
                {t.is_default && (
                  <Badge variant="secondary" className="text-[10px]">
                    Default
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{t.items.length} tasks</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => setDraft({ ...t, items: [...t.items] })}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </li>
        ))}
      </ul>
      {draft && (
        <TemplateDialog key={draft.id ?? "new"} draft={draft} onClose={() => setDraft(null)} />
      )}
    </Card>
  );
}

function TemplateDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const setItem = (i: number, patch: Partial<TemplateItem>) =>
    setD((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  const save = async () => {
    if (!d.name.trim()) return toast.error("Name the template");
    const items = d.items.filter((it) => it.title.trim());
    if (items.length === 0) return toast.error("Add at least one task");
    setBusy(true);
    if (d.is_default) {
      await supabase
        .from("checklist_templates")
        .update({ is_default: false })
        .eq("kind", d.kind)
        .eq("is_default", true);
    }
    const payload = {
      name: d.name.trim(),
      kind: d.kind,
      is_default: d.is_default,
      items: items as unknown as Json,
    };
    const { error } = d.id
      ? await supabase.from("checklist_templates").update(payload).eq("id", d.id)
      : await supabase.from("checklist_templates").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Template saved");
    void qc.invalidateQueries({ queryKey: ["checklist-templates"] });
    onClose();
  };

  const remove = async () => {
    if (!d.id) return;
    const { error } = await supabase.from("checklist_templates").delete().eq("id", d.id);
    if (error) return toast.error(error.message);
    void qc.invalidateQueries({ queryKey: ["checklist-templates"] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{d.id ? "Edit template" : "New template"}</DialogTitle>
          <DialogDescription>
            Due days are counted from the start date (onboarding) or end date (offboarding).
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_auto_auto] items-end gap-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <Select value={d.kind} onValueChange={(v) => setD({ ...d, kind: v as Draft["kind"] })}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="onboarding">Onboarding</SelectItem>
                <SelectItem value="offboarding">Offboarding</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Switch checked={d.is_default} onCheckedChange={(v) => setD({ ...d, is_default: v })} />{" "}
            Default
          </label>
        </div>
        <div className="space-y-2">
          {d.items.map((it, i) => (
            <div key={i} className="grid grid-cols-[auto_1fr_10rem_5rem_auto] items-center gap-2">
              <GripVertical className="h-4 w-4 text-muted-foreground/50" />
              <Input
                className="h-9"
                value={it.title}
                onChange={(e) => setItem(i, { title: e.target.value })}
                placeholder="Task"
              />
              <Select
                value={it.assignee}
                onValueChange={(v) => setItem(i, { assignee: v as TemplateItem["assignee"] })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNEES.map((a) => (
                    <SelectItem key={a.code} value={a.code}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-9"
                type="number"
                min={0}
                value={it.due_days}
                onChange={(e) => setItem(i, { due_days: Number(e.target.value) || 0 })}
                title="Due (days)"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => setD({ ...d, items: d.items.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setD({ ...d, items: [...d.items, { title: "", assignee: "employee", due_days: 0 }] })
            }
          >
            <Plus className="h-3.5 w-3.5" /> Add task
          </Button>
        </div>
        <DialogFooter className="gap-2">
          {d.id && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={remove}
              disabled={busy}
            >
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
