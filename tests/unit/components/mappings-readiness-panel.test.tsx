// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReadinessPanel } from "@/app/(app)/mappings/readiness-panel";
import type { SignalRef } from "@/lib/mappings/schema";

describe("ReadinessPanel", () => {
  it("shows the ready message when all required signals are approved", () => {
    const requiredRefs: SignalRef[] = [
      { signalId: "SIG-A", name: "A", status: "approved" },
    ];
    const supportingRefs: SignalRef[] = [];
    render(<ReadinessPanel requiredRefs={requiredRefs} supportingRefs={supportingRefs} />);
    expect(screen.getByText(/All required signals are approved/)).toBeInTheDocument();
  });

  it("shows the blocked message when a required signal is not approved", () => {
    const requiredRefs: SignalRef[] = [
      { signalId: "SIG-A", name: "A", status: "proposed" },
    ];
    const supportingRefs: SignalRef[] = [];
    render(<ReadinessPanel requiredRefs={requiredRefs} supportingRefs={supportingRefs} />);
    expect(screen.getByText(/Some required signals are not approved/)).toBeInTheDocument();
  });

  it("shows the no-required message when there are no required signals", () => {
    const requiredRefs: SignalRef[] = [];
    const supportingRefs: SignalRef[] = [];
    render(<ReadinessPanel requiredRefs={requiredRefs} supportingRefs={supportingRefs} />);
    expect(screen.getByText(/No required signals defined/)).toBeInTheDocument();
    expect(screen.queryByText(/Some required signals are not approved/)).toBeNull();
  });
});
