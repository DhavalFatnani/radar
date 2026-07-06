// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/leads/actions", () => ({
  setCommissionTermsAction: vi.fn(() => Promise.resolve({ ok: true })),
  activateCommissionAction: vi.fn(() => Promise.resolve({ ok: true })),
  markCyclePaidAction: vi.fn(() => Promise.resolve({ ok: true })),
  markCycleMissedAction: vi.fn(() => Promise.resolve({ ok: true })),
  waiveCycleAction: vi.fn(() => Promise.resolve({ ok: true })),
  addNextCycleAction: vi.fn(() => Promise.resolve({ ok: true })),
  appendDisclosureAction: vi.fn(() => Promise.resolve({ ok: true })),
  appendIntroductionAction: vi.fn(() => Promise.resolve({ ok: true })),
  openDisputeAction: vi.fn(() => Promise.resolve({ ok: true })),
  resolveDisputeAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CommissionPanel } from "@/app/(app)/leads/[id]/commission-panel";
import {
  setCommissionTermsAction,
  activateCommissionAction,
  markCyclePaidAction,
} from "@/app/(app)/leads/actions";
import type { CommissionRecord } from "@/lib/commission/schema";

const ID = "10000000-0000-4000-8000-000000000001";

function record(over: Partial<CommissionRecord> = {}): CommissionRecord {
  return {
    leadId: ID,
    vendorId: "v1",
    status: "active",
    terms: { type: "one_time", basis: "flat", amountInr: 250_000 },
    cycles: [{ seq: 1, dueDate: "2026-07-01", amountInr: 250_000, status: "due", paidAt: null, paidAmountInr: null }],
    disclosureLog: [],
    introductionLog: [],
    disputeLog: [],
    ...over,
  };
}

describe("CommissionPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the set-terms form when eligible and no commission exists", () => {
    render(<CommissionPanel leadId={ID} stage="won" commission={null} today="2026-07-05" />);
    expect(screen.getByRole("button", { name: /save commission terms/i })).toBeInTheDocument();
  });

  it("shows a note (no form) when the stage is not commission-eligible", () => {
    render(<CommissionPanel leadId={ID} stage="contacted" commission={null} today="2026-07-05" />);
    expect(screen.queryByRole("button", { name: /save commission terms/i })).toBeNull();
    expect(screen.getByText(/once the deal is won/i)).toBeInTheDocument();
  });

  it("toggles conditional fields between percentage and flat basis", async () => {
    render(<CommissionPanel leadId={ID} stage="won" commission={null} today="2026-07-05" />);
    // flat is the default → amount visible, deal value hidden
    expect(screen.getByLabelText(/flat amount/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/deal value/i)).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText(/basis/i), "percentage");
    expect(screen.getByLabelText(/deal value/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/rate/i)).toBeInTheDocument();
  });

  it("submits flat terms converted to paise", async () => {
    render(<CommissionPanel leadId={ID} stage="won" commission={null} today="2026-07-05" />);
    await userEvent.type(screen.getByLabelText(/flat amount/i), "2500");
    await userEvent.click(screen.getByRole("button", { name: /save commission terms/i }));
    expect(setCommissionTermsAction).toHaveBeenCalledWith(ID, { type: "one_time", basis: "flat", amountInr: 250_000 });
  });

  it("shows the status badge and formatted terms for an existing commission", () => {
    const { container } = render(<CommissionPanel leadId={ID} stage="delivered" commission={record()} today="2026-07-05" />);
    expect(screen.getByText(/active/i)).toBeInTheDocument();
    // The same amount also renders in the cycle row, so scope to the terms summary.
    expect(container.querySelector(".commission-terms")).toHaveTextContent(/₹2,500\.00/);
  });

  it("shows an Activate control for a pending commission on a delivered lead", () => {
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record({ status: "pending", cycles: [{ seq: 1, dueDate: "2026-07-01", amountInr: 250_000, status: "scheduled", paidAt: null, paidAmountInr: null }] })} today="2026-07-05" />);
    expect(screen.getByRole("button", { name: /activate commission/i })).toBeInTheDocument();
  });

  it("hides Activate when the lead is only won (not delivered)", () => {
    render(<CommissionPanel leadId={ID} stage="won" commission={record({ status: "pending" })} today="2026-07-05" />);
    expect(screen.queryByRole("button", { name: /activate commission/i })).toBeNull();
  });

  it("flags an overdue due cycle", () => {
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record({ cycles: [{ seq: 1, dueDate: "2026-06-01", amountInr: 250_000, status: "due", paidAt: null, paidAmountInr: null }] })} today="2026-07-05" />);
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });

  it("confirms before marking a cycle paid and refreshes on success", async () => {
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record()} today="2026-07-05" />);
    fireEvent.click(screen.getByRole("button", { name: /mark paid/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(markCyclePaidAction).toHaveBeenCalledWith(ID, 1));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("cancel aborts the mark-paid confirm without calling the action", () => {
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record()} today="2026-07-05" />);
    fireEvent.click(screen.getByRole("button", { name: /mark paid/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(markCyclePaidAction).not.toHaveBeenCalled();
  });

  it("shows Add next cycle only for a recurring active commission", () => {
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record({ terms: { type: "recurring", basis: "flat", amountInr: 100_000, cadence: "monthly" } })} today="2026-07-05" />);
    expect(screen.getByRole("button", { name: /add next cycle/i })).toBeInTheDocument();
    cleanup();
    render(<CommissionPanel leadId={ID} stage="delivered" commission={record()} today="2026-07-05" />);
    expect(screen.queryByRole("button", { name: /add next cycle/i })).toBeNull();
  });

  it("surfaces an action error inline and does not refresh", async () => {
    (setCommissionTermsAction as Mock).mockResolvedValueOnce({ ok: false, error: "Invalid commission terms." });
    render(<CommissionPanel leadId={ID} stage="won" commission={null} today="2026-07-05" />);
    await userEvent.type(screen.getByLabelText(/flat amount/i), "2500");
    await userEvent.click(screen.getByRole("button", { name: /save commission terms/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid commission terms/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});
