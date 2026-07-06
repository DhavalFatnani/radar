// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the server action by its resolved path (@ = src/) so login-form's
// relative `./actions` import is intercepted — avoids loading NextAuth/bcrypt.
vi.mock("@/app/login/actions", () => ({
  authenticate: vi.fn(async () => "Invalid email or password."),
}));

import { LoginForm } from "@/app/login/login-form";

describe("LoginForm", () => {
  it("renders labeled email and password fields and a submit button", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("surfaces the action's error message in an alert", async () => {
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "op@test.com");
    await userEvent.type(screen.getByLabelText(/password/i), "secret");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid email or password/i);
  });
});
