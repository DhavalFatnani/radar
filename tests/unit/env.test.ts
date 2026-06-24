import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("applies defaults when optional values are absent", () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("accepts a valid NODE_ENV and DATABASE_URL", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:p@host/db?sslmode=require",
    });
    expect(env.NODE_ENV).toBe("production");
    expect(env.DATABASE_URL).toBe("postgresql://u:p@host/db?sslmode=require");
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() => parseEnv({ NODE_ENV: "staging" })).toThrow(
      /Invalid environment variables/,
    );
  });

  it("rejects a non-URL DATABASE_URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "not-a-url" })).toThrow(
      /Invalid environment variables/,
    );
  });

  it("treats an empty DATABASE_URL as absent", () => {
    const env = parseEnv({ DATABASE_URL: "" });
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("treats an empty NODE_ENV as the default", () => {
    const env = parseEnv({ NODE_ENV: "" });
    expect(env.NODE_ENV).toBe("development");
  });
});
