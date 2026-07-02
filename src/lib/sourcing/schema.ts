import { z } from "zod";

/**
 * Vendor keywords for slice 1 — copied from the SIG-TENDER-LIVE seed trigger rule.
 * STOPGAP: later slices derive these from the vendor catalogue. Lower-cased for
 * case-insensitive matching in detectTenderSignals.
 */
export const TENDER_KEYWORDS = ["racking", "cctv", "it hardware", "signage", "printing"] as const;

export const TENDER_LIVE_SIGNAL = "SIG-TENDER-LIVE";
export const TENDER_AMENDED_SIGNAL = "SIG-TENDER-AMENDED";

/** A parseable date string (ISO-8601 or anything Date.parse accepts). */
const dateString = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid date" });

/** One normalized tender record produced by a source adapter. */
export const tenderRecordSchema = z.object({
  ref: z.string().min(1),
  title: z.string().min(1),
  issuingBody: z.string().min(1),
  description: z.string().optional(),
  keywordsText: z.string().optional(),
  publishedAt: dateString,
  deadline: z.string().optional(),
  url: z.string().url().optional(),
  isAmendment: z.boolean().optional(),
  sourceName: z.string().min(1),
});
export type TenderRecord = z.infer<typeof tenderRecordSchema>;

/** The extensibility seam every source adapter implements. */
export interface SourceAdapter {
  readonly sourceName: string;
  fetch(): Promise<{ records: TenderRecord[]; skippedMalformed: number }>;
}

/** A signal detected from one tender record, ready to persist as an observation. */
export type DetectedObservation = {
  signalId: string;
  sourceRef: string;
  source: string;
  detectedAt: string;
  evidence: string[];
  issuingBody: string;
};

export type FreshnessVerdict = "recent" | "stale" | null;

/** Deterministic company-name normalization for entity dedup. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

/**
 * "recent" if the observation is within the signal's freshness window, else "stale".
 * null when the window is undefined so we never assert freshness we cannot compute.
 */
export function computeFreshnessVerdict(
  detectedAt: Date,
  windowDays: number | null,
  now: Date,
): FreshnessVerdict {
  if (windowDays == null) return null;
  const ageMs = now.getTime() - detectedAt.getTime();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  return ageMs <= windowMs ? "recent" : "stale";
}

/**
 * PURE tender detector. Matches record text against vendor keywords (case-insensitive).
 * On a match emits SIG-TENDER-LIVE (if approved); if the record is an amendment it also
 * emits SIG-TENDER-AMENDED (if approved). Emits nothing on no match or an unapproved signal.
 * Evidence is always non-empty (the proof principle).
 */
export function detectTenderSignals(
  record: TenderRecord,
  approvedSignalIds: Set<string>,
  keywords: readonly string[],
): DetectedObservation[] {
  const haystack = [record.title, record.description ?? "", record.keywordsText ?? ""]
    .join(" ")
    .toLowerCase();
  const matched = keywords.filter((k) => haystack.includes(k.toLowerCase()));
  if (matched.length === 0) return [];

  const evidence = [
    record.title,
    `ref: ${record.ref}`,
    `matched: ${matched.join(", ")}`,
    ...(record.url ? [record.url] : []),
  ];

  const observations: DetectedObservation[] = [];
  if (approvedSignalIds.has(TENDER_LIVE_SIGNAL)) {
    observations.push({
      signalId: TENDER_LIVE_SIGNAL,
      sourceRef: record.ref,
      source: record.sourceName,
      detectedAt: record.publishedAt,
      evidence,
      issuingBody: record.issuingBody,
    });
  }
  if (record.isAmendment && approvedSignalIds.has(TENDER_AMENDED_SIGNAL)) {
    observations.push({
      signalId: TENDER_AMENDED_SIGNAL,
      sourceRef: record.ref,
      source: record.sourceName,
      detectedAt: record.publishedAt,
      evidence: [...evidence, "amendment/corrigendum"],
      issuingBody: record.issuingBody,
    });
  }
  return observations;
}
