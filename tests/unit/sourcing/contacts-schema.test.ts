import { describe, it, expect } from "vitest";
import {
  buildContactBlock,
  contactBlockSchema,
  type DecisionMaker,
} from "@/lib/sourcing/contacts-schema";
import { contactsStubResolver } from "@/lib/sourcing/adapters/contacts-stub";

const dm: DecisionMaker = {
  name: "Jane Doe",
  role: "VP Operations",
  why: "Owns the warehouse expansion budget",
  paths: [{ type: "email", val: "jane@acme.test", conf: "high", source: "apollo" }],
  warm: { status: "cold", detail: null },
};

describe("buildContactBlock", () => {
  it("marks an empty result pending_enrichment", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const block = buildContactBlock([], "stub", now);
    expect(block.status).toBe("pending_enrichment");
    expect(block.decision_makers).toEqual([]);
    expect(block.resolvedBy).toBe("stub");
    expect(block.resolvedAt).toBe("2026-07-03T12:00:00.000Z");
  });

  it("marks a non-empty result resolved and passes decision-makers through verbatim", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const block = buildContactBlock([dm], "apollo", now);
    expect(block.status).toBe("resolved");
    expect(block.decision_makers).toEqual([dm]);
    expect(block.resolvedBy).toBe("apollo");
  });
});

describe("contactBlockSchema", () => {
  it("accepts a valid resolved block", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const block = buildContactBlock([dm], "apollo", now);
    expect(contactBlockSchema.safeParse(block).success).toBe(true);
  });

  it("rejects a decision-maker missing a name", () => {
    const bad = {
      decision_makers: [{ role: "VP", why: "", paths: [], warm: { status: "cold", detail: null } }],
      status: "resolved",
      resolvedBy: "apollo",
      resolvedAt: "2026-07-03T12:00:00.000Z",
    };
    expect(contactBlockSchema.safeParse(bad).success).toBe(false);
  });
});

describe("contactsStubResolver", () => {
  it("resolves zero decision-makers and identifies itself", async () => {
    const out = await contactsStubResolver.resolve({
      company: { name: "Acme", description: null },
      vendor: { name: "RackPro", vendorType: "Infra" },
      intent: "Expanding capacity",
    });
    expect(out.decisionMakers).toEqual([]);
    expect(contactsStubResolver.sourceName).toBe("stub");
  });
});
