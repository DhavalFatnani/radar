import { describe, it, expect } from "vitest";
import {
  tenderRecordSchema,
  normalizeCompanyName,
  computeFreshnessVerdict,
  detectTenderSignals,
  TENDER_KEYWORDS,
  TENDER_LIVE_SIGNAL,
  TENDER_AMENDED_SIGNAL,
  type TenderRecord,
} from "@/lib/sourcing/schema";

const base: TenderRecord = {
  ref: "T-1",
  title: "Supply of CCTV surveillance",
  issuingBody: "Pune Municipal Corporation",
  publishedAt: "2026-06-20T00:00:00Z",
  sourceName: "GeM",
};

describe("normalizeCompanyName", () => {
  it("lower-cases, collapses whitespace, strips trailing punctuation", () => {
    expect(normalizeCompanyName("Acme Corp.")).toBe("acme corp");
    expect(normalizeCompanyName("  Foo   Bar  ")).toBe("foo bar");
    expect(normalizeCompanyName("PMC,")).toBe("pmc");
  });
});

describe("computeFreshnessVerdict", () => {
  const now = new Date("2026-06-30T00:00:00Z");
  it("returns null when the window is undefined", () => {
    expect(computeFreshnessVerdict(new Date("2026-01-01T00:00:00Z"), null, now)).toBeNull();
  });
  it("returns 'recent' inside the window (inclusive boundary)", () => {
    expect(computeFreshnessVerdict(new Date("2026-06-20T00:00:00Z"), 90, now)).toBe("recent");
    expect(computeFreshnessVerdict(new Date("2026-04-01T00:00:00Z"), 90, now)).toBe("recent");
  });
  it("returns 'stale' outside the window", () => {
    expect(computeFreshnessVerdict(new Date("2025-06-30T00:00:00Z"), 90, now)).toBe("stale");
  });
});

describe("tenderRecordSchema", () => {
  it("accepts a valid record", () => {
    expect(tenderRecordSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a missing ref", () => {
    const { ref, ...noRef } = base;
    expect(tenderRecordSchema.safeParse(noRef).success).toBe(false);
  });
  it("rejects an unparseable publishedAt", () => {
    expect(tenderRecordSchema.safeParse({ ...base, publishedAt: "not-a-date" }).success).toBe(false);
  });
  it("rejects a non-URL url when present", () => {
    expect(tenderRecordSchema.safeParse({ ...base, url: "notaurl" }).success).toBe(false);
  });
});

describe("detectTenderSignals", () => {
  const approvedBoth = new Set([TENDER_LIVE_SIGNAL, TENDER_AMENDED_SIGNAL]);

  it("emits SIG-TENDER-LIVE with non-empty evidence on a keyword match", () => {
    const out = detectTenderSignals(base, new Set([TENDER_LIVE_SIGNAL]), TENDER_KEYWORDS);
    expect(out).toHaveLength(1);
    expect(out[0].signalId).toBe(TENDER_LIVE_SIGNAL);
    expect(out[0].sourceRef).toBe("T-1");
    expect(out[0].source).toBe("GeM");
    expect(out[0].detectedAt).toBe("2026-06-20T00:00:00Z");
    expect(out[0].evidence.length).toBeGreaterThan(0);
  });

  it("emits both LIVE and AMENDED for an amendment that matches, when both approved", () => {
    const out = detectTenderSignals({ ...base, isAmendment: true }, approvedBoth, TENDER_KEYWORDS);
    expect(out.map((o) => o.signalId).sort()).toEqual([TENDER_AMENDED_SIGNAL, TENDER_LIVE_SIGNAL].sort());
  });

  it("emits nothing when no keyword matches", () => {
    const out = detectTenderSignals(
      { ...base, title: "Construction of rural road", description: undefined, keywordsText: undefined },
      approvedBoth,
      TENDER_KEYWORDS,
    );
    expect(out).toHaveLength(0);
  });

  it("does not emit a signal that is not approved", () => {
    const out = detectTenderSignals({ ...base, isAmendment: true }, new Set([TENDER_AMENDED_SIGNAL]), TENDER_KEYWORDS);
    expect(out.map((o) => o.signalId)).toEqual([TENDER_AMENDED_SIGNAL]);
  });
});
