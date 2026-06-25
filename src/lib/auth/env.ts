import { z } from "zod";

// Auth env validated HERE (not src/lib/env.ts). No module-level singleton —
// the Node NextAuth instance (./index.ts) calls parseAuthEnv(process.env) at
// load. Unit tests import parseAuthEnv directly with explicit objects, so they
// need no AUTH_SECRET/OPERATOR_* set.
const authEnvSchema = z.object({
  AUTH_SECRET: z.string().min(1),
  OPERATOR_EMAIL: z.string().email(),
  OPERATOR_PASSWORD_HASH: z.string().min(1),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

export function parseAuthEnv(source: NodeJS.ProcessEnv | Record<string, unknown>): AuthEnv {
  const result = authEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid auth environment variables: ${issues}`);
  }
  return result.data;
}
