import { describe, it, expect } from "vitest";
import { authConfig } from "@/lib/auth/config";

// The authorized callback is the route-protection decision. Mock the minimal
// NextRequest shape it reads (nextUrl.pathname).
const authorized = authConfig.callbacks!.authorized!;
const call = (pathname: string, user: { email: string } | null) =>
  authorized({
    auth: user ? ({ user } as never) : null,
    request: { nextUrl: { pathname } } as never,
  } as never);

describe("authorized callback (route protection)", () => {
  it("allows public paths with no session", async () => {
    expect(await call("/", null)).toBe(true);
    expect(await call("/login", null)).toBe(true);
  });

  it("allows the Auth.js API with no session", async () => {
    expect(await call("/api/auth/callback/credentials", null)).toBe(true);
  });

  it("denies protected routes with no session", async () => {
    expect(await call("/dashboard", null)).toBe(false);
    expect(await call("/vendors", null)).toBe(false);
  });

  it("allows protected routes when a session exists", async () => {
    expect(await call("/dashboard", { email: "op@example.com" })).toBe(true);
  });
});
