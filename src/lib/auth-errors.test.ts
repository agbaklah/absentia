import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authErrorMessage } from "./auth-errors";

describe("authErrorMessage", () => {
  it("explains the email rate limit error", () => {
    const out = authErrorMessage("Email rate limit exceeded");
    assert.match(out, /30 per hour/i);
    assert.match(out, /Rate Limits/i);
  });

  it("explains other rate-limit variants", () => {
    assert.match(authErrorMessage("Signup rate limit exceeded"), /30 per hour/i);
    assert.match(authErrorMessage("over_email_send_rate_limit"), /30 per hour/i);
    assert.match(authErrorMessage("Too many requests. Please try again later."), /30 per hour/i);
  });

  it("passes through unrelated errors unchanged", () => {
    assert.equal(authErrorMessage("Invalid login credentials"), "Invalid login credentials");
    assert.equal(authErrorMessage(""), "");
  });
});
