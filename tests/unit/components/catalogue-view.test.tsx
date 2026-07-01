// @vitest-environment jsdom
// tests/unit/components/catalogue-view.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CatalogueGraph } from "@/lib/catalogue/schema";

// Mock the imperative engine so the view test doesn't re-test the engine (Task 5 covers it).
vi.mock("@/app/(app)/catalogue/graph-engine", () => ({
  renderGraph: vi.fn(() => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn() })),
}));
vi.mock("@/app/(app)/catalogue/actions", () => ({ matchVendorsAction: vi.fn() }));

import { CatalogueView } from "@/app/(app)/catalogue/catalogue-view";
import { matchVendorsAction } from "@/app/(app)/catalogue/actions";
import type { Mock } from "vitest";

const graph: CatalogueGraph = {
  nodes: [
    { nodeId: "v1", type: "vendor", label: "Meridian", metadata: { vendorId: "vid1" } },
    { nodeId: "c1", type: "capability", label: "Racking", metadata: null },
    { nodeId: "g1", type: "geography", label: "Maharashtra", metadata: null },
  ],
  edges: [
    { edgeId: "e1", fromNodeId: "v1", toNodeId: "c1", type: "vendor_capability" },
    { edgeId: "e2", fromNodeId: "v1", toNodeId: "g1", type: "vendor_geography" },
  ],
};

beforeEach(() => {
  (matchVendorsAction as Mock).mockReset();
});

describe("CatalogueView", () => {
  it("renders the graph surface, the legend, and zoom controls", () => {
    render(<CatalogueView graph={graph} />);
    expect(screen.getByRole("img", { name: /catalogue graph/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
  });

  it("matches a need and lists the resulting vendors linking to their profiles", async () => {
    (matchVendorsAction as Mock).mockResolvedValue([{ vendorId: "vid1", name: "Meridian" }]);
    const user = userEvent.setup();
    render(<CatalogueView graph={graph} />);

    await user.selectOptions(screen.getByLabelText("Capability"), "Racking");
    await user.selectOptions(screen.getByLabelText("Geography"), "Maharashtra");
    await user.click(screen.getByRole("button", { name: "Match" }));

    expect(matchVendorsAction).toHaveBeenCalledWith({ capability: "Racking", geography: "Maharashtra" });
    const link = await screen.findByRole("link", { name: /Meridian/ });
    expect(link).toHaveAttribute("href", "/vendors/vid1");
  });
});
