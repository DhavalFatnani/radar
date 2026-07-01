import { describe, it, expect, beforeAll, afterEach, afterAll, vi, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/ai/sia", () => ({
  nextQuestion: vi.fn(),
  extractProfile: vi.fn(),
  assessCoverage: vi.fn(() => ({ covered: [], remaining: ["capabilities"], isComplete: false })),
  stripAreaTag: (t: string) => t.replace(/\n?\[area:[A-Za-z]+\]\s*$/, "").trimEnd(),
}));

import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createVendorStub, getVendor } from "@/lib/vendors/data";
import { createInterview, getInterview, getActiveInterview } from "@/lib/interviews/data";
import { nextQuestion, extractProfile } from "@/ai/sia";
import {
  startInterview,
  submitAnswer,
  saveInterview,
  endInterview,
} from "@/app/(app)/vendors/[vendorId]/interview/actions";
import type { VendorProfileInput } from "@/lib/vendors/schema";

function q(question: string, area = "capabilities") {
  return {
    question,
    transcriptEntry: { role: "assistant", content: `${question}\n[area:${area}]` },
    targetArea: area,
    coverage: { covered: [], remaining: ["capabilities"], isComplete: false },
  };
}
function baseInput(name: string): VendorProfileInput {
  return {
    name,
    capabilities: ["warehouse racking"],
    constraints: {},
    idealCustomer: undefined,
    knownGoodSignals: undefined,
    differentiators: undefined,
    credibility: undefined,
  };
}

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  vi.clearAllMocks();
  await truncateAll(["catalogue_edges", "catalogue_nodes", "vendor_interviews", "vendor_profiles"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("interview actions", () => {
  it("startInterview creates a session and persists the first question", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    (nextQuestion as Mock).mockResolvedValue(q("What does your company do?"));
    const res = await startInterview(vendorId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pendingQuestion).toBe("What does your company do?");
    const active = await getActiveInterview(vendorId);
    expect(active?.messages).toHaveLength(1);
  });

  it("submitAnswer persists the answer then the next question", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    (nextQuestion as Mock).mockResolvedValue(q("Which geographies?", "constraints"));
    const res = await submitAnswer(iv.interviewId, "We do racking up to 12 tonnes per bay.");
    expect(res.ok).toBe(true);
    const got = await getInterview(iv.interviewId);
    expect(got?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("submitAnswer keeps the answer even when SIA fails", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    (nextQuestion as Mock).mockRejectedValue(new Error("all providers down"));
    const res = await submitAnswer(iv.interviewId, "We do racking up to 12 tonnes per bay.");
    expect(res.ok).toBe(false);
    const got = await getInterview(iv.interviewId);
    expect(got?.messages).toHaveLength(1);
    expect(got?.messages[0].role).toBe("user");
  });

  it("saveInterview extracts, versions the profile, and completes the interview", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    (extractProfile as Mock).mockResolvedValue({ value: baseInput("Acme"), provider: "anthropic" });
    const res = await saveInterview(iv.interviewId);
    expect(res).toEqual({ ok: true, version: 2 });
    const got = await getInterview(iv.interviewId);
    expect(got?.status).toBe("completed");
    expect(got?.resultingVersion).toBe(2);
    const vendor = await getVendor(vendorId);
    expect(vendor?.version).toBe(2);
    expect(vendor?.interviewHistory.at(-1)?.kind).toBe("interview");
  });

  it("endInterview abandons the active session", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    await endInterview(iv.interviewId);
    expect(await getActiveInterview(vendorId)).toBeNull();
  });

  it("rejects an unauthenticated caller", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as Mock).mockResolvedValueOnce(null);
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const res = await startInterview(vendorId);
    expect(res.ok).toBe(false);
  });
});
