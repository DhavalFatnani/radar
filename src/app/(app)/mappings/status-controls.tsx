"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LifecycleStatus } from "@/lib/mappings/schema";
import { approveMappingAction, retireMappingAction } from "./actions";

export function StatusControls({
  mappingId,
  status,
}: {
  mappingId: string;
  status: LifecycleStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function run(action: (id: string) => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const r = await action(mappingId);
      if (r.ok) router.refresh();
      else setError(r.error ?? "Action failed.");
    });
  }

  return (
    <div className="status-controls">
      {status === "proposed" && (
        <>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(approveMappingAction)}>
            Approve
          </button>
          <button type="button" className="btn" disabled={pending} onClick={() => run(retireMappingAction)}>
            Retire
          </button>
        </>
      )}
      {status === "approved" && (
        <button type="button" className="btn" disabled={pending} onClick={() => run(retireMappingAction)}>
          Retire
        </button>
      )}
      {status === "retired" && (
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(approveMappingAction)}>
          Un-retire
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
