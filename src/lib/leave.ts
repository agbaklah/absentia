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

/**
 * Policy guidance for a leave type — shown to employees when requesting and to
 * reviewers before approving. Returns null when no special rule applies.
 */
export function leaveGuidance(code: string): string | null {
  const t = LEAVE_MAP[code as LeaveCode];
  if (!t) return null;
  switch (t.category) {
    case "sick":
      return "Sickness leave requires a doctor's report attached, or submitted in person at the office.";
    case "parental":
      return "Parental leave requires supporting documentation (e.g. MATB1 or birth certificate).";
    case "compassionate":
      return "Compassionate leave may require brief confirmation — please handle sensitively.";
    default:
      return null;
  }
}

export function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parse a date-only "YYYY-MM-DD" string as *local* midnight.
 *
 * `new Date("YYYY-MM-DD")` parses as UTC midnight, and reading it back with
 * local-time getters (getMonth/getDate/getFullYear) drifts a day in
 * negative-offset timezones. This is the single timezone-safe way to parse
 * date-only strings — always use it instead of `new Date(iso)`.
 *
 * Returns an invalid Date (NaN time) for anything that isn't a real calendar
 * date (wrong shape, bad month, or an impossible day like Feb 30).
 */
export function parseISODate(iso: string): Date {
  const p = splitISO(iso);
  if (!p) return new Date(NaN);
  return new Date(p[0], p[1] - 1, p[2]);
}

// ---------------------------------------------------------------------------
// Pure calendar arithmetic. Everything below works on Y/M/D components and
// never constructs a Date, so it cannot be shifted by timezone transitions
// (DST), date-line skips (Samoa 2011), or the host's tzdata.
// ---------------------------------------------------------------------------

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Days in a given month. Month is 1-12. */
function daysInMonthYear(y: number, mo: number): number {
  return mo === 2 && isLeapYear(y) ? 29 : MONTH_DAYS[mo - 1];
}

/**
 * Split "YYYY-MM-DD" into [y, m, d] (month 1-12) or null if not a real date.
 * Years below 100 are rejected (Date maps 0-99 to 1900+y, which would corrupt
 * parseISODate's round-trip).
 */
function splitISO(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 100 || mo < 1 || mo > 12 || d < 1 || d > daysInMonthYear(y, mo)) return null;
  return [y, mo, d];
}

/**
 * Add n calendar days to a date-only string (negative n goes backwards).
 * Pure component arithmetic — DST and date-line transitions cannot shift the
 * result (the Date-based equivalent skips Samoa's 2011-12-30 entirely).
 * Returns "" for invalid input.
 */
export function addDaysISO(iso: string, n: number): string {
  const p = splitISO(iso);
  if (!p) return "";
  let [y, mo, d] = p;
  d += n;
  while (d < 1) {
    mo -= 1;
    if (mo < 1) {
      mo = 12;
      y -= 1;
    }
    d += daysInMonthYear(y, mo);
  }
  while (d > daysInMonthYear(y, mo)) {
    d -= daysInMonthYear(y, mo);
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Year of a date-only string, falling back to the current year when the date
 * is invalid or empty (e.g. a cleared <input type="date">).
 */
export function yearOfISO(iso: string): number {
  return splitISO(iso)?.[0] ?? new Date().getFullYear();
}

/**
 * e.g. "Wed 1 Jul" — parsed at local midnight so the date never shifts.
 * Locale defaults to the runtime's (undefined), matching the user's browser.
 */
export function fmtDayShort(iso: string, locale?: string): string {
  return parseISODate(iso).toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * e.g. "Wednesday, 1 July 2026" — parsed at local midnight so the date never
 * shifts. Locale defaults to the runtime's (undefined), matching the browser.
 */
export function fmtDayFull(iso: string, locale?: string): string {
  return parseISODate(iso).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Format a timestamp (an absolute instant, e.g. a TIMESTAMPTZ column value or
 * `new Date().toISOString()`) in the viewer's local timezone.
 *
 * Timestamps must carry a timezone designator (`Z` or `+HH:MM`) — Supabase
 * returns TIMESTAMPTZ columns that way, and `new Date(iso)` then parses an
 * exact instant regardless of the DB's timezone, so the displayed time is the
 * reviewer's local time, never shifted. Returns null for null/empty/invalid.
 * Locale defaults to the runtime's (undefined), matching the browser.
 */
export function fmtTimestamp(iso: string | null, locale?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Every calendar day in the inclusive range [start, end] as ISO strings.
 * Returns [] when end < start or either date is invalid.
 *
 * Pure string/component arithmetic: ISO strings compare lexicographically for
 * zero-padded dates, and addDaysISO never touches a Date, so DST or date-line
 * transitions cannot drop or duplicate a day.
 */
export function eachDayISO(start: string, end: string): string[] {
  if (!splitISO(start) || !splitISO(end)) return [];
  const out: string[] = [];
  let cur = start;
  // Lexicographic order is chronological for zero-padded dates. splitISO also
  // guards the year-9999 rollover: addDaysISO("9999-12-31", 1) yields a 5-digit
  // year that splits to null, cleanly ending the loop instead of comparing
  // out of order.
  while (cur <= end && splitISO(cur)) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

export function daysInMonth(year: number, month: number): number {
  return month === 1 && isLeapYear(year) ? 29 : MONTH_DAYS[month];
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Day of week (0 = Sunday) for a date-only string — pure component arithmetic
 * anchored on 1970-01-01 (a Thursday), so it is immune to timezone/date-line
 * transitions. Returns NaN for invalid input.
 */
export function dayOfWeekISO(iso: string): number {
  const p = splitISO(iso);
  if (!p) return NaN;
  const [y, mo, d] = p;
  let days = 0;
  if (y >= 1970) {
    for (let yr = 1970; yr < y; yr++) days += isLeapYear(yr) ? 366 : 365;
  } else {
    for (let yr = y; yr < 1970; yr++) days -= isLeapYear(yr) ? 366 : 365;
  }
  for (let m = 1; m < mo; m++) days += daysInMonthYear(y, m);
  days += d - 1;
  // 1970-01-01 was a Thursday (day 4, 0-indexed from Sunday).
  return (((4 + days) % 7) + 7) % 7;
}

/** Weekend check on a date-only string — pure, timezone-proof. */
export function isWeekendISO(iso: string): boolean {
  const dow = dayOfWeekISO(iso);
  return dow === 0 || dow === 6;
}

/** A business/working day for a date-only string: not a weekend, not a holiday. */
export function isWorkingDayISO(iso: string, holidays?: Set<string>): boolean {
  return !isWeekendISO(iso) && !(holidays?.has(iso) ?? false);
}

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
