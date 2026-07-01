import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import {
  listSignals,
  getSignal,
  createSignal,
  setSignalStatus,
} from "@/lib/signals/data";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["signal_observations", "signal_definitions"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

// Minimal valid input for a signal
function sig(signalId: string, family: "hiring" | "procurement" | "money" | "expansion" | "leadership" | "digital" = "hiring") {
  return {
    signalId,
    name: `Test Signal ${signalId}`,
    family,
    strength: "medium" as const,
    falsePositiveRisk: "low" as const,
  };
}

describe("createSignal", () => {
  it("inserts as 'proposed' with origin/proposedBy 'operator' and dateAdded set", async () => {
    const r = await createSignal(sig("SIG-HIRING-TEST-001"));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("Expected ok");
    expect(r.signal.status).toBe("proposed");
    expect(r.signal.origin).toBe("operator");
    expect(r.signal.proposedBy).toBe("operator");
    expect(r.signal.dateAdded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.signal.signalId).toBe("SIG-HIRING-TEST-001");
    expect(r.signal.family).toBe("hiring");
  });

  it("returns { ok: false } on a duplicate signalId", async () => {
    await createSignal(sig("SIG-HIRING-TEST-DUP"));
    const r2 = await createSignal(sig("SIG-HIRING-TEST-DUP"));
    expect(r2.ok).toBe(false);
    if (r2.ok) throw new Error("Expected failure");
    expect(r2.error).toBe("A signal with that ID already exists.");
  });
});

describe("setSignalStatus", () => {
  it("transitions proposed→approved, approved→retired, retired→approved", async () => {
    await createSignal(sig("SIG-HIRING-TRANS-001"));

    const toApproved = await setSignalStatus("SIG-HIRING-TRANS-001", "approved");
    expect(toApproved.ok).toBe(true);
    if (!toApproved.ok) throw new Error("Expected ok");
    expect(toApproved.signal.status).toBe("approved");

    const toRetired = await setSignalStatus("SIG-HIRING-TRANS-001", "retired");
    expect(toRetired.ok).toBe(true);
    if (!toRetired.ok) throw new Error("Expected ok");
    expect(toRetired.signal.status).toBe("retired");

    const backToApproved = await setSignalStatus("SIG-HIRING-TRANS-001", "approved");
    expect(backToApproved.ok).toBe(true);
    if (!backToApproved.ok) throw new Error("Expected ok");
    expect(backToApproved.signal.status).toBe("approved");
  });

  it("returns { ok: false } for approved→proposed (canTransition rejects)", async () => {
    await createSignal(sig("SIG-HIRING-TRANS-002"));
    await setSignalStatus("SIG-HIRING-TRANS-002", "approved");
    const r = await setSignalStatus("SIG-HIRING-TRANS-002", "proposed");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("Expected failure");
    expect(r.error).toBe("Cannot move a approved signal to proposed.");
  });

  it("returns { ok: false } when signal not found", async () => {
    const r = await setSignalStatus("SIG-NONEXISTENT-999", "approved");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("Expected failure");
    expect(r.error).toBe("Signal not found.");
  });
});

describe("listSignals", () => {
  it("filters by status", async () => {
    await createSignal(sig("SIG-HIRING-FILTER-001"));
    await createSignal(sig("SIG-HIRING-FILTER-002"));
    await setSignalStatus("SIG-HIRING-FILTER-002", "approved");

    const proposed = await listSignals({ status: "proposed" });
    expect(proposed.map((s) => s.signalId)).toContain("SIG-HIRING-FILTER-001");
    expect(proposed.map((s) => s.signalId)).not.toContain("SIG-HIRING-FILTER-002");

    const approved = await listSignals({ status: "approved" });
    expect(approved.map((s) => s.signalId)).toContain("SIG-HIRING-FILTER-002");
    expect(approved.map((s) => s.signalId)).not.toContain("SIG-HIRING-FILTER-001");
  });

  it("filters by family", async () => {
    await createSignal(sig("SIG-HIRING-FAM-001", "hiring"));
    await createSignal(sig("SIG-MONEY-FAM-001", "money"));

    const hiring = await listSignals({ family: "hiring" });
    expect(hiring.map((s) => s.signalId)).toContain("SIG-HIRING-FAM-001");
    expect(hiring.map((s) => s.signalId)).not.toContain("SIG-MONEY-FAM-001");

    const money = await listSignals({ family: "money" });
    expect(money.map((s) => s.signalId)).toContain("SIG-MONEY-FAM-001");
    expect(money.map((s) => s.signalId)).not.toContain("SIG-HIRING-FAM-001");
  });

  it("orders proposed before approved before retired", async () => {
    await createSignal(sig("SIG-HIRING-ORDER-A", "hiring"));
    await createSignal(sig("SIG-HIRING-ORDER-B", "hiring"));
    await createSignal(sig("SIG-HIRING-ORDER-C", "hiring"));
    await setSignalStatus("SIG-HIRING-ORDER-A", "approved");
    await setSignalStatus("SIG-HIRING-ORDER-B", "retired");
    // ORDER-C stays proposed

    const all = await listSignals();
    const statuses = all.map((s) => s.status);
    const firstApprovedIdx = statuses.indexOf("approved");
    const firstRetiredIdx = statuses.indexOf("retired");
    const lastProposedIdx = statuses.lastIndexOf("proposed");

    expect(lastProposedIdx).toBeLessThan(firstApprovedIdx);
    expect(firstApprovedIdx).toBeLessThan(firstRetiredIdx);
  });
});

describe("getSignal", () => {
  it("returns the signal when found", async () => {
    await createSignal(sig("SIG-HIRING-GET-001"));
    const result = await getSignal("SIG-HIRING-GET-001");
    expect(result).not.toBeNull();
    expect(result?.signalId).toBe("SIG-HIRING-GET-001");
    expect(result?.status).toBe("proposed");
  });

  it("returns null when not found", async () => {
    const result = await getSignal("SIG-NONEXISTENT-XYZ");
    expect(result).toBeNull();
  });
});
