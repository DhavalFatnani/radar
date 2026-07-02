import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import type { DB } from "./client";
import { contactsStubResolver } from "../lib/sourcing/adapters/contacts-stub";
import { resolveContactsForLeads, type ResolveContactsResult } from "../lib/sourcing/contacts";

/**
 * On-demand contact-resolution run: populate leads.contact_block for every lead that
 * does not have one yet, delegating to the injected resolver. The caller owns the
 * connection lifecycle. The stub resolves no contacts (every lead → pending_enrichment);
 * a real enrichment vendor is a drop-in ContactResolver swapped in here later.
 */
export async function runContactResolution(db: DB): Promise<ResolveContactsResult> {
  return resolveContactsForLeads(db, contactsStubResolver);
}

// Allow `npm run db:contacts:resolve` to execute directly.
if (process.argv[1] && process.argv[1].endsWith("resolve-contacts.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:contacts:resolve");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  runContactResolution(db)
    .then((result) => {
      console.log("Contact resolution complete:", JSON.stringify(result));
      return client.end();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Contact resolution failed:", e);
      process.exit(1);
    });
}
