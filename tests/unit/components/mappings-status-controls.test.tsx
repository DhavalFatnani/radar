// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/mappings/actions", () => ({
  approveMappingAction: vi.fn(() => Promise.resolve({ ok: true })),
  retireMappingAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { StatusControls } from "@/app/(app)/mappings/status-controls";
import { approveMappingAction, retireMappingAction } from "@/app/(app)/mappings/actions";

const ID = "10000000-0000-4000-8000-000000000001";

describe("StatusControls (mappings)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders Approve and Retire for proposed", () => {
    render(<StatusControls mappingId={ID} status="proposed" />);
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retire/i })).toBeInTheDocument();
  });
  it("renders only Retire for approved", () => {
    render(<StatusControls mappingId={ID} status="approved" />);
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retire/i })).toBeInTheDocument();
  });
  it("renders Un-retire for retired", () => {
    render(<StatusControls mappingId={ID} status="retired" />);
    expect(screen.getByRole("button", { name: /un-retire/i })).toBeInTheDocument();
  });
  it("clicking Approve calls approveMappingAction with the mappingId", async () => {
    render(<StatusControls mappingId={ID} status="proposed" />);
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(approveMappingAction).toHaveBeenCalledWith(ID);
  });
  it("clicking Retire calls retireMappingAction with the mappingId", async () => {
    render(<StatusControls mappingId={ID} status="proposed" />);
    await userEvent.click(screen.getByRole("button", { name: /retire/i }));
    expect(retireMappingAction).toHaveBeenCalledWith(ID);
  });
});
