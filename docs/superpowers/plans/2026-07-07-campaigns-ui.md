# Campaigns UI Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CLI with radar's UI front door for campaigns — a **"Find Leads"** control + a **readiness gate** on the vendor page, a top-level **Campaigns** section (list + detail), and a light **dashboard strip** — all calling the already-built `runCampaignForVendor` / `listCampaigns` / `getCampaign` backend.

**Architecture:** Next.js 15 App Router, matching radar's existing section conventions exactly: server-component pages that `await` a DB-injected data function, `"use server"` actions with a per-file `signedIn()` guard + zod validation + `revalidatePath`, client components via `useActionState`/`useTransition`, and the design-system CSS classes (`.btn`, `.badge-*`, `.card`, `.page-header`, `.empty-state`). The readiness gate reuses `buildSourcingPlan().runnable` (Plan 1). No new backend capability except a small shared readiness helper.

**Tech Stack:** Next.js 15 (RSC + Server Actions), React 19 (`useActionState`, `useTransition`), TypeScript, Drizzle/Neon, Vitest (integration for actions/data with `testDb` + mocked `@/lib/auth`/`next/cache`; jsdom + Testing Library for components).

## Global Constraints

- **Design settled:** the approved operator journey (Acts 1–3) + spec `docs/superpowers/specs/2026-07-06-campaigns-design.md` §6.5. Plans 1 & 3 are merged on `main` (backend complete).
- **Campaigns data layer is DB-INJECTED** (unlike `vendors`/`mappings`): import `{ db }` from `@/db/client` in pages/actions and pass it — `listCampaigns(db, vendorId?)`, `getCampaign(db, id)`, `createCampaign(db, …)`. `runCampaignForVendor(db, { vendorId, source, geography, target })` (`@/db/campaign-run`) → `{ campaignId, stats }` is the orchestration for "Find Leads".
- **Auth:** routes are gated by `src/middleware.ts` (no per-page check needed). Server actions re-check with a per-file `async function signedIn() { const session = await auth(); return Boolean(session?.user); }` (import `auth` from `@/lib/auth`), returning an error object when not signed in — the established pattern.
- **Next 15 async APIs:** `params` and `searchParams` are Promises — `await` them.
- **Execution model:** the "Find Leads" action calls `runCampaignForVendor` **synchronously** (no queue infra exists). For `source: "crustdata"` this is a slow request (a live network call) — the client MUST show a pending state ("Sourcing…") and disable the button while it runs. Acceptable for v1 (bounded by the 25-row cap).
- **Source choice:** the form offers **Live (Crustdata)** = `"crustdata"` (default) and **Test data** = `"company-fixture"`, so the operator can exercise the flow without a key/credits.
- **Scope — DEFERRED (needs backend not built in Plans 1/3):** the "Advanced" panel's mapping-picker + funding/company-size filters (the `CompanyQuery` has no such params, and `runCampaignForVendor` doesn't accept them). Ship the **minimal** form (geography + target + source) only; note the Advanced panel as a follow-up requiring backend query params.
- **Follow existing UI patterns exactly** (from the section exemplars `mappings`/`leads`/`vendors`): `<PageHeader eyebrow=… title=…/>`, `<EmptyState icon=… .../>` for true-empty, `.btn`/`.btn-primary`, `.badge badge-{status}`, `.back-link`, `.readiness-panel`/`.readiness-ok`/`.readiness-warn`, `.card`. New CSS only for the campaign statuses (`queued|running|done|failed`) which have no existing `badge-*` rules.
- **Tests:** actions → `tests/integration/*-action.test.ts` (mock `@/lib/auth` + `next/cache`, use `testDb`, call the action directly with `FormData`); components → `tests/unit/components/*.test.tsx` (`// @vitest-environment jsdom`, Testing Library, fixture props); readiness helper → `tests/integration/`.
- **Branch:** `feature/campaigns-ui` off `main`. One commit per task.

---

### Task 1: Sourcing-readiness helper

**Files:**
- Create: `src/lib/campaigns/plan-inputs.ts` (shared query-gathering, so `run.ts` and readiness don't duplicate)
- Modify: `src/lib/campaigns/run.ts` (use the shared gatherer)
- Create: `src/lib/campaigns/readiness.ts`
- Test: `tests/integration/campaigns-readiness.test.ts`

**Interfaces:**
- Produces:
  - `gatherPlanInputs(db, vendorId): Promise<{ vendorType: string | null; plan: SourcingPlan } | null>` (null when the vendor doesn't exist) — the vendor + approved-mappings + signal-defs queries + `buildSourcingPlan`, factored out of `run.ts`.
  - `getSourcingReadiness(db, vendorId): Promise<{ found: boolean; runnable: boolean; vendorType: string | null; signalFamilies: SignalFamily[] }>` — UI-facing readiness.
- Consumes: `buildSourcingPlan`, `PlanMapping`, `PlanSignalDef` (`@/lib/campaigns/plan`); schema tables; `SignalFamily` (`@/lib/sourcing/company-schema`).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/campaigns-readiness.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { seedSignals } from "@/db/seed-signals";
import { seedOpsSignals } from "@/db/seed-ops-signals";
import { vendorProfiles } from "@/db/schema";
import { getSourcingReadiness } from "@/lib/campaigns/readiness";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["mappings", "signal_definitions", "vendor_profiles"]); });
afterAll(async () => { await closeTestDb(); });

describe("getSourcingReadiness", () => {
  it("is runnable for an Infra vendor once the ops config is seeded", async () => {
    await seedSignals(testDb); await seedOpsSignals(testDb);
    const [v] = await testDb.insert(vendorProfiles).values({ name: "RackPro", vendorType: "Infra" }).returning();
    const r = await getSourcingReadiness(testDb, v.vendorId);
    expect(r.found).toBe(true);
    expect(r.runnable).toBe(true);
    expect(r.signalFamilies.length).toBeGreaterThan(0);
  });

  it("is not runnable for a vendor whose type matches no approved mapping", async () => {
    await seedSignals(testDb); await seedOpsSignals(testDb);
    const [v] = await testDb.insert(vendorProfiles).values({ name: "Mktg Co", vendorType: "Mktg" }).returning();
    const r = await getSourcingReadiness(testDb, v.vendorId);
    expect(r.found).toBe(true);
    expect(r.runnable).toBe(false);
  });

  it("reports not-found for a missing vendor", async () => {
    const r = await getSourcingReadiness(testDb, "00000000-0000-0000-0000-000000000000");
    expect(r.found).toBe(false);
    expect(r.runnable).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/campaigns-readiness.test.ts`
Expected: FAIL — cannot find module `@/lib/campaigns/readiness`.

- [ ] **Step 3: Extract the shared plan-inputs gatherer**

Create `src/lib/campaigns/plan-inputs.ts`:
```ts
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only
import { mappings, signalDefinitions, vendorProfiles } from "@/db/schema";
import { buildSourcingPlan, type PlanMapping, type PlanSignalDef, type SourcingPlan } from "@/lib/campaigns/plan";
import type { SignalFamily } from "@/lib/sourcing/company-schema";

/**
 * Gather everything buildSourcingPlan needs for a vendor: the vendor's type, its type-matched
 * approved mappings, and the approved signal defs. Returns null when the vendor doesn't exist.
 * Shared by runCampaign and the readiness helper so the query logic lives in ONE place.
 */
export async function gatherPlanInputs(
  db: DB, vendorId: string,
): Promise<{ vendorType: string | null; plan: SourcingPlan } | null> {
  const [vendor] = await db
    .select({ vendorType: vendorProfiles.vendorType })
    .from(vendorProfiles).where(eq(vendorProfiles.vendorId, vendorId)).limit(1);
  if (!vendor) return null;

  const vType = (vendor.vendorType ?? "").toLowerCase();
  const approved = await db
    .select({
      requiredSignals: mappings.requiredSignals,
      supportingSignals: mappings.supportingSignals,
      timingWindowDays: mappings.timingWindowDays,
      servesVendorType: mappings.servesVendorType,
    })
    .from(mappings).where(eq(mappings.status, "approved"));
  const vendorMappings: PlanMapping[] = approved
    .filter((m) => (m.servesVendorType ?? "").toLowerCase() === vType)
    .map((m) => ({ requiredSignals: m.requiredSignals, supportingSignals: m.supportingSignals, timingWindowDays: m.timingWindowDays }));

  const defRows = await db
    .select({ signalId: signalDefinitions.signalId, family: signalDefinitions.family, freshnessWindowDays: signalDefinitions.freshnessWindowDays })
    .from(signalDefinitions).where(eq(signalDefinitions.status, "approved"));
  const signalDefs: PlanSignalDef[] = defRows.map((d) => ({ signalId: d.signalId, family: d.family as SignalFamily, freshnessWindowDays: d.freshnessWindowDays }));

  return { vendorType: vendor.vendorType, plan: buildSourcingPlan({ vendorType: vendor.vendorType }, vendorMappings, signalDefs) };
}
```

- [ ] **Step 4: Refactor `run.ts` to use the shared gatherer**

In `src/lib/campaigns/run.ts`, replace the inline vendor/mappings/defs queries + `buildSourcingPlan` (the block that selects the vendor, builds `vendorMappings`, `signalDefs`, and calls `buildSourcingPlan`) with a single call. The block currently reads roughly:
```ts
    const [vendor] = await db.select({ vendorId: vendorProfiles.vendorId, vendorType: vendorProfiles.vendorType })
      .from(vendorProfiles).where(eq(vendorProfiles.vendorId, campaign.vendorId)).limit(1);
    if (!vendor) throw new Error("vendor not found");
    const vType = (vendor.vendorType ?? "").toLowerCase();
    const approvedMappings = await db.select({ … }).from(mappings).where(eq(mappings.status, "approved"));
    const vendorMappings: PlanMapping[] = approvedMappings.filter(…).map(…);
    const defRows = await db.select({ … }).from(signalDefinitions).where(eq(signalDefinitions.status, "approved"));
    const signalDefs: PlanSignalDef[] = defRows.map(…);
    const plan = buildSourcingPlan({ vendorType: vendor.vendorType }, vendorMappings, signalDefs);
    if (!plan.runnable) throw new Error("vendor has no approved mappings — nothing to source");
```
Replace all of the above with:
```ts
    const inputs = await gatherPlanInputs(db, campaign.vendorId);
    if (!inputs) throw new Error("vendor not found");
    const { vendorType, plan } = inputs;
    if (!plan.runnable) throw new Error("vendor has no approved mappings — nothing to source");
```
Add `import { gatherPlanInputs } from "@/lib/campaigns/plan-inputs";`. Then update the one downstream reference: the code builds `const query: CompanyQuery = { … }` and later reads `vendor.vendorType` — nothing else in `run.ts` uses `vendor`/`vType`/`vendorMappings`/`signalDefs` after the plan is built (the query uses `plan.fundedSinceDays`/`plan.signalFamilies` and `campaign.config`). Remove now-unused imports (`vendorProfiles`, `mappings`, `signalDefinitions`, `PlanMapping`, `PlanSignalDef`, `buildSourcingPlan`, and `SignalFamily` if unused) — let `tsc` and eslint tell you which are now unused, and delete exactly those.

- [ ] **Step 5: Write the readiness helper**

Create `src/lib/campaigns/readiness.ts`:
```ts
import type { DB } from "@/db/client"; // type-only
import { gatherPlanInputs } from "@/lib/campaigns/plan-inputs";
import type { SignalFamily } from "@/lib/sourcing/company-schema";

export type SourcingReadiness = {
  found: boolean;
  runnable: boolean;
  vendorType: string | null;
  signalFamilies: SignalFamily[];
};

/** UI-facing "ready to source?" for a vendor. runnable === the vendor has ≥1 type-matched approved mapping whose signals resolve. */
export async function getSourcingReadiness(db: DB, vendorId: string): Promise<SourcingReadiness> {
  const inputs = await gatherPlanInputs(db, vendorId);
  if (!inputs) return { found: false, runnable: false, vendorType: null, signalFamilies: [] };
  return {
    found: true,
    runnable: inputs.plan.runnable,
    vendorType: inputs.vendorType,
    signalFamilies: inputs.plan.signalFamilies,
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/integration/campaigns-readiness.test.ts tests/integration/campaigns-run.test.ts`
Expected: both PASS — the new readiness cases AND the Plan-1 orchestrator test (proving the `run.ts` refactor preserved behavior). Then `npm run typecheck` clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/campaigns/plan-inputs.ts src/lib/campaigns/run.ts src/lib/campaigns/readiness.ts tests/integration/campaigns-readiness.test.ts
git commit -m "feat(campaigns): sourcing-readiness helper + shared plan-inputs gatherer"
```

---

### Task 2: Find-Leads server action

**Files:**
- Create: `src/app/(app)/campaigns/actions.ts`
- Test: `tests/integration/campaigns-action.test.ts`

**Interfaces:**
- Produces: `findLeadsAction(prev: FindLeadsState, formData: FormData): Promise<FindLeadsState>` where `FindLeadsState = { ok: boolean; campaignId?: string; error?: string }`. Reads `vendorId`, `geography`, `target`, `source` from the form; auth-guards; validates; checks readiness; runs `runCampaignForVendor`; returns the new `campaignId` on success.
- Consumes: `auth` (`@/lib/auth`), `db` (`@/db/client`), `getSourcingReadiness` (Task 1), `runCampaignForVendor` (`@/db/campaign-run`), `revalidatePath`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/campaigns-action.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { seedSignals } from "@/db/seed-signals";
import { seedOpsSignals } from "@/db/seed-ops-signals";
import { vendorProfiles, campaigns } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { findLeadsAction } from "@/app/(app)/campaigns/actions";
import { auth } from "@/lib/auth";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["campaign_leads", "company_snapshots", "leads", "campaigns", "signal_observations", "mappings", "signal_definitions", "companies", "vendor_profiles"]);
  vi.clearAllMocks();
});
afterAll(async () => { await closeTestDb(); await queryClient.end(); });

async function infraVendor() {
  await seedSignals(testDb); await seedOpsSignals(testDb);
  const [v] = await testDb.insert(vendorProfiles).values({ name: "RackPro", vendorType: "Infra" }).returning();
  return v.vendorId;
}
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("findLeadsAction", () => {
  it("runs a fixture campaign and returns the new campaignId", async () => {
    const vendorId = await infraVendor();
    const res = await findLeadsAction({ ok: false }, form({ vendorId, geography: "IND", target: "10", source: "company-fixture" }));
    expect(res.ok).toBe(true);
    expect(res.campaignId).toBeTruthy();
    const [c] = await testDb.select().from(campaigns).where(eq(campaigns.campaignId, res.campaignId!));
    expect(c.status).toBe("done");
    expect(c.source).toBe("company-fixture");
  });

  it("rejects an unauthenticated caller without creating a campaign", async () => {
    const vendorId = await infraVendor();
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const res = await findLeadsAction({ ok: false }, form({ vendorId, geography: "IND", target: "10", source: "company-fixture" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/signed in/i);
    expect(await testDb.select().from(campaigns)).toHaveLength(0);
  });

  it("refuses a vendor that is not ready to source", async () => {
    await seedSignals(testDb); await seedOpsSignals(testDb);
    const [v] = await testDb.insert(vendorProfiles).values({ name: "Mktg", vendorType: "Mktg" }).returning();
    const res = await findLeadsAction({ ok: false }, form({ vendorId: v.vendorId, geography: "IND", target: "10", source: "company-fixture" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/mapping/i);
    expect(await testDb.select().from(campaigns)).toHaveLength(0);
  });

  it("rejects invalid input (bad target)", async () => {
    const vendorId = await infraVendor();
    const res = await findLeadsAction({ ok: false }, form({ vendorId, geography: "IND", target: "abc", source: "company-fixture" }));
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/campaigns-action.test.ts`
Expected: FAIL — cannot find module `@/app/(app)/campaigns/actions`.

- [ ] **Step 3: Write the action**

Create `src/app/(app)/campaigns/actions.ts`:
```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { getSourcingReadiness } from "@/lib/campaigns/readiness";
import { runCampaignForVendor } from "@/db/campaign-run";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export type FindLeadsState = { ok: boolean; campaignId?: string; error?: string };

const findLeadsSchema = z.object({
  vendorId: z.string().uuid(),
  geography: z.string().min(2).max(8).default("IND"),
  target: z.coerce.number().int().min(1).max(25),
  source: z.enum(["crustdata", "company-fixture"]).default("crustdata"),
});

export async function findLeadsAction(_prev: FindLeadsState, formData: FormData): Promise<FindLeadsState> {
  if (!(await signedIn())) return { ok: false, error: "You must be signed in." };

  const parsed = findLeadsSchema.safeParse({
    vendorId: formData.get("vendorId"),
    geography: formData.get("geography") ?? undefined,
    target: formData.get("target"),
    source: formData.get("source") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid campaign input." };

  const readiness = await getSourcingReadiness(db, parsed.data.vendorId);
  if (!readiness.found) return { ok: false, error: "Vendor not found." };
  if (!readiness.runnable) {
    return { ok: false, error: "This vendor has no approved mapping for its type yet — add one before sourcing." };
  }

  try {
    const { campaignId } = await runCampaignForVendor(db, {
      vendorId: parsed.data.vendorId,
      source: parsed.data.source,
      geography: parsed.data.geography,
      target: parsed.data.target,
    });
    revalidatePath("/campaigns");
    revalidatePath(`/vendors/${parsed.data.vendorId}`);
    return { ok: true, campaignId };
  } catch (err) {
    // runCampaign marks the campaign failed + persists the error; surface a readable message to the operator.
    return { ok: false, error: err instanceof Error ? err.message : "Campaign failed." };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/campaigns-action.test.ts`
Expected: PASS (all four cases). Then `npm run typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/campaigns/actions.ts tests/integration/campaigns-action.test.ts
git commit -m "feat(campaigns): findLeadsAction — auth + readiness-gated campaign trigger"
```

---

### Task 3: Vendor page — Find Leads control + readiness gate

**Files:**
- Create: `src/app/(app)/vendors/[vendorId]/find-leads-panel.tsx` (client)
- Modify: `src/app/(app)/vendors/[vendorId]/page.tsx` (fetch readiness, render the panel)
- Test: `tests/unit/components/find-leads-panel.test.tsx`

**Interfaces:**
- Consumes: `findLeadsAction`, `FindLeadsState` (Task 2); `getSourcingReadiness` (Task 1); `db` (`@/db/client`).
- Produces: `<FindLeadsPanel vendorId readiness />` client component.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/find-leads-panel.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindLeadsPanel } from "@/app/(app)/vendors/[vendorId]/find-leads-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("FindLeadsPanel", () => {
  const vendorId = "10000000-0000-4000-8000-000000000001";

  it("shows the ready state and an enabled Find Leads button when runnable", () => {
    render(<FindLeadsPanel vendorId={vendorId} readiness={{ found: true, runnable: true, vendorType: "Infra", signalFamilies: ["money", "hiring"] }} />);
    expect(screen.getByText(/ready to source/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /find leads/i })).not.toBeDisabled();
  });

  it("shows a needs-a-mapping gate and no submit button when not runnable", () => {
    render(<FindLeadsPanel vendorId={vendorId} readiness={{ found: true, runnable: false, vendorType: "Infra", signalFamilies: [] }} />);
    expect(screen.getByText(/needs an approved mapping/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /find leads/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/find-leads-panel.test.tsx`
Expected: FAIL — cannot find module `find-leads-panel`.

- [ ] **Step 3: Write the client panel**

Create `src/app/(app)/vendors/[vendorId]/find-leads-panel.tsx`:
```tsx
"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { findLeadsAction, type FindLeadsState } from "@/app/(app)/campaigns/actions";
import type { SourcingReadiness } from "@/lib/campaigns/readiness";

export function FindLeadsPanel({ vendorId, readiness }: { vendorId: string; readiness: SourcingReadiness }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(findLeadsAction, { ok: false } as FindLeadsState);

  useEffect(() => {
    if (state.ok && state.campaignId) router.push(`/campaigns/${state.campaignId}`);
  }, [state.ok, state.campaignId, router]);

  return (
    <section className="readiness-panel" aria-label="Find leads">
      <h2>Find leads</h2>
      {readiness.runnable ? (
        <>
          <p className="readiness-ok">Ready to source — approved mappings will hunt: {readiness.signalFamilies.join(", ") || "—"}.</p>
          <form action={formAction} className="add-mapping-form">
            <input type="hidden" name="vendorId" value={vendorId} />
            <label htmlFor="fl-geo">Geography
              <input id="fl-geo" name="geography" type="text" defaultValue="IND" maxLength={8} autoComplete="off" />
            </label>
            <label htmlFor="fl-target">How many
              <input id="fl-target" name="target" type="number" defaultValue={20} min={1} max={25} />
            </label>
            <label htmlFor="fl-source">Data source
              <select id="fl-source" name="source" defaultValue="crustdata">
                <option value="crustdata">Live (Crustdata)</option>
                <option value="company-fixture">Test data</option>
              </select>
            </label>
            <div className="add-mapping-actions">
              <button type="submit" className="btn btn-primary" disabled={isPending}>
                {isPending ? "Sourcing…" : "Find Leads"}
              </button>
              {state.error && <p role="alert">{state.error}</p>}
            </div>
          </form>
        </>
      ) : (
        <p className="readiness-warn">
          Needs an approved mapping for this vendor’s type{readiness.vendorType ? ` (“${readiness.vendorType}”)` : ""} before it can source.
          Approve a matching mapping in <a href="/mappings">Mappings</a> first.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/find-leads-panel.test.tsx`
Expected: PASS (both states).

- [ ] **Step 5: Wire it into the vendor detail page**

In `src/app/(app)/vendors/[vendorId]/page.tsx`, add the imports and render the panel. After the existing `const vendor = await getVendor(vendorId); if (!vendor) notFound();` and the interview fetch, add:
```tsx
import { db } from "@/db/client";
import { getSourcingReadiness } from "@/lib/campaigns/readiness";
import { FindLeadsPanel } from "./find-leads-panel";
```
```tsx
  const readiness = await getSourcingReadiness(db, vendorId);
```
Then render `<FindLeadsPanel vendorId={vendorId} readiness={readiness} />` in the JSX — place it right after the interview `<Link>` and before `<EditProfileForm vendor={vendor} />`.

- [ ] **Step 6: Verify the page compiles + typecheck**

Run: `npm run typecheck`
Expected: clean. (The page is a server component; the panel is a client component — the server/client boundary is correct because `FindLeadsPanel` has `"use client"` and only receives serializable props.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/vendors/[vendorId]/find-leads-panel.tsx" "src/app/(app)/vendors/[vendorId]/page.tsx" tests/unit/components/find-leads-panel.test.tsx
git commit -m "feat(campaigns): Find Leads panel + readiness gate on the vendor page"
```

---

### Task 4: Campaigns section — list, detail, rail entry

**Files:**
- Create: `src/app/(app)/campaigns/page.tsx` (list)
- Create: `src/app/(app)/campaigns/campaign-list.tsx` (client-free list component)
- Create: `src/app/(app)/campaigns/[campaignId]/page.tsx` (detail)
- Modify: `src/app/components/shell/rail.tsx` (add the nav entry)
- Modify: `src/app/components/shell/nav-icon.tsx` (add the `campaigns` icon)
- Modify: `src/app/styles/command.css` (add `badge-{queued,running,done,failed}`)
- Test: `tests/unit/components/campaign-list.test.tsx`

**Interfaces:**
- Consumes: `listCampaigns`, `getCampaign` (`@/lib/campaigns/data`), `db` (`@/db/client`), schema (`campaignLeads`, `leads`).
- Produces: the Campaigns routes + a `<CampaignList campaigns={…} />` component.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/campaign-list.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CampaignList, type CampaignRow } from "@/app/(app)/campaigns/campaign-list";

const rows: CampaignRow[] = [
  { campaignId: "10000000-0000-4000-8000-000000000001", label: "RackPro · India · 20", source: "crustdata", status: "done",
    stats: { companiesFetched: 24, observationsWritten: 41, leadsCreated: 8, leadsUpdated: 1, creditsSpent: 0.87 } },
  { campaignId: "10000000-0000-4000-8000-000000000002", label: "Acme · India · 10", source: "company-fixture", status: "failed",
    stats: null },
];

describe("CampaignList", () => {
  it("links each campaign to its detail route and shows a status badge", () => {
    render(<CampaignList campaigns={rows} />);
    const link = screen.getByRole("link", { name: /RackPro · India · 20/ });
    expect(link).toHaveAttribute("href", "/campaigns/10000000-0000-4000-8000-000000000001");
    expect(document.querySelector(".badge-done")?.textContent).toBe("done");
    expect(document.querySelector(".badge-failed")?.textContent).toBe("failed");
  });

  it("shows leads-created for a done run", () => {
    render(<CampaignList campaigns={rows} />);
    expect(screen.getByText(/8 leads/i)).toBeInTheDocument();
  });

  it("renders an empty message for no campaigns", () => {
    render(<CampaignList campaigns={[]} />);
    expect(screen.getByText(/no campaigns/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/campaign-list.test.tsx`
Expected: FAIL — cannot find module `campaign-list`.

- [ ] **Step 3: Write the list component**

Create `src/app/(app)/campaigns/campaign-list.tsx`:
```tsx
import Link from "next/link";

export type CampaignStatsShape = { companiesFetched: number; observationsWritten: number; leadsCreated: number; leadsUpdated: number; creditsSpent: number };
export type CampaignRow = {
  campaignId: string;
  label: string;
  source: string;
  status: "queued" | "running" | "done" | "failed";
  stats: CampaignStatsShape | null;
};

export function CampaignList({ campaigns }: { campaigns: CampaignRow[] }) {
  if (campaigns.length === 0) return <p className="mapping-empty">No campaigns yet.</p>;
  return (
    <ul className="mapping-list">
      {campaigns.map((c) => (
        <li key={c.campaignId}>
          <Link href={`/campaigns/${c.campaignId}`}>{c.label}</Link>
          <p className="mapping-meta">
            {c.source === "crustdata" ? "Live" : "Test"}
            {c.stats ? ` · ${c.stats.leadsCreated} leads · ${c.stats.creditsSpent} credits` : ""}
          </p>
          <span className={`badge badge-${c.status}`}>{c.status}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/campaign-list.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the list page**

Create `src/app/(app)/campaigns/page.tsx`:
```tsx
import { db } from "@/db/client";
import { listCampaigns } from "@/lib/campaigns/data";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { CampaignList, type CampaignRow } from "./campaign-list";

export const metadata = { title: "Campaigns — Radar" };

export default async function CampaignsPage() {
  const rows = (await listCampaigns(db)) as unknown as CampaignRow[];
  return (
    <>
      <PageHeader eyebrow="Operate" title="Campaigns" />
      {rows.length === 0 ? (
        <EmptyState icon="campaigns" title="No campaigns yet"
          description="Open a vendor and hit “Find Leads” to run your first campaign." />
      ) : (
        <CampaignList campaigns={rows} />
      )}
    </>
  );
}
```

- [ ] **Step 6: Write the detail page**

Create `src/app/(app)/campaigns/[campaignId]/page.tsx`:
```tsx
import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getCampaign } from "@/lib/campaigns/data";
import { campaignLeads, leads, companies } from "@/db/schema";
import { PageHeader } from "@/app/components/ui/page-header";
import type { CampaignStatsShape } from "../campaign-list";

export default async function CampaignDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const campaign = await getCampaign(db, campaignId);
  if (!campaign) notFound();

  const surfaced = await db
    .select({ leadId: leads.leadId, companyName: companies.name, score: leads.score, wasNew: campaignLeads.wasNew })
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.leadId))
    .innerJoin(companies, eq(leads.companyId, companies.companyId))
    .where(eq(campaignLeads.campaignId, campaignId));

  const stats = campaign.stats as CampaignStatsShape | null;

  return (
    <>
      <Link href="/campaigns" className="back-link">← All campaigns</Link>
      <PageHeader eyebrow="Operate" title={campaign.label} />
      <span className={`badge badge-${campaign.status}`}>{campaign.status}</span>
      {campaign.error && <p role="alert">{campaign.error}</p>}

      {stats && (
        <dl className="lead-facts" aria-label="Campaign stats">
          <div className="fact"><dt>Companies</dt><dd>{stats.companiesFetched}</dd></div>
          <div className="fact"><dt>Observations</dt><dd>{stats.observationsWritten}</dd></div>
          <div className="fact"><dt>Leads</dt><dd>{stats.leadsCreated}</dd></div>
          <div className="fact"><dt>Credits</dt><dd>{stats.creditsSpent}</dd></div>
        </dl>
      )}

      <h2 className="signal-group-head">Leads surfaced</h2>
      {surfaced.length === 0 ? (
        <p className="mapping-empty">No leads surfaced by this run.</p>
      ) : (
        <ul className="mapping-list">
          {surfaced.map((l) => (
            <li key={l.leadId}>
              <Link href={`/leads/${l.leadId}`}>{l.companyName}</Link>
              <p className="mapping-meta">score {l.score ?? "—"}{l.wasNew ? " · new" : " · updated"}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 7: Add the rail entry + nav icon**

In `src/app/components/shell/rail.tsx`, add to the `"Operate"` group's `items` (after Pipeline):
```tsx
      ["/campaigns", "Campaigns", "campaigns"],
```
In `src/app/components/shell/nav-icon.tsx`: add `"campaigns"` to the `NavIconName` union, and add a `campaigns` entry to the `PATHS` record — reuse a simple, native-looking glyph (a radar/target circle):
```ts
  campaigns: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>`,
```
(Match the exact SVG attribute style of the other `PATHS` entries — if they use `<path d="…"/>` only, wrap the above in the same `<path>`/stroke conventions the file already uses; adapt to the file's actual format.)

- [ ] **Step 8: Add campaign-status badge CSS**

In `src/app/styles/command.css` (near the other `.badge-*` rules), add:
```css
/* Campaign run statuses (queued|running|done|failed) — mirror the approval-gate badge tokens. */
.badge-done    { color: var(--status-approved); background: var(--status-approved-bg); }
.badge-running { color: var(--status-proposed); background: var(--status-proposed-bg); }
.badge-queued  { color: var(--status-retired);  background: var(--status-retired-bg); }
.badge-failed  { color: var(--attention); background: color-mix(in srgb, var(--attention) 14%, transparent); }
```

- [ ] **Step 9: Verify + typecheck**

Run: `npm run typecheck && npx vitest run tests/unit/components/campaign-list.test.tsx`
Expected: typecheck clean; list test passes. (Pages are server components exercised at build/runtime; the component test covers the list rendering.)

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/campaigns" src/app/components/shell/rail.tsx src/app/components/shell/nav-icon.tsx src/app/styles/command.css tests/unit/components/campaign-list.test.tsx
git commit -m "feat(campaigns): Campaigns section (list + detail) + rail entry + status badges"
```

---

### Task 5: Dashboard strip — recent campaigns + fresh leads

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`
- Create: `src/app/(app)/dashboard/recent-strip.tsx`
- Test: `tests/unit/components/recent-strip.test.tsx`

**Interfaces:**
- Consumes: `listCampaigns` (`@/lib/campaigns/data`), `db`, schema (`leads`, `companies`).
- Produces: `<RecentStrip campaigns leads />` component + an async dashboard page.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/recent-strip.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentStrip, type StripCampaign, type StripLead } from "@/app/(app)/dashboard/recent-strip";

const campaigns: StripCampaign[] = [
  { campaignId: "c1", label: "RackPro · India · 20", status: "done", leadsCreated: 8 },
];
const leads: StripLead[] = [
  { leadId: "l1", companyName: "Anveshan", score: 72 },
];

describe("RecentStrip", () => {
  it("renders recent campaigns and fresh leads with links", () => {
    render(<RecentStrip campaigns={campaigns} leads={leads} />);
    expect(screen.getByRole("link", { name: /RackPro · India · 20/ })).toHaveAttribute("href", "/campaigns/c1");
    expect(screen.getByRole("link", { name: /Anveshan/ })).toHaveAttribute("href", "/leads/l1");
    expect(screen.getByText(/8 leads/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/recent-strip.test.tsx`
Expected: FAIL — cannot find module `recent-strip`.

- [ ] **Step 3: Write the strip component**

Create `src/app/(app)/dashboard/recent-strip.tsx`:
```tsx
import Link from "next/link";

export type StripCampaign = { campaignId: string; label: string; status: "queued" | "running" | "done" | "failed"; leadsCreated: number | null };
export type StripLead = { leadId: string; companyName: string; score: number | null };

export function RecentStrip({ campaigns, leads }: { campaigns: StripCampaign[]; leads: StripLead[] }) {
  return (
    <div className="cmd-bento">
      <section className="tile third" aria-label="Recent campaigns">
        <h2 className="signal-group-head">Recent campaigns</h2>
        {campaigns.length === 0 ? <p className="mapping-empty">None yet.</p> : (
          <ul className="mapping-list">
            {campaigns.map((c) => (
              <li key={c.campaignId}>
                <Link href={`/campaigns/${c.campaignId}`}>{c.label}</Link>
                <span className={`badge badge-${c.status}`}>{c.status}</span>
                {c.leadsCreated != null && <p className="mapping-meta">{c.leadsCreated} leads</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="tile third" aria-label="Fresh leads">
        <h2 className="signal-group-head">Fresh leads</h2>
        {leads.length === 0 ? <p className="mapping-empty">None yet.</p> : (
          <ul className="mapping-list">
            {leads.map((l) => (
              <li key={l.leadId}>
                <Link href={`/leads/${l.leadId}`}>{l.companyName}</Link>
                <p className="mapping-meta">score {l.score ?? "—"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/recent-strip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Make the dashboard async + render the strip**

Replace `src/app/(app)/dashboard/page.tsx` with:
```tsx
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { listCampaigns } from "@/lib/campaigns/data";
import { leads, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { RecentStrip, type StripCampaign, type StripLead } from "./recent-strip";

export const metadata = { title: "Dashboard — Radar" };

export default async function DashboardPage() {
  const campaignRows = (await listCampaigns(db)).slice(0, 5);
  const stripCampaigns: StripCampaign[] = campaignRows.map((c) => ({
    campaignId: c.campaignId, label: c.label,
    status: c.status as StripCampaign["status"],
    leadsCreated: (c.stats as { leadsCreated?: number } | null)?.leadsCreated ?? null,
  }));

  const leadRows = await db
    .select({ leadId: leads.leadId, companyName: companies.name, score: leads.score, createdAt: leads.createdAt })
    .from(leads).innerJoin(companies, eq(leads.companyId, companies.companyId))
    .orderBy(desc(leads.createdAt)).limit(5);
  const stripLeads: StripLead[] = leadRows.map((l) => ({ leadId: l.leadId, companyName: l.companyName, score: l.score }));

  const isEmpty = stripCampaigns.length === 0 && stripLeads.length === 0;
  return (
    <>
      <PageHeader eyebrow="Operate" title="Dashboard" />
      {isEmpty ? (
        <EmptyState icon="dashboard" title="Your operating day will appear here"
          description="Once leads, signals, and pipeline activity exist, this becomes your prioritized daily flow." />
      ) : (
        <RecentStrip campaigns={stripCampaigns} leads={stripLeads} />
      )}
    </>
  );
}
```

- [ ] **Step 6: Verify + typecheck + full campaigns UI sweep**

Run: `npm run typecheck && npx vitest run tests/unit/components/recent-strip.test.tsx tests/unit/components/campaign-list.test.tsx tests/unit/components/find-leads-panel.test.tsx tests/integration/campaigns-readiness.test.ts tests/integration/campaigns-action.test.ts tests/integration/campaigns-run.test.ts`
Expected: typecheck clean; all pass.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/dashboard" tests/unit/components/recent-strip.test.tsx
git commit -m "feat(campaigns): dashboard strip — recent campaigns + fresh leads"
```

---

## The complete journey, now clickable

After this plan: open a vendor → if it has an approved matching mapping, the **Find Leads** panel shows "ready to source"; pick geography + count + Live/Test, hit **Find Leads** → the campaign runs and you land on its detail page (status, stats, surfaced leads). The **Campaigns** rail section lists every run; the **Dashboard** shows recent campaigns + fresh leads. This is Acts 1–4 of the approved journey, clickable end to end. (Act 5 — fingerprint memory/recheck — remains the imminent V2.)

## Self-Review

**1. Spec/journey coverage:**
- Readiness gate ("ready to source" / "needs a mapping") → Task 1 (helper) + Task 3 (UI) ✓
- "Find Leads" trigger (minimal form: geography + target + source) → Task 2 (action) + Task 3 (panel) ✓
- Campaigns section (list + detail with status/stats/surfaced leads) + rail entry → Task 4 ✓
- Light dashboard strip → Task 5 ✓
- **Deferred (documented):** the Advanced panel (mapping-picker + funding/size filters) — needs `CompanyQuery`/`runCampaignForVendor` params not built in Plans 1/3. Explicitly out of scope; flagged in Global Constraints.

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". Two steps say "adapt to the file's actual format" (the nav-icon SVG glyph, Task 4 Step 7) — unavoidable since the exact `PATHS` string format must be read from the file; the intent + a concrete glyph are given. Every other step has complete code.

**3. Type consistency:** `FindLeadsState` (Task 2) is imported by Task 3's panel; `SourcingReadiness` (Task 1) is the prop type in Task 3 and the return of `getSourcingReadiness` used by Task 2's action; `CampaignRow`/`CampaignStatsShape` (Task 4) are reused by the detail page; `gatherPlanInputs` (Task 1) return shape matches its use in the `run.ts` refactor. Data-layer calls all pass `db` explicitly (DB-injected convention). `listCampaigns(db)`'s row shape is cast to `CampaignRow`/mapped for the strip — a `_prev`-less cast is used because `getCampaign`/`listCampaigns` return the raw Drizzle row type; if the cast is unsound at implementation time, define a small select projection instead.

**4. Scope check:** Focused on the UI layer; the only backend touch is the readiness helper + a behavior-preserving `run.ts` refactor (guarded by the existing orchestrator test). Independently shippable — delivers the clickable journey. Good.
