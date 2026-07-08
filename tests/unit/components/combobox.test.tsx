// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Combobox, type ComboboxOption } from "@/app/components/ui/combobox";

const OPTS: ComboboxOption[] = [
  { value: "Infra", label: "Infra", meta: "3 mappings" },
  { value: "Mktg", label: "Mktg", meta: "2 mappings" },
  { value: "Ops", label: "Ops", meta: "no mapping yet" },
];

function Harness({ initial = "" }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <Combobox name="vendorType" ariaLabel="Vendor type" value={v} onChange={setV} options={OPTS} />
      <output data-testid="val">{v}</output>
    </>
  );
}

describe("Combobox", () => {
  it("opens on focus and lists all options", () => {
    render(<Harness />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByText("3 mappings")).toBeInTheDocument();
  });

  it("filters options by typed text", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "mk" } });
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(1);
    expect(opts[0]).toHaveTextContent("Mktg");
  });

  it("picks an existing option and closes", () => {
    render(<Harness />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("Infra"));
    expect(screen.getByTestId("val")).toHaveTextContent("Infra");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("offers a create affordance for a brand-new value", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Fintech" } });
    const create = screen.getByText(/Create/);
    fireEvent.mouseDown(create);
    expect(screen.getByTestId("val")).toHaveTextContent("Fintech");
  });

  it("renders the hint slot", () => {
    render(
      <Combobox
        name="vendorType"
        ariaLabel="Vendor type"
        value="Infra"
        onChange={() => {}}
        options={OPTS}
        hint={<span className="combobox-hint combobox-hint--ok">3 mappings serve Infra — runnable.</span>}
      />,
    );
    expect(screen.getByText(/runnable/)).toBeInTheDocument();
  });
});
