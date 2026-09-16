import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { relativeTime } from "./relative-time";

describe("relativeTime", () => {
  const now = Date.parse("2026-09-16T12:00:00Z");
  it("buckets minutes, hours, days", () => {
    assert.equal(relativeTime("2026-09-16T11:59:40Z", now), "just now");
    assert.equal(relativeTime("2026-09-16T11:55:00Z", now), "5m");
    assert.equal(relativeTime("2026-09-16T09:00:00Z", now), "3h");
    assert.equal(relativeTime("2026-09-14T12:00:00Z", now), "2d");
  });
  it("falls back to a date after a week and never goes negative", () => {
    assert.match(relativeTime("2026-09-01T12:00:00Z", now), /Sept?/);
    assert.equal(relativeTime("2026-09-16T13:00:00Z", now), "just now");
  });
});
