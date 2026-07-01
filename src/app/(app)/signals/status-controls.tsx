"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LifecycleStatus } from "@/lib/signals/schema";
import { approveSignalAction, retireSignalAction } from "./actions";

export function StatusControls({
  signalId,
  status,
}: {
  signalId: string;
  status: LifecycleStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function run(action: (id: string) => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const r = await action(signalId);
      if (r.ok) router.refresh();
      else setError(r.error ?? "Action failed.");
    });
  }

  return (
    <div className="status-controls">
      {status === "proposed" && (
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => run(approveSignalAction)}
          >
            Approve
          </button>
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => run(retireSignalAction)}
          >
            Retire
          </button>
        </>
      )}
      {status === "approved" && (
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() => run(retireSignalAction)}
        >
          Retire
        </button>
      )}
      {status === "retired" && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => run(approveSignalAction)}
        >
          Un-retire
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
