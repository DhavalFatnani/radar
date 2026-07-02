import { tenderRecordSchema, type SourceAdapter, type TenderRecord } from "@/lib/sourcing/schema";
import rawTenders from "../fixtures/tenders-sample.json";

/**
 * Fixture-first tender adapter. Reads recorded tender records (no network),
 * validates each against tenderRecordSchema, and reports how many were malformed.
 * Pass `raw` to inject a custom record set (used by tests).
 */
export function createTenderFixtureAdapter(raw: unknown[] = rawTenders as unknown[]): SourceAdapter {
  return {
    sourceName: "tender-fixture",
    async fetch() {
      const records: TenderRecord[] = [];
      let skippedMalformed = 0;
      for (const entry of raw) {
        const parsed = tenderRecordSchema.safeParse(entry);
        if (parsed.success) records.push(parsed.data);
        else skippedMalformed++;
      }
      return { records, skippedMalformed };
    },
  };
}
