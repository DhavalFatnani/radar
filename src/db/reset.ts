import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { config } from "dotenv";

config({ path: ".env.local" });

// Reset uses the DIRECT (unpooled) endpoint — DROP SCHEMA / DDL is unreliable over PgBouncer.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is required for db:reset");

const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client);

(async () => {
  // Drop BOTH public (tables) AND drizzle (the migration journal) — otherwise the
  // surviving journal makes migrate() think every migration is applied and it
  // re-creates nothing, so a repeat reset would leave an empty `public`.
  await db.execute(
    sql.raw(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
    ),
  );
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await client.end();
  console.log("Reset complete: public + drizzle schemas dropped and migrations re-applied.");
})();
