import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isWorkEmail } from "./work-email";

describe("isWorkEmail", () => {
  it("accepts plain work addresses", () => {
    assert.equal(isWorkEmail("jane@verve-energyresources.com"), true);
    assert.equal(isWorkEmail("jane.smith@verve-energyresources.com"), true);
  });

  it("is case-insensitive on the domain and local part", () => {
    assert.equal(isWorkEmail("JANE@VERVE-ENERGYRESOURCES.COM"), true);
    assert.equal(isWorkEmail("Jane.Smith@Verve-EnergyResources.com"), true);
  });

  it("rejects other domains and lookalikes", () => {
    assert.equal(isWorkEmail("jane@gmail.com"), false);
    assert.equal(isWorkEmail("jane@verve-energyresources.com.evil.com"), false);
    assert.equal(isWorkEmail("jane@notverve-energyresources.com"), false);
  });

  it("rejects malformed addresses", () => {
    assert.equal(isWorkEmail(""), false);
    assert.equal(isWorkEmail("jane"), false);
    assert.equal(isWorkEmail("jane@"), false);
    assert.equal(isWorkEmail("@verve-energyresources.com"), false);
    assert.equal(isWorkEmail("jane @verve-energyresources.com"), false);
  });

  it("trims surrounding whitespace", () => {
    assert.equal(isWorkEmail("  jane@verve-energyresources.com  "), true);
  });
});
