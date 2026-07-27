export type LeaveCode = "L" | "L1" | "L2" | "S" | "S1" | "S2" | "P" | "C" | "T" | "W" | "B";

export const LEAVE_TYPES: {
  code: LeaveCode;
  label: string;
  category: "vacation" | "sick" | "parental" | "compassionate" | "toil" | "wfh" | "holiday";
  days: number;
  colour: string;
}[] = [
  { code: "L", label: "Vacation (Full)", category: "vacation", days: 1, colour: "#166534" },
  { code: "L1", label: "Vacation (AM)", category: "vacation", days: 0.5, colour: "#22c55e" },
  { code: "L2", label: "Vacation (PM)", category: "vacation", days: 0.5, colour: "#4ade80" },
  { code: "S", label: "Sickness (Full)", category: "sick", days: 1, colour: "#dc2626" },
  { code: "S1", label: "Sickness (AM)", category: "sick", days: 0.5, colour: "#f87171" },
  { code: "S2", label: "Sickness (PM)", category: "sick", days: 0.5, colour: "#fca5a5" },
  { code: "P", label: "Maternity / Paternity", category: "parental", days: 1, colour: "#8b5cf6" },
  { code: "C", label: "Compassionate", category: "compassionate", days: 1, colour: "#0ea5e9" },
  { code: "T", label: "TOIL", category: "toil", days: 1, colour: "#d97706" },
  { code: "W", label: "Work From Home", category: "wfh", days: 1, colour: "#64748b" },
  { code: "B", label: "Bank Holiday", category: "holiday", days: 0, colour: "#94a3b8" },
];

export const LEAVE_MAP = Object.fromEntries(LEAVE_TYPES.map((t) => [t.code, t])) as Record<
  LeaveCode,
  (typeof LEAVE_TYPES)[number]
>;

export function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const WEEKDAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];