import { config } from "dotenv";

// Load real env for integration tests (DATABASE_URL / TEST_DATABASE_URL).
config({ path: ".env.local" });
config({ path: ".env.test", override: true });

// Integration tests must never touch the dev/app database. When a dedicated
// test branch is configured, point the app's db client (which reads
// DATABASE_URL) at it too, so server actions / route handlers and the testDb
// helper share ONE database.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
