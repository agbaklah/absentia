import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { passwordStrength } from "./password-strength";

describe("passwordStrength", () => {
  it("scores an empty password as very weak with no checks met", () => {
    const r = passwordStrength("");
    assert.equal(r.score, 0);
    assert.equal(r.label, "Very weak");
    assert.equal(
      r.checks.every((c) => !c.met),
      true,
    );
  });

  it("scores a short all-lowercase password as weak", () => {
    const r = passwordStrength("abc123");
    assert.ok(r.score <= 1, `expected weak, got ${r.label} (${r.score})`);
    assert.equal(r.checks.find((c) => c.label.startsWith("At least 8"))?.met, false);
  });

  it("scores a long but single-category password as fair", () => {
    const r = passwordStrength("aaaaaaaaaaaa");
    assert.equal(r.score, 1); // length only -> 1/5 met
    assert.equal(r.label, "Weak");
  });

  it("scores a strong password as strong", () => {
    const r = passwordStrength("Tr0ub4dor&3!");
    assert.equal(r.score, 4);
    assert.equal(r.label, "Strong");
    assert.equal(
      r.checks.every((c) => c.met),
      true,
    );
  });

  it("scores a medium password as good", () => {
    const r = passwordStrength("Passw0rd");
    assert.equal(r.score, 3); // length, upper, lower, number -> 4/5 met
    assert.equal(r.label, "Good");
  });

  it("tracks each check independently", () => {
    const r = passwordStrength("P4$$w0rdLong");
    for (const c of r.checks) assert.equal(c.met, true);
  });
});
