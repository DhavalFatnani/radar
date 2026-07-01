import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createVendorStub } from "@/lib/vendors/data";
import {
  createInterview,
  getInterview,
  getActiveInterview,
  listInterviews,
  appendMessages,
  completeInterview,
  abandonInterview,
} from "@/lib/interviews/data";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["vendor_interviews", "vendor_profiles"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("interviews data layer", () => {
  it("creates an in-progress interview and finds it as active", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    expect(iv.status).toBe("in_progress");
    expect(iv.messages).toEqual([]);
    const active = await getActiveInterview(vendorId);
    expect(active?.interviewId).toBe(iv.interviewId);
  });

  it("appends messages atomically, preserving order", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    await appendMessages(iv.interviewId, [{ role: "assistant", content: "What do you do?\n[area:capabilities]" }]);
    await appendMessages(iv.interviewId, [{ role: "user", content: "We do warehouse racking." }]);
    const got = await getInterview(iv.interviewId);
    expect(got?.messages.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(got?.messages[1].content).toContain("racking");
  });

  it("lists interviews newest-first with a message count and no transcript", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    await appendMessages(iv.interviewId, [
      { role: "assistant", content: "Q1\n[area:capabilities]" },
      { role: "user", content: "an answer that is long enough" },
    ]);
    const list = await listInterviews(vendorId);
    expect(list).toHaveLength(1);
    expect(list[0].messageCount).toBe(2);
    expect(list[0]).not.toHaveProperty("messages");
  });

  it("completeInterview records version + provider and frees the active slot", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    await completeInterview(iv.interviewId, 3, "anthropic");
    const got = await getInterview(iv.interviewId);
    expect(got?.status).toBe("completed");
    expect(got?.resultingVersion).toBe(3);
    expect(got?.provider).toBe("anthropic");
    expect(got?.completedAt).not.toBeNull();
    expect(await getActiveInterview(vendorId)).toBeNull();
  });

  it("abandonInterview frees the active slot", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    await abandonInterview(iv.interviewId);
    const got = await getInterview(iv.interviewId);
    expect(got?.status).toBe("abandoned");
    expect(await getActiveInterview(vendorId)).toBeNull();
  });

  it("throws when appending to a non-existent interview", async () => {
    await expect(
      appendMessages("00000000-0000-0000-0000-000000000000", [{ role: "user", content: "x" }]),
    ).rejects.toThrow(/no interview/i);
  });
});
