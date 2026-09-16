import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, Download, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useHolidays, useSettings } from "@/lib/data";
import { importPublicHolidays } from "@/lib/import-holidays";
import { fmtDayShort } from "@/lib/leave";

/** Public holidays for a year, with one-click import from Nager.Date. */
export function HolidayImportCard() {
  const qc = useQueryClient();
  const settings = useSettings();
  const [year, setYear] = useState(new Date().getFullYear());
  const [country, setCountry] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const hols = useHolidays(year);
  const region = country ?? settings.data?.holiday_region ?? "GH";

  const run = async () => {
    setBusy(true);
    try {
      const r = await importPublicHolidays({
        data: { year, country: region, replaceOtherRegions: replace },
      });
      if (!r.ok) toast.error(r.error);
      else toast.success(`Imported ${r.imported} public holidays for ${region} ${year}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["holidays", year] });
    }
  };

  const addManual = async () => {
    if (!newDate || !newName.trim()) return toast.error("Date and name required");
    const { error } = await supabase
      .from("public_holidays")
      .upsert({ date: newDate, name: newName.trim(), region }, { onConflict: "date,region" });
    if (error) return toast.error(error.message);
    setNewName("");
    setNewDate("");
    void qc.invalidateQueries({ queryKey: ["holidays", year] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("public_holidays").delete().eq("id", id);
    if (error) return toast.error(error.message);
    void qc.invalidateQueries({ queryKey: ["holidays", year] });
  };

  return (
    <Card className="card-dense p-5">
      <div className="mb-3 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-emerald-700" />
        <div className="text-sm font-medium">Public holidays</div>
        <Input
          type="number"
          className="ml-auto h-8 w-24"
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || year)}
        />
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-3">
        <div className="space-y-1">
          <Label className="text-xs">Country (ISO code)</Label>
          <Input
            className="h-8 w-20 uppercase"
            maxLength={2}
            value={region}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-xs">
          <Checkbox checked={replace} onCheckedChange={(v) => setReplace(v === true)} />
          Replace other regions' holidays for {year}
        </label>
        <Button size="sm" className="h-8" onClick={run} disabled={busy}>
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Import {region} {year}
        </Button>
      </div>
      <ul className="max-h-64 divide-y overflow-y-auto">
        {(hols.data ?? []).map((h) => (
          <li key={h.id} className="flex items-center justify-between py-1.5 text-sm">
            <span className="tabular text-muted-foreground">{fmtDayShort(h.date)}</span>
            <span className="mx-3 flex-1 truncate">{h.name}</span>
            <span className="mr-2 text-[10px] uppercase text-muted-foreground">{h.region}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => remove(h.id)}
              aria-label="Remove"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </li>
        ))}
        {(hols.data ?? []).length === 0 && (
          <li className="py-3 text-xs text-muted-foreground">
            No public holidays recorded for {year}.
          </li>
        )}
      </ul>
      <div className="mt-3 flex items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Add manually</Label>
          <Input
            type="date"
            className="h-8"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
        </div>
        <Input
          className="h-8 flex-1"
          placeholder="Holiday name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button size="sm" variant="outline" className="h-8" onClick={addManual}>
          Add
        </Button>
      </div>
    </Card>
  );
}
