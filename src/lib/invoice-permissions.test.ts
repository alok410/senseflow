import { describe, it } from "node:test";
import assert from "node:assert";
import { canApproveInvoices } from "./invoice-permissions";

describe("invoice approval access", () => {
  it("allows an admin without a separate approval flag", () => {
    assert.strictEqual(canApproveInvoices(true, false), true);
  });

  it("allows a user with the approval flag", () => {
    assert.strictEqual(canApproveInvoices(false, true), true);
  });

  it("denies a user without either authorization", () => {
    assert.strictEqual(canApproveInvoices(false, false), false);
  });
});