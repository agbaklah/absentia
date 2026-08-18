import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEmployees,
  useEntries,
  useTeams,
  useHolidays,
  type EmployeeRow,
  type EntryRow,
} from "@/lib/data";
import {
  LEAVE_TYPES,
  LEAVE_MAP,
  MONTHS,
  MONTHS_SHORT,
  WEEKDAY_SHORT,
  daysInMonth,
  fmtISO,
  isWeekend,
  fmtDayFull,
} from "@/lib/leave";
import { ChevronLeft, ChevronRight, X, CalendarDays } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { InitialsAvatar } from "@/components/InitialsAvatar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarRoute,
});

/** The calendar is an org-wide view — management only. */
function CalendarRoute() {
  const { loading, isManagement } = useAuth();
  if (loading) return null;
  if (!isManagement) return <Navigate to="/dashboard" />;
  return <CalendarPage />;
}

function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [mobileDay, setMobileDay] = useState<string | null>(null);
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
    const map = new Map<string, EmployeeRow[]>();
    for (const t of teams.data ?? []) map.set(t.id, []);
    for (const e of employees.data ?? []) {
      if (!e.team_id) continue;
      map.get(e.team_id)?.push(e);
    }
    return map;
  }, [teams.data, employees.data]);

  // Per-day index of who is off: iso -> { emp, entry }[]
  const dayEntries = useMemo(() => {
    const empById = new Map((employees.data ?? []).map((e) => [e.id, e]));
    const m = new Map<string, { emp: EmployeeRow; entry: EntryRow }[]>();
    for (const e of entries.data ?? []) {
      const emp = empById.get(e.employee_id);
      if (!emp) continue;
      const arr = m.get(e.date) ?? [];
      arr.push({ emp, entry: e });
      m.set(e.date, arr);
    }
    return m;
  }, [entries.data, employees.data]);

  const setCode = async (employeeId: string, date: string, code: string | null) => {
    if (code === null) {
      const { error } = await supabase
        .from("leave_entries")
        .delete()
        .eq("employee_id", employeeId)
        .eq("date", date);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("leave_entries")
        .upsert(
          { employee_id: employeeId, date, leave_code: code, status: "approved" },
          { onConflict: "employee_id,date" },
        );
      if (error) return toast.error(error.message);
    }
    void qc.invalidateQueries({ queryKey: ["entries", year] });
  };

  const shiftMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
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

  const todayIso = fmtISO(new Date());

  return (
    <div className="space-y-4">
      <PageHeader
        title="Monthly calendar"
        description="Tap a day to see who's off and set leave codes. Weekends and holidays are shaded."
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </PageHeader>

      <div className="flex flex-wrap gap-1">
        {MONTHS.map((m, i) => (
          <Button
            key={m}
            variant={i === month ? "default" : "outline"}
            size="sm"
            onClick={() => setMonth(i)}
          >
            {MONTHS_SHORT[i]}
          </Button>
        ))}
      </div>

      {/* ------- Mobile: day-grid view ------- */}
      <div className="md:hidden">
        <MobileDayGrid
          year={year}
          month={month}
          days={days}
          holSet={holSet}
          todayIso={todayIso}
          dayEntries={dayEntries}
          onDayPress={(iso) => setMobileDay(iso)}
        />
      </div>

      {/* ------- Desktop: team-by-day table ------- */}
      <div className="hidden md:block">
        <ScrollTable
          year={year}
          month={month}
          days={days}
          holSet={holSet}
          todayIso={todayIso}
          entryMap={entryMap}
          teamsData={teams.data ?? []}
          employeesData={employees.data ?? []}
          employeesByTeam={employeesByTeam}
          empTotals={empTotals}
          setCode={setCode}
        />
      </div>

      <Card className="p-4">
        <div className="mb-2 text-sm font-medium">Legend</div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {LEAVE_TYPES.map((t) => (
            <div key={t.code} className="inline-flex items-center gap-1.5 text-xs">
              <span
                className="inline-flex h-5 w-6 items-center justify-center rounded text-white font-semibold"
                style={{ background: t.colour }}
              >
                {t.code}
              </span>
              {t.label}
            </div>
          ))}
          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex h-5 w-6 items-center justify-center rounded border border-dashed border-foreground/40 text-[10px] text-foreground/40">
              –
            </span>
            Weekend / holiday
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="relative inline-flex h-3 w-3 items-center justify-center">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
            </span>
            Pending approval
          </div>
        </div>
      </Card>

      <DayDetailDialog
        iso={mobileDay}
        onClose={() => setMobileDay(null)}
        dayEntries={dayEntries}
        teamsData={teams.data ?? []}
        employeesData={employees.data ?? []}
        setCode={setCode}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile: month grid of days, tap a day to open the day editor
// ---------------------------------------------------------------------------
function MobileDayGrid({
  year,
  month,
  days,
  holSet,
  todayIso,
  dayEntries,
  onDayPress,
}: {
  year: number;
  month: number;
  days: number;
  holSet: Set<string>;
  todayIso: string;
  dayEntries: Map<string, { emp: { full_name: string }; entry: EntryRow }[]>;
  onDayPress: (iso: string) => void;
}) {
  const firstDow = new Date(year, month, 1).getDay(); // 0 = Sunday

  return (
    <Card className="p-2">
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_SHORT.map((wd, i) => (
          <div
            key={wd}
            className={cn(
              "py-1 text-center text-[10px] font-medium text-muted-foreground",
              (i === 0 || i === 6) && "text-red-400",
            )}
          >
            {wd}
          </div>
        ))}
        {Array.from({ length: firstDow }, (_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const d = new Date(year, month, i + 1);
          const iso = fmtISO(d);
          const wknd = isWeekend(d);
          const hol = holSet.has(iso);
          const isToday = iso === todayIso;
          const people = dayEntries.get(iso) ?? [];
          // Rejected requests are not absences — don't show them as off.
          const off = people.filter((p) => p.entry.status !== "rejected");
          return (
            <button
              key={i}
              type="button"
              onClick={() => onDayPress(iso)}
              className={cn(
                "flex h-14 flex-col items-stretch rounded-md border p-1 text-left transition-colors",
                wknd || hol
                  ? "border-muted bg-muted/50"
                  : "border-border bg-card hover:bg-muted/40",
                isToday && "ring-2 ring-emerald-600",
              )}
              title={fmtDayFull(iso)}
            >
              <div
                className={cn(
                  "flex items-center justify-between px-0.5",
                  wknd || hol ? "text-muted-foreground" : "",
                )}
              >
                <span
                  className={cn("text-[11px] font-semibold", isToday ? "text-emerald-700" : "")}
                >
                  {i + 1}
                </span>
                {hol && <span className="text-[9px] text-muted-foreground">BH</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-0.5 overflow-hidden">
                {off.slice(0, 3).map((p) => {
                  const lt = LEAVE_MAP[p.entry.leave_code as keyof typeof LEAVE_MAP];
                  return (
                    <span
                      key={p.entry.id}
                      className="inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[9px] font-semibold text-white"
                      style={{ background: lt?.colour }}
                    >
                      {p.entry.leave_code}
                    </span>
                  );
                })}
                {off.length > 3 && (
                  <span className="inline-flex h-4 items-center rounded bg-muted px-1 text-[9px] font-medium text-muted-foreground">
                    +{off.length - 3}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Tap a day to see who's off and set leave codes.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Desktop: the full team-by-day table with horizontal scroll edge hints
// ---------------------------------------------------------------------------
function ScrollTable({
  year,
  month,
  days,
  holSet,
  todayIso,
  entryMap,
  teamsData,
  employeesData,
  employeesByTeam,
  empTotals,
  setCode,
}: {
  year: number;
  month: number;
  days: number;
  holSet: Set<string>;
  todayIso: string;
  entryMap: Map<string, EntryRow>;
  teamsData: { id: string; name: string; manager_id: string | null }[];
  employeesData: EmployeeRow[];
  employeesByTeam: Map<string, EmployeeRow[] | undefined>;
  empTotals: (empId: string) => {
    absence: number;
    vacation: number;
    sick: number;
    other: number;
    wfh: number;
  };
  setCode: (employeeId: string, date: string, code: string | null) => Promise<unknown>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateScrollHints = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  // Recompute when the table mounts or the month/year changes (scroll resets).
  useEffect(() => {
    updateScrollHints();
  }, [updateScrollHints, year, month]);

  return (
    <Card className="relative overflow-hidden">
      {/* Edge fade hints */}
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 z-40 w-8 bg-gradient-to-r from-card to-transparent transition-opacity",
          canLeft ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 z-40 w-8 bg-gradient-to-l from-card to-transparent transition-opacity",
          canRight ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
      <div ref={scrollRef} onScroll={updateScrollHints} className="overflow-auto max-h-[70vh]">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-20 bg-background">
            <tr>
              <th className="sticky left-0 z-30 bg-background border-b border-r px-3 py-2 text-left font-medium min-w-[180px]">
                Employee
              </th>
              {Array.from({ length: days }, (_, i) => {
                const d = new Date(year, month, i + 1);
                const wknd = isWeekend(d);
                const iso = fmtISO(d);
                const hol = holSet.has(iso);
                const isToday = iso === todayIso;
                return (
                  <th
                    key={i}
                    className={cn(
                      "border-b px-1 py-2 text-center font-medium w-9",
                      wknd || hol ? "bg-muted/60 text-muted-foreground" : "",
                      isToday && "text-emerald-700",
                    )}
                  >
                    <div
                      className={
                        isToday
                          ? "mx-auto flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white"
                          : ""
                      }
                    >
                      {i + 1}
                    </div>
                    <div className="text-[10px] font-normal text-muted-foreground">
                      {WEEKDAY_SHORT[d.getDay()]}
                    </div>
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
            {teamsData.map((team) => {
              const teamEmps = employeesByTeam.get(team.id) ?? [];
              const mgr = employeesData.find((e) => e.id === team.manager_id);
              return (
                <Fragment key={`t-${team.id}`}>
                  <tr className="bg-muted/40">
                    <td className="sticky left-0 z-10 bg-muted/40 border-b border-r px-3 py-1.5 font-semibold">
                      {team.name}
                      {mgr && (
                        <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                          Manager: {mgr.full_name}
                        </span>
                      )}
                    </td>
                    <td colSpan={days + 5} className="border-b" />
                  </tr>
                  {teamEmps.map((emp) => {
                    const t = empTotals(emp.id);
                    return (
                      <tr key={emp.id} className="hover:bg-muted/20">
                        <td className="sticky left-0 z-10 bg-background border-b border-r px-3 py-1.5 min-w-[180px]">
                          {emp.full_name}
                        </td>
                        {Array.from({ length: days }, (_, i) => {
                          const d = new Date(year, month, i + 1);
                          const iso = fmtISO(d);
                          const wknd = isWeekend(d);
                          const hol = holSet.has(iso);
                          const ent = entryMap.get(`${emp.id}|${iso}`);
                          // Rejected requests are not absences — render the day as empty.
                          const showLeave = !!ent && ent.status !== "rejected";
                          const lt = showLeave
                            ? LEAVE_MAP[ent.leave_code as keyof typeof LEAVE_MAP]
                            : null;
                          const readonly = wknd || hol;
                          return (
                            <td
                              key={i}
                              className={cn("border-b p-0", readonly && !ent && "bg-muted/50")}
                            >
                              <CellPopover
                                disabled={false}
                                onSelect={(code) => setCode(emp.id, iso, code)}
                              >
                                <button
                                  className={cn(
                                    "relative w-9 h-8 text-[10px] font-semibold flex items-center justify-center cursor-pointer",
                                    lt ? "text-white" : "text-muted-foreground",
                                  )}
                                  style={lt ? { background: lt.colour } : undefined}
                                  title={
                                    lt?.label ??
                                    (hol ? "Bank holiday" : wknd ? "Weekend" : "Set leave")
                                  }
                                >
                                  {showLeave ? ent.leave_code : hol ? "B" : ""}
                                  {showLeave && ent.status === "pending" && (
                                    <span
                                      className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-amber-400"
                                      title="Pending approval"
                                    />
                                  )}
                                </button>
                              </CellPopover>
                            </td>
                          );
                        })}
                        <td className="border-b border-l bg-background px-2 text-center font-medium tabular">
                          {t.absence.toFixed(1)}
                        </td>
                        <td className="border-b bg-background px-2 text-center tabular">
                          {t.vacation.toFixed(1)}
                        </td>
                        <td className="border-b bg-background px-2 text-center tabular">
                          {t.sick.toFixed(1)}
                        </td>
                        <td className="border-b bg-background px-2 text-center tabular">
                          {t.other.toFixed(1)}
                        </td>
                        <td className="border-b bg-background px-2 text-center tabular">
                          {t.wfh.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Day detail dialog (mobile): who's off that day + inline code editing
// ---------------------------------------------------------------------------
function DayDetailDialog({
  iso,
  onClose,
  dayEntries,
  teamsData,
  employeesData,
  setCode,
}: {
  iso: string | null;
  onClose: () => void;
  dayEntries: Map<string, { emp: EmployeeRow; entry: EntryRow }[]>;
  teamsData: { id: string; name: string }[];
  employeesData: EmployeeRow[];
  setCode: (employeeId: string, date: string, code: string | null) => Promise<unknown>;
}) {
  // Who's actually off that day — rejected requests are not absences.
  const people = useMemo(
    () => (iso ? (dayEntries.get(iso) ?? []).filter((p) => p.entry.status !== "rejected") : []),
    [iso, dayEntries],
  );

  // Group the people off today by team for a readable list.
  const grouped = useMemo(() => {
    const map = new Map<string, typeof people>();
    for (const p of people) {
      const tid = p.emp.team_id ?? "none";
      const arr = map.get(tid) ?? [];
      arr.push(p);
      map.set(tid, arr);
    }
    return map;
  }, [people]);

  // People with no entry that day (so managers can add leave from the dialog).
  const rest = useMemo(() => {
    if (!iso) return [];
    const withEntry = new Set(people.map((p) => p.emp.id));
    return employeesData.filter((e) => !withEntry.has(e.id));
  }, [iso, people, employeesData]);

  const onSelect = async (empId: string, code: string | null) => {
    if (!iso) return;
    await setCode(empId, iso, code);
  };

  return (
    <Dialog open={!!iso} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-emerald-700" />
            {iso ? fmtDayFull(iso) : ""}
          </DialogTitle>
          <DialogDescription>
            {people.length > 0
              ? `${people.length} ${people.length === 1 ? "person is" : "people are"} off — tap a name to change their code.`
              : "Nobody is off today. Tap a name below to add leave."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          {people.length > 0 && (
            <div className="space-y-3">
              {Array.from(grouped.entries()).map(([tid, list]) => {
                const team = teamsData.find((t) => t.id === tid);
                return (
                  <div key={tid}>
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                      {team?.name ?? "Unassigned"}
                    </div>
                    <div className="space-y-1">
                      {list.map((p) => {
                        const lt = LEAVE_MAP[p.entry.leave_code as keyof typeof LEAVE_MAP];
                        return (
                          <CellPopover
                            key={p.entry.id}
                            disabled={false}
                            onSelect={(code) => onSelect(p.emp.id, code)}
                          >
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/40"
                            >
                              <InitialsAvatar
                                name={p.emp.full_name}
                                className="h-7 w-7 text-[10px]"
                              />
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {p.emp.full_name}
                              </span>
                              {p.entry.status === "pending" && (
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
                                  title="Pending approval"
                                />
                              )}
                              <span
                                className="inline-flex h-5 min-w-6 items-center justify-center rounded px-1 text-[10px] font-semibold text-white"
                                style={{ background: lt?.colour }}
                              >
                                {p.entry.leave_code}
                              </span>
                            </button>
                          </CellPopover>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Quick-add for everyone else */}
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Everyone else</div>
            <div className="space-y-1">
              {rest.map((emp) => (
                <CellPopover
                  key={emp.id}
                  disabled={false}
                  onSelect={(code) => onSelect(emp.id, code)}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md border border-dashed bg-card/60 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/40"
                  >
                    <InitialsAvatar name={emp.full_name} className="h-7 w-7 text-[10px]" />
                    <span className="min-w-0 flex-1 truncate">{emp.full_name}</span>
                    <span className="text-[10px] text-muted-foreground">Set leave</span>
                  </button>
                </CellPopover>
              ))}
              {rest.length === 0 && people.length === 0 && (
                <p className="rounded-md bg-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">
                  No employees to show.
                </p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CellPopover({
  children,
  onSelect,
  disabled,
}: {
  children: React.ReactNode;
  onSelect: (code: string | null) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (disabled) return <>{children}</>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56 p-2">
        <div className="mb-2 text-xs font-medium">Set leave code</div>
        <div className="grid grid-cols-4 gap-1">
          {LEAVE_TYPES.map((t) => (
            <button
              key={t.code}
              className="h-8 rounded text-[11px] font-semibold text-white hover:opacity-90"
              style={{ background: t.colour }}
              onClick={() => {
                onSelect(t.code);
                setOpen(false);
              }}
              title={t.label}
            >
              {t.code}
            </button>
          ))}
        </div>
        <button
          className="mt-2 w-full inline-flex items-center justify-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
          onClick={() => {
            onSelect(null);
            setOpen(false);
          }}
        >
          <X className="h-3 w-3" /> Clear
        </button>
      </PopoverContent>
    </Popover>
  );
}
