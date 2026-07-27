import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEmployees, useEntries, useTeams, useHolidays, type EntryRow } from "@/lib/data";
import { LEAVE_TYPES, LEAVE_MAP, MONTHS, MONTHS_SHORT, WEEKDAY_SHORT, daysInMonth, fmtISO, isWeekend } from "@/lib/leave";
import { X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarPage,
});

function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const teams = useTeams();
  const employees = useEmployees();
  const entries = useEntries(year);
  const hols = useHolidays(year);
  const qc = useQueryClient();

  const days = daysInMonth(year, month);

  const entryMap = useMemo(() => {
    const m = new Map<string, EntryRow>();
    for (const e of entries.data ?? []) m.set(`${e.employee_id}|${e.date}`, e);
    return m;
  }, [entries.data]);

  const holSet = useMemo(() => new Set((hols.data ?? []).map((h) => h.date)), [hols.data]);

  const employeesByTeam = useMemo(() => {
    const map = new Map<string, typeof employees.data>();
    for (const t of teams.data ?? []) map.set(t.id, []);
    for (const e of employees.data ?? []) {
      if (!e.team_id) continue;
      map.get(e.team_id)?.push(e);
    }
    return map;
  }, [teams.data, employees.data]);

  const setCode = async (employeeId: string, date: string, code: string | null) => {
    if (code === null) {
      const { error } = await supabase.from("leave_entries").delete().eq("employee_id", employeeId).eq("date", date);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("leave_entries")
        .upsert({ employee_id: employeeId, date, leave_code: code, status: "approved" }, { onConflict: "employee_id,date" });
      if (error) return toast.error(error.message);
    }
    void qc.invalidateQueries({ queryKey: ["entries", year] });
  };

  const empTotals = (empId: string) => {
    const t = { absence: 0, vacation: 0, sick: 0, other: 0, wfh: 0 };
    for (let d = 1; d <= days; d++) {
      const iso = fmtISO(new Date(year, month, d));
      const ent = entryMap.get(`${empId}|${iso}`);
      if (!ent || ent.status !== "approved") continue;
      const lt = LEAVE_MAP[ent.leave_code as keyof typeof LEAVE_MAP];
      if (!lt || lt.category === "holiday") continue;
      t.absence += lt.days;
      if (lt.category === "vacation") t.vacation += lt.days;
      else if (lt.category === "sick") t.sick += lt.days;
      else if (lt.category === "wfh") t.wfh += lt.days;
      else t.other += lt.days;
    }
    return t;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Monthly calendar</h1>
          <p className="text-sm text-muted-foreground">Click a cell to set a leave code. Weekends and bank holidays are shaded.</p>
        </div>
        <div className="flex gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {MONTHS.map((m, i) => (
          <Button key={m} variant={i === month ? "default" : "outline"} size="sm" onClick={() => setMonth(i)}>
            {MONTHS_SHORT[i]}
          </Button>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-20 bg-background">
              <tr>
                <th className="sticky left-0 z-30 bg-background border-b border-r px-3 py-2 text-left font-medium min-w-[180px]">Employee</th>
                {Array.from({ length: days }, (_, i) => {
                  const d = new Date(year, month, i + 1);
                  const wknd = isWeekend(d);
                  const iso = fmtISO(d);
                  const hol = holSet.has(iso);
                  return (
                    <th key={i} className={`border-b px-1 py-2 text-center font-medium w-8 ${wknd || hol ? "bg-muted/60 text-muted-foreground" : ""}`}>
                      <div>{i + 1}</div>
                      <div className="text-[10px] font-normal text-muted-foreground">{WEEKDAY_SHORT[d.getDay()]}</div>
                    </th>
                  );
                })}
                <th className="border-b border-l bg-background px-2 py-2 text-center">Abs</th>
                <th className="border-b bg-background px-2 py-2 text-center">Vac</th>
                <th className="border-b bg-background px-2 py-2 text-center">Sick</th>
                <th className="border-b bg-background px-2 py-2 text-center">Other</th>
                <th className="border-b bg-background px-2 py-2 text-center">WFH</th>
              </tr>
            </thead>
            <tbody>
              {(teams.data ?? []).map((team) => {
                const teamEmps = employeesByTeam.get(team.id) ?? [];
                const mgr = (employees.data ?? []).find((e) => e.id === team.manager_id);
                return (
                  <>
                    <tr key={`t-${team.id}`} className="bg-muted/40">
                      <td className="sticky left-0 z-10 bg-muted/40 border-b border-r px-3 py-1.5 font-semibold">
                        {team.name}
                        {mgr && <span className="ml-2 text-[11px] font-normal text-muted-foreground">Manager: {mgr.full_name}</span>}
                      </td>
                      <td colSpan={days + 5} className="border-b" />
                    </tr>
                    {teamEmps.map((emp) => {
                      const t = empTotals(emp.id);
                      return (
                        <tr key={emp.id} className="hover:bg-muted/20">
                          <td className="sticky left-0 z-10 bg-background border-b border-r px-3 py-1.5 min-w-[180px]">{emp.full_name}</td>
                          {Array.from({ length: days }, (_, i) => {
                            const d = new Date(year, month, i + 1);
                            const iso = fmtISO(d);
                            const wknd = isWeekend(d);
                            const hol = holSet.has(iso);
                            const ent = entryMap.get(`${emp.id}|${iso}`);
                            const lt = ent ? LEAVE_MAP[ent.leave_code as keyof typeof LEAVE_MAP] : null;
                            const readonly = wknd || hol;
                            return (
                              <td key={i} className={`border-b border-l/0 p-0 ${readonly && !ent ? "bg-muted/50" : ""}`}>
                                <CellPopover
                                  disabled={false}
                                  onSelect={(code) => setCode(emp.id, iso, code)}
                                >
                                  <button
                                    className={`w-8 h-8 text-[10px] font-semibold flex items-center justify-center cursor-pointer ${lt ? "text-white" : "text-muted-foreground"}`}
                                    style={lt ? { background: lt.colour } : undefined}
                                    title={lt?.label ?? (hol ? "Bank holiday" : wknd ? "Weekend" : "Set leave")}
                                  >
                                    {ent?.leave_code ?? (hol ? "B" : "")}
                                  </button>
                                </CellPopover>
                              </td>
                            );
                          })}
                          <td className="border-b border-l bg-background px-2 text-center font-medium">{t.absence.toFixed(1)}</td>
                          <td className="border-b bg-background px-2 text-center">{t.vacation.toFixed(1)}</td>
                          <td className="border-b bg-background px-2 text-center">{t.sick.toFixed(1)}</td>
                          <td className="border-b bg-background px-2 text-center">{t.other.toFixed(1)}</td>
                          <td className="border-b bg-background px-2 text-center">{t.wfh.toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Legend</div>
        <div className="flex flex-wrap gap-2">
          {LEAVE_TYPES.map((t) => (
            <div key={t.code} className="inline-flex items-center gap-2 text-xs">
              <span className="inline-flex h-5 w-6 items-center justify-center rounded text-white font-semibold" style={{ background: t.colour }}>{t.code}</span>
              {t.label}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function CellPopover({ children, onSelect, disabled }: { children: React.ReactNode; onSelect: (code: string | null) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  if (disabled) return <>{children}</>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56 p-2">
        <div className="text-xs font-medium mb-2">Set leave code</div>
        <div className="grid grid-cols-4 gap-1">
          {LEAVE_TYPES.map((t) => (
            <button
              key={t.code}
              className="h-8 rounded text-[11px] font-semibold text-white hover:opacity-90"
              style={{ background: t.colour }}
              onClick={() => { onSelect(t.code); setOpen(false); }}
              title={t.label}
            >
              {t.code}
            </button>
          ))}
        </div>
        <button
          className="mt-2 w-full inline-flex items-center justify-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
          onClick={() => { onSelect(null); setOpen(false); }}
        >
          <X className="h-3 w-3" /> Clear
        </button>
      </PopoverContent>
    </Popover>
  );
}