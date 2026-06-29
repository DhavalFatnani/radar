// Usage: node scripts/hash-password.mjs '<password>'
// Prints an .env-ready bcrypt hash for OPERATOR_PASSWORD_HASH. Every `$` is
// backslash-escaped (\$) because Next.js loads env via @next/env, which runs
// dotenv-expand — an unescaped hash like $2b$12$... would have $2b/$12/...
// expanded into (empty) variables, corrupting the value so login always fails.
// Paste the output verbatim into .env.local. The password is never stored.
import bcrypt from "bcryptjs";
import { argv, exit } from "node:process";
import { pathToFileURL } from "node:url";

// Escape `$` as `\$` so dotenv-expand keeps the value literal in .env files.
export function escapeEnvValue(value) {
  return value.replace(/\$/g, "\\$");
}

// Run the CLI only when invoked directly, so tests can import escapeEnvValue
// without triggering a hash + print.
if (import.meta.url === pathToFileURL(argv[1]).href) {
  const password = argv[2];
  if (!password) {
    console.error("Usage: node scripts/hash-password.mjs '<password>'");
    exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  console.log(escapeEnvValue(hash));
}
