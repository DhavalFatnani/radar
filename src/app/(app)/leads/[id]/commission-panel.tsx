"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PipelineStage } from "@/lib/pipeline/schema";
import {
  COMMISSION_STATUS_LABELS,
  CYCLE_STATUS_LABELS,
  formatInr,
  isCycleOverdue,
  isCommissionEligible,
  type CommissionRecord,
  type CommissionBasis,
  type CommissionType,
  type RecurringCadence,
} from "@/lib/commission/schema";
import {
  setCommissionTermsAction,
  activateCommissionAction,
  markCyclePaidAction,
  markCycleMissedAction,
  waiveCycleAction,
  addNextCycleAction,
  appendDisclosureAction,
  appendIntroductionAction,
  openDisputeAction,
  resolveDisputeAction,
} from "../actions";

type Action = () => Promise<{ ok: boolean; error?: string }>;

export function CommissionPanel({
  leadId,
  stage,
  commission,
  today,
}: {
  leadId: string;
  stage: PipelineStage;
  commission: CommissionRecord | null;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [confirmSeq, setConfirmSeq] = useState<number | null>(null);

  function run(action: Action) {
    setError(undefined);
    startTransition(async () => {
      const r = await action();
      if (r.ok) router.refresh();
      else setError(r.error ?? "Action failed.");
    });
  }

  return (
    <section className="commission-panel" aria-label="Commission">
      <header className="commission-head">
        <h2>Commission</h2>
        {commission && (
          <span className={`commission-status commission-status-${commission.status}`}>
            {COMMISSION_STATUS_LABELS[commission.status]}
          </span>
        )}
      </header>

      {!commission ? (
        isCommissionEligible(stage) ? (
          <TermsForm leadId={leadId} pending={pending} run={run} />
        ) : (
          <p className="commission-note">Set commission terms once the deal is won.</p>
        )
      ) : (
        <>
          <TermsSummary commission={commission} />

          {commission.status === "pending" && (stage === "delivered" || stage === "paid") && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pending}
              onClick={() => run(() => activateCommissionAction(leadId))}
            >
              Activate commission (deal delivered)
            </button>
          )}

          <table className="commission-cycles">
            <caption>Payment cycles</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Due</th>
                <th scope="col">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {commission.cycles.map((c) => {
                const overdue = isCycleOverdue(c, today);
                return (
                  <tr key={c.seq}>
                    <td>{c.seq}</td>
                    <td>{c.dueDate}</td>
                    <td>{formatInr(c.amountInr)}</td>
                    <td>
                      {CYCLE_STATUS_LABELS[c.status]}
                      {overdue && <span className="commission-overdue"> · Overdue</span>}
                    </td>
                    <td>
                      {(c.status === "due" || c.status === "missed") &&
                        (confirmSeq === c.seq ? (
                          <span className="commission-confirm" role="group" aria-label={`Confirm payment for cycle ${c.seq}`}>
                            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => { setConfirmSeq(null); run(() => markCyclePaidAction(leadId, c.seq)); }}>
                              Confirm
                            </button>
                            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setConfirmSeq(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="commission-cycle-actions">
                            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setConfirmSeq(c.seq)}>
                              Mark paid
                            </button>
                            {c.status === "due" && (
                              <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => markCycleMissedAction(leadId, c.seq))}>
                                Mark missed
                              </button>
                            )}
                            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => waiveCycleAction(leadId, c.seq))}>
                              Waive
                            </button>
                          </span>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {commission.terms?.type === "recurring" && commission.status === "active" && (
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => addNextCycleAction(leadId))}>
              Add next cycle
            </button>
          )}

          <LeakLogs commission={commission} leadId={leadId} pending={pending} run={run} />
        </>
      )}

      {error && (
        <p role="alert" className="commission-error">
          {error}
        </p>
      )}
    </section>
  );
}

function TermsForm({ leadId, pending, run }: { leadId: string; pending: boolean; run: (a: Action) => void }) {
  const [type, setType] = useState<CommissionType>("one_time");
  const [basis, setBasis] = useState<CommissionBasis>("flat");
  const [dealValue, setDealValue] = useState("");
  const [ratePct, setRatePct] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<RecurringCadence>("monthly");

  function submit() {
    const terms =
      basis === "percentage"
        ? {
            type,
            basis,
            dealValueInr: Math.round(Number(dealValue) * 100),
            rateBps: Math.round(Number(ratePct) * 100),
            ...(type === "recurring" ? { cadence } : {}),
          }
        : {
            type,
            basis,
            amountInr: Math.round(Number(amount) * 100),
            ...(type === "recurring" ? { cadence } : {}),
          };
    run(() => setCommissionTermsAction(leadId, terms));
  }

  return (
    <form
      className="commission-form"
      aria-label="Commission terms"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="commission-field">
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as CommissionType)}>
          <option value="one_time">One-time</option>
          <option value="recurring">Recurring</option>
        </select>
      </label>
      <label className="commission-field">
        <span>Basis</span>
        <select value={basis} onChange={(e) => setBasis(e.target.value as CommissionBasis)}>
          <option value="flat">Flat amount</option>
          <option value="percentage">Percentage of deal</option>
        </select>
      </label>
      {basis === "percentage" ? (
        <>
          <label className="commission-field">
            <span>Deal value (₹)</span>
            <input type="number" min="0" step="0.01" value={dealValue} onChange={(e) => setDealValue(e.target.value)} />
          </label>
          <label className="commission-field">
            <span>Rate (%)</span>
            <input type="number" min="0" max="100" step="0.01" value={ratePct} onChange={(e) => setRatePct(e.target.value)} />
          </label>
        </>
      ) : (
        <label className="commission-field">
          <span>Flat amount (₹)</span>
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      )}
      {type === "recurring" && (
        <label className="commission-field">
          <span>Cadence</span>
          <select value={cadence} onChange={(e) => setCadence(e.target.value as RecurringCadence)}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
        </label>
      )}
      <button type="submit" className="btn btn-sm btn-primary" disabled={pending}>
        Save commission terms
      </button>
    </form>
  );
}

function TermsSummary({ commission }: { commission: CommissionRecord }) {
  const t = commission.terms;
  if (!t) return null;
  return (
    <dl className="commission-terms">
      <div className="fact">
        <dt>Type</dt>
        <dd>{t.type === "recurring" ? `Recurring (${t.cadence})` : "One-time"}</dd>
      </div>
      <div className="fact">
        <dt>Basis</dt>
        <dd>
          {t.basis === "percentage"
            ? `${(t.rateBps! / 100).toFixed(2)}% of ${formatInr(t.dealValueInr!)}`
            : formatInr(t.amountInr!)}
        </dd>
      </div>
    </dl>
  );
}

function LeakLogs({
  commission,
  leadId,
  pending,
  run,
}: {
  commission: CommissionRecord;
  leadId: string;
  pending: boolean;
  run: (a: Action) => void;
}) {
  const [field, setField] = useState("");
  const [to, setTo] = useState("");
  const [channel, setChannel] = useState("");
  const [reason, setReason] = useState("");
  const [resolution, setResolution] = useState("");
  const hasOpenDispute = commission.disputeLog.some((d) => d.status === "open");

  return (
    <div className="commission-logs">
      <section aria-label="Disclosure log">
        <h3>Disclosures</h3>
        <ul>
          {commission.disclosureLog.map((d, i) => (
            <li key={i}>
              {d.at} — {d.contactField} → {d.disclosedTo}
            </li>
          ))}
        </ul>
        <div className="commission-log-add" role="group" aria-label="Add disclosure">
          <input aria-label="Contact field disclosed" value={field} onChange={(e) => setField(e.target.value)} placeholder="e.g. email" />
          <input aria-label="Disclosed to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. vendor" />
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending || !field || !to}
            onClick={() => { run(() => appendDisclosureAction(leadId, field, to)); setField(""); setTo(""); }}
          >
            Log disclosure
          </button>
        </div>
      </section>

      <section aria-label="Introduction log">
        <h3>Introductions</h3>
        <ul>
          {commission.introductionLog.map((d, i) => (
            <li key={i}>
              {d.at} — {d.channel}
            </li>
          ))}
        </ul>
        <div className="commission-log-add" role="group" aria-label="Add introduction">
          <input aria-label="Introduction channel" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="e.g. email" />
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending || !channel}
            onClick={() => { run(() => appendIntroductionAction(leadId, channel)); setChannel(""); }}
          >
            Log introduction
          </button>
        </div>
      </section>

      <section aria-label="Dispute log">
        <h3>Disputes</h3>
        <ul>
          {commission.disputeLog.map((d, i) => (
            <li key={i}>
              {d.openedAt} — {d.reason} ({d.status})
            </li>
          ))}
        </ul>
        {hasOpenDispute ? (
          <div className="commission-log-add" role="group" aria-label="Resolve dispute">
            <input aria-label="Resolution note" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="How it was resolved" />
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending || !resolution}
              onClick={() => { run(() => resolveDisputeAction(leadId, resolution)); setResolution(""); }}
            >
              Resolve dispute
            </button>
          </div>
        ) : (
          <div className="commission-log-add" role="group" aria-label="Open dispute">
            <input aria-label="Dispute reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why" />
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending || !reason}
              onClick={() => { run(() => openDisputeAction(leadId, reason)); setReason(""); }}
            >
              Open dispute
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
