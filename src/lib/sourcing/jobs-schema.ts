import { z } from "zod";
import { normalizeCompanyName } from "@/lib/sourcing/schema";

export const SIG_HIRING_OPS_SURGE = "SIG-HIRING-OPS-SURGE";
export const SIG_HIRING_SENIOR_OPS = "SIG-HIRING-SENIOR-OPS";
export const SIG_HIRING_FIELD_MKTG = "SIG-HIRING-FIELD-MKTG";

/** Operations role-title keywords (lower-case). Whole-word for single tokens, phrase-substring for multi-word. */
export const OPS_ROLE_KEYWORDS = [
  "warehouse", "operations", "logistics", "fulfilment", "fulfillment", "supply chain", "ops",
] as const;

/** Seniority markers that make an ops posting a senior-ops leadership role. */
export const SENIOR_OPS_SENIORITY_KEYWORDS = [
  "head", "vp", "vice president", "director", "chief",
] as const;

/** Field-marketing role-title keywords (lower-case). */
export const FIELD_MKTG_KEYWORDS = [
  "promoter", "field marketing", "store launch", "merchandiser", "btl",
] as const;

/** Minimum matching in-window roles per company to fire an aggregate surge signal. */
export const OPS_SURGE_THRESHOLD = 5;
export const FIELD_MKTG_THRESHOLD = 3;

/** A parseable date string (ISO-8601 or anything Date.parse accepts). */
const dateString = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid date" });

/** One normalized job posting produced by a job-board adapter. */
export const jobPostingRecordSchema = z.object({
  ref: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  city: z.string().optional(),
  url: z.string().url().optional(),
  postedAt: dateString,
  sourceName: z.string().min(1),
});
export type JobPostingRecord = z.infer<typeof jobPostingRecordSchema>;

/** The extensibility seam every job-board adapter implements. */
export interface JobSourceAdapter {
  readonly sourceName: string;
  fetch(): Promise<{ records: JobPostingRecord[]; skippedMalformed: number }>;
}

/** A hiring signal detected from job postings, ready to persist as an observation. */
export type DetectedHiringObservation = {
  signalId: string;
  sourceRef: string;
  source: string;
  detectedAt: string;
  evidence: string[];
  companyName: string;
};

/** Lower-case + collapse non-alphanumerics to single spaces, so "field-marketing" matches "field marketing". */
function titleTokens(title: string): { norm: string; words: string[] } {
  const norm = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return { norm, words: norm.split(" ").filter(Boolean) };
}

/** True if the title contains any term — phrase substring for multi-word terms, whole-word for single tokens. */
function titleMatches(title: string, terms: readonly string[]): boolean {
  const { norm, words } = titleTokens(title);
  return terms.some((term) => (term.includes(" ") ? norm.includes(term) : words.includes(term)));
}

/** Postings within the rolling window; when windowDays is null the window is not applied. */
function withinWindow(postedAt: string, windowDays: number | null, now: Date): boolean {
  if (windowDays == null) return true;
  const ageMs = now.getTime() - Date.parse(postedAt);
  return ageMs <= windowDays * 24 * 60 * 60 * 1000;
}

/** The most-recent posting (max postedAt) in a non-empty group — anchors an aggregate observation. */
function mostRecent(posts: JobPostingRecord[]): JobPostingRecord {
  return posts.reduce((a, b) => (Date.parse(b.postedAt) > Date.parse(a.postedAt) ? b : a));
}

/** Emit one aggregate surge observation per company at/over the threshold, within the window. */
function detectSurge(
  postings: JobPostingRecord[],
  signalId: string,
  keywords: readonly string[],
  threshold: number,
  windowDays: number | null,
  now: Date,
): DetectedHiringObservation[] {
  const matching = postings.filter(
    (p) => titleMatches(p.title, keywords) && withinWindow(p.postedAt, windowDays, now),
  );
  const byCompany = new Map<string, { company: string; posts: JobPostingRecord[] }>();
  for (const p of matching) {
    const key = normalizeCompanyName(p.company);
    const group = byCompany.get(key) ?? { company: p.company, posts: [] };
    group.posts.push(p);
    byCompany.set(key, group);
  }
  const observations: DetectedHiringObservation[] = [];
  for (const { company, posts } of byCompany.values()) {
    if (posts.length < threshold) continue;
    const anchor = mostRecent(posts);
    observations.push({
      signalId,
      sourceRef: anchor.ref,
      source: anchor.sourceName,
      detectedAt: anchor.postedAt,
      evidence: [
        `${posts.length} matching roles`,
        ...posts.map((p) => p.title),
        ...(anchor.url ? [anchor.url] : []),
      ],
      companyName: company,
    });
  }
  return observations;
}

/**
 * PURE hiring detector. Emits:
 *  - SIG-HIRING-SENIOR-OPS per posting whose title carries a seniority marker AND an ops-role keyword;
 *  - SIG-HIRING-OPS-SURGE / SIG-HIRING-FIELD-MKTG once per company whose in-window matching postings
 *    reach the threshold.
 * Only approved signals emit. Signals are independent lenses — a posting may contribute to more than
 * one. Evidence is always non-empty; detectedAt and sourceRef are always drawn from a real posting
 * (no fabrication).
 */
export function detectHiringSignals(
  postings: JobPostingRecord[],
  approvedSignalIds: Set<string>,
  windowBySignal: Map<string, number | null>,
  now: Date,
): DetectedHiringObservation[] {
  const observations: DetectedHiringObservation[] = [];

  if (approvedSignalIds.has(SIG_HIRING_SENIOR_OPS)) {
    for (const p of postings) {
      if (titleMatches(p.title, SENIOR_OPS_SENIORITY_KEYWORDS) && titleMatches(p.title, OPS_ROLE_KEYWORDS)) {
        observations.push({
          signalId: SIG_HIRING_SENIOR_OPS,
          sourceRef: p.ref,
          source: p.sourceName,
          detectedAt: p.postedAt,
          evidence: [
            p.title,
            `ref: ${p.ref}`,
            ...(p.city ? [`city: ${p.city}`] : []),
            ...(p.url ? [p.url] : []),
          ],
          companyName: p.company,
        });
      }
    }
  }

  if (approvedSignalIds.has(SIG_HIRING_OPS_SURGE)) {
    observations.push(
      ...detectSurge(
        postings, SIG_HIRING_OPS_SURGE, OPS_ROLE_KEYWORDS, OPS_SURGE_THRESHOLD,
        windowBySignal.get(SIG_HIRING_OPS_SURGE) ?? null, now,
      ),
    );
  }

  if (approvedSignalIds.has(SIG_HIRING_FIELD_MKTG)) {
    observations.push(
      ...detectSurge(
        postings, SIG_HIRING_FIELD_MKTG, FIELD_MKTG_KEYWORDS, FIELD_MKTG_THRESHOLD,
        windowBySignal.get(SIG_HIRING_FIELD_MKTG) ?? null, now,
      ),
    );
  }

  return observations;
}
