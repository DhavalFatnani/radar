# Phase 2 · Slice 2.4 — Catalogue Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project vendor profiles into the `catalogue_nodes`/`catalogue_edges` graph (kept in sync on every profile save), add a `matchVendors` query, and ship a live `/catalogue` route with an interactive SVG network graph.

**Architecture:** A pure schema module (`src/lib/catalogue/schema.ts`) holds DB-free types + edge-type constants. A data module (`src/lib/catalogue/data.ts`) reads/writes the graph and answers match queries; `updateVendorProfile` calls its idempotent projector after each write. The `/catalogue` route is a server page that fetches the persisted graph and hands it to a `"use client"` view, which computes lane positions with a pure `layout.ts` and draws via a framework-agnostic imperative `graph-engine.ts` (ported from `mockups/v2/assets/graph.js`). No new migration — the tables already exist.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, PostgreSQL 16 (Neon/Drizzle, postgres-js, `prepare:false`), NextAuth v5, Vitest (`npm test` = `vitest run`), React Testing Library + jsdom.

**Spec:** `docs/superpowers/specs/2026-07-01-phase2-slice24-catalogue-graph-design.md`
**Branch:** `feature/phase2-slice2-4-catalogue` (base = `main` @ `53c9583`)

## Global Constraints

- **No new migration** — `catalogue_nodes`, `catalogue_edges`, and the `catalogue_node_type` enum already exist. Do not run `db:generate`.
- **Client-bundle rule:** `catalogue-view.tsx` (`"use client"`) may import only React, `next/link`, `import type` from `@/lib/catalogue/schema`, the pure `./layout` + `./graph-engine` modules, and the `./actions` server-action reference. It MUST NOT import `@/db/*` or `@/lib/catalogue/data`.
- **`@/lib/catalogue/schema.ts` stays DB-free** (types + string constants only) — it is reachable from the client bundle, like `@/lib/vendors/schema.ts`.
- **No import cycle:** `catalogue/data.ts` imports `@/db/*`, `./schema`, and `type { VendorConstraints }` from `@/lib/vendors/schema` — never `@/lib/vendors/data`. The one-directional dependency is `vendors/data.ts` → `catalogue/data.ts`.
- **Edge-type strings (verbatim):** `vendor_capability`, `vendor_geography`. Node types written: `vendor`, `capability`, `geography` (NOT `sub_capability` / `project_size_range` — deferred).
- **Vendor node identity** = `metadata.vendorId`. Shared `capability`/`geography` nodes dedupe by `(type, label)`.
- Explicit columns + bounded reads (`.limit(...)`); no `SELECT *`. Parameterized queries only (Drizzle binds values).
- No `console.log` / TODO / silent empty `catch` in committed code. Handle errors explicitly.
- Mobile-first: the `@media (max-width: 980px)` single-column collapse is required in the CSS.
- Semantic HTML; graph nodes keyboard-navigable (`tabindex="0"` + Enter — already in the ported engine); every control labelled.
- Tests: Vitest. Integration tests use `tests/integration/helpers/db.ts` (`testDb`, `migrateTestDb`, `truncateAll`, `closeTestDb`) and also `await queryClient.end()` in `afterAll` when they touch app data functions. jsdom component tests start with `// @vitest-environment jsdom`.
- Commit only explicit file paths (NEVER `git add .`/`git add -A` — leaves `.DS_Store`, `AGENTS.md` hook churn, `.superpowers/` scratch unstaged). Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Catalogue schema (pure types + edge-type constants)

**Files:**
- Create: `src/lib/catalogue/schema.ts`
- Test: `tests/unit/lib/catalogue-schema.test.ts`

**Interfaces:**
- Produces (consumed by every later task): the types `CatalogueNodeType`, `CatalogueNode`, `CatalogueEdge`, `CatalogueGraph`, `MatchQuery`, `MatchedVendor`, `VendorNodeMetadata`, `RenderNode`, `RenderEdge`, `RenderModel`, and the constants `EDGE_VENDOR_CAPABILITY = "vendor_capability"`, `EDGE_VENDOR_GEOGRAPHY = "vendor_geography"`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/catalogue-schema.test.ts
import { describe, it, expect } from "vitest";
import {
  EDGE_VENDOR_CAPABILITY,
  EDGE_VENDOR_GEOGRAPHY,
  type CatalogueGraph,
  type RenderModel,
} from "@/lib/catalogue/schema";

describe("catalogue schema", () => {
  it("pins the edge-type constants shared by the data layer and the UI", () => {
    expect(EDGE_VENDOR_CAPABILITY).toBe("vendor_capability");
    expect(EDGE_VENDOR_GEOGRAPHY).toBe("vendor_geography");
  });

  it("describes a persisted graph as nodes + edges", () => {
    const g: CatalogueGraph = { nodes: [], edges: [] };
    expect(g).toEqual({ nodes: [], edges: [] });
  });

  it("describes a render model as positioned nodes + edges + canvas size", () => {
    const m: RenderModel = { nodes: [], edges: [], w: 1080, h: 640 };
    expect(m.w).toBe(1080);
    expect(m.h).toBe(640);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/catalogue-schema.test.ts`
Expected: FAIL — `Cannot find module '@/lib/catalogue/schema'`.

- [ ] **Step 3: Write the schema module**

```ts
// src/lib/catalogue/schema.ts
// Catalogue graph — pure, DB-free types + constants shared by the data layer,
// the pure layout code, and the "use client" graph view. No @/db imports here:
// this module is reachable from the client bundle (like vendors/schema.ts).

export type CatalogueNodeType =
  | "vendor"
  | "capability"
  | "sub_capability"
  | "geography"
  | "project_size_range";

// Edge-type strings this slice writes and reads. Keep in sync with the DB rows.
export const EDGE_VENDOR_CAPABILITY = "vendor_capability";
export const EDGE_VENDOR_GEOGRAPHY = "vendor_geography";

// Metadata stored on a vendor node — the projection's identity key.
export type VendorNodeMetadata = { vendorId: string; size?: string };

// A persisted node/edge as read from the DB.
export type CatalogueNode = {
  nodeId: string;
  type: CatalogueNodeType;
  label: string;
  metadata: Record<string, unknown> | null;
};

export type CatalogueEdge = {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
};

export type CatalogueGraph = { nodes: CatalogueNode[]; edges: CatalogueEdge[] };

// Matchmaking (spec §4.6).
export type MatchQuery = { capability?: string; geography?: string };
export type MatchedVendor = { vendorId: string; name: string };

// Render model — positioned geometry the SVG engine draws. Pure numbers.
export type RenderNode = {
  id: string;
  type: CatalogueNodeType;
  label: string;
  sub?: string;
  x: number;
  y: number;
  w?: number;
  pulse?: boolean;
};
export type RenderEdge = { from: string; to: string; kind?: string };
export type RenderModel = { nodes: RenderNode[]; edges: RenderEdge[]; w: number; h: number };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/catalogue-schema.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/lib/catalogue/schema.ts tests/unit/lib/catalogue-schema.test.ts
git commit -m "feat(catalogue): pure schema — graph + render-model types and edge constants

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Catalogue data layer (project, read, match, rebuild)

**Files:**
- Create: `src/lib/catalogue/data.ts`
- Test: `tests/integration/catalogue-data.test.ts`

**Interfaces:**
- Consumes: `@/db/client` (`db`), `@/db/schema` (`catalogueNodes`, `catalogueEdges`, `vendorProfiles`), `./schema` (constants + types), `type { VendorConstraints }` from `@/lib/vendors/schema`. For tests: `createVendorStub`, `updateVendorProfile` from `@/lib/vendors/data`; `queryClient` from `@/db/client`.
- Produces (consumed by Tasks 3 & 6):
  - `getCatalogueGraph(): Promise<CatalogueGraph>`
  - `populateCatalogueFromProfile(vendorId: string): Promise<void>`
  - `matchVendors(q: MatchQuery): Promise<MatchedVendor[]>`
  - `rebuildCatalogue(): Promise<{ vendors: number }>`

> **Note (first transaction in the codebase):** `populateCatalogueFromProfile` uses `db.transaction(...)`. This is the first use of a transaction on the app pooled connection. The integration test exercises it against the real (pooled) DB, so a pooled-endpoint incompatibility surfaces here. If `db.transaction` fails on the pooled endpoint, fall back to sequential statements without an explicit transaction and note it in the report (single-operator sequential usage makes the atomicity loss acceptable) — do not block the task on it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/catalogue-data.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createVendorStub, updateVendorProfile, type VendorProfileInput } from "@/lib/vendors/data";
import {
  getCatalogueGraph,
  populateCatalogueFromProfile,
  matchVendors,
  rebuildCatalogue,
} from "@/lib/catalogue/data";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["catalogue_edges", "catalogue_nodes", "vendor_profiles"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

function profile(name: string, capabilities: string[], geographies: string[]): VendorProfileInput {
  return {
    name,
    capabilities,
    constraints: { geographies, maxProjectSize: "100000 sqft" },
    idealCustomer: undefined,
    knownGoodSignals: undefined,
    differentiators: undefined,
    credibility: undefined,
  };
}

// Set up a vendor + profile, then project it explicitly (this task runs BEFORE
// updateVendorProfile is wired to auto-project in Task 3; an extra explicit
// populate is idempotent and stays correct after Task 3).
async function seedVendor(name: string, caps: string[], geos: string[]): Promise<string> {
  const { vendorId } = await createVendorStub({ name });
  await updateVendorProfile(vendorId, profile(name, caps, geos));
  await populateCatalogueFromProfile(vendorId);
  return vendorId;
}

describe("populateCatalogueFromProfile", () => {
  it("creates a vendor node (with vendorId + size metadata) and capability/geography nodes + edges", async () => {
    const vendorId = await seedVendor("Meridian Infra", ["Racking", "CCTV"], ["Maharashtra"]);
    const { nodes, edges } = await getCatalogueGraph();

    const vendor = nodes.find((n) => n.type === "vendor");
    expect(vendor?.label).toBe("Meridian Infra");
    expect((vendor?.metadata as { vendorId?: string; size?: string }).vendorId).toBe(vendorId);
    expect((vendor?.metadata as { size?: string }).size).toBe("100000 sqft");

    expect(nodes.filter((n) => n.type === "capability").map((n) => n.label).sort())
      .toEqual(["CCTV", "Racking"]);
    expect(nodes.filter((n) => n.type === "geography").map((n) => n.label)).toEqual(["Maharashtra"]);
    expect(edges.filter((e) => e.type === "vendor_capability")).toHaveLength(2);
    expect(edges.filter((e) => e.type === "vendor_geography")).toHaveLength(1);
  });

  it("is idempotent — projecting twice yields the same node/edge counts", async () => {
    const vendorId = await seedVendor("Meridian Infra", ["Racking", "CCTV"], ["Maharashtra"]);
    await populateCatalogueFromProfile(vendorId);
    const { nodes, edges } = await getCatalogueGraph();
    expect(nodes).toHaveLength(4); // 1 vendor + 2 capabilities + 1 geography
    expect(edges).toHaveLength(3); // 2 vendor_capability + 1 vendor_geography
  });

  it("prunes a capability node that becomes orphaned when the vendor drops it", async () => {
    const vendorId = await seedVendor("Meridian Infra", ["Racking", "CCTV"], ["Maharashtra"]);
    await updateVendorProfile(vendorId, profile("Meridian Infra", ["Racking"], ["Maharashtra"]));
    await populateCatalogueFromProfile(vendorId);
    const { nodes } = await getCatalogueGraph();
    expect(nodes.filter((n) => n.type === "capability").map((n) => n.label)).toEqual(["Racking"]);
  });

  it("reuses a shared capability node across two vendors (dedupe by type+label)", async () => {
    await seedVendor("Meridian Infra", ["Racking"], ["Maharashtra"]);
    await seedVendor("Groundwave Mktg", ["Racking"], ["Gujarat"]);
    const { nodes, edges } = await getCatalogueGraph();
    expect(nodes.filter((n) => n.type === "capability")).toHaveLength(1);
    expect(edges.filter((e) => e.type === "vendor_capability")).toHaveLength(2);
  });
});

describe("matchVendors", () => {
  it("returns vendors adjacent to BOTH a capability and a geography (intersection)", async () => {
    await seedVendor("Meridian Infra", ["Racking"], ["Maharashtra"]);
    await seedVendor("Groundwave Mktg", ["Racking"], ["Gujarat"]);
    const both = await matchVendors({ capability: "Racking", geography: "Maharashtra" });
    expect(both.map((v) => v.name)).toEqual(["Meridian Infra"]);
  });

  it("returns the adjacency set for a single dimension, case-insensitively", async () => {
    await seedVendor("Meridian Infra", ["Racking"], ["Maharashtra"]);
    await seedVendor("Groundwave Mktg", ["Racking"], ["Gujarat"]);
    const byCap = await matchVendors({ capability: "racking" });
    expect(byCap.map((v) => v.name)).toEqual(["Groundwave Mktg", "Meridian Infra"]);
  });

  it("returns [] when no query dimension is given", async () => {
    await seedVendor("Meridian Infra", ["Racking"], ["Maharashtra"]);
    expect(await matchVendors({})).toEqual([]);
  });
});

describe("rebuildCatalogue", () => {
  it("projects every vendor and reports the count", async () => {
    const { vendorId: a } = await createVendorStub({ name: "A" });
    await updateVendorProfile(a, profile("A", ["Racking"], ["Maharashtra"]));
    const { vendorId: b } = await createVendorStub({ name: "B" });
    await updateVendorProfile(b, profile("B", ["CCTV"], ["Gujarat"]));
    await truncateAll(["catalogue_edges", "catalogue_nodes"]); // clear any auto-projection
    const result = await rebuildCatalogue();
    expect(result.vendors).toBe(2);
    const { nodes } = await getCatalogueGraph();
    expect(nodes.filter((n) => n.type === "vendor")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/catalogue-data.test.ts`
Expected: FAIL — `Cannot find module '@/lib/catalogue/data'`.

- [ ] **Step 3: Write the data module**

```ts
// src/lib/catalogue/data.ts
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { catalogueNodes, catalogueEdges, vendorProfiles } from "@/db/schema";
import type { VendorConstraints } from "@/lib/vendors/schema";
import {
  EDGE_VENDOR_CAPABILITY,
  EDGE_VENDOR_GEOGRAPHY,
  type CatalogueGraph,
  type CatalogueNodeType,
  type MatchQuery,
  type MatchedVendor,
} from "./schema";

// Read the whole persisted graph for rendering. Explicit columns; bounded.
export async function getCatalogueGraph(): Promise<CatalogueGraph> {
  const nodes = await db
    .select({
      nodeId: catalogueNodes.nodeId,
      type: catalogueNodes.type,
      label: catalogueNodes.label,
      metadata: catalogueNodes.metadata,
    })
    .from(catalogueNodes)
    .limit(1000);
  const edges = await db
    .select({
      edgeId: catalogueEdges.edgeId,
      fromNodeId: catalogueEdges.fromNodeId,
      toNodeId: catalogueEdges.toNodeId,
      type: catalogueEdges.type,
    })
    .from(catalogueEdges)
    .limit(4000);
  return {
    nodes: nodes.map((n) => ({
      nodeId: n.nodeId,
      type: n.type,
      label: n.label,
      metadata: (n.metadata as Record<string, unknown> | null) ?? null,
    })),
    edges,
  };
}

// Idempotently project ONE vendor's profile into the graph (transactional).
export async function populateCatalogueFromProfile(vendorId: string): Promise<void> {
  const [row] = await db
    .select({
      name: vendorProfiles.name,
      capabilities: vendorProfiles.capabilities,
      constraints: vendorProfiles.constraints,
    })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.vendorId, vendorId))
    .limit(1);
  if (!row) return;

  const constraints = row.constraints as VendorConstraints | null;
  const capabilities = row.capabilities ?? [];
  const geographies = constraints?.geographies ?? [];
  const size = constraints?.maxProjectSize ?? constraints?.minProjectSize ?? undefined;
  const vendorMetadata: { vendorId: string; size?: string } = size ? { vendorId, size } : { vendorId };

  await db.transaction(async (tx) => {
    // 1. find-or-create the vendor node (identity = metadata.vendorId)
    const [existing] = await tx
      .select({ nodeId: catalogueNodes.nodeId })
      .from(catalogueNodes)
      .where(and(eq(catalogueNodes.type, "vendor"), sql`${catalogueNodes.metadata}->>'vendorId' = ${vendorId}`))
      .limit(1);

    let vendorNodeId: string;
    if (existing) {
      vendorNodeId = existing.nodeId;
      await tx
        .update(catalogueNodes)
        .set({ label: row.name, metadata: vendorMetadata })
        .where(eq(catalogueNodes.nodeId, vendorNodeId));
    } else {
      const [inserted] = await tx
        .insert(catalogueNodes)
        .values({ type: "vendor", label: row.name, metadata: vendorMetadata })
        .returning({ nodeId: catalogueNodes.nodeId });
      vendorNodeId = inserted.nodeId;
    }

    // 2. clean slate: drop this vendor's outgoing edges
    await tx.delete(catalogueEdges).where(eq(catalogueEdges.fromNodeId, vendorNodeId));

    // 3 + 4. find-or-create capability/geography nodes and connect them
    async function connect(type: "capability" | "geography", labels: string[], edgeType: string) {
      for (const label of labels) {
        const [node] = await tx
          .select({ nodeId: catalogueNodes.nodeId })
          .from(catalogueNodes)
          .where(and(eq(catalogueNodes.type, type), eq(catalogueNodes.label, label)))
          .limit(1);
        let toNodeId: string;
        if (node) {
          toNodeId = node.nodeId;
        } else {
          const [ins] = await tx
            .insert(catalogueNodes)
            .values({ type, label, metadata: null })
            .returning({ nodeId: catalogueNodes.nodeId });
          toNodeId = ins.nodeId;
        }
        await tx.insert(catalogueEdges).values({ fromNodeId: vendorNodeId, toNodeId, type: edgeType });
      }
    }
    await connect("capability", capabilities, EDGE_VENDOR_CAPABILITY);
    await connect("geography", geographies, EDGE_VENDOR_GEOGRAPHY);

    // 5. prune capability/geography nodes that no longer have any incoming edge
    await tx.delete(catalogueNodes).where(
      and(
        inArray(catalogueNodes.type, ["capability", "geography"]),
        sql`NOT EXISTS (SELECT 1 FROM ${catalogueEdges} WHERE ${catalogueEdges.toNodeId} = ${catalogueNodes.nodeId})`,
      ),
    );
  });
}

// Matchmaking: vendors adjacent to the capability AND/OR geography (spec §4.6).
export async function matchVendors(q: MatchQuery): Promise<MatchedVendor[]> {
  const capability = q.capability?.trim();
  const geography = q.geography?.trim();
  if (!capability && !geography) return [];

  async function vendorNodesAdjacentTo(type: CatalogueNodeType, label: string, edgeType: string) {
    const rows = await db
      .select({ vendorNodeId: catalogueEdges.fromNodeId })
      .from(catalogueEdges)
      .innerJoin(catalogueNodes, eq(catalogueEdges.toNodeId, catalogueNodes.nodeId))
      .where(
        and(
          eq(catalogueEdges.type, edgeType),
          eq(catalogueNodes.type, type),
          sql`lower(${catalogueNodes.label}) = lower(${label})`,
        ),
      )
      .limit(1000);
    return new Set(rows.map((r) => r.vendorNodeId));
  }

  const sets: Set<string>[] = [];
  if (capability) sets.push(await vendorNodesAdjacentTo("capability", capability, EDGE_VENDOR_CAPABILITY));
  if (geography) sets.push(await vendorNodesAdjacentTo("geography", geography, EDGE_VENDOR_GEOGRAPHY));

  let ids = sets[0];
  for (let i = 1; i < sets.length; i++) ids = new Set([...ids].filter((x) => sets[i].has(x)));
  if (ids.size === 0) return [];

  const vendorNodes = await db
    .select({ metadata: catalogueNodes.metadata, label: catalogueNodes.label })
    .from(catalogueNodes)
    .where(inArray(catalogueNodes.nodeId, [...ids]))
    .limit(1000);

  return vendorNodes
    .map((n) => ({
      vendorId: String((n.metadata as { vendorId?: string } | null)?.vendorId ?? ""),
      name: n.label,
    }))
    .filter((v) => v.vendorId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Backfill: project every vendor (for vendors created before this slice). Sequential.
export async function rebuildCatalogue(): Promise<{ vendors: number }> {
  const rows = await db.select({ vendorId: vendorProfiles.vendorId }).from(vendorProfiles).limit(1000);
  for (const { vendorId } of rows) await populateCatalogueFromProfile(vendorId);
  return { vendors: rows.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/catalogue-data.test.ts`
Expected: PASS (8/8). If `db.transaction` errors on the pooled endpoint, apply the fallback from the task note and re-run.

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/lib/catalogue/data.ts tests/integration/catalogue-data.test.ts
git commit -m "feat(catalogue): data layer — project profiles, read graph, match, rebuild

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire projection into the profile save path

**Files:**
- Modify: `src/lib/vendors/data.ts` (add import; append a `populateCatalogueFromProfile` call on the write path of `updateVendorProfile`)
- Modify: `tests/integration/vendors-profile-data.test.ts` (widen `truncateAll`)
- Modify: `tests/integration/vendors-interview-history.test.ts` (widen `truncateAll`)
- Modify: `tests/integration/vendors-update-action.test.ts` (widen `truncateAll`)
- Modify: `tests/integration/interview-actions.test.ts` (widen `truncateAll`)
- Create: `tests/integration/catalogue-sync.test.ts`

**Interfaces:**
- Consumes: `populateCatalogueFromProfile` from `@/lib/catalogue/data` (Task 2).
- Produces: no new exported symbol — `updateVendorProfile` keeps its signature; it now also projects the catalogue on the write path.

> **Impact analysis (required before editing `updateVendorProfile`):** callers are the two server actions — `updateVendor` in `src/app/(app)/vendors/[vendorId]/actions.ts` and `saveInterview` in `src/app/(app)/vendors/[vendorId]/interview/actions.ts`. Both `await` the returned profile. The change is additive (an awaited side-effect appended after the existing write, before `return updated`), so the contract is unchanged. Risk: **LOW**. The no-op early-return path is untouched, so `vendors-profile-data.test.ts`'s "does not bump version on a no-op save" regression still holds.

> **Why the test edits:** after this wiring, any integration test that saves a profile writes `catalogue_*` rows, and `TRUNCATE vendor_profiles CASCADE` does not reach the catalogue tables (no FK path). The four affected files must truncate the catalogue tables too.

- [ ] **Step 1: Write the failing wiring test**

```ts
// tests/integration/catalogue-sync.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createVendorStub, updateVendorProfile, type VendorProfileInput } from "@/lib/vendors/data";
import { getCatalogueGraph } from "@/lib/catalogue/data";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["catalogue_edges", "catalogue_nodes", "vendor_profiles"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

function profile(name: string): VendorProfileInput {
  return {
    name,
    capabilities: ["Racking"],
    constraints: { geographies: ["Maharashtra"] },
    idealCustomer: undefined,
    knownGoodSignals: undefined,
    differentiators: undefined,
    credibility: undefined,
  };
}

describe("catalogue auto-sync on profile save", () => {
  it("projects the vendor into the catalogue when its profile is saved", async () => {
    const { vendorId } = await createVendorStub({ name: "Meridian" });
    await updateVendorProfile(vendorId, profile("Meridian"));

    const { nodes, edges } = await getCatalogueGraph();
    const vendor = nodes.find((n) => n.type === "vendor");
    expect((vendor?.metadata as { vendorId?: string }).vendorId).toBe(vendorId);
    expect(nodes.filter((n) => n.type === "capability").map((n) => n.label)).toEqual(["Racking"]);
    expect(nodes.filter((n) => n.type === "geography").map((n) => n.label)).toEqual(["Maharashtra"]);
    expect(edges).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/catalogue-sync.test.ts`
Expected: FAIL — the vendor node is not found (no projection wired yet).

- [ ] **Step 3: Wire the projection into `updateVendorProfile`**

In `src/lib/vendors/data.ts`, add the import near the top (after the existing imports):

```ts
import { populateCatalogueFromProfile } from "@/lib/catalogue/data";
```

Then, in `updateVendorProfile`, insert the projection call after the re-select and before the final `return updated;`. The tail of the function becomes:

```ts
  const updated = await getVendor(vendorId);
  if (!updated) throw new Error("Vendor not found");
  await populateCatalogueFromProfile(vendorId);
  return updated;
}
```

(The `if (changed.length === 0) return current;` no-op path earlier in the function is left exactly as-is — no projection on a no-op save.)

- [ ] **Step 4: Widen `truncateAll` in the four affected integration tests**

In each file, add `"catalogue_edges"` and `"catalogue_nodes"` to the existing `afterEach` `truncateAll([...])` array:

- `tests/integration/vendors-profile-data.test.ts`: `["vendor_profiles"]` → `["catalogue_edges", "catalogue_nodes", "vendor_profiles"]`
- `tests/integration/vendors-interview-history.test.ts`: `["vendor_profiles"]` → `["catalogue_edges", "catalogue_nodes", "vendor_profiles"]`
- `tests/integration/vendors-update-action.test.ts`: `["vendor_profiles"]` → `["catalogue_edges", "catalogue_nodes", "vendor_profiles"]`
- `tests/integration/interview-actions.test.ts`: `["vendor_interviews", "vendor_profiles"]` → `["catalogue_edges", "catalogue_nodes", "vendor_interviews", "vendor_profiles"]`

- [ ] **Step 5: Run the wiring test + the four touched suites**

Run: `npx vitest run tests/integration/catalogue-sync.test.ts tests/integration/vendors-profile-data.test.ts tests/integration/vendors-interview-history.test.ts tests/integration/vendors-update-action.test.ts tests/integration/interview-actions.test.ts`
Expected: all PASS (the new wiring test green; the four existing suites still green, including the no-op regression).

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/lib/vendors/data.ts tests/integration/catalogue-sync.test.ts tests/integration/vendors-profile-data.test.ts tests/integration/vendors-interview-history.test.ts tests/integration/vendors-update-action.test.ts tests/integration/interview-actions.test.ts
git commit -m "feat(catalogue): auto-project vendor profiles on save

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Pure graph layout (lane assignment)

**Files:**
- Create: `src/app/(app)/catalogue/layout.ts`
- Test: `tests/unit/lib/catalogue-layout.test.ts`

**Interfaces:**
- Consumes: `type { CatalogueGraph, RenderModel, RenderNode }` + `EDGE_VENDOR_GEOGRAPHY` from `@/lib/catalogue/schema`.
- Produces (consumed by Task 6): `catalogueLayout(graph: CatalogueGraph): RenderModel`.

> **Note:** this is a route file named `layout.ts` but it is a **plain module**, not a Next.js `layout.tsx` route segment (different extension, no default React export) — Next.js will not treat it as a segment layout.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/catalogue-layout.test.ts
import { describe, it, expect } from "vitest";
import { catalogueLayout } from "@/app/(app)/catalogue/layout";
import type { CatalogueGraph } from "@/lib/catalogue/schema";

function graph(): CatalogueGraph {
  // 2 vendors, both serving "Maharashtra" (shared) + one unique geo; one shared capability.
  return {
    nodes: [
      { nodeId: "v1", type: "vendor", label: "Meridian", metadata: { vendorId: "vid1", size: "100000 sqft" } },
      { nodeId: "v2", type: "vendor", label: "Groundwave", metadata: { vendorId: "vid2" } },
      { nodeId: "c1", type: "capability", label: "Racking", metadata: null },
      { nodeId: "g1", type: "geography", label: "Maharashtra", metadata: null },
      { nodeId: "g2", type: "geography", label: "Gujarat", metadata: null },
    ],
    edges: [
      { edgeId: "e1", fromNodeId: "v1", toNodeId: "c1", type: "vendor_capability" },
      { edgeId: "e2", fromNodeId: "v2", toNodeId: "c1", type: "vendor_capability" },
      { edgeId: "e3", fromNodeId: "v1", toNodeId: "g1", type: "vendor_geography" },
      { edgeId: "e4", fromNodeId: "v2", toNodeId: "g1", type: "vendor_geography" },
      { edgeId: "e5", fromNodeId: "v2", toNodeId: "g2", type: "vendor_geography" },
    ],
  };
}

describe("catalogueLayout", () => {
  it("places capabilities left (x=190), vendors centre (x=540), geographies right (x=880)", () => {
    const m = catalogueLayout(graph());
    const cap = m.nodes.find((n) => n.id === "c1");
    const ven = m.nodes.find((n) => n.id === "v1");
    const geo = m.nodes.find((n) => n.id === "g1");
    expect(cap?.x).toBe(190);
    expect(ven?.x).toBe(540);
    expect(geo?.x).toBe(880);
  });

  it("marks a geography served by >1 vendor as a pulsing shared region", () => {
    const m = catalogueLayout(graph());
    const shared = m.nodes.find((n) => n.id === "g1");
    const solo = m.nodes.find((n) => n.id === "g2");
    expect(shared?.pulse).toBe(true);
    expect(shared?.sub).toBe("shared region");
    expect(solo?.pulse).toBe(false);
    expect(solo?.sub).toBeUndefined();
  });

  it("carries the vendor size into the node subtitle", () => {
    const m = catalogueLayout(graph());
    expect(m.nodes.find((n) => n.id === "v1")?.sub).toBe("100000 sqft");
    expect(m.nodes.find((n) => n.id === "v2")?.sub).toBeUndefined();
  });

  it("returns every edge, tagging shared-geography edges 'required'", () => {
    const m = catalogueLayout(graph());
    expect(m.edges).toHaveLength(5);
    const sharedEdge = m.edges.find((e) => e.from === "v1" && e.to === "g1");
    const soloEdge = m.edges.find((e) => e.from === "v2" && e.to === "g2");
    expect(sharedEdge?.kind).toBe("required");
    expect(soloEdge?.kind).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/catalogue-layout.test.ts`
Expected: FAIL — `Cannot find module '.../catalogue/layout'`.

- [ ] **Step 3: Write the layout module**

```ts
// src/app/(app)/catalogue/layout.ts
import {
  EDGE_VENDOR_GEOGRAPHY,
  type CatalogueGraph,
  type RenderModel,
  type RenderNode,
} from "@/lib/catalogue/schema";

const X_CAP = 190;
const X_VEN = 540;
const X_GEO = 880;
const W = 1080;

// Deterministic three-lane layout: capabilities (left) → vendors (centre) → geographies (right).
export function catalogueLayout(graph: CatalogueGraph): RenderModel {
  const vendors = graph.nodes.filter((n) => n.type === "vendor");
  const capabilities = graph.nodes.filter((n) => n.type === "capability");
  const geographies = graph.nodes.filter((n) => n.type === "geography");

  // Count incoming vendor_geography edges per geography node → "shared" when >1.
  const geoDegree = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.type === EDGE_VENDOR_GEOGRAPHY) {
      geoDegree.set(e.toNodeId, (geoDegree.get(e.toNodeId) ?? 0) + 1);
    }
  }

  const capH = 60 + capabilities.length * 64;
  const geoH = 80 + geographies.length * 70;
  const H = Math.max(640, capH + 20, geoH + 20);

  const nodes: RenderNode[] = [];

  vendors.forEach((v, i) => {
    const size = (v.metadata as { size?: string } | null)?.size;
    nodes.push({
      id: v.nodeId,
      type: "vendor",
      label: v.label,
      sub: size,
      x: X_VEN,
      y: (H * (i + 1)) / (vendors.length + 1),
      w: 156,
    });
  });

  capabilities.forEach((c, i) => {
    nodes.push({ id: c.nodeId, type: "capability", label: c.label, x: X_CAP, y: 60 + i * 64 });
  });

  geographies.forEach((g, i) => {
    const shared = (geoDegree.get(g.nodeId) ?? 0) > 1;
    nodes.push({
      id: g.nodeId,
      type: "geography",
      label: g.label,
      sub: shared ? "shared region" : undefined,
      x: X_GEO,
      y: 80 + i * 70,
      pulse: shared,
    });
  });

  const edges = graph.edges.map((e) => ({
    from: e.fromNodeId,
    to: e.toNodeId,
    kind: e.type === EDGE_VENDOR_GEOGRAPHY && (geoDegree.get(e.toNodeId) ?? 0) > 1 ? "required" : "",
  }));

  return { nodes, edges, w: W, h: H };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/catalogue-layout.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add "src/app/(app)/catalogue/layout.ts" tests/unit/lib/catalogue-layout.test.ts
git commit -m "feat(catalogue): pure three-lane graph layout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: SVG graph engine (ported, framework-agnostic)

**Files:**
- Create: `src/app/(app)/catalogue/graph-engine.ts`
- Test: `tests/unit/components/catalogue-graph-engine.test.ts`

**Interfaces:**
- Consumes: `type { RenderModel, RenderNode }` from `@/lib/catalogue/schema`.
- Produces (consumed by Task 6): `renderGraph(svg: SVGSVGElement, model: RenderModel, opts?: { onSelect?: (n: RenderNode) => void }): GraphController` and `type GraphController = { zoomIn: () => void; zoomOut: () => void; reset: () => void }`.

> Port of `mockups/v2/assets/graph.js`'s `render()`. Plain DOM (no React, no DB). Draws `<g class="gnode …">` / `<path class="gedge …">`, wires hover-highlight of neighbours, click/Enter → `onSelect`, and pan/zoom via `viewBox`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
// tests/unit/components/catalogue-graph-engine.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderGraph } from "@/app/(app)/catalogue/graph-engine";
import type { RenderModel } from "@/lib/catalogue/schema";

function svgEl(): SVGSVGElement {
  return document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
}

function model(): RenderModel {
  return {
    w: 1080,
    h: 640,
    nodes: [
      { id: "v1", type: "vendor", label: "Meridian", x: 540, y: 320, w: 156 },
      { id: "c1", type: "capability", label: "Racking", x: 190, y: 60 },
      { id: "g1", type: "geography", label: "Maharashtra", x: 880, y: 80, pulse: true, sub: "shared region" },
    ],
    edges: [
      { from: "v1", to: "c1", kind: "" },
      { from: "v1", to: "g1", kind: "required" },
      { from: "v1", to: "ghost", kind: "" }, // dangling endpoint — must be skipped
    ],
  };
}

describe("renderGraph", () => {
  it("draws a <g class='gnode'> per node and a <path class='gedge'> per resolvable edge", () => {
    const svg = svgEl();
    renderGraph(svg, model());
    expect(svg.querySelectorAll("g.gnode")).toHaveLength(3);
    expect(svg.querySelectorAll("path.gedge")).toHaveLength(2); // dangling edge skipped
    expect(svg.querySelector("g.gnode.geography.pulse")).not.toBeNull();
  });

  it("calls onSelect with the node when a node is clicked", () => {
    const svg = svgEl();
    const onSelect = vi.fn();
    renderGraph(svg, model(), { onSelect });
    const vendorNode = svg.querySelector("g.gnode.vendor") as SVGGElement;
    vendorNode.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "v1", type: "vendor" }));
  });

  it("returns a controller whose zoom/reset mutate the viewBox", () => {
    const svg = svgEl();
    const ctrl = renderGraph(svg, model());
    const initial = svg.getAttribute("viewBox");
    expect(initial).toBe("0 0 1080 640");
    ctrl.zoomIn();
    expect(svg.getAttribute("viewBox")).not.toBe(initial);
    ctrl.reset();
    expect(svg.getAttribute("viewBox")).toBe("0 0 1080 640");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/catalogue-graph-engine.test.ts`
Expected: FAIL — `Cannot find module '.../catalogue/graph-engine'`.

- [ ] **Step 3: Write the engine**

```ts
// src/app/(app)/catalogue/graph-engine.ts
// Framework-agnostic SVG graph engine. Ported from mockups/v2/assets/graph.js.
// Draws a node-link graph with hover-highlight, click/Enter select, pan + zoom.
// Node/edge visuals come from v2.css (.gnode / .gedge). No React, no DB.
import type { RenderModel, RenderNode } from "@/lib/catalogue/schema";

const NS = "http://www.w3.org/2000/svg";

function mk(tag: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
  const el = document.createElementNS(NS, tag) as SVGElement;
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(el);
  return el;
}

export type GraphController = { zoomIn: () => void; zoomOut: () => void; reset: () => void };

export function renderGraph(
  svg: SVGSVGElement,
  model: RenderModel,
  opts: { onSelect?: (n: RenderNode) => void } = {},
): GraphController {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const W = model.w || 1000;
  const H = model.h || 700;
  const gEdges = mk("g", {}, svg);
  const gNodes = mk("g", {}, svg);
  const byId: Record<string, RenderNode> = {};
  model.nodes.forEach((n) => (byId[n.id] = n));

  const edgeEls = model.edges
    .map((ed) => {
      const a = byId[ed.from];
      const b = byId[ed.to];
      if (!a || !b) return null;
      const mx = (a.x + b.x) / 2;
      const d = `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
      const p = mk("path", { class: `gedge ${ed.kind || ""}`, d }, gEdges);
      return { p, a: a.id, b: b.id };
    })
    .filter((x): x is { p: SVGElement; a: string; b: string } => x !== null);

  const nodeEls = model.nodes.map((n) => {
    const g = mk(
      "g",
      { class: `gnode ${n.type}${n.pulse ? " pulse" : ""}`, transform: `translate(${n.x},${n.y})`, tabindex: "0" },
      gNodes,
    );
    const w = n.w || Math.max(72, n.label.length * 6.6 + 26);
    const h = n.sub ? 34 : 28;
    mk("rect", { class: "body", x: -w / 2, y: -h / 2, width: w, height: h, rx: 9 }, g);
    const t = mk("text", { x: 0, y: n.sub ? -2 : 4, "text-anchor": "middle" }, g);
    t.textContent = n.label;
    if (n.sub) {
      const s = mk("text", { class: "sub", x: 0, y: 11, "text-anchor": "middle" }, g);
      s.textContent = n.sub;
    }
    return { n, g };
  });

  const neighbors = (id: string) => {
    const ns = new Set([id]);
    edgeEls.forEach((e) => {
      if (e.a === id) ns.add(e.b);
      if (e.b === id) ns.add(e.a);
    });
    return ns;
  };
  const clear = () => {
    nodeEls.forEach((x) => x.g.classList.remove("dim", "active"));
    edgeEls.forEach((e) => e.p.classList.remove("hot", "dim"));
  };
  nodeEls.forEach((ne) => {
    const enter = () => {
      const ns = neighbors(ne.n.id);
      nodeEls.forEach((x) => {
        x.g.classList.toggle("dim", !ns.has(x.n.id));
        x.g.classList.toggle("active", x.n.id === ne.n.id);
      });
      edgeEls.forEach((e) => {
        const on = e.a === ne.n.id || e.b === ne.n.id;
        e.p.classList.toggle("hot", on);
        e.p.classList.toggle("dim", !on);
      });
    };
    ne.g.addEventListener("mouseenter", enter);
    ne.g.addEventListener("focus", enter);
    ne.g.addEventListener("mouseleave", clear);
    ne.g.addEventListener("blur", clear);
    ne.g.addEventListener("click", () => opts.onSelect?.(ne.n));
    ne.g.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") opts.onSelect?.(ne.n);
    });
  });

  // pan + zoom via viewBox
  let vb = { x: 0, y: 0, w: W, h: H };
  const apply = () => svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  apply();
  let drag: { x: number; y: number; vx: number; vy: number } | null = null;
  svg.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y };
    // setPointerCapture is absent in jsdom and can throw if the pointer is already
    // released; a failure here only means smoother drag capture is unavailable.
    if (typeof svg.setPointerCapture === "function") {
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* non-fatal: pointer capture unsupported/unavailable */
      }
    }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const sc = vb.w / (svg.clientWidth || W);
    vb.x = drag.vx - (e.clientX - drag.x) * sc;
    vb.y = drag.vy - (e.clientY - drag.y) * sc;
    apply();
  });
  const end = () => (drag = null);
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointerleave", end);
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? 1.12 : 0.89);
    },
    { passive: false },
  );
  function zoomBy(f: number) {
    const cx = vb.x + vb.w / 2;
    const cy = vb.y + vb.h / 2;
    vb.w = Math.max(260, Math.min(2400, vb.w * f));
    vb.h = vb.w * (H / W);
    vb.x = cx - vb.w / 2;
    vb.y = cy - vb.h / 2;
    apply();
  }
  return {
    zoomIn: () => zoomBy(0.82),
    zoomOut: () => zoomBy(1.2),
    reset: () => {
      vb = { x: 0, y: 0, w: W, h: H };
      apply();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/catalogue-graph-engine.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add "src/app/(app)/catalogue/graph-engine.ts" tests/unit/components/catalogue-graph-engine.test.ts
git commit -m "feat(catalogue): SVG graph engine (pan/zoom/hover/select)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Catalogue route — server page, client view, match action

**Files:**
- Create: `src/app/(app)/catalogue/page.tsx` (server component)
- Create: `src/app/(app)/catalogue/actions.ts` (`"use server"`)
- Create: `src/app/(app)/catalogue/catalogue-view.tsx` (`"use client"`)
- Test: `tests/unit/components/catalogue-view.test.tsx`

**Interfaces:**
- Consumes: `getCatalogueGraph`, `matchVendors` from `@/lib/catalogue/data`; `catalogueLayout` from `./layout`; `renderGraph`, `type GraphController` from `./graph-engine`; `type { CatalogueGraph, RenderNode, MatchQuery, MatchedVendor }` from `@/lib/catalogue/schema`; `PageHeader`, `EmptyState` from `@/app/components/ui/*`; `auth` from `@/lib/auth`.
- Produces: the `/catalogue` route; `matchVendorsAction(q: MatchQuery): Promise<MatchedVendor[]>`; `CatalogueView` component.

- [ ] **Step 1: Write the failing component test**

```tsx
// @vitest-environment jsdom
// tests/unit/components/catalogue-view.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CatalogueGraph } from "@/lib/catalogue/schema";

// Mock the imperative engine so the view test doesn't re-test the engine (Task 5 covers it).
vi.mock("@/app/(app)/catalogue/graph-engine", () => ({
  renderGraph: vi.fn(() => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn() })),
}));
vi.mock("@/app/(app)/catalogue/actions", () => ({ matchVendorsAction: vi.fn() }));

import { CatalogueView } from "@/app/(app)/catalogue/catalogue-view";
import { matchVendorsAction } from "@/app/(app)/catalogue/actions";
import type { Mock } from "vitest";

const graph: CatalogueGraph = {
  nodes: [
    { nodeId: "v1", type: "vendor", label: "Meridian", metadata: { vendorId: "vid1" } },
    { nodeId: "c1", type: "capability", label: "Racking", metadata: null },
    { nodeId: "g1", type: "geography", label: "Maharashtra", metadata: null },
  ],
  edges: [
    { edgeId: "e1", fromNodeId: "v1", toNodeId: "c1", type: "vendor_capability" },
    { edgeId: "e2", fromNodeId: "v1", toNodeId: "g1", type: "vendor_geography" },
  ],
};

beforeEach(() => {
  (matchVendorsAction as Mock).mockReset();
});

describe("CatalogueView", () => {
  it("renders the graph surface, the legend, and zoom controls", () => {
    render(<CatalogueView graph={graph} />);
    expect(screen.getByRole("img", { name: /catalogue graph/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
  });

  it("matches a need and lists the resulting vendors linking to their profiles", async () => {
    (matchVendorsAction as Mock).mockResolvedValue([{ vendorId: "vid1", name: "Meridian" }]);
    const user = userEvent.setup();
    render(<CatalogueView graph={graph} />);

    await user.selectOptions(screen.getByLabelText("Capability"), "Racking");
    await user.selectOptions(screen.getByLabelText("Geography"), "Maharashtra");
    await user.click(screen.getByRole("button", { name: "Match" }));

    expect(matchVendorsAction).toHaveBeenCalledWith({ capability: "Racking", geography: "Maharashtra" });
    const link = await screen.findByRole("link", { name: /Meridian/ });
    expect(link).toHaveAttribute("href", "/vendors/vid1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/catalogue-view.test.tsx`
Expected: FAIL — `Cannot find module '.../catalogue/catalogue-view'`.

- [ ] **Step 3: Write the server action**

```ts
// src/app/(app)/catalogue/actions.ts
"use server";
import { auth } from "@/lib/auth";
import { matchVendors } from "@/lib/catalogue/data";
import type { MatchQuery, MatchedVendor } from "@/lib/catalogue/schema";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export async function matchVendorsAction(query: MatchQuery): Promise<MatchedVendor[]> {
  if (!(await signedIn())) return [];
  return matchVendors(query);
}
```

- [ ] **Step 4: Write the client view**

```tsx
// src/app/(app)/catalogue/catalogue-view.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CatalogueGraph, RenderNode, MatchedVendor } from "@/lib/catalogue/schema";
import { catalogueLayout } from "./layout";
import { renderGraph, type GraphController } from "./graph-engine";
import { matchVendorsAction } from "./actions";

const LEGEND: [string, string][] = [
  ["vendor", "var(--accent)"],
  ["capability", "var(--stage-engaged)"],
  ["geography", "var(--fresh-recent)"],
];

export function CatalogueView({ graph }: { graph: CatalogueGraph }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const ctrlRef = useRef<GraphController | null>(null);
  const [selected, setSelected] = useState<RenderNode | null>(null);

  const [capability, setCapability] = useState("");
  const [geography, setGeography] = useState("");
  const [matches, setMatches] = useState<MatchedVendor[] | null>(null);
  const [matching, setMatching] = useState(false);

  const model = useMemo(() => catalogueLayout(graph), [graph]);
  const capLabels = useMemo(
    () => graph.nodes.filter((n) => n.type === "capability").map((n) => n.label).sort(),
    [graph],
  );
  const geoLabels = useMemo(
    () => graph.nodes.filter((n) => n.type === "geography").map((n) => n.label).sort(),
    [graph],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    ctrlRef.current = renderGraph(svg, model, { onSelect: setSelected });
  }, [model]);

  async function onMatch() {
    setMatching(true);
    const q = {
      ...(capability ? { capability } : {}),
      ...(geography ? { geography } : {}),
    };
    setMatches(await matchVendorsAction(q));
    setMatching(false);
  }

  return (
    <>
      <div className="cat-toolbar">
        <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
          drag to pan · scroll to zoom · hover a node to trace its links
        </span>
      </div>
      <div className="cat-layout">
        <div className="graph-wrap" id="gwrap">
          <svg ref={svgRef} id="graph" role="img" aria-label="Catalogue graph" />
          <div className="graph-legend" aria-hidden="true">
            {LEGEND.map(([label, color]) => (
              <span className="k" style={{ ["--c" as string]: color }} key={label}>
                {label}
              </span>
            ))}
          </div>
          <div className="graph-zoom">
            <button type="button" aria-label="Zoom in" onClick={() => ctrlRef.current?.zoomIn()}>
              +
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => ctrlRef.current?.zoomOut()}>
              −
            </button>
            <button type="button" aria-label="Reset" onClick={() => ctrlRef.current?.reset()}>
              ⤢
            </button>
          </div>
        </div>

        <aside className="cat-panel card card-pad">
          {selected ? (
            <div className="node-detail">
              <div className="nd-type">{selected.type}</div>
              <div className="nd-name">{selected.label}</div>
              {selected.sub && <p className="lead-in">{selected.sub}</p>}
            </div>
          ) : (
            <>
              <h3>The vendor network</h3>
              <p className="lead-in">
                Every vendor, capability and geography as one connected surface — click a node to inspect
                it, or match a need below.
              </p>
            </>
          )}

          <form
            className="match-form"
            onSubmit={(e) => {
              e.preventDefault();
              void onMatch();
            }}
          >
            <label htmlFor="mcap">Capability</label>
            <select id="mcap" value={capability} onChange={(e) => setCapability(e.target.value)}>
              <option value="">Any capability</option>
              {capLabels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label htmlFor="mgeo">Geography</label>
            <select id="mgeo" value={geography} onChange={(e) => setGeography(e.target.value)}>
              <option value="">Any geography</option>
              {geoLabels.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary" disabled={matching || (!capability && !geography)}>
              Match
            </button>
          </form>

          {matches !== null && (
            <div className="match-results">
              {matches.length === 0 ? (
                <p className="muted">No vendors match that need yet.</p>
              ) : (
                <ul className="match-list">
                  {matches.map((v) => (
                    <li key={v.vendorId}>
                      <Link href={`/vendors/${v.vendorId}`}>{v.name}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Write the server page**

```tsx
// src/app/(app)/catalogue/page.tsx
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { getCatalogueGraph } from "@/lib/catalogue/data";
import { CatalogueView } from "./catalogue-view";

export const metadata = { title: "Catalogue — Radar" };

export default async function CataloguePage() {
  const graph = await getCatalogueGraph();
  return (
    <>
      <PageHeader eyebrow="Build" title="Catalogue" />
      {graph.nodes.length === 0 ? (
        <EmptyState
          icon="catalogue"
          title="No vendors in the catalogue yet"
          description="Save a vendor profile — its capabilities and geographies will appear here as a connected network."
        />
      ) : (
        <CatalogueView graph={graph} />
      )}
    </>
  );
}
```

> `EmptyState`'s `icon` prop is typed `NavIconName`; `"catalogue"` is added to that union in Task 7. Task 6 will not typecheck standalone until Task 7 adds the union member — that is expected; the branch's typecheck gate is Task 7. (If you run `npm run typecheck` at the end of Task 6 it will flag `icon="catalogue"`; proceed — Task 7 resolves it. The component test does not exercise `page.tsx`, so it passes.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/catalogue-view.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/catalogue/page.tsx" "src/app/(app)/catalogue/actions.ts" "src/app/(app)/catalogue/catalogue-view.tsx" tests/unit/components/catalogue-view.test.tsx
git commit -m "feat(catalogue): /catalogue route — server page, graph view, match action

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Nav wiring + CSS port (integration gate)

**Files:**
- Modify: `src/app/components/shell/nav-icon.tsx` (add `"catalogue"` to `NavIconName` union + `PATHS`)
- Modify: `src/app/components/shell/rail.tsx` (add the Catalogue nav item to the Build group)
- Modify: `tests/unit/components/rail.test.tsx` (7 → 8 links; add `"Catalogue"`)
- Modify: `src/app/styles/command.css` (append the catalogue block)

**Interfaces:**
- Consumes: the `/catalogue` route + `CatalogueView` from Task 6 (this task makes them reachable and styled).
- Produces: nothing new for later tasks — this is the final integration task. `npm run build` + full suite are the gate for the whole slice.

- [ ] **Step 1: Update the Rail test (7 → 8, add Catalogue)**

In `tests/unit/components/rail.test.tsx`, change the first test's title and label list:

```tsx
  it("renders all 8 nav links grouped Operate/Build", () => {
    render(<Rail />);
    for (const label of [
      "Dashboard",
      "Leads",
      "Pipeline",
      "Contacts",
      "Vendors",
      "Catalogue",
      "Signals",
      "Mappings",
    ]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getByText("Operate")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the Rail test to verify it fails**

Run: `npx vitest run tests/unit/components/rail.test.tsx`
Expected: FAIL — no "Catalogue" link yet.

- [ ] **Step 3: Add the `catalogue` icon**

In `src/app/components/shell/nav-icon.tsx`, add `"catalogue"` to the union and a `PATHS` entry (a connected 4-node network glyph, distinct from `mappings`' triangle):

```tsx
export type NavIconName =
  | "dashboard"
  | "leads"
  | "pipeline"
  | "contacts"
  | "vendors"
  | "catalogue"
  | "signals"
  | "mappings";
```

Add to the `PATHS` record (place the entry after `vendors`):

```tsx
  catalogue: `<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6h7M6 8.5v7M18 8.5v7M8.5 18h7"/>`,
```

- [ ] **Step 4: Add the Catalogue nav item**

In `src/app/components/shell/rail.tsx`, add Catalogue to the Build group's `items`, between Vendors and Signals:

```tsx
  {
    group: "Build",
    items: [
      ["/vendors", "Vendors", "vendors"],
      ["/catalogue", "Catalogue", "catalogue"],
      ["/signals", "Signals", "signals"],
      ["/mappings", "Mappings", "mappings"],
    ],
  },
```

- [ ] **Step 5: Run the Rail test to verify it passes**

Run: `npx vitest run tests/unit/components/rail.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 6: Append the catalogue CSS block**

Append to the end of `src/app/styles/command.css` (the graph primitives `.gnode`/`.gedge`/`.graph-legend`/`.graph-zoom`/`.graph-wrap` base already live in `v2.css` — do not redefine them; this block adds only the page-level layout, panel, node-detail, insight, match-form, and the mobile collapse):

```css

/* --- Phase 2 Slice 2.4: catalogue --- */
.cat-toolbar { display: flex; align-items: center; gap: var(--space-4); margin-bottom: var(--space-4); flex-wrap: wrap; }
.cat-layout { display: grid; grid-template-columns: 1fr 320px; gap: var(--space-4); align-items: start; }
.cat-layout .graph-wrap { height: min(72vh, 680px); }
.cat-panel { position: sticky; top: 112px; }
.cat-panel h3 { font-size: var(--text-md); margin-bottom: var(--space-2); }
.cat-panel .lead-in { color: var(--text-muted); font-size: var(--text-sm); }
.node-detail .nd-type { font-family: var(--font-mono); font-size: var(--text-2xs); text-transform: uppercase; letter-spacing: var(--tracking-wide); color: var(--accent); }
.node-detail .nd-name { font-size: var(--text-lg); font-weight: var(--weight-semibold); margin: 2px 0 var(--space-2); }
.match-form { display: grid; gap: var(--space-2); margin-top: var(--space-4); }
.match-form label { font-size: var(--text-2xs); text-transform: uppercase; letter-spacing: var(--tracking-wide); color: var(--text-muted); }
.match-form select { width: 100%; }
.match-form .btn { margin-top: var(--space-2); }
.match-results { margin-top: var(--space-3); }
.match-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.match-list a { color: var(--accent); }
@media (max-width: 980px) {
  .cat-layout { grid-template-columns: 1fr; }
  .cat-panel { position: static; }
  .cat-layout .graph-wrap { height: 60vh; }
}
```

- [ ] **Step 7: Full verification (integration gate for the slice)**

Run each and confirm green:
```bash
npm run typecheck   # resolves Task 6's icon="catalogue" now that the union has it
npm run lint
npm test            # full suite — all prior tests + the new catalogue tests
npm run build       # /catalogue route present ⇒ CatalogueView client bundle has NO DB code
```
Expected: typecheck clean; lint clean; full suite green; build succeeds and lists the `/catalogue` route. A build failure that pulls `@/lib/catalogue/data` or `@/db/*` into the client bundle means the client-bundle rule was violated — fix the import in `catalogue-view.tsx`.

- [ ] **Step 8: Commit**

```bash
git add src/app/components/shell/nav-icon.tsx src/app/components/shell/rail.tsx tests/unit/components/rail.test.tsx src/app/styles/command.css
git commit -m "feat(catalogue): nav entry + icon and catalogue page styles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §2 populate/read/match/rebuild → Task 2. §3 node/edge conventions → Tasks 1 (constants) + 2 (writes). §4 service signatures → Task 2. §5 save-path wiring → Task 3. §6 route/page/view/engine/layout/match/nav/CSS → Tasks 4–7. §7 error handling (no-swallow, unauth→[], transactional projection) → Task 2 (transaction), Task 6 (action returns []). §8 testing incl. integration-hygiene truncation + rail 7→8 → Tasks 2, 3, 7. §11 deferrals honored (no `sub_capability`/`project_size_range`/gap/flow-mode/`bundling_mode`). All covered.

**2. Placeholder scan:** No TBD/TODO; every step carries complete code and exact commands. Clean.

**3. Type consistency:** `renderGraph`/`GraphController`, `catalogueLayout`, `matchVendorsAction`, `populateCatalogueFromProfile`, `getCatalogueGraph`, `matchVendors`, `rebuildCatalogue`, and the `RenderModel`/`RenderNode`/`CatalogueGraph`/`MatchQuery`/`MatchedVendor` types are named identically across the tasks that define and consume them. Edge-type strings (`vendor_capability`/`vendor_geography`) and lane x-values (190/540/880) match spec §3/§6.

**4. Known ordering note (not a defect):** Task 6's `page.tsx` uses `icon="catalogue"`, which only typechecks after Task 7 adds the union member. This is called out inline in Task 6 Step 5; the branch typecheck/build gate is Task 7 Step 7. The Task 6 component test does not import `page.tsx`, so Task 6's own test gate is unaffected.
