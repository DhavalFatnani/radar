// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the server action so the real db/auth chain never loads in jsdom.
vi.mock("@/app/(app)/signals/actions", () => ({
  createSignalAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { AddSignalForm } from "@/app/(app)/signals/add-signal-form";
import { createSignalAction } from "@/app/(app)/signals/actions";
import type { Mock } from "vitest";

// SIGNAL_FAMILIES has 6 values: hiring, procurement, money, expansion, leadership, digital
const REQUIRED_TEXT = {
  signalId: "SIG-TEST-001",
  name: "Test signal",
};

beforeEach(() => {
  (createSignalAction as Mock).mockReset();
  (createSignalAction as Mock).mockResolvedValue({ ok: true });
});

describe("AddSignalForm", () => {
  it("renders required fields and submit button", async () => {
    const user = userEvent.setup();
    render(<AddSignalForm />);

    // If inside a <details>, open the disclosure first
    const summary = screen.queryByText(/propose a signal/i);
    if (summary && summary.tagName === "SUMMARY") {
      await user.click(summary);
    }

    expect(screen.getByLabelText(/signal id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^family/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^strength/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/false.positive/i)).toBeInTheDocument();

    // family select should have exactly 6 options (SIGNAL_FAMILIES.length)
    const familySelect = screen.getByLabelText(/^family/i);
    expect(familySelect.querySelectorAll("option")).toHaveLength(6);

    expect(screen.getByRole("button", { name: /propose signal/i })).toBeInTheDocument();
  });

  it("calls the action with correct formData on submit", async () => {
    const user = userEvent.setup();
    render(<AddSignalForm />);

    // Open disclosure if present
    const summary = screen.queryByText(/propose a signal/i);
    if (summary && summary.tagName === "SUMMARY") {
      await user.click(summary);
    }

    await user.type(screen.getByLabelText(/signal id/i), REQUIRED_TEXT.signalId);
    await user.type(screen.getByLabelText(/^name/i), REQUIRED_TEXT.name);
    // Required selects default to first enum value — no interaction needed

    await user.click(screen.getByRole("button", { name: /propose signal/i }));

    await waitFor(() => expect(createSignalAction).toHaveBeenCalled());

    // Inspect the FormData argument (second arg in useActionState signature)
    const fd = (vi.mocked(createSignalAction).mock.calls[0] as [unknown, FormData])[1];
    expect(fd.get("signalId")).toBe(REQUIRED_TEXT.signalId);
    expect(fd.get("name")).toBe(REQUIRED_TEXT.name);
  });

  it("renders error inline when action returns an error", async () => {
    (vi.mocked(createSignalAction) as Mock).mockResolvedValueOnce({
      ok: false,
      error: "A signal with that ID already exists.",
    });

    const user = userEvent.setup();
    render(<AddSignalForm />);

    // Open disclosure if present
    const summary = screen.queryByText(/propose a signal/i);
    if (summary && summary.tagName === "SUMMARY") {
      await user.click(summary);
    }

    await user.type(screen.getByLabelText(/signal id/i), "SIG-TEST-002");
    await user.type(screen.getByLabelText(/^name/i), "Duplicate signal");

    await user.click(screen.getByRole("button", { name: /propose signal/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i),
    );
  });
});
