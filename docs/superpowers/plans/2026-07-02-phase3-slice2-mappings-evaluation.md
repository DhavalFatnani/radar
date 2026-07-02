# Phase 3 · Slice 3.2 — Mappings + Evaluation (validation gate) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mapping library live — browse / propose / approve-retire mappings, seed the 2 canonical Phase0 mappings, and add a static validation gate (references must be real signals; approval requires all required signals to be approved; a detail readiness panel).

**Architecture:** Mirror the shipped 3.1 signals slice exactly. Pure `schema.ts` (Zod + types, reusing the lifecycle primitives from `@/lib/signals/schema`) + server-only `data.ts`; `"use server"` actions guarded by `signedIn()`; server list + detail pages; small `"use client"` form and status-controls; a presentational readiness panel. Live company-vs-mapping scoring is **out of scope** (Phase 4).

**Tech Stack:** Next.js 15 App Router (async `params`/`searchParams`), TypeScript strict, Drizzle + postgres-js on Neon, NextAuth v5, Zod, Vitest 4 (jsdom for components, real Neon for integration).

## Global Constraints

- **Data-module split:** `src/lib/mappings/schema.ts` is pure — Zod + types only, **no `@/db` import** (client-safe). All DB access lives in `src/lib/mappings/data.ts`. Client components import **types + server-action refs only** — never `@/db` or `data.ts`. The build fails if a server-only import reaches a client bundle.
- **Reuse the lifecycle gate:** import `LifecycleStatus`, `LIFECYCLE_STATUSES`, `canTransition` from `@/lib/signals/schema` (pure module). Do **not** duplicate the transition table, and do **not** modify any shipped `src/lib/signals/**` file.
- **Auth guard (verbatim):** every server action's FIRST statement is `if (!(await signedIn())) return { ok: false, error: "Not signed in." };` where `async function signedIn() { const session = await auth(); return Boolean(session?.user); }`. No DB touch, no throw, on the unauthenticated path.
- **Next.js 15:** `params` AND `searchParams` are Promises — `await` them before use.
- **Approval gate:** operator-created mappings enter `proposed`; seed mappings load `approved`. Allowed transitions: `proposed→approved`, `proposed→retired`, `approved→retired`, `retired→approved`. Disallowed = friendly `{ ok:false, error }`, never a throw.
- **Validation gate:** `createMapping` rejects references to signal IDs that do not exist. Any transition **to `approved`** requires every `requiredSignals` entry to currently be an `approved` signal — else a friendly no-op error naming the blockers.
- **Security:** Zod-validate all input; parameterized Drizzle queries only; bounded reads (`.limit(500)` / `.limit(1)`); never leak internals/stack traces to the client (friendly `{ ok, error }` shapes only).
- **Frontend:** semantic HTML, labelled inputs, keyboard-navigable controls, mobile-first.
- **No new migration** (the `mappings` table + `lifecycle_status` enum already exist). **No** `git add .`/`-A` — stage only the explicit files each task names. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Tests:** single `vitest.config.ts`; `npm test` runs unit + integration serially against real Neon. TDD per step.

## File Structure

- `src/lib/mappings/schema.ts` (create) — pure Zod + types + lifecycle re-exports.
- `src/lib/mappings/data.ts` (create) — `listMappings`, `getMapping`, `resolveSignalRefs`, `createMapping`, `setMappingStatus`.
- `src/db/seed-mappings.ts` (create) — idempotent 2-mapping seeder + direct-run guard.
- `package.json` (modify) — add `db:seed:mappings` script.
- `src/app/(app)/mappings/page.tsx` (replace stub) — list + filter + form.
- `src/app/(app)/mappings/mapping-list.tsx` (create) — grouped list.
- `src/app/(app)/mappings/actions.ts` (create) — `createMappingAction`, `approveMappingAction`, `retireMappingAction`.
- `src/app/(app)/mappings/[mappingId]/page.tsx` (create) — detail + readiness panel + status controls.
- `src/app/(app)/mappings/status-controls.tsx` (create) — approve/retire/un-retire buttons.
- `src/app/(app)/mappings/readiness-panel.tsx` (create) — presentational readiness view.
- `src/app/(app)/mappings/add-mapping-form.tsx` (create) — propose form with approved-signal checklists.
- `src/app/styles/command.css` (modify) — append mapping CSS (per task).
- Tests: `tests/unit/lib/mappings-schema.test.ts`, `tests/integration/mappings-data.test.ts` (replaces `tests/integration/mappings.test.ts`), `tests/integration/seed-mappings.test.ts`, `tests/unit/components/mappings-list.test.tsx`, `tests/unit/components/mappings-status-controls.test.tsx`, `tests/unit/components/mappings-add-form.test.tsx`.

---

### Task 1: `src/lib/mappings/schema.ts` (pure Zod + types)

**Files:**
- Create: `src/lib/mappings/schema.ts`
- Test: `tests/unit/lib/mappings-schema.test.ts`

**Interfaces:**
- Consumes: `LifecycleStatus`, `LIFECYCLE_STATUSES`, `canTransition` from `@/lib/signals/schema`.
- Produces: `type MappingDefinition`, `type SignalRef`, `createMappingSchema`, `type CreateMappingInput`, and re-exports `LIFECYCLE_STATUSES`, `canTransition`, `type LifecycleStatus`.

- [ ] **Step 1: Write the failing test** — `tests/unit/lib/mappings-schema.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createMappingSchema, canTransition } from "@/lib/mappings/schema";

const valid = { name: "Warehouse expansion", requiredSignals: ["SIG-EXP-NEW-FACILITY"] };

describe("createMappingSchema", () => {
  it("accepts a valid minimal mapping", () => {
    expect(createMappingSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects an empty name", () => {
    expect(createMappingSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });
  it("rejects zero required signals", () => {
    expect(createMappingSchema.safeParse({ ...valid, requiredSignals: [] }).success).toBe(false);
  });
  it("rejects a bad signal-id shape", () => {
    expect(createMappingSchema.safeParse({ ...valid, requiredSignals: ["nope"] }).success).toBe(false);
  });
  it("parses a newline/comma disqualifiers string into a clean list", () => {
    const r = createMappingSchema.parse({ ...valid, disqualifiers: "layoffs, shutdown\n existing client " });
    expect(r.disqualifiers).toEqual(["layoffs", "shutdown", "existing client"]);
  });
  it("coerces timingWindowDays to a number", () => {
    const r = createMappingSchema.parse({ ...valid, timingWindowDays: "180" });
    expect(r.timingWindowDays).toBe(180);
  });
});

describe("canTransition (re-exported)", () => {
  it("allows the governance moves", () => {
    expect(canTransition("proposed", "approved")).toBe(true);
    expect(canTransition("approved", "retired")).toBe(true);
    expect(canTransition("retired", "approved")).toBe(true);
  });
  it("rejects invalid moves", () => {
    expect(canTransition("approved", "proposed")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/lib/mappings-schema.test.ts`
Expected: FAIL — cannot resolve `@/lib/mappings/schema`.

- [ ] **Step 3: Write `src/lib/mappings/schema.ts`**

```ts
import { z } from "zod";
import { LIFECYCLE_STATUSES, canTransition } from "@/lib/signals/schema";
import type { LifecycleStatus } from "@/lib/signals/schema";

// Re-export the shared governance primitives so mappings consumers import from one module.
export { LIFECYCLE_STATUSES, canTransition };
export type { LifecycleStatus };

const SIGNAL_ID = /^SIG-[A-Z0-9-]{3,}$/;

// Read shape returned by the data layer for display (track_record omitted — computed).
export type MappingDefinition = {
  mappingId: string;
  name: string;
  intentDescription: string | null;
  servesVendorType: string | null;
  requiredSignals: string[] | null;
  supportingSignals: string[] | null;
  thresholdRule: string | null;
  timingWindowDays: number | null;
  strengthLogic: string | null;
  disqualifiers: string[] | null;
  status: LifecycleStatus;
  origin: string | null;
};

// A resolved signal reference for the readiness panel (status: null ⇒ the ID no longer resolves).
export type SignalRef = { signalId: string; name: string | null; status: LifecycleStatus | null };

// newline/comma-separated string (or array) -> clean string[]
const stringList = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(/[\n,]/)))
  .transform((a) => a.map((s) => s.trim()).filter(Boolean));

export const createMappingSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  requiredSignals: z
    .array(z.string().trim().regex(SIGNAL_ID, "Bad signal ID."))
    .min(1, "Select at least one required signal."),
  supportingSignals: z.array(z.string().trim().regex(SIGNAL_ID, "Bad signal ID.")).optional(),
  intentDescription: z.string().trim().max(4000).optional().transform((v) => (v && v.length ? v : undefined)),
  servesVendorType: z.string().trim().max(200).optional().transform((v) => (v && v.length ? v : undefined)),
  thresholdRule: z.string().trim().max(2000).optional().transform((v) => (v && v.length ? v : undefined)),
  timingWindowDays: z.coerce.number().int().min(0).max(3650).optional(),
  strengthLogic: z.string().trim().max(2000).optional().transform((v) => (v && v.length ? v : undefined)),
  disqualifiers: stringList.optional(),
});
export type CreateMappingInput = z.infer<typeof createMappingSchema>;
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/lib/mappings-schema.test.ts`
Expected: PASS (6 + 2 assertions green).

- [ ] **Step 5: Typecheck + confirm client-safety**

Run: `npx tsc --noEmit` (expect clean) and `grep -n "@/db" src/lib/mappings/schema.ts` (expect NO output).

- [ ] **Step 6: Commit**

```bash
git add src/lib/mappings/schema.ts tests/unit/lib/mappings-schema.test.ts
git commit -m "feat(mappings): pure schema (Zod + types) reusing the lifecycle gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `src/lib/mappings/data.ts` (DB layer + validation gate)

**Files:**
- Create: `src/lib/mappings/data.ts`
- Test: `tests/integration/mappings-data.test.ts`
- Delete: `tests/integration/mappings.test.ts` (its single `proposed`-default assertion is subsumed by the richer `createMapping` test below).

**Interfaces:**
- Consumes: `MappingDefinition`, `SignalRef`, `CreateMappingInput`, `LifecycleStatus`, `canTransition` from `@/lib/mappings/schema`; `mappings`, `signalDefinitions` from `@/db/schema`; `db` from `@/db/client`.
- Produces:
  - `listMappings(filter?: { status?: LifecycleStatus }): Promise<MappingDefinition[]>`
  - `getMapping(mappingId: string): Promise<MappingDefinition | null>`
  - `resolveSignalRefs(ids: string[]): Promise<SignalRef[]>`
  - `createMapping(input: CreateMappingInput): Promise<{ ok: true; mapping: MappingDefinition } | { ok: false; error: string }>`
  - `setMappingStatus(mappingId: string, to: LifecycleStatus): Promise<{ ok: true; mapping: MappingDefinition } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing test** — `tests/integration/mappings-data.test.ts`

```ts
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
```

- [ ] **Step 2: Delete the old smoke test and run to confirm failure**

```bash
git rm tests/integration/mappings.test.ts
```
Run: `npx vitest run tests/integration/mappings-data.test.ts`
Expected: FAIL — cannot resolve `@/lib/mappings/data`.

- [ ] **Step 3: Write `src/lib/mappings/data.ts`**

```ts
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { mappings, signalDefinitions } from "@/db/schema";
import type { MappingDefinition, SignalRef, CreateMappingInput, LifecycleStatus } from "@/lib/mappings/schema";
import { canTransition } from "@/lib/mappings/schema";

// Explicit column map — always use this to return the MappingDefinition shape (track_record omitted).
const COLUMNS = {
  mappingId: mappings.mappingId,
  name: mappings.name,
  intentDescription: mappings.intentDescription,
  servesVendorType: mappings.servesVendorType,
  requiredSignals: mappings.requiredSignals,
  supportingSignals: mappings.supportingSignals,
  thresholdRule: mappings.thresholdRule,
  timingWindowDays: mappings.timingWindowDays,
  strengthLogic: mappings.strengthLogic,
  disqualifiers: mappings.disqualifiers,
  status: mappings.status,
  origin: mappings.origin,
} as const;

// Status sort rank: proposed=0, approved=1, retired=2
const STATUS_RANK: Record<LifecycleStatus, number> = { proposed: 0, approved: 1, retired: 2 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listMappings(filter?: { status?: LifecycleStatus }): Promise<MappingDefinition[]> {
  const conditions = [];
  if (filter?.status) conditions.push(eq(mappings.status, filter.status));

  const rows = await db
    .select(COLUMNS)
    .from(mappings)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(500);

  rows.sort((a, b) => {
    const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  });

  return rows as MappingDefinition[];
}

export async function getMapping(mappingId: string): Promise<MappingDefinition | null> {
  if (!UUID_RE.test(mappingId)) return null; // avoid a 500 on a malformed detail URL
  const [row] = await db.select(COLUMNS).from(mappings).where(eq(mappings.mappingId, mappingId)).limit(1);
  return (row as MappingDefinition) ?? null;
}

export async function resolveSignalRefs(ids: string[]): Promise<SignalRef[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db
    .select({ signalId: signalDefinitions.signalId, name: signalDefinitions.name, status: signalDefinitions.status })
    .from(signalDefinitions)
    .where(inArray(signalDefinitions.signalId, unique));
  const byId = new Map(rows.map((r) => [r.signalId, r]));
  return unique.map((id) => {
    const row = byId.get(id);
    return row
      ? { signalId: id, name: row.name, status: row.status }
      : { signalId: id, name: null, status: null };
  });
}

export async function createMapping(
  input: CreateMappingInput,
): Promise<{ ok: true; mapping: MappingDefinition } | { ok: false; error: string }> {
  const refs = [...new Set([...(input.requiredSignals ?? []), ...(input.supportingSignals ?? [])])];
  const resolved = await resolveSignalRefs(refs);
  const missing = resolved.filter((r) => r.status === null).map((r) => r.signalId);
  if (missing.length > 0) {
    return { ok: false, error: `Unknown signal IDs: ${missing.join(", ")}` };
  }

  const rows = await db
    .insert(mappings)
    .values({
      name: input.name,
      intentDescription: input.intentDescription,
      servesVendorType: input.servesVendorType,
      requiredSignals: input.requiredSignals,
      supportingSignals: input.supportingSignals ?? [],
      thresholdRule: input.thresholdRule,
      timingWindowDays: input.timingWindowDays,
      strengthLogic: input.strengthLogic,
      disqualifiers: input.disqualifiers ?? [],
      status: "proposed",
      origin: "operator",
    })
    .returning(COLUMNS);

  return { ok: true, mapping: rows[0] as MappingDefinition };
}

export async function setMappingStatus(
  mappingId: string,
  to: LifecycleStatus,
): Promise<{ ok: true; mapping: MappingDefinition } | { ok: false; error: string }> {
  const [current] = await db
    .select({ status: mappings.status, requiredSignals: mappings.requiredSignals })
    .from(mappings)
    .where(eq(mappings.mappingId, mappingId))
    .limit(1);

  if (!current) return { ok: false, error: "Mapping not found." };

  if (!canTransition(current.status, to)) {
    return { ok: false, error: `Cannot move a ${current.status} mapping to ${to}.` };
  }

  // Validation gate: a mapping cannot go live unless its required signals are all live.
  if (to === "approved") {
    const required = current.requiredSignals ?? [];
    const refs = await resolveSignalRefs(required);
    const notApproved = refs.filter((r) => r.status !== "approved").map((r) => r.signalId);
    if (notApproved.length > 0) {
      return { ok: false, error: `Cannot approve: these required signals are not approved: ${notApproved.join(", ")}` };
    }
  }

  const rows = await db.update(mappings).set({ status: to }).where(eq(mappings.mappingId, mappingId)).returning(COLUMNS);
  return { ok: true, mapping: rows[0] as MappingDefinition };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/integration/mappings-data.test.ts`
Expected: PASS (all cases green). If a transient Neon TRUNCATE/latency failure appears, re-run 2–3× to confirm (known-flaky infra, not a code bug).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mappings/data.ts tests/integration/mappings-data.test.ts
git commit -m "feat(mappings): data layer with create-time + approve-time validation gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `src/db/seed-mappings.ts` (idempotent 2-mapping seeder)

**Files:**
- Create: `src/db/seed-mappings.ts`
- Modify: `package.json` (add `db:seed:mappings`)
- Test: `tests/integration/seed-mappings.test.ts`

**Interfaces:**
- Consumes: `mappings` from `@/db/schema`; `DB` type from `@/db/client`.
- Produces: `seedMappings(db: DB): Promise<{ inserted: number; total: number }>` — inserts the 2 canonical mappings (fixed UUID PKs, `status: 'approved'`, `origin: 'seed'`) with `onConflictDoNothing`.

- [ ] **Step 1: Write the failing test** — `tests/integration/seed-mappings.test.ts`

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { db, queryClient } from "@/db/client";
import { mappings } from "@/db/schema";
import { seedMappings } from "@/db/seed-mappings";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["mappings"]); });
afterAll(async () => { await closeTestDb(); await queryClient.end(); });

describe("seedMappings", () => {
  it("inserts 2 mappings all with status 'approved'", async () => {
    const result = await seedMappings(db);
    expect(result).toEqual({ inserted: 2, total: 2 });
    const rows = await db.select({ status: mappings.status, name: mappings.name }).from(mappings);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.status).toBe("approved");
    expect(rows.map((r) => r.name).sort()).toEqual(["Offline marketing push", "Warehouse expansion"]);
  });
  it("is idempotent — second run inserts 0, table stays at 2 rows", async () => {
    await seedMappings(db);
    const second = await seedMappings(db);
    expect(second).toEqual({ inserted: 0, total: 2 });
    const rows = await db.select().from(mappings);
    expect(rows).toHaveLength(2);
  });
  it("Warehouse expansion references the expected required signals", async () => {
    await seedMappings(db);
    const [row] = await db.select({ req: mappings.requiredSignals }).from(mappings).where(eq(mappings.name, "Warehouse expansion"));
    expect(row.req).toContain("SIG-EXP-NEW-FACILITY");
    expect(row.req).toContain("SIG-TENDER-LIVE");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/integration/seed-mappings.test.ts`
Expected: FAIL — cannot resolve `@/db/seed-mappings`.

- [ ] **Step 3: Write `src/db/seed-mappings.ts`**

```ts
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { mappings } from "./schema";
import type { DB } from "./client";

type NewMapping = typeof mappings.$inferInsert;

const DISTRESS = ["Announced layoffs or facility shutdown (distress)", "Existing client", "Recently pitched"];

const SEED_MAPPINGS: NewMapping[] = [
  {
    mappingId: "10000000-0000-4000-8000-000000000001",
    name: "Warehouse expansion",
    intentDescription: "Company is expanding physical warehouse or fulfilment capacity.",
    servesVendorType: "Infra",
    requiredSignals: ["SIG-EXP-NEW-FACILITY", "SIG-EXP-NEW-GST", "SIG-EXP-LARGE-LEASE", "SIG-TENDER-LIVE"],
    supportingSignals: ["SIG-HIRING-OPS-SURGE", "SIG-HIRING-NEW-CITY", "SIG-MONEY-FUNDING", "SIG-LEAD-NEW-OPS"],
    thresholdRule: "At least one required signal. Supporting signals are optional and act as the score multiplier.",
    timingWindowDays: 180,
    strengthLogic: "One required signal = moderate lead. Each fresh supporting signal lifts it. Required + two or more fresh supporting signals inside 90 days = top-tier lead.",
    disqualifiers: DISTRESS,
    status: "approved",
    origin: "seed",
  },
  {
    mappingId: "10000000-0000-4000-8000-000000000002",
    name: "Offline marketing push",
    intentDescription: "Company is about to run a physical, on-the-ground marketing push (posters, outdoor, store-launch promotion).",
    servesVendorType: "Mktg",
    requiredSignals: ["SIG-EXP-NEW-STORE", "SIG-HIRING-NEW-CITY", "SIG-TENDER-LIVE", "SIG-DIG-NEW-LAUNCH"],
    supportingSignals: ["SIG-HIRING-FIELD-MKTG", "SIG-LEAD-NEW-MKTG", "SIG-DIG-CAMPAIGN-PUSH", "SIG-MONEY-FUNDING"],
    thresholdRule: "At least one required signal.",
    timingWindowDays: 180,
    strengthLogic: "One required signal = moderate lead. Each fresh supporting signal lifts it. Required + two or more fresh supporting signals inside 90 days = top-tier lead.",
    disqualifiers: DISTRESS,
    status: "approved",
    origin: "seed",
  },
];

/**
 * Inserts the 2 canonical seed mappings as status:'approved'.
 * Uses onConflictDoNothing on the fixed mapping_id PK so it is idempotent.
 * Run AFTER db:seed:signals so the referenced signals exist and are approved.
 * The caller owns the connection lifecycle — this function does NOT open or close one.
 */
export async function seedMappings(db: DB): Promise<{ inserted: number; total: number }> {
  const inserted = await db.insert(mappings).values(SEED_MAPPINGS).onConflictDoNothing().returning();
  return { inserted: inserted.length, total: SEED_MAPPINGS.length };
}

// Allow `npm run db:seed:mappings` to execute directly.
if (process.argv[1] && process.argv[1].endsWith("seed-mappings.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:seed:mappings");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  seedMappings(db)
    .then(({ inserted, total }) => {
      console.log("Seeded mappings:", inserted, "/", total);
      return client.end();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Add the npm script** — edit `package.json`, add after the `db:seed:signals` line:

```json
    "db:seed:mappings": "tsx src/db/seed-mappings.ts",
```
(Ensure the preceding `db:seed:signals` line ends with a comma.)

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run tests/integration/seed-mappings.test.ts`
Expected: PASS (3 cases green).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` (clean), then:
```bash
git add src/db/seed-mappings.ts package.json tests/integration/seed-mappings.test.ts
git commit -m "feat(mappings): idempotent seeder for the 2 canonical Phase0 mappings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `/mappings` list page + `mapping-list` + list CSS

**Files:**
- Modify (replace stub): `src/app/(app)/mappings/page.tsx`
- Create: `src/app/(app)/mappings/mapping-list.tsx`
- Modify: `src/app/styles/command.css` (append list CSS block)
- Test: `tests/unit/components/mappings-list.test.tsx`

**Interfaces:**
- Consumes: `listMappings` from `@/lib/mappings/data`; `listSignals` from `@/lib/signals/data`; `LIFECYCLE_STATUSES`, `MappingDefinition`, `LifecycleStatus` from `@/lib/mappings/schema`; `PageHeader`, `EmptyState`. `<AddMappingForm>` is built in Task 6 — until then the page imports it and passes `approvedSignals`.
- Produces: `MappingList` component (default list view); `/mappings` server page.

- [ ] **Step 1: Write the failing test** — `tests/unit/components/mappings-list.test.tsx`

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MappingList } from "@/app/(app)/mappings/mapping-list";
import type { MappingDefinition } from "@/lib/mappings/schema";

const BASE: Omit<MappingDefinition, "mappingId" | "name" | "status"> = {
  intentDescription: null,
  servesVendorType: "Infra",
  requiredSignals: ["SIG-EXP-NEW-FACILITY"],
  supportingSignals: [],
  thresholdRule: null,
  timingWindowDays: null,
  strengthLogic: null,
  disqualifiers: null,
  origin: null,
};

const fixtures: MappingDefinition[] = [
  { ...BASE, mappingId: "10000000-0000-4000-8000-000000000001", name: "Warehouse expansion", status: "proposed" },
  { ...BASE, mappingId: "10000000-0000-4000-8000-000000000002", name: "Offline marketing push", status: "approved" },
];

describe("MappingList", () => {
  it("renders proposed mapping before approved", () => {
    render(<MappingList mappings={fixtures} />);
    const links = screen.getAllByRole("link");
    const texts = links.map((l) => l.textContent ?? "");
    const proposedIdx = texts.findIndex((t) => t.includes("Warehouse expansion"));
    const approvedIdx = texts.findIndex((t) => t.includes("Offline marketing push"));
    expect(proposedIdx).toBeGreaterThanOrEqual(0);
    expect(approvedIdx).toBeGreaterThanOrEqual(0);
    expect(proposedIdx).toBeLessThan(approvedIdx);
  });
  it("links each mapping to its detail route", () => {
    render(<MappingList mappings={fixtures} />);
    const link = screen.getByRole("link", { name: /warehouse expansion/i });
    expect(link).toHaveAttribute("href", "/mappings/10000000-0000-4000-8000-000000000001");
  });
  it("renders a status badge with text 'proposed'", () => {
    render(<MappingList mappings={fixtures} />);
    const badges = document.querySelectorAll(".badge-proposed");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0].textContent).toBe("proposed");
  });
  it("renders empty message when array is empty", () => {
    render(<MappingList mappings={[]} />);
    expect(screen.getByText("No mappings match this filter.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/mappings-list.test.tsx`
Expected: FAIL — cannot resolve `mapping-list`.

- [ ] **Step 3: Write `src/app/(app)/mappings/mapping-list.tsx`**

```tsx
import Link from "next/link";
import type { MappingDefinition, LifecycleStatus } from "@/lib/mappings/schema";
import { LIFECYCLE_STATUSES } from "@/lib/mappings/schema";

interface MappingListProps {
  mappings: MappingDefinition[];
}

export function MappingList({ mappings }: MappingListProps) {
  if (mappings.length === 0) {
    return <p className="mapping-empty">No mappings match this filter.</p>;
  }

  const groups: { status: LifecycleStatus; items: MappingDefinition[] }[] = LIFECYCLE_STATUSES.map(
    (status) => ({ status, items: mappings.filter((m) => m.status === status) }),
  ).filter((g) => g.items.length > 0);

  return (
    <div className="mapping-groups">
      {groups.map(({ status, items }) => (
        <section key={status}>
          <h2 className="signal-group-head">{status}</h2>
          <ul className="mapping-list">
            {items.map((m) => (
              <li key={m.mappingId}>
                <Link href={`/mappings/${m.mappingId}`}>{m.name}</Link>
                <p className="mapping-meta">
                  {m.servesVendorType ? `${m.servesVendorType} · ` : ""}
                  {m.requiredSignals?.length ?? 0} required · {m.supportingSignals?.length ?? 0} supporting
                </p>
                <span className={`badge badge-${m.status}`}>{m.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Replace `src/app/(app)/mappings/page.tsx`** (whole file)

```tsx
import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { listMappings } from "@/lib/mappings/data";
import { listSignals } from "@/lib/signals/data";
import { LIFECYCLE_STATUSES } from "@/lib/mappings/schema";
import type { LifecycleStatus } from "@/lib/mappings/schema";
import { MappingList } from "./mapping-list";
import { AddMappingForm } from "./add-mapping-form";

export const metadata = { title: "Mappings — Radar" };

function hrefWith(status?: LifecycleStatus): string {
  return status ? `/mappings?status=${status}` : "/mappings";
}

export default async function MappingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  // Next.js 15: searchParams is a Promise — must await before reading.
  const sp = await searchParams;
  const status = LIFECYCLE_STATUSES.includes(sp.status as LifecycleStatus)
    ? (sp.status as LifecycleStatus)
    : undefined;

  const mappings = await listMappings({ status });
  const approvedSignals = (await listSignals({ status: "approved" })).map((s) => ({
    signalId: s.signalId,
    name: s.name,
  }));

  return (
    <>
      <PageHeader eyebrow="Build" title="Mappings" />
      <AddMappingForm approvedSignals={approvedSignals} />

      <nav aria-label="Filter mappings" className="filter-bar">
        <div className="filter-row">
          <Link
            href={hrefWith(undefined)}
            className={!status ? "is-active" : ""}
            aria-current={!status ? "true" : undefined}
          >
            All statuses
          </Link>
          {LIFECYCLE_STATUSES.map((s) => (
            <Link
              key={s}
              href={hrefWith(s)}
              className={status === s ? "is-active" : ""}
              aria-current={status === s ? "true" : undefined}
            >
              {s}
            </Link>
          ))}
        </div>
      </nav>

      {mappings.length === 0 && !status ? (
        <EmptyState
          icon="mappings"
          title="No mappings yet"
          description="Seed the library with `npm run db:seed:mappings`, or propose a mapping — each enters as proposed for your approval."
        />
      ) : (
        <MappingList mappings={mappings} />
      )}
    </>
  );
}
```

> NOTE: `page.tsx` imports `./add-mapping-form` (Task 6). The list-component test (Step 1) does not import the page, so it passes now. `npx tsc --noEmit` will report the missing `add-mapping-form` module **until Task 6** — that is expected; run the typecheck gate at Task 6, not here. Do not stub the form.

- [ ] **Step 5: Append list CSS to `src/app/styles/command.css`**

```css
/* --- Phase 3 Slice 3.2 (mappings): list --- */
.mapping-groups { display: grid; gap: var(--space-6); }
.mapping-list { display: grid; gap: var(--space-2); list-style: none; padding: 0; margin: 0; }
.mapping-list li {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md);
}
.mapping-list li a { color: var(--text); text-decoration: none; font-weight: var(--weight-semibold); }
.mapping-list li a:hover { text-decoration: underline; }
.mapping-meta { margin: 0; font-size: var(--text-xs); color: var(--text-faint); flex: 1; min-width: 0; }
.mapping-empty { color: var(--text-muted); font-size: var(--text-sm); padding: var(--space-5) 0; }
```

- [ ] **Step 6: Run the list test to confirm it passes**

Run: `npx vitest run tests/unit/components/mappings-list.test.tsx`
Expected: PASS (4 cases green).

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/mappings/page.tsx src/app/\(app\)/mappings/mapping-list.tsx src/app/styles/command.css tests/unit/components/mappings-list.test.tsx
git commit -m "feat(mappings): /mappings list page + grouped mapping list + list CSS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: actions + detail page + status-controls + readiness-panel

**Files:**
- Create: `src/app/(app)/mappings/actions.ts`
- Create: `src/app/(app)/mappings/[mappingId]/page.tsx`
- Create: `src/app/(app)/mappings/status-controls.tsx`
- Create: `src/app/(app)/mappings/readiness-panel.tsx`
- Modify: `src/app/styles/command.css` (append detail + readiness CSS)
- Test: `tests/unit/components/mappings-status-controls.test.tsx`

**Interfaces:**
- Consumes: `createMappingSchema` from `@/lib/mappings/schema`; `createMapping`, `setMappingStatus`, `getMapping`, `resolveSignalRefs` from `@/lib/mappings/data`; `auth` from `@/lib/auth`; `SignalRef`, `LifecycleStatus` from `@/lib/mappings/schema`.
- Produces:
  - `type MappingFormState = { ok: boolean; error?: string }`
  - `createMappingAction(prev: MappingFormState, formData: FormData): Promise<MappingFormState>`
  - `approveMappingAction(mappingId: string): Promise<{ ok: boolean; error?: string }>`
  - `retireMappingAction(mappingId: string): Promise<{ ok: boolean; error?: string }>`
  - `StatusControls`, `ReadinessPanel` components; `/mappings/[mappingId]` page.

- [ ] **Step 1: Write the failing test** — `tests/unit/components/mappings-status-controls.test.tsx`

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/mappings/actions", () => ({
  approveMappingAction: vi.fn(() => Promise.resolve({ ok: true })),
  retireMappingAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { StatusControls } from "@/app/(app)/mappings/status-controls";
import { approveMappingAction, retireMappingAction } from "@/app/(app)/mappings/actions";

const ID = "10000000-0000-4000-8000-000000000001";

describe("StatusControls (mappings)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders Approve and Retire for proposed", () => {
    render(<StatusControls mappingId={ID} status="proposed" />);
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retire/i })).toBeInTheDocument();
  });
  it("renders only Retire for approved", () => {
    render(<StatusControls mappingId={ID} status="approved" />);
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retire/i })).toBeInTheDocument();
  });
  it("renders Un-retire for retired", () => {
    render(<StatusControls mappingId={ID} status="retired" />);
    expect(screen.getByRole("button", { name: /un-retire/i })).toBeInTheDocument();
  });
  it("clicking Approve calls approveMappingAction with the mappingId", async () => {
    render(<StatusControls mappingId={ID} status="proposed" />);
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(approveMappingAction).toHaveBeenCalledWith(ID);
  });
  it("clicking Retire calls retireMappingAction with the mappingId", async () => {
    render(<StatusControls mappingId={ID} status="proposed" />);
    await userEvent.click(screen.getByRole("button", { name: /retire/i }));
    expect(retireMappingAction).toHaveBeenCalledWith(ID);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/mappings-status-controls.test.tsx`
Expected: FAIL — cannot resolve `status-controls`/`actions`.

- [ ] **Step 3: Write `src/app/(app)/mappings/actions.ts`**

```ts
"use server";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { createMappingSchema } from "@/lib/mappings/schema";
import { createMapping, setMappingStatus } from "@/lib/mappings/data";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export type MappingFormState = { ok: boolean; error?: string };

export async function createMappingAction(
  _prev: MappingFormState,
  formData: FormData,
): Promise<MappingFormState> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };

  const raw = {
    name: formData.get("name"),
    requiredSignals: formData.getAll("requiredSignals"),
    supportingSignals: formData.getAll("supportingSignals"),
    intentDescription: formData.get("intentDescription") || undefined,
    servesVendorType: formData.get("servesVendorType") || undefined,
    thresholdRule: formData.get("thresholdRule") || undefined,
    timingWindowDays: formData.get("timingWindowDays") || undefined,
    strengthLogic: formData.get("strengthLogic") || undefined,
    disqualifiers: formData.get("disqualifiers") || undefined,
  };

  const parsed = createMappingSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid mapping." };
  }

  const r = await createMapping(parsed.data);
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath("/mappings");
  return { ok: true };
}

export async function approveMappingAction(mappingId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const r = await setMappingStatus(mappingId, "approved");
  if (r.ok) {
    revalidatePath("/mappings");
    revalidatePath(`/mappings/${mappingId}`);
  }
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function retireMappingAction(mappingId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  const r = await setMappingStatus(mappingId, "retired");
  if (r.ok) {
    revalidatePath("/mappings");
    revalidatePath(`/mappings/${mappingId}`);
  }
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
```

- [ ] **Step 4: Write `src/app/(app)/mappings/status-controls.tsx`**

```tsx
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
```

- [ ] **Step 5: Write `src/app/(app)/mappings/readiness-panel.tsx`**

```tsx
import type { SignalRef } from "@/lib/mappings/schema";

function ReadinessItem({ r }: { r: SignalRef }) {
  const label = r.status ?? "missing";
  return (
    <li>
      <span>{r.name ?? r.signalId}</span>
      <span className={`badge badge-${label}`}>{label}</span>
      <span className="readiness-id">{r.signalId}</span>
    </li>
  );
}

export function ReadinessPanel({
  requiredRefs,
  supportingRefs,
}: {
  requiredRefs: SignalRef[];
  supportingRefs: SignalRef[];
}) {
  const allRequiredApproved =
    requiredRefs.length > 0 && requiredRefs.every((r) => r.status === "approved");

  return (
    <section className="readiness-panel" aria-label="Signal readiness">
      <h2>Signal readiness</h2>
      <p className={allRequiredApproved ? "readiness-ok" : "readiness-warn"}>
        {allRequiredApproved
          ? "All required signals are approved — this mapping can be approved."
          : "Some required signals are not approved — approval is blocked until they are."}
      </p>
      <h3>Required</h3>
      <ul className="readiness-list">
        {requiredRefs.map((r) => (
          <ReadinessItem key={r.signalId} r={r} />
        ))}
      </ul>
      {supportingRefs.length > 0 && (
        <>
          <h3>Supporting</h3>
          <ul className="readiness-list">
            {supportingRefs.map((r) => (
              <ReadinessItem key={r.signalId} r={r} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Write `src/app/(app)/mappings/[mappingId]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getMapping, resolveSignalRefs } from "@/lib/mappings/data";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusControls } from "../status-controls";
import { ReadinessPanel } from "../readiness-panel";

export const metadata = { title: "Mapping — Radar" };

export default async function MappingDetailPage({
  params,
}: {
  params: Promise<{ mappingId: string }>;
}) {
  const { mappingId } = await params;
  const mapping = await getMapping(mappingId);
  if (!mapping) notFound();

  const requiredRefs = await resolveSignalRefs(mapping.requiredSignals ?? []);
  const supportingRefs = await resolveSignalRefs(mapping.supportingSignals ?? []);

  const fmt = (v: string | number | null | undefined) =>
    v !== null && v !== undefined && v !== "" ? String(v) : "—";

  return (
    <div className="v2-content">
      <Link href="/mappings" className="back-link">
        ← All mappings
      </Link>
      <PageHeader eyebrow="Build" title={mapping.name} />
      <span className={`badge badge-${mapping.status}`}>{mapping.status}</span>
      <StatusControls mappingId={mapping.mappingId} status={mapping.status} />
      <ReadinessPanel requiredRefs={requiredRefs} supportingRefs={supportingRefs} />
      <dl className="mapping-detail">
        <dt>Intent</dt>
        <dd>{fmt(mapping.intentDescription)}</dd>

        <dt>Serves Vendor Type</dt>
        <dd>{fmt(mapping.servesVendorType)}</dd>

        <dt>Threshold Rule</dt>
        <dd>{fmt(mapping.thresholdRule)}</dd>

        <dt>Timing Window (days)</dt>
        <dd>{fmt(mapping.timingWindowDays)}</dd>

        <dt>Strength Logic</dt>
        <dd>{fmt(mapping.strengthLogic)}</dd>

        <dt>Disqualifiers</dt>
        <dd>{mapping.disqualifiers && mapping.disqualifiers.length > 0 ? mapping.disqualifiers.join("; ") : "—"}</dd>

        <dt>Origin</dt>
        <dd>{fmt(mapping.origin)}</dd>
      </dl>
    </div>
  );
}
```

- [ ] **Step 7: Append detail + readiness CSS to `src/app/styles/command.css`**

```css
/* --- Phase 3 Slice 3.2 (mappings): detail + readiness panel --- */
.mapping-detail { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-4); margin: var(--space-5) 0; }
.mapping-detail dt { font-weight: var(--weight-semibold); color: var(--text-muted); }
.mapping-detail dd { margin: 0; }
.readiness-panel { border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-4); margin: var(--space-4) 0; }
.readiness-panel h2 { margin: 0 0 var(--space-2); font-size: var(--text-base); }
.readiness-panel h3 { margin: var(--space-3) 0 var(--space-1); font-size: var(--text-sm); color: var(--text-muted); }
.readiness-list { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-1); }
.readiness-list li { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
.readiness-id { font-size: var(--text-2xs); color: var(--text-faint); }
.readiness-ok { color: var(--success, #2f855a); font-size: var(--text-sm); }
.readiness-warn { color: var(--warning); font-size: var(--text-sm); }
.badge-missing { background: var(--surface-2, #ececec); color: var(--text-muted); }
```

- [ ] **Step 8: Run the status-controls test + typecheck**

Run: `npx vitest run tests/unit/components/mappings-status-controls.test.tsx` — expect PASS (5 cases).
Run: `grep -n "@/db" src/app/\(app\)/mappings/status-controls.tsx src/app/\(app\)/mappings/readiness-panel.tsx` — expect NO output (client-bundle purity).
(`tsc --noEmit` still flags the missing `add-mapping-form` until Task 6 — deferred to Task 6's gate.)

- [ ] **Step 9: Commit**

```bash
git add src/app/\(app\)/mappings/actions.ts src/app/\(app\)/mappings/status-controls.tsx src/app/\(app\)/mappings/readiness-panel.tsx "src/app/(app)/mappings/[mappingId]/page.tsx" src/app/styles/command.css tests/unit/components/mappings-status-controls.test.tsx
git commit -m "feat(mappings): actions + detail page + status controls + readiness panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `add-mapping-form` + form CSS + FULL INTEGRATION GATE

**Files:**
- Create: `src/app/(app)/mappings/add-mapping-form.tsx`
- Modify: `src/app/styles/command.css` (append form CSS)
- Test: `tests/unit/components/mappings-add-form.test.tsx`

**Interfaces:**
- Consumes: `createMappingAction`, `MappingFormState` from `./actions`.
- Produces: `AddMappingForm` (default export-style named export) — props `{ approvedSignals: { signalId: string; name: string }[] }`. Completes the `page.tsx` import from Task 4.

- [ ] **Step 1: Write the failing test** — `tests/unit/components/mappings-add-form.test.tsx`

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

vi.mock("@/app/(app)/mappings/actions", () => ({
  createMappingAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { AddMappingForm } from "@/app/(app)/mappings/add-mapping-form";
import { createMappingAction } from "@/app/(app)/mappings/actions";

const SIGNALS = [
  { signalId: "SIG-EXP-NEW-FACILITY", name: "New facility announced" },
  { signalId: "SIG-TENDER-LIVE", name: "Live relevant tender" },
];

beforeEach(() => {
  (createMappingAction as Mock).mockReset();
  (createMappingAction as Mock).mockResolvedValue({ ok: true });
});

async function openDisclosure(user: ReturnType<typeof userEvent.setup>) {
  const summary = screen.queryByText(/propose a mapping/i);
  if (summary && summary.tagName === "SUMMARY") await user.click(summary);
}

describe("AddMappingForm", () => {
  it("renders name field, signal checklists, and submit button", async () => {
    const user = userEvent.setup();
    render(<AddMappingForm approvedSignals={SIGNALS} />);
    await openDisclosure(user);

    expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
    // Two fieldsets (required + supporting) → each approved signal appears twice as a checkbox.
    expect(screen.getAllByRole("checkbox").length).toBe(SIGNALS.length * 2);
    expect(screen.getByRole("button", { name: /propose mapping/i })).toBeInTheDocument();
  });

  it("submits name + selected required signal in FormData", async () => {
    const user = userEvent.setup();
    render(<AddMappingForm approvedSignals={SIGNALS} />);
    await openDisclosure(user);

    await user.type(screen.getByLabelText(/^name/i), "Warehouse expansion");
    // First required-signals checkbox (required fieldset renders first).
    const requiredBoxes = screen.getAllByRole("checkbox");
    await user.click(requiredBoxes[0]);

    await user.click(screen.getByRole("button", { name: /propose mapping/i }));
    await waitFor(() => expect(createMappingAction).toHaveBeenCalled());

    const fd = (vi.mocked(createMappingAction).mock.calls[0] as [unknown, FormData])[1];
    expect(fd.get("name")).toBe("Warehouse expansion");
    expect(fd.getAll("requiredSignals")).toContain("SIG-EXP-NEW-FACILITY");
  });

  it("renders error inline when the action returns an error", async () => {
    (vi.mocked(createMappingAction) as Mock).mockResolvedValueOnce({
      ok: false,
      error: "Select at least one required signal.",
    });
    const user = userEvent.setup();
    render(<AddMappingForm approvedSignals={SIGNALS} />);
    await openDisclosure(user);

    await user.type(screen.getByLabelText(/^name/i), "Bad mapping");
    await user.click(screen.getByRole("button", { name: /propose mapping/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/at least one required signal/i));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/components/mappings-add-form.test.tsx`
Expected: FAIL — cannot resolve `add-mapping-form`.

- [ ] **Step 3: Write `src/app/(app)/mappings/add-mapping-form.tsx`**

```tsx
"use client";

import { useActionState, useEffect, useRef } from "react";
import { createMappingAction } from "./actions";
import type { MappingFormState } from "./actions";

export function AddMappingForm({
  approvedSignals,
}: {
  approvedSignals: { signalId: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(createMappingAction, { ok: false } as MappingFormState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!isPending && state.ok) formRef.current?.reset();
  }, [isPending, state.ok]);

  return (
    <details className="add-mapping-disclosure">
      <summary>Propose a mapping</summary>
      <section aria-label="Propose a mapping form">
        <form ref={formRef} action={formAction} className="add-mapping-form">
          <label htmlFor="mappingName">
            Name
            <input id="mappingName" type="text" name="name" required maxLength={200} autoComplete="off" />
          </label>

          <label htmlFor="servesVendorType">
            Serves vendor type
            <input id="servesVendorType" type="text" name="servesVendorType" maxLength={200} autoComplete="off" />
          </label>

          <label htmlFor="intentDescription">
            Intent
            <textarea id="intentDescription" name="intentDescription" rows={2} maxLength={4000} />
          </label>

          <fieldset className="signal-picker">
            <legend>Required signals (pick at least one)</legend>
            {approvedSignals.length === 0 ? (
              <p className="field-hint">No approved signals yet — seed or approve signals first.</p>
            ) : (
              approvedSignals.map((s) => (
                <label key={s.signalId} className="checkbox-row">
                  <input type="checkbox" name="requiredSignals" value={s.signalId} />
                  {s.name} <span className="readiness-id">{s.signalId}</span>
                </label>
              ))
            )}
          </fieldset>

          <fieldset className="signal-picker">
            <legend>Supporting signals</legend>
            {approvedSignals.length === 0 ? (
              <p className="field-hint">No approved signals yet.</p>
            ) : (
              approvedSignals.map((s) => (
                <label key={s.signalId} className="checkbox-row">
                  <input type="checkbox" name="supportingSignals" value={s.signalId} />
                  {s.name} <span className="readiness-id">{s.signalId}</span>
                </label>
              ))
            )}
          </fieldset>

          <label htmlFor="thresholdRule">
            Threshold rule
            <input id="thresholdRule" type="text" name="thresholdRule" maxLength={2000} autoComplete="off" />
          </label>

          <label htmlFor="timingWindowDays">
            Timing window (days)
            <input id="timingWindowDays" type="number" name="timingWindowDays" min={0} max={3650} />
          </label>

          <label htmlFor="strengthLogic">
            Strength logic
            <textarea id="strengthLogic" name="strengthLogic" rows={2} maxLength={2000} />
          </label>

          <label htmlFor="disqualifiers">
            Disqualifiers
            <textarea id="disqualifiers" name="disqualifiers" rows={2} placeholder="comma or newline separated" />
          </label>

          <div className="add-mapping-actions">
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? "Proposing…" : "Propose mapping"}
            </button>
            {state.error && <p role="alert">{state.error}</p>}
          </div>
        </form>
      </section>
    </details>
  );
}
```

- [ ] **Step 4: Append form CSS to `src/app/styles/command.css`**

```css
/* --- Phase 3 Slice 3.2 (mappings): propose form --- */
.add-mapping-disclosure { border: 1px solid var(--border); border-radius: var(--radius-md); margin-bottom: var(--space-5); }
.add-mapping-disclosure > summary { padding: var(--space-3) var(--space-4); cursor: pointer; font-weight: var(--weight-semibold); list-style: none; }
.add-mapping-disclosure > summary::-webkit-details-marker { display: none; }
.add-mapping-disclosure > summary::before { content: "▸ "; color: var(--text-faint); }
.add-mapping-disclosure[open] > summary::before { content: "▾ "; }
.add-mapping-disclosure > section { padding: 0 var(--space-4) var(--space-4); }
.add-mapping-form { display: grid; gap: var(--space-3); }
.add-mapping-form label { display: grid; gap: var(--space-1); font-size: var(--text-sm); }
.add-mapping-form input, .add-mapping-form textarea {
  padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--text); font: inherit;
}
.add-mapping-form textarea { resize: vertical; min-height: 60px; }
.add-mapping-form .field-hint { font-size: var(--text-2xs); color: var(--text-faint); }
.add-mapping-form .signal-picker { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-2); display: grid; gap: var(--space-1); max-height: 220px; overflow: auto; }
.add-mapping-form .signal-picker legend { font-size: var(--text-sm); font-weight: var(--weight-semibold); padding: 0 var(--space-1); }
.add-mapping-form .checkbox-row { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
.add-mapping-form .checkbox-row input { width: auto; }
.add-mapping-form .add-mapping-actions { display: flex; align-items: center; gap: var(--space-3); }
.add-mapping-form [role="alert"] { margin: 0; color: var(--warning); font-size: var(--text-sm); }
```

- [ ] **Step 5: Run the form test to confirm it passes**

Run: `npx vitest run tests/unit/components/mappings-add-form.test.tsx`
Expected: PASS (3 cases green).

- [ ] **Step 6: FULL INTEGRATION GATE**

Run each and confirm:
- `npx tsc --noEmit` — clean (the `page.tsx` → `add-mapping-form` import now resolves).
- `npm run lint` — clean.
- `grep -rn "@/db" src/app/\(app\)/mappings/add-mapping-form.tsx src/app/\(app\)/mappings/status-controls.tsx src/app/\(app\)/mappings/readiness-panel.tsx` — NO output (client-bundle purity; `readiness-panel` is a server component but must still not pull `@/db`).
- `npm run build` — succeeds; `/mappings` and `/mappings/[mappingId]` appear in the route list.
- `npm test` — full suite green (unit + integration, real Neon). Re-run 2–3× if a transient Neon TRUNCATE/latency failure appears (known infra flakiness; investigate only a deterministically-repeating failure).

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/mappings/add-mapping-form.tsx src/app/styles/command.css tests/unit/components/mappings-add-form.test.tsx
git commit -m "feat(mappings): propose form with approved-signal checklists + form CSS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (checked against the spec)

- **Spec coverage:** D1 seed → Task 3; D2 schema/data split → Tasks 1–2; D3 uuid PK + detail route → Tasks 2 (`getMapping` uuid guard) & 5; D4 create form → Task 6; D5 approval + validation gate → Task 2 (`setMappingStatus`) + Task 5 (actions); D6 readiness panel → Task 5; D7 status-only filter list → Task 4; D8 create-time existence check → Task 2 (`createMapping`). Testing §8 covered by the per-task tests + Task 6 full gate. Acceptance §9 covered by Task 6 gate + seeder test.
- **Placeholder scan:** none — every step has complete code/commands.
- **Type consistency:** `MappingDefinition`, `SignalRef`, `CreateMappingInput`, `MappingFormState`, `LifecycleStatus` used identically across tasks; `createMapping`/`setMappingStatus` return the same `{ ok:true; mapping } | { ok:false; error }` shape consumed by the actions; `StatusControls` prop is `mappingId` (uuid) throughout; `AddMappingForm` prop `approvedSignals` matches the `page.tsx` call site.
- **Cross-task ordering note:** Task 4 introduces a `page.tsx` import of `add-mapping-form` that only lands in Task 6 — flagged inline; `tsc`/`build`/full-`npm test` gates run at Task 6. Per-task component tests do not import the page, so each task's own test is green when written.
