"use client";

import { useActionState, useEffect, useRef } from "react";
import { createSignalAction } from "./actions";
import type { SignalFormState } from "./actions";
import {
  SIGNAL_FAMILIES,
  SIGNAL_STRENGTHS,
  FALSE_POSITIVE_RISKS,
  DETECTION_METHODS,
  SIGNAL_POLARITIES,
  ENTITY_TYPES,
} from "@/lib/signals/schema";

export function AddSignalForm() {
  const [state, formAction, isPending] = useActionState<SignalFormState, FormData>(
    createSignalAction,
    { ok: false },
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Reset the form after a settled successful submission.
  useEffect(() => {
    if (!isPending && state.ok) formRef.current?.reset();
  }, [isPending, state.ok]);

  return (
    <details className="add-signal-disclosure">
      <summary>Propose a signal</summary>
      <section aria-label="Propose a signal form">
        <form ref={formRef} action={formAction} className="add-signal-form">
          {/* ---- Required fields ---- */}
          <label htmlFor="signalId">
            Signal ID
            <input
              id="signalId"
              type="text"
              name="signalId"
              required
              placeholder="SIG-HIRING-OPS-SURGE"
              autoComplete="off"
              aria-describedby="signalId-hint"
            />
            <span id="signalId-hint" className="field-hint">
              Format: SIG-AREA-TOPIC (uppercase, hyphens only)
            </span>
          </label>

          <label htmlFor="signalName">
            Name
            <input
              id="signalName"
              type="text"
              name="name"
              required
              maxLength={200}
              autoComplete="off"
            />
          </label>

          <label htmlFor="family">
            Family
            <select id="family" name="family" required>
              {SIGNAL_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="strength">
            Strength
            <select id="strength" name="strength" required>
              {SIGNAL_STRENGTHS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="falsePositiveRisk">
            False-positive risk
            <select id="falsePositiveRisk" name="falsePositiveRisk" required>
              {FALSE_POSITIVE_RISKS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          {/* ---- Optional fields ---- */}
          <label htmlFor="description">
            Description
            <textarea id="description" name="description" rows={3} maxLength={2000} />
          </label>

          <label htmlFor="sources">
            Sources
            <input
              id="sources"
              type="text"
              name="sources"
              placeholder="comma or newline separated"
              autoComplete="off"
            />
          </label>

          <label htmlFor="detectionMethod">
            Detection method
            <select id="detectionMethod" name="detectionMethod">
              <option value="">—</option>
              {DETECTION_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="triggerRule">
            Trigger rule
            <input id="triggerRule" type="text" name="triggerRule" autoComplete="off" />
          </label>

          <label htmlFor="polarity">
            Polarity
            <select id="polarity" name="polarity">
              <option value="">—</option>
              {SIGNAL_POLARITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="entityType">
            Entity type
            <select id="entityType" name="entityType">
              <option value="">—</option>
              {ENTITY_TYPES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="freshnessWindowDays">
            Freshness window (days)
            <input
              id="freshnessWindowDays"
              type="number"
              name="freshnessWindowDays"
              min={0}
            />
          </label>

          <label htmlFor="example">
            Example
            <textarea id="example" name="example" rows={2} maxLength={2000} />
          </label>

          {/* ---- Actions ---- */}
          <div className="add-signal-actions">
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? "Proposing…" : "Propose signal"}
            </button>
            {state.error && <p role="alert">{state.error}</p>}
          </div>
        </form>
      </section>
    </details>
  );
}
