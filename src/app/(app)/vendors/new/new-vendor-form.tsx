"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/app/components/ui/field";
import { Combobox } from "@/app/components/ui/combobox";
import { toComboboxOptions, typeHint } from "@/lib/vendors/view-model";
import type { VendorTypeOption } from "@/lib/vendors/schema";
import { createVendorAction, type CreateVendorState } from "../actions";

export function NewVendorForm({ types }: { types: VendorTypeOption[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<CreateVendorState, FormData>(
    createVendorAction,
    { ok: false },
  );
  const [type, setType] = useState("");
  const hint = typeHint(type, types);

  useEffect(() => {
    if (state.ok && state.vendorId) router.push(`/vendors/${state.vendorId}`);
  }, [state, router]);

  return (
    <form className="form-panel" action={formAction}>
      <Field label="Vendor name" htmlFor="name">
        <input id="name" name="name" className="field-input" type="text" required maxLength={200} autoComplete="off" />
      </Field>

      <Field label="Vendor type" htmlFor="vendorType">
        <Combobox
          id="vendorType"
          name="vendorType"
          ariaLabel="Vendor type"
          value={type}
          onChange={setType}
          options={toComboboxOptions(types)}
          placeholder="Pick or create a type…"
          hint={<span className={`combobox-hint combobox-hint--${hint.tone}`}>{hint.text}</span>}
        />
      </Field>

      {state.error ? <p role="alert" className="run-error">{state.error}</p> : null}
      <button type="submit" className="btn btn-primary form-submit" disabled={pending}>
        {pending ? "Creating…" : "Create vendor"}
      </button>
    </form>
  );
}
