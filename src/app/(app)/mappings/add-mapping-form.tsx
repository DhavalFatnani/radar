"use client";

import { useActionState, useEffect, useRef } from "react";
import { createMappingAction } from "./actions";
import type { MappingFormState } from "./actions";

export function AddMappingForm({
  approvedSignals,
}: {
  approvedSignals: { signalId: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(createMappingAction, { ok: false } as MappingFormState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!isPending && state.ok) formRef.current?.reset();
  }, [isPending, state.ok]);

  return (
    <details className="add-mapping-disclosure">
      <summary>Propose a mapping</summary>
      <section aria-label="Propose a mapping form">
        <form ref={formRef} action={formAction} className="add-mapping-form">
          <label htmlFor="mappingName">
            Name
            <input id="mappingName" type="text" name="name" required maxLength={200} autoComplete="off" />
          </label>

          <label htmlFor="servesVendorType">
            Serves vendor type
            <input id="servesVendorType" type="text" name="servesVendorType" maxLength={200} autoComplete="off" />
          </label>

          <label htmlFor="intentDescription">
            Intent
            <textarea id="intentDescription" name="intentDescription" rows={2} maxLength={4000} />
          </label>

          <fieldset className="signal-picker">
            <legend>Required signals (pick at least one)</legend>
            {approvedSignals.length === 0 ? (
              <p className="field-hint">No approved signals yet — seed or approve signals first.</p>
            ) : (
              approvedSignals.map((s) => (
                <label key={s.signalId} className="checkbox-row">
                  <input type="checkbox" name="requiredSignals" value={s.signalId} />
                  {s.name} <span className="readiness-id">{s.signalId}</span>
                </label>
              ))
            )}
          </fieldset>

          <fieldset className="signal-picker">
            <legend>Supporting signals</legend>
            {approvedSignals.length === 0 ? (
              <p className="field-hint">No approved signals yet.</p>
            ) : (
              approvedSignals.map((s) => (
                <label key={s.signalId} className="checkbox-row">
                  <input type="checkbox" name="supportingSignals" value={s.signalId} />
                  {s.name} <span className="readiness-id">{s.signalId}</span>
                </label>
              ))
            )}
          </fieldset>

          <label htmlFor="thresholdRule">
            Threshold rule
            <input id="thresholdRule" type="text" name="thresholdRule" maxLength={2000} autoComplete="off" />
          </label>

          <label htmlFor="timingWindowDays">
            Timing window (days)
            <input id="timingWindowDays" type="number" name="timingWindowDays" min={0} max={3650} />
          </label>

          <label htmlFor="strengthLogic">
            Strength logic
            <textarea id="strengthLogic" name="strengthLogic" rows={2} maxLength={2000} />
          </label>

          <label htmlFor="disqualifiers">
            Disqualifiers
            <textarea id="disqualifiers" name="disqualifiers" rows={2} placeholder="comma or newline separated" />
          </label>

          <div className="add-mapping-actions">
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? "Proposing…" : "Propose mapping"}
            </button>
            {state.error && <p role="alert">{state.error}</p>}
          </div>
        </form>
      </section>
    </details>
  );
}
