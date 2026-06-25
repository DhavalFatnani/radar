import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { verifyOperator, type Operator } from "@/lib/auth/verify-operator";

const PASSWORD = "correct-horse-battery-staple";
let operator: Operator;

beforeAll(async () => {
  operator = { email: "op@example.com", passwordHash: await bcrypt.hash(PASSWORD, 10) };
});

describe("verifyOperator", () => {
  it("returns the operator user for correct email + password", async () => {
    const user = await verifyOperator({ email: "op@example.com", password: PASSWORD }, operator);
    expect(user).toEqual({ id: "operator", email: "op@example.com" });
  });

  it("matches email case-insensitively", async () => {
    const user = await verifyOperator({ email: "OP@Example.Com", password: PASSWORD }, operator);
    expect(user?.email).toBe("op@example.com");
  });

  it("returns null for a wrong password", async () => {
    expect(await verifyOperator({ email: "op@example.com", password: "wrong" }, operator)).toBeNull();
  });

  it("returns null for a wrong email", async () => {
    expect(await verifyOperator({ email: "other@example.com", password: PASSWORD }, operator)).toBeNull();
  });

  it("returns null for missing or non-string fields", async () => {
    expect(await verifyOperator({}, operator)).toBeNull();
    expect(await verifyOperator({ email: 123, password: PASSWORD }, operator)).toBeNull();
  });
});

import { parseAuthEnv } from "@/lib/auth/env";

describe("parseAuthEnv", () => {
  const valid = {
    AUTH_SECRET: "x".repeat(32),
    OPERATOR_EMAIL: "op@example.com",
    OPERATOR_PASSWORD_HASH: "$2a$10$abcdefghijklmnopqrstuv",
  };

  it("accepts valid auth env", () => {
    expect(parseAuthEnv(valid)).toEqual(valid);
  });

  it("rejects a missing AUTH_SECRET", () => {
    expect(() => parseAuthEnv({ ...valid, AUTH_SECRET: "" })).toThrow(/Invalid auth environment/);
  });

  it("rejects a non-email OPERATOR_EMAIL", () => {
    expect(() => parseAuthEnv({ ...valid, OPERATOR_EMAIL: "nope" })).toThrow(/Invalid auth environment/);
  });
});
