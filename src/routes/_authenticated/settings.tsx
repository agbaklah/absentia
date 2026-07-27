import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { LEAVE_TYPES } from "@/lib/leave";
import { useHolidays, useTeams } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [defAllow, setDefAllow] = useState(24);
  const [carryCap, setCarryCap] = useState(5);
  const [maxAbs, setMaxAbs] = useState(3);
  const [sickTh, setSickTh] = useState(8);
  const year = new Date().getFullYear();
  const hols = useHolidays(year);
  const teams = useTeams();

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("app_settings").select("*").eq("key", "default").maybeSingle();
      if (data) {
        setDefAllow(Number(data.default_allowance_days));
        setCarryCap(Number(data.carryover_cap_days));
        setMaxAbs(Number(data.max_concurrent_absent));
        setSickTh(Number(data.sick_threshold_days));
      }
    })();
  }, []);

  const save = async () => {
    const { error } = await supabase.from("app_settings").update({
      default_allowance_days: defAllow,
      carryover_cap_days: carryCap,
      max_concurrent_absent: maxAbs,
      sick_threshold_days: sickTh,
    }).eq("key", "default");
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Organisation-wide leave policy.</p>
      </div>

      <Card className="p-4 space-y-4">
        <div className="text-sm font-medium">Policy</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label>Default annual allowance (days)</Label><Input type="number" value={defAllow} onChange={(e) => setDefAllow(+e.target.value)} /></div>
          <div><Label>Carryover cap (days)</Label><Input type="number" value={carryCap} onChange={(e) => setCarryCap(+e.target.value)} /></div>
          <div><Label>Max concurrent absent (per team)</Label><Input type="number" value={maxAbs} onChange={(e) => setMaxAbs(+e.target.value)} /></div>
          <div><Label>Sick threshold (days)</Label><Input type="number" value={sickTh} onChange={(e) => setSickTh(+e.target.value)} /></div>
        </div>
        <div><Button onClick={save}>Save changes</Button></div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 text-sm font-medium">Leave types</div>
        <div className="flex flex-wrap gap-2">
          {LEAVE_TYPES.map((t) => (
            <div key={t.code} className="inline-flex items-center gap-2 rounded border px-2 py-1 text-xs">
              <span className="inline-flex h-5 w-6 items-center justify-center rounded text-white font-semibold" style={{ background: t.colour }}>{t.code}</span>
              <span>{t.label}</span>
              <span className="text-muted-foreground">· {t.days}d</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 text-sm font-medium">Teams</div>
        <ul className="divide-y">
          {(teams.data ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2 text-sm"><span>{t.name}</span></li>
          ))}
        </ul>
      </Card>

      <Card className="p-4">
        <div className="mb-3 text-sm font-medium">Public holidays — {year}</div>
        <ul className="divide-y">
          {(hols.data ?? []).map((h) => (
            <li key={h.id} className="flex items-center justify-between py-2 text-sm">
              <span>{h.date}</span>
              <span className="text-muted-foreground">{h.name}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}