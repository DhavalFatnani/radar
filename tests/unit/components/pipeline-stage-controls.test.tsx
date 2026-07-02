// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/pipeline/actions", () => ({
  advanceLeadStageAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { StageControls } from "@/app/(app)/pipeline/stage-controls";
import { advanceLeadStageAction } from "@/app/(app)/pipeline/actions";

const ID = "10000000-0000-4000-8000-000000000001";

describe("StageControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an advance button and a Mark lost button for an active stage", () => {
    render(<StageControls leadId={ID} stage="sourced" />);
    expect(screen.getByRole("button", { name: /contacted/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark lost/i })).toBeInTheDocument();
  });

  it("renders only the single next button for won (no lost)", () => {
    render(<StageControls leadId={ID} stage="won" />);
    expect(screen.getByRole("button", { name: /delivered/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark lost/i })).not.toBeInTheDocument();
  });

  it("renders nothing for a terminal stage", () => {
    const { container } = render(<StageControls leadId={ID} stage="paid" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("clicking an advance button calls the action with (leadId, target)", async () => {
    render(<StageControls leadId={ID} stage="pitched" />);
    await userEvent.click(screen.getByRole("button", { name: /won/i }));
    expect(advanceLeadStageAction).toHaveBeenCalledWith(ID, "won");
  });

  it("clicking Mark lost calls the action with lost", async () => {
    render(<StageControls leadId={ID} stage="engaged" />);
    await userEvent.click(screen.getByRole("button", { name: /mark lost/i }));
    expect(advanceLeadStageAction).toHaveBeenCalledWith(ID, "lost");
  });
});
