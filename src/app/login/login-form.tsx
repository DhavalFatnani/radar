"use client";

import { useActionState } from "react";
import { authenticate } from "./actions";

export function LoginForm() {
  const [errorMessage, formAction, isPending] = useActionState(authenticate, undefined);

  return (
    <form action={formAction} className="auth-form">
      <label className="auth-field">
        <span className="auth-label">Email</span>
        <input
          className="auth-input"
          type="email"
          name="email"
          required
          autoComplete="username"
          placeholder="operator@radar.app"
        />
      </label>
      <label className="auth-field">
        <span className="auth-label">Password</span>
        <input
          className="auth-input"
          type="password"
          name="password"
          required
          autoComplete="current-password"
          minLength={1}
        />
      </label>
      <button type="submit" className="btn btn-primary auth-submit" disabled={isPending}>
        {isPending ? "Signing in…" : "Sign in"}
      </button>
      {errorMessage && (
        <p role="alert" className="auth-error">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
