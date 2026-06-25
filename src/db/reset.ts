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
  await db.execute(sql.raw("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"));
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await client.end();
  console.log("Reset complete: public schema dropped and migrations re-applied.");
})();
