import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env";       // relative: this file also runs under tsx (db:seed/db:reset)
import * as schema from "./schema";

// Single shared connection for app/runtime use.
// `prepare: false` is REQUIRED over Neon's pooled (PgBouncer) endpoint.
const queryClient = postgres(env.DATABASE_URL, { prepare: false });
export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
