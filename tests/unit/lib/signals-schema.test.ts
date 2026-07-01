import { describe, it, expect } from "vitest";
import { createSignalSchema, canTransition } from "@/lib/signals/schema";

const valid = { signalId: "SIG-HIRING-OPS-SURGE", name: "Ops hiring surge", family: "hiring",
  strength: "high", falsePositiveRisk: "low" };

describe("createSignalSchema", () => {
  it("accepts a valid minimal signal", () => {
    expect(createSignalSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a bad signalId", () => {
    expect(createSignalSchema.safeParse({ ...valid, signalId: "hiring-surge" }).success).toBe(false);
  });
  it("rejects an empty name and a bad enum", () => {
    expect(createSignalSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(createSignalSchema.safeParse({ ...valid, family: "weather" }).success).toBe(false);
  });
  it("parses a newline/comma sources string into a clean list", () => {
    const r = createSignalSchema.parse({ ...valid, sources: "news, jobs\n crunchbase " });
    expect(r.sources).toEqual(["news", "jobs", "crunchbase"]);
  });
});

describe("canTransition", () => {
  it("allows the governance moves", () => {
    expect(canTransition("proposed", "approved")).toBe(true);
    expect(canTransition("proposed", "retired")).toBe(true);
    expect(canTransition("approved", "retired")).toBe(true);
    expect(canTransition("retired", "approved")).toBe(true);
  });
  it("rejects no-op and invalid moves", () => {
    expect(canTransition("approved", "proposed")).toBe(false);
    expect(canTransition("proposed", "proposed")).toBe(false);
    expect(canTransition("retired", "proposed")).toBe(false);
  });
});
