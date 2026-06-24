import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(["development", "test", "production"]).default("development"),
  ),
  // Slice 1: Neon connection string is wired but optional (no DB usage yet).
  // Slice 2 (data layer) tightens this to required.
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
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
