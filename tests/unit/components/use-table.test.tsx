// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSort, useRowSelection } from "@/app/components/ui/use-table";

describe("useSort", () => {
  const rows = [{ n: "b", v: 2 }, { n: "a", v: 3 }, { n: "c", v: 1 }];
  it("sorts by a numeric key and flips direction on re-toggle", () => {
    const { result } = renderHook(() => useSort(rows, "v", 1));
    expect(result.current.sorted.map((r) => r.v)).toEqual([1, 2, 3]);
    act(() => result.current.toggle("v"));
    expect(result.current.sorted.map((r) => r.v)).toEqual([3, 2, 1]);
  });
  it("sorts by a string key", () => {
    const { result } = renderHook(() => useSort(rows, "n", 1));
    expect(result.current.sorted.map((r) => r.n)).toEqual(["a", "b", "c"]);
  });
});
describe("useRowSelection", () => {
  it("toggles a row and select-all", () => {
    const { result } = renderHook(() => useRowSelection(["x", "y"]));
    act(() => result.current.toggle("x"));
    expect(result.current.selected.has("x")).toBe(true);
    act(() => result.current.toggleAll());
    expect(result.current.allChecked).toBe(true);
    expect(result.current.selected.size).toBe(2);
  });
});
