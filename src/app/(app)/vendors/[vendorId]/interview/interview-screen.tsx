"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/app/components/ui/page-header";
import type { VendorProfile, VendorConstraints } from "@/lib/vendors/schema";
import type { InterviewArea } from "@/ai/sia";
import type { InterviewSummary } from "@/lib/interviews/schema";
import type { TurnResult } from "./types";
import { startInterview, submitAnswer, advanceInterview, saveInterview, endInterview } from "./actions";

const PANEL_AREAS: { key: InterviewArea; label: string }[] = [
  { key: "capabilities", label: "Capabilities" },
  { key: "constraints", label: "Constraints" },
  { key: "idealCustomer", label: "Ideal customer" },
];

function hasProfileContent(v: VendorProfile): boolean {
  return (
    v.capabilities.length > 0 ||
    Boolean(v.idealCustomer) ||
    Boolean(v.knownGoodSignals) ||
    Boolean(v.differentiators) ||
    Boolean(v.credibility) ||
    (v.constraints != null && Object.keys(v.constraints).length > 0)
  );
}

function constraintItems(c: VendorConstraints | null): string[] {
  if (!c) return [];
  const out: string[] = [];
  if (c.geographies?.length) out.push(c.geographies.join(", "));
  if (c.minProjectSize) out.push(`Min: ${c.minProjectSize}`);
  if (c.maxProjectSize) out.push(`Max: ${c.maxProjectSize}`);
  if (c.capacity) out.push(c.capacity);
  if (c.currentLoad) out.push(c.currentLoad);
  if (c.workingCapitalLimit) out.push(c.workingCapitalLimit);
  if (c.leadTimes) out.push(c.leadTimes);
  return out;
}

function itemsFor(area: InterviewArea, v: VendorProfile): string[] {
  if (area === "capabilities") return v.capabilities;
  if (area === "constraints") return constraintItems(v.constraints);
  if (area === "idealCustomer") return v.idealCustomer ? [v.idealCustomer] : [];
  return [];
}

function avatarFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "V";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function InterviewScreen({
  vendor,
  initialTurn,
  past,
}: {
  vendor: VendorProfile;
  initialTurn: TurnResult | null;
  past: InterviewSummary[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [turn, setTurn] = useState<Extract<TurnResult, { ok: true }> | null>(
    initialTurn && initialTurn.ok ? initialTurn : null,
  );
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const autoAdvanced = useRef(false);

  function apply(result: TurnResult) {
    if (result.ok) {
      setTurn(result);
      setError(null);
    } else {
      setError(result.error);
    }
  }

  // Resume a session left without a pending question (crash between answer and
  // question generation): generate the next question once on mount.
  useEffect(() => {
    if (turn && turn.pendingQuestion === "" && !autoAdvanced.current && !isPending) {
      autoAdvanced.current = true;
      startTransition(async () => apply(await advanceInterview(turn.interviewId)));
    }
  }, [turn, isPending]);

  function onStart() {
    startTransition(async () => apply(await startInterview(vendor.vendorId)));
  }
  function onSubmitAnswer(e: FormEvent) {
    e.preventDefault();
    if (!turn) return;
    const value = answer.trim();
    if (!value) return;
    setAnswer("");
    startTransition(async () => apply(await submitAnswer(turn.interviewId, value)));
  }
  function onRetry() {
    if (!turn) return;
    startTransition(async () => apply(await advanceInterview(turn.interviewId)));
  }
  function onSave() {
    if (!turn) return;
    startTransition(async () => {
      const res = await saveInterview(turn.interviewId);
      if (res.ok) router.push(`/vendors/${vendor.vendorId}`);
      else setError(res.error);
    });
  }
  function onEnd() {
    if (!turn) return;
    startTransition(async () => {
      await endInterview(turn.interviewId);
      router.push(`/vendors/${vendor.vendorId}`);
    });
  }

  // ---- Launch state ---------------------------------------------------------
  if (!turn) {
    return (
      <>
        <PageHeader eyebrow="Build" title={`Interview · ${vendor.name}`} />
        <section className="card card-pad">
          <p className="muted">
            {hasProfileContent(vendor)
              ? "Start a new interview to append and amend this vendor's profile. SIA asks only about what's new or changed."
              : "Start the first interview. SIA will build the profile from the vendor's answers, one question at a time."}
          </p>
          <button type="button" className="btn btn-primary" onClick={onStart} disabled={isPending}>
            {isPending ? "Starting…" : hasProfileContent(vendor) ? "Start re-interview" : "Start interview"}
          </button>
          {error && (
            <p role="alert" className="muted">
              {error}
            </p>
          )}
        </section>
        {past.length > 0 && (
          <section className="card card-pad" style={{ marginTop: "var(--space-4)" }}>
            <div className="eyebrow">Past interviews</div>
            <ul className="past-list">
              {past.map((p) => (
                <li key={p.interviewId}>
                  <span className="mono">{formatDate(p.startedAt)}</span> · {p.status}
                  {p.resultingVersion ? ` → v${p.resultingVersion}` : ""} · {p.messageCount} turns
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  // ---- Active interview -----------------------------------------------------
  const nextVersion = vendor.version + 1;
  return (
    <div className="sia-layout">
      <section className="interview card card-pad">
        <div className="iv-head">
          <div className="who">
            <span className="brand-mark" style={{ width: 30, height: 30, background: "var(--accent)" }}>
              SIA
            </span>
            <div>
              <div style={{ fontWeight: "var(--weight-semibold)" }}>{vendor.name}</div>
              <div className="faint" style={{ fontSize: "var(--text-xs)" }}>
                {hasProfileContent(vendor) ? "Re-interview · append & amend" : "First interview"}
              </div>
            </div>
          </div>
          <span className="ver-chip">
            v{vendor.version} → v{nextVersion}
          </span>
        </div>

        <div className="thread" id="thread">
          {turn.transcript.map((m, i) => (
            <div className={`msg ${m.role}`} key={i}>
              <span className="av">{m.role === "sia" ? "SIA" : avatarFor(vendor.name)}</span>
              <div>
                <div className="who-line">{m.role === "sia" ? "SIA" : `${vendor.name} (vendor)`}</div>
                <div className="bubble">{m.text}</div>
              </div>
            </div>
          ))}
          {turn.pendingQuestion && turn.transcript[turn.transcript.length - 1]?.role !== "sia" && (
            <div className="msg sia">
              <span className="av">SIA</span>
              <div>
                <div className="who-line">SIA</div>
                <div className="bubble">{turn.pendingQuestion}</div>
              </div>
            </div>
          )}
          {isPending && (
            <div className="msg sia">
              <span className="av">SIA</span>
              <div>
                <div className="who-line">SIA</div>
                <div className="bubble muted">Thinking…</div>
              </div>
            </div>
          )}
        </div>

        <form className="composer" onSubmit={onSubmitAnswer}>
          <input
            id="ci"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type the vendor's answer…"
            aria-label="Vendor answer"
            disabled={isPending}
          />
          <button type="submit" className="btn btn-primary" disabled={isPending || !answer.trim()}>
            Continue interview
          </button>
        </form>
        <div className="row between" style={{ marginTop: "var(--space-3)" }}>
          <button type="button" className="btn btn-ghost" onClick={onEnd} disabled={isPending}>
            End interview
          </button>
          <button
            type="button"
            className={`btn ${turn.isComplete ? "btn-primary" : ""}`}
            onClick={onSave}
            disabled={isPending}
          >
            Save &amp; version v{nextVersion}
          </button>
        </div>
        {error && (
          <div
            className="row"
            style={{ marginTop: "var(--space-2)", gap: "var(--space-3)", alignItems: "center" }}
          >
            <p role="alert" className="muted" style={{ margin: 0 }}>
              {error}
            </p>
            <button type="button" className="btn btn-ghost" onClick={onRetry} disabled={isPending}>
              Retry
            </button>
          </div>
        )}
      </section>

      <aside className="side">
        <div className="card card-pad">
          <div className="panel-head" style={{ marginBottom: "var(--space-3)" }}>
            <h2 style={{ fontSize: "var(--text-md)" }}>Profile forming</h2>
            <span className="count-pill">v{nextVersion} draft</span>
          </div>
          {PANEL_AREAS.map(({ key, label }) => {
            const items = itemsFor(key, vendor);
            const covered = turn.coverage.covered.includes(key);
            return (
              <div className="prof-section" key={key}>
                <div className="eyebrow">
                  <span>{label}</span>
                  <span className="dots">
                    <i className={covered ? "on" : ""} />
                  </span>
                </div>
                {items.length > 0 ? (
                  items.map((it, i) => (
                    <div className="prof-item" key={i}>
                      {it}
                    </div>
                  ))
                ) : (
                  <div className="prof-item">
                    <span className="thin">● not yet pinned</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="card inset card-pad">
          <div className="eyebrow" style={{ marginBottom: "var(--space-2)" }}>
            Operator co-pilot
          </div>
          <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
            SIA probes for precision where the profile is thin. Vague answers make weak leads — push for
            specifics on anything still marked <span className="thin">● not yet pinned</span>.
          </p>
        </div>
      </aside>
    </div>
  );
}
