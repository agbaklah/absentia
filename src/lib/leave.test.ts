import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fmtISO,
  parseISODate,
  addDaysISO,
  eachDayISO,
  yearOfISO,
  fmtDayShort,
  fmtDayFull,
  fmtTimestamp,
  dayOfWeekISO,
  isWeekendISO,
  isWorkingDayISO,
  daysInMonth,
} from "@/lib/leave";

describe("parseISODate", () => {
  it("parses a date-only string as local midnight (never UTC)", () => {
    const d = parseISODate("2026-07-01");
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 6);
    assert.equal(d.getDate(), 1);
    assert.equal(d.getHours(), 0);
    assert.equal(fmtISO(d), "2026-07-01");
  });

  it("trims surrounding whitespace", () => {
    const d = parseISODate("  2026-01-05  ");
    assert.equal(fmtISO(d), "2026-01-05");
  });

  it("rejects malformed shapes", () => {
    for (const bad of [
      "",
      "2026-1-5",
      "2026/01/05",
      "2026-01",
      "2026-01-05T00:00:00",
      "garbage",
      "2026-01-5",
    ]) {
      assert.ok(
        Number.isNaN(parseISODate(bad).getTime()),
        `expected ${JSON.stringify(bad)} to be invalid`,
      );
    }
  });

  it("rejects rollover dates like Feb 30 that Date would silently normalize", () => {
    assert.ok(Number.isNaN(parseISODate("2026-02-30").getTime()));
    assert.ok(Number.isNaN(parseISODate("2026-13-01").getTime()));
    assert.ok(Number.isNaN(parseISODate("2026-00-10").getTime()));
  });

  it("accepts leap-day and end-of-year dates", () => {
    assert.equal(fmtISO(parseISODate("2024-02-29")), "2024-02-29");
    assert.equal(fmtISO(parseISODate("2026-12-31")), "2026-12-31");
  });

  it("round-trips through fmtISO unchanged", () => {
    for (const iso of ["2025-01-01", "2026-06-15", "2027-12-31"]) {
      assert.equal(fmtISO(parseISODate(iso)), iso);
    }
  });
});

describe("addDaysISO", () => {
  it("adds days across month boundaries", () => {
    assert.equal(addDaysISO("2026-01-31", 1), "2026-02-01");
    assert.equal(addDaysISO("2026-03-01", -1), "2026-02-28");
  });

  it("rolls over the year boundary", () => {
    assert.equal(addDaysISO("2026-12-31", 1), "2027-01-01");
    assert.equal(addDaysISO("2026-01-01", -1), "2025-12-31");
  });

  it("handles leap years", () => {
    assert.equal(addDaysISO("2024-02-28", 1), "2024-02-29");
    assert.equal(addDaysISO("2025-02-28", 1), "2025-03-01");
  });

  it("returns empty string for invalid input", () => {
    assert.equal(addDaysISO("", 1), "");
    assert.equal(addDaysISO("2026-13-01", 5), "");
  });

  it("borrows across multiple months for large negative n", () => {
    assert.equal(addDaysISO("2026-03-01", -60), "2025-12-31");
    assert.equal(addDaysISO("2026-01-15", -40), "2025-12-06");
    assert.equal(addDaysISO("2026-01-01", -100), "2025-09-23");
  });

  it("carries across multiple months for large positive n", () => {
    assert.equal(addDaysISO("2026-12-31", 100), "2027-04-10");
    assert.equal(addDaysISO("2026-01-31", 31), "2026-03-03");
    assert.equal(addDaysISO("2026-03-01", 60), "2026-04-30");
  });

  it("agrees with Date-based arithmetic across a wide n sweep", () => {
    for (const iso of ["2026-01-01", "2026-03-01", "2026-12-31", "2028-02-29"]) {
      const [y, m, d] = iso.split("-").map(Number);
      for (let n = -400; n <= 400; n++) {
        const dt = new Date(y, m - 1, d);
        dt.setDate(dt.getDate() + n);
        assert.equal(addDaysISO(iso, n), fmtISO(dt), `${iso} +${n}`);
      }
    }
  });
});

describe("eachDayISO", () => {
  it("returns every day in the inclusive range", () => {
    assert.deepEqual(eachDayISO("2026-07-01", "2026-07-03"), [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
  });

  it("returns a single day for start === end", () => {
    assert.deepEqual(eachDayISO("2026-07-01", "2026-07-01"), ["2026-07-01"]);
  });

  it("spans month and year boundaries", () => {
    assert.deepEqual(eachDayISO("2026-12-30", "2027-01-02"), [
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("returns [] when end is before start", () => {
    assert.deepEqual(eachDayISO("2026-07-05", "2026-07-03"), []);
  });

  it("returns [] when either end is invalid", () => {
    assert.deepEqual(eachDayISO("2026-07-01", ""), []);
    assert.deepEqual(eachDayISO("", "2026-07-01"), []);
  });

  it("does not loop forever at the year-9999 boundary", () => {
    // addDaysISO("9999-12-31", 1) would produce a 5-digit year that breaks
    // lexicographic ordering; the loop must terminate cleanly instead.
    const out = eachDayISO("9999-12-30", "9999-12-31");
    assert.deepEqual(out, ["9999-12-30", "9999-12-31"]);
  });
});

describe("yearOfISO", () => {
  it("returns the year of a valid date", () => {
    assert.equal(yearOfISO("2026-07-01"), 2026);
    assert.equal(yearOfISO("2025-12-31"), 2025);
  });

  it("falls back to the current year for empty or invalid dates", () => {
    const now = new Date().getFullYear();
    assert.equal(yearOfISO(""), now);
    assert.equal(yearOfISO("garbage"), now);
    assert.equal(yearOfISO("2026-13-01"), now);
  });
});

describe("fmtTimestamp", () => {
  it("returns null for null, empty, or invalid input", () => {
    assert.equal(fmtTimestamp(null), null);
    assert.equal(fmtTimestamp(""), null);
    assert.equal(fmtTimestamp("not-a-date"), null);
  });

  it("renders an absolute instant in the environment's local timezone", () => {
    // 12:00 UTC must display as local wall-clock time, shifted by this
    // machine's offset — never the raw UTC hour (a DB/pass-through bug).
    // Build the expected local time from the Date's own local components so
    // the test is exact in every timezone (e.g. "8:00 AM" in New York).
    const instant = new Date("2026-08-04T12:00:00Z");
    const localH = instant.getHours();
    const h12 = ((localH + 11) % 12) + 1;
    const ampm = localH >= 12 ? "PM" : "AM";
    const out = fmtTimestamp(instant.toISOString(), "en-US");
    assert.ok(out);
    assert.match(
      out,
      new RegExp(`${h12}:00 ${ampm}`),
      `expected "${out}" to show local time ${h12}:00 ${ampm}`,
    );
  });

  it("shifts the calendar day across midnight per the local timezone", () => {
    // 01:00 on Aug 5 UTC — in negative-offset zones this is still Aug 4
    // locally, so the rendered day must be the local one.
    const iso = "2026-08-05T01:00:00Z";
    const localDay = new Date(iso).getDate();
    const out = fmtTimestamp(iso, "en-US");
    assert.ok(out);
    assert.match(out, new RegExp(String(localDay)));
  });
});

describe("fmtDayShort / fmtDayFull", () => {
  // 2026-07-01 is a Wednesday. Pinned to en-US so the tests are locale-independent.
  it("formats a day in short form (weekday + day + month)", () => {
    assert.equal(fmtDayShort("2026-07-01", "en-US"), "Wed, Jul 1");
    assert.equal(fmtDayShort("2026-12-31", "en-US"), "Thu, Dec 31");
  });

  it("formats a day in full form (weekday + day + month + year)", () => {
    assert.equal(fmtDayFull("2026-07-01", "en-US"), "Wednesday, July 1, 2026");
    assert.equal(fmtDayFull("2026-12-31", "en-US"), "Thursday, December 31, 2026");
  });
});

describe("dayOfWeekISO", () => {
  it("matches known weekday anchors (0 = Sunday)", () => {
    assert.equal(dayOfWeekISO("1970-01-01"), 4); // Thursday
    assert.equal(dayOfWeekISO("2000-01-01"), 6); // Saturday
    assert.equal(dayOfWeekISO("2026-01-01"), 4); // Thursday
    assert.equal(dayOfWeekISO("2026-07-01"), 3); // Wednesday
    assert.equal(dayOfWeekISO("2024-02-29"), 4); // Thursday (leap day)
  });

  it("works for years before the 1970 anchor", () => {
    assert.equal(dayOfWeekISO("1969-12-31"), 3); // Wednesday
    assert.equal(dayOfWeekISO("1900-01-01"), 1); // Monday
  });

  it("returns NaN for invalid input", () => {
    assert.ok(Number.isNaN(dayOfWeekISO("")));
    assert.ok(Number.isNaN(dayOfWeekISO("2026-02-30")));
  });

  it("agrees with Date for every day of a full leap year", () => {
    const days = eachDayISO("2024-01-01", "2024-12-31");
    assert.equal(days.length, 366);
    for (const iso of days) {
      const [y, m, d] = iso.split("-").map(Number);
      assert.equal(dayOfWeekISO(iso), new Date(y, m - 1, d).getDay(), iso);
    }
  });
});

describe("DST / date-line robustness", () => {
  it("does not skip the date Samoa removed (2011-12-30)", () => {
    // Under Pacific/Apia, new Date(2011, 11, 30) resolves to Dec 31, so
    // setDate-based arithmetic silently drops Dec 30. Pure component
    // arithmetic always counts the true calendar day.
    assert.equal(addDaysISO("2011-12-29", 1), "2011-12-30");
    assert.equal(addDaysISO("2011-12-30", 1), "2011-12-31");
    assert.deepEqual(eachDayISO("2011-12-29", "2012-01-01"), [
      "2011-12-29",
      "2011-12-30",
      "2011-12-31",
      "2012-01-01",
    ]);
  });

  it("stays put across US spring-forward (2026-03-08)", () => {
    // US DST starts Sun Mar 8 2026 at 02:00 -> 03:00.
    assert.equal(addDaysISO("2026-03-07", 1), "2026-03-08");
    assert.equal(addDaysISO("2026-03-08", 1), "2026-03-09");
    assert.deepEqual(eachDayISO("2026-03-07", "2026-03-09"), [
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
    ]);
    assert.equal(dayOfWeekISO("2026-03-08"), 0); // Sunday
  });

  it("stays put across US fall-back (2026-11-01)", () => {
    assert.equal(addDaysISO("2026-10-31", 1), "2026-11-01");
    assert.equal(addDaysISO("2026-11-01", 1), "2026-11-02");
    assert.equal(dayOfWeekISO("2026-11-01"), 0); // Sunday
  });

  it("matches Date-based iteration for a full year (no skips in 2026)", () => {
    const isoDays = eachDayISO("2026-01-01", "2026-12-31");
    assert.equal(isoDays.length, 365);
    const dateDays: string[] = [];
    const d = new Date(2026, 0, 1);
    const end = new Date(2026, 11, 31);
    while (d <= end) {
      dateDays.push(fmtISO(d));
      d.setDate(d.getDate() + 1);
    }
    assert.deepEqual(isoDays, dateDays);
  });
});

describe("isWeekendISO / isWorkingDayISO", () => {
  it("flags weekends and holidays from an ISO string", () => {
    const holidays = new Set(["2026-07-03"]); // a Friday
    assert.equal(isWeekendISO("2026-07-04"), true); // Saturday
    assert.equal(isWeekendISO("2026-07-05"), true); // Sunday
    assert.equal(isWeekendISO("2026-07-01"), false);
    assert.equal(isWorkingDayISO("2026-07-01", holidays), true);
    assert.equal(isWorkingDayISO("2026-07-04", holidays), false);
    assert.equal(isWorkingDayISO("2026-07-03", holidays), false);
  });
});

describe("daysInMonth", () => {
  it("counts days per month including leap February", () => {
    assert.equal(daysInMonth(2026, 0), 31); // Jan
    assert.equal(daysInMonth(2026, 1), 28); // Feb (non-leap)
    assert.equal(daysInMonth(2024, 1), 29); // Feb (leap)
    assert.equal(daysInMonth(2026, 3), 30); // Apr
    assert.equal(daysInMonth(2026, 11), 31); // Dec
  });
});

describe("parseISODate rejects pre-100 years", () => {
  it("keeps parity with Date's 1900-mapping hazard", () => {
    assert.ok(Number.isNaN(parseISODate("0099-12-31").getTime()));
    assert.ok(Number.isNaN(parseISODate("0000-01-01").getTime()));
  });
});
