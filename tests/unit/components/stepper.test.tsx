// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Stepper } from "@/app/components/ui/stepper";
import { ReadinessBanner } from "@/app/components/ui/readiness-banner";

describe("Stepper", () => {
  it("shows the value and reports slider changes", () => {
    const onChange = vi.fn();
    render(<Stepper value={20} onChange={onChange} min={1} max={25} name="target" />);
    expect(screen.getByText("20")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "15" } });
    expect(onChange).toHaveBeenCalledWith(15);
    // submits its value via a hidden input
    expect(document.querySelector('input[type="hidden"][name="target"]')).toHaveValue("20");
  });
});

describe("ReadinessBanner", () => {
  it("renders ok vs warn variants", () => {
    const { rerender, container } = render(<ReadinessBanner ok>Ready to source.</ReadinessBanner>);
    expect(container.querySelector(".readiness--ok")).toBeTruthy();
    rerender(<ReadinessBanner ok={false}>Needs a mapping.</ReadinessBanner>);
    expect(container.querySelector(".readiness--warn")).toBeTruthy();
  });
});
