import { z } from "zod";

// Auth env is validated HERE (not in src/lib/env.ts) so the DB layer and its
// tests stay decoupled from auth config. Evaluated only when the Node NextAuth
// instance (./index.ts) is imported — app runtime/build, never the unit tests.
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

// Lazy singleton — only validated on first access so the module can be imported
// (e.g. for parseAuthEnv) without auth env vars present (unit tests, DB-only code).
let _authEnv: AuthEnv | undefined;
export const authEnv: AuthEnv = new Proxy({} as AuthEnv, {
  get(_target, prop) {
    if (!_authEnv) {
      _authEnv = parseAuthEnv(process.env);
    }
    return _authEnv[prop as keyof AuthEnv];
  },
});
