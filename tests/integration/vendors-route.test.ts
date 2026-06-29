import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { vendorProfiles } from "@/db/schema";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { GET } from "@/app/api/v1/vendors/route";
import { createVendor } from "@/app/(app)/vendors/actions";
import { auth } from "@/lib/auth";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["vendor_profiles"]);
  vi.clearAllMocks();
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("GET /api/v1/vendors", () => {
  it("returns persisted vendors as { data }", async () => {
    await testDb.insert(vendorProfiles).values({ name: "Acme" });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((v: { name: string }) => v.name)).toContain("Acme");
  });

  it("returns 401 { error, code } when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
  });
});

describe("end-to-end: create-then-read through the stack", () => {
  it("a vendor created via the action is returned by the route", async () => {
    const fd = new FormData();
    fd.set("name", "Northwind Traders");
    const err = await createVendor(undefined, fd);
    expect(err).toBeUndefined();

    // DB-level read-back
    const rows = await testDb.select().from(vendorProfiles);
    expect(rows.map((v) => v.name)).toContain("Northwind Traders");

    // API-level read-back
    const res = await GET();
    const body = await res.json();
    expect(body.data.map((v: { name: string }) => v.name)).toContain("Northwind Traders");
  });
});
