// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/components/shell/mode-toggle", () => ({ ModeToggle: () => <button aria-label="Toggle theme" /> }));

import { Topbar } from "@/app/components/shell/topbar";

describe("Topbar", () => {
  it("renders the global search trigger with the ⌘K hint and a notifications button", () => {
    render(<Topbar />);
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
    expect(screen.getByText(/⌘K/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notifications/i })).toBeInTheDocument();
  });
});
