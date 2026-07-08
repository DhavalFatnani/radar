import { describe, it, expect } from "vitest";
import { vendorProfileSchema, vendorStubSchema, vendorTypeSchema } from "@/lib/vendors/schema";

describe("vendors/schema (DB-free)", () => {
  it("parses and normalises a profile input", () => {
    const parsed = vendorProfileSchema.parse({
      name: "Acme",
      capabilities: "racking, cctv",
      constraints: { geographies: "Maharashtra\nGujarat", maxProjectSize: "100000 sqft" },
      idealCustomer: "Mid-size 3PLs",
    });
    expect(parsed.capabilities).toEqual(["racking", "cctv"]);
    expect(parsed.constraints.geographies).toEqual(["Maharashtra", "Gujarat"]);
    expect(parsed.constraints.maxProjectSize).toBe("100000 sqft");
    expect(parsed.idealCustomer).toBe("Mid-size 3PLs");
    expect(parsed.knownGoodSignals).toBeUndefined();
  });

  it("rejects an empty name", () => {
    expect(() => vendorStubSchema.parse({ name: "  " })).toThrow();
  });
});

describe("vendorStubSchema vendorType", () => {
  it("accepts an optional vendorType and trims it", () => {
    const parsed = vendorStubSchema.parse({ name: "Acme", vendorType: "  Infra  " });
    expect(parsed.vendorType).toBe("Infra");
  });

  it("omits vendorType when absent", () => {
    const parsed = vendorStubSchema.parse({ name: "Acme" });
    expect(parsed.vendorType).toBeUndefined();
  });
});

describe("vendorTypeSchema", () => {
  it("trims a value and returns it verbatim", () => {
    expect(vendorTypeSchema.parse("  Infra  ")).toBe("Infra");
  });
  it("maps empty / whitespace to null", () => {
    expect(vendorTypeSchema.parse("")).toBeNull();
    expect(vendorTypeSchema.parse("   ")).toBeNull();
  });
});
