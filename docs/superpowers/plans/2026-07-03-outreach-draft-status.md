# Outreach Slice A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/leads/[id]`, let the operator pick an outreach mode, generate an LLM-drafted outreach message from the lead's reverse brief, and track its status (pending → drafted → sent) — all internal, no external send.

**Architecture:** Mirror the shipped pipeline/leads layering exactly: an additive DB migration adds outreach state to `leads`; a pure client-safe `src/lib/outreach/schema.ts` owns the status model + draft Zod validator; an injected-`DB` `src/lib/outreach/data.ts` owns the three writes; a DB-free `src/ai/outreach/` mirrors `src/ai/brief/` and produces `{subject, body}`; auth-gated server actions in `src/app/(app)/leads/actions.ts` orchestrate AI + DB; and a `"use client"` `OutreachPanel` mirrors `StageControls` (`useTransition` + `router.refresh()`).

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Drizzle ORM + postgres-js on Neon, drizzle-kit migrations, NextAuth v5 (`auth()`), Vercel AI SDK via `@/ai/llm`, Zod, Vitest (node + jsdom via `@vitejs/plugin-react`), Testing Library.

## Global Constraints

- Data-module split: pure `src/lib/outreach/schema.ts` (no `@/db`, no `server-only`, no `@/ai` value imports) + server `src/lib/outreach/data.ts`.
- Injected-DB data layer uses `import type { DB }` (type-only, load-bearing).
- `src/ai/outreach/` has **no** DB access — orchestration lives in the action layer, which injects nothing into `@/ai` and imports `@/ai` only in the action, never in `src/lib/*/data.ts`.
- Mobile-first (375 → 768 → 1280), semantic HTML, keyboard-native controls, focus states.
- No `console.log`, no TODOs, no silent empty catches; explicit error handling; no stack traces to the client.
- Parameterized queries only; validate inputs.
- Tests live in the mirroring test dir; every new pure function is unit-tested.
- Additive only — new `src/lib/outreach/*`, new `src/ai/outreach/*`, new `src/app/(app)/leads/[id]/outreach-panel.tsx`, new `src/app/(app)/leads/actions.ts`, appended CSS, plus additive edits to `src/db/schema/{enums,leads}.ts`, `src/lib/leads/{schema,data}.ts` (extend `LeadDetail` + `getLeadDetail`), and `src/app/(app)/leads/[id]/page.tsx` (insert the panel). No edits to shipped pipeline/AI-brief modules.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Commit discipline (every task):** stage only the explicit paths named in that task's **Files** block — `git add <path> <path>`. NEVER `git add .` or `git add -A`. For any CSS change, append to the END of `src/app/styles/components.css` and verify `git diff --stat src/app/styles/components.css` shows insertions and `-0` deletions before committing.

---

## Task 1: Migration + schema (add outreach state to `leads`)

**Files:**
- Modify: `src/db/schema/enums.ts` (add `outreachStatus` pgEnum after the `outreachMode` line, ~line 22)
- Modify: `src/db/schema/leads.ts` (add four columns after `outreachMode`, ~line 15)
- Create: `src/db/migrations/00NN_<generated-name>.sql` (produced by `npm run db:generate` — do NOT hand-write)
- Test: `tests/integration/outreach-migration.test.ts`

**Interfaces:**
- Consumes: existing `leads` pgTable and `pipelineStage`/`outreachMode` enums from `src/db/schema`.
- Produces (relied on by every later task): DB enum `outreach_status` with values `["pending","drafted","sent"]`; `leads` columns — `outreachStatus` (`outreach_status`, NOT NULL, DEFAULT `'pending'`), `outreachDraft` (jsonb, nullable), `outreachDraftGeneratedAt` (timestamptz, nullable), `outreachSentAt` (timestamptz, nullable). Drizzle field names: `leads.outreachStatus`, `leads.outreachDraft`, `leads.outreachDraftGeneratedAt`, `leads.outreachSentAt`.

Note: `npm run db:migrate` applies to the real Neon dev DB. This migration is purely additive — the one NOT NULL column carries a default so existing rows backfill to `'pending'`; no column drops, no data loss.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/outreach-migration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { leads, companies, vendorProfiles } from "@/db/schema";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
});

describe("outreach columns migration", () => {
  it("defaults outreachStatus to 'pending' and round-trips the new columns", async () => {
    const [company] = await testDb
      .insert(companies)
      .values({ name: "Zephyr Retail", normalizedName: "zephyr retail" })
      .returning();
    const [vendor] = await testDb
      .insert(vendorProfiles)
      .values({ name: "Acme Infra" })
      .returning();

    const [inserted] = await testDb
      .insert(leads)
      .values({ companyId: company.companyId, vendorId: vendor.vendorId })
      .returning();

    // NOT NULL default backfills to "pending"; the three timestamps/jsonb are null.
    expect(inserted.outreachStatus).toBe("pending");
    expect(inserted.outreachDraft).toBeNull();
    expect(inserted.outreachDraftGeneratedAt).toBeNull();
    expect(inserted.outreachSentAt).toBeNull();

    const generatedAt = new Date("2026-07-03T10:00:00.000Z");
    const sentAt = new Date("2026-07-03T11:00:00.000Z");
    await testDb
      .update(leads)
      .set({
        outreachStatus: "sent",
        outreachDraft: { subject: "Hello", body: "World" },
        outreachDraftGeneratedAt: generatedAt,
        outreachSentAt: sentAt,
      })
      .where(eq(leads.leadId, inserted.leadId));

    const [read] = await testDb
      .select()
      .from(leads)
      .where(eq(leads.leadId, inserted.leadId));
    expect(read.outreachStatus).toBe("sent");
    expect(read.outreachDraft).toEqual({ subject: "Hello", body: "World" });
    expect(read.outreachDraftGeneratedAt?.getTime()).toBe(generatedAt.getTime());
    expect(read.outreachSentAt?.getTime()).toBe(sentAt.getTime());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/outreach-migration.test.ts`
Expected: FAIL — TypeScript/Drizzle errors that `outreachStatus`, `outreachDraft`, `outreachDraftGeneratedAt`, `outreachSentAt` do not exist on the `leads` insert/select shape (the columns are not defined yet).

- [ ] **Step 3: Add the enum**

In `src/db/schema/enums.ts`, immediately after the existing `outreachMode` line (`export const outreachMode = pgEnum("outreach_mode", ...);`) add:

```typescript
export const outreachStatus = pgEnum("outreach_status", ["pending", "drafted", "sent"]);
```

- [ ] **Step 4: Add the columns**

In `src/db/schema/leads.ts`, import the new enum and add four columns. Change the enums import line:

```typescript
import { pipelineStage, outreachMode, outreachStatus } from "./enums";
```

Then, inside `pgTable("leads", { ... })`, add these four lines immediately after the `outreachMode: outreachMode("outreach_mode"),` line:

```typescript
  outreachStatus: outreachStatus("outreach_status").notNull().default("pending"),
  outreachDraft: jsonb("outreach_draft"),                        // { subject, body }
  outreachDraftGeneratedAt: timestamp("outreach_draft_generated_at", { withTimezone: true }),
  outreachSentAt: timestamp("outreach_sent_at", { withTimezone: true }),
```

(`jsonb` and `timestamp` are already imported at the top of the file.)

- [ ] **Step 5: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate
```

`db:generate` writes a numbered SQL file (`src/db/migrations/00NN_<name>.sql`) plus a snapshot under `src/db/migrations/meta/`. `db:migrate` applies it to the dev DB (reads `DIRECT_URL ?? DATABASE_URL`). Confirm the generated SQL is additive: an `ALTER TABLE "leads" ADD COLUMN ...` per new column and a `CREATE TYPE "public"."outreach_status" AS ENUM('pending', 'drafted', 'sent')` — no `DROP`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/outreach-migration.test.ts`
Expected: PASS (2 assertions groups; the migrate in `beforeAll` now creates the columns, so the round-trip succeeds).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/enums.ts src/db/schema/leads.ts src/db/migrations tests/integration/outreach-migration.test.ts
git commit -m "feat(db): add outreach status/draft/timestamps to leads

Additive migration: outreach_status enum (pending|drafted|sent) plus four
leads columns. NOT NULL status defaults to 'pending' so existing rows backfill.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Pure outreach domain module (`src/lib/outreach/schema.ts`)

**Files:**
- Create: `src/lib/outreach/schema.ts`
- Test: `tests/unit/outreach/schema.test.ts`

**Interfaces:**
- Consumes: `zod` only. No `@/db`, no `server-only`, no `@/ai` value imports (client-safe).
- Produces (relied on by Tasks 3, 5, 6):
  - `type OutreachStatus = "pending" | "drafted" | "sent"`
  - `const OUTREACH_STATUSES: readonly OutreachStatus[]`
  - `const OUTREACH_STATUS_LABELS: Record<OutreachStatus, string>`
  - `type OutreachDraft = { subject: string; body: string }`
  - `const outreachDraftSchema: z.ZodType<OutreachDraft>` (both fields non-empty)
  - `function canMarkSent(status: OutreachStatus): boolean`
  - `function nextStatuses(status: OutreachStatus): OutreachStatus[]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/outreach/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  OUTREACH_STATUSES,
  OUTREACH_STATUS_LABELS,
  outreachDraftSchema,
  canMarkSent,
  nextStatuses,
  type OutreachStatus,
} from "@/lib/outreach/schema";

const ENUM_ORDER: OutreachStatus[] = ["pending", "drafted", "sent"];

describe("outreach status model", () => {
  it("OUTREACH_STATUSES mirrors the DB enum exactly and in order", () => {
    expect([...OUTREACH_STATUSES]).toEqual(ENUM_ORDER);
  });

  it("OUTREACH_STATUS_LABELS provides a non-empty label for every status", () => {
    for (const s of OUTREACH_STATUSES) {
      expect(OUTREACH_STATUS_LABELS[s]).toBeTruthy();
    }
  });

  it("canMarkSent is true for pending and drafted, false for sent", () => {
    expect(canMarkSent("pending")).toBe(true);
    expect(canMarkSent("drafted")).toBe(true);
    expect(canMarkSent("sent")).toBe(false);
  });

  it("nextStatuses returns the legal forward targets per status", () => {
    expect(nextStatuses("pending")).toEqual(["drafted", "sent"]);
    expect(nextStatuses("drafted")).toEqual(["sent"]);
    expect(nextStatuses("sent")).toEqual([]);
  });
});

describe("outreachDraftSchema", () => {
  it("accepts a well-formed draft", () => {
    const r = outreachDraftSchema.safeParse({ subject: "Hi", body: "Let's talk." });
    expect(r.success).toBe(true);
  });

  it("rejects an empty subject", () => {
    expect(outreachDraftSchema.safeParse({ subject: "", body: "x" }).success).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(outreachDraftSchema.safeParse({ subject: "x", body: "" }).success).toBe(false);
  });

  it("rejects a missing field", () => {
    expect(outreachDraftSchema.safeParse({ subject: "x" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/outreach/schema.test.ts`
Expected: FAIL — `Cannot find module '@/lib/outreach/schema'` (the module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/outreach/schema.ts`:

```typescript
// Pure outreach-status domain model. Mirrors the outreach_status enum in
// src/db/schema/enums.ts. No imports from @/db, @/ai, or server-only — safe to
// import from client components and tests. Mirrors the pipeline schema precedent.
import { z } from "zod";

// Enum union — mirror src/db/schema/enums.ts outreachStatus EXACTLY, same order.
export const OUTREACH_STATUSES = ["pending", "drafted", "sent"] as const;

export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

// Human-readable labels for display.
export const OUTREACH_STATUS_LABELS: Record<OutreachStatus, string> = {
  pending: "Not started",
  drafted: "Draft ready",
  sent: "Sent",
};

// The current draft persisted to leads.outreach_draft and produced by the LLM.
export type OutreachDraft = {
  subject: string;
  body: string;
};

// Read-validator for the persisted draft: both fields must be non-empty. Kept
// structurally identical to src/ai/outreach/schema.ts's outreachDraftSchema (the
// one-directional src/lib -> src/ai type-only dependency is never inverted).
export const outreachDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

// Legal forward moves. A draft can be marked sent; a sent lead is terminal.
// "pending -> sent" is allowed (operator sent manually without generating here).
const ALLOWED: Record<OutreachStatus, OutreachStatus[]> = {
  pending: ["drafted", "sent"],
  drafted: ["sent"],
  sent: [],
};

export function nextStatuses(status: OutreachStatus): OutreachStatus[] {
  return ALLOWED[status] ?? [];
}

export function canMarkSent(status: OutreachStatus): boolean {
  return nextStatuses(status).includes("sent");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/outreach/schema.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/outreach/schema.ts tests/unit/outreach/schema.test.ts
git commit -m "feat(outreach): pure status model + draft validator

OutreachStatus, labels, canMarkSent/nextStatuses guards, and the
outreachDraftSchema read-validator. Client-safe; no @/db, @/ai, or server-only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Data layer — outreach writes + extend `getLeadDetail`

**Files:**
- Create: `src/lib/outreach/data.ts`
- Modify: `src/lib/leads/schema.ts` (extend `LeadDetail`, import `OutreachStatus`/`OutreachDraft`)
- Modify: `src/lib/leads/data.ts` (select + parse the new columns in `getLeadDetail`)
- Test: `tests/integration/outreach-data.test.ts`
- Test: `tests/integration/leads-data.test.ts` (extend)

**Interfaces:**
- Consumes: `OutreachDraft`, `OutreachStatus`, `outreachDraftSchema` from `@/lib/outreach/schema` (Task 2); `OutreachMode` from `@/lib/leads/schema`; `type DB` from `@/db/client`; `leads` from `@/db/schema` (Task 1 columns).
- Produces (relied on by Task 5 and Task 6):
  - `setOutreachMode(db: DB, leadId: string, mode: OutreachMode): Promise<{ ok: true } | { ok: false; error: string }>`
  - `saveOutreachDraft(db: DB, leadId: string, draft: OutreachDraft): Promise<{ ok: true } | { ok: false; error: string }>` — sets `outreachDraft`, `outreachStatus = "drafted"`, `outreachDraftGeneratedAt = new Date()`.
  - `setOutreachStatus(db: DB, leadId: string, status: OutreachStatus): Promise<{ ok: true } | { ok: false; error: string }>` — when `status === "sent"`, also sets `outreachSentAt = new Date()`.
  - Extended `LeadDetail` (relied on by Task 5 to build `OutreachInput` and Task 6 for props): adds `outreachStatus: OutreachStatus`, `outreachDraft: OutreachDraft | null`, `outreachDraftGeneratedAt: Date | null`, `outreachSentAt: Date | null`.

- [ ] **Step 1: Write the failing data-layer test**

Create `tests/integration/outreach-data.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { leads, companies, vendorProfiles } from "@/db/schema";
import {
  setOutreachMode,
  saveOutreachDraft,
  setOutreachStatus,
} from "@/lib/outreach/data";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
});

async function makeLead(): Promise<string> {
  const [company] = await testDb
    .insert(companies)
    .values({ name: "Zephyr Retail", normalizedName: "zephyr retail" })
    .returning();
  const [vendor] = await testDb
    .insert(vendorProfiles)
    .values({ name: "Acme Infra" })
    .returning();
  const [lead] = await testDb
    .insert(leads)
    .values({ companyId: company.companyId, vendorId: vendor.vendorId })
    .returning();
  return lead.leadId;
}

const BAD_UUID = "not-a-uuid";

describe("setOutreachMode", () => {
  it("persists the mode", async () => {
    const leadId = await makeLead();
    const r = await setOutreachMode(testDb, leadId, "handed_to_vendor");
    expect(r.ok).toBe(true);
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachMode).toBe("handed_to_vendor");
  });

  it("rejects a malformed id without writing", async () => {
    const r = await setOutreachMode(testDb, BAD_UUID, "operator_handles");
    expect(r).toEqual({ ok: false, error: "Lead not found." });
  });
});

describe("saveOutreachDraft", () => {
  it("sets the draft, status 'drafted', and generatedAt", async () => {
    const leadId = await makeLead();
    const r = await saveOutreachDraft(testDb, leadId, { subject: "Hi", body: "Let's talk." });
    expect(r.ok).toBe(true);
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachDraft).toEqual({ subject: "Hi", body: "Let's talk." });
    expect(row.outreachStatus).toBe("drafted");
    expect(row.outreachDraftGeneratedAt).toBeInstanceOf(Date);
    expect(row.outreachSentAt).toBeNull();
  });

  it("rejects a malformed id without writing", async () => {
    const r = await saveOutreachDraft(testDb, BAD_UUID, { subject: "Hi", body: "x" });
    expect(r).toEqual({ ok: false, error: "Lead not found." });
  });
});

describe("setOutreachStatus", () => {
  it("stamps sentAt when moving to 'sent'", async () => {
    const leadId = await makeLead();
    const r = await setOutreachStatus(testDb, leadId, "sent");
    expect(r.ok).toBe(true);
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachStatus).toBe("sent");
    expect(row.outreachSentAt).toBeInstanceOf(Date);
  });

  it("does not stamp sentAt for a non-sent status", async () => {
    const leadId = await makeLead();
    const r = await setOutreachStatus(testDb, leadId, "drafted");
    expect(r.ok).toBe(true);
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachStatus).toBe("drafted");
    expect(row.outreachSentAt).toBeNull();
  });

  it("rejects a malformed id without writing", async () => {
    const r = await setOutreachStatus(testDb, BAD_UUID, "sent");
    expect(r).toEqual({ ok: false, error: "Lead not found." });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/outreach-data.test.ts`
Expected: FAIL — `Cannot find module '@/lib/outreach/data'`.

- [ ] **Step 3: Write the data-layer module**

Create `src/lib/outreach/data.ts`:

```typescript
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — a value import would eagerly open Postgres
import { leads } from "@/db/schema";
import type { OutreachMode } from "@/lib/leads/schema";
import type { OutreachDraft, OutreachStatus } from "@/lib/outreach/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = { ok: true } | { ok: false; error: string };

/** Set the operator's outreach posture. Caller owns the connection. */
export async function setOutreachMode(
  db: DB,
  leadId: string,
  mode: OutreachMode,
): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  await db.update(leads).set({ outreachMode: mode }).where(eq(leads.leadId, leadId));
  return { ok: true };
}

/**
 * Persist a generated draft: sets the draft payload, moves status to "drafted",
 * and stamps the generation time. Caller owns the connection.
 */
export async function saveOutreachDraft(
  db: DB,
  leadId: string,
  draft: OutreachDraft,
): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  await db
    .update(leads)
    .set({
      outreachDraft: draft,
      outreachStatus: "drafted",
      outreachDraftGeneratedAt: new Date(),
    })
    .where(eq(leads.leadId, leadId));
  return { ok: true };
}

/**
 * Set the outreach status. Moving to "sent" also stamps outreachSentAt.
 * Caller owns the connection.
 */
export async function setOutreachStatus(
  db: DB,
  leadId: string,
  status: OutreachStatus,
): Promise<Result> {
  if (!UUID_RE.test(leadId)) return { ok: false, error: "Lead not found." };
  await db
    .update(leads)
    .set({
      outreachStatus: status,
      ...(status === "sent" ? { outreachSentAt: new Date() } : {}),
    })
    .where(eq(leads.leadId, leadId));
  return { ok: true };
}
```

- [ ] **Step 4: Run the data-layer test to verify it passes**

Run: `npx vitest run tests/integration/outreach-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `getLeadDetail` extension test**

Append these two cases to `tests/integration/leads-data.test.ts`. First, extend the `makeLead` helper's `opts` type and `.values(...)` to accept the outreach columns — replace the existing `makeLead` function (lines ~30-52) with:

```typescript
async function makeLead(opts: {
  companyId: string;
  vendorId: string;
  intent?: string | null;
  score?: number | null;
  stage?: PipelineStage;
  brief?: unknown;
  contactBlock?: unknown;
  outreachStatus?: "pending" | "drafted" | "sent";
  outreachDraft?: unknown;
}): Promise<string> {
  const [row] = await testDb
    .insert(leads)
    .values({
      companyId: opts.companyId,
      vendorId: opts.vendorId,
      intent: opts.intent ?? null,
      score: opts.score ?? null,
      pipelineStage: opts.stage ?? "sourced",
      brief: opts.brief ?? null,
      contactBlock: opts.contactBlock ?? null,
      outreachStatus: opts.outreachStatus ?? "pending",
      outreachDraft: opts.outreachDraft ?? null,
    })
    .returning();
  return row.leadId;
}
```

Then add a new `describe` block at the end of the file (after the existing `describe("getLeadDetail", ...)` closes):

```typescript
describe("getLeadDetail — outreach columns", () => {
  it("surfaces a valid outreach draft and status", async () => {
    const companyId = await makeCompany("Zephyr Retail");
    const vendorId = await makeVendor("Acme Infra");
    const leadId = await makeLead({
      companyId,
      vendorId,
      outreachStatus: "drafted",
      outreachDraft: { subject: "Hello", body: "Let's talk." },
    });

    const detail = await getLeadDetail(testDb, leadId);
    expect(detail).not.toBeNull();
    expect(detail!.outreachStatus).toBe("drafted");
    expect(detail!.outreachDraft).toEqual({ subject: "Hello", body: "Let's talk." });
  });

  it("degrades a malformed outreach draft to null with status intact", async () => {
    const companyId = await makeCompany("Vantage Foods");
    const vendorId = await makeVendor("Acme Infra");
    const leadId = await makeLead({
      companyId,
      vendorId,
      outreachStatus: "drafted",
      outreachDraft: { subject: "" }, // empty subject + missing body -> invalid
    });

    const detail = await getLeadDetail(testDb, leadId);
    expect(detail).not.toBeNull();
    expect(detail!.outreachDraft).toBeNull();
    expect(detail!.outreachStatus).toBe("drafted");
  });

  it("defaults a fresh lead to status 'pending' with a null draft", async () => {
    const companyId = await makeCompany("Meridian Logistics");
    const vendorId = await makeVendor("Beacon Marketing");
    const leadId = await makeLead({ companyId, vendorId });

    const detail = await getLeadDetail(testDb, leadId);
    expect(detail!.outreachStatus).toBe("pending");
    expect(detail!.outreachDraft).toBeNull();
    expect(detail!.outreachDraftGeneratedAt).toBeNull();
    expect(detail!.outreachSentAt).toBeNull();
  });
});
```

- [ ] **Step 6: Run the extended test to verify it fails**

Run: `npx vitest run tests/integration/leads-data.test.ts`
Expected: FAIL — TypeScript errors that `outreachStatus`, `outreachDraft`, `outreachDraftGeneratedAt`, `outreachSentAt` do not exist on `LeadDetail` (and the `detail!.outreach*` reads don't compile).

- [ ] **Step 7: Extend `LeadDetail` in `src/lib/leads/schema.ts`**

Add an import for the outreach types near the top (after the existing `import type { PipelineStage }` line):

```typescript
import type { OutreachStatus, OutreachDraft } from "@/lib/outreach/schema";
```

Then, inside the `LeadDetail` type, add these four fields immediately after the existing `outreachMode: OutreachMode | null;` line:

```typescript
  outreachStatus: OutreachStatus;
  outreachDraft: OutreachDraft | null;
  outreachDraftGeneratedAt: Date | null;
  outreachSentAt: Date | null;
```

- [ ] **Step 8: Extend `getLeadDetail` in `src/lib/leads/data.ts`**

Add the outreach draft validator to the imports (change the schema import line):

```typescript
import { leadBriefSchema, type LeadDetail } from "./schema";
import { outreachDraftSchema } from "@/lib/outreach/schema";
import type { OutreachStatus } from "@/lib/outreach/schema";
```

In the `.select({ ... })` object, add these four columns immediately after `outreachMode: leads.outreachMode,`:

```typescript
      outreachStatus: leads.outreachStatus,
      outreachDraft: leads.outreachDraft,
      outreachDraftGeneratedAt: leads.outreachDraftGeneratedAt,
      outreachSentAt: leads.outreachSentAt,
```

After the existing `contactParsed` line, add the draft parse:

```typescript
  const outreachDraftParsed =
    row.outreachDraft == null ? null : outreachDraftSchema.safeParse(row.outreachDraft);
```

In the returned object, add these four fields immediately after `outreachMode: row.outreachMode,`:

```typescript
    outreachStatus: row.outreachStatus as OutreachStatus,
    outreachDraft:
      outreachDraftParsed && outreachDraftParsed.success ? outreachDraftParsed.data : null,
    outreachDraftGeneratedAt: row.outreachDraftGeneratedAt,
    outreachSentAt: row.outreachSentAt,
```

- [ ] **Step 9: Run both integration tests to verify they pass**

Run: `npx vitest run tests/integration/outreach-data.test.ts tests/integration/leads-data.test.ts`
Expected: PASS (both files green).

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/outreach/data.ts src/lib/leads/schema.ts src/lib/leads/data.ts tests/integration/outreach-data.test.ts tests/integration/leads-data.test.ts
git commit -m "feat(outreach): data-layer writes + surface columns in getLeadDetail

setOutreachMode/saveOutreachDraft/setOutreachStatus (UUID-guarded, parameterized
eq). Extend LeadDetail + getLeadDetail to select and validate the new columns;
malformed outreachDraft degrades to null.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: AI generator (`src/ai/outreach/`)

**Files:**
- Create: `src/ai/outreach/schema.ts`
- Create: `src/ai/outreach/prompts.ts`
- Create: `src/ai/outreach/generate.ts`
- Create: `src/ai/outreach/index.ts`
- Test: `tests/unit/ai/outreach-generate.test.ts`

**Interfaces:**
- Consumes: `generateObject`, `type LlmResult`, `type LlmMessage` from `@/ai/llm` (existing). `zod`. NO `@/lib` or `@/db` value imports — DB-free.
- Produces (relied on by Task 5):
  - `type OutreachInput = { company: { name: string; description: string | null }; vendor: { name: string; vendorType: string | null }; intent: string | null; mode: "operator_handles" | "handed_to_vendor"; brief: { why_them: string; what_they_need: string; hook: string; why_this_vendor: string } }`
  - `const outreachDraftSchema: z.ZodType<{ subject: string; body: string }>` (both non-empty — the AI module's own copy, structurally identical to the pure module's)
  - `type OutreachDraft = { subject: string; body: string }` (inferred; mutually assignable to `@/lib/outreach/schema`'s `OutreachDraft`)
  - `function buildOutreachMessages(input: OutreachInput): LlmMessage[]`
  - `function generateOutreach(input: OutreachInput): Promise<LlmResult<OutreachDraft>>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai/outreach-generate.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockGenerateObject } = vi.hoisted(() => ({ mockGenerateObject: vi.fn() }));
vi.mock("@/ai/llm", () => ({ generateObject: mockGenerateObject }));

import { generateOutreach } from "@/ai/outreach/generate";
import { buildOutreachMessages } from "@/ai/outreach/prompts";
import { outreachDraftSchema, type OutreachInput } from "@/ai/outreach/schema";

const input: OutreachInput = {
  company: { name: "NorthPort Foods", description: "Cold-chain distributor" },
  vendor: { name: "RackPro Infra", vendorType: "Infra" },
  intent: "Warehouse racking fit-out",
  mode: "operator_handles",
  brief: {
    why_them: "They just announced a new DC and need racking fast.",
    what_they_need: "Pallet racking for a new cold-chain distribution centre.",
    hook: "Saw NorthPort's new DC announcement — we install racking in 48h.",
    why_this_vendor: "RackPro's 48-hour crews match the tight fit-out window.",
  },
};

const draft = {
  subject: "Racking for your new NorthPort DC",
  body: "Hi — saw the new DC announcement. RackPro installs pallet racking in 48h.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateObject.mockResolvedValue({ value: draft, provider: "anthropic" });
});

describe("buildOutreachMessages", () => {
  it("emits a grounded system message and a JSON context user message", () => {
    const messages = buildOutreachMessages(input);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Do NOT invent");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("NorthPort Foods");
    expect(messages[1].content).toContain("Saw NorthPort's new DC announcement");
  });
});

describe("generateOutreach", () => {
  it("calls generateObject with the draft schema and returns the result", async () => {
    const result = await generateOutreach(input);
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    expect(mockGenerateObject.mock.calls[0][0]).toBe(outreachDraftSchema);
    expect(result.value).toEqual(draft);
    expect(result.provider).toBe("anthropic");
  });

  it("surfaces a provider failure (does not swallow the throw)", async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error("all providers down"));
    await expect(generateOutreach(input)).rejects.toThrow("all providers down");
  });
});

describe("outreachDraftSchema", () => {
  it("accepts a well-formed draft", () => {
    expect(outreachDraftSchema.safeParse(draft).success).toBe(true);
  });
  it("rejects an empty body", () => {
    expect(outreachDraftSchema.safeParse({ subject: "x", body: "" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai/outreach-generate.test.ts`
Expected: FAIL — `Cannot find module '@/ai/outreach/generate'` (and the sibling modules).

- [ ] **Step 3: Write the schema module**

Create `src/ai/outreach/schema.ts`:

```typescript
import { z } from "zod";

// ── Input the generator receives (assembled by the action layer; DB-free here) ──

export type OutreachInput = {
  company: { name: string; description: string | null };
  vendor: { name: string; vendorType: string | null };
  intent: string | null;
  mode: "operator_handles" | "handed_to_vendor";
  brief: {
    why_them: string;
    what_they_need: string;
    hook: string;
    why_this_vendor: string;
  };
};

// ── What the LLM produces (validated by generateObject) ──
// The AI module keeps its OWN draft schema (mirrors src/ai/brief owning
// leadBriefDraftSchema) so the one-directional src/lib -> src/ai (type-only)
// dependency is never inverted. Structurally identical to the pure module's
// outreachDraftSchema; the inferred type is mutually assignable to OutreachDraft.
export const outreachDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

export type OutreachDraft = z.infer<typeof outreachDraftSchema>;
```

- [ ] **Step 4: Write the prompts module**

Create `src/ai/outreach/prompts.ts`:

```typescript
import type { LlmMessage } from "@/ai/llm";
import type { OutreachInput } from "./schema";

const OUTREACH_SYSTEM = `You are the outreach-message writer for a B2B lead-generation platform. An operator will send your message to win a specific company as a customer for a specific vendor, right now. The reverse brief (why them, what they need, the hook, why this vendor) is already written and grounded in captured signals — your job is to turn it into ONE short outreach email.

Rules:
- Use ONLY the facts in the provided input (company, vendor, intent, brief). Do NOT invent capabilities, geographies, clients, dates, prior contact, or familiarity.
- subject: a short, specific, non-cringe subject line — concrete to this company and need, not generic.
- body: a concise outreach email (a few short sentences). Open from the brief's hook, state what the vendor can do for them, and end with a light, low-friction call to action. No fabricated pleasantries.
- When mode is "handed_to_vendor", write it as the vendor reaching out directly; when "operator_handles", write it as a warm operator introduction on the vendor's behalf.
Keep it short, plain, and copy-ready.`;

export function buildOutreachMessages(input: OutreachInput): LlmMessage[] {
  const system: LlmMessage = { role: "system", content: OUTREACH_SYSTEM };
  const context: LlmMessage = {
    role: "user",
    content: `Write the outreach message from these facts:\n${JSON.stringify(input, null, 2)}`,
  };
  return [system, context];
}
```

- [ ] **Step 5: Write the generate module**

Create `src/ai/outreach/generate.ts`:

```typescript
import { generateObject, type LlmResult } from "@/ai/llm";
import { outreachDraftSchema, type OutreachInput, type OutreachDraft } from "./schema";
import { buildOutreachMessages } from "./prompts";

export async function generateOutreach(
  input: OutreachInput,
): Promise<LlmResult<OutreachDraft>> {
  const messages = buildOutreachMessages(input);
  return generateObject(outreachDraftSchema, messages);
}
```

- [ ] **Step 6: Write the barrel**

Create `src/ai/outreach/index.ts`:

```typescript
export { generateOutreach } from "./generate";
export { buildOutreachMessages } from "./prompts";
export { outreachDraftSchema } from "./schema";
export type { OutreachInput, OutreachDraft } from "./schema";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/unit/ai/outreach-generate.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ai/outreach/schema.ts src/ai/outreach/prompts.ts src/ai/outreach/generate.ts src/ai/outreach/index.ts tests/unit/ai/outreach-generate.test.ts
git commit -m "feat(ai): outreach draft generator mirroring ai/brief

generateOutreach(input) -> generateObject(outreachDraftSchema, buildOutreachMessages).
DB-free; imports only zod + @/ai/llm. Own draft schema keeps src/lib -> src/ai
type-only dependency uninverted.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Server actions (`src/app/(app)/leads/actions.ts`)

**Files:**
- Create: `src/app/(app)/leads/actions.ts`
- Test: `tests/integration/outreach-actions.test.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth`; `revalidatePath` from `next/cache`; `db` from `@/db/client`; `getLeadDetail` from `@/lib/leads/data`; `OUTREACH_LABELS`, `type OutreachMode` from `@/lib/leads/schema`; `OUTREACH_STATUSES`, `type OutreachStatus` from `@/lib/outreach/schema`; `setOutreachMode`, `saveOutreachDraft`, `setOutreachStatus` from `@/lib/outreach/data` (Task 3); `generateOutreach` from `@/ai/outreach` (Task 4).
- Produces (relied on by Task 6):
  - `setOutreachModeAction(leadId: string, mode: OutreachMode): Promise<{ ok: boolean; error?: string }>`
  - `generateOutreachDraftAction(leadId: string): Promise<{ ok: boolean; error?: string }>`
  - `setOutreachStatusAction(leadId: string, status: OutreachStatus): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/outreach-actions.test.ts` (integration: real Neon + mocked `auth`/`revalidatePath`, plus a mocked `@/ai/outreach` so no live LLM is called — mirrors `vendors-update-action.test.ts` + `interview-actions.test.ts`):

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll, vi, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/ai/outreach", () => ({ generateOutreach: vi.fn() }));

import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { leads, companies, vendorProfiles } from "@/db/schema";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { generateOutreach } from "@/ai/outreach";
import {
  setOutreachModeAction,
  generateOutreachDraftAction,
  setOutreachStatusAction,
} from "@/app/(app)/leads/actions";

const validBrief = {
  why_them: "Expanding to three new regions.",
  why_now: [
    { signalId: "sig-1", claim: "Opened a new DC", date: "2026-06-01T00:00:00Z", source: "pr", evidence: ["https://x"] },
  ],
  what_they_need: "Warehouse automation partner",
  hook: "Congrats on the expansion",
  why_this_vendor: "You automated a comparable site",
  objections: [{ objection: "Too expensive", response: "ROI within 6 months" }],
  disqualifier_check_passed: true,
  generatedAt: "2026-06-02T09:30:00Z",
};

async function makeLead(opts: { brief?: unknown } = {}): Promise<string> {
  const [company] = await testDb
    .insert(companies)
    .values({ name: "Zephyr Retail", normalizedName: "zephyr retail", description: "Retailer" })
    .returning();
  const [vendor] = await testDb
    .insert(vendorProfiles)
    .values({ name: "Acme Infra", vendorType: "Infra" })
    .returning();
  const [lead] = await testDb
    .insert(leads)
    .values({
      companyId: company.companyId,
      vendorId: vendor.vendorId,
      intent: "Warehouse buildout",
      brief: opts.brief ?? null,
    })
    .returning();
  return lead.leadId;
}

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  vi.clearAllMocks();
  await truncateAll(["leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("setOutreachModeAction", () => {
  it("persists the mode and revalidates", async () => {
    const leadId = await makeLead();
    const r = await setOutreachModeAction(leadId, "handed_to_vendor");
    expect(r).toEqual({ ok: true });
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachMode).toBe("handed_to_vendor");
    expect(revalidatePath).toHaveBeenCalledWith(`/leads/${leadId}`);
  });

  it("rejects an unauthenticated caller", async () => {
    (auth as Mock).mockResolvedValueOnce(null);
    const leadId = await makeLead();
    const r = await setOutreachModeAction(leadId, "handed_to_vendor");
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown mode", async () => {
    const leadId = await makeLead();
    const r = await setOutreachModeAction(leadId, "nope" as never);
    expect(r).toEqual({ ok: false, error: "Unknown mode." });
  });
});

describe("generateOutreachDraftAction", () => {
  it("generates and saves a draft when a brief exists", async () => {
    const leadId = await makeLead({ brief: validBrief });
    (generateOutreach as Mock).mockResolvedValue({
      value: { subject: "Hi", body: "Let's talk." },
      provider: "anthropic",
    });
    const r = await generateOutreachDraftAction(leadId);
    expect(r).toEqual({ ok: true });
    expect(generateOutreach).toHaveBeenCalledTimes(1);
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachDraft).toEqual({ subject: "Hi", body: "Let's talk." });
    expect(row.outreachStatus).toBe("drafted");
    expect(revalidatePath).toHaveBeenCalledWith(`/leads/${leadId}`);
  });

  it("refuses when the lead has no brief and does not call the LLM", async () => {
    const leadId = await makeLead({ brief: null });
    const r = await generateOutreachDraftAction(leadId);
    expect(r).toEqual({ ok: false, error: "Generate the brief first." });
    expect(generateOutreach).not.toHaveBeenCalled();
  });

  it("returns a sanitized error when the provider fails", async () => {
    const leadId = await makeLead({ brief: validBrief });
    (generateOutreach as Mock).mockRejectedValue(new Error("SECRET provider key abc123 invalid"));
    const r = await generateOutreachDraftAction(leadId);
    expect(r).toEqual({
      ok: false,
      error: "Draft generation failed. Check the LLM provider configuration.",
    });
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachStatus).toBe("pending"); // nothing persisted
  });

  it("rejects an unauthenticated caller", async () => {
    (auth as Mock).mockResolvedValueOnce(null);
    const leadId = await makeLead({ brief: validBrief });
    const r = await generateOutreachDraftAction(leadId);
    expect(r.ok).toBe(false);
    expect(generateOutreach).not.toHaveBeenCalled();
  });
});

describe("setOutreachStatusAction", () => {
  it("marks the lead sent and stamps sentAt", async () => {
    const leadId = await makeLead();
    const r = await setOutreachStatusAction(leadId, "sent");
    expect(r).toEqual({ ok: true });
    const [row] = await testDb.select().from(leads).where(eq(leads.leadId, leadId));
    expect(row.outreachStatus).toBe("sent");
    expect(row.outreachSentAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith(`/leads/${leadId}`);
  });

  it("rejects an unknown status", async () => {
    const leadId = await makeLead();
    const r = await setOutreachStatusAction(leadId, "bogus" as never);
    expect(r).toEqual({ ok: false, error: "Unknown status." });
  });

  it("rejects an unauthenticated caller", async () => {
    (auth as Mock).mockResolvedValueOnce(null);
    const leadId = await makeLead();
    const r = await setOutreachStatusAction(leadId, "sent");
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/outreach-actions.test.ts`
Expected: FAIL — `Cannot find module '@/app/(app)/leads/actions'`.

- [ ] **Step 3: Write the actions module**

Create `src/app/(app)/leads/actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { getLeadDetail } from "@/lib/leads/data";
import { OUTREACH_LABELS, type OutreachMode } from "@/lib/leads/schema";
import { OUTREACH_STATUSES, type OutreachStatus } from "@/lib/outreach/schema";
import {
  setOutreachMode,
  saveOutreachDraft,
  setOutreachStatus,
} from "@/lib/outreach/data";
import { generateOutreach } from "@/ai/outreach";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export async function setOutreachModeAction(
  leadId: string,
  mode: OutreachMode,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  // Never trust the client value — validate it is a real mode before the DB.
  if (!(mode in OUTREACH_LABELS)) return { ok: false, error: "Unknown mode." };

  const r = await setOutreachMode(db, leadId, mode);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function generateOutreachDraftAction(
  leadId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };

  const lead = await getLeadDetail(db, leadId);
  if (!lead) return { ok: false, error: "Lead not found." };
  // The draft is generated FROM the brief; re-check server-side (button is also
  // disabled client-side).
  if (!lead.brief) return { ok: false, error: "Generate the brief first." };

  let draft: { subject: string; body: string };
  try {
    const result = await generateOutreach({
      company: { name: lead.companyName, description: lead.companyDescription },
      vendor: { name: lead.vendorName, vendorType: lead.vendorType },
      intent: lead.intent,
      mode: lead.outreachMode ?? "operator_handles",
      brief: {
        why_them: lead.brief.why_them,
        what_they_need: lead.brief.what_they_need,
        hook: lead.brief.hook,
        why_this_vendor: lead.brief.why_this_vendor,
      },
    });
    draft = result.value;
  } catch {
    // Sanitized — never surface the raw provider error / key to the client.
    return {
      ok: false,
      error: "Draft generation failed. Check the LLM provider configuration.",
    };
  }

  const r = await saveOutreachDraft(db, leadId, draft);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}

export async function setOutreachStatusAction(
  leadId: string,
  status: OutreachStatus,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };
  if (!OUTREACH_STATUSES.includes(status)) {
    return { ok: false, error: "Unknown status." };
  }

  const r = await setOutreachStatus(db, leadId, status);
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/outreach-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/leads/actions.ts" tests/integration/outreach-actions.test.ts
git commit -m "feat(outreach): auth-gated server actions (mode, generate, status)

generateOutreachDraftAction bridges AI + DB: reads brief context via getLeadDetail,
guards brief-exists, calls generateOutreach in try/catch (sanitized error), saves
via saveOutreachDraft, revalidates. Validates client enum input before any write.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: UI — `OutreachPanel` + page wiring + CSS

**Files:**
- Create: `src/app/(app)/leads/[id]/outreach-panel.tsx`
- Modify: `src/app/(app)/leads/[id]/page.tsx` (insert `<OutreachPanel>`, remove the read-only Outreach `<dt>/<dd>`)
- Modify: `src/app/styles/components.css` (APPEND panel styles to end of file)
- Test: `tests/unit/components/outreach-panel.test.tsx`

**Interfaces:**
- Consumes: `setOutreachModeAction`, `generateOutreachDraftAction`, `setOutreachStatusAction` from `./actions` (Task 5); `type OutreachStatus`, `OUTREACH_STATUS_LABELS`, `canMarkSent` from `@/lib/outreach/schema` (Task 2); `type OutreachDraft` from `@/lib/outreach/schema`; `OUTREACH_LABELS`, `type OutreachMode` from `@/lib/leads/schema`; `useTransition`/`useState` from `react`; `useRouter` from `next/navigation`. Props from `LeadDetail` (Task 3).
- Produces: `OutreachPanel({ leadId, mode, status, draft, hasBrief }: { leadId: string; mode: OutreachMode | null; status: OutreachStatus; draft: OutreachDraft | null; hasBrief: boolean })` — a React client component.

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/components/outreach-panel.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/leads/actions", () => ({
  setOutreachModeAction: vi.fn(() => Promise.resolve({ ok: true })),
  generateOutreachDraftAction: vi.fn(() => Promise.resolve({ ok: true })),
  setOutreachStatusAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { OutreachPanel } from "@/app/(app)/leads/[id]/outreach-panel";
import {
  setOutreachModeAction,
  generateOutreachDraftAction,
  setOutreachStatusAction,
} from "@/app/(app)/leads/actions";

const ID = "10000000-0000-4000-8000-000000000001";

describe("OutreachPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the current status label and both mode buttons", () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief />);
    expect(screen.getByText(/not started/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /operator handles/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /handed to vendor/i })).toBeInTheDocument();
  });

  it("disables Generate draft and shows a note when hasBrief is false", () => {
    render(<OutreachPanel leadId={ID} mode={null} status="pending" draft={null} hasBrief={false} />);
    expect(screen.getByRole("button", { name: /generate draft/i })).toBeDisabled();
    expect(screen.getByText(/generate the brief first/i)).toBeInTheDocument();
  });

  it("enables Generate draft when hasBrief is true", () => {
    render(<OutreachPanel leadId={ID} mode={null} status="pending" draft={null} hasBrief />);
    expect(screen.getByRole("button", { name: /generate draft/i })).toBeEnabled();
  });

  it("renders the draft subject and body when present", () => {
    render(
      <OutreachPanel
        leadId={ID}
        mode="operator_handles"
        status="drafted"
        draft={{ subject: "Racking for your DC", body: "Hi there, let's talk." }}
        hasBrief
      />,
    );
    expect(screen.getByDisplayValue("Racking for your DC")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hi there, let's talk.")).toBeInTheDocument();
  });

  it("clicking a mode button calls setOutreachModeAction with (leadId, mode)", async () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief />);
    await userEvent.click(screen.getByRole("button", { name: /handed to vendor/i }));
    expect(setOutreachModeAction).toHaveBeenCalledWith(ID, "handed_to_vendor");
  });

  it("clicking Generate draft calls generateOutreachDraftAction with the leadId", async () => {
    render(<OutreachPanel leadId={ID} mode="operator_handles" status="pending" draft={null} hasBrief />);
    await userEvent.click(screen.getByRole("button", { name: /generate draft/i }));
    expect(generateOutreachDraftAction).toHaveBeenCalledWith(ID);
  });

  it("shows Mark as sent for a non-sent lead and calls the action with 'sent'", async () => {
    render(
      <OutreachPanel
        leadId={ID}
        mode="operator_handles"
        status="drafted"
        draft={{ subject: "s", body: "b" }}
        hasBrief
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /mark as sent/i }));
    expect(setOutreachStatusAction).toHaveBeenCalledWith(ID, "sent");
  });

  it("hides Mark as sent once the lead is sent", () => {
    render(
      <OutreachPanel
        leadId={ID}
        mode="operator_handles"
        status="sent"
        draft={{ subject: "s", body: "b" }}
        hasBrief
      />,
    );
    expect(screen.queryByRole("button", { name: /mark as sent/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/outreach-panel.test.tsx`
Expected: FAIL — `Cannot find module '@/app/(app)/leads/[id]/outreach-panel'`.

- [ ] **Step 3: Write the component**

Create `src/app/(app)/leads/[id]/outreach-panel.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OUTREACH_LABELS, type OutreachMode } from "@/lib/leads/schema";
import {
  OUTREACH_STATUS_LABELS,
  canMarkSent,
  type OutreachStatus,
  type OutreachDraft,
} from "@/lib/outreach/schema";
import {
  setOutreachModeAction,
  generateOutreachDraftAction,
  setOutreachStatusAction,
} from "../actions";

const MODES: OutreachMode[] = ["operator_handles", "handed_to_vendor"];

export function OutreachPanel({
  leadId,
  mode,
  status,
  draft,
  hasBrief,
}: {
  leadId: string;
  mode: OutreachMode | null;
  status: OutreachStatus;
  draft: OutreachDraft | null;
  hasBrief: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const r = await action();
      if (r.ok) router.refresh();
      else setError(r.error ?? "Action failed.");
    });
  }

  return (
    <section className="outreach-panel" aria-label="Outreach">
      <header className="outreach-head">
        <h2>Outreach</h2>
        <span className={`outreach-status outreach-status-${status}`}>
          {OUTREACH_STATUS_LABELS[status]}
        </span>
      </header>

      <div className="outreach-modes" role="group" aria-label="Outreach mode">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={m === mode ? "btn btn-sm btn-primary" : "btn btn-sm"}
            aria-pressed={m === mode}
            disabled={pending}
            onClick={() => run(() => setOutreachModeAction(leadId, m))}
          >
            {OUTREACH_LABELS[m]}
          </button>
        ))}
      </div>

      <div className="outreach-generate">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={pending || !hasBrief}
          onClick={() => run(() => generateOutreachDraftAction(leadId))}
        >
          {draft ? "Regenerate draft" : "Generate draft"}
        </button>
        {!hasBrief && (
          <p className="outreach-note">
            Generate the brief first — the draft is written from it.
          </p>
        )}
      </div>

      {draft && (
        <form className="outreach-draft" aria-label="Generated draft">
          <label className="outreach-field">
            <span>Subject</span>
            <input type="text" readOnly value={draft.subject} />
          </label>
          <label className="outreach-field">
            <span>Body</span>
            <textarea readOnly rows={6} value={draft.body} />
          </label>
        </form>
      )}

      {canMarkSent(status) && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={pending}
          onClick={() => run(() => setOutreachStatusAction(leadId, "sent"))}
        >
          Mark as sent
        </button>
      )}

      {error && (
        <p role="alert" className="outreach-error">
          {error}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/outreach-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the panel into the page and remove the read-only Outreach fact**

In `src/app/(app)/leads/[id]/page.tsx`:

(a) Add the import after the existing `import { StageControls } ...` line:

```tsx
import { OutreachPanel } from "./outreach-panel";
```

(b) Remove the read-only Outreach `<dt>/<dd>` block (the `{lead.outreachMode && ( ... )}` fact inside the `<dl>`):

```tsx
            {lead.outreachMode && (
              <div className="fact">
                <dt>Outreach</dt>
                <dd>{OUTREACH_LABELS[lead.outreachMode]}</dd>
              </div>
            )}
```

(c) Since `OUTREACH_LABELS` is now unused in the page, remove it from the leads/schema import — change:

```tsx
import { formatScore, OUTREACH_LABELS } from "@/lib/leads/schema";
```

to:

```tsx
import { formatScore } from "@/lib/leads/schema";
```

(d) Insert the panel as a `<section>` immediately after the `</section>` that closes `lead-summary` (i.e., after `<StageControls ... /></section>`), before the `{lead.brief ? (` block:

```tsx
        <OutreachPanel
          leadId={lead.leadId}
          mode={lead.outreachMode}
          status={lead.outreachStatus}
          draft={lead.outreachDraft}
          hasBrief={lead.brief != null}
        />
```

- [ ] **Step 6: Append the panel CSS (append-only)**

Append the following to the END of `src/app/styles/components.css` (do not edit any existing rule):

```css

/* ── Outreach panel (lead detail) ── */
.outreach-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius, 0.5rem);
}
.outreach-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.outreach-head h2 {
  margin: 0;
  font-size: 1rem;
}
.outreach-status {
  font-size: 0.8rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.outreach-status-sent {
  color: var(--text);
  border-color: var(--text-faint);
}
.outreach-modes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.outreach-generate {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.outreach-note {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.outreach-draft {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.outreach-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
  color: var(--text-muted);
}
.outreach-field input,
.outreach-field textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius, 0.5rem);
  background: var(--surface, transparent);
  color: var(--text);
  font: inherit;
}
.outreach-field textarea {
  resize: vertical;
}
.outreach-error {
  margin: 0;
  color: var(--danger, #b91c1c);
  font-size: 0.85rem;
}
@media (min-width: 768px) {
  .outreach-modes {
    align-items: center;
  }
}
```

- [ ] **Step 7: Verify the CSS change is append-only**

Run: `git diff --stat src/app/styles/components.css`
Expected: one file changed with insertions and `-0` deletions (append-only; no existing lines touched).

- [ ] **Step 8: Re-run the component test + typecheck + build**

Run: `npx vitest run tests/unit/components/outreach-panel.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS (page.tsx compiles; `OUTREACH_LABELS` no longer imported-but-unused).

Run: `npm run build`
Expected: PASS (RSC page builds — the repo convention for async-RSC coverage).

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/leads/[id]/outreach-panel.tsx" "src/app/(app)/leads/[id]/page.tsx" src/app/styles/components.css tests/unit/components/outreach-panel.test.tsx
git commit -m "feat(outreach): OutreachPanel on lead detail + page wiring

Client panel mirrors StageControls (useTransition + router.refresh): mode
switcher, status badge, brief-gated Generate draft, read-only draft display,
Mark as sent. Replaces the read-only Outreach fact with the live panel. CSS
appended.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after Task 6)

- [ ] **Full suite:** `npm run test` — expected PASS (re-run 2-3x if a transient Neon TRUNCATE/latency flake appears; per project memory these are not structural).
- [ ] **Typecheck:** `npm run typecheck` — expected PASS.
- [ ] **Build:** `npm run build` — expected PASS.
