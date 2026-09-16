import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, Landmark, Pencil, ShieldCheck, Smartphone } from "lucide-react";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { usePrivateRecord, type PrivateRow } from "@/lib/data";
import { ID_TYPE_LABEL, MOMO_LABEL, maskNumber, yearsSince } from "@/lib/people";
import { fmtDayFull } from "@/lib/leave";

type Form = Omit<PrivateRow, "profile_id" | "updated_at" | "updated_by">;
const empty: Form = {
  date_of_birth: null,
  gender: null,
  address: null,
  personal_email: null,
  emergency_name: null,
  emergency_phone: null,
  emergency_relationship: null,
  national_id_type: null,
  national_id_number: null,
  ssnit_number: null,
  tin: null,
  bank_name: null,
  bank_branch: null,
  bank_account_name: null,
  bank_account_number: null,
  momo_network: null,
  momo_number: null,
  momo_name: null,
};

/**
 * Personal, ID and payout details. Only the owner and admins can open this
 * (the table's RLS returns nothing to anyone else); sensitive numbers are
 * masked until revealed.
 */
export function PrivateRecordCard({ profileId, self }: { profileId: string; self: boolean }) {
  const { isAdmin } = useAuth();
  const rec = usePrivateRecord(profileId);
  const [reveal, setReveal] = useState(false);
  const [open, setOpen] = useState(false);
  const r = rec.data;
  const canEdit = isAdmin || self;
  const show = (v: string | null | undefined) => (reveal ? (v ?? "—") : maskNumber(v));

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-700" />
        <div className="text-sm font-medium">Personal & payout details</div>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setReveal((v) => !v)}>
            {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {reveal ? "Hide" : "Reveal"}
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => setOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>
      </div>
      {rec.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <Group title="Personal">
            <Item
              label="Date of birth"
              value={
                r?.date_of_birth
                  ? `${fmtDayFull(r.date_of_birth)} (${yearsSince(r.date_of_birth)})`
                  : "—"
              }
            />
            <Item
              label="Gender"
              value={r?.gender?.replace(/_/g, " ") ?? "—"}
              className="capitalize"
            />
            <Item label="Address" value={r?.address ?? "—"} />
            <Item label="Personal email" value={r?.personal_email ?? "—"} />
          </Group>
          <Group title="Emergency contact">
            <Item label="Name" value={r?.emergency_name ?? "—"} />
            <Item label="Phone" value={r?.emergency_phone ?? "—"} />
            <Item label="Relationship" value={r?.emergency_relationship ?? "—"} />
          </Group>
          <Group title="Identification">
            <Item
              label={r?.national_id_type ? ID_TYPE_LABEL[r.national_id_type] : "ID number"}
              value={show(r?.national_id_number)}
            />
            <Item label="SSNIT" value={show(r?.ssnit_number)} />
            <Item label="TIN" value={show(r?.tin)} />
          </Group>
          <Group title="Reimbursement payout">
            <Item
              label={
                <span className="inline-flex items-center gap-1">
                  <Smartphone className="h-3 w-3" /> Mobile money
                </span>
              }
              value={
                r?.momo_number
                  ? `${MOMO_LABEL[r.momo_network ?? ""] ?? ""} ${show(r.momo_number)}${r.momo_name ? ` (${r.momo_name})` : ""}`
                  : "—"
              }
            />
            <Item
              label={
                <span className="inline-flex items-center gap-1">
                  <Landmark className="h-3 w-3" /> Bank
                </span>
              }
              value={
                r?.bank_account_number
                  ? `${r.bank_name ?? ""} ${r.bank_branch ? `· ${r.bank_branch} ` : ""}· ${show(r.bank_account_number)}${r.bank_account_name ? ` (${r.bank_account_name})` : ""}`
                  : "—"
              }
            />
          </Group>
        </div>
      )}
      {open && (
        <PrivateDialog profileId={profileId} initial={r ?? null} onClose={() => setOpen(false)} />
      )}
    </Card>
  );
}

function TextField({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        className="h-9"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <dl className="space-y-1.5">{children}</dl>
    </div>
  );
}
function Item({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`truncate text-right font-medium ${className ?? ""}`}>{value}</dd>
    </div>
  );
}

function PrivateDialog({
  profileId,
  initial,
  onClose,
}: {
  profileId: string;
  initial: PrivateRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>({ ...empty, ...(initial ?? {}) });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: string) =>
    setF((x) => ({ ...x, [k]: v === "" ? null : v }));
  // Plain function (not a component) so the element type stays TextField and
  // inputs keep focus between keystrokes.
  const tf = (k: keyof Form, label: string, type = "text", placeholder?: string) => (
    <TextField
      label={label}
      type={type}
      placeholder={placeholder}
      value={f[k] ?? ""}
      onChange={(v) => set(k, v)}
    />
  );

  const save = async () => {
    setBusy(true);
    const { error } = await supabase
      .from("employee_private")
      .upsert({ profile_id: profileId, ...f }, { onConflict: "profile_id" });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Details saved");
    void qc.invalidateQueries({ queryKey: ["private", profileId] });
    void qc.invalidateQueries({ queryKey: ["payout", profileId] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Personal & payout details</DialogTitle>
          <DialogDescription>
            Visible only to you and HR admins; payout fields also to the CFO. Every change is
            audited.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {tf("date_of_birth", "Date of birth", "date")}
          <div className="space-y-1">
            <Label className="text-xs">Gender</Label>
            <Select
              value={f.gender ?? "unset"}
              onValueChange={(v) => set("gender", v === "unset" ? "" : v)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">—</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="other">Other</SelectItem>
                <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">{tf("address", "Home address")}</div>
          <div className="col-span-2">{tf("personal_email", "Personal email", "email")}</div>
          <div className="col-span-2 mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Emergency contact
          </div>
          {tf("emergency_name", "Name")}
          {tf("emergency_phone", "Phone")}
          <div className="col-span-2">
            {tf("emergency_relationship", "Relationship", "text", "Spouse, parent…")}
          </div>
          <div className="col-span-2 mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Identification
          </div>
          <div className="space-y-1">
            <Label className="text-xs">ID type</Label>
            <Select
              value={f.national_id_type ?? "unset"}
              onValueChange={(v) => set("national_id_type", v === "unset" ? "" : v)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">—</SelectItem>
                {Object.entries(ID_TYPE_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {tf("national_id_number", "ID number", "text", "GHA-XXXXXXXXX-X")}
          {tf("ssnit_number", "SSNIT number")}
          {tf("tin", "TIN")}
          <div className="col-span-2 mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Mobile money (for reimbursements)
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Network</Label>
            <Select
              value={f.momo_network ?? "unset"}
              onValueChange={(v) => set("momo_network", v === "unset" ? "" : v)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">—</SelectItem>
                {Object.entries(MOMO_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {tf("momo_number", "MoMo number")}
          <div className="col-span-2">{tf("momo_name", "Registered name")}</div>
          <div className="col-span-2 mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Bank account
          </div>
          {tf("bank_name", "Bank")}
          {tf("bank_branch", "Branch")}
          {tf("bank_account_name", "Account name")}
          {tf("bank_account_number", "Account number")}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save details"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
