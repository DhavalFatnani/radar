"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  nextStages,
  isTerminal,
  STAGE_LABELS,
  type PipelineStage,
} from "@/lib/pipeline/schema";
import { advanceLeadStageAction } from "./actions";

export function StageControls({
  leadId,
  stage,
}: {
  leadId: string;
  stage: PipelineStage;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  // Hooks run unconditionally above this early return (Rules of Hooks).
  if (isTerminal(stage)) return null;

  function move(to: PipelineStage) {
    setError(undefined);
    startTransition(async () => {
      const r = await advanceLeadStageAction(leadId, to);
      if (r.ok) router.refresh();
      else setError(r.error ?? "Action failed.");
    });
  }

  return (
    <div className="stage-controls">
      {nextStages(stage).map((to) => (
        <button
          key={to}
          type="button"
          className={to === "lost" ? "btn btn-sm" : "btn btn-sm btn-primary"}
          disabled={pending}
          onClick={() => move(to)}
        >
          {to === "lost" ? "Mark lost" : `Move to ${STAGE_LABELS[to]}`}
        </button>
      ))}
      {error && (
        <p role="alert" className="stage-error">
          {error}
        </p>
      )}
    </div>
  );
}
