import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createVendorStub, updateVendorProfile } from "@/lib/vendors/data";
import type { VendorProfileInput } from "@/lib/vendors/schema";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["vendor_profiles"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

// A profile input that differs from the empty stub, so a version bump happens.
function baseInput(name: string): VendorProfileInput {
  return {
    name,
    capabilities: ["warehouse racking up to 12t/bay"],
    constraints: {},
    idealCustomer: undefined,
    knownGoodSignals: undefined,
    differentiators: undefined,
    credibility: undefined,
  };
}

describe("updateVendorProfile history source", () => {
  it("records an interview-kind entry carrying the interview id", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const updated = await updateVendorProfile(vendorId, baseInput("Acme"), {
      kind: "interview",
      interviewId: "iv-123",
    });
    const entry = updated.interviewHistory.at(-1);
    expect(entry?.kind).toBe("interview");
    expect(entry?.interviewId).toBe("iv-123");
  });

  it("defaults to a manual_edit entry when no source is given", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const updated = await updateVendorProfile(vendorId, baseInput("Acme"));
    const entry = updated.interviewHistory.at(-1);
    expect(entry?.kind).toBe("manual_edit");
    expect(entry?.interviewId).toBeUndefined();
  });
});
