import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListPlus, Trash2 } from "lucide-react";
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
import { useFieldDefinitions, type FieldDef } from "@/lib/data";

/** Extra profile fields (e.g. staff number, blood group) shown on the record. */
export function CustomFieldsCard() {
  const defs = useFieldDefinitions();
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldDef["field_type"]>("text");
  const [options, setOptions] = useState("");
  const [visible, setVisible] = useState<FieldDef["visible_to"]>("management");

  const add = async () => {
    if (!label.trim()) return toast.error("Give the field a label");
    const key = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    if (!/^[a-z]/.test(key)) return toast.error("Label must start with a letter");
    const { error } = await supabase.from("profile_field_definitions").insert({
      key,
      label: label.trim(),
      field_type: type,
      options:
        type === "select"
          ? options
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          : null,
      visible_to: visible,
      position: (defs.data?.length ?? 0) + 1,
    });
    if (error) return toast.error(error.message);
    setLabel("");
    setOptions("");
    void qc.invalidateQueries({ queryKey: ["field-defs"] });
  };

  const remove = async (key: string) => {
    const { error } = await supabase.from("profile_field_definitions").delete().eq("key", key);
    if (error) return toast.error(error.message);
    void qc.invalidateQueries({ queryKey: ["field-defs"] });
  };

  return (
    <Card className="card-dense p-5">
      <div className="mb-3 flex items-center gap-2">
        <ListPlus className="h-4 w-4 text-emerald-700" />
        <div className="text-sm font-medium">Custom profile fields</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <div className="space-y-1">
          <Label className="text-xs">Label</Label>
          <Input
            className="h-9"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Staff number"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as FieldDef["field_type"])}>
            <SelectTrigger className="h-9 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="number">Number</SelectItem>
              <SelectItem value="date">Date</SelectItem>
              <SelectItem value="select">Choice</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Visible to</Label>
          <Select value={visible} onValueChange={(v) => setVisible(v as FieldDef["visible_to"])}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="management">Management</SelectItem>
              <SelectItem value="employee">Employee + mgmt</SelectItem>
              <SelectItem value="everyone">Everyone</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="h-9" onClick={add}>
          Add field
        </Button>
        {type === "select" && (
          <div className="space-y-1 sm:col-span-4">
            <Label className="text-xs">Choices (comma-separated)</Label>
            <Input
              className="h-9"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder="A+, A-, B+, …"
            />
          </div>
        )}
      </div>
      <ul className="mt-3 divide-y text-sm">
        {(defs.data ?? []).map((d) => (
          <li key={d.key} className="flex items-center justify-between py-2">
            <span>
              {d.label}{" "}
              <span className="text-xs text-muted-foreground">
                · {d.field_type} · {d.visible_to}
              </span>
            </span>
            <Button variant="ghost" size="sm" className="h-7" onClick={() => remove(d.key)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
        {(defs.data ?? []).length === 0 && (
          <li className="py-3 text-xs text-muted-foreground">No custom fields yet.</li>
        )}
      </ul>
    </Card>
  );
}
