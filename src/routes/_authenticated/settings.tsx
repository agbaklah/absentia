import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { LEAVE_TYPES } from "@/lib/leave";
import { useHolidays, useTeams } from "@/lib/data";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { useQueryClient } from "@tanstack/react-query";
import { fmtISO } from "@/lib/leave";
import { CalendarDays, ArrowRightLeft, Plus, Save, Settings2, Tags, Trash2, Users } from "lucide-react";
import { processYearEndCarryover } from "@/lib/year-end-carryover";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { loading: authLoading, isManagement } = useAuth();
  const [defAllow, setDefAllow] = useState(21);
  const [carryCap, setCarryCap] = useState(5);
  const [maxAbs, setMaxAbs] = useState(3);
  const [sickTh, setSickTh] = useState(8);
  const [saving, setSaving] = useState(false);
  const year = new Date().getFullYear();
  const hols = useHolidays(year);
  const teams = useTeams();
  const qc = useQueryClient();
  const [holName, setHolName] = useState("");
  const [holDate, setHolDate] = useState(fmtISO(new Date()));
  const [adding, setAdding] = useState(false);
  const [carryoverBusy, setCarryoverBusy] = useState(false);
  const nextYear = year + 1;

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
      })
      .eq("key", "default");
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
  };

  if (authLoading) return null;
  if (!isManagement) return <Navigate to="/dashboard" />;

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
        <div className="mt-4">
          <Button onClick={save} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Card>

      <Card className="card-dense p-5">
        <div className="mb-4 flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-emerald-700" />
          <div className="text-sm font-medium">Year-End Carryover</div>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Process carryover from {year} to {nextYear}. For each active employee,
          remaining vacation days are calculated and capped at the carryover limit
          ({carryCap} days). This creates or updates {nextYear} allowance records.
        </p>
        <Button
          variant="outline"
          className="gap-2"
          disabled={carryoverBusy}
          onClick={async () => {
            setCarryoverBusy(true);
            try {
              const result = await processYearEndCarryover({
                data: { targetYear: nextYear },
              });
              if (result?.error) {
                toast.error(result.error);
              } else {
                toast.success(
                  `Carryover processed: ${result?.processed} employees, ${result?.capped} capped at ${result?.carryoverCap} days.`
                );
                void qc.invalidateQueries({ queryKey: ["allowances", nextYear] });
              }
            } catch (e) {
              toast.error("Carryover failed: " + String(e));
            } finally {
              setCarryoverBusy(false);
            }
          }}
        >
          <ArrowRightLeft className="h-4 w-4" />
          {carryoverBusy ? "Processing…" : `Process ${year} → ${nextYear} Carryover`}
        </Button>
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

        <Card className="card-dense p-5">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-emerald-700" />
            <div className="text-sm font-medium">Public holidays — {year}</div>
          </div>
          <ul className="divide-y">
            {(hols.data ?? []).map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="tabular font-medium">{h.date}</span>
                  <span className="text-muted-foreground">{h.name}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-destructive hover:text-destructive"
                  onClick={async () => {
                    const { error } = await supabase.from("public_holidays").delete().eq("id", h.id);
                    if (error) return toast.error(error.message);
                    toast.success(`Removed ${h.name}`);
                    void qc.invalidateQueries({ queryKey: ["holidays", year] });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
            {(hols.data ?? []).length === 0 && (
              <li className="py-4 text-sm text-muted-foreground">
                No public holidays recorded for {year}.
              </li>
            )}
          </ul>
          <div className="mt-3 flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={holDate}
                onChange={(e) => setHolDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Holiday name</Label>
              <Input
                value={holName}
                onChange={(e) => setHolName(e.target.value)}
                placeholder="e.g. Independence Day"
                className="h-8 text-xs"
              />
            </div>
            <Button
              size="sm"
              className="h-8 gap-1"
              disabled={adding || !holName || !holDate}
              onClick={async () => {
                setAdding(true);
                const { error } = await supabase.from("public_holidays").insert({
                  date: holDate,
                  name: holName,
                });
                setAdding(false);
                if (error) return toast.error(error.message);
                toast.success(`${holName} added`);
                setHolName("");
                void qc.invalidateQueries({ queryKey: ["holidays", year] });
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
