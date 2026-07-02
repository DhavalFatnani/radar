# Phase 4 Slice 4 — Contact Block / Decision-Maker Resolution (Design)

**Date:** 2026-07-03
**Status:** Approved (directional source-strategy question answered: pluggable resolver + stub)
**Phase/Slice:** Phase 4 (Sourcing engine + reverse brief) · Slice 4
**Predecessors:** Slice 1 tender detection (d851b08) · Slice 2 matching & scoring (1e74ecf) · Slice 3 reverse brief (8ac16b6)

## 1. Problem & Value

A scored, briefed lead still can't be actioned without knowing **who** to reach.
`leads.contact_block` (jsonb, already in the schema) is the column that carries the
decision-makers for a lead. This slice builds the pipeline that populates it.

The mockup (`mockups/leads.html`, `contactBlock()`) frames this domain as **enrichment**:
each lead shows either resolved decision-makers (name, role, why, contact paths, warm/cold
intro status) or the empty state **"Contacts pending enrichment — Decision-makers for this
lead haven't been resolved yet."** The UI is deliberately vendor-agnostic: it renders the
*result* of enrichment, never naming where the identities came from.

**Where decision-maker identities come from is a business/privacy decision, and the answer
for this slice is:** build the full enrichment pipeline behind a **pluggable, injected
resolver** (mirroring Slice 3's injected LLM generator and the module's existing
`SourceAdapter` seam). Ship a **deterministic stub resolver** now that returns no
contacts (every lead → `pending_enrichment`). A real external adapter (Apollo / Clearbit /
Hunter / etc.) becomes a later **floating add-on** — a drop-in `ContactResolver`
implementation that requires no change to the data layer, the persisted contract, or the UI.

This keeps the platform's **"no fabrication, defensible"** thesis intact in a new domain:
the pipeline never invents a person. Unlike the brief's `why_now` receipts (pinned from
authoritative `signal_observations` rows), contact data has no DB receipt to pin against —
the resolver *is* the source of record — so the integrity discipline here is **pass-through
only**: the data layer persists exactly what the resolver returns and adds only enrichment
metadata (status / who resolved it / when). An empty resolver result yields
`pending_enrichment`, never a placeholder person.

## 2. Scope

**In scope**
- Pure `ContactResolver` seam + persisted `contact_block` contract (Zod + types), DB-free, client-safe.
- Deterministic **stub** resolver (`sourceName: "stub"`, returns zero decision-makers).
- Injected server data layer: scan un-resolved leads → call resolver → persist a `contact_block`.
- Runner script + `npm run db:contacts:resolve`.
- Unit + integration tests covering both branches (resolved / pending), idempotency, failure isolation.

**Out of scope (explicit)**
- Any real external enrichment vendor / API integration (a later floating add-on).
- Any network I/O, API keys, or PII sourcing.
- The leads-detail UI wiring that renders `contact_block` (a later app-shell slice; the mockup is the contract).
- Warm-path *computation* (graph of existing relationships). The `warm` field is carried
  through from the resolver; the stub emits none. Computing warm paths is future work.
- Schema/migration changes — `leads.contact_block` (jsonb) already exists.

## 3. Architecture

Three layers, mirroring Slice 3 and the module's existing tender-adapter seam. **No `src/ai/`
involvement** — the stub resolver is deterministic, so there is no LLM in this slice.

```
src/lib/sourcing/contacts-schema.ts   PURE   Zod + types + ContactResolver seam + buildContactBlock()
src/lib/sourcing/adapters/contacts-stub.ts    concrete ContactResolver ("stub", returns [])
src/lib/sourcing/contacts.ts          SERVER resolveContactsForLeads(db, resolver, now)
src/db/resolve-contacts.ts            RUNNER runContactResolution(db) → wires the stub
```

### 3.1 Pure schema + seam — `src/lib/sourcing/contacts-schema.ts`

DB-free, client-safe (no `@/db`, no `server-only`). Imports only `zod`.

```ts
// One contact path (email / phone / linkedin / ...). val null = "not found / needs enrichment".
contactPathSchema = z.object({
  type: z.string().min(1),
  val: z.string().nullable(),
  conf: z.string().nullable(),      // resolver's confidence label, e.g. "high" / "verified"
  source: z.string().nullable(),    // provenance: where the resolver got this path
})
export type ContactPath = z.infer<typeof contactPathSchema>

warmPathSchema = z.object({
  status: z.enum(["warm", "cold"]),
  detail: z.string().nullable(),
})
export type WarmPath = z.infer<typeof warmPathSchema>

decisionMakerSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  why: z.string(),                  // why this person is a decision-maker for THIS deal
  paths: z.array(contactPathSchema),
  warm: warmPathSchema,
})
export type DecisionMaker = z.infer<typeof decisionMakerSchema>

// Persisted shape of leads.contact_block.
contactBlockSchema = z.object({
  decision_makers: z.array(decisionMakerSchema),
  status: z.enum(["pending_enrichment", "resolved"]),
  resolvedBy: z.string().min(1),    // resolver.sourceName ("stub" | future "apollo" | ...)
  resolvedAt: z.string(),           // ISO, from injected now
})
export type ContactBlock = z.infer<typeof contactBlockSchema>

// Context a resolver needs to find the right people. Minimal but sufficient:
// company to search, vendor + intent to know which roles are the decision-makers.
export type ContactResolutionInput = {
  company: { name: string; description: string | null }
  vendor: { name: string; vendorType: string | null }
  intent: string | null
}

// The extensibility seam every resolver implements (mirrors SourceAdapter in schema.ts).
export interface ContactResolver {
  readonly sourceName: string
  resolve(input: ContactResolutionInput): Promise<{ decisionMakers: DecisionMaker[] }>
}

// PURE assembler: never synthesizes a person. Empty in → pending_enrichment. Non-empty → resolved.
export function buildContactBlock(
  decisionMakers: DecisionMaker[],
  resolvedBy: string,
  now: Date,
): ContactBlock {
  return {
    decision_makers: decisionMakers,
    status: decisionMakers.length > 0 ? "resolved" : "pending_enrichment",
    resolvedBy,
    resolvedAt: now.toISOString(),
  }
}
```

The decision-maker field names (`name`, `role`, `why`, `paths[{type,val,conf,source}]`,
`warm{status,detail}`) match exactly what `mockups/leads.html contactBlock()` consumes, so
the future UI mapping (`contact_block.decision_makers` → the mockup's `l.contacts`) is trivial.

### 3.2 Stub resolver — `src/lib/sourcing/adapters/contacts-stub.ts`

```ts
import type { ContactResolver } from "@/lib/sourcing/contacts-schema";

// Deterministic placeholder: resolves no decision-makers, so every lead lands in
// pending_enrichment. A real external resolver (Apollo/Clearbit/...) is a drop-in
// ContactResolver added later with no change to the data layer, contract, or UI.
export const contactsStubResolver: ContactResolver = {
  sourceName: "stub",
  async resolve() {
    return { decisionMakers: [] };
  },
};
```

### 3.3 Data layer — `src/lib/sourcing/contacts.ts`

Injected `db` (type-only import, load-bearing) + injected `ContactResolver`. Zero network,
zero secrets.

```ts
export type ResolveContactsResult = {
  leadsScanned: number;       // leads with contact_block IS NULL processed this run
  contactsResolved: number;   // blocks written with status "resolved" (resolver returned >=1 DM)
  pendingEnrichment: number;  // blocks written with status "pending_enrichment" (resolver returned 0)
  failures: number;           // resolver threw → lead left un-resolved, batch continues
};

export const CONTACT_LEAD_LIMIT = 200;

export async function resolveContactsForLeads(
  db: DB,
  resolver: ContactResolver,
  now: Date = new Date(),
): Promise<ResolveContactsResult>;
```

**Flow**
1. `select ... from leads where isNull(leads.contactBlock) limit CONTACT_LEAD_LIMIT`.
2. Batch-load referenced `companies` and `vendorProfiles` via `inArray` (bounded by the ≤200 leads). The resolver input needs only company + vendor + the lead's own `intent`, so `mappings` is not loaded.
3. Per lead: build `ContactResolutionInput` from company (name/description), vendor
   (name/vendorType), and `lead.intent`. If a required company or vendor row is missing,
   count in `failures` and continue (never fabricate context).
4. `try { const { decisionMakers } = await resolver.resolve(input) } catch { failures++; continue }`.
5. `const block = buildContactBlock(decisionMakers, resolver.sourceName, now)`.
6. `db.update(leads).set({ contactBlock: block }).where(eq(leads.leadId, lead.leadId))` — **writes
   only `contactBlock`**, never brief / score / pipelineStage / intent.
7. Tally: `status === "resolved" ? contactsResolved++ : pendingEnrichment++`.

**Idempotency:** selection is `isNull(contactBlock)`. Once a lead has a block (resolved *or*
pending), it is not re-scanned by this runner → a second run reports `leadsScanned: 0`. When a
real resolver is introduced later, that add-on selects the `pending_enrichment` blocks to
upgrade them (its own selection semantics, out of scope here).

**Pass-through integrity:** `decision_makers` is exactly the resolver's `decisionMakers`
array. The data layer adds only `status`, `resolvedBy`, `resolvedAt`. It never invents,
infers, or defaults any `name` / `role` / `why` / `path` value.

### 3.4 Runner — `src/db/resolve-contacts.ts`

Line-for-line mirror of `src/db/brief-generate.ts` / `source-leads.ts`.

```ts
export async function runContactResolution(db: DB): Promise<ResolveContactsResult> {
  return resolveContactsForLeads(db, contactsStubResolver);
}
```

Direct-run guard (`endsWith("resolve-contacts.ts")`) with `config({ path: ".env.local" })`
inside the guard; own `postgres(url, { prepare: false, max: 1 })` from
`DATABASE_URL ?? DIRECT_URL`; `.then(log "Contact resolution complete:")
.then(client.end).then(exit 0).catch(log + exit 1)`. `package.json`: add exactly one script
line `"db:contacts:resolve": "tsx src/db/resolve-contacts.ts"` after `db:brief:generate`.

## 4. Data Flow

```
db:contacts:resolve
  → runContactResolution(db)
    → resolveContactsForLeads(db, contactsStubResolver)
      → SELECT leads WHERE contact_block IS NULL (≤200)
      → batch-load companies / vendor_profiles
      → per lead: buildInput → resolver.resolve(input) → buildContactBlock → UPDATE leads.contact_block
      → { leadsScanned, contactsResolved, pendingEnrichment, failures }
  → console.log summary → exit
```

With the stub, every scanned lead → `pending_enrichment` (0 resolved). The resolved branch is
proven in tests by a stub that returns decision-makers.

## 5. Error Handling

- **Resolver throws** → increment `failures`, leave the lead's `contact_block` NULL, continue the batch (failure isolation, mirroring `brief.ts`).
- **Missing company/vendor row** for a lead → `failures`, continue (never fabricate resolution context).
- **Runner** wraps the whole run in `.catch` → log + `exit 1` (operator stderr, sanctioned).
- No stack traces or internal errors reach any client (there is no client surface in this slice).

## 6. Testing

- **Unit** `tests/unit/sourcing/contacts-schema.test.ts`:
  1. `buildContactBlock([], "stub", now)` → `status "pending_enrichment"`, `decision_makers []`, `resolvedBy "stub"`, `resolvedAt now.toISOString()`.
  2. `buildContactBlock([dm], "apollo", now)` → `status "resolved"`, `decision_makers [dm]` (verbatim), `resolvedBy "apollo"`.
  3. `contactBlockSchema` accepts a valid resolved block; rejects a decision-maker missing `name`.
  4. `contactsStubResolver.resolve(input)` → `{ decisionMakers: [] }` and `sourceName === "stub"`.
- **Integration** `tests/integration/sourcing-contacts.test.ts` (mirrors `sourcing-brief` harness — `migrateTestDb`/`truncateAll`/`closeTestDb`/`testDb`, injected resolver):
  1. Empty-returning resolver → `contact_block` persisted `pending_enrichment`, `decision_makers []`, `resolvedAt` = injected now, `resolvedBy` = resolver `sourceName`; result `{contactsResolved:0, pendingEnrichment:1}`.
  2. DM-returning stub resolver → `resolved`, `decision_makers` mapped **verbatim** (paths + warm preserved), `resolvedBy` = sourceName.
  3. Idempotent re-run → `leadsScanned: 0` (block already present, `isNull` selection).
  4. Failure isolation — resolver throws selectively (one company) → that lead stays NULL & counts in `failures`; the other lead is still resolved.
  5. A lead with a pre-existing `contact_block` is not re-scanned (selection excludes non-null).

Test commands: `npx vitest run tests/unit/sourcing/contacts-schema.test.ts`,
`npx vitest run tests/integration/sourcing-contacts.test.ts`, full gate `npm test`, `npx tsc --noEmit`.

## 7. Dependency Boundaries (both directions)

- `contacts-schema.ts`: imports **only** `zod`. No `@/db`, no `server-only`. Client-safe.
- `adapters/contacts-stub.ts`: imports only `import type { ContactResolver } from "@/lib/sourcing/contacts-schema"`. Pure, no DB.
- `contacts.ts`: `import type { DB } from "@/db/client"` (type-only, erased at runtime); `@/db/schema` for tables; pure helpers/types from `contacts-schema`; `drizzle-orm` operators. Resolver injected — no import of any concrete adapter.
- `resolve-contacts.ts`: imports `resolveContactsForLeads` + type from `../lib/sourcing/contacts`, `contactsStubResolver` from `../lib/sourcing/adapters/contacts-stub`, `import type { DB } from "./client"`.

## 8. Risk / Impact

Purely additive: four new files + one `package.json` script line. No existing symbol is
modified, no schema/migration change (the `contact_block` column already exists), so the
blast radius on existing code is nil (the one existing-file touch is an additive script
entry). Risk: **LOW**.

## 9. Non-Goals Recap (YAGNI)

No real vendor adapter, no network, no keys, no PII, no UI, no warm-path graph, no migration.
The one deliverable is a tested, pluggable enrichment pipeline that persists a well-formed
`contact_block` and leaves a clean drop-in seam for a real resolver later.
