import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./config";
import { parseAuthEnv } from "./env";
import { verifyOperator } from "./verify-operator";

// Parsed at module load — index.ts is only imported by the NextAuth runtime
// (app/build), never by unit tests, so requiring auth env here is safe.
const authEnv = parseAuthEnv(process.env);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: authEnv.AUTH_SECRET,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: (credentials) =>
        verifyOperator(
          { email: credentials?.email, password: credentials?.password },
          { email: authEnv.OPERATOR_EMAIL, passwordHash: authEnv.OPERATOR_PASSWORD_HASH },
        ),
    }),
  ],
});
