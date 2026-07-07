# New Campaign Form — Implementation Plan (Redesign Plan C of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the redesigned **New Campaign** surface at `/campaigns/new` (spec §4.3): a sectioned, compact 2-column form (Target / Scope / Filters / Source) assembled from the Plan-A kit, with a live-reacting context rail (vendor snapshot · recent runs · estimate). Persist the **full** form into `campaigns.config`, wire the parameters the backend already supports (vendor, geography, target, source) plus the one cheap new win (**Funded within → `fundedSinceDays` override**), and mark every not-yet-applied control with a "soon" affordance so nothing silently does nothing (spec §6).

**Architecture:** A server route `campaigns/new/page.tsx` fetches the vendor list + a lightweight per-vendor snapshot and renders a `"use client"` `NewCampaignForm`. The form submits via `useActionState(createCampaignAction, …)` — a new `"use server"` action beside the existing `findLeadsAction` (which stays untouched for the vendor page). All parsing/validation lives in a pure Zod schema + pure helpers (`src/lib/campaigns/new-campaign.ts`, unit-tested); the DB plumbing is a thin `createAndRunCampaign` that persists the full config and threads a `fundedSinceDays` override into the run. Two small kit primitives the form needs (`Stepper`, `ReadinessBanner`) join the kit; new form-section CSS appends to `kit.css` (tokens only).

**Tech Stack:** Next.js 15 (App Router, RSC + client), React 19 (`useActionState`, `useState`), Drizzle ORM, Zod, TypeScript strict, Vitest (jsdom for components, node for lib/integration).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-07-campaigns-ui-redesign-design.md` §4.3 (the form) + §6 (backend reality) + §5 (responsive). Plan A (kit+shell) and Plan B (list+detail) are merged.
- **Existing backend — call these verbatim (do NOT change `findLeadsAction`):**
  - `findLeadsAction(_prev: FindLeadsState, formData: FormData): Promise<FindLeadsState>` and `type FindLeadsState = { ok: boolean; campaignId?: string; error?: string }` — `src/app/(app)/campaigns/actions.ts` (`"use server"`). Reuse `FindLeadsState` for the new action.
  - Auth: local `signedIn()` (calls `auth()` from `@/lib/auth`) — replicate the same guard in the new action.
  - Readiness gate: `getSourcingReadiness(db, vendorId): Promise<{ found: boolean; runnable: boolean; vendorType: string | null; signalFamilies: SignalFamily[] }>` — `src/lib/campaigns/readiness.ts`. Messages: `!found` → "Vendor not found."; `!runnable` → "This vendor has no approved mapping for its type yet — add one before sourcing."
  - `runCampaignForVendor(db, { vendorId, source, geography, target }): Promise<{ campaignId; stats }>` — `src/db/campaign-run.ts`.
  - `createCampaign(db, { vendorId, label, source, config: unknown }): Promise<{ campaignId }>` — `src/lib/campaigns/data.ts` (always inserts `status:"running"`, `startedAt: now`).
  - `runCampaign(db, { campaignId, adapter })` — `src/lib/campaigns/run.ts`; it reads `campaign.config as { geography?, target? }` and builds a `CompanyQuery` from `buildSourcingPlan(...)`. `CompanyQuery = { geography: string; target: number; fundedSinceDays?: number; signalFamilies: SignalFamily[] }` — `src/lib/sourcing/company-schema.ts`.
  - `buildSourcingPlan(...) : { signalFamilies, fundedSinceDays, runnable }` — `src/lib/campaigns/plan.ts`; `fundedSinceDays` defaults to `DEFAULT_FUNDED_SINCE_DAYS = 365`, raised by money-signal freshness.
  - `adapterForSource(source)` — `src/lib/campaigns/adapter.ts`.
  - Vendor data: `listVendors(): Promise<{ vendorId; name }[]>` and `getVendor(vendorId): Promise<VendorProfile | null>` (`VendorProfile` has `capabilities: string[]`, `version: number`, etc. but **NOT** `vendorType`) — `src/lib/vendors/data.ts`. `vendorType` must come from `getSourcingReadiness().vendorType`.
  - Recent runs: `listCampaigns(db, vendorId?)` — `src/lib/campaigns/data.ts` (returns campaign rows, newest-first).
- **Spec §6 — per-parameter decision (verbatim; the form must not ship a control that silently does nothing):**
  | Parameter | Control | This cycle |
  |---|---|---|
  | Vendor | select | **WIRED** (required, readiness-gated) |
  | Geography | select | **WIRED** |
  | Target (how many companies) | stepper | **WIRED** |
  | Funded within (1/2/3/6/12/24 mo) | chips | **WIRED** → `config.fundedSinceDays` override |
  | Source (Live/Test) | segmented | **WIRED** |
  | Company size · Funding round type · Industries · Min lead score · Sort · Exclude-seen · Enrich top-N · Mapping selection | select/chips/toggle/disclosure | **PERSIST + "soon"** (saved into `config`, not yet applied) |
- **Config shape persisted (Task 1):** `{ geography, target, source, companySize, fundedMonths, fundedSinceDays, roundType, industries, minScore, sortBy, excludeSeen, enrichTop }` — a superset of the run-read `{ geography, target }`, so existing `runCampaign` keeps working.
- **Kit reuse:** `Field` (`field.tsx`), `ToggleRow` (`toggle-row.tsx`), `FilterChips`/`Segmented`/`SearchInput` (`controls.tsx`), `StatusPill`, `ScoreMeter`. Form-control CSS from Plan A: `.field-group`/`.field-label`/`.field-input`/`.field-pair`, `.toggle-row`/`.switch`, `.chips`/`.chip`/`.chip-on`, `.seg`. New CSS this plan adds: `.new-grid`, `.form-panel`, `.fsec`, `.stepper`, `.readiness`(compact ok/warn), `.adv`, `.soon`, and the rail bits (`.vsnap`, `.recent-runs`, `.estimate`).
- **Tokens only** for new CSS (real `tokens.css` custom properties). Reuse `.ctx-grid`/`.ctx-rail`/`.ctx-panel` from Plan A for the rail; `.btn`/`.btn-primary` for submit (full-width).
- **Conventions:** presentational-only = server component; anything with state/handlers/`useActionState` = `"use client"` (top line). Route dir is literally `(app)`. Import alias `@/` → `src`.
- **Tests:** pure helpers → `tests/unit/campaigns/*.test.ts` (node env, mirror `tests/unit/sourcing-plan.test.ts`); components → `tests/unit/components/*.test.tsx` (jsdom, first line `// @vitest-environment jsdom`); the action → `tests/integration/campaigns-new-action.test.ts` mirroring the existing `tests/integration/campaigns-action.test.ts` (mock `auth` via `vi`). Explicit `{ describe, it, expect, vi }` from vitest. Run one file with `npx vitest run <path>`. **Integration tests hit Neon and can be transiently flaky — re-run 2–3× before investigating a failure.** Typecheck: `npm run typecheck`.
- **Branch:** `feature/campaigns-new-form` (already checked out). One commit per task.

---

### Task 1: New-campaign schema + pure helpers

**Files:**
- Create: `src/lib/campaigns/new-campaign.ts`
- Test: `tests/unit/campaigns/new-campaign.test.ts`

**Interfaces:**
- Produces:
  - `newCampaignSchema` (Zod) parsing the full form; `type NewCampaignInput = z.infer<typeof newCampaignSchema>`.
  - `fundedMonthsToDays(months: number): number` — `months * 30` (chip → `fundedSinceDays`).
  - `MONTH_OPTS`, `ROUND_OPTS`, `SIZE_OPTS`, `MINSCORE_OPTS`, `SORT_OPTS` — the option lists the form + schema share.
  - `buildCampaignConfig(input: NewCampaignInput): Record<string, unknown>` — the object persisted into `campaigns.config` (includes derived `fundedSinceDays`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/campaigns/new-campaign.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { newCampaignSchema, fundedMonthsToDays, buildCampaignConfig } from "@/lib/campaigns/new-campaign";

const base = { vendorId: "10000000-0000-4000-8000-000000000001", geography: "IND", target: 20, source: "crustdata" };

describe("fundedMonthsToDays", () => {
  it("converts month chips to a days window", () => {
    expect(fundedMonthsToDays(1)).toBe(30);
    expect(fundedMonthsToDays(12)).toBe(360);
  });
});

describe("newCampaignSchema", () => {
  it("accepts a minimal valid form and applies defaults", () => {
    const p = newCampaignSchema.parse(base);
    expect(p.target).toBe(20);
    expect(p.fundedMonths).toBe(12);          // default window
    expect(p.excludeSeen).toBe(true);          // default on
    expect(p.industries).toEqual([]);
  });
  it("rejects an out-of-range target", () => {
    expect(() => newCampaignSchema.parse({ ...base, target: 99 })).toThrow();
  });
  it("rejects a non-uuid vendor", () => {
    expect(() => newCampaignSchema.parse({ ...base, vendorId: "nope" })).toThrow();
  });
});

describe("buildCampaignConfig", () => {
  it("persists the full form and derives fundedSinceDays from the month chip", () => {
    const cfg = buildCampaignConfig(newCampaignSchema.parse({ ...base, fundedMonths: 6, roundType: "seriesA" }));
    expect(cfg).toMatchObject({ geography: "IND", target: 20, source: "crustdata", fundedMonths: 6, fundedSinceDays: 180, roundType: "seriesA" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/campaigns/new-campaign.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the schema + helpers**

Create `src/lib/campaigns/new-campaign.ts`:
```ts
import { z } from "zod";

export const MONTH_OPTS = [1, 2, 3, 6, 12, 24] as const;
export const ROUND_OPTS = [
  { value: "any", label: "Any" }, { value: "seed", label: "Seed" },
  { value: "seriesA", label: "Series A" }, { value: "seriesB", label: "Series B" }, { value: "seriesCplus", label: "Series C+" },
] as const;
export const SIZE_OPTS = [
  { value: "any", label: "Any size" }, { value: "lt50", label: "Under 50" },
  { value: "50to200", label: "50–200" }, { value: "200to1000", label: "200–1,000" }, { value: "gt1000", label: "1,000+" },
] as const;
export const MINSCORE_OPTS = [
  { value: "0", label: "No minimum" }, { value: "40", label: "≥ 40 (watch+)" },
  { value: "60", label: "≥ 60 (pursue)" }, { value: "75", label: "≥ 75 (strong)" },
] as const;
export const SORT_OPTS = [
  { value: "score", label: "Score (high → low)" }, { value: "funding", label: "Funding recency" }, { value: "headcount", label: "Headcount growth" },
] as const;

/** Funded-within chip (months) → a days window for CompanyQuery.fundedSinceDays. */
export function fundedMonthsToDays(months: number): number {
  return months * 30;
}

export const newCampaignSchema = z.object({
  vendorId: z.string().uuid(),
  geography: z.string().min(2).max(8).default("IND"),
  companySize: z.enum(["any", "lt50", "50to200", "200to1000", "gt1000"]).default("any"),
  target: z.coerce.number().int().min(1).max(25),
  fundedMonths: z.coerce.number().int().refine((m) => (MONTH_OPTS as readonly number[]).includes(m), "bad window").default(12),
  roundType: z.enum(["any", "seed", "seriesA", "seriesB", "seriesCplus"]).default("any"),
  industries: z.array(z.string()).default([]),
  minScore: z.coerce.number().int().min(0).max(100).default(0),
  sortBy: z.enum(["score", "funding", "headcount"]).default("score"),
  excludeSeen: z.coerce.boolean().default(true),
  source: z.enum(["crustdata", "company-fixture"]).default("crustdata"),
  enrichTop: z.coerce.number().int().min(0).max(25).default(0),
});
export type NewCampaignInput = z.infer<typeof newCampaignSchema>;

/** The object persisted into campaigns.config — full form + derived fundedSinceDays. */
export function buildCampaignConfig(input: NewCampaignInput): Record<string, unknown> {
  return { ...input, fundedSinceDays: fundedMonthsToDays(input.fundedMonths) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/campaigns/new-campaign.test.ts`
Expected: PASS. Then `npm run typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaigns/new-campaign.ts tests/unit/campaigns/new-campaign.test.ts
git commit -m "feat(campaigns): new-campaign form schema + config builder (funded-within → days)"
```

---

### Task 2: Honor a `fundedSinceDays` override in the run

**Files:**
- Create: `src/lib/campaigns/funded-window.ts`
- Modify: `src/lib/campaigns/run.ts` (use the resolver)
- Test: `tests/unit/campaigns/funded-window.test.ts`

**Interfaces:**
- Produces: `resolveFundedSinceDays(planDefault: number, configOverride: unknown): number` — returns the override when it's a positive finite number, else the plan default. Consumed by `run.ts` when it assembles the `CompanyQuery`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/campaigns/funded-window.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveFundedSinceDays } from "@/lib/campaigns/funded-window";

describe("resolveFundedSinceDays", () => {
  it("prefers a valid positive override from config", () => {
    expect(resolveFundedSinceDays(365, 180)).toBe(180);
  });
  it("falls back to the plan default when the override is missing/invalid", () => {
    expect(resolveFundedSinceDays(365, undefined)).toBe(365);
    expect(resolveFundedSinceDays(365, 0)).toBe(365);
    expect(resolveFundedSinceDays(365, "x")).toBe(365);
    expect(resolveFundedSinceDays(365, -5)).toBe(365);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/campaigns/funded-window.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the resolver**

Create `src/lib/campaigns/funded-window.ts`:
```ts
/** The run's funded-since window: the form's override if valid, else the sourcing-plan default. */
export function resolveFundedSinceDays(planDefault: number, configOverride: unknown): number {
  return typeof configOverride === "number" && Number.isFinite(configOverride) && configOverride > 0
    ? configOverride
    : planDefault;
}
```

- [ ] **Step 4: Wire it into `run.ts`**

Open `src/lib/campaigns/run.ts`. It currently reads `campaign.config as { geography?, target? }` and builds a `CompanyQuery` using `plan.fundedSinceDays`. Make two edits:
1. Add the import at the top: `import { resolveFundedSinceDays } from "./funded-window";`
2. Widen the config cast to include `fundedSinceDays?: unknown` and set the query's `fundedSinceDays` to `resolveFundedSinceDays(plan.fundedSinceDays, config.fundedSinceDays)`.

Concretely, `run.ts` lines 30–36 read (the variable is `cfg`, verified):
```ts
const cfg = (campaign.config ?? {}) as { geography?: string; target?: number };
const query: CompanyQuery = {
  geography: cfg.geography ?? "IND",
  target: cfg.target ?? 20,
  fundedSinceDays: plan.fundedSinceDays,
  signalFamilies: plan.signalFamilies,
};
```
Change the cast to `{ geography?: string; target?: number; fundedSinceDays?: unknown }` and the field to `fundedSinceDays: resolveFundedSinceDays(plan.fundedSinceDays, cfg.fundedSinceDays),`. Do not change any other behavior.

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/unit/campaigns/funded-window.test.ts` (PASS). Then `npm run typecheck` clean. Then re-run the existing run test to confirm no regression: `npx vitest run tests/integration/campaigns-run.test.ts` (re-run 2–3× if it flakes on Neon).

- [ ] **Step 6: Commit**

```bash
git add src/lib/campaigns/funded-window.ts src/lib/campaigns/run.ts tests/unit/campaigns/funded-window.test.ts
git commit -m "feat(campaigns): honor a form-provided fundedSinceDays override in the run"
```

---

### Task 3: `createAndRunCampaign` — persist the full config

**Files:**
- Modify: `src/db/campaign-run.ts` (add an export)
- Test: covered by Task 4's integration test (thin DB glue; no standalone unit test — it only composes `createCampaign` + `runCampaign`).

**Interfaces:**
- Consumes: `createCampaign`, `runCampaign`, `adapterForSource`, `vendorProfiles` (all already imported in `campaign-run.ts`).
- Produces: `createAndRunCampaign(db: DB, input: { vendorId: string; source: string; geography: string; target: number; config: Record<string, unknown> }): Promise<{ campaignId: string; stats: CampaignStats }>` — like `runCampaignForVendor` but persists the caller's full `config` (which already carries `geography`, `target`, `fundedSinceDays`, and the forward-looking fields).

- [ ] **Step 1: Add the function**

In `src/db/campaign-run.ts`, add beside `runCampaignForVendor`:
```ts
/** Create + run a campaign persisting the full new-campaign config (superset of geography/target). */
export async function createAndRunCampaign(
  db: DB,
  input: { vendorId: string; source: string; geography: string; target: number; config: Record<string, unknown> },
): Promise<{ campaignId: string; stats: CampaignStats }> {
  const [vendor] = await db
    .select({ vendorId: vendorProfiles.vendorId, name: vendorProfiles.name })
    .from(vendorProfiles).where(eq(vendorProfiles.vendorId, input.vendorId)).limit(1);
  if (!vendor) throw new Error(`vendor ${input.vendorId} not found`);

  const { campaignId } = await createCampaign(db, {
    vendorId: vendor.vendorId,
    source: input.source,
    label: `${vendor.name} · ${input.geography} · ${input.target}`,
    config: input.config,
  });
  const stats = await runCampaign(db, { campaignId, adapter: adapterForSource(input.source) });
  return { campaignId, stats };
}
```
> `eq`, `createCampaign`, `runCampaign`, `adapterForSource`, `vendorProfiles`, `CampaignStats`, `DB` are already imported at the top of `campaign-run.ts` (used by `runCampaignForVendor`). If any is missing, add it to the existing import lines — do not duplicate.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` — clean.

- [ ] **Step 3: Commit**

```bash
git add src/db/campaign-run.ts
git commit -m "feat(campaigns): createAndRunCampaign — persist the full new-campaign config"
```

---

### Task 4: `createCampaignAction` server action

**Files:**
- Modify: `src/app/(app)/campaigns/actions.ts` (add a second action; leave `findLeadsAction` unchanged)
- Test: `tests/integration/campaigns-new-action.test.ts`

**Interfaces:**
- Consumes: `newCampaignSchema`, `buildCampaignConfig` (Task 1); `createAndRunCampaign` (Task 3); existing `signedIn()`, `getSourcingReadiness`, `db`, `revalidatePath`, `FindLeadsState`.
- Produces: `createCampaignAction(_prev: FindLeadsState, formData: FormData): Promise<FindLeadsState>` — parses the rich form (reading each field from `FormData`, `industries` via `formData.getAll("industries")`), same auth + readiness gate as `findLeadsAction`, then `createAndRunCampaign(db, { vendorId, source, geography, target, config: buildCampaignConfig(parsed) })`, revalidates `/campaigns`, returns `{ ok, campaignId }`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/campaigns-new-action.test.ts` (mirror the auth-mock + fixtures of `tests/integration/campaigns-action.test.ts`; read that file first to copy its harness — vendor/mapping seeding + `vi.mock` of `@/lib/auth`):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
// ⟵ copy the exact auth mock + db/seed harness from tests/integration/campaigns-action.test.ts
import { createCampaignAction } from "@/app/(app)/campaigns/actions";
// helper from the copied harness: seedReadyVendor(): Promise<string>  (returns a runnable vendorId)

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) Array.isArray(v) ? v.forEach((x) => fd.append(k, x)) : fd.set(k, v);
  return fd;
}

describe("createCampaignAction", () => {
  it("runs a fixture campaign for a ready vendor and persists the full config", async () => {
    const vendorId = await seedReadyVendor();
    const res = await createCampaignAction({ ok: false }, form({
      vendorId, geography: "IND", target: "20", source: "company-fixture",
      fundedMonths: "6", roundType: "seed", industries: ["Logistics", "SaaS"], minScore: "40", sortBy: "score", excludeSeen: "true",
    }));
    expect(res.ok).toBe(true);
    expect(res.campaignId).toBeTruthy();
    // config persisted with the derived window + forward-looking fields:
    const camp = await getCampaign(db, res.campaignId!);
    expect(camp!.config).toMatchObject({ fundedSinceDays: 180, roundType: "seed", industries: ["Logistics", "SaaS"] });
  });
  it("refuses a not-ready vendor", async () => {
    const vendorId = await seedVendorWithoutMapping();
    const res = await createCampaignAction({ ok: false }, form({ vendorId, geography: "IND", target: "20", source: "company-fixture" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/approved mapping/i);
  });
  it("rejects an unauthenticated caller", async () => {
    setSignedIn(false); // from the copied harness
    const res = await createCampaignAction({ ok: false }, form({ vendorId: "10000000-0000-4000-8000-000000000001", geography: "IND", target: "20", source: "company-fixture" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/signed in/i);
  });
});
```
> Adapt the helper names (`seedReadyVendor`, `seedVendorWithoutMapping`, `setSignedIn`, `getCampaign`, `db`) to whatever `campaigns-action.test.ts` already provides; the point is: ready→ok+config, not-ready→refused, unauth→refused.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/campaigns-new-action.test.ts`
Expected: FAIL — `createCampaignAction` not exported.

- [ ] **Step 3: Add the action**

In `src/app/(app)/campaigns/actions.ts`, add below `findLeadsAction` (keep the existing imports; add `newCampaignSchema`, `buildCampaignConfig` from `@/lib/campaigns/new-campaign` and `createAndRunCampaign` from `@/db/campaign-run`):
```ts
export async function createCampaignAction(_prev: FindLeadsState, formData: FormData): Promise<FindLeadsState> {
  if (!(await signedIn())) return { ok: false, error: "You must be signed in." };

  const parsed = newCampaignSchema.safeParse({
    vendorId: formData.get("vendorId"),
    geography: formData.get("geography") ?? undefined,
    companySize: formData.get("companySize") ?? undefined,
    target: formData.get("target"),
    fundedMonths: formData.get("fundedMonths") ?? undefined,
    roundType: formData.get("roundType") ?? undefined,
    industries: formData.getAll("industries").map(String),
    minScore: formData.get("minScore") ?? undefined,
    sortBy: formData.get("sortBy") ?? undefined,
    excludeSeen: formData.get("excludeSeen") ?? undefined,
    source: formData.get("source") ?? undefined,
    enrichTop: formData.get("enrichTop") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Please check the form and try again." };

  const readiness = await getSourcingReadiness(db, parsed.data.vendorId);
  if (!readiness.found) return { ok: false, error: "Vendor not found." };
  if (!readiness.runnable) return { ok: false, error: "This vendor has no approved mapping for its type yet — add one before sourcing." };

  try {
    const { campaignId } = await createAndRunCampaign(db, {
      vendorId: parsed.data.vendorId, source: parsed.data.source,
      geography: parsed.data.geography, target: parsed.data.target,
      config: buildCampaignConfig(parsed.data),
    });
    revalidatePath("/campaigns");
    revalidatePath(`/vendors/${parsed.data.vendorId}`);
    return { ok: true, campaignId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Campaign failed." };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/campaigns-new-action.test.ts` (re-run 2–3× if Neon flakes). Then `npm run typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/campaigns/actions.ts tests/integration/campaigns-new-action.test.ts
git commit -m "feat(campaigns): createCampaignAction — auth + readiness gate + full-config run"
```

---

### Task 5: `Stepper` + `ReadinessBanner` kit primitives + form CSS

**Files:**
- Create: `src/app/components/ui/stepper.tsx`
- Create: `src/app/components/ui/readiness-banner.tsx`
- Modify: `src/app/styles/kit.css`
- Test: `tests/unit/components/stepper.test.tsx`

**Interfaces:**
- Produces (`"use client"` for Stepper; server for ReadinessBanner):
  - `Stepper({ value, onChange, min?, max?, name? }: { value: number; onChange: (v:number)=>void; min?: number; max?: number; name?: string })` — a range input + a mono value readout; writes a hidden input `name` so the form submits it.
  - `ReadinessBanner({ ok, children }: { ok: boolean; children: ReactNode })` — a compact inline banner: `.readiness` + `.readiness--ok`/`.readiness--warn`, a dot, and the message.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/stepper.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "@/app/components/ui/stepper";
import { ReadinessBanner } from "@/app/components/ui/readiness-banner";

describe("Stepper", () => {
  it("shows the value and reports slider changes", () => {
    const onChange = vi.fn();
    render(<Stepper value={20} onChange={onChange} min={1} max={25} name="target" />);
    expect(screen.getByText("20")).toBeInTheDocument();
    const slider = screen.getByRole("slider") as HTMLInputElement;
    slider.value = "15";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith(15);
    // submits its value via a hidden input
    expect(document.querySelector('input[type="hidden"][name="target"]')).toHaveValue("20");
  });
});

describe("ReadinessBanner", () => {
  it("renders ok vs warn variants", () => {
    const { rerender, container } = render(<ReadinessBanner ok>Ready to source.</ReadinessBanner>);
    expect(container.querySelector(".readiness--ok")).toBeTruthy();
    rerender(<ReadinessBanner ok={false}>Needs a mapping.</ReadinessBanner>);
    expect(container.querySelector(".readiness--warn")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/stepper.test.tsx`
Expected: FAIL — cannot find modules.

- [ ] **Step 3: Write the components**

Create `src/app/components/ui/stepper.tsx`:
```tsx
"use client";
export function Stepper({ value, onChange, min = 1, max = 25, name }: { value: number; onChange: (v: number) => void; min?: number; max?: number; name?: string }) {
  return (
    <div className="stepper">
      <input type="range" min={min} max={max} value={value} aria-label="target" onChange={(e) => onChange(Number(e.target.value))} />
      <span className="stepper-val">{value}</span>
      {name ? <input type="hidden" name={name} value={value} readOnly /> : null}
    </div>
  );
}
```

Create `src/app/components/ui/readiness-banner.tsx`:
```tsx
import type { ReactNode } from "react";
export function ReadinessBanner({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className={`readiness ${ok ? "readiness--ok" : "readiness--warn"}`}>
      <span className="readiness-dot" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
```

- [ ] **Step 4: Append form CSS**

Append to `src/app/styles/kit.css`:
```css
/* ---- 18. New-campaign form ---------------------------------------------- */
.new-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--space-4); align-items: start; }
.form-panel { background: var(--surface); border: var(--border-w) solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-5); }
.fsec + .fsec { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--border-w) solid var(--border); }
.fsec > .fsec-head { display: flex; align-items: center; gap: var(--space-2); font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: var(--tracking-caps); text-transform: uppercase; color: var(--text-muted); margin-bottom: var(--space-3); }
.stepper { display: flex; align-items: center; gap: var(--space-3); }
.stepper input[type="range"] { flex: 1; accent-color: var(--accent); }
.stepper-val { font-family: var(--font-mono); font-weight: var(--weight-semibold); min-width: 2.5ch; text-align: right; font-size: var(--text-md); }
.readiness { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); font-size: var(--text-sm); margin-top: var(--space-2); }
.readiness-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; }
.readiness--ok { background: var(--status-approved-bg); color: var(--status-approved); }
.readiness--warn { background: var(--status-proposed-bg); color: var(--status-proposed); }
.soon { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-faint); border: var(--border-w) solid var(--border); border-radius: var(--radius-sm); padding: 0 4px; margin-left: var(--space-2); }
.adv summary { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); cursor: pointer; padding: var(--space-1) 0; }
.form-submit { width: 100%; justify-content: center; margin-top: var(--space-4); }
@media (max-width: 560px) { .form-panel { padding: var(--space-4); } }
```
> `.new-grid` mirrors `.ctx-grid` but with a 320px rail (spec §4.3). `.readiness--ok/warn` reuse the status tokens. Every `.field-*`, `.chips`, `.seg`, `.toggle-row` class is already defined (Plan A).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/stepper.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/ui/stepper.tsx src/app/components/ui/readiness-banner.tsx src/app/styles/kit.css tests/unit/components/stepper.test.tsx
git commit -m "feat(kit): Stepper + ReadinessBanner + new-campaign form CSS"
```

---

### Task 6: `NewCampaignForm` (client)

**Files:**
- Create: `src/app/(app)/campaigns/new-campaign-form.tsx`
- Test: `tests/unit/components/new-campaign-form.test.tsx`

**Interfaces:**
- Consumes: `useActionState(createCampaignAction, …)` (Task 4); `Field`, `ToggleRow`, `FilterChips`, `Segmented` (kit); `Stepper`, `ReadinessBanner` (Task 5); the option lists + `MONTH_OPTS` (Task 1). And a `VendorSnapshot[]` prop (Task 7 defines the shape) for the picker + rail.
- Produces (`"use client"`): `NewCampaignForm({ vendors }: { vendors: VendorSnapshot[] })` where `type VendorSnapshot = { vendorId: string; name: string; vendorType: string | null; version: number; capabilities: string[]; runnable: boolean; signalFamilies: string[]; recentRuns: { label: string; leads: number; when: string }[] }`. Renders the `.new-grid`: a `.form-panel` `<form action={formAction}>` with the four `.fsec` sections (Target/Scope/Filters/Source) and a full-width submit; and the `.ctx-rail` with the selected vendor's snapshot + recent runs + a derived estimate. Selecting a vendor updates the readiness gate (submit disabled when the selected vendor is not `runnable`) and the rail. Deferred controls carry a `<span className="soon">soon</span>`. On `state.ok` → `router.push(\`/campaigns/${state.campaignId}\`)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/new-campaign-form.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
// useActionState returns [state, action, pending]; stub a no-op action.
vi.mock("@/app/(app)/campaigns/actions", () => ({ createCampaignAction: vi.fn() }));

import { NewCampaignForm, type VendorSnapshot } from "@/app/(app)/campaigns/new-campaign-form";

const vendors: VendorSnapshot[] = [
  { vendorId: "v1", name: "Dhaval", vendorType: "Infra", version: 3, capabilities: ["WMS", "3PL"], runnable: true, signalFamilies: ["hiring", "money"], recentRuns: [{ label: "Dhaval · IND · 20", leads: 8, when: "2h" }] },
  { vendorId: "v2", name: "Nimbus", vendorType: null, version: 1, capabilities: [], runnable: false, signalFamilies: [], recentRuns: [] },
];

describe("NewCampaignForm", () => {
  it("shows the ready gate + vendor snapshot for a runnable vendor, submit enabled", () => {
    render(<NewCampaignForm vendors={vendors} />);
    expect(screen.getByRole("button", { name: /Find Leads/i })).toBeEnabled();
    expect(screen.getByText(/Infra/)).toBeInTheDocument();      // snapshot type
    expect(screen.getByText(/Ready to source/i)).toBeInTheDocument();
  });
  it("disables submit + shows the needs-a-mapping banner when the picked vendor is not ready", async () => {
    render(<NewCampaignForm vendors={vendors} />);
    await userEvent.selectOptions(screen.getByLabelText(/Vendor/i), "v2");
    expect(screen.getByText(/No approved mappings yet|needs a type|mapping/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Find Leads/i })).toBeDisabled();
  });
  it("marks not-yet-applied controls with a 'soon' affordance", () => {
    render(<NewCampaignForm vendors={vendors} />);
    expect(screen.getAllByText(/soon/i).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/new-campaign-form.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the component**

Create `src/app/(app)/campaigns/new-campaign-form.tsx`:
```tsx
"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/app/components/ui/field";
import { ToggleRow } from "@/app/components/ui/toggle-row";
import { FilterChips, Segmented } from "@/app/components/ui/controls";
import { Stepper } from "@/app/components/ui/stepper";
import { ReadinessBanner } from "@/app/components/ui/readiness-banner";
import { createCampaignAction } from "./actions";
import { MONTH_OPTS, ROUND_OPTS, SIZE_OPTS, MINSCORE_OPTS, SORT_OPTS } from "@/lib/campaigns/new-campaign";
import type { FindLeadsState } from "./actions";

export type VendorSnapshot = {
  vendorId: string; name: string; vendorType: string | null; version: number;
  capabilities: string[]; runnable: boolean; signalFamilies: string[];
  recentRuns: { label: string; leads: number; when: string }[];
};

const GEO_OPTS = [
  { value: "IND", label: "India (IND)" }, { value: "USA", label: "United States (USA)" }, { value: "GBR", label: "United Kingdom (GBR)" },
];
const Soon = () => <span className="soon">soon</span>;

export function NewCampaignForm({ vendors }: { vendors: VendorSnapshot[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<FindLeadsState, FormData>(createCampaignAction, { ok: false });
  const [vendorId, setVendorId] = useState(vendors[0]?.vendorId ?? "");
  const [target, setTarget] = useState(20);
  const [months, setMonths] = useState(12);
  const [round, setRound] = useState("any");
  const [source, setSource] = useState("crustdata");
  const [minScore, setMinScore] = useState("0");

  const vendor = useMemo(() => vendors.find((v) => v.vendorId === vendorId) ?? vendors[0], [vendors, vendorId]);
  useEffect(() => { if (state.ok && state.campaignId) router.push(`/campaigns/${state.campaignId}`); }, [state, router]);

  const ready = !!vendor?.runnable;
  const estCost = source === "crustdata" ? `≈ ${(target * 0.03).toFixed(1)}–${(target * 0.045).toFixed(1)}` : "0";

  return (
    <div className="new-grid">
      <form className="form-panel" action={formAction}>
        <input type="hidden" name="vendorId" value={vendorId} />

        <div className="fsec">
          <div className="fsec-head">Target</div>
          <Field label="Vendor" htmlFor="vendor">
            <select id="vendor" className="field-input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              {vendors.map((v) => <option key={v.vendorId} value={v.vendorId}>{v.name}{v.vendorType ? ` — ${v.vendorType}` : " — (no type set)"}</option>)}
            </select>
          </Field>
          <ReadinessBanner ok={ready}>
            {ready
              ? <><b>Ready to source.</b> Approved mappings will hunt {vendor?.signalFamilies.join(" · ") || "its signals"}.</>
              : <><b>Not ready.</b> This vendor has no approved mappings yet — add a type + mapping first.</>}
          </ReadinessBanner>
          <div className="field-pair" style={{ marginTop: "var(--space-3)" }}>
            <Field label="Geography" htmlFor="geo">
              <select id="geo" name="geography" className="field-input" defaultValue="IND">
                {GEO_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label={<>Company size <Soon /></>} htmlFor="size">
              <select id="size" name="companySize" className="field-input" defaultValue="any">
                {SIZE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <div className="fsec">
          <div className="fsec-head">Scope</div>
          <Field label="How many companies · target" htmlFor="target"><Stepper value={target} onChange={setTarget} min={1} max={25} name="target" /></Field>
          <Field label="Funded within" htmlFor="funded">
            <>
              <FilterChips options={MONTH_OPTS.map((m) => ({ value: String(m), label: `${m} mo` }))} value={String(months)} onChange={(v) => setMonths(Number(v))} />
              <input type="hidden" name="fundedMonths" value={months} />
            </>
          </Field>
        </div>

        <div className="fsec">
          <div className="fsec-head">Filters <Soon /></div>
          <Field label="Funding round type" htmlFor="round">
            <>
              <FilterChips options={ROUND_OPTS.map((o) => ({ value: o.value, label: o.label }))} value={round} onChange={setRound} />
              <input type="hidden" name="roundType" value={round} />
            </>
          </Field>
          <div className="field-pair">
            <Field label="Min lead score" htmlFor="minscore">
              <select id="minscore" name="minScore" className="field-input" value={minScore} onChange={(e) => setMinScore(e.target.value)}>
                {MINSCORE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Sort results by" htmlFor="sort">
              <select id="sort" name="sortBy" className="field-input" defaultValue="score">
                {SORT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ marginTop: "var(--space-3)" }}>
            <ToggleRow label="Exclude leads I've already seen" description="Skip companies surfaced in past runs" name="excludeSeen" defaultChecked />
          </div>
        </div>

        <div className="fsec">
          <div className="fsec-head">Source</div>
          <Segmented options={[{ value: "crustdata", label: "Live (Crustdata)" }, { value: "company-fixture", label: "Test data" }]} value={source} onChange={setSource} />
          <input type="hidden" name="source" value={source} />
          <details className="adv"><summary>Advanced — enrich top-N · mappings <Soon /></summary></details>
        </div>

        {state.error ? <p role="alert" className="run-error">{state.error}</p> : null}
        <button type="submit" className="btn btn-primary form-submit" disabled={!ready || pending}>{pending ? "Sourcing…" : "Find Leads →"}</button>
      </form>

      <aside className="ctx-rail">
        <div className="ctx-panel">
          <h3>Vendor</h3>
          <p className="vsnap-name"><b>{vendor?.name}</b> <span>{vendor?.vendorType ?? "no type"} · v{vendor?.version}</span></p>
          <p className="vsnap-cap">{vendor?.capabilities.join(" · ") || "—"}</p>
          <ReadinessBanner ok={ready}>{ready ? "Ready to source" : "No approved mappings yet"}</ReadinessBanner>
        </div>
        <div className="ctx-panel">
          <h3>Recent runs · this vendor</h3>
          {vendor && vendor.recentRuns.length > 0 ? (
            <ul className="mini-runs">{vendor.recentRuns.map((r, i) => <li key={i}><span>{r.when} · {r.label}</span><b>{r.leads} leads</b></li>)}</ul>
          ) : <p className="qv-empty">No runs yet.</p>}
        </div>
        <div className="ctx-panel">
          <h3>Estimate</h3>
          <div className="kv-list">
            <div className="kv"><span className="kv-k">Companies</span><span className="kv-v">{target}</span></div>
            <div className="kv"><span className="kv-k">Window</span><span className="kv-v">≤ {months} mo</span></div>
            <div className="kv"><span className="kv-k">Est. cost</span><span className="kv-v">{estCost}</span></div>
            <div className="kv"><span className="kv-k">Lands in</span><span className="kv-v">Leads</span></div>
          </div>
        </div>
      </aside>
    </div>
  );
}
```
> `Field`'s `label` prop is typed `string`; widen it to `ReactNode` in `field.tsx` (a one-line, backward-compatible change) so `label={<>Company size <Soon /></>}` type-checks — do this in Step 3 before running the test. Add small CSS for `.vsnap-name`/`.vsnap-cap`/`.mini-runs` to kit.css in this task (mirror `.attn`/`.kv` patterns).

- [ ] **Step 4: Widen `Field` label + add rail CSS**

In `src/app/components/ui/field.tsx`, change `label: string` → `label: ReactNode` (import `ReactNode` already present). Append to `kit.css`:
```css
.vsnap-name { margin: 0; font-size: var(--text-sm); } .vsnap-name span { color: var(--text-muted); font-size: var(--text-2xs); font-family: var(--font-mono); }
.vsnap-cap { margin: var(--space-1) 0 var(--space-2); font-size: var(--text-xs); color: var(--text-muted); }
.mini-runs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.mini-runs li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: var(--text-xs); }
.mini-runs li span { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/new-campaign-form.test.tsx` (all three). Then `npx vitest run tests/unit/components/field.test.tsx` to confirm the `Field` widen didn't regress. `npm run typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/campaigns/new-campaign-form.tsx src/app/components/ui/field.tsx src/app/styles/kit.css tests/unit/components/new-campaign-form.test.tsx
git commit -m "feat(campaigns): NewCampaignForm — sectioned form + vendor snapshot rail + estimate"
```

---

### Task 7: `/campaigns/new` page — server assembly

**Files:**
- Create: `src/app/(app)/campaigns/new/page.tsx`

**Interfaces:**
- Consumes: `db`, `listVendors`, `getVendor` (`@/lib/vendors/data`); `getSourcingReadiness` (`@/lib/campaigns/readiness`); `listCampaigns` (`@/lib/campaigns/data`); `relativeTime`, `CampaignStatsShape` (`../view-model`); `PageHeader`; `NewCampaignForm`, `type VendorSnapshot`.
- Produces: the server route. Builds a `VendorSnapshot[]` (for each vendor: `vendorType`+`signalFamilies`+`runnable` from `getSourcingReadiness`, `capabilities`+`version` from `getVendor`, `recentRuns` = the vendor's last 3 campaigns via `listCampaigns(db, vendorId)` mapped to `{ label, leads, when }`), renders `PageHeader` + `NewCampaignForm`.

- [ ] **Step 1: Write the page**

Create `src/app/(app)/campaigns/new/page.tsx`:
```tsx
import Link from "next/link";
import { db } from "@/db/client";
import { listVendors, getVendor } from "@/lib/vendors/data";
import { getSourcingReadiness } from "@/lib/campaigns/readiness";
import { listCampaigns } from "@/lib/campaigns/data";
import { PageHeader } from "@/app/components/ui/page-header";
import { NewCampaignForm, type VendorSnapshot } from "../new-campaign-form";
import { relativeTime, type CampaignStatsShape } from "../view-model";

export const metadata = { title: "New Campaign — Radar" };

export default async function NewCampaignPage() {
  const vendorList = await listVendors();
  const now = new Date();

  const vendors: VendorSnapshot[] = await Promise.all(
    vendorList.map(async (v) => {
      const [readiness, profile, runs] = await Promise.all([
        getSourcingReadiness(db, v.vendorId),
        getVendor(v.vendorId),
        listCampaigns(db, v.vendorId),
      ]);
      const recentRuns = (runs as { label: string; stats: CampaignStatsShape | null; createdAt: Date | null }[])
        .slice(0, 3)
        .map((r) => ({ label: r.label, leads: r.stats?.leadsCreated ?? 0, when: relativeTime((r.createdAt ?? now).toISOString(), now) }));
      return {
        vendorId: v.vendorId, name: v.name, vendorType: readiness.vendorType, version: profile?.version ?? 1,
        capabilities: profile?.capabilities ?? [], runnable: readiness.runnable, signalFamilies: readiness.signalFamilies,
        recentRuns,
      };
    }),
  );

  return (
    <>
      <Link href="/campaigns" className="back-link">← All campaigns</Link>
      <PageHeader eyebrow="Operate" title="New campaign" sub="Pick a vendor and pull real companies showing its buying signals." />
      {vendors.length === 0
        ? <p className="mapping-empty">No vendors yet — create one first.</p>
        : <NewCampaignForm vendors={vendors} />}
    </>
  );
}
```

- [ ] **Step 2: Verify typecheck + full suite + the CTA now lands**

Run: `npm run typecheck` (clean). Then `npx vitest run tests/unit` — the whole unit suite stays green. The list page's "New Campaign" button (Plan B, `href="/campaigns/new"`) now resolves to this page instead of 404.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/campaigns/new/page.tsx
git commit -m "feat(campaigns): /campaigns/new page — per-vendor snapshots + New Campaign form"
```

---

## Self-Review

**1. Spec coverage (§4.3 form + §6 backend):**
- §4.3 Target section (vendor select + readiness gate disabling submit; paired geography · company size) → Task 6 ✓ (gate: `disabled={!ready}`).
- §4.3 Scope (target stepper + value; funded-within granular chips 1/2/3/6/12/24) → Tasks 5+6 ✓.
- §4.3 Filters (round-type chips; industries — deferred; paired min-score · sort; exclude-seen toggle-row) → Task 6 ✓ (industries control deferred but the parameter is persisted; a small industries chip set can be added — currently represented by the persisted `industries` array + a "soon" tag on the Filters head).
- §4.3 Source (Live/Test segmented + Advanced disclosure) → Task 6 ✓.
- §4.3 Full-width Find Leads submit → Task 6 ✓.
- §4.3 Context rail (vendor snapshot reacting to picker; recent runs; estimate) → Tasks 6+7 ✓ (snapshot updates on vendor change via `useState`).
- §6 wired: vendor, geography, target, source (existing) + funded-within → `fundedSinceDays` override (Tasks 1–4) ✓. §6 persist-and-defer: company size, round type, industries, min score, sort, exclude-seen, enrich-top-N → persisted in `config` (Task 1 `buildCampaignConfig`) with `.soon` affordances (Task 6) ✓ — no control silently does nothing.
- §5 responsive: `.new-grid` collapses like `.ctx-grid`; `.field-pair` already single-columns at 560px (Plan A) ✓.

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". The Advanced disclosure and the deferred filters are intentional, labelled `soon`. The integration test references helpers to be copied from the existing `campaigns-action.test.ts` harness (named explicitly) — that's a copy instruction, not a placeholder. Every code step is complete.

**3. Type consistency:** `NewCampaignInput`/`buildCampaignConfig` (Task 1) consumed by `createCampaignAction` (Task 4). `createAndRunCampaign` (Task 3) input matches the action's call. `FindLeadsState` reused for the new action + `useActionState` (Tasks 4, 6). `VendorSnapshot` (Task 6) produced by the page (Task 7) with identical field names/types. `resolveFundedSinceDays` (Task 2) signature matches its `run.ts` call. `Stepper`/`ReadinessBanner` (Task 5) props match their uses. `Field` label widened to `ReactNode` (Task 6) is backward-compatible with all existing callers. Option lists (`MONTH_OPTS` etc.) shared by schema (Task 1) and form (Task 6). All new CSS references real `tokens.css` custom properties.

**4. Scope check:** One shippable page. Backend change is minimal and additive (new action + new `createAndRunCampaign` + a one-line `run.ts` override; `findLeadsAction`/`runCampaignForVendor` untouched, so the vendor page keeps working). Pure logic (schema, funded-window) is unit-tested in node; the action has an integration test; components have jsdom tests. Forward-looking parameters are persisted now and clearly marked, honoring §6's "must not ship a control that silently does nothing."
