import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createSignal, setSignalStatus } from "@/lib/signals/data";
import {
  listMappings, getMapping, createMapping, setMappingStatus, resolveSignalRefs,
} from "@/lib/mappings/data";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["signal_observations", "signal_definitions", "mappings"]); });
afterAll(async () => { await closeTestDb(); await queryClient.end(); });

async function approvedSignal(id: string) {
  await createSignal({ signalId: id, name: `S ${id}`, family: "expansion", strength: "high", falsePositiveRisk: "low" });
  await setSignalStatus(id, "approved");
}
async function proposedSignal(id: string) {
  await createSignal({ signalId: id, name: `S ${id}`, family: "expansion", strength: "high", falsePositiveRisk: "low" });
}

describe("createMapping", () => {
  it("inserts as 'proposed' with origin 'operator'", async () => {
    await approvedSignal("SIG-EXP-M-001");
    const r = await createMapping({ name: "M1", requiredSignals: ["SIG-EXP-M-001"] });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.mapping.status).toBe("proposed");
    expect(r.mapping.origin).toBe("operator");
    expect(r.mapping.requiredSignals).toEqual(["SIG-EXP-M-001"]);
  });
  it("rejects references to unknown signal IDs", async () => {
    const r = await createMapping({ name: "M-bad", requiredSignals: ["SIG-DOES-NOT-EXIST"] });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error).toContain("SIG-DOES-NOT-EXIST");
  });
});

describe("setMappingStatus (approval + validation gate)", () => {
  it("blocks approve when a required signal is not approved", async () => {
    await proposedSignal("SIG-EXP-M-010");
    const c = await createMapping({ name: "M2", requiredSignals: ["SIG-EXP-M-010"] });
    if (!c.ok) throw new Error("expected create ok");
    const r = await setMappingStatus(c.mapping.mappingId, "approved");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected block");
    expect(r.error).toContain("SIG-EXP-M-010");
  });
  it("approves once all required signals are approved", async () => {
    await approvedSignal("SIG-EXP-M-020");
    const c = await createMapping({ name: "M3", requiredSignals: ["SIG-EXP-M-020"] });
    if (!c.ok) throw new Error("expected create ok");
    const r = await setMappingStatus(c.mapping.mappingId, "approved");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.mapping.status).toBe("approved");
  });
  it("rejects a disallowed transition (approved→proposed)", async () => {
    await approvedSignal("SIG-EXP-M-030");
    const c = await createMapping({ name: "M4", requiredSignals: ["SIG-EXP-M-030"] });
    if (!c.ok) throw new Error("expected create ok");
    await setMappingStatus(c.mapping.mappingId, "approved");
    const r = await setMappingStatus(c.mapping.mappingId, "proposed");
    expect(r.ok).toBe(false);
  });
  it("always allows retire", async () => {
    await proposedSignal("SIG-EXP-M-040");
    const c = await createMapping({ name: "M5", requiredSignals: ["SIG-EXP-M-040"] });
    if (!c.ok) throw new Error("expected create ok");
    const r = await setMappingStatus(c.mapping.mappingId, "retired");
    expect(r.ok).toBe(true);
  });
  it("returns not found for a missing mapping", async () => {
    const r = await setMappingStatus("10000000-0000-4000-8000-0000000000ff", "approved");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error).toBe("Mapping not found.");
  });
  it("returns not found for a non-uuid id (no DB cast error)", async () => {
    const r = await setMappingStatus("not-a-uuid", "approved");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error).toBe("Mapping not found.");
  });
});

describe("resolveSignalRefs", () => {
  it("returns statuses and marks missing refs with null status", async () => {
    await approvedSignal("SIG-EXP-M-050");
    await proposedSignal("SIG-EXP-M-051");
    const refs = await resolveSignalRefs(["SIG-EXP-M-050", "SIG-EXP-M-051", "SIG-MISSING-999"]);
    const byId = Object.fromEntries(refs.map((r) => [r.signalId, r.status]));
    expect(byId["SIG-EXP-M-050"]).toBe("approved");
    expect(byId["SIG-EXP-M-051"]).toBe("proposed");
    expect(byId["SIG-MISSING-999"]).toBeNull();
  });
});

describe("listMappings / getMapping", () => {
  it("filters by status and orders proposed before approved", async () => {
    await approvedSignal("SIG-EXP-M-060");
    const a = await createMapping({ name: "Alpha", requiredSignals: ["SIG-EXP-M-060"] });
    const b = await createMapping({ name: "Bravo", requiredSignals: ["SIG-EXP-M-060"] });
    if (!a.ok || !b.ok) throw new Error("expected create ok");
    await setMappingStatus(b.mapping.mappingId, "approved");

    const proposed = await listMappings({ status: "proposed" });
    expect(proposed.map((m) => m.name)).toContain("Alpha");
    expect(proposed.map((m) => m.name)).not.toContain("Bravo");

    const all = await listMappings();
    const statuses = all.map((m) => m.status);
    expect(statuses.lastIndexOf("proposed")).toBeLessThan(statuses.indexOf("approved"));
  });
  it("getMapping returns null for a non-uuid id (no DB error)", async () => {
    expect(await getMapping("not-a-uuid")).toBeNull();
  });
});
