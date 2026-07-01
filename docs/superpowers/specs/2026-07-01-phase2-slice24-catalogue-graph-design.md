# Phase 2 · Slice 2.4 — Catalogue Graph — Design Spec

**Date:** 2026-07-01
**Status:** Approved-by-default (autonomous build; decisions recorded in §11 for override)
**Depends on:** Slices 2.1–2.3 (vendor profiles + interview), all merged to `main`.
**AI?** No. This is a deterministic ETL + query slice.

---

## 1. Overview

The catalogue turns the vendor network into a **queryable graph** instead of a flat list, so a single client need can be matched across every vendor at once. Slice 2.4 delivers three things:

1. **Population** — a deterministic service that projects each vendor profile into `catalogue_nodes` + `catalogue_edges` (vendor node, capability nodes, geography nodes, and the edges between them), kept in sync automatically whenever a profile is saved.
2. **Matchmaking** — a query, `matchVendors({ capability?, geography? })`, that answers the spec's core question (§4.6 of `Phase0_Platform_Specification.md`): *given a need, which vendors satisfy it?*
3. **The `/catalogue` route** — a live, pannable/zoomable SVG graph of the network (ported from the `mockups/v2/command/catalogue.html` "Catalogue network" view), with a node-inspector side panel and a "match a need" control.

The catalogue tables and the `catalogue_node_type` enum **already exist** (created in an earlier migration; see `src/db/schema/catalogue.ts`, `src/db/schema/enums.ts`). **This slice adds no migration.**

## 2. Scope

**In scope**

- `src/lib/catalogue/schema.ts` — pure, DB-free types + edge-type constants.
- `src/lib/catalogue/data.ts` — `getCatalogueGraph`, `populateCatalogueFromProfile`, `matchVendors`, `rebuildCatalogue`.
- Integration: `updateVendorProfile` (in `src/lib/vendors/data.ts`) calls `populateCatalogueFromProfile` after a successful write, so the graph self-syncs on every profile save (manual edit **and** interview save).
- `/catalogue` route: server page + `"use client"` view + a framework-agnostic graph engine (ported from `mockups/v2/assets/graph.js`) + a pure layout function + a `matchVendors` server action.
- CSS: append a catalogue block to `src/app/styles/command.css`.
- Nav: add **Catalogue** to the "Build" group (`rail.tsx`) + a `catalogue` icon (`nav-icon.tsx`).

**Deferred (documented, dependency not yet built) — NOT in this slice**

- **"Mapping flow" graph mode** (the mockup's second toggle) — depends on Signals/Mappings (Phase 3). Ship only the "Catalogue network" mode; no segmented toggle.
- **Gap / unmet-need nodes** — depend on the holding pool (Phase 5). No `holding` table exists. Omit gap nodes.
- **`project_size_range` and `sub_capability` node types** — the profile stores size as free-text and capabilities as a flat `text[]`; there is no structured hierarchy or normalized size range to project. Omit these node types. Vendor size is carried as vendor-node **metadata** (a subtitle), matching the mockup.
- **`bundling_mode` toggle** and **`signal_recipe` computation** — Phase 3.

## 3. Data model (existing tables — no schema change)

```
catalogue_nodes(node_id uuid PK, type catalogue_node_type NOT NULL, label text NOT NULL, metadata jsonb)
catalogue_edges(edge_id uuid PK, from_node_id uuid FK→nodes, to_node_id uuid FK→nodes, type text NOT NULL)
```

Indexes already present: `catalogue_nodes_type_idx (type)`, `catalogue_edges_from_type_idx (from_node_id, type)`, `catalogue_edges_to_type_idx (to_node_id, type)`.

**Node conventions this slice writes:**

| type | label | metadata | natural key (for dedup) |
|------|-------|----------|-------------------------|
| `vendor` | `vendor.name` | `{ vendorId: string, size?: string }` | `metadata->>'vendorId'` |
| `capability` | the capability string (e.g. `"Racking"`) | `null` | `(type, label)` |
| `geography` | the geography string (e.g. `"Maharashtra"`) | `null` | `(type, label)` |

**Edge conventions:**

| type (string) | from → to |
|---------------|-----------|
| `vendor_capability` | vendor node → capability node |
| `vendor_geography`  | vendor node → geography node |

`vendor.metadata.size` is derived: `constraints?.maxProjectSize ?? constraints?.minProjectSize ?? undefined`.

**Deduplication:** the table has no unique constraint. Population runs inside a transaction and uses **find-or-create** (query by natural key, insert if absent). Single-operator sequential usage makes TOCTOU races irrelevant; a partial unique index is a noted future optimization, not needed now.

## 4. Catalogue service — `src/lib/catalogue/data.ts`

All functions import `@/db/client` + `@/db/schema` (data layer — DB access allowed). Types come from `./schema`.

```ts
// Read the whole persisted graph for rendering. Explicit columns; bounded.
export async function getCatalogueGraph(): Promise<CatalogueGraph>;
//   CatalogueGraph = { nodes: CatalogueNode[]; edges: CatalogueEdge[] }

// Idempotently project ONE vendor's profile into the graph. Transactional:
//   1. find-or-create the vendor node (by metadata.vendorId); update its label + size.
//   2. delete this vendor node's outgoing edges (clean slate for this vendor).
//   3. for each capability: find-or-create capability node (by type,label); add vendor_capability edge.
//   4. for each geography:  find-or-create geography node (by type,label); add vendor_geography edge.
//   5. prune capability/geography nodes that now have zero edges (handles removals).
// A vendor with no capabilities/geographies still gets its (isolated) vendor node.
export async function populateCatalogueFromProfile(vendorId: string): Promise<void>;

// Matchmaking (spec §4.6). Vendors connected to the capability AND/OR geography.
//   - both given  → vendors adjacent to BOTH nodes (intersection)
//   - one given   → vendors adjacent to that node
//   - none given  → [] (nothing to match)
// Matching is case-insensitive on label. Returns distinct vendors, name-sorted.
export async function matchVendors(q: MatchQuery): Promise<MatchedVendor[]>;
//   MatchQuery = { capability?: string; geography?: string }
//   MatchedVendor = { vendorId: string; name: string }

// Backfill: populate every vendor (for vendors that predate this slice). Sequential.
export async function rebuildCatalogue(): Promise<{ vendors: number }>;
```

`populateCatalogueFromProfile` reads `name`, `capabilities`, and `constraints` **directly from the `vendor_profiles` row** (a bounded single-row `SELECT` of just those three columns) rather than via `getVendor` — this keeps the dependency one-directional (`vendors/data.ts` → `catalogue/data.ts`) and avoids an import cycle. `catalogue/data.ts` imports only `@/db/*`, `./schema`, and the pure `type { VendorConstraints }` from `@/lib/vendors/schema` (never `@/lib/vendors/data`). It is a no-op-safe rebuild: calling it repeatedly yields the same graph.

## 5. Integration into the save path — `src/lib/vendors/data.ts`

`updateVendorProfile` currently early-returns on a no-op (no changed fields) and otherwise writes + returns the fresh profile. Change: **after** a successful write (i.e. not on the no-op path), call `await populateCatalogueFromProfile(vendorId)` before returning `updated`. This makes the catalogue self-sync from the single mutation point, so both callers (`vendors/[vendorId]/actions.ts` manual edit, and `interview/actions.ts` `saveInterview`) keep the graph fresh with no per-caller wiring.

- Import is `src/lib/vendors/data.ts` → `src/lib/catalogue/data.ts` (data-layer → data-layer; allowed).
- The no-op path stays a pure early return (no catalogue write) — nothing changed, nothing to re-project.
- `createVendorStub` is **not** wired (a name-only stub has nothing to project; the vendor enters the catalogue on its first real profile save, which always has changed fields).
- **Impact:** `updateVendorProfile` has exactly two callers (both server actions); the change is additive (a call appended after the existing write). Risk: LOW. The existing no-op regression test still holds.

## 6. UI — `/catalogue`

Route dir: `src/app/(app)/catalogue/`.

- **`page.tsx`** (server component): `const graph = await getCatalogueGraph();` → `<PageHeader eyebrow="Build" title="Catalogue" />` + `<CatalogueView graph={graph} />`. `metadata = { title: "Catalogue — Radar" }`. If `graph.nodes` is empty, `CatalogueView` shows an empty state ("No vendors in the catalogue yet — save a vendor profile to populate the network.").
- **`catalogue-view.tsx`** (`"use client"`): receives `graph`, computes positions with `catalogueLayout(graph)`, renders `<svg ref>` via the engine in a `useEffect` (re-run on `graph` change), keeps the returned zoom controller in a ref for the zoom buttons, tracks a `selected` node in state for the side panel, and renders the toolbar hint, legend, zoom controls, node inspector, and the match control. Imports the engine + layout as plain modules and `matchVendors` action + types; imports NO DB code.
- **`graph-engine.ts`** (plain module, no `"use client"`, no DB): the ported imperative `render(svg, model, { onSelect })` from `graph.js` — builds `<g class="gnode …">`/`<path class="gedge …">`, wires hover-highlight of neighbours, click/Enter → `onSelect(node)`, and pan/zoom via `viewBox`; returns `{ zoomIn, zoomOut, reset }`. Framework-agnostic; imported only by the client view.
- **`layout.ts`** (pure, no DOM): `catalogueLayout(graph): PositionedModel` — assigns the three vertical lanes (capabilities left `x=190`, vendors centre `x=540`, geographies right `x=880`), spacing rows evenly, marking a geography `pulse` + `sub:"shared region"` when >1 vendor is adjacent, and setting each vendor node's `sub` from `metadata.size`. Returns `{ nodes: PositionedNode[]; edges: {from,to,kind?}[]; w; h }`. Unit-tested in isolation.
- **Match control** (inside the side panel): two native `<select>`s populated from the graph's capability + geography node labels, plus a "Match" button → a `matchVendorsAction(q)` server action (auth-gated, wraps `matchVendors`) → renders the matched vendor list (each linking to `/vendors/{vendorId}`). Empty/na states handled.
- **`actions.ts`** (`"use server"`): `matchVendorsAction(q: MatchQuery): Promise<MatchedVendor[]>` — `signedIn()` guard, then `matchVendors(q)`.

**Nav:** add `["/catalogue", "Catalogue", "catalogue"]` to the "Build" group in `rail.tsx`; add `"catalogue"` to `NavIconName` + a `PATHS.catalogue` SVG (a simple node-link glyph). Build group order: Vendors, Catalogue, Signals, Mappings.

**CSS:** append to `command.css` a `/* --- Phase 2 Slice 2.4: catalogue --- */` block porting the mockup's inline styles: `.cat-toolbar`, `.cat-layout` (grid `1fr 320px`), `.graph-wrap { height: min(72vh, 680px) }`, `.cat-panel` (sticky), `.node-detail .nd-type/.nd-name`, `.insight`, and the `@media (max-width: 980px)` collapse. The graph primitives (`.gnode/.gedge/.graph-legend/.graph-zoom`) are already in `v2.css` — do not redefine.

## 7. Error handling

- `matchVendorsAction`: unauth → return `[]` (the UI shows "no matches"); it never throws to the client.
- `populateCatalogueFromProfile` is **internally transactional** (atomic per vendor: a projection either fully lands or not at all — the graph never holds half a vendor's edges). It is called at the end of `updateVendorProfile`'s write path with a plain `await` and **no swallowing catch** (a silent catch would violate the project's "handle errors explicitly" rule). If it throws, the error propagates — but note the profile `UPDATE` has already committed (the projection is not in the same transaction as the profile write, matching the existing non-atomic update-then-reselect style already in this function). **Accepted limitation:** in the rare case the projection fails *after* the profile write commits, the catalogue is stale for that vendor until the next profile change re-projects it, or an operator runs `rebuildCatalogue()`. This is acceptable for a single-operator internal tool where the catalogue is a derived, reconcilable view. We do **not** add a swallowing catch to hide the failure.
- Empty graph → explicit empty state, not an error.
- No user input reaches SQL unparameterized (Drizzle parameterizes; match labels are bound values).

## 8. Testing

- **`catalogue/schema`** (unit): edge-type constants + type shape sanity.
- **`catalogue/data`** (integration, real DB): `populateCatalogueFromProfile` creates the right nodes/edges and is idempotent (run twice → same counts); removing a capability prunes its now-orphan node; `matchVendors` returns the intersection for capability+geography, the adjacency set for one, and `[]` for none (case-insensitive); `getCatalogueGraph` returns nodes+edges; `rebuildCatalogue` counts vendors.
- **`vendors/data` integration**: saving a profile populates the catalogue (a `vendor` node with the right `vendorId` metadata + `vendor_capability`/`vendor_geography` edges appear); the existing no-op regression test still passes.
- **`layout`** (unit): lane x-assignment, even row spacing, shared-geography `pulse`, vendor `sub` from size.
- **`graph-engine`** (jsdom): renders N `.gnode` + M `.gedge` elements; click a node fires `onSelect` with that node; controller `zoomIn/out/reset` mutate the `viewBox`.
- **`catalogue-view`** (jsdom): renders the graph container + legend + zoom controls (with `renderGraph` and `matchVendorsAction` mocked); the match control calls `matchVendorsAction` with the selected labels and lists results linking to `/vendors/{id}`. (The empty-state branch lives in `page.tsx`, so the view always receives a non-empty graph.)
- Client-bundle rule: `catalogue-view.tsx` imports only types + the engine/layout modules + the `./actions` server-action reference — never `@/db/*` or `@/lib/catalogue/data`. Verified by `npm run build` (route present, no DB bundled).
- **Integration-test hygiene (introduced by §5's wiring):** once `updateVendorProfile` projects into the catalogue, every integration test that saves a profile writes `catalogue_*` rows, and `TRUNCATE vendor_profiles CASCADE` does **not** reach the catalogue tables (no FK path). So the four files that trigger a profile write — `vendors-profile-data.test.ts`, `vendors-interview-history.test.ts`, `vendors-update-action.test.ts`, `interview-actions.test.ts` — must add `catalogue_edges` + `catalogue_nodes` to their `afterEach` `truncateAll([...])` lists. The new `catalogue-data`/`catalogue-sync` test files truncate them too.
- **`rail.test.tsx` update:** the existing Rail test asserts "all 7 nav links"; adding **Catalogue** makes 8 — update the count wording and add `"Catalogue"` to the asserted-labels array.

## 9. Global constraints (verbatim, binding on every task)

- **`src/ai/**` = no DB access** — N/A here (no AI in this slice), but the client-bundle rule is analogous: the `"use client"` catalogue view must not reach DB code.
- Explicit columns + bounded reads (no `SELECT *`, `.limit()` on lists). Parameterized queries only.
- No stack traces / internal errors to the client. No `console.log`/TODOs in committed code.
- Mobile-first: the `@media (max-width: 980px)` collapse (single column, static panel) is required.
- Semantic HTML; keyboard-navigable nodes (`tabindex` + Enter, already in the engine); every interactive control labelled.
- Tests live next to code; ≥80% on new code. Commit only explicit paths (never `git add .`/`-A`); trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## 10. Testable checkpoint (after the slice)

1. `npm run dev`, sign in. (No migration needed — tables already exist.)
2. Open a vendor with capabilities + geographies; **Edit profile** → Save (or run an interview → Save). 
3. Open **Catalogue** (new nav item under Build) → the vendor appears as a centre node linked to its capability nodes (left) and geography nodes (right); a geography served by >1 vendor pulses as "shared region". Drag to pan, scroll to zoom, hover to trace links, click a node to inspect it.
4. In the side panel's **Match a need**, pick a capability + a geography → the matching vendors list appears, each linking to its profile.
5. Edit the vendor to remove a capability → Save → return to Catalogue → the capability node/edge is gone (pruned).

## 11. Open-question resolutions (recorded for override)

1. **Nav group** → "Build" (catalogue is derived from vendor profiles, which live under Build). 2. **Node dedup** → find-or-create in a transaction; no unique index / no migration. 3. **Vendor identity** → `metadata.vendorId`. 4. **`project_size_range`** → omit node type; size is vendor metadata. 5. **Gap nodes / holding pool** → omit (Phase 5 dependency). 6. **Render approach** → server fetches graph, client renders via ported imperative engine (mirrors the SIA server-fetch → client-render split). 7. **Mapping-flow mode** → deferred (Phase 3). 8. **NavIcon** → add `catalogue`. 9. **`bundling_mode`** → deferred. 10. **`sub_capability`** → omit (flat capabilities only).

None of these is a genuine product fork — each deferral is a dependency that a later phase builds. If any resolution is wrong, say so and I'll revise before/after the affected task.
