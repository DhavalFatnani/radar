// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InterviewScreen } from "@/app/(app)/vendors/[vendorId]/interview/interview-screen";
import type { VendorProfile } from "@/lib/vendors/schema";
import type { TurnResult } from "@/app/(app)/vendors/[vendorId]/interview/types";
import type { InterviewSummary } from "@/lib/interviews/schema";

vi.mock("@/app/(app)/vendors/[vendorId]/interview/actions", () => ({
  startInterview: vi.fn(),
  submitAnswer: vi.fn(),
  advanceInterview: vi.fn(),
  saveInterview: vi.fn(),
  endInterview: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { submitAnswer, saveInterview, advanceInterview } from "@/app/(app)/vendors/[vendorId]/interview/actions";

const vendor: VendorProfile = {
  vendorId: "v1",
  name: "Meridian Warehouse",
  vendorType: null,
  capabilities: ["Racking up to 12t/bay"],
  constraints: { geographies: ["Maharashtra"] },
  idealCustomer: "3PLs building DCs",
  knownGoodSignals: null,
  differentiators: null,
  credibility: null,
  version: 2,
  interviewHistory: [],
};

function activeTurn(): TurnResult {
  return {
    ok: true,
    interviewId: "iv1",
    transcript: [
      { role: "sia", text: "What does your company do?" },
      { role: "vendor", text: "We build warehouses." },
    ],
    pendingQuestion: "Which geographies do you serve?",
    coverage: { covered: ["capabilities"], remaining: ["constraints", "idealCustomer", "knownGoodSignals", "differentiators"], isComplete: false },
    isComplete: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InterviewScreen", () => {
  it("shows the launch state with past interviews when there is no active interview", () => {
    const past: InterviewSummary[] = [
      { interviewId: "iv0", status: "completed", startedAt: "2026-06-01T10:00:00.000Z", completedAt: "2026-06-01T10:30:00.000Z", resultingVersion: 2, messageCount: 8 },
    ];
    render(<InterviewScreen vendor={vendor} initialTurn={null} past={past} />);
    expect(screen.getByRole("button", { name: "Start re-interview" })).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
  });

  it("renders an active transcript with SIA and vendor rows", () => {
    render(<InterviewScreen vendor={vendor} initialTurn={activeTurn()} past={[]} />);
    expect(screen.getByText("What does your company do?")).toBeInTheDocument();
    expect(screen.getByText("We build warehouses.")).toBeInTheDocument();
    expect(screen.getByText("Which geographies do you serve?")).toBeInTheDocument();
  });

  it("submits an answer through the submitAnswer action", async () => {
    (submitAnswer as Mock).mockResolvedValue(activeTurn());
    const user = userEvent.setup();
    render(<InterviewScreen vendor={vendor} initialTurn={activeTurn()} past={[]} />);
    await user.type(screen.getByLabelText("Vendor answer"), "We serve Maharashtra and Gujarat.");
    await user.click(screen.getByRole("button", { name: "Continue interview" }));
    expect(submitAnswer).toHaveBeenCalledWith("iv1", "We serve Maharashtra and Gujarat.");
  });

  it("saves through the saveInterview action", async () => {
    (saveInterview as Mock).mockResolvedValue({ ok: true, version: 3 });
    const user = userEvent.setup();
    render(<InterviewScreen vendor={vendor} initialTurn={activeTurn()} past={[]} />);
    await user.click(screen.getByRole("button", { name: "Save & version v3" }));
    expect(saveInterview).toHaveBeenCalledWith("iv1");
  });

  it("shows a Retry control on a failed answer and retries via advanceInterview", async () => {
    (submitAnswer as Mock).mockResolvedValue({
      ok: false,
      error: "SIA is unavailable right now. Press retry to continue.",
    });
    (advanceInterview as Mock).mockResolvedValue(activeTurn());
    const user = userEvent.setup();
    render(<InterviewScreen vendor={vendor} initialTurn={activeTurn()} past={[]} />);
    await user.type(screen.getByLabelText("Vendor answer"), "We serve Maharashtra.");
    await user.click(screen.getByRole("button", { name: "Continue interview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/i);
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    expect(advanceInterview).toHaveBeenCalledWith("iv1");
  });
});
