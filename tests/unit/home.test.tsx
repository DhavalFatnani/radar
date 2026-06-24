import { describe, it, expect } from "vitest";
import HomePage from "@/app/page";

describe("HomePage", () => {
  it("returns a React element", () => {
    const element = HomePage();
    expect(element).toBeTruthy();
    expect(typeof element).toBe("object");
  });
});
