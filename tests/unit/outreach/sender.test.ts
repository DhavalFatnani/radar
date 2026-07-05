import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable so tests can toggle configuration. sendEmail/isSendConfigured read live.
// vi.hoisted ensures this object is available when the vi.mock factories run.
const { mockEnv, mockSend } = vi.hoisted(() => {
  const mockEnv: { RESEND_API_KEY?: string; OUTREACH_FROM_EMAIL?: string } = {
    RESEND_API_KEY: "re_test",
    OUTREACH_FROM_EMAIL: "from@radar.test",
  };
  const mockSend = vi.fn();
  return { mockEnv, mockSend };
});

vi.mock("@/lib/env", () => ({ env: mockEnv }));

vi.mock("resend", () => {
  function MockResend() {
    return { emails: { send: mockSend } };
  }
  return { Resend: MockResend };
});

import { sendEmail, isSendConfigured } from "@/lib/outreach/sender";

beforeEach(() => {
  mockEnv.RESEND_API_KEY = "re_test";
  mockEnv.OUTREACH_FROM_EMAIL = "from@radar.test";
  mockSend.mockReset();
});

describe("isSendConfigured", () => {
  it("is true only when both env vars are present", () => {
    expect(isSendConfigured()).toBe(true);
    mockEnv.RESEND_API_KEY = undefined;
    expect(isSendConfigured()).toBe(false);
    mockEnv.RESEND_API_KEY = "re_test";
    mockEnv.OUTREACH_FROM_EMAIL = undefined;
    expect(isSendConfigured()).toBe(false);
  });
});

describe("sendEmail", () => {
  it("returns not-configured and never calls the provider when unconfigured", async () => {
    mockEnv.RESEND_API_KEY = undefined;
    const r = await sendEmail({ to: "a@b.test", subject: "Hi", body: "Yo" });
    expect(r).toEqual({ ok: false, error: "Email sending is not configured." });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends via Resend and returns the message id on success", async () => {
    mockSend.mockResolvedValue({ data: { id: "msg_1" }, error: null });
    const r = await sendEmail({ to: "a@b.test", subject: "Hi", body: "Yo" });
    expect(r).toEqual({ ok: true, id: "msg_1" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      from: "from@radar.test",
      to: "a@b.test",
      subject: "Hi",
      text: "Yo",
    });
  });

  it("sanitizes a provider-reported error (no raw message leaks)", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "boom-secret", name: "x" } });
    const r = await sendEmail({ to: "a@b.test", subject: "Hi", body: "Yo" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("Sending failed. Check the email provider configuration.");
      expect(r.error).not.toContain("boom-secret");
    }
  });

  it("sanitizes a thrown provider error (no raw message leaks)", async () => {
    mockSend.mockRejectedValue(new Error("network re_secret_key"));
    const r = await sendEmail({ to: "a@b.test", subject: "Hi", body: "Yo" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("Sending failed. Check the email provider configuration.");
      expect(r.error).not.toContain("re_secret_key");
    }
  });
});
