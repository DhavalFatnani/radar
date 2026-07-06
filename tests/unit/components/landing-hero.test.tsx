// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// next/link needs the app-router context at runtime; stub it to a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { LandingHero } from "@/app/landing-hero";

describe("LandingHero", () => {
  it("renders the wordmark and headline", () => {
    render(<LandingHero />);
    expect(screen.getByText("RADAR")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /from signal to signed/i })).toBeInTheDocument();
  });

  it("has a Sign in link pointing to /login", () => {
    render(<LandingHero />);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });
});
