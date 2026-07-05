import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/outreach/sender", () => ({
  sendEmail: vi.fn(async () => ({ ok: true, id: "msg_1" })),
  isSendConfigured: vi.fn(() => true),
}));

import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { leads, companies, vendorProfiles } from "@/db/schema";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { sendEmail, isSendConfigured } from "@/lib/outreach/sender";
import { sendOutreachAction } from "@/app/(app)/leads/actions";

const DEFAULT_CONTACT_BLOCK = {
  decision_makers: [
    {
      name: "Dana Smith",
      role: "VP of Operations",
      why: "Key decision-maker",
      paths: [{ type: "email", val: "dana@acme.test", conf: "high", source: "linkedin" }],
      warm: { status: "cold", detail: null },
    },
  ],
  status: "resolved",
  resolvedBy: "test",
  resolvedAt: "2026-01-01T00:00:00Z",
};

const PHONE_ONLY_CONTACT_BLOCK = {
  decision_makers: [
    {
      name: "Dana Smith",
      role: "VP of Operations",
      why: "Key decision-maker",
      paths: [{ type: "phone", val: "+1", conf: null, source: null }],
      warm: { status: "cold", detail: null },
    },
  ],
  status: "resolved",
  resolvedBy: "test",
  resolvedAt: "2026-01-01T00:00:00Z",
};

interface SeedOpts {
  outreachStatus?: string;
  outreachMode?: string;
  outreachDraft?: { subject: string; body: string } | null;
  contactBlock?: object | null;
}

async function makeLead(opts: SeedOpts = {}): Promise<string> {
  const [company] = await testDb
    .insert(companies)
    .values({ name: "Zephyr Retail", normalizedName: "zephyr retail", description: "Retailer" })
    .returning();
  const [vendor] = await testDb
    .insert(vendorProfiles)
    .values({ name: "Acme Infra", vendorType: "Infra" })
    .returning();
  const [lead] = await testDb
    .insert(leads)
    .values({
      companyId: company.companyId,
      vendorId: vendor.vendorId,
      intent: "Warehouse buildout",
      outreachStatus: (opts.outreachStatus ?? "drafted") as "pending" | "drafted" | "sent",
      outreachMode:
        opts.outreachMode !== undefined
          ? (opts.outreachMode as "operator_handles" | "handed_to_vendor" | null)
          : "operator_handles",
      outreachDraft:
        opts.outreachDraft !== undefined
          ? opts.outreachDraft
          : { subject: "Hi", body: "Let's talk." },
      contactBlock:
        opts.contactBlock !== undefined ? opts.contactBlock : DEFAULT_CONTACT_BLOCK,
    })
    .returning();
  return lead.leadId;
}

beforeAll(async () => {
  await migrateTestDb();
});

beforeEach(() => {
  (sendEmail as Mock).mockResolvedValue({ ok: true, id: "msg_1" });
  (isSendConfigured as Mock).mockReturnValue(true);
  (auth as Mock).mockResolvedValue({ user: { email: "op@test" } });
});

afterEach(async () => {
  vi.clearAllMocks();
  await truncateAll(["leads", "vendor_profiles", "companies"]);
});

afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("sendOutreachAction", () => {
  it("case 1: unauthenticated — returns not-signed-in error, sendEmail not called, row unchanged", async () => {
    (auth as Mock).mockResolvedValueOnce(null);
    const id = await makeLead();
    const result = await sendOutreachAction(id);
    expect(result).toEqual({ ok: false, error: "Not signed in." });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, id));
    expect(row.outreachStatus).toBe("drafted");
  });

  it("case 2: unknown valid UUID — returns lead not found error, sendEmail not called", async () => {
    const result = await sendOutreachAction("00000000-0000-4000-8000-000000000000");
    expect(result).toEqual({ ok: false, error: "Lead not found." });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("case 3: no draft — returns generate-first error, sendEmail not called", async () => {
    const id = await makeLead({ outreachStatus: "pending", outreachDraft: null });
    const result = await sendOutreachAction(id);
    expect(result).toEqual({ ok: false, error: "Generate the draft first." });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("case 4: already sent — returns already-sent error, sendEmail not called", async () => {
    const id = await makeLead({ outreachStatus: "sent" });
    const result = await sendOutreachAction(id);
    expect(result).toEqual({ ok: false, error: "Already sent." });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("case 5: handed to vendor — returns disabled error, sendEmail not called", async () => {
    const id = await makeLead({ outreachMode: "handed_to_vendor" });
    const result = await sendOutreachAction(id);
    expect(result).toEqual({
      ok: false,
      error: "This lead is handed to the vendor; sending is disabled.",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("case 6: no email on file — returns no-email error, sendEmail not called", async () => {
    const id = await makeLead({ contactBlock: PHONE_ONLY_CONTACT_BLOCK });
    const result = await sendOutreachAction(id);
    expect(result).toEqual({ ok: false, error: "No email address on file for this lead." });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("case 7: not configured — returns not-configured error, sendEmail not called", async () => {
    (isSendConfigured as Mock).mockReturnValueOnce(false);
    const id = await makeLead();
    const result = await sendOutreachAction(id);
    expect(result).toEqual({ ok: false, error: "Email sending is not configured." });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("case 8: provider failure — returns provider error, row status unchanged, revalidatePath not called", async () => {
    (sendEmail as Mock).mockResolvedValueOnce({
      ok: false,
      error: "Sending failed. Check the email provider configuration.",
    });
    const id = await makeLead();
    const result = await sendOutreachAction(id);
    expect(result).toEqual({
      ok: false,
      error: "Sending failed. Check the email provider configuration.",
    });
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, id));
    expect(row.outreachStatus).toBe("drafted");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("case 9: success — sendEmail called with correct args, row marked sent, revalidatePath called", async () => {
    const id = await makeLead();
    const result = await sendOutreachAction(id);
    expect(result).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith({
      to: "dana@acme.test",
      subject: "Hi",
      body: "Let's talk.",
    });
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, id));
    expect(row.outreachStatus).toBe("sent");
    expect(row.outreachSentAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith(`/leads/${id}`);
  });
});
