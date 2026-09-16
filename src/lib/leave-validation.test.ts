import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseValidation } from "./leave-validation";

describe("parseValidation", () => {
  it("normalises a full payload", () => {
    const v = parseValidation({
      ok: false,
      errors: ["x"],
      warnings: ["y", "z"],
      requested_days: "2.0",
      available_days: 8,
    });
    assert.deepEqual(v, {
      ok: false,
      errors: ["x"],
      warnings: ["y", "z"],
      requested_days: 2,
      available_days: 8,
    });
  });
  it("tolerates nulls / junk", () => {
    const v = parseValidation(null);
    assert.equal(v.ok, false);
    assert.deepEqual(v.errors, []);
    assert.equal(v.available_days, null);
    assert.equal(parseValidation({ ok: true, errors: "nope" }).ok, true);
  });
});
