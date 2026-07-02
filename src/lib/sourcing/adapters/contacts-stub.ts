import type { ContactResolver } from "@/lib/sourcing/contacts-schema";

/**
 * Deterministic placeholder resolver: resolves no decision-makers, so every lead
 * lands in pending_enrichment. A real external resolver (Apollo / Clearbit / ...)
 * is a drop-in ContactResolver added later — no change to the data layer, the
 * persisted contract, or the UI.
 */
export const contactsStubResolver: ContactResolver = {
  sourceName: "stub",
  async resolve() {
    return { decisionMakers: [] };
  },
};
