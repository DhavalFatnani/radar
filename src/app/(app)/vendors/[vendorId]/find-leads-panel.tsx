"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { findLeadsAction, type FindLeadsState } from "@/app/(app)/campaigns/actions";
import type { SourcingReadiness } from "@/lib/campaigns/readiness";

export function FindLeadsPanel({ vendorId, readiness }: { vendorId: string; readiness: SourcingReadiness }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(findLeadsAction, { ok: false } as FindLeadsState);

  useEffect(() => {
    if (state.ok && state.campaignId) router.push(`/campaigns/${state.campaignId}`);
  }, [state.ok, state.campaignId, router]);

  return (
    <section className="readiness-panel" aria-label="Find leads">
      <h2>Find leads</h2>
      {readiness.runnable ? (
        <>
          <p className="readiness-ok">Ready to source — approved mappings will hunt: {readiness.signalFamilies.join(", ") || "—"}.</p>
          <form action={formAction} className="add-mapping-form">
            <input type="hidden" name="vendorId" value={vendorId} />
            <label htmlFor="fl-geo">Geography
              <input id="fl-geo" name="geography" type="text" defaultValue="IND" maxLength={8} autoComplete="off" />
            </label>
            <label htmlFor="fl-target">How many
              <input id="fl-target" name="target" type="number" defaultValue={20} min={1} max={25} />
            </label>
            <label htmlFor="fl-source">Data source
              <select id="fl-source" name="source" defaultValue="crustdata">
                <option value="crustdata">Live (Crustdata)</option>
                <option value="company-fixture">Test data</option>
              </select>
            </label>
            <div className="add-mapping-actions">
              <button type="submit" className="btn btn-primary" disabled={isPending}>
                {isPending ? "Sourcing…" : "Find Leads"}
              </button>
              {state.error && <p role="alert">{state.error}</p>}
            </div>
          </form>
        </>
      ) : (
        <p className="readiness-warn">
          Needs an approved mapping for this vendor’s type{readiness.vendorType ? ` (“${readiness.vendorType}”)` : ""} before it can source.
          Approve a matching mapping in <Link href="/mappings">Mappings</Link> first.
        </p>
      )}
    </section>
  );
}
