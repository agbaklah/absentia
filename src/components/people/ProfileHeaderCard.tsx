import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Briefcase, Mail, MapPin, Pencil, Phone, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { InitialsAvatar } from "@/components/InitialsAvatar";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth-context";
import { useFieldDefinitions, useTeams, type EmployeeRow } from "@/lib/data";
import { EMPLOYMENT_TYPE_LABEL, tenure } from "@/lib/people";
import { fmtDayFull } from "@/lib/leave";

const roleLabel: Record<string, string> = {
  employee: "Employee",
  manager: "Manager",
  admin: "Admin",
  super_admin: "Super Admin",
  cfo: "CFO",
};

/** Name, title, team, contact + the "Edit" dialog (admins edit everything, employees their contact). */
export function ProfileHeaderCard({ employee, self }: { employee: EmployeeRow; self: boolean }) {
  const { isAdmin } = useAuth();
  const teams = useTeams();
  const fields = useFieldDefinitions();
  const [open, setOpen] = useState(false);
  const team = (teams.data ?? []).find((t) => t.id === employee.team_id);
  const canEdit = isAdmin || self;
  const visibleFields = (fields.data ?? []).filter(
    (f) =>
      f.visible_to === "everyone" ||
      (f.visible_to === "employee" && (self || isAdmin)) ||
      (f.visible_to === "management" && isAdmin),
  );

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-4">
        <InitialsAvatar name={employee.full_name} className="h-16 w-16 text-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl font-semibold">{employee.full_name}</h2>
            <Badge variant={employee.role === "employee" ? "secondary" : "default"}>
              {roleLabel[employee.role] ?? employee.role}
            </Badge>
            {!employee.active && <Badge variant="destructive">Archived</Badge>}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {employee.job_title ?? "No job title"} ·{" "}
            {EMPLOYMENT_TYPE_LABEL[employee.employment_type]}
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <Row icon={Users} label="Team" value={team?.name ?? "Unassigned"} />
            <Row icon={Mail} label="Email" value={employee.email} />
            <Row icon={Phone} label="Phone" value={employee.phone ?? "—"} />
            <Row icon={MapPin} label="Location" value={employee.location ?? "—"} />
            <Row
              icon={Briefcase}
              label="Started"
              value={`${fmtDayFull(employee.employment_start_date)} · ${tenure(employee.employment_start_date)}`}
            />
            {visibleFields.map((f) => (
              <Row
                key={f.key}
                label={f.label}
                value={String(employee.custom_fields?.[f.key] ?? "—")}
              />
            ))}
          </dl>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </div>
      {open && (
        <EditProfileDialog
          employee={employee}
          self={self && !isAdmin}
          onClose={() => setOpen(false)}
        />
      )}
    </Card>
  );
}

function Row({ icon: Icon, label, value }: { icon?: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      {Icon ? (
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <span className="w-3.5" />
      )}
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-medium">{value}</dd>
    </div>
  );
}

function EditProfileDialog({
  employee,
  self,
  onClose,
}: {
  employee: EmployeeRow;
  self: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const teams = useTeams();
  const fields = useFieldDefinitions();
  const [f, setF] = useState({
    full_name: employee.full_name,
    phone: employee.phone ?? "",
    location: employee.location ?? "",
    job_title: employee.job_title ?? "",
    team_id: employee.team_id ?? "",
    employment_type: employee.employment_type,
    employment_start_date: employee.employment_start_date,
    custom_fields: { ...(employee.custom_fields ?? {}) } as Record<string, unknown>,
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!f.full_name.trim()) return toast.error("Name is required");
    setBusy(true);
    const patch = self
      ? {
          full_name: f.full_name.trim(),
          phone: f.phone.trim() || null,
          location: f.location.trim() || null,
        }
      : {
          full_name: f.full_name.trim(),
          phone: f.phone.trim() || null,
          location: f.location.trim() || null,
          job_title: f.job_title.trim() || null,
          team_id: f.team_id || null,
          employment_type: f.employment_type,
          employment_start_date: f.employment_start_date,
          custom_fields: f.custom_fields as Json,
        };
    const { error } = await supabase.from("profiles").update(patch).eq("id", employee.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
    void qc.invalidateQueries({ queryKey: ["employees"] });
    void qc.invalidateQueries({ queryKey: ["profiles-all"] });
    void qc.invalidateQueries({ queryKey: ["history", employee.id] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {self ? "my details" : employee.full_name}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Full name</Label>
            <Input value={f.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input
              value={f.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+233 …"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Location</Label>
            <Input
              value={f.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="Accra"
            />
          </div>
          {!self && (
            <>
              <div className="col-span-2 space-y-1.5">
                <Label>Job title</Label>
                <Input value={f.job_title} onChange={(e) => set("job_title", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Team</Label>
                <Select
                  value={f.team_id || "none"}
                  onValueChange={(v) => set("team_id", v === "none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {(teams.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Employment type</Label>
                <Select
                  value={f.employment_type}
                  onValueChange={(v) => set("employment_type", v as typeof f.employment_type)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input
                  type="date"
                  value={f.employment_start_date}
                  onChange={(e) => set("employment_start_date", e.target.value)}
                />
              </div>
              {(fields.data ?? []).map((d) => (
                <div key={d.key} className="space-y-1.5">
                  <Label>{d.label}</Label>
                  {d.field_type === "select" ? (
                    <Select
                      value={String(f.custom_fields[d.key] ?? "")}
                      onValueChange={(v) =>
                        set("custom_fields", { ...f.custom_fields, [d.key]: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {(d.options ?? []).map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type={
                        d.field_type === "number"
                          ? "number"
                          : d.field_type === "date"
                            ? "date"
                            : "text"
                      }
                      value={String(f.custom_fields[d.key] ?? "")}
                      onChange={(e) =>
                        set("custom_fields", { ...f.custom_fields, [d.key]: e.target.value })
                      }
                    />
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
