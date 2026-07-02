import { describe, it, expect } from "vitest";
import { createMappingSchema, canTransition } from "@/lib/mappings/schema";

const valid = { name: "Warehouse expansion", requiredSignals: ["SIG-EXP-NEW-FACILITY"] };

describe("createMappingSchema", () => {
  it("accepts a valid minimal mapping", () => {
    expect(createMappingSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects an empty name", () => {
    expect(createMappingSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });
  it("rejects zero required signals", () => {
    expect(createMappingSchema.safeParse({ ...valid, requiredSignals: [] }).success).toBe(false);
  });
  it("rejects a bad signal-id shape", () => {
    expect(createMappingSchema.safeParse({ ...valid, requiredSignals: ["nope"] }).success).toBe(false);
  });
  it("parses a newline/comma disqualifiers string into a clean list", () => {
    const r = createMappingSchema.parse({ ...valid, disqualifiers: "layoffs, shutdown\n existing client " });
    expect(r.disqualifiers).toEqual(["layoffs", "shutdown", "existing client"]);
  });
  it("coerces timingWindowDays to a number", () => {
    const r = createMappingSchema.parse({ ...valid, timingWindowDays: "180" });
    expect(r.timingWindowDays).toBe(180);
  });
});

describe("canTransition (re-exported)", () => {
  it("allows the governance moves", () => {
    expect(canTransition("proposed", "approved")).toBe(true);
    expect(canTransition("approved", "retired")).toBe(true);
    expect(canTransition("retired", "approved")).toBe(true);
  });
  it("rejects invalid moves", () => {
    expect(canTransition("approved", "proposed")).toBe(false);
  });
});
