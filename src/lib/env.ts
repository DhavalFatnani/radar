import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(["development", "test", "production"]).default("development"),
  ),
  // Slice 2: the data layer requires a Postgres connection string (pooled, app runtime).
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().url()),
  // Direct (unpooled) connection — used by drizzle-kit for migrations. Falls back to DATABASE_URL.
  DIRECT_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  // Dedicated test database (a Neon branch). Falls back to DIRECT_URL/DATABASE_URL.
  TEST_DATABASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OUTREACH_FROM_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(
  source: NodeJS.ProcessEnv | Record<string, unknown>,
): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    // Note: reports which vars failed and why, without echoing their values.
    throw new Error(`Invalid environment variables: ${issues}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
