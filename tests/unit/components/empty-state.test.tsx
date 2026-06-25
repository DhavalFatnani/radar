// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "@/app/components/ui/empty-state";

describe("EmptyState", () => {
  it("renders the title and description", () => {
    render(
      <EmptyState
        icon="vendors"
        title="No vendors yet"
        description="Add your first vendor."
      />
    );
    expect(screen.getByText("No vendors yet")).toBeInTheDocument();
    expect(screen.getByText("Add your first vendor.")).toBeInTheDocument();
  });
});
