import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  // Migrations use the DIRECT (unpooled) endpoint — PgBouncer breaks some DDL/prepared statements.
  dbCredentials: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
