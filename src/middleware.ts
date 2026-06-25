import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/config";

// Edge middleware: instantiate NextAuth with ONLY the Edge-safe config (no
// Credentials provider / bcrypt). `.auth` enforces the authorized callback and
// redirects unauthenticated requests to pages.signIn (/login).
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Run on every route EXCEPT Next internals, static assets, the Auth.js API,
  // and the public healthcheck.
  matcher: ["/((?!api/auth|api/v1/health|_next/static|_next/image|favicon.ico).*)"],
};
