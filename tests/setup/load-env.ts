import { config } from "dotenv";

// Load real env for integration tests (DATABASE_URL / TEST_DATABASE_URL).
config({ path: ".env.local" });
config({ path: ".env.test", override: true });
