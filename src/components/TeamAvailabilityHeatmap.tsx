import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import {
  useEmployees,
  useEntries,
  useTeams,
  useHolidays,
  type EmployeeRow,
  type EntryRow,
} from "@/lib/data";
import {
  LEAVE_MAP,
  LEAVE_TYPES,
  MONTHS_SHORT,
  WEEKDAY_SHORT,
  daysInMonth,
  fmtISO,
  isWeekend,
} from "@/lib/leave";
import { cn } from "@/lib/utils";

export function TeamAvailabilityHeatmap({
  year,
  month,
  teamId,
}: {
  year: number;
  month: number;
  teamId: string;
}) {
  const teams = useTeams();
  const employees = useEmployees();
  const entries = useEntries(year);
  const hols = useHolidays(year);

  const days = daysInMonth(year, month);

  const holSet = useMemo(
    () => new Set((hols.data ?? []).map((h) => h.date)),
    [hols.data],
  );

  const filteredEmployees = useMemo(() => {
    const list = employees.data ?? [];
    return teamId === "all" ? list : list.filter((e) => e.team_id === teamId);
  }, [employees.data, teamId]);

  const empIds = useMemo(
    () => new Set(filteredEmployees.map((e) => e.id)),
    [filteredEmployees],
  );

  const filteredEntries = useMemo(
    () =>
      (entries.data ?? []).filter(
        (e) => empIds.has(e.employee_id) && e.status !== "rejected",
      ),
    [entries.data, empIds],
  );

  // Map of "empId|date" -> entry
  const entryMap = useMemo(() => {
    const m = new Map<string, EntryRow>();
    for (const e of filteredEntries) m.set(`${e.employee_id}|${e.date}`, e);
    return m;
  }, [filteredEntries]);

  // Group employees by team
  const groupedByTeam = useMemo(() => {
    const map = new Map<string, EmployeeRow[]>();
    for (const t of teams.data ?? []) map.set(t.id, []);
    for (const emp of filteredEmployees) {
      const tid = emp.team_id ?? "none";
      if (!map.has(tid)) map.set(tid, []);
      map.get(tid)!.push(emp);
    }
    return Array.from(map.entries()).filter(([, emps]) => emps.length > 0);
  }, [teams.data, filteredEmployees]);

  // Current month label
  const monthLabel = `${MONTHS_SHORT[month]} ${year}`;

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              <th className="sticky left-0 z-20 bg-background border-b border-r px-2 py-1.5 text-left font-medium text-[11px] min-w-[140px]">
                {monthLabel}
              </th>
              {Array.from({ length: days }, (_, i) => {
                const d = new Date(year, month, i + 1);
                const iso = fmtISO(d);
                const wknd = isWeekend(d);
                const hol = holSet.has(iso);
                return (
                  <th
                    key={i}
                    className={cn(
                      "border-b px-0 py-1 text-center font-medium w-5",
                      wknd || hol
                        ? "bg-muted/60 text-muted-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <div className="text-[9px] leading-none">
                      {WEEKDAY_SHORT[d.getDay()]?.charAt(0)}
                    </div>
                    <div className="text-[10px] font-semibold leading-tight">
                      {i + 1}
                    </div>
                  </th>
                );
              })}
              <th className="border-b border-l bg-background px-1.5 py-1 text-center text-[10px] font-medium">
                Days
              </th>
            </tr>
          </thead>
          <tbody>
            {groupedByTeam.map(([teamId, emps]) => {
              const team = (teams.data ?? []).find((t) => t.id === teamId);
              return (
                <TeamBlock
                  key={teamId}
                  teamName={team?.name ?? "Unassigned"}
                  employees={emps}
                  year={year}
                  month={month}
                  days={days}
                  holSet={holSet}
                  entryMap={entryMap}
                />
              );
            })}
            {groupedByTeam.length === 0 && (
              <tr>
                <td
                  colSpan={days + 2}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  No employees to display.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2">
        {LEAVE_TYPES.filter((t) => t.category !== "holiday").map((t) => (
          <div key={t.code} className="inline-flex items-center gap-1">
            <span
              className="inline-flex h-3 w-4 items-center justify-center rounded text-[7px] font-bold text-white"
              style={{ background: t.colour }}
            >
              {t.code.charAt(0)}
            </span>
            <span className="text-[10px] text-muted-foreground">{t.label}</span>
          </div>
        ))}
        <div className="inline-flex items-center gap-1">
          <span className="inline-flex h-3 w-4 items-center justify-center rounded border border-dashed border-foreground/30 text-[8px] text-foreground/30">
            –
          </span>
          <span className="text-[10px] text-muted-foreground">
            Weekend / holiday
          </span>
        </div>
      </div>
    </Card>
  );
}

function TeamBlock({
  teamName,
  employees,
  year,
  month,
  days,
  holSet,
  entryMap,
}: {
  teamName: string;
  employees: EmployeeRow[];
  year: number;
  month: number;
  days: number;
  holSet: Set<string>;
  entryMap: Map<string, EntryRow>;
}) {
  return (
    <>
      <tr className="bg-muted/30">
        <td
          colSpan={days + 2}
          className="border-b border-r px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {teamName}
        </td>
      </tr>
      {employees.map((emp) => {
        let workDays = 0;
        return (
          <tr key={emp.id} className="hover:bg-muted/10">
            <td className="sticky left-0 z-10 bg-background border-b border-r px-2 py-0.5 text-[10px] font-medium truncate max-w-[140px]">
              {emp.full_name}
            </td>
            {Array.from({ length: days }, (_, i) => {
              const d = new Date(year, month, i + 1);
              const iso = fmtISO(d);
              const wknd = isWeekend(d);
              const hol = holSet.has(iso);
              const ent = entryMap.get(`${emp.id}|${iso}`);
              const lt = ent
                ? LEAVE_MAP[ent.leave_code as keyof typeof LEAVE_MAP]
                : null;
              const available = !wknd && !hol && !ent;
              if (available) workDays++;

              return (
                <td
                  key={i}
                  className={cn(
                    "border-b p-0",
                    (wknd || hol) && "bg-muted/40",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-4 w-5 items-center justify-center rounded-sm mx-auto",
                      lt
                        ? "text-white font-bold text-[8px]"
                        : wknd || hol
                          ? "text-muted-foreground/40"
                          : "bg-emerald-50 dark:bg-emerald-950/50",
                    )}
                    style={lt ? { background: lt.colour } : undefined}
                    title={
                      lt
                        ? `${emp.full_name}: ${lt.label}`
                        : available
                          ? `${emp.full_name}: Available`
                          : wknd
                            ? "Weekend"
                            : "Holiday"
                    }
                  >
                    {lt ? lt.code.charAt(0) : ""}
                  </div>
                </td>
              );
            })}
            <td className="border-b border-l px-1 py-0.5 text-center text-[10px] tabular font-medium text-muted-foreground">
              {workDays}
            </td>
          </tr>
        );
      })}
    </>
  );
}
