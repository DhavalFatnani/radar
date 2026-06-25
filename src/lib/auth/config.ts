import type { NextAuthConfig } from "next-auth";

// Public paths reachable without a session. Everything else requires auth.
const PUBLIC_PATHS = new Set(["/", "/login"]);

// Edge-safe config: pure logic only — NO bcrypt, NO Node-only imports. Shared
// by middleware.ts (Edge) and extended by the Node instance in ./index.ts.
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [], // the Credentials provider (Node + bcrypt) is added in ./index.ts
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/api/auth")) return true;
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
