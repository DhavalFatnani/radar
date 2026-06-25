"use client";

import { useActionState } from "react";
import { authenticate } from "./actions";

export function LoginForm() {
  const [errorMessage, formAction, isPending] = useActionState(authenticate, undefined);

  return (
    <form action={formAction}>
      <label>
        Email
        <input type="email" name="email" required autoComplete="username" />
      </label>
      <label>
        Password
        <input type="password" name="password" required autoComplete="current-password" minLength={1} />
      </label>
      <button type="submit" disabled={isPending}>
        {isPending ? "Signing in…" : "Sign in"}
      </button>
      {errorMessage && <p role="alert">{errorMessage}</p>}
    </form>
  );
}
