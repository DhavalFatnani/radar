// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

vi.mock("@/app/(app)/mappings/actions", () => ({
  createMappingAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { AddMappingForm } from "@/app/(app)/mappings/add-mapping-form";
import { createMappingAction } from "@/app/(app)/mappings/actions";

const SIGNALS = [
  { signalId: "SIG-EXP-NEW-FACILITY", name: "New facility announced" },
  { signalId: "SIG-TENDER-LIVE", name: "Live relevant tender" },
];

beforeEach(() => {
  (createMappingAction as Mock).mockReset();
  (createMappingAction as Mock).mockResolvedValue({ ok: true });
});

async function openDisclosure(user: ReturnType<typeof userEvent.setup>) {
  const summary = screen.queryByText(/propose a mapping/i);
  if (summary && summary.tagName === "SUMMARY") await user.click(summary);
}

describe("AddMappingForm", () => {
  it("renders name field, signal checklists, and submit button", async () => {
    const user = userEvent.setup();
    render(<AddMappingForm approvedSignals={SIGNALS} />);
    await openDisclosure(user);

    expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
    // Two fieldsets (required + supporting) → each approved signal appears twice as a checkbox.
    expect(screen.getAllByRole("checkbox").length).toBe(SIGNALS.length * 2);
    expect(screen.getByRole("button", { name: /propose mapping/i })).toBeInTheDocument();
  });

  it("submits name + selected required signal in FormData", async () => {
    const user = userEvent.setup();
    render(<AddMappingForm approvedSignals={SIGNALS} />);
    await openDisclosure(user);

    await user.type(screen.getByLabelText(/^name/i), "Warehouse expansion");
    // First required-signals checkbox (required fieldset renders first).
    const requiredBoxes = screen.getAllByRole("checkbox");
    await user.click(requiredBoxes[0]);

    await user.click(screen.getByRole("button", { name: /propose mapping/i }));
    await waitFor(() => expect(createMappingAction).toHaveBeenCalled());

    const fd = (vi.mocked(createMappingAction).mock.calls[0] as [unknown, FormData])[1];
    expect(fd.get("name")).toBe("Warehouse expansion");
    expect(fd.getAll("requiredSignals")).toContain("SIG-EXP-NEW-FACILITY");
  });

  it("renders error inline when the action returns an error", async () => {
    (vi.mocked(createMappingAction) as Mock).mockResolvedValueOnce({
      ok: false,
      error: "Select at least one required signal.",
    });
    const user = userEvent.setup();
    render(<AddMappingForm approvedSignals={SIGNALS} />);
    await openDisclosure(user);

    await user.type(screen.getByLabelText(/^name/i), "Bad mapping");
    await user.click(screen.getByRole("button", { name: /propose mapping/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/at least one required signal/i));
  });
});
