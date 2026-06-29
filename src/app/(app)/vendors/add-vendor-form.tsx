"use client";

import { useActionState, useEffect, useRef } from "react";
import { createVendor } from "./actions";

export function AddVendorForm() {
  const [error, formAction, isPending] = useActionState(createVendor, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the field after a settled submit that produced no error.
  useEffect(() => {
    if (!isPending && error === undefined) formRef.current?.reset();
  }, [isPending, error]);

  return (
    <form ref={formRef} action={formAction} className="add-vendor-form">
      <label>
        Vendor name
        <input type="text" name="name" required maxLength={200} autoComplete="off" />
      </label>
      <button type="submit" className="btn" disabled={isPending}>
        {isPending ? "Adding…" : "Add vendor"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
