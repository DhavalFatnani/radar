# Phase 4 Slice 4 — Contact Block / Decision-Maker Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `leads.contact_block` (jsonb) via a pluggable, injected `ContactResolver`; ship a deterministic stub resolver (every lead → `pending_enrichment`) and leave a clean drop-in seam for a real enrichment vendor later.

**Architecture:** Three layers mirroring Slice 3 and the module's existing tender-adapter seam: a PURE `contacts-schema.ts` (Zod + types + `ContactResolver` interface + `buildContactBlock`), a stub adapter in `adapters/`, an injected server data layer `contacts.ts` (`resolveContactsForLeads(db, resolver, now)`), and a runner `resolve-contacts.ts`. No `src/ai/`, no network, no keys, no migration.

**Tech Stack:** TypeScript strict, Zod, Drizzle (postgres-js), Vitest, Next.js 15.

## Global Constraints

Every task's requirements implicitly include this section. Values are verbatim from the spec.

- **Dependency boundaries (both directions):**
  - `contacts-schema.ts` imports **only** `zod`. No `@/db`, no `import "server-only"`. Client-safe.
  - `adapters/contacts-stub.ts` imports only `import type { ContactResolver } from "@/lib/sourcing/contacts-schema"`. Pure, no DB.
  - `contacts.ts` imports `@/db/client` **type-only** (`import type { DB }` — the `type` keyword is load-bearing, erased at runtime, never loads the env-eager client), `@/db/schema` for tables, pure helpers/types from `contacts-schema`, and `drizzle-orm` operators. It imports **no concrete resolver** — the resolver is injected.
  - `resolve-contacts.ts` imports `resolveContactsForLeads` + `type ResolveContactsResult` from `../lib/sourcing/contacts`, `contactsStubResolver` from `../lib/sourcing/adapters/contacts-stub`, and `import type { DB } from "./client"`.
- **Persisted `contact_block` shape (exact):** `{ decision_makers: DecisionMaker[]; status: "pending_enrichment" | "resolved"; resolvedBy: string; resolvedAt: string }`. Key casing is deliberate: `decision_makers` is snake_case (matches `mockups/leads.html contactBlock()`); `status` / `resolvedBy` / `resolvedAt` are metadata mirroring the brief blob's `generatedAt` precedent. Do not "normalize" the casing.
- **`DecisionMaker` shape (exact, matches mockup):** `{ name: string; role: string; why: string; paths: ContactPath[]; warm: WarmPath }` where `ContactPath = { type: string; val: string | null; conf: string | null; source: string | null }` and `WarmPath = { status: "warm" | "cold"; detail: string | null }`.
- **Pass-through integrity (core value thesis):** `decision_makers` is the resolver's returned array **verbatim**. The data layer adds only `status`, `resolvedBy`, `resolvedAt`. It **never** synthesizes, infers, or defaults any `name` / `role` / `why` / `path` value. An empty resolver result → `status: "pending_enrichment"`, **never** a fabricated placeholder person.
- **`buildContactBlock` rule:** `status = decisionMakers.length > 0 ? "resolved" : "pending_enrichment"`; `resolvedAt = now.toISOString()`; `now` is injected (never `new Date()` inside the assembler).
- **Selection & bounds:** scan `where isNull(leads.contactBlock)`, `limit CONTACT_LEAD_LIMIT` (`= 200`). Idempotent: a lead with any `contact_block` is not re-scanned. All queries bounded (`inArray` over the ≤200 leads' ids).
- **Write scope:** the data layer's `db.update(leads)` sets **only** `{ contactBlock }` — never `brief` / `score` / `pipelineStage` / `intent`.
- **Failure isolation:** a resolver that throws, or a lead whose company/vendor row is missing, increments `failures`, leaves that lead's `contact_block` NULL, and the batch continues. Never let one lead abort the run.
- **Result shape (exact):** `ResolveContactsResult = { leadsScanned: number; contactsResolved: number; pendingEnrichment: number; failures: number }`.
- **No LLM, no network, no secrets, no migration.** The `leads.contact_block` column already exists.
- **Code hygiene:** no `console.log` / TODO / silent empty `catch` in `src/lib` or `src/db` module code — **except** the runner's own summary `console.log`/`console.error` (the sanctioned operator interface, matching `brief-generate.ts`). Tests assert; every test has an expectation.
- **Commits:** stage explicit file paths only (never `git add .`/`-A` — keep `.DS_Store`, `AGENTS.md` unstaged). Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Pure schema + `ContactResolver` seam + stub resolver

**Files:**
- Create: `src/lib/sourcing/contacts-schema.ts`
- Create: `src/lib/sourcing/adapters/contacts-stub.ts`
- Test: `tests/unit/sourcing/contacts-schema.test.ts`

**Interfaces:**
- Produces: `contactPathSchema`, `warmPathSchema`, `decisionMakerSchema`, `contactBlockSchema` (Zod); types `ContactPath`, `WarmPath`, `DecisionMaker`, `ContactBlock`, `ContactResolutionInput`; interface `ContactResolver`; function `buildContactBlock(decisionMakers, resolvedBy, now)`; const `contactsStubResolver: ContactResolver`.
- Consumes: nothing (leaf).

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/sourcing/contacts-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildContactBlock,
  contactBlockSchema,
  type DecisionMaker,
} from "@/lib/sourcing/contacts-schema";
import { contactsStubResolver } from "@/lib/sourcing/adapters/contacts-stub";

const dm: DecisionMaker = {
  name: "Jane Doe",
  role: "VP Operations",
  why: "Owns the warehouse expansion budget",
  paths: [{ type: "email", val: "jane@acme.test", conf: "high", source: "apollo" }],
  warm: { status: "cold", detail: null },
};

describe("buildContactBlock", () => {
  it("marks an empty result pending_enrichment", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const block = buildContactBlock([], "stub", now);
    expect(block.status).toBe("pending_enrichment");
    expect(block.decision_makers).toEqual([]);
    expect(block.resolvedBy).toBe("stub");
    expect(block.resolvedAt).toBe("2026-07-03T12:00:00.000Z");
  });

  it("marks a non-empty result resolved and passes decision-makers through verbatim", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const block = buildContactBlock([dm], "apollo", now);
    expect(block.status).toBe("resolved");
    expect(block.decision_makers).toEqual([dm]);
    expect(block.resolvedBy).toBe("apollo");
  });
});

describe("contactBlockSchema", () => {
  it("accepts a valid resolved block", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const block = buildContactBlock([dm], "apollo", now);
    expect(contactBlockSchema.safeParse(block).success).toBe(true);
  });

  it("rejects a decision-maker missing a name", () => {
    const bad = {
      decision_makers: [{ role: "VP", why: "", paths: [], warm: { status: "cold", detail: null } }],
      status: "resolved",
      resolvedBy: "apollo",
      resolvedAt: "2026-07-03T12:00:00.000Z",
    };
    expect(contactBlockSchema.safeParse(bad).success).toBe(false);
  });
});

describe("contactsStubResolver", () => {
  it("resolves zero decision-makers and identifies itself", async () => {
    const out = await contactsStubResolver.resolve({
      company: { name: "Acme", description: null },
      vendor: { name: "RackPro", vendorType: "Infra" },
      intent: "Expanding capacity",
    });
    expect(out.decisionMakers).toEqual([]);
    expect(contactsStubResolver.sourceName).toBe("stub");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/sourcing/contacts-schema.test.ts`
Expected: FAIL — cannot resolve `@/lib/sourcing/contacts-schema` / `contacts-stub`.

- [ ] **Step 3: Create the pure schema module**

Create `src/lib/sourcing/contacts-schema.ts`:

```ts
import { z } from "zod";

/** One contact path (email / phone / linkedin / ...). val null = "not found / needs enrichment". */
export const contactPathSchema = z.object({
  type: z.string().min(1),
  val: z.string().nullable(),
  conf: z.string().nullable(),   // resolver confidence label, e.g. "high" / "verified"
  source: z.string().nullable(), // provenance: where the resolver got this path
});
export type ContactPath = z.infer<typeof contactPathSchema>;

/** Warm-intro status for a decision-maker. */
export const warmPathSchema = z.object({
  status: z.enum(["warm", "cold"]),
  detail: z.string().nullable(),
});
export type WarmPath = z.infer<typeof warmPathSchema>;

/** One decision-maker. Field names match mockups/leads.html contactBlock(). */
export const decisionMakerSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  why: z.string(),
  paths: z.array(contactPathSchema),
  warm: warmPathSchema,
});
export type DecisionMaker = z.infer<typeof decisionMakerSchema>;

/** Persisted shape of leads.contact_block. */
export const contactBlockSchema = z.object({
  decision_makers: z.array(decisionMakerSchema),
  status: z.enum(["pending_enrichment", "resolved"]),
  resolvedBy: z.string().min(1),
  resolvedAt: z.string(),
});
export type ContactBlock = z.infer<typeof contactBlockSchema>;

/**
 * Context a resolver needs to find the right people for a lead: the company to
 * search, and the vendor + intent that say which roles are the decision-makers.
 */
export type ContactResolutionInput = {
  company: { name: string; description: string | null };
  vendor: { name: string; vendorType: string | null };
  intent: string | null;
};

/** The extensibility seam every contact resolver implements (mirrors SourceAdapter). */
export interface ContactResolver {
  readonly sourceName: string;
  resolve(input: ContactResolutionInput): Promise<{ decisionMakers: DecisionMaker[] }>;
}

/**
 * PURE assembler of the persisted contact_block. Never synthesizes a person: an
 * empty decisionMakers array becomes status "pending_enrichment"; a non-empty one
 * becomes "resolved". decision_makers is the resolver output verbatim; only status,
 * resolvedBy, and resolvedAt are added here.
 */
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
  };
}
```

- [ ] **Step 4: Create the stub resolver**

Create `src/lib/sourcing/adapters/contacts-stub.ts`:

```ts
import type { ContactResolver } from "@/lib/sourcing/contacts-schema";

/**
 * Deterministic placeholder resolver: resolves no decision-makers, so every lead
 * lands in pending_enrichment. A real external resolver (Apollo / Clearbit / ...)
 * is a drop-in ContactResolver added later — no change to the data layer, the
 * persisted contract, or the UI.
 */
export const contactsStubResolver: ContactResolver = {
  sourceName: "stub",
  async resolve() {
    return { decisionMakers: [] };
  },
};
```

- [ ] **Step 5: Run the unit test — expect PASS**

Run: `npx vitest run tests/unit/sourcing/contacts-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Verify client-safety and typecheck**

Run: `grep -nE "@/db|server-only" src/lib/sourcing/contacts-schema.ts src/lib/sourcing/adapters/contacts-stub.ts` → expect **no output**.
Run: `npx tsc --noEmit` → expect clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sourcing/contacts-schema.ts src/lib/sourcing/adapters/contacts-stub.ts tests/unit/sourcing/contacts-schema.test.ts
git commit -m "feat(sourcing): pure ContactResolver seam + stub resolver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Server data layer `resolveContactsForLeads`

**Files:**
- Create: `src/lib/sourcing/contacts.ts`
- Test: `tests/integration/sourcing-contacts.test.ts`

**Interfaces:**
- Consumes (Task 1): `buildContactBlock`, types `ContactResolver`, `ContactResolutionInput`, `DecisionMaker`.
- Consumes (existing schema): `leads` (`leadId`, `companyId`, `vendorId`, `intent`, `contactBlock`), `companies` (`companyId`, `name`, `description`), `vendorProfiles` (`vendorId`, `name`, `vendorType`).
- Produces: `resolveContactsForLeads(db, resolver, now?)`, type `ResolveContactsResult`, const `CONTACT_LEAD_LIMIT`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/sourcing-contacts.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { companies, vendorProfiles, leads } from "@/db/schema";
import { resolveContactsForLeads } from "@/lib/sourcing/contacts";
import type { ContactResolver, DecisionMaker } from "@/lib/sourcing/contacts-schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["leads", "vendor_profiles", "companies"]); });
afterAll(async () => { await closeTestDb(); });

const NOW = new Date("2026-07-03T12:00:00.000Z");

async function makeCompany(name: string): Promise<string> {
  const [c] = await testDb.insert(companies).values({ name, normalizedName: name.toLowerCase() }).returning();
  return c.companyId;
}
async function makeVendor(name: string, vendorType: string | null): Promise<string> {
  const [v] = await testDb.insert(vendorProfiles).values({ name, vendorType }).returning();
  return v.vendorId;
}
async function makeLead(companyId: string, vendorId: string, intent: string): Promise<string> {
  const [l] = await testDb.insert(leads).values({ companyId, vendorId, intent }).returning();
  return l.leadId;
}

const emptyResolver: ContactResolver = {
  sourceName: "stub",
  async resolve() { return { decisionMakers: [] }; },
};

const dm: DecisionMaker = {
  name: "Jane Doe",
  role: "VP Operations",
  why: "Owns the expansion budget",
  paths: [{ type: "email", val: "jane@acme.test", conf: "high", source: "test" }],
  warm: { status: "warm", detail: "intro via mutual client" },
};
const dmResolver: ContactResolver = {
  sourceName: "test-apollo",
  async resolve() { return { decisionMakers: [dm] }; },
};

describe("resolveContactsForLeads", () => {
  it("persists an empty result as pending_enrichment with resolver metadata", async () => {
    const companyId = await makeCompany("Acme");
    const vendorId = await makeVendor("RackPro", "Infra");
    await makeLead(companyId, vendorId, "Expanding capacity");

    const res = await resolveContactsForLeads(testDb, emptyResolver, NOW);
    expect(res).toEqual({ leadsScanned: 1, contactsResolved: 0, pendingEnrichment: 1, failures: 0 });

    const [lead] = await testDb.select().from(leads);
    const block = lead.contactBlock as {
      status: string; decision_makers: unknown[]; resolvedBy: string; resolvedAt: string;
    };
    expect(block.status).toBe("pending_enrichment");
    expect(block.decision_makers).toEqual([]);
    expect(block.resolvedBy).toBe("stub");
    expect(block.resolvedAt).toBe("2026-07-03T12:00:00.000Z");
  });

  it("persists resolved decision-makers verbatim", async () => {
    const companyId = await makeCompany("Acme");
    const vendorId = await makeVendor("RackPro", "Infra");
    await makeLead(companyId, vendorId, "Expanding capacity");

    const res = await resolveContactsForLeads(testDb, dmResolver, NOW);
    expect(res).toEqual({ leadsScanned: 1, contactsResolved: 1, pendingEnrichment: 0, failures: 0 });

    const [lead] = await testDb.select().from(leads);
    const block = lead.contactBlock as { status: string; resolvedBy: string; decision_makers: DecisionMaker[] };
    expect(block.status).toBe("resolved");
    expect(block.resolvedBy).toBe("test-apollo");
    expect(block.decision_makers).toEqual([dm]);
  });

  it("is idempotent — a second run scans no already-resolved leads", async () => {
    const companyId = await makeCompany("Acme");
    const vendorId = await makeVendor("RackPro", "Infra");
    await makeLead(companyId, vendorId, "Expanding capacity");

    const first = await resolveContactsForLeads(testDb, emptyResolver, NOW);
    expect(first.leadsScanned).toBe(1);
    const second = await resolveContactsForLeads(testDb, emptyResolver, NOW);
    expect(second.leadsScanned).toBe(0);
  });

  it("isolates a resolver failure and still resolves other leads", async () => {
    const boomCo = await makeCompany("Boom");
    const goodCo = await makeCompany("Good");
    const vendorId = await makeVendor("RackPro", "Infra");
    await makeLead(boomCo, vendorId, "x");
    await makeLead(goodCo, vendorId, "y");

    const selective: ContactResolver = {
      sourceName: "selective",
      async resolve(input) {
        if (input.company.name === "Boom") throw new Error("resolver down");
        return { decisionMakers: [dm] };
      },
    };

    const res = await resolveContactsForLeads(testDb, selective, NOW);
    expect(res.failures).toBe(1);
    expect(res.contactsResolved).toBe(1);

    const rows = await testDb.select().from(leads);
    const boom = rows.find((r) => r.companyId === boomCo)!;
    const good = rows.find((r) => r.companyId === goodCo)!;
    expect(boom.contactBlock).toBeNull();
    expect((good.contactBlock as { status: string }).status).toBe("resolved");
  });

  it("does not re-scan a lead that already has a contact_block", async () => {
    const companyId = await makeCompany("Acme");
    const vendorId = await makeVendor("RackPro", "Infra");
    const leadId = await makeLead(companyId, vendorId, "Expanding capacity");
    const existing = {
      decision_makers: [], status: "resolved", resolvedBy: "manual", resolvedAt: "2020-01-01T00:00:00.000Z",
    };
    await testDb.update(leads).set({ contactBlock: existing }).where(eq(leads.leadId, leadId));

    const res = await resolveContactsForLeads(testDb, dmResolver, NOW);
    expect(res.leadsScanned).toBe(0);

    const [lead] = await testDb.select().from(leads);
    expect((lead.contactBlock as { resolvedBy: string }).resolvedBy).toBe("manual"); // untouched
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/integration/sourcing-contacts.test.ts`
Expected: FAIL — cannot resolve `@/lib/sourcing/contacts`.

- [ ] **Step 3: Implement the data layer**

Create `src/lib/sourcing/contacts.ts`:

```ts
import { eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — erased at runtime, never loads the env-eager client
import { leads, companies, vendorProfiles } from "@/db/schema";
import {
  buildContactBlock,
  type ContactResolver,
  type ContactResolutionInput,
} from "@/lib/sourcing/contacts-schema";

export type ResolveContactsResult = {
  leadsScanned: number;      // leads with contact_block IS NULL processed this run
  contactsResolved: number;  // blocks written with status "resolved" (resolver returned >=1 DM)
  pendingEnrichment: number; // blocks written with status "pending_enrichment" (resolver returned 0)
  failures: number;          // resolver threw or a company/vendor row was missing → lead left NULL
};

export const CONTACT_LEAD_LIMIT = 200;

/**
 * Populate leads.contact_block for un-resolved leads by delegating to an injected
 * ContactResolver. Pass-through integrity: decision_makers is the resolver output
 * verbatim; the data layer adds only status / resolvedBy / resolvedAt. A resolver
 * that throws (or a lead with a missing company/vendor row) counts in `failures`,
 * leaves that lead's contact_block NULL, and the batch continues. Idempotent via the
 * isNull(contact_block) selection. `now` is injected so persisted timestamps are testable.
 */
export async function resolveContactsForLeads(
  db: DB,
  resolver: ContactResolver,
  now: Date = new Date(),
): Promise<ResolveContactsResult> {
  const pending = await db
    .select({
      leadId: leads.leadId,
      companyId: leads.companyId,
      vendorId: leads.vendorId,
      intent: leads.intent,
    })
    .from(leads)
    .where(isNull(leads.contactBlock))
    .limit(CONTACT_LEAD_LIMIT);

  const result: ResolveContactsResult = {
    leadsScanned: pending.length,
    contactsResolved: 0,
    pendingEnrichment: 0,
    failures: 0,
  };
  if (pending.length === 0) return result;

  const companyIds = [...new Set(pending.map((l) => l.companyId))];
  const vendorIds = [...new Set(pending.map((l) => l.vendorId))];

  const companyRows = await db
    .select({ companyId: companies.companyId, name: companies.name, description: companies.description })
    .from(companies)
    .where(inArray(companies.companyId, companyIds));
  const vendorRows = await db
    .select({ vendorId: vendorProfiles.vendorId, name: vendorProfiles.name, vendorType: vendorProfiles.vendorType })
    .from(vendorProfiles)
    .where(inArray(vendorProfiles.vendorId, vendorIds));

  const companyById = new Map(companyRows.map((c) => [c.companyId, c]));
  const vendorById = new Map(vendorRows.map((v) => [v.vendorId, v]));

  for (const lead of pending) {
    const company = companyById.get(lead.companyId);
    const vendor = vendorById.get(lead.vendorId);
    if (!company || !vendor) {
      result.failures++;
      continue;
    }

    const input: ContactResolutionInput = {
      company: { name: company.name, description: company.description ?? null },
      vendor: { name: vendor.name, vendorType: vendor.vendorType ?? null },
      intent: lead.intent ?? null,
    };

    let decisionMakers;
    try {
      ({ decisionMakers } = await resolver.resolve(input));
    } catch {
      result.failures++;
      continue;
    }

    const block = buildContactBlock(decisionMakers, resolver.sourceName, now);
    await db.update(leads).set({ contactBlock: block }).where(eq(leads.leadId, lead.leadId));

    if (block.status === "resolved") result.contactsResolved++;
    else result.pendingEnrichment++;
  }

  return result;
}
```

- [ ] **Step 4: Run the integration test — expect PASS**

Run: `npx vitest run tests/integration/sourcing-contacts.test.ts`
Expected: PASS (5 tests). (Transient Neon TRUNCATE latency can fail a run — re-run 2-3× before investigating.)

- [ ] **Step 5: Verify boundary and typecheck**

Run: `grep -nE "server-only|@/ai|@/lib/sourcing/adapters" src/lib/sourcing/contacts.ts` → expect **no output** (no concrete resolver import, no server-only, no ai).
Run: `grep -n "import type { DB }" src/lib/sourcing/contacts.ts` → expect the type-only DB import present.
Run: `npx tsc --noEmit` → expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sourcing/contacts.ts tests/integration/sourcing-contacts.test.ts
git commit -m "feat(sourcing): resolveContactsForLeads data layer (injected resolver)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Runner + `db:contacts:resolve` script + end-to-end

**Files:**
- Create: `src/db/resolve-contacts.ts`
- Modify: `package.json` (add exactly one script line after `db:brief:generate`)

**Interfaces:**
- Consumes (Task 2): `resolveContactsForLeads`, `type ResolveContactsResult` from `../lib/sourcing/contacts`.
- Consumes (Task 1): `contactsStubResolver` from `../lib/sourcing/adapters/contacts-stub`.
- Produces: `runContactResolution(db)`, `npm run db:contacts:resolve`.

- [ ] **Step 1: Create the runner (line-for-line mirror of `src/db/brief-generate.ts`)**

Create `src/db/resolve-contacts.ts`:

```ts
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import type { DB } from "./client";
import { contactsStubResolver } from "../lib/sourcing/adapters/contacts-stub";
import { resolveContactsForLeads, type ResolveContactsResult } from "../lib/sourcing/contacts";

/**
 * On-demand contact-resolution run: populate leads.contact_block for every lead that
 * does not have one yet, delegating to the injected resolver. The caller owns the
 * connection lifecycle. The stub resolves no contacts (every lead → pending_enrichment);
 * a real enrichment vendor is a drop-in ContactResolver swapped in here later.
 */
export async function runContactResolution(db: DB): Promise<ResolveContactsResult> {
  return resolveContactsForLeads(db, contactsStubResolver);
}

// Allow `npm run db:contacts:resolve` to execute directly.
if (process.argv[1] && process.argv[1].endsWith("resolve-contacts.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:contacts:resolve");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  runContactResolution(db)
    .then((result) => {
      console.log("Contact resolution complete:", JSON.stringify(result));
      return client.end();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Contact resolution failed:", e);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add exactly one line immediately after the `"db:brief:generate"` line (keep JSON valid — the preceding line needs its trailing comma):

```json
    "db:contacts:resolve": "tsx src/db/resolve-contacts.ts",
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: End-to-end run against the dev DB**

First ensure there are leads to scan (Slice 2 output). If the DB has no leads, run `npm run db:source:leads` first (it is itself idempotent). Then:

Run: `npm run db:contacts:resolve`
Expected: exit 0, one summary line like
`Contact resolution complete: {"leadsScanned":N,"contactsResolved":0,"pendingEnrichment":N,"failures":0}`
(With the stub, `contactsResolved` is 0 and every scanned lead is `pendingEnrichment`. `leadsScanned:0` is also acceptable if every lead already has a block — idempotency.) A resolved-branch outcome is not expected from the stub; it is proven by Task 2's integration tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/resolve-contacts.ts package.json
git commit -m "feat(sourcing): db:contacts:resolve runner wiring the stub resolver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 pure schema + seam + `buildContactBlock` → Task 1 (`contacts-schema.ts`). ✅
- §3.2 stub resolver → Task 1 (`adapters/contacts-stub.ts`). ✅
- §3.3 data layer flow (select isNull, batch-load company/vendor, per-lead resolve, pass-through, write only contactBlock, failure isolation) → Task 2 (`contacts.ts`). ✅
- §3.4 runner + `db:contacts:resolve` → Task 3. ✅
- §6 all unit + integration cases → Task 1 (4) + Task 2 (5). ✅
- §7 dependency boundaries → Global Constraints + Task 1 Step 6 / Task 2 Step 5 greps. ✅

**2. Placeholder scan:** no TBD/TODO; every step has concrete code or an exact command + expected output. ✅

**3. Type consistency:** `ResolveContactsResult` fields identical in Task 2 code, its test `toEqual`, and Task 3 import. `buildContactBlock(decisionMakers, resolvedBy, now)` arg order identical across schema, unit test, and data layer. `ContactResolver` = `{ sourceName; resolve(input) → { decisionMakers } }` identical across schema, stub, tests, data layer, runner. `contactBlock` column write is `{ contactBlock: block }` (Drizzle camel property) consistent with the schema's `contactBlock`/`contact_block` mapping. ✅

**Impact / risk:** purely additive (4 new files + 1 `package.json` line). No existing symbol modified; no schema/migration (the `contact_block` column already exists). Blast radius on existing code: nil. Risk **LOW** — GitNexus `impact` N/A (no symbol edited).

**Post-merge:** run `node .gitnexus/run.cjs analyze` to re-index the new modules.
