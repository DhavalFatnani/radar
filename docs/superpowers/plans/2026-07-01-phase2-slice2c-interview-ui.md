# Phase 2 · Slice 2c — SIA Interview UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the operator-facing SIA interview screen — a co-piloted, turn-by-turn interview that persists as a resumable session and, on save, writes a new versioned vendor profile (append-and-amend).

**Architecture:** Three layers. (1) Persistence: a new `vendor_interviews` table + `src/lib/interviews/` data module. (2) Orchestration: `"use server"` actions wiring the existing `src/ai/sia` engine to persistence. (3) UI: a server `page.tsx` + `"use client"` interview component matching `mockups/v2/command/interview.html`, with the engine kept out of the client bundle by deriving all display data server-side.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle ORM + PostgreSQL (Neon, postgres-js `prepare:false`), NextAuth v5 (`auth()`), Vitest 4 (node + per-file jsdom), `@testing-library/react` 16.

**Spec:** `docs/superpowers/specs/2026-07-01-phase2-slice2c-interview-ui-design.md`

## Global Constraints

- **Layer rule:** `src/ai/**` never imports `@/db/*` or `@/lib/vendors/data`. Pure types/schemas come from `@/lib/vendors/schema`. The interview `actions.ts`/`view.ts` are the seam that joins `@/ai/sia` to `@/lib/*/data` — that join lives in `src/app/**`, never in `src/ai/**`.
- **Client bundle rule:** the `"use client"` component imports **only types** from `@/ai/sia`, `@/lib/vendors/schema`, `@/lib/interviews/schema`, and `./types` (all `import type`, erased at build). It never imports `@/ai/sia`, `@/ai/llm`, `./view`, or any `data.ts` at runtime. All tag-stripping/coverage is computed server-side and passed as props/return values.
- **Migrations:** generate-and-commit. `npm run db:generate` produces `src/db/migrations/0009_*.sql` (offline, from schema diff) — commit it. Never `db:push`.
- **Server actions:** every action calls `auth()` and returns a structured result on failure — never throws to the client, never leaks internals (mirror `src/app/(app)/vendors/[vendorId]/actions.ts`). A `"use server"` module may export **only async functions**.
- **SQL:** Drizzle query builder only; explicit column selects (no `SELECT *`); parameterized values (the `jsonb ||` concat binds `JSON.stringify(msgs)` as a parameter). List queries carry a `LIMIT`.
- **Engine seeding invariant:** every `nextQuestion`/`extractProfile` call passes `existingProfile: getVendor(vendorId)` — this is what makes re-interviews append-and-amend.
- **Tests:** live under `tests/` (`tests/integration/**`, `tests/unit/**`) — the project convention. Integration files: `beforeAll(migrateTestDb)`, `afterEach(truncateAll([...explicit tables]))`, `afterAll` closes **both** `closeTestDb()` **and** `queryClient.end()`. Component tests put `// @vitest-environment jsdom` as the literal first line. No-DB/no-key tests import from `@/lib/vendors/schema`, never `@/lib/vendors/data`.
- **Commits:** stage only the explicit file paths for the task — never `git add .` (keep `.DS_Store`, `AGENTS.md`'s hook churn, and `.superpowers/` scratch out). Trailer on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Copy (verbatim):** input placeholder `Type the vendor's answer, or press Continue…`; input `aria-label="Vendor answer"`; continue button `Continue interview`; save button `Save & version v{n}` where `{n}` = `vendor.version + 1`; first-interview eyebrow `First interview`; re-interview eyebrow `Re-interview · append & amend`.
- **Verification per task:** `npm test` (relevant files), `npm run typecheck`, `npm run lint` all clean before commit.

---

## File structure

```
src/db/schema/enums.ts                                            (M) + interviewStatus
src/db/schema/interviews.ts                                       (C) vendorInterviews table
src/db/schema/index.ts                                            (M) export * from "./interviews"
src/db/migrations/0009_*.sql + meta                               (C, generated + committed)
src/lib/interviews/schema.ts                                      (C) pure types
src/lib/interviews/data.ts                                        (C) session data layer
src/lib/vendors/schema.ts                                         (M) widen InterviewHistoryEntry
src/lib/vendors/data.ts                                           (M) updateVendorProfile source arg
src/ai/sia/index.ts                                               (M) export stripAreaTag
src/app/(app)/vendors/[vendorId]/interview/types.ts               (C) TurnResult/DisplayTurn/SaveResult
src/app/(app)/vendors/[vendorId]/interview/view.ts               (C) server display helpers
src/app/(app)/vendors/[vendorId]/interview/actions.ts             (C) server actions
src/app/(app)/vendors/[vendorId]/interview/page.tsx              (C) server component
src/app/(app)/vendors/[vendorId]/interview/interview-screen.tsx  (C) "use client"
src/app/(app)/vendors/[vendorId]/page.tsx                         (M) entry link
src/app/styles/command.css                                        (M) port mockup CSS
tests/integration/interview-schema.test.ts                        (C)
tests/integration/interviews-data.test.ts                         (C)
tests/integration/vendors-interview-history.test.ts               (C)
tests/integration/interview-actions.test.ts                       (C)
tests/unit/ai/sia-index.test.ts                                   (C)
tests/unit/components/interview-screen.test.tsx                   (C)
```

Task order: **1** schema+migration → **2** interviews data → **3** vendors widening → **4** sia barrel export → **5** server actions → **6** interview screen → **7** CSS + entry link.

---

### Task 1: `vendor_interviews` schema, enum, and migration

**Files:**
- Modify: `src/db/schema/enums.ts`
- Create: `src/db/schema/interviews.ts`
- Modify: `src/db/schema/index.ts`
- Create (generated): `src/db/migrations/0009_*.sql` + `src/db/migrations/meta/*`
- Test: `tests/integration/interview-schema.test.ts`

**Interfaces:**
- Produces: `interviewStatus` pgEnum; `vendorInterviews` table with columns `interviewId, vendorId, status, messages, startedAt, completedAt, resultingVersion, provider`; a partial unique index allowing exactly one `in_progress` row per `vendorId`.

- [ ] **Step 1: Add the enum.** Append to `src/db/schema/enums.ts`:

```ts
// SIA interview session (§7.1)
export const interviewStatus = pgEnum("interview_status", ["in_progress", "completed", "abandoned"]);
```

- [ ] **Step 2: Create the table.** `src/db/schema/interviews.ts`:

```ts
import { pgTable, uuid, integer, jsonb, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { LlmMessage } from "@/ai/llm";
import { interviewStatus } from "./enums";
import { vendorProfiles } from "./vendors";

// One persisted SIA interview session. `messages` is the full LlmMessage[]
// transcript (assistant turns keep their [area:X] tag). At most one
// in_progress row per vendor (partial unique index below).
export const vendorInterviews = pgTable(
  "vendor_interviews",
  {
    interviewId: uuid("interview_id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendorProfiles.vendorId, { onDelete: "cascade" }),
    status: interviewStatus("status").notNull().default("in_progress"),
    messages: jsonb("messages").$type<LlmMessage[]>().notNull().default(sql`'[]'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    resultingVersion: integer("resulting_version"),
    provider: text("provider"),
  },
  (t) => [
    index("vendor_interviews_vendor_id_idx").on(t.vendorId),
    uniqueIndex("vendor_interviews_one_open_per_vendor")
      .on(t.vendorId)
      .where(sql`${t.status} = 'in_progress'`),
  ],
);
```

- [ ] **Step 3: Export from the barrel.** In `src/db/schema/index.ts`, add after the `./vendors` line:

```ts
export * from "./interviews";
```

- [ ] **Step 4: Typecheck the schema.** Run: `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Generate the migration.** Run: `npm run db:generate`. Expected: a new `src/db/migrations/0009_*.sql` is written (plus `meta/` snapshot updates) containing `CREATE TYPE "interview_status"`, `CREATE TABLE "vendor_interviews"`, and a partial `CREATE UNIQUE INDEX ... WHERE "status" = 'in_progress'`. Open the file and confirm the `WHERE` clause is present on the unique index (if drizzle emitted it without the predicate, add the predicate by hand and note it).

- [ ] **Step 6: Write the failing test.** `tests/integration/interview-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createVendorStub } from "@/lib/vendors/data";
import { vendorInterviews } from "@/db/schema";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["vendor_interviews", "vendor_profiles"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("vendor_interviews schema", () => {
  it("stores an in-progress interview with an empty transcript by default", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const [row] = await testDb.insert(vendorInterviews).values({ vendorId }).returning();
    expect(row.status).toBe("in_progress");
    expect(row.messages).toEqual([]);
  });

  it("allows only one in-progress interview per vendor", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    await testDb.insert(vendorInterviews).values({ vendorId });
    await expect(testDb.insert(vendorInterviews).values({ vendorId })).rejects.toThrow();
  });

  it("allows a fresh interview once the prior one is no longer in progress", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const [first] = await testDb.insert(vendorInterviews).values({ vendorId }).returning();
    await testDb
      .update(vendorInterviews)
      .set({ status: "completed" })
      .where(eq(vendorInterviews.interviewId, first.interviewId));
    await expect(testDb.insert(vendorInterviews).values({ vendorId })).resolves.toBeDefined();
  });
});
```

- [ ] **Step 7: Run the test.** Run: `npm test tests/integration/interview-schema.test.ts`. Expected: 3 pass (the migration created the table + partial unique index). If the "only one in-progress" test does not throw, the partial unique index is missing — fix Step 5's SQL and re-run.

- [ ] **Step 8: Lint.** Run: `npm run lint`. Expected: clean.

- [ ] **Step 9: Commit.**

```bash
git add src/db/schema/enums.ts src/db/schema/interviews.ts src/db/schema/index.ts src/db/migrations tests/integration/interview-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(db): vendor_interviews session table + one-open-per-vendor index

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `src/lib/interviews/` data module

**Files:**
- Create: `src/lib/interviews/schema.ts`
- Create: `src/lib/interviews/data.ts`
- Test: `tests/integration/interviews-data.test.ts`

**Interfaces:**
- Consumes: `vendorInterviews` (Task 1); `db` from `@/db/client`; `LlmMessage` from `@/ai/llm`.
- Produces:
  - Types: `InterviewStatus = "in_progress" | "completed" | "abandoned"`; `Interview = { interviewId: string; vendorId: string; status: InterviewStatus; messages: LlmMessage[]; startedAt: string; completedAt: string | null; resultingVersion: number | null; provider: string | null }`; `InterviewSummary = { interviewId: string; status: InterviewStatus; startedAt: string; completedAt: string | null; resultingVersion: number | null; messageCount: number }`.
  - Functions: `createInterview(vendorId: string): Promise<Interview>`; `getInterview(interviewId: string): Promise<Interview | null>`; `getActiveInterview(vendorId: string): Promise<Interview | null>`; `listInterviews(vendorId: string): Promise<InterviewSummary[]>`; `appendMessages(interviewId: string, msgs: LlmMessage[]): Promise<void>`; `completeInterview(interviewId: string, resultingVersion: number, provider: string): Promise<void>`; `abandonInterview(interviewId: string): Promise<void>`.

- [ ] **Step 1: Create the pure types.** `src/lib/interviews/schema.ts`:

```ts
import type { LlmMessage } from "@/ai/llm";

export type InterviewStatus = "in_progress" | "completed" | "abandoned";

export type Interview = {
  interviewId: string;
  vendorId: string;
  status: InterviewStatus;
  messages: LlmMessage[];
  startedAt: string;
  completedAt: string | null;
  resultingVersion: number | null;
  provider: string | null;
};

export type InterviewSummary = {
  interviewId: string;
  status: InterviewStatus;
  startedAt: string;
  completedAt: string | null;
  resultingVersion: number | null;
  messageCount: number;
};
```

- [ ] **Step 2: Write the failing test.** `tests/integration/interviews-data.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createVendorStub } from "@/lib/vendors/data";
import {
  createInterview,
  getInterview,
  getActiveInterview,
  listInterviews,
  appendMessages,
  completeInterview,
  abandonInterview,
} from "@/lib/interviews/data";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["vendor_interviews", "vendor_profiles"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("interviews data layer", () => {
  it("creates an in-progress interview and finds it as active", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    expect(iv.status).toBe("in_progress");
    expect(iv.messages).toEqual([]);
    const active = await getActiveInterview(vendorId);
    expect(active?.interviewId).toBe(iv.interviewId);
  });

  it("appends messages atomically, preserving order", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    await appendMessages(iv.interviewId, [{ role: "assistant", content: "What do you do?\n[area:capabilities]" }]);
    await appendMessages(iv.interviewId, [{ role: "user", content: "We do warehouse racking." }]);
    const got = await getInterview(iv.interviewId);
    expect(got?.messages.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(got?.messages[1].content).toContain("racking");
  });

  it("lists interviews newest-first with a message count and no transcript", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    await appendMessages(iv.interviewId, [
      { role: "assistant", content: "Q1\n[area:capabilities]" },
      { role: "user", content: "an answer that is long enough" },
    ]);
    const list = await listInterviews(vendorId);
    expect(list).toHaveLength(1);
    expect(list[0].messageCount).toBe(2);
    expect(list[0]).not.toHaveProperty("messages");
  });

  it("completeInterview records version + provider and frees the active slot", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    await completeInterview(iv.interviewId, 3, "anthropic");
    const got = await getInterview(iv.interviewId);
    expect(got?.status).toBe("completed");
    expect(got?.resultingVersion).toBe(3);
    expect(got?.provider).toBe("anthropic");
    expect(got?.completedAt).not.toBeNull();
    expect(await getActiveInterview(vendorId)).toBeNull();
  });

  it("abandonInterview frees the active slot", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    await abandonInterview(iv.interviewId);
    const got = await getInterview(iv.interviewId);
    expect(got?.status).toBe("abandoned");
    expect(await getActiveInterview(vendorId)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.** Run: `npm test tests/integration/interviews-data.test.ts`. Expected: FAIL — `@/lib/interviews/data` has no exports yet.

- [ ] **Step 4: Implement the data layer.** `src/lib/interviews/data.ts`:

```ts
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { vendorInterviews } from "@/db/schema";
import type { LlmMessage } from "@/ai/llm";
import type { Interview, InterviewStatus, InterviewSummary } from "./schema";

// Re-export the pure types for the service/UI layer.
export type { Interview, InterviewStatus, InterviewSummary };

const columns = {
  interviewId: vendorInterviews.interviewId,
  vendorId: vendorInterviews.vendorId,
  status: vendorInterviews.status,
  messages: vendorInterviews.messages,
  startedAt: vendorInterviews.startedAt,
  completedAt: vendorInterviews.completedAt,
  resultingVersion: vendorInterviews.resultingVersion,
  provider: vendorInterviews.provider,
};

type Row = {
  interviewId: string;
  vendorId: string;
  status: InterviewStatus;
  messages: LlmMessage[] | null;
  startedAt: Date;
  completedAt: Date | null;
  resultingVersion: number | null;
  provider: string | null;
};

function toInterview(row: Row): Interview {
  return {
    interviewId: row.interviewId,
    vendorId: row.vendorId,
    status: row.status,
    messages: row.messages ?? [],
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    resultingVersion: row.resultingVersion,
    provider: row.provider,
  };
}

export async function createInterview(vendorId: string): Promise<Interview> {
  const [row] = await db.insert(vendorInterviews).values({ vendorId }).returning(columns);
  return toInterview(row);
}

export async function getInterview(interviewId: string): Promise<Interview | null> {
  const [row] = await db
    .select(columns)
    .from(vendorInterviews)
    .where(eq(vendorInterviews.interviewId, interviewId))
    .limit(1);
  return row ? toInterview(row) : null;
}

export async function getActiveInterview(vendorId: string): Promise<Interview | null> {
  const [row] = await db
    .select(columns)
    .from(vendorInterviews)
    .where(and(eq(vendorInterviews.vendorId, vendorId), eq(vendorInterviews.status, "in_progress")))
    .limit(1);
  return row ? toInterview(row) : null;
}

export async function listInterviews(vendorId: string): Promise<InterviewSummary[]> {
  const rows = await db
    .select({
      interviewId: vendorInterviews.interviewId,
      status: vendorInterviews.status,
      startedAt: vendorInterviews.startedAt,
      completedAt: vendorInterviews.completedAt,
      resultingVersion: vendorInterviews.resultingVersion,
      messageCount: sql<number>`jsonb_array_length(${vendorInterviews.messages})`,
    })
    .from(vendorInterviews)
    .where(eq(vendorInterviews.vendorId, vendorId))
    .orderBy(desc(vendorInterviews.startedAt))
    .limit(100);
  return rows.map((r) => ({
    interviewId: r.interviewId,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    resultingVersion: r.resultingVersion,
    messageCount: Number(r.messageCount),
  }));
}

// Atomic DB-side append: messages = messages || $msgs::jsonb. No read-modify-write,
// so concurrent turns cannot lose each other. $msgs is a bound parameter.
export async function appendMessages(interviewId: string, msgs: LlmMessage[]): Promise<void> {
  await db
    .update(vendorInterviews)
    .set({ messages: sql`${vendorInterviews.messages} || ${JSON.stringify(msgs)}::jsonb` })
    .where(eq(vendorInterviews.interviewId, interviewId));
}

export async function completeInterview(
  interviewId: string,
  resultingVersion: number,
  provider: string,
): Promise<void> {
  await db
    .update(vendorInterviews)
    .set({ status: "completed", completedAt: new Date(), resultingVersion, provider })
    .where(eq(vendorInterviews.interviewId, interviewId));
}

export async function abandonInterview(interviewId: string): Promise<void> {
  await db
    .update(vendorInterviews)
    .set({ status: "abandoned", completedAt: new Date() })
    .where(eq(vendorInterviews.interviewId, interviewId));
}
```

- [ ] **Step 5: Run the test to verify it passes.** Run: `npm test tests/integration/interviews-data.test.ts`. Expected: 5 pass.

- [ ] **Step 6: Typecheck + lint.** Run: `npm run typecheck && npm run lint`. Expected: clean.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/interviews/schema.ts src/lib/interviews/data.ts tests/integration/interviews-data.test.ts
git commit -m "$(cat <<'EOF'
feat(interviews): session data layer (create/get/list/append/complete/abandon)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Widen `InterviewHistoryEntry` + `updateVendorProfile` source arg

**Files:**
- Modify: `src/lib/vendors/schema.ts:20-26`
- Modify: `src/lib/vendors/data.ts:139-174`
- Test: `tests/integration/vendors-interview-history.test.ts`

**Interfaces:**
- Consumes: existing `updateVendorProfile`, `VendorProfileInput`, `getVendor`.
- Produces: `InterviewHistoryEntry` gains `kind: "manual_edit" | "interview"` and optional `interviewId?: string`; `updateVendorProfile(vendorId, input, source?: { kind: "manual_edit" | "interview"; interviewId?: string })` — third arg defaults to `{ kind: "manual_edit" }`, so all existing callers are unchanged.

- [ ] **Step 1: Widen the type.** Replace `src/lib/vendors/schema.ts` lines 20-26 with:

```ts
export type InterviewHistoryEntry = {
  at: string;
  actor: "operator";
  kind: "manual_edit" | "interview";
  changed: string[];
  version: number;
  interviewId?: string;
};
```

- [ ] **Step 2: Write the failing test.** `tests/integration/vendors-interview-history.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createVendorStub, updateVendorProfile } from "@/lib/vendors/data";
import type { VendorProfileInput } from "@/lib/vendors/schema";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["vendor_profiles"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

// A profile input that differs from the empty stub, so a version bump happens.
function baseInput(name: string): VendorProfileInput {
  return {
    name,
    capabilities: ["warehouse racking up to 12t/bay"],
    constraints: {},
    idealCustomer: undefined,
    knownGoodSignals: undefined,
    differentiators: undefined,
    credibility: undefined,
  };
}

describe("updateVendorProfile history source", () => {
  it("records an interview-kind entry carrying the interview id", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const updated = await updateVendorProfile(vendorId, baseInput("Acme"), {
      kind: "interview",
      interviewId: "iv-123",
    });
    const entry = updated.interviewHistory.at(-1);
    expect(entry?.kind).toBe("interview");
    expect(entry?.interviewId).toBe("iv-123");
  });

  it("defaults to a manual_edit entry when no source is given", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const updated = await updateVendorProfile(vendorId, baseInput("Acme"));
    const entry = updated.interviewHistory.at(-1);
    expect(entry?.kind).toBe("manual_edit");
    expect(entry?.interviewId).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.** Run: `npm test tests/integration/vendors-interview-history.test.ts`. Expected: FAIL — `updateVendorProfile` rejects the 3rd arg / records `manual_edit` regardless.

- [ ] **Step 4: Add the source arg.** In `src/lib/vendors/data.ts`, change the signature and the history entry. Replace the function header (lines 139-142):

```ts
export async function updateVendorProfile(
  vendorId: string,
  input: VendorProfileInput,
  source: { kind: "manual_edit" | "interview"; interviewId?: string } = { kind: "manual_edit" },
): Promise<VendorProfile> {
```

and replace the history-entry construction (lines 151-154) with:

```ts
  const history: InterviewHistoryEntry[] = [
    ...current.interviewHistory,
    {
      at: new Date().toISOString(),
      actor: "operator",
      kind: source.kind,
      changed,
      version: newVersion,
      ...(source.interviewId ? { interviewId: source.interviewId } : {}),
    },
  ];
```

- [ ] **Step 5: Run the test to verify it passes.** Run: `npm test tests/integration/vendors-interview-history.test.ts`. Expected: 2 pass.

- [ ] **Step 6: Regression + typecheck + lint.** Run: `npm test tests/integration/vendors-profile-data.test.ts && npm run typecheck && npm run lint`. Expected: existing vendor-profile tests still pass; clean.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/vendors/schema.ts src/lib/vendors/data.ts tests/integration/vendors-interview-history.test.ts
git commit -m "$(cat <<'EOF'
feat(vendors): record interview-sourced profile updates in history

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Export `stripAreaTag` from the SIA barrel

**Files:**
- Modify: `src/ai/sia/index.ts`
- Test: `tests/unit/ai/sia-index.test.ts`

**Interfaces:**
- Produces: `stripAreaTag` and `assessCoverage` are importable from `@/ai/sia` (both already exist in `./coverage`).

- [ ] **Step 1: Write the failing test.** `tests/unit/ai/sia-index.test.ts` (no DB, no API key — the barrel is DB-free):

```ts
import { describe, it, expect } from "vitest";
import { stripAreaTag, assessCoverage } from "@/ai/sia";

describe("@/ai/sia barrel", () => {
  it("re-exports stripAreaTag, which removes the [area:X] tag", () => {
    expect(stripAreaTag("What do you do?\n[area:capabilities]")).toBe("What do you do?");
  });

  it("re-exports assessCoverage", () => {
    expect(typeof assessCoverage).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run: `npm test tests/unit/ai/sia-index.test.ts`. Expected: FAIL — `stripAreaTag` is not exported from `@/ai/sia`.

- [ ] **Step 3: Add the export.** In `src/ai/sia/index.ts`, replace the `assessCoverage` line:

```ts
export { assessCoverage, stripAreaTag } from "./coverage";
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `npm test tests/unit/ai/sia-index.test.ts`. Expected: 2 pass.

- [ ] **Step 5: Typecheck + lint.** Run: `npm run typecheck && npm run lint`. Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add src/ai/sia/index.ts tests/unit/ai/sia-index.test.ts
git commit -m "$(cat <<'EOF'
feat(sia): export stripAreaTag from the engine barrel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Server actions + display types/helpers

**Files:**
- Create: `src/app/(app)/vendors/[vendorId]/interview/types.ts`
- Create: `src/app/(app)/vendors/[vendorId]/interview/view.ts`
- Create: `src/app/(app)/vendors/[vendorId]/interview/actions.ts`
- Test: `tests/integration/interview-actions.test.ts`

**Interfaces:**
- Consumes: `nextQuestion`, `extractProfile`, `assessCoverage`, `stripAreaTag` from `@/ai/sia`; `getVendor`, `updateVendorProfile` from `@/lib/vendors/data`; the Task 2 interview data layer; `auth` from `@/lib/auth`; `revalidatePath` from `next/cache`.
- Produces:
  - `types.ts`: `DisplayTurn = { role: "sia" | "vendor"; text: string }`; `TurnResult = { ok: true; interviewId: string; transcript: DisplayTurn[]; pendingQuestion: string; coverage: CoverageReport; isComplete: boolean } | { ok: false; error: string }`; `SaveResult = { ok: true; version: number } | { ok: false; error: string }`.
  - `view.ts`: `toDisplayTurns(messages)`, `pendingQuestionFrom(messages)`, `turnView(interviewId, messages, vendor): TurnResult`.
  - `actions.ts`: `startInterview(vendorId): Promise<TurnResult>`, `submitAnswer(interviewId, answer): Promise<TurnResult>`, `advanceInterview(interviewId): Promise<TurnResult>`, `saveInterview(interviewId): Promise<SaveResult>`, `endInterview(interviewId): Promise<void>`.

- [ ] **Step 1: Create the pure types.** `src/app/(app)/vendors/[vendorId]/interview/types.ts`:

```ts
import type { CoverageReport } from "@/ai/sia";

// Transcript turn as displayed: [area:X] tags stripped, system messages dropped.
export type DisplayTurn = { role: "sia" | "vendor"; text: string };

export type TurnResult =
  | {
      ok: true;
      interviewId: string;
      transcript: DisplayTurn[];
      pendingQuestion: string;
      coverage: CoverageReport;
      isComplete: boolean;
    }
  | { ok: false; error: string };

export type SaveResult = { ok: true; version: number } | { ok: false; error: string };
```

- [ ] **Step 2: Create the server display helpers.** `src/app/(app)/vendors/[vendorId]/interview/view.ts` (a plain server module — imported only by server code, keeps `@/ai/sia` out of the client bundle):

```ts
import type { LlmMessage } from "@/ai/llm";
import { assessCoverage, stripAreaTag } from "@/ai/sia";
import type { VendorProfile } from "@/lib/vendors/schema";
import type { DisplayTurn, TurnResult } from "./types";

// Map the stored transcript to display turns: drop the system message,
// strip [area:X] tags from assistant turns.
export function toDisplayTurns(messages: LlmMessage[]): DisplayTurn[] {
  return messages
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => ({
      role: m.role === "assistant" ? "sia" : "vendor",
      text: m.role === "assistant" ? stripAreaTag(m.content) : m.content,
    }));
}

// The pending question is the last assistant turn awaiting an answer; "" when
// the transcript is empty or ends with a vendor answer.
export function pendingQuestionFrom(messages: LlmMessage[]): string {
  const last = messages[messages.length - 1];
  return last && last.role === "assistant" ? stripAreaTag(last.content) : "";
}

export function turnView(interviewId: string, messages: LlmMessage[], vendor: VendorProfile): TurnResult {
  const coverage = assessCoverage({ messages, existingProfile: vendor });
  return {
    ok: true,
    interviewId,
    transcript: toDisplayTurns(messages),
    pendingQuestion: pendingQuestionFrom(messages),
    coverage,
    isComplete: coverage.isComplete,
  };
}
```

- [ ] **Step 3: Write the failing test.** `tests/integration/interview-actions.test.ts` (mocks the engine + auth + cache; real DB + real data layer):

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll, vi, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/ai/sia", () => ({
  nextQuestion: vi.fn(),
  extractProfile: vi.fn(),
  assessCoverage: vi.fn(() => ({ covered: [], remaining: ["capabilities"], isComplete: false })),
  stripAreaTag: (t: string) => t.replace(/\n?\[area:[A-Za-z]+\]\s*$/, "").trimEnd(),
}));

import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { createVendorStub, getVendor } from "@/lib/vendors/data";
import { createInterview, getInterview, getActiveInterview } from "@/lib/interviews/data";
import { nextQuestion, extractProfile } from "@/ai/sia";
import {
  startInterview,
  submitAnswer,
  saveInterview,
  endInterview,
} from "@/app/(app)/vendors/[vendorId]/interview/actions";
import type { VendorProfileInput } from "@/lib/vendors/schema";

function q(question: string, area = "capabilities") {
  return {
    question,
    transcriptEntry: { role: "assistant", content: `${question}\n[area:${area}]` },
    targetArea: area,
    coverage: { covered: [], remaining: ["capabilities"], isComplete: false },
  };
}
function baseInput(name: string): VendorProfileInput {
  return {
    name,
    capabilities: ["warehouse racking"],
    constraints: {},
    idealCustomer: undefined,
    knownGoodSignals: undefined,
    differentiators: undefined,
    credibility: undefined,
  };
}

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  vi.clearAllMocks();
  await truncateAll(["vendor_interviews", "vendor_profiles"]);
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

describe("interview actions", () => {
  it("startInterview creates a session and persists the first question", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    (nextQuestion as Mock).mockResolvedValue(q("What does your company do?"));
    const res = await startInterview(vendorId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pendingQuestion).toBe("What does your company do?");
    const active = await getActiveInterview(vendorId);
    expect(active?.messages).toHaveLength(1);
  });

  it("submitAnswer persists the answer then the next question", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    (nextQuestion as Mock).mockResolvedValue(q("Which geographies?", "constraints"));
    const res = await submitAnswer(iv.interviewId, "We do racking up to 12 tonnes per bay.");
    expect(res.ok).toBe(true);
    const got = await getInterview(iv.interviewId);
    expect(got?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("submitAnswer keeps the answer even when SIA fails", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    (nextQuestion as Mock).mockRejectedValue(new Error("all providers down"));
    const res = await submitAnswer(iv.interviewId, "We do racking up to 12 tonnes per bay.");
    expect(res.ok).toBe(false);
    const got = await getInterview(iv.interviewId);
    expect(got?.messages).toHaveLength(1);
    expect(got?.messages[0].role).toBe("user");
  });

  it("saveInterview extracts, versions the profile, and completes the interview", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    (extractProfile as Mock).mockResolvedValue({ value: baseInput("Acme"), provider: "anthropic" });
    const res = await saveInterview(iv.interviewId);
    expect(res).toEqual({ ok: true, version: 2 });
    const got = await getInterview(iv.interviewId);
    expect(got?.status).toBe("completed");
    expect(got?.resultingVersion).toBe(2);
    const vendor = await getVendor(vendorId);
    expect(vendor?.version).toBe(2);
    expect(vendor?.interviewHistory.at(-1)?.kind).toBe("interview");
  });

  it("endInterview abandons the active session", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const iv = await createInterview(vendorId);
    await endInterview(iv.interviewId);
    expect(await getActiveInterview(vendorId)).toBeNull();
  });

  it("rejects an unauthenticated caller", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as Mock).mockResolvedValueOnce(null);
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const res = await startInterview(vendorId);
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails.** Run: `npm test tests/integration/interview-actions.test.ts`. Expected: FAIL — `actions.ts` has no exports yet.

- [ ] **Step 5: Implement the actions.** `src/app/(app)/vendors/[vendorId]/interview/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { nextQuestion, extractProfile } from "@/ai/sia";
import { getVendor, updateVendorProfile } from "@/lib/vendors/data";
import {
  createInterview,
  getInterview,
  getActiveInterview,
  appendMessages,
  completeInterview,
  abandonInterview,
} from "@/lib/interviews/data";
import { turnView } from "./view";
import type { SaveResult, TurnResult } from "./types";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

// Generate the next question from the current stored transcript and persist it.
// Shared by startInterview / submitAnswer / advanceInterview. Throws on engine
// failure — callers catch and translate to a { ok: false } result.
async function askAndPersist(interviewId: string, vendorId: string): Promise<TurnResult> {
  const vendor = await getVendor(vendorId);
  if (!vendor) return { ok: false, error: "Vendor not found." };
  const interview = await getInterview(interviewId);
  if (!interview || interview.status !== "in_progress") {
    return { ok: false, error: "This interview is no longer active." };
  }
  const next = await nextQuestion({ messages: interview.messages, existingProfile: vendor });
  await appendMessages(interviewId, [next.transcriptEntry]);
  return turnView(interviewId, [...interview.messages, next.transcriptEntry], vendor);
}

export async function startInterview(vendorId: string): Promise<TurnResult> {
  if (!(await signedIn())) return { ok: false, error: "You must be signed in." };
  const vendor = await getVendor(vendorId);
  if (!vendor) return { ok: false, error: "Vendor not found." };

  const active = await getActiveInterview(vendorId);
  const interview = active ?? (await createInterview(vendorId));

  // Already has a pending question (resume) — return the current view as-is.
  const last = interview.messages[interview.messages.length - 1];
  if (last && last.role === "assistant") {
    return turnView(interview.interviewId, interview.messages, vendor);
  }
  try {
    return await askAndPersist(interview.interviewId, vendorId);
  } catch {
    return { ok: false, error: "SIA is unavailable right now. Please try again." };
  }
}

export async function submitAnswer(interviewId: string, answer: string): Promise<TurnResult> {
  if (!(await signedIn())) return { ok: false, error: "You must be signed in." };
  const trimmed = answer.trim();
  if (!trimmed) return { ok: false, error: "Enter the vendor's answer first." };

  const interview = await getInterview(interviewId);
  if (!interview || interview.status !== "in_progress") {
    return { ok: false, error: "This interview is no longer active." };
  }
  // Persist the answer BEFORE the LLM call so a provider failure can't lose it.
  await appendMessages(interviewId, [{ role: "user", content: trimmed }]);
  try {
    return await askAndPersist(interviewId, interview.vendorId);
  } catch {
    return { ok: false, error: "SIA is unavailable right now. Press retry to continue." };
  }
}

// Generate the next question without appending a new answer. Used to resume a
// session whose last turn is an answer, or to retry after an engine failure.
export async function advanceInterview(interviewId: string): Promise<TurnResult> {
  if (!(await signedIn())) return { ok: false, error: "You must be signed in." };
  const interview = await getInterview(interviewId);
  if (!interview || interview.status !== "in_progress") {
    return { ok: false, error: "This interview is no longer active." };
  }
  try {
    return await askAndPersist(interviewId, interview.vendorId);
  } catch {
    return { ok: false, error: "SIA is unavailable right now. Please try again." };
  }
}

export async function saveInterview(interviewId: string): Promise<SaveResult> {
  if (!(await signedIn())) return { ok: false, error: "You must be signed in." };
  const interview = await getInterview(interviewId);
  if (!interview || interview.status !== "in_progress") {
    return { ok: false, error: "This interview is no longer active." };
  }
  const vendor = await getVendor(interview.vendorId);
  if (!vendor) return { ok: false, error: "Vendor not found." };
  try {
    const { value, provider } = await extractProfile({
      messages: interview.messages,
      existingProfile: vendor,
    });
    const updated = await updateVendorProfile(interview.vendorId, value, {
      kind: "interview",
      interviewId,
    });
    await completeInterview(interviewId, updated.version, provider);
    revalidatePath(`/vendors/${interview.vendorId}`);
    revalidatePath(`/vendors/${interview.vendorId}/interview`);
    return { ok: true, version: updated.version };
  } catch {
    return { ok: false, error: "Could not save the profile. Please try again." };
  }
}

export async function endInterview(interviewId: string): Promise<void> {
  if (!(await signedIn())) return;
  const interview = await getInterview(interviewId);
  if (!interview || interview.status !== "in_progress") return;
  await abandonInterview(interviewId);
  revalidatePath(`/vendors/${interview.vendorId}`);
  revalidatePath(`/vendors/${interview.vendorId}/interview`);
}
```

- [ ] **Step 6: Run the test to verify it passes.** Run: `npm test tests/integration/interview-actions.test.ts`. Expected: 6 pass.

- [ ] **Step 7: Typecheck + lint.** Run: `npm run typecheck && npm run lint`. Expected: clean.

- [ ] **Step 8: Commit.**

```bash
git add "src/app/(app)/vendors/[vendorId]/interview/types.ts" "src/app/(app)/vendors/[vendorId]/interview/view.ts" "src/app/(app)/vendors/[vendorId]/interview/actions.ts" tests/integration/interview-actions.test.ts
git commit -m "$(cat <<'EOF'
feat(interview): server actions wiring the SIA engine to persistence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The interview screen (page + client component)

**Files:**
- Create: `src/app/(app)/vendors/[vendorId]/interview/page.tsx`
- Create: `src/app/(app)/vendors/[vendorId]/interview/interview-screen.tsx`
- Test: `tests/unit/components/interview-screen.test.tsx`

**Interfaces:**
- Consumes: `getVendor` (`@/lib/vendors/data`), `getActiveInterview`/`listInterviews` (`@/lib/interviews/data`), `turnView` (`./view`), the Task 5 actions, `PageHeader` (`@/app/components/ui/page-header`), `InterviewSummary` (`@/lib/interviews/schema`), `VendorProfile` (`@/lib/vendors/schema`), `InterviewArea` (`@/ai/sia`), `TurnResult` (`./types`).
- Produces: `InterviewScreen` (named export) and the default page component.

- [ ] **Step 1: Create the page (server component).** `src/app/(app)/vendors/[vendorId]/interview/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getVendor } from "@/lib/vendors/data";
import { getActiveInterview, listInterviews } from "@/lib/interviews/data";
import { turnView } from "./view";
import { InterviewScreen } from "./interview-screen";

export const metadata = { title: "SIA Interview — Radar" };

export default async function InterviewPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const vendor = await getVendor(vendorId);
  if (!vendor) notFound();

  const active = await getActiveInterview(vendorId);
  const past = await listInterviews(vendorId);
  const initialTurn = active ? turnView(active.interviewId, active.messages, vendor) : null;

  return <InterviewScreen vendor={vendor} initialTurn={initialTurn} past={past} />;
}
```

- [ ] **Step 2: Write the failing test.** `tests/unit/components/interview-screen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InterviewScreen } from "@/app/(app)/vendors/[vendorId]/interview/interview-screen";
import type { VendorProfile } from "@/lib/vendors/schema";
import type { TurnResult } from "@/app/(app)/vendors/[vendorId]/interview/types";
import type { InterviewSummary } from "@/lib/interviews/schema";

vi.mock("@/app/(app)/vendors/[vendorId]/interview/actions", () => ({
  startInterview: vi.fn(),
  submitAnswer: vi.fn(),
  advanceInterview: vi.fn(),
  saveInterview: vi.fn(),
  endInterview: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { submitAnswer, saveInterview } from "@/app/(app)/vendors/[vendorId]/interview/actions";

const vendor: VendorProfile = {
  vendorId: "v1",
  name: "Meridian Warehouse",
  capabilities: ["Racking up to 12t/bay"],
  constraints: { geographies: ["Maharashtra"] },
  idealCustomer: "3PLs building DCs",
  knownGoodSignals: null,
  differentiators: null,
  credibility: null,
  version: 2,
  interviewHistory: [],
};

function activeTurn(): TurnResult {
  return {
    ok: true,
    interviewId: "iv1",
    transcript: [
      { role: "sia", text: "What does your company do?" },
      { role: "vendor", text: "We build warehouses." },
    ],
    pendingQuestion: "Which geographies do you serve?",
    coverage: { covered: ["capabilities"], remaining: ["constraints", "idealCustomer", "knownGoodSignals", "differentiators"], isComplete: false },
    isComplete: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InterviewScreen", () => {
  it("shows the launch state with past interviews when there is no active interview", () => {
    const past: InterviewSummary[] = [
      { interviewId: "iv0", status: "completed", startedAt: "2026-06-01T10:00:00.000Z", completedAt: "2026-06-01T10:30:00.000Z", resultingVersion: 2, messageCount: 8 },
    ];
    render(<InterviewScreen vendor={vendor} initialTurn={null} past={past} />);
    expect(screen.getByRole("button", { name: "Start interview" })).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
  });

  it("renders an active transcript with SIA and vendor rows", () => {
    render(<InterviewScreen vendor={vendor} initialTurn={activeTurn()} past={[]} />);
    expect(screen.getByText("What does your company do?")).toBeInTheDocument();
    expect(screen.getByText("We build warehouses.")).toBeInTheDocument();
    expect(screen.getByText("Which geographies do you serve?")).toBeInTheDocument();
  });

  it("submits an answer through the submitAnswer action", async () => {
    (submitAnswer as Mock).mockResolvedValue(activeTurn());
    const user = userEvent.setup();
    render(<InterviewScreen vendor={vendor} initialTurn={activeTurn()} past={[]} />);
    await user.type(screen.getByLabelText("Vendor answer"), "We serve Maharashtra and Gujarat.");
    await user.click(screen.getByRole("button", { name: "Continue interview" }));
    expect(submitAnswer).toHaveBeenCalledWith("iv1", "We serve Maharashtra and Gujarat.");
  });

  it("saves through the saveInterview action", async () => {
    (saveInterview as Mock).mockResolvedValue({ ok: true, version: 3 });
    const user = userEvent.setup();
    render(<InterviewScreen vendor={vendor} initialTurn={activeTurn()} past={[]} />);
    await user.click(screen.getByRole("button", { name: "Save & version v3" }));
    expect(saveInterview).toHaveBeenCalledWith("iv1");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.** Run: `npm test tests/unit/components/interview-screen.test.tsx`. Expected: FAIL — `InterviewScreen` does not exist.

- [ ] **Step 4: Implement the client component.** `src/app/(app)/vendors/[vendorId]/interview/interview-screen.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/app/components/ui/page-header";
import type { VendorProfile, VendorConstraints } from "@/lib/vendors/schema";
import type { InterviewArea } from "@/ai/sia";
import type { InterviewSummary } from "@/lib/interviews/schema";
import type { TurnResult } from "./types";
import { startInterview, submitAnswer, advanceInterview, saveInterview, endInterview } from "./actions";

const PANEL_AREAS: { key: InterviewArea; label: string }[] = [
  { key: "capabilities", label: "Capabilities" },
  { key: "constraints", label: "Constraints" },
  { key: "idealCustomer", label: "Ideal customer" },
];

function hasProfileContent(v: VendorProfile): boolean {
  return (
    v.capabilities.length > 0 ||
    Boolean(v.idealCustomer) ||
    Boolean(v.knownGoodSignals) ||
    Boolean(v.differentiators) ||
    Boolean(v.credibility) ||
    (v.constraints != null && Object.keys(v.constraints).length > 0)
  );
}

function constraintItems(c: VendorConstraints | null): string[] {
  if (!c) return [];
  const out: string[] = [];
  if (c.geographies?.length) out.push(c.geographies.join(", "));
  if (c.minProjectSize) out.push(`Min: ${c.minProjectSize}`);
  if (c.maxProjectSize) out.push(`Max: ${c.maxProjectSize}`);
  if (c.capacity) out.push(c.capacity);
  if (c.currentLoad) out.push(c.currentLoad);
  if (c.workingCapitalLimit) out.push(c.workingCapitalLimit);
  if (c.leadTimes) out.push(c.leadTimes);
  return out;
}

function itemsFor(area: InterviewArea, v: VendorProfile): string[] {
  if (area === "capabilities") return v.capabilities;
  if (area === "constraints") return constraintItems(v.constraints);
  if (area === "idealCustomer") return v.idealCustomer ? [v.idealCustomer] : [];
  return [];
}

function avatarFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "V";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function InterviewScreen({
  vendor,
  initialTurn,
  past,
}: {
  vendor: VendorProfile;
  initialTurn: TurnResult | null;
  past: InterviewSummary[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [turn, setTurn] = useState<Extract<TurnResult, { ok: true }> | null>(
    initialTurn && initialTurn.ok ? initialTurn : null,
  );
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const autoAdvanced = useRef(false);

  function apply(result: TurnResult) {
    if (result.ok) {
      setTurn(result);
      setError(null);
    } else {
      setError(result.error);
    }
  }

  // Resume a session left without a pending question (crash between answer and
  // question generation): generate the next question once on mount.
  useEffect(() => {
    if (turn && turn.pendingQuestion === "" && !autoAdvanced.current && !isPending) {
      autoAdvanced.current = true;
      startTransition(async () => apply(await advanceInterview(turn.interviewId)));
    }
  }, [turn, isPending]);

  function onStart() {
    startTransition(async () => apply(await startInterview(vendor.vendorId)));
  }
  function onSubmitAnswer(e: FormEvent) {
    e.preventDefault();
    if (!turn) return;
    const value = answer.trim();
    if (!value) return;
    setAnswer("");
    startTransition(async () => apply(await submitAnswer(turn.interviewId, value)));
  }
  function onSave() {
    if (!turn) return;
    startTransition(async () => {
      const res = await saveInterview(turn.interviewId);
      if (res.ok) router.push(`/vendors/${vendor.vendorId}`);
      else setError(res.error);
    });
  }
  function onEnd() {
    if (!turn) return;
    startTransition(async () => {
      await endInterview(turn.interviewId);
      router.push(`/vendors/${vendor.vendorId}`);
    });
  }

  // ---- Launch state ---------------------------------------------------------
  if (!turn) {
    return (
      <>
        <PageHeader eyebrow="Build" title={`Interview · ${vendor.name}`} />
        <section className="card card-pad">
          <p className="muted">
            {hasProfileContent(vendor)
              ? "Start a new interview to append and amend this vendor's profile. SIA asks only about what's new or changed."
              : "Start the first interview. SIA will build the profile from the vendor's answers, one question at a time."}
          </p>
          <button type="button" className="btn btn-primary" onClick={onStart} disabled={isPending}>
            {isPending ? "Starting…" : hasProfileContent(vendor) ? "Start re-interview" : "Start interview"}
          </button>
          {error && (
            <p role="alert" className="muted">
              {error}
            </p>
          )}
        </section>
        {past.length > 0 && (
          <section className="card card-pad" style={{ marginTop: "var(--space-4)" }}>
            <div className="eyebrow">Past interviews</div>
            <ul className="past-list">
              {past.map((p) => (
                <li key={p.interviewId}>
                  <span className="mono">{formatDate(p.startedAt)}</span> · {p.status}
                  {p.resultingVersion ? ` → v${p.resultingVersion}` : ""} · {p.messageCount} turns
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  // ---- Active interview -----------------------------------------------------
  const nextVersion = vendor.version + 1;
  return (
    <div className="sia-layout">
      <section className="interview card card-pad">
        <div className="iv-head">
          <div className="who">
            <span className="brand-mark" style={{ width: 30, height: 30, background: "var(--accent)" }}>
              SIA
            </span>
            <div>
              <div style={{ fontWeight: "var(--weight-semibold)" }}>{vendor.name}</div>
              <div className="faint" style={{ fontSize: "var(--text-xs)" }}>
                {hasProfileContent(vendor) ? "Re-interview · append & amend" : "First interview"}
              </div>
            </div>
          </div>
          <span className="ver-chip">
            v{vendor.version} → v{nextVersion}
          </span>
        </div>

        <div className="thread" id="thread">
          {turn.transcript.map((m, i) => (
            <div className={`msg ${m.role}`} key={i}>
              <span className="av">{m.role === "sia" ? "SIA" : avatarFor(vendor.name)}</span>
              <div>
                <div className="who-line">{m.role === "sia" ? "SIA" : `${vendor.name} (vendor)`}</div>
                <div className="bubble">{m.text}</div>
              </div>
            </div>
          ))}
          {turn.pendingQuestion && turn.transcript[turn.transcript.length - 1]?.role !== "sia" && (
            <div className="msg sia">
              <span className="av">SIA</span>
              <div>
                <div className="who-line">SIA</div>
                <div className="bubble">{turn.pendingQuestion}</div>
              </div>
            </div>
          )}
          {isPending && (
            <div className="msg sia">
              <span className="av">SIA</span>
              <div>
                <div className="who-line">SIA</div>
                <div className="bubble muted">Thinking…</div>
              </div>
            </div>
          )}
        </div>

        <form className="composer" onSubmit={onSubmitAnswer}>
          <input
            id="ci"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type the vendor's answer, or press Continue…"
            aria-label="Vendor answer"
            disabled={isPending}
          />
          <button type="submit" className="btn btn-primary" disabled={isPending || !answer.trim()}>
            Continue interview
          </button>
        </form>
        <div className="row between" style={{ marginTop: "var(--space-3)" }}>
          <button type="button" className="btn btn-ghost" onClick={onEnd} disabled={isPending}>
            End interview
          </button>
          <button
            type="button"
            className={`btn ${turn.isComplete ? "btn-primary" : ""}`}
            onClick={onSave}
            disabled={isPending}
          >
            Save &amp; version v{nextVersion}
          </button>
        </div>
        {error && (
          <p role="alert" className="muted" style={{ marginTop: "var(--space-2)" }}>
            {error}
          </p>
        )}
      </section>

      <aside className="side">
        <div className="card card-pad">
          <div className="panel-head" style={{ marginBottom: "var(--space-3)" }}>
            <h2 style={{ fontSize: "var(--text-md)" }}>Profile forming</h2>
            <span className="count-pill">v{nextVersion} draft</span>
          </div>
          {PANEL_AREAS.map(({ key, label }) => {
            const items = itemsFor(key, vendor);
            const covered = turn.coverage.covered.includes(key);
            return (
              <div className="prof-section" key={key}>
                <div className="eyebrow">
                  <span>{label}</span>
                  <span className="dots">
                    <i className={covered ? "on" : ""} />
                  </span>
                </div>
                {items.length > 0 ? (
                  items.map((it, i) => (
                    <div className="prof-item" key={i}>
                      {it}
                    </div>
                  ))
                ) : (
                  <div className="prof-item">
                    <span className="thin">● not yet pinned</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="card inset card-pad">
          <div className="eyebrow" style={{ marginBottom: "var(--space-2)" }}>
            Operator co-pilot
          </div>
          <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
            SIA probes for precision where the profile is thin. Vague answers make weak leads — push for
            specifics on anything still marked <span className="thin">● not yet pinned</span>.
          </p>
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes.** Run: `npm test tests/unit/components/interview-screen.test.tsx`. Expected: 4 pass.

- [ ] **Step 6: Typecheck + lint.** Run: `npm run typecheck && npm run lint`. Expected: clean.

- [ ] **Step 7: Commit.**

```bash
git add "src/app/(app)/vendors/[vendorId]/interview/page.tsx" "src/app/(app)/vendors/[vendorId]/interview/interview-screen.tsx" tests/unit/components/interview-screen.test.tsx
git commit -m "$(cat <<'EOF'
feat(interview): interview screen — server page + co-piloted client UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: CSS port + vendor-detail entry link

**Files:**
- Modify: `src/app/styles/command.css` (append the interview block)
- Modify: `src/app/(app)/vendors/[vendorId]/page.tsx` (entry link)

**Interfaces:**
- Consumes: `getActiveInterview` (`@/lib/interviews/data`); the classes ported here back the Task 6 component.
- No new test — this task is presentational (CSS) plus one `<Link>`; verified by `npm run build` and the manual run smoke below.

- [ ] **Step 1: Port the mockup CSS.** Append to `src/app/styles/command.css` (ported verbatim from `mockups/v2/command/interview.html` lines 16–43, omitting the deferred `probe-flag`/`nudge`/`cand-wrap`; adds `.past-list`):

```css
/* --- SIA interview (slice 2c) ------------------------------------------- */
.sia-layout { display: grid; grid-template-columns: 1fr minmax(320px, 380px); gap: var(--space-5); align-items: start; }
.interview { display: flex; flex-direction: column; min-height: calc(100vh - 170px); }
.iv-head { display: flex; align-items: center; gap: var(--space-3); justify-content: space-between; margin-bottom: var(--space-5); }
.iv-head .who { display: flex; align-items: center; gap: var(--space-3); }
.ver-chip { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--accent); background: var(--accent-soft); padding: 1px var(--space-2); border-radius: var(--radius-full); }
.thread { display: flex; flex-direction: column; gap: var(--space-4); }
.thread .msg { display: grid; grid-template-columns: 28px 1fr; gap: var(--space-3); }
.thread .msg .av { width: 28px; height: 28px; border-radius: var(--radius-md); display: grid; place-items: center; font-family: var(--font-mono); font-size: var(--text-2xs); font-weight: var(--weight-bold); flex: none; }
.thread .msg.sia .av { background: var(--accent); color: var(--accent-contrast); }
.thread .msg.vendor .av { background: var(--surface-inset); color: var(--text-muted); }
.thread .msg .who-line { font-size: var(--text-2xs); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: var(--tracking-wide); color: var(--text-faint); margin-bottom: 3px; }
.thread .msg .bubble { font-size: var(--text-md); line-height: var(--leading-normal); }
.thread .msg.vendor .bubble { color: var(--text-muted); }
.composer { margin-top: auto; padding-top: var(--space-5); display: flex; gap: var(--space-3); align-items: center; }
.composer input { flex: 1; padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); border: var(--border-w) solid var(--border); background: var(--surface); font-size: var(--text-sm); }
.composer input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.side { display: flex; flex-direction: column; gap: var(--space-4); position: sticky; top: 112px; }
.prof-section { padding: var(--space-4) 0; border-top: var(--border-w) solid var(--border); }
.prof-section:first-child { border-top: 0; padding-top: 0; }
.prof-section .eyebrow { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-3); }
.prof-item { font-size: var(--text-sm); padding: var(--space-1) 0; display: flex; gap: var(--space-2); }
.prof-item::before { content: "›"; color: var(--text-faint); }
.prof-item.added { animation: slide-in var(--dur-slow) var(--ease-out); }
.thin { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: var(--tracking-wide); color: var(--warning); }
.dots { display: inline-flex; gap: 3px; }
.dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--border-strong); }
.dots i.on { background: var(--success); }
.past-list { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-muted); }
@media (max-width: 980px) { .sia-layout { grid-template-columns: 1fr; } .side { position: static; } }
```

- [ ] **Step 2: Add the entry link.** Edit `src/app/(app)/vendors/[vendorId]/page.tsx`. Add imports and fetch the active interview, then render a link. New file contents:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/app/components/ui/page-header";
import { getVendor } from "@/lib/vendors/data";
import { getActiveInterview } from "@/lib/interviews/data";
import { EditProfileForm } from "./edit-profile-form";

export const metadata = { title: "Vendor — Radar" };

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const vendor = await getVendor(vendorId);
  if (!vendor) notFound();

  const active = await getActiveInterview(vendorId);

  return (
    <>
      <PageHeader eyebrow="Build" title={vendor.name} />
      <p className="profile-meta">Version {vendor.version}</p>
      <p>
        <Link href={`/vendors/${vendorId}/interview`} className="btn btn-primary">
          {active ? "Continue interview" : "Start interview"}
        </Link>
      </p>
      <EditProfileForm vendor={vendor} />
    </>
  );
}
```

- [ ] **Step 3: Build.** Run: `npm run build`. Expected: compiles; the `/vendors/[vendorId]/interview` route appears in the route list; no "Anthropic SDK bundled into client" or module errors.

- [ ] **Step 4: Full suite + typecheck + lint.** Run: `npm test && npm run typecheck && npm run lint`. Expected: all green.

- [ ] **Step 5: Commit.**

```bash
git add src/app/styles/command.css "src/app/(app)/vendors/[vendorId]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(interview): port interview CSS + vendor-detail entry link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Testable checkpoint (after Task 7)

Deliver this to the operator to test on the platform:

1. Apply the migration to the dev DB: `npm run db:migrate` (needs `DATABASE_URL`/`DIRECT_URL`).
2. `npm run dev`, sign in, open a vendor (create one via **Add vendor** if needed).
3. On the vendor page, click **Start interview** → answer SIA's questions turn-by-turn; watch coverage dots fill and the profile panel show on-file values.
4. Click **Save & version v{n}** → returns to the vendor page at the bumped version; the history records an `interview` entry.
5. Re-open **Start interview** → confirm it's a **Re-interview · append & amend** (prior profile preserved, only deltas probed).
6. Refresh mid-interview → the session resumes with the transcript intact (persistence works).

A live-provider smoke exercises the real Anthropic path (the mocked tests don't). The engine failure path returns a friendly retry without losing the persisted answer.

## Self-review (against the spec)

- **§4 data model** → Task 1 (enum, table, partial unique index, migration). ✔
- **§5 persistence module** → Task 2 (all 7 functions, atomic append, summary without transcript). ✔
- **§4.3 vendors change** → Task 3 (widened entry + defaulted source arg; existing caller untouched). ✔
- **§6 tag stripping barrel export** → Task 4. ✔
- **§6 server actions** (start/submit/advance/save/end, auth-gated, structured returns, answer-before-LLM) → Task 5. ✔
- **§7 UI** (server page, client screen, launch + active states, coverage dots, profile panel, copy verbatim, `#cand-wrap` omitted) → Task 6. ✔
- **§7.3 CSS / §7.4 entry point** → Task 7. ✔
- **§8 error handling** (LLM failure retry via `advanceInterview`, auth, not-found, empty answers, concurrency via unique index) → Tasks 5 + 6. ✔
- **§9 testing** (integration for schema/data/actions/vendors-history, unit for barrel + component) → Tasks 1–6. ✔
- **Client-bundle rule** (engine never in the client) → enforced by `view.ts`/`types.ts` split; verified by Task 7 build. ✔
- **Placeholder scan:** none. **Type consistency:** `TurnResult`/`SaveResult`/`DisplayTurn` defined in Task 5 `types.ts` and consumed identically in Tasks 5–6; action names match across `actions.ts`, the component mock, and the integration test.
