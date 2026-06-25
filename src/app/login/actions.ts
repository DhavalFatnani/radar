"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

// Returns an error message string on failure, or never returns on success
// (signIn throws a NEXT_REDIRECT which must propagate). Never leaks internals.
export async function authenticate(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return "Invalid email or password.";
    }
    throw error; // re-throw the redirect (and anything unexpected)
  }
  return undefined;
}
