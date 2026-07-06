// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "@/app/components/ui/field";

describe("Field", () => {
  it("renders a label bound to the control by id", () => {
    render(<Field label="Geography" htmlFor="geo"><select id="geo" className="field-input"><option>India</option></select></Field>);
    const label = screen.getByText("Geography");
    expect(label).toHaveAttribute("for", "geo");
    expect(screen.getByRole("combobox")).toHaveClass("field-input");
  });
});
