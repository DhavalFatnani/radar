import { jobPostingRecordSchema, type JobSourceAdapter, type JobPostingRecord } from "@/lib/sourcing/jobs-schema";
import rawJobs from "../fixtures/jobs-sample.json";

/**
 * Fixture-first job-board adapter. Reads recorded job postings (no network),
 * validates each against jobPostingRecordSchema, and reports how many were malformed.
 * Pass `raw` to inject a custom posting set (used by tests).
 */
export function createJobBoardFixtureAdapter(raw: unknown[] = rawJobs as unknown[]): JobSourceAdapter {
  return {
    sourceName: "jobboard-fixture",
    async fetch() {
      const records: JobPostingRecord[] = [];
      let skippedMalformed = 0;
      for (const entry of raw) {
        const parsed = jobPostingRecordSchema.safeParse(entry);
        if (parsed.success) records.push(parsed.data);
        else skippedMalformed++;
      }
      return { records, skippedMalformed };
    },
  };
}
