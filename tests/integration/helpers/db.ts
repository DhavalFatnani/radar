import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

const url = process.env.TEST_DATABASE_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("No TEST_DATABASE_URL/DIRECT_URL/DATABASE_URL set for integration tests");

// `max: 1` = deterministic single connection; `prepare: false` is safe on pooled or direct.
const client = postgres(url, { max: 1, prepare: false });
export const testDb = drizzle(client, { schema });

export async function migrateTestDb() {
  await migrate(testDb, { migrationsFolder: "./src/db/migrations" });
}

// Truncate every table between tests (RESTART IDENTITY + CASCADE for FKs).
export async function truncateAll(tables: string[]) {
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t}"`).join(", ");
  await testDb.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`));
}

export async function closeTestDb() {
  await client.end();
}
