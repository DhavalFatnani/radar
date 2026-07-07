"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/app/components/ui/field";
import { ToggleRow } from "@/app/components/ui/toggle-row";
import { FilterChips, Segmented } from "@/app/components/ui/controls";
import { Stepper } from "@/app/components/ui/stepper";
import { ReadinessBanner } from "@/app/components/ui/readiness-banner";
import { createCampaignAction, type FindLeadsState } from "./actions";
import { MONTH_OPTS, ROUND_OPTS, SIZE_OPTS, MINSCORE_OPTS, SORT_OPTS } from "@/lib/campaigns/new-campaign";

export type VendorSnapshot = {
  vendorId: string; name: string; vendorType: string | null; version: number;
  capabilities: string[]; runnable: boolean; signalFamilies: string[];
  recentRuns: { label: string; leads: number; when: string }[];
};

const GEO_OPTS = [
  { value: "IND", label: "India (IND)" }, { value: "USA", label: "United States (USA)" }, { value: "GBR", label: "United Kingdom (GBR)" },
];
const Soon = () => <span className="soon">soon</span>;

export function NewCampaignForm({ vendors }: { vendors: VendorSnapshot[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<FindLeadsState, FormData>(createCampaignAction, { ok: false });
  const [vendorId, setVendorId] = useState(vendors[0]?.vendorId ?? "");
  const [target, setTarget] = useState(20);
  const [months, setMonths] = useState(12);
  const [round, setRound] = useState("any");
  const [source, setSource] = useState("crustdata");
  const [minScore, setMinScore] = useState("0");

  const vendor = useMemo(() => vendors.find((v) => v.vendorId === vendorId) ?? vendors[0], [vendors, vendorId]);
  useEffect(() => { if (state.ok && state.campaignId) router.push(`/campaigns/${state.campaignId}`); }, [state, router]);

  const ready = !!vendor?.runnable;
  const estCost = source === "crustdata" ? `≈ ${(target * 0.03).toFixed(1)}–${(target * 0.045).toFixed(1)}` : "0";

  return (
    <div className="new-grid">
      <form className="form-panel" action={formAction}>
        <input type="hidden" name="vendorId" value={vendorId} />

        <div className="fsec">
          <div className="fsec-head">Target</div>
          <Field label="Vendor" htmlFor="vendor">
            <select id="vendor" className="field-input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              {vendors.map((v) => <option key={v.vendorId} value={v.vendorId}>{v.name}{v.vendorType ? ` — ${v.vendorType}` : " — (no type set)"}</option>)}
            </select>
          </Field>
          <ReadinessBanner ok={ready}>
            {ready
              ? <><b>Ready to source.</b> Approved mappings will hunt {vendor?.signalFamilies.join(" · ") || "its signals"}.</>
              : <><b>Not ready.</b> This vendor has no approved mappings yet — add a type + mapping first.</>}
          </ReadinessBanner>
          <div className="field-pair" style={{ marginTop: "var(--space-3)" }}>
            <Field label="Geography" htmlFor="geo">
              <select id="geo" name="geography" className="field-input" defaultValue="IND">
                {GEO_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label={<>Company size <Soon /></>} htmlFor="size">
              <select id="size" name="companySize" className="field-input" defaultValue="any">
                {SIZE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <div className="fsec">
          <div className="fsec-head">Scope</div>
          <Field label="How many companies · target" htmlFor="target"><Stepper value={target} onChange={setTarget} min={1} max={25} name="target" /></Field>
          <Field label="Funded within" htmlFor="funded">
            <>
              <FilterChips options={MONTH_OPTS.map((m) => ({ value: String(m), label: `${m} mo` }))} value={String(months)} onChange={(v) => setMonths(Number(v))} />
              <input type="hidden" name="fundedMonths" value={months} />
            </>
          </Field>
        </div>

        <div className="fsec">
          <div className="fsec-head">Filters <Soon /></div>
          <Field label="Funding round type" htmlFor="round">
            <>
              <FilterChips options={ROUND_OPTS.map((o) => ({ value: o.value, label: o.label }))} value={round} onChange={setRound} />
              <input type="hidden" name="roundType" value={round} />
            </>
          </Field>
          <div className="field-pair">
            <Field label="Min lead score" htmlFor="minscore">
              <select id="minscore" name="minScore" className="field-input" value={minScore} onChange={(e) => setMinScore(e.target.value)}>
                {MINSCORE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Sort results by" htmlFor="sort">
              <select id="sort" name="sortBy" className="field-input" defaultValue="score">
                {SORT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ marginTop: "var(--space-3)" }}>
            <ToggleRow label="Exclude leads I've already seen" description="Skip companies surfaced in past runs" name="excludeSeen" defaultChecked />
          </div>
        </div>

        <div className="fsec">
          <div className="fsec-head">Source</div>
          <Segmented options={[{ value: "crustdata", label: "Live (Crustdata)" }, { value: "company-fixture", label: "Test data" }]} value={source} onChange={setSource} />
          <input type="hidden" name="source" value={source} />
          <details className="adv"><summary>Advanced — enrich top-N · mappings <Soon /></summary></details>
        </div>

        {state.error ? <p role="alert" className="run-error">{state.error}</p> : null}
        <button type="submit" className="btn btn-primary form-submit" disabled={!ready || pending}>{pending ? "Sourcing…" : "Find Leads →"}</button>
      </form>

      <aside className="ctx-rail">
        <div className="ctx-panel">
          <h3>Vendor</h3>
          <p className="vsnap-name"><b>{vendor?.name}</b> <span>{vendor?.vendorType ?? "no type"} · v{vendor?.version}</span></p>
          <p className="vsnap-cap">{vendor?.capabilities.join(" · ") || "—"}</p>
          <ReadinessBanner ok={ready}>{ready ? "Ready to source" : "No approved mappings yet"}</ReadinessBanner>
        </div>
        <div className="ctx-panel">
          <h3>Recent runs · this vendor</h3>
          {vendor && vendor.recentRuns.length > 0 ? (
            <ul className="mini-runs">{vendor.recentRuns.map((r, i) => <li key={i}><span>{r.when} · {r.label}</span><b>{r.leads} leads</b></li>)}</ul>
          ) : <p className="qv-empty">No runs yet.</p>}
        </div>
        <div className="ctx-panel">
          <h3>Estimate</h3>
          <div className="kv-list">
            <div className="kv"><span className="kv-k">Companies</span><span className="kv-v">{target}</span></div>
            <div className="kv"><span className="kv-k">Window</span><span className="kv-v">≤ {months} mo</span></div>
            <div className="kv"><span className="kv-k">Est. cost</span><span className="kv-v">{estCost}</span></div>
            <div className="kv"><span className="kv-k">Lands in</span><span className="kv-v">Leads</span></div>
          </div>
        </div>
      </aside>
    </div>
  );
}
