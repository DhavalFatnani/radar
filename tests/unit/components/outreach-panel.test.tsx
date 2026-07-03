// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/leads/actions", () => ({
  setOutreachModeAction: vi.fn(() => Promise.resolve({ ok: true })),
  generateOutreachDraftAction: vi.fn(() => Promise.resolve({ ok: true })),
  setOutreachStatusAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { OutreachPanel } from "@/app/(app)/leads/[id]/outreach-panel";
import {
  setOutreachModeAction,
  generateOutreachDraftAction,
  setOutreachStatusAction,
} from "@/app/(app)/leads/actions";

const ID = "10000000-0000-4000-8000-000000000001";

describe("OutreachPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the current status label and both mode buttons", () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief />);
    expect(screen.getByText(/not started/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /operator handles/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /handed to vendor/i })).toBeInTheDocument();
  });

  it("disables Generate draft and shows a note when hasBrief is false", () => {
    render(<OutreachPanel leadId={ID} mode={null} status="pending" draft={null} hasBrief={false} />);
    expect(screen.getByRole("button", { name: /generate draft/i })).toBeDisabled();
    expect(screen.getByText(/generate the brief first/i)).toBeInTheDocument();
  });

  it("enables Generate draft when hasBrief is true", () => {
    render(<OutreachPanel leadId={ID} mode={null} status="pending" draft={null} hasBrief />);
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
      />,
    );
    expect(screen.getByDisplayValue("Racking for your DC")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hi there, let's talk.")).toBeInTheDocument();
  });

  it("clicking a mode button calls setOutreachModeAction with (leadId, mode)", async () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief />);
    await userEvent.click(screen.getByRole("button", { name: /handed to vendor/i }));
    expect(setOutreachModeAction).toHaveBeenCalledWith(ID, "handed_to_vendor");
  });

  it("clicking Generate draft calls generateOutreachDraftAction with the leadId", async () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief />);
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
      />,
    );
    expect(screen.queryByRole("button", { name: /mark as sent/i })).not.toBeInTheDocument();
  });

  it("surfaces the error string inline and does not call refresh on a failed action", async () => {
    vi.mocked(setOutreachModeAction).mockResolvedValueOnce({ ok: false, error: "Something went wrong" });
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief />);
    await userEvent.click(screen.getByRole("button", { name: /handed to vendor/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("calls router.refresh() after a successful action", async () => {
    vi.mocked(setOutreachModeAction).mockResolvedValueOnce({ ok: true });
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief />);
    await userEvent.click(screen.getByRole("button", { name: /handed to vendor/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("does not render the draft region when draft is null", () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief />);
    expect(screen.queryByLabelText(/generated draft/i)).not.toBeInTheDocument();
  });

  it("does not show the generate-brief-first note when hasBrief is true", () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief />);
    expect(
      screen.queryByText(/generate the brief first/i),
    ).not.toBeInTheDocument();
  });
});
