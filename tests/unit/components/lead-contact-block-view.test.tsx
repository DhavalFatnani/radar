// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContactBlockView } from "@/app/(app)/leads/[id]/contact-block-view";
import type { ContactBlock } from "@/lib/sourcing/contacts-schema";

const block: ContactBlock = {
  decision_makers: [
    {
      name: "Jane Doe",
      role: "COO",
      why: "Owns the operations budget",
      paths: [
        { type: "email", val: "jane@acme.com", conf: "high", source: "apollo" },
        { type: "phone", val: null, conf: null, source: null },
      ],
      warm: { status: "warm", detail: "Shared board member" },
    },
  ],
  status: "resolved",
  resolvedBy: "apollo-resolver",
  resolvedAt: "2026-06-02T10:00:00Z",
};

describe("ContactBlockView", () => {
  it("renders each decision-maker with role and reason", () => {
    render(<ContactBlockView block={block} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText(/COO/)).toBeInTheDocument();
    expect(screen.getByText("Owns the operations budget")).toBeInTheDocument();
  });

  it("renders contact paths, dashing a missing value", () => {
    render(<ContactBlockView block={block} />);
    expect(screen.getByText("jane@acme.com")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders an empty-state note when there are no decision-makers", () => {
    const empty: ContactBlock = { ...block, decision_makers: [], status: "pending_enrichment" };
    render(<ContactBlockView block={empty} />);
    expect(screen.getByText(/No decision-makers/)).toBeInTheDocument();
  });
});
