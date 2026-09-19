import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { LEAVE_TYPES } from "@/lib/leave";
import { useTeams } from "@/lib/data";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { PolicyCard } from "@/components/settings/PolicyCard";
import { BlackoutCard } from "@/components/settings/BlackoutCard";
import { RolloverCard } from "@/components/settings/RolloverCard";
import { HolidayImportCard } from "@/components/settings/HolidayImportCard";
import { ChecklistTemplateCard } from "@/components/settings/ChecklistTemplateCard";
import { CustomFieldsCard } from "@/components/settings/CustomFieldsCard";
import { ExclusionCard } from "@/components/settings/ExclusionCard";
import { Save, Settings2, Tags, Users, Wallet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { loading: authLoading, isAdmin } = useAuth();
  const [defAllow, setDefAllow] = useState(21);
  const [carryCap, setCarryCap] = useState(5);
  const [maxAbs, setMaxAbs] = useState(3);
  const [sickTh, setSickTh] = useState(8);
  const [companyName, setCompanyName] = useState("");
  const [currency, setCurrency] = useState("GHS");
  const [pettyLimit, setPettyLimit] = useState(5000);
  const [saving, setSaving] = useState(false);
  const teams = useTeams();
  const qc = useQueryClient();

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("*")
        .eq("key", "default")
        .maybeSingle();
      if (data) {
        setDefAllow(Number(data.default_allowance_days));
        setCarryCap(Number(data.carryover_cap_days));
        setMaxAbs(Number(data.max_concurrent_absent));
        setSickTh(Number(data.sick_threshold_days));
        setCompanyName(data.company_name ?? "");
        setCurrency(data.currency ?? "GHS");
        setPettyLimit(Number(data.petty_cash_limit ?? 0));
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .update({
        default_allowance_days: defAllow,
        carryover_cap_days: carryCap,
        max_concurrent_absent: maxAbs,
        sick_threshold_days: sickTh,
        company_name: companyName.trim() || "Verve Energy Resources",
        currency: currency.trim().toUpperCase() || "GHS",
        petty_cash_limit: pettyLimit,
      })
      .eq("key", "default");
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
    void qc.invalidateQueries({ queryKey: ["settings"] });
  };

  if (authLoading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Organisation-wide leave policy." />

      <Card className="card-dense p-5">
        <div className="mb-4 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-emerald-700" />
          <div className="text-sm font-medium">Policy</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Default annual allowance (days)</Label>
            <Input type="number" value={defAllow} onChange={(e) => setDefAllow(+e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Carryover cap (days)</Label>
            <Input type="number" value={carryCap} onChange={(e) => setCarryCap(+e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Max concurrent absent (per team)</Label>
            <Input type="number" value={maxAbs} onChange={(e) => setMaxAbs(+e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Sick threshold (days)</Label>
            <Input type="number" value={sickTh} onChange={(e) => setSickTh(+e.target.value)} />
          </div>
        </div>
        <div className="mt-5 mb-3 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-emerald-700" />
          <div className="text-sm font-medium">Organisation & petty cash</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Company name</Label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Currency code</Label>
            <Input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Petty cash limit per claim (0 = none)</Label>
            <Input
              type="number"
              min={0}
              value={pettyLimit}
              onChange={(e) => setPettyLimit(+e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={save} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Card>

      <Card className="card-dense p-5">
        <div className="mb-3 flex items-center gap-2">
          <Tags className="h-4 w-4 text-emerald-700" />
          <div className="text-sm font-medium">Leave types</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {LEAVE_TYPES.map((t) => (
            <div
              key={t.code}
              className="inline-flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-xs transition-colors hover:bg-muted/40"
            >
              <span
                className="inline-flex h-5 w-6 items-center justify-center rounded text-white font-semibold"
                style={{ background: t.colour }}
              >
                {t.code}
              </span>
              <span>{t.label}</span>
              <span className="tabular text-muted-foreground">· {t.days}d</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="card-dense p-5">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-700" />
            <div className="text-sm font-medium">Teams</div>
          </div>
          <ul className="divide-y">
            {(teams.data ?? []).map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                <span>{t.name}</span>
              </li>
            ))}
            {(teams.data ?? []).length === 0 && (
              <li className="py-4 text-sm text-muted-foreground">No teams configured yet.</li>
            )}
          </ul>
        </Card>

        <HolidayImportCard />
      </div>

      <PolicyCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <BlackoutCard />
        <RolloverCard />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChecklistTemplateCard />
        <CustomFieldsCard />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ExclusionCard />
      </div>
    </div>
  );
}
