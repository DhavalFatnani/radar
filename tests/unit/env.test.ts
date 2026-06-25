import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

const DB = "postgresql://u:p@host/db?sslmode=require";

describe("parseEnv", () => {
  it("defaults NODE_ENV and accepts a DATABASE_URL", () => {
    const env = parseEnv({ DATABASE_URL: DB });
    expect(env.NODE_ENV).toBe("development");
    expect(env.DATABASE_URL).toBe(DB);
    expect(env.TEST_DATABASE_URL).toBeUndefined();
  });

  it("accepts NODE_ENV and TEST_DATABASE_URL", () => {
    const env = parseEnv({ NODE_ENV: "test", DATABASE_URL: DB, TEST_DATABASE_URL: DB });
    expect(env.NODE_ENV).toBe("test");
    expect(env.TEST_DATABASE_URL).toBe(DB);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/Invalid environment variables/);
  });

  it("rejects an empty DATABASE_URL (treated as missing)", () => {
    expect(() => parseEnv({ DATABASE_URL: "" })).toThrow(/Invalid environment variables/);
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() => parseEnv({ NODE_ENV: "staging", DATABASE_URL: DB })).toThrow(
      /Invalid environment variables/,
    );
  });

  it("rejects a non-URL DATABASE_URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "not-a-url" })).toThrow(
      /Invalid environment variables/,
    );
  });
});
