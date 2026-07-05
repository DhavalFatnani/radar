// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/leads/actions", () => ({
  setOutreachModeAction: vi.fn(() => Promise.resolve({ ok: true })),
  generateOutreachDraftAction: vi.fn(() => Promise.resolve({ ok: true })),
  setOutreachStatusAction: vi.fn(() => Promise.resolve({ ok: true })),
  sendOutreachAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { OutreachPanel } from "@/app/(app)/leads/[id]/outreach-panel";
import {
  setOutreachModeAction,
  generateOutreachDraftAction,
  setOutreachStatusAction,
  sendOutreachAction,
} from "@/app/(app)/leads/actions";

function base(overrides: Partial<Parameters<typeof OutreachPanel>[0]> = {}): Parameters<typeof OutreachPanel>[0] {
  return {
    leadId: "lead-1",
    mode: "operator_handles",
    status: "pending",
    draft: null,
    hasBrief: true,
    sendConfigured: true,
    recipientEmail: "dana@acme.test",
    ...overrides,
  };
}

const ID = "10000000-0000-4000-8000-000000000001";

describe("OutreachPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the current status label and both mode buttons", () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief sendConfigured={true} recipientEmail={null} />);
    expect(screen.getByText(/not started/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /operator handles/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /handed to vendor/i })).toBeInTheDocument();
  });

  it("disables Generate draft and shows a note when hasBrief is false", () => {
    render(<OutreachPanel leadId={ID} mode={null} status="pending" draft={null} hasBrief={false} sendConfigured={true} recipientEmail={null} />);
    expect(screen.getByRole("button", { name: /generate draft/i })).toBeDisabled();
    expect(screen.getByText(/generate the brief first/i)).toBeInTheDocument();
  });

  it("enables Generate draft when hasBrief is true", () => {
    render(<OutreachPanel leadId={ID} mode={null} status="pending" draft={null} hasBrief sendConfigured={true} recipientEmail={null} />);
    expect(screen.getByRole("button", { name: /generate draft/i })).toBeEnabled();
  });

  it("renders the draft subject and body when present", () => {
    render(
      <OutreachPanel
        leadId={ID}
        mode="operator_handles"
        status="drafted"
        draft={{ subject: "Racking for your DC", body: "Hi there, let's talk." }}
        hasBrief
        sendConfigured={true}
        recipientEmail={null}
      />,
    );
    expect(screen.getByDisplayValue("Racking for your DC")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hi there, let's talk.")).toBeInTheDocument();
  });

  it("clicking a mode button calls setOutreachModeAction with (leadId, mode)", async () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief sendConfigured={true} recipientEmail={null} />);
    await userEvent.click(screen.getByRole("button", { name: /handed to vendor/i }));
    expect(setOutreachModeAction).toHaveBeenCalledWith(ID, "handed_to_vendor");
  });

  it("clicking Generate draft calls generateOutreachDraftAction with the leadId", async () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief sendConfigured={true} recipientEmail={null} />);
    await userEvent.click(screen.getByRole("button", { name: /generate draft/i }));
    expect(generateOutreachDraftAction).toHaveBeenCalledWith(ID);
  });

  it("shows Mark as sent for a non-sent lead and calls the action with 'sent'", async () => {
    render(
      <OutreachPanel
        leadId={ID}
        mode="operator_handles"
        status="drafted"
        draft={{ subject: "s", body: "b" }}
        hasBrief
        sendConfigured={true}
        recipientEmail={null}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /mark as sent/i }));
    expect(setOutreachStatusAction).toHaveBeenCalledWith(ID, "sent");
  });

  it("hides Mark as sent once the lead is sent", () => {
    render(
      <OutreachPanel
        leadId={ID}
        mode="operator_handles"
        status="sent"
        draft={{ subject: "s", body: "b" }}
        hasBrief
        sendConfigured={true}
        recipientEmail={null}
      />,
    );
    expect(screen.queryByRole("button", { name: /mark as sent/i })).not.toBeInTheDocument();
  });

  it("surfaces the error string inline and does not call refresh on a failed action", async () => {
    vi.mocked(setOutreachModeAction).mockResolvedValueOnce({ ok: false, error: "Something went wrong" });
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief sendConfigured={true} recipientEmail={null} />);
    await userEvent.click(screen.getByRole("button", { name: /handed to vendor/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("calls router.refresh() after a successful action", async () => {
    vi.mocked(setOutreachModeAction).mockResolvedValueOnce({ ok: true });
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief sendConfigured={true} recipientEmail={null} />);
    await userEvent.click(screen.getByRole("button", { name: /handed to vendor/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("does not render the draft region when draft is null", () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief sendConfigured={true} recipientEmail={null} />);
    expect(screen.queryByLabelText(/generated draft/i)).not.toBeInTheDocument();
  });

  it("does not show the generate-brief-first note when hasBrief is true", () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief sendConfigured={true} recipientEmail={null} />);
    expect(
      screen.queryByText(/generate the brief first/i),
    ).not.toBeInTheDocument();
  });

  it("hides Send now unless status is drafted and mode is operator-handles", () => {
    render(<OutreachPanel {...base({ status: "pending" })} />);
    expect(screen.queryByRole("button", { name: /send now/i })).toBeNull();
    cleanup();
    render(<OutreachPanel {...base({ status: "drafted", mode: "handed_to_vendor" })} />);
    expect(screen.queryByRole("button", { name: /send now/i })).toBeNull();
  });

  it("shows Send now enabled when drafted + operator_handles + configured + recipient", () => {
    render(<OutreachPanel {...base({ status: "drafted", mode: "operator_handles" })} />);
    const btn = screen.getByRole("button", { name: /send now/i });
    expect(btn).toBeEnabled();
    expect(screen.getByText(/dana@acme\.test/)).toBeInTheDocument();
  });

  it("disables Send now with a hint when sending is not configured", () => {
    render(<OutreachPanel {...base({ status: "drafted", mode: "operator_handles", sendConfigured: false })} />);
    expect(screen.getByRole("button", { name: /send now/i })).toBeDisabled();
    expect(screen.getByText(/isn.t configured/i)).toBeInTheDocument();
  });

  it("disables Send now with a hint when there is no recipient email", () => {
    render(<OutreachPanel {...base({ status: "drafted", mode: "operator_handles", recipientEmail: null })} />);
    expect(screen.getByRole("button", { name: /send now/i })).toBeDisabled();
    expect(screen.getByText(/no email address on file/i)).toBeInTheDocument();
  });

  it("confirms before sending and refreshes on success", async () => {
    (sendOutreachAction as Mock).mockResolvedValue({ ok: true });
    render(<OutreachPanel {...base({ status: "drafted", mode: "operator_handles" })} />);
    fireEvent.click(screen.getByRole("button", { name: /send now/i }));
    expect(screen.getByText(/send to dana@acme\.test\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm send/i }));
    await waitFor(() => expect(sendOutreachAction).toHaveBeenCalledWith("lead-1"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("cancel returns to idle without sending", () => {
    render(<OutreachPanel {...base({ status: "drafted", mode: "operator_handles" })} />);
    fireEvent.click(screen.getByRole("button", { name: /send now/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText(/send to dana@acme\.test\?/i)).toBeNull();
    expect(sendOutreachAction).not.toHaveBeenCalled();
  });

  it("shows an alert and does not refresh when send fails", async () => {
    (sendOutreachAction as Mock).mockResolvedValue({ ok: false, error: "Sending failed. Check the email provider configuration." });
    render(<OutreachPanel {...base({ status: "drafted", mode: "operator_handles" })} />);
    fireEvent.click(screen.getByRole("button", { name: /send now/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm send/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/sending failed/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});
