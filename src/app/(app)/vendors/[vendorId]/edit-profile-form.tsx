"use client";

import { useActionState, useState } from "react";
import type { VendorProfile } from "@/lib/vendors/data";
import type { VendorTypeOption } from "@/lib/vendors/schema";
import { Field } from "@/app/components/ui/field";
import { Combobox } from "@/app/components/ui/combobox";
import { toComboboxOptions, typeHint } from "@/lib/vendors/view-model";
import { updateVendor } from "./actions";

export function EditProfileForm({ vendor, types }: { vendor: VendorProfile; types: VendorTypeOption[] }) {
  const action = updateVendor.bind(null, vendor.vendorId);
  const [error, formAction, isPending] = useActionState(action, undefined);
  const c = vendor.constraints ?? {};
  const [type, setType] = useState(vendor.vendorType ?? "");
  const hint = typeHint(type, types);

  return (
    <form action={formAction} className="profile-form">
      <label>
        Vendor name
        <input type="text" name="name" defaultValue={vendor.name} required maxLength={200} />
      </label>

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

      <label>
        Capabilities (one per line)
        <textarea name="capabilities" rows={3} defaultValue={vendor.capabilities.join("\n")} />
      </label>

      <fieldset>
        <legend>Constraints</legend>
        <label>
          Min project size
          <input type="text" name="minProjectSize" defaultValue={c.minProjectSize ?? ""} maxLength={200} />
        </label>
        <label>
          Max project size
          <input type="text" name="maxProjectSize" defaultValue={c.maxProjectSize ?? ""} maxLength={200} />
        </label>
        <label>
          Geographies (one per line)
          <textarea name="geographies" rows={2} defaultValue={(c.geographies ?? []).join("\n")} />
        </label>
        <label>
          Capacity
          <input type="text" name="capacity" defaultValue={c.capacity ?? ""} maxLength={200} />
        </label>
        <label>
          Current load
          <input type="text" name="currentLoad" defaultValue={c.currentLoad ?? ""} maxLength={200} />
        </label>
        <label>
          Working capital limit
          <input type="text" name="workingCapitalLimit" defaultValue={c.workingCapitalLimit ?? ""} maxLength={200} />
        </label>
        <label>
          Lead times
          <input type="text" name="leadTimes" defaultValue={c.leadTimes ?? ""} maxLength={200} />
        </label>
      </fieldset>

      <label>
        Ideal customer
        <textarea name="idealCustomer" rows={3} defaultValue={vendor.idealCustomer ?? ""} maxLength={4000} />
      </label>
      <label>
        Known-good signals
        <textarea name="knownGoodSignals" rows={3} defaultValue={vendor.knownGoodSignals ?? ""} maxLength={4000} />
      </label>
      <label>
        Differentiators
        <textarea name="differentiators" rows={3} defaultValue={vendor.differentiators ?? ""} maxLength={4000} />
      </label>
      <label>
        Credibility / proof
        <textarea name="credibility" rows={3} defaultValue={vendor.credibility ?? ""} maxLength={4000} />
      </label>

      <button type="submit" className="btn" disabled={isPending}>
        {isPending ? "Saving…" : "Save profile"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
