// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput, FilterChips, Segmented } from "@/app/components/ui/controls";

describe("SearchInput", () => {
  it("calls onChange with typed text", async () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} placeholder="Filter…" />);
    await userEvent.type(screen.getByPlaceholderText("Filter…"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });
});
describe("FilterChips", () => {
  const opts = [{ value: "all", label: "All" }, { value: "done", label: "Done" }];
  it("marks the active chip and reports selection", async () => {
    const onChange = vi.fn();
    render(<FilterChips options={opts} value="all" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "All" })).toHaveClass("chip-on");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith("done");
  });
});
describe("Segmented", () => {
  const opts = [{ value: "all", label: "All" }, { value: "live", label: "Live" }];
  it("reports the clicked segment", async () => {
    const onChange = vi.fn();
    render(<Segmented options={opts} value="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(onChange).toHaveBeenCalledWith("live");
  });
});
