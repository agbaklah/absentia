import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateTempPassword,
  compareHashes,
  TEMP_PASSWORD_EXPIRY_HOURS,
} from "./reset-admin-password";

// ---------------------------------------------------------------------------
// generateTempPassword
// ---------------------------------------------------------------------------

describe("generateTempPassword", () => {
  it("returns a 16-character string", () => {
    const pw = generateTempPassword();
    assert.equal(pw.length, 16, `expected 16 chars, got ${pw.length}`);
  });

  it("contains at least one uppercase letter", () => {
    const pw = generateTempPassword();
    assert.ok(/[A-Z]/.test(pw), `no uppercase in "${pw}"`);
  });

  it("contains at least one lowercase letter", () => {
    const pw = generateTempPassword();
    assert.ok(/[a-z]/.test(pw), `no lowercase in "${pw}"`);
  });

  it("contains at least one digit", () => {
    const pw = generateTempPassword();
    assert.ok(/\d/.test(pw), `no digit in "${pw}"`);
  });

  it("contains at least one symbol", () => {
    const pw = generateTempPassword();
    assert.ok(/[^A-Za-z0-9]/.test(pw), `no symbol in "${pw}"`);
  });

  it("excludes visually confusing characters (0, O, o, 1, l, I)", () => {
    const confusing = /[0Ol1I]/;
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      assert.ok(
        !confusing.test(pw),
        `confusing char found in "${pw}" on iteration ${i}`,
      );
    }
  });

  it("uses only characters from the allowed set", () => {
    const allowed = /^[A-Za-z0-9!@#$%^&*?]+$/;
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      assert.ok(
        allowed.test(pw),
        `disallowed character in "${pw}" on iteration ${i}`,
      );
    }
  });

  it("generates different passwords on successive calls (probabilistic)", () => {
    const passwords = new Set<string>();
    for (let i = 0; i < 20; i++) {
      passwords.add(generateTempPassword());
    }
    // 20 calls should produce at least 10 unique passwords with overwhelming
    // probability if the generator is working correctly.
    assert.ok(passwords.size >= 10, `only ${passwords.size} unique passwords from 20 calls`);
  });

  it("satisfies the password strength policy (score 4 / Strong)", () => {
    // Inline the same scoring logic used by @/lib/password-strength so we
    // don't pull UI code into a test.
    const passwordStrength = (p: string): number => {
      const checks: ((s: string) => boolean)[] = [
        (s) => s.length >= 8,
        (s) => /[A-Z]/.test(s),
        (s) => /[a-z]/.test(s),
        (s) => /\d/.test(s),
        (s) => /[^A-Za-z0-9]/.test(s),
      ];
      return checks.filter((fn) => fn(p)).length;
    };

    // Every generated password must meet all five criteria (score 5/5 → Strong)
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      const met = passwordStrength(pw);
      assert.equal(
        met,
        5,
        `password "${pw}" only met ${met}/5 strength checks`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// compareHashes (constant-time comparison)
// ---------------------------------------------------------------------------

describe("compareHashes", () => {
  it("returns true for identical hashes", () => {
    const hash = "abcdef0123456789abcdef0123456789";
    assert.equal(compareHashes(hash, hash), true);
  });

  it("returns false for different hashes", () => {
    const a = "abcdef0123456789abcdef0123456789";
    const b = "abcdef0123456789abcdef012345678a";
    assert.equal(compareHashes(a, b), false);
  });

  it("returns false for different-length strings", () => {
    assert.equal(compareHashes("abc", "abcd"), false);
  });

  it("returns true for empty strings", () => {
    assert.equal(compareHashes("", ""), true);
  });

  it("returns false when one is empty", () => {
    assert.equal(compareHashes("", "abc"), false);
  });

  it("handles fully different strings", () => {
    const a = "00000000000000000000000000000000";
    const b = "ffffffffffffffffffffffffffffffff";
    assert.equal(compareHashes(a, b), false);
  });

  it("handles single-character difference at various positions", () => {
    const base = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    for (let i = 0; i < base.length; i++) {
      const modified =
        base.slice(0, i) + "b" + base.slice(i + 1);
      assert.equal(compareHashes(base, modified), false, `diff at position ${i}`);
    }
  });
});

// ---------------------------------------------------------------------------
// TEMP_PASSWORD_EXPIRY_HOURS constant
// ---------------------------------------------------------------------------

describe("TEMP_PASSWORD_EXPIRY_HOURS", () => {
  it("equals 72 hours", () => {
    assert.equal(TEMP_PASSWORD_EXPIRY_HOURS, 72);
  });
});
