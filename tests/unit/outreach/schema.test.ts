import { describe, it, expect } from "vitest";
import {
  OUTREACH_STATUSES,
  OUTREACH_STATUS_LABELS,
  outreachDraftSchema,
  canMarkSent,
  nextStatuses,
  type OutreachStatus,
} from "@/lib/outreach/schema";

const ENUM_ORDER: OutreachStatus[] = ["pending", "drafted", "sent"];

describe("outreach status model", () => {
  it("OUTREACH_STATUSES mirrors the DB enum exactly and in order", () => {
    expect([...OUTREACH_STATUSES]).toEqual(ENUM_ORDER);
  });

  it("OUTREACH_STATUS_LABELS provides a non-empty label for every status", () => {
    for (const s of OUTREACH_STATUSES) {
      expect(OUTREACH_STATUS_LABELS[s]).toBeTruthy();
    }
  });

  it("canMarkSent is true for pending and drafted, false for sent", () => {
    expect(canMarkSent("pending")).toBe(true);
    expect(canMarkSent("drafted")).toBe(true);
    expect(canMarkSent("sent")).toBe(false);
  });

  it("nextStatuses returns the legal forward targets per status", () => {
    expect(nextStatuses("pending")).toEqual(["drafted", "sent"]);
    expect(nextStatuses("drafted")).toEqual(["sent"]);
    expect(nextStatuses("sent")).toEqual([]);
  });
});

describe("outreachDraftSchema", () => {
  it("accepts a well-formed draft", () => {
    const r = outreachDraftSchema.safeParse({ subject: "Hi", body: "Let's talk." });
    expect(r.success).toBe(true);
  });

  it("rejects an empty subject", () => {
    expect(outreachDraftSchema.safeParse({ subject: "", body: "x" }).success).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(outreachDraftSchema.safeParse({ subject: "x", body: "" }).success).toBe(false);
  });

  it("rejects a missing field", () => {
    expect(outreachDraftSchema.safeParse({ subject: "x" }).success).toBe(false);
  });
});
