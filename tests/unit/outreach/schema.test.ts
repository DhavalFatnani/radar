import { describe, it, expect } from "vitest";
import {
  OUTREACH_STATUSES,
  OUTREACH_STATUS_LABELS,
  outreachDraftSchema,
  canMarkSent,
  nextStatuses,
  primaryRecipientEmail,
  type OutreachStatus,
} from "@/lib/outreach/schema";
import type { ContactBlock } from "@/lib/sourcing/contacts-schema";

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

function block(
  paths: { type: string; val: string | null }[],
): ContactBlock {
  return {
    decision_makers: [
      {
        name: "Dana Ops",
        role: "COO",
        why: "runs ops",
        paths: paths.map((p) => ({ type: p.type, val: p.val, conf: null, source: null })),
        warm: { status: "cold", detail: null },
      },
    ],
    status: "resolved",
    resolvedBy: "test",
    resolvedAt: "2026-07-03T00:00:00.000Z",
  };
}

describe("primaryRecipientEmail", () => {
  it("returns the first email path with a value", () => {
    expect(
      primaryRecipientEmail(block([{ type: "email", val: "dana@acme.test" }])),
    ).toBe("dana@acme.test");
  });

  it("skips an email path whose val is null and takes the next usable email", () => {
    expect(
      primaryRecipientEmail(
        block([
          { type: "email", val: null },
          { type: "email", val: "dana@acme.test" },
        ]),
      ),
    ).toBe("dana@acme.test");
  });

  it("ignores non-email path types", () => {
    expect(
      primaryRecipientEmail(
        block([
          { type: "phone", val: "+1-555" },
          { type: "linkedin", val: "in/dana" },
        ]),
      ),
    ).toBeNull();
  });

  it("returns null when no email path exists", () => {
    expect(primaryRecipientEmail(block([]))).toBeNull();
  });

  it("returns null when decision_makers is empty", () => {
    const b = block([{ type: "email", val: "x@y.test" }]);
    b.decision_makers = [];
    expect(primaryRecipientEmail(b)).toBeNull();
  });

  it("returns null for a null block", () => {
    expect(primaryRecipientEmail(null)).toBeNull();
  });
});
