// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/signals/actions", () => ({
  approveSignalAction: vi.fn(() => Promise.resolve({ ok: true })),
  retireSignalAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { StatusControls } from "@/app/(app)/signals/status-controls";
import { approveSignalAction, retireSignalAction } from "@/app/(app)/signals/actions";

describe("StatusControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Approve and Retire buttons for proposed status", () => {
    render(<StatusControls signalId="SIG-X-Y" status="proposed" />);
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retire/i })).toBeInTheDocument();
  });

  it("renders only Retire button for approved status", () => {
    render(<StatusControls signalId="SIG-X-Y" status="approved" />);
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retire/i })).toBeInTheDocument();
  });

  it("renders Un-retire button for retired status", () => {
    render(<StatusControls signalId="SIG-X-Y" status="retired" />);
    expect(screen.getByRole("button", { name: /un-retire/i })).toBeInTheDocument();
  });

  it("clicking Approve calls approveSignalAction with the signalId", async () => {
    render(<StatusControls signalId="SIG-X-Y" status="proposed" />);
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(approveSignalAction).toHaveBeenCalledWith("SIG-X-Y");
  });
});
