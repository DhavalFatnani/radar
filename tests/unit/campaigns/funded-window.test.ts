import { describe, it, expect } from "vitest";
import { resolveFundedSinceDays } from "@/lib/campaigns/funded-window";

describe("resolveFundedSinceDays", () => {
  it("prefers a valid positive override from config", () => {
    expect(resolveFundedSinceDays(365, 180)).toBe(180);
  });
  it("falls back to the plan default when the override is missing/invalid", () => {
    expect(resolveFundedSinceDays(365, undefined)).toBe(365);
    expect(resolveFundedSinceDays(365, 0)).toBe(365);
    expect(resolveFundedSinceDays(365, "x")).toBe(365);
    expect(resolveFundedSinceDays(365, -5)).toBe(365);
  });
});
