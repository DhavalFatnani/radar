import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { loadEnvConfig } from "@next/env";
import { escapeEnvValue } from "../../../scripts/hash-password.mjs";

const silent = { info() {}, error() {} };

describe("escapeEnvValue", () => {
  it("escapes every $ as \\$", () => {
    expect(escapeEnvValue("$2b$12$abcDEF.ghi")).toBe("\\$2b\\$12\\$abcDEF.ghi");
  });

  it("leaves values without $ unchanged", () => {
    expect(escapeEnvValue("no-dollars-here")).toBe("no-dollars-here");
  });
});

// Regression for the dotenv-expand corruption: Next.js loads env through
// @next/env, which runs dotenv-expand. An unescaped bcrypt hash ($2b$12$...)
// gets $2b/$12/... expanded into empty variables; the escaped form must survive.
describe("bcrypt hash through @next/env", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
    delete process.env.RADAR_TEST_HASH;
  });

  // Write to `.env` (not `.env.local`): @next/env skips `.env.local` when
  // NODE_ENV=test, which vitest sets — `.env` is read in every mode.
  function loadHash(rawLine: string): string | undefined {
    const dir = mkdtempSync(join(tmpdir(), "radar-env-"));
    dirs.push(dir);
    writeFileSync(join(dir, ".env"), `RADAR_TEST_HASH=${rawLine}\n`);
    loadEnvConfig(dir, true, silent, true);
    return process.env.RADAR_TEST_HASH;
  }

  it("verifies the password when the hash is escaped", async () => {
    const password = "round-trip-pw";
    const hash = await bcrypt.hash(password, 10);

    const loaded = loadHash(escapeEnvValue(hash));

    expect(loaded).toBe(hash);
    expect(await bcrypt.compare(password, loaded!)).toBe(true);
  });

  it("corrupts the hash when it is NOT escaped (documents the bug)", async () => {
    const password = "round-trip-pw";
    const hash = await bcrypt.hash(password, 10);

    const loaded = loadHash(hash);

    expect(loaded).not.toBe(hash);
    expect(await bcrypt.compare(password, loaded ?? "")).toBe(false);
  });
});
