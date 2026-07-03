# Leads Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real `/leads` list and a `/leads/[id]` detail page that renders a lead's reverse brief and contact block, on top of the already-persisted (but never-rendered) `brief` / `contact_block` JSONB columns.

**Architecture:** Mirror the shipped pipeline slice. A pure `src/lib/leads/schema.ts` (view type + a Zod schema validating the persisted brief + display helpers) and a server `src/lib/leads/data.ts` (`getLeadDetail`, injected-DB, type-only `DB` import). RSC pages inject the singleton `db`; presentational renderers are server components; `StageControls` is reused unchanged.

**Tech Stack:** Next.js 15 App Router (`@/` → `src/`), TypeScript strict, Drizzle + postgres-js on Neon, Zod, Vitest (node + jsdom via `@vitejs/plugin-react` / `@testing-library/react`).

## Global Constraints

- Data-module split: pure `schema.ts` — NO `@/db`, NO `server-only`, NO **value** import from `@/ai` (type-only is fine, erased at runtime); server `data.ts` for DB orchestration.
- Injected-DB data layer: `import type { DB } from "@/db/client"` — the `type` keyword is load-bearing (a value import eagerly runs `postgres(env.DATABASE_URL)` and breaks no-DB tests).
- RSC pages + the reused server action use the singleton `import { db } from "@/db/client"` and inject it into the injected-DB read.
- No `export const dynamic` — the `(app)` layout's `auth()` makes the whole segment dynamic.
- Mobile-first (375 → 768 → 1280); semantic HTML (`<ul>`/`<li>`/`<dl>`/`<section>`/`<h2>`/`<h3>`); keyboard-native controls; focus states.
- Paginate/limit reads: `getLeadDetail` uses `.limit(1)`; the list reuses the already-1000-capped `listPipelineLeads`.
- No `console.log`, no TODO comments, no silent empty catch. Explicit error handling; never leak stack traces to the client.
- Parameterized Drizzle only (`eq()`); validate the `leadId` input (UUID guard) before querying.
- Test file lives in the mirroring test dir; every new pure function has a unit test.
- Additive only. New files under `src/lib/leads/` and `src/app/(app)/leads/[id]/`, a new `leads-list.tsx`, a replaced `leads/page.tsx`, and appended CSS. **Do NOT** edit any shipped pipeline or `@/ai` module. Subagents commit ONLY explicit file paths — never `git add .`/`-A`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Interfaces produced (for later tasks / reference)

- `src/lib/leads/schema.ts` exports:
  - `type OutreachMode = "operator_handles" | "handed_to_vendor"`
  - `const OUTREACH_LABELS: Record<OutreachMode, string>`
  - `const leadBriefSchema` (Zod) — `z.infer` is assignable to `LeadBrief`
  - `type LeadDetail`
  - `function formatScore(score: number | null): string`
  - `function formatBriefDate(iso: string): string`
- `src/lib/leads/data.ts` exports:
  - `function getLeadDetail(db: DB, leadId: string): Promise<LeadDetail | null>`
- Reused from earlier slices: `LeadCard`, `PipelineStage`, `STAGE_LABELS` (`@/lib/pipeline/schema`); `listPipelineLeads` (`@/lib/pipeline/data`); `StageControls` (`@/app/(app)/pipeline/stage-controls`); `LeadBrief` (`@/ai/brief/schema`); `ContactBlock`, `contactBlockSchema` (`@/lib/sourcing/contacts-schema`); `PageHeader`, `EmptyState` (`@/app/components/ui/*`).

---

### Task 1: Pure leads schema module

**Files:**
- Create: `src/lib/leads/schema.ts`
- Test: `tests/unit/leads/schema.test.ts`

**Interfaces:**
- Consumes: `type LeadBrief`, `type BriefProof` from `@/ai/brief/schema` (type-only); `type ContactBlock` from `@/lib/sourcing/contacts-schema` (type-only); `type PipelineStage` from `@/lib/pipeline/schema` (type-only).
- Produces: everything in "Interfaces produced" above.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/leads/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  formatScore,
  formatBriefDate,
  OUTREACH_LABELS,
  leadBriefSchema,
} from "@/lib/leads/schema";

const validBrief = {
  why_them: "Expanding to three new regions this year.",
  why_now: [
    {
      signalId: "sig-1",
      claim: "Opened a new distribution centre",
      date: "2026-06-01T00:00:00Z",
      source: "press release",
      evidence: ["https://example.com/dc"],
    },
  ],
  what_they_need: "Warehouse automation partner",
  hook: "Congrats on the Ohio expansion",
  why_this_vendor: "You automated a comparable 200k sqft site",
  objections: [{ objection: "Too expensive", response: "ROI within 6 months" }],
  disqualifier_check_passed: true,
  generatedAt: "2026-06-02T09:30:00Z",
};

describe("formatScore", () => {
  it("renders a dash for null", () => {
    expect(formatScore(null)).toBe("—");
  });
  it("renders one decimal place", () => {
    expect(formatScore(8.5)).toBe("8.5");
    expect(formatScore(87)).toBe("87.0");
  });
});

describe("formatBriefDate", () => {
  it("formats an ISO date deterministically in UTC", () => {
    expect(formatBriefDate("2026-06-01T00:00:00Z")).toBe("Jun 1, 2026");
    expect(formatBriefDate("2026-12-31T23:59:59Z")).toBe("Dec 31, 2026");
  });
  it("returns the raw string when the date is unparseable", () => {
    expect(formatBriefDate("not-a-date")).toBe("not-a-date");
  });
});

describe("OUTREACH_LABELS", () => {
  it("maps every outreach mode to a human label", () => {
    expect(OUTREACH_LABELS.operator_handles).toBe("Operator handles");
    expect(OUTREACH_LABELS.handed_to_vendor).toBe("Handed to vendor");
  });
});

describe("leadBriefSchema", () => {
  it("accepts a well-formed persisted brief", () => {
    expect(leadBriefSchema.safeParse(validBrief).success).toBe(true);
  });
  it("rejects a brief missing required fields", () => {
    expect(leadBriefSchema.safeParse({ hook: "just a hook" }).success).toBe(false);
  });
  it("rejects a brief whose disqualifier check did not pass", () => {
    expect(
      leadBriefSchema.safeParse({ ...validBrief, disqualifier_check_passed: false }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/leads/schema.test.ts`
Expected: FAIL — `Cannot find module '@/lib/leads/schema'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/leads/schema.ts`:

```ts
import { z } from "zod";
import type { LeadBrief } from "@/ai/brief/schema";
import type { ContactBlock } from "@/lib/sourcing/contacts-schema";
import type { PipelineStage } from "@/lib/pipeline/schema";

/** Operator's outreach posture for a lead (mirrors the `outreach_mode` enum). */
export type OutreachMode = "operator_handles" | "handed_to_vendor";

export const OUTREACH_LABELS: Record<OutreachMode, string> = {
  operator_handles: "Operator handles",
  handed_to_vendor: "Handed to vendor",
};

// Zod validator for the persisted reverse brief. Lives here (not in the shipped
// @/ai/brief/schema) so that module stays untouched; the inferred type is
// structurally identical to LeadBrief and assignable to it (checked in data.ts).
const briefProofSchema = z.object({
  signalId: z.string(),
  claim: z.string(),
  date: z.string(),
  source: z.string(),
  evidence: z.array(z.string()),
});

export const leadBriefSchema = z.object({
  why_them: z.string(),
  why_now: z.array(briefProofSchema),
  what_they_need: z.string(),
  hook: z.string(),
  why_this_vendor: z.string(),
  objections: z.array(z.object({ objection: z.string(), response: z.string() })),
  disqualifier_check_passed: z.literal(true),
  generatedAt: z.string(),
});

/** The view model the lead detail page consumes. */
export type LeadDetail = {
  leadId: string;
  companyName: string;
  companyDescription: string | null;
  vendorName: string;
  vendorType: string | null;
  intent: string | null;
  score: number | null;
  stage: PipelineStage;
  outreachMode: OutreachMode | null;
  brief: LeadBrief | null;
  contactBlock: ContactBlock | null;
  createdAt: Date;
};

/** Score display: one decimal, or an em dash when unscored. Matches the board. */
export function formatScore(score: number | null): string {
  return score == null ? "—" : score.toFixed(1);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** UTC-deterministic date label (no locale/timezone dependence). Raw string on parse failure. */
export function formatBriefDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/leads/schema.test.ts`
Expected: PASS (8 assertions across the four describes).

- [ ] **Step 5: Verify client-safety and typecheck**

Run: `grep -nE "from \"@/db|server-only|from \"@/ai/.*/data" src/lib/leads/schema.ts`
Expected: no matches (only a type-only `@/ai/brief/schema` import is present, which this grep does not match).
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/leads/schema.ts tests/unit/leads/schema.test.ts
git commit -m "feat(leads): pure schema module — LeadDetail, leadBriefSchema, display helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Lead detail data layer

**Files:**
- Create: `src/lib/leads/data.ts`
- Test: `tests/integration/leads-data.test.ts`

**Interfaces:**
- Consumes: `type DB` from `@/db/client` (type-only); `leads`, `companies`, `vendorProfiles` from `@/db/schema`; `eq` from `drizzle-orm`; `leadBriefSchema`, `type LeadDetail` from `./schema`; `contactBlockSchema` from `@/lib/sourcing/contacts-schema`; `type PipelineStage` from `@/lib/pipeline/schema`.
- Produces: `getLeadDetail(db: DB, leadId: string): Promise<LeadDetail | null>`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/leads-data.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { leads, companies, vendorProfiles } from "@/db/schema";
import { getLeadDetail } from "@/lib/leads/data";
import type { PipelineStage } from "@/lib/pipeline/schema";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["leads", "vendor_profiles", "companies"]);
});
afterAll(async () => {
  await closeTestDb();
});

async function makeCompany(name: string, description: string | null = null): Promise<string> {
  const [row] = await testDb
    .insert(companies)
    .values({ name, normalizedName: name.toLowerCase(), description })
    .returning();
  return row.companyId;
}

async function makeVendor(name: string, vendorType: string | null = null): Promise<string> {
  const [row] = await testDb.insert(vendorProfiles).values({ name, vendorType }).returning();
  return row.vendorId;
}

async function makeLead(opts: {
  companyId: string;
  vendorId: string;
  intent?: string | null;
  score?: number | null;
  stage?: PipelineStage;
  brief?: unknown;
  contactBlock?: unknown;
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
    })
    .returning();
  return row.leadId;
}

const validBrief = {
  why_them: "Expanding to three new regions.",
  why_now: [
    {
      signalId: "sig-1",
      claim: "Opened a new DC",
      date: "2026-06-01T00:00:00Z",
      source: "press release",
      evidence: ["https://example.com/dc"],
    },
  ],
  what_they_need: "Warehouse automation partner",
  hook: "Congrats on the expansion",
  why_this_vendor: "You automated a comparable site",
  objections: [{ objection: "Too expensive", response: "ROI within 6 months" }],
  disqualifier_check_passed: true,
  generatedAt: "2026-06-02T09:30:00Z",
};

const validContacts = {
  decision_makers: [
    {
      name: "Jane Doe",
      role: "COO",
      why: "Owns the operations budget",
      paths: [{ type: "email", val: "jane@acme.com", conf: "high", source: "apollo" }],
      warm: { status: "cold", detail: null },
    },
  ],
  status: "resolved",
  resolvedBy: "apollo-resolver",
  resolvedAt: "2026-06-02T10:00:00Z",
};

describe("getLeadDetail", () => {
  it("returns a full detail with parsed brief and contact block", async () => {
    const companyId = await makeCompany("Zephyr Retail", "A regional retailer");
    const vendorId = await makeVendor("Acme Infra", "Infra");
    const leadId = await makeLead({
      companyId,
      vendorId,
      intent: "Warehouse buildout",
      score: 8.5,
      stage: "contacted",
      brief: validBrief,
      contactBlock: validContacts,
    });

    const detail = await getLeadDetail(testDb, leadId);
    expect(detail).not.toBeNull();
    expect(detail!.companyName).toBe("Zephyr Retail");
    expect(detail!.companyDescription).toBe("A regional retailer");
    expect(detail!.vendorName).toBe("Acme Infra");
    expect(detail!.vendorType).toBe("Infra");
    expect(detail!.intent).toBe("Warehouse buildout");
    expect(detail!.score).toBe(8.5);
    expect(detail!.stage).toBe("contacted");
    expect(detail!.brief?.hook).toBe("Congrats on the expansion");
    expect(detail!.brief?.why_now).toHaveLength(1);
    expect(detail!.contactBlock?.decision_makers[0].name).toBe("Jane Doe");
    expect(detail!.createdAt).toBeInstanceOf(Date);
  });

  it("returns null brief and contactBlock when the columns are null", async () => {
    const companyId = await makeCompany("Meridian Logistics");
    const vendorId = await makeVendor("Beacon Marketing");
    const leadId = await makeLead({ companyId, vendorId });

    const detail = await getLeadDetail(testDb, leadId);
    expect(detail).not.toBeNull();
    expect(detail!.brief).toBeNull();
    expect(detail!.contactBlock).toBeNull();
    expect(detail!.companyDescription).toBeNull();
    expect(detail!.vendorType).toBeNull();
    expect(detail!.outreachMode).toBeNull();
  });

  it("degrades a malformed brief payload to null without failing", async () => {
    const companyId = await makeCompany("Vantage Foods");
    const vendorId = await makeVendor("Acme Infra");
    const leadId = await makeLead({
      companyId,
      vendorId,
      brief: { hook: "only a hook, missing everything else" },
      contactBlock: validContacts,
    });

    const detail = await getLeadDetail(testDb, leadId);
    expect(detail).not.toBeNull();
    expect(detail!.brief).toBeNull();
    expect(detail!.contactBlock?.decision_makers[0].name).toBe("Jane Doe");
  });

  it("returns null for an unknown lead id", async () => {
    const detail = await getLeadDetail(testDb, "10000000-0000-4000-8000-000000000099");
    expect(detail).toBeNull();
  });

  it("returns null for a malformed (non-UUID) id", async () => {
    const detail = await getLeadDetail(testDb, "not-a-uuid");
    expect(detail).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/leads-data.test.ts`
Expected: FAIL — `Cannot find module '@/lib/leads/data'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/leads/data.ts`:

```ts
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { leads, companies, vendorProfiles } from "@/db/schema";
import { contactBlockSchema } from "@/lib/sourcing/contacts-schema";
import type { PipelineStage } from "@/lib/pipeline/schema";
import { leadBriefSchema, type LeadDetail } from "./schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One lead joined to its company and vendor, with the two JSONB columns
 * validated and parsed. A malformed payload degrades to null rather than
 * throwing. Returns null for a malformed or unknown id.
 */
export async function getLeadDetail(
  db: DB,
  leadId: string,
): Promise<LeadDetail | null> {
  if (!UUID_RE.test(leadId)) return null;

  const rows = await db
    .select({
      leadId: leads.leadId,
      companyName: companies.name,
      companyDescription: companies.description,
      vendorName: vendorProfiles.name,
      vendorType: vendorProfiles.vendorType,
      intent: leads.intent,
      score: leads.score,
      stage: leads.pipelineStage,
      outreachMode: leads.outreachMode,
      brief: leads.brief,
      contactBlock: leads.contactBlock,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.companyId))
    .innerJoin(vendorProfiles, eq(leads.vendorId, vendorProfiles.vendorId))
    .where(eq(leads.leadId, leadId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const briefParsed =
    row.brief == null ? null : leadBriefSchema.safeParse(row.brief);
  const contactParsed =
    row.contactBlock == null ? null : contactBlockSchema.safeParse(row.contactBlock);

  return {
    leadId: row.leadId,
    companyName: row.companyName,
    companyDescription: row.companyDescription,
    vendorName: row.vendorName,
    vendorType: row.vendorType,
    intent: row.intent,
    score: row.score,
    stage: row.stage as PipelineStage,
    outreachMode: row.outreachMode,
    brief: briefParsed && briefParsed.success ? briefParsed.data : null,
    contactBlock: contactParsed && contactParsed.success ? contactParsed.data : null,
    createdAt: row.createdAt,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/leads-data.test.ts`
Expected: PASS (5 tests). If a transient Neon TRUNCATE-deadlock/latency error appears, re-run 2–3× before investigating (known infra flakiness).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. (This is where a drift between `leadBriefSchema`'s inferred type and `LeadBrief` would surface: `briefParsed.data` must be assignable to `LeadDetail.brief`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/leads/data.ts tests/integration/leads-data.test.ts
git commit -m "feat(leads): getLeadDetail data layer (injected DB, validated JSONB)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Detail page + brief and contact-block renderers

**Files:**
- Create: `src/app/(app)/leads/[id]/page.tsx`
- Create: `src/app/(app)/leads/[id]/brief-view.tsx`
- Create: `src/app/(app)/leads/[id]/contact-block-view.tsx`
- Modify: `src/app/styles/components.css` (append)
- Test: `tests/unit/components/lead-brief-view.test.tsx`
- Test: `tests/unit/components/lead-contact-block-view.test.tsx`

**Interfaces:**
- Consumes: `getLeadDetail` (`@/lib/leads/data`); `formatScore`, `formatBriefDate`, `OUTREACH_LABELS` (`@/lib/leads/schema`); `STAGE_LABELS` (`@/lib/pipeline/schema`); `StageControls` (`@/app/(app)/pipeline/stage-controls`); `PageHeader` (`@/app/components/ui/page-header`); `type LeadBrief` (`@/ai/brief/schema`); `type ContactBlock` (`@/lib/sourcing/contacts-schema`); `db` (`@/db/client`); `notFound` (`next/navigation`); `Link` (`next/link`).
- Produces: the `/leads/[id]` route and two exported renderers `BriefView`, `ContactBlockView`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/lead-brief-view.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BriefView } from "@/app/(app)/leads/[id]/brief-view";
import type { LeadBrief } from "@/ai/brief/schema";

const brief: LeadBrief = {
  why_them: "Expanding to three new regions.",
  why_now: [
    {
      signalId: "sig-1",
      claim: "Opened a new distribution centre",
      date: "2026-06-01T00:00:00Z",
      source: "press release",
      evidence: ["https://example.com/dc"],
    },
  ],
  what_they_need: "Warehouse automation partner",
  hook: "Congrats on the Ohio expansion",
  why_this_vendor: "You automated a comparable site",
  objections: [{ objection: "Too expensive", response: "ROI within 6 months" }],
  disqualifier_check_passed: true,
  generatedAt: "2026-06-02T09:30:00Z",
};

describe("BriefView", () => {
  it("renders the narrative fields", () => {
    render(<BriefView brief={brief} />);
    expect(screen.getByText("Expanding to three new regions.")).toBeInTheDocument();
    expect(screen.getByText("Congrats on the Ohio expansion")).toBeInTheDocument();
    expect(screen.getByText("Warehouse automation partner")).toBeInTheDocument();
  });

  it("renders each why-now proof and its objection", () => {
    render(<BriefView brief={brief} />);
    expect(screen.getByText("Opened a new distribution centre")).toBeInTheDocument();
    expect(screen.getByText(/press release/)).toBeInTheDocument();
    expect(screen.getByText("Too expensive")).toBeInTheDocument();
    expect(screen.getByText("ROI within 6 months")).toBeInTheDocument();
  });

  it("renders a generated-at footer", () => {
    render(<BriefView brief={brief} />);
    expect(screen.getByText(/Brief generated/)).toBeInTheDocument();
  });
});
```

Create `tests/unit/components/lead-contact-block-view.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContactBlockView } from "@/app/(app)/leads/[id]/contact-block-view";
import type { ContactBlock } from "@/lib/sourcing/contacts-schema";

const block: ContactBlock = {
  decision_makers: [
    {
      name: "Jane Doe",
      role: "COO",
      why: "Owns the operations budget",
      paths: [
        { type: "email", val: "jane@acme.com", conf: "high", source: "apollo" },
        { type: "phone", val: null, conf: null, source: null },
      ],
      warm: { status: "warm", detail: "Shared board member" },
    },
  ],
  status: "resolved",
  resolvedBy: "apollo-resolver",
  resolvedAt: "2026-06-02T10:00:00Z",
};

describe("ContactBlockView", () => {
  it("renders each decision-maker with role and reason", () => {
    render(<ContactBlockView block={block} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText(/COO/)).toBeInTheDocument();
    expect(screen.getByText("Owns the operations budget")).toBeInTheDocument();
  });

  it("renders contact paths, dashing a missing value", () => {
    render(<ContactBlockView block={block} />);
    expect(screen.getByText("jane@acme.com")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders an empty-state note when there are no decision-makers", () => {
    const empty: ContactBlock = { ...block, decision_makers: [], status: "pending_enrichment" };
    render(<ContactBlockView block={empty} />);
    expect(screen.getByText(/No decision-makers/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/lead-brief-view.test.tsx tests/unit/components/lead-contact-block-view.test.tsx`
Expected: FAIL — modules `brief-view` / `contact-block-view` not found.

- [ ] **Step 3: Write `brief-view.tsx`**

Create `src/app/(app)/leads/[id]/brief-view.tsx`:

```tsx
import type { LeadBrief } from "@/ai/brief/schema";
import { formatBriefDate } from "@/lib/leads/schema";

export function BriefView({ brief }: { brief: LeadBrief }) {
  return (
    <section className="brief-view" aria-label="Reverse brief">
      <h2>Reverse brief</h2>
      <div className="brief-field">
        <h3>Why them</h3>
        <p>{brief.why_them}</p>
      </div>
      <div className="brief-field">
        <h3>What they need</h3>
        <p>{brief.what_they_need}</p>
      </div>
      <div className="brief-field">
        <h3>Hook</h3>
        <p>{brief.hook}</p>
      </div>
      <div className="brief-field">
        <h3>Why this vendor</h3>
        <p>{brief.why_this_vendor}</p>
      </div>
      {brief.why_now.length > 0 && (
        <div className="brief-field">
          <h3>Why now</h3>
          <ul className="brief-proofs">
            {brief.why_now.map((proof, i) => (
              <li key={`${proof.signalId}-${i}`} className="brief-proof">
                <p className="proof-claim">{proof.claim}</p>
                <p className="proof-meta">
                  {formatBriefDate(proof.date)} · {proof.source}
                </p>
                {proof.evidence.length > 0 && (
                  <ul className="proof-evidence">
                    {proof.evidence.map((e, j) => (
                      <li key={j}>{e}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {brief.objections.length > 0 && (
        <div className="brief-field">
          <h3>Objections</h3>
          <ul className="brief-objections">
            {brief.objections.map((o, i) => (
              <li key={i} className="objection">
                <p className="objection-q">{o.objection}</p>
                <p className="objection-a">{o.response}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="brief-generated">Brief generated {formatBriefDate(brief.generatedAt)}</p>
    </section>
  );
}
```

- [ ] **Step 4: Write `contact-block-view.tsx`**

Create `src/app/(app)/leads/[id]/contact-block-view.tsx`:

```tsx
import type { ContactBlock } from "@/lib/sourcing/contacts-schema";

export function ContactBlockView({ block }: { block: ContactBlock }) {
  return (
    <section className="contact-block" aria-label="Contacts">
      <h2>Contacts</h2>
      <p className="contact-status">
        Status: {block.status === "resolved" ? "Resolved" : "Pending enrichment"}
      </p>
      {block.decision_makers.length === 0 ? (
        <p className="lead-empty-note">No decision-makers identified yet.</p>
      ) : (
        <ul className="decision-makers">
          {block.decision_makers.map((dm, i) => (
            <li key={`${dm.name}-${i}`} className="decision-maker">
              <p className="dm-name">
                {dm.name} <span className="dm-role">· {dm.role}</span>
              </p>
              {dm.why && <p className="dm-why">{dm.why}</p>}
              <p className={`warm-badge warm-${dm.warm.status}`}>
                {dm.warm.status === "warm" ? "Warm intro" : "Cold"}
                {dm.warm.detail ? `: ${dm.warm.detail}` : ""}
              </p>
              {dm.paths.length > 0 && (
                <ul className="contact-paths">
                  {dm.paths.map((p, j) => (
                    <li key={`${p.type}-${j}`} className="contact-path">
                      <span className="path-type">{p.type}</span>
                      <span className="path-val">{p.val ?? "—"}</span>
                      {p.conf && <span className="path-conf">{p.conf}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the component tests to verify they pass**

Run: `npx vitest run tests/unit/components/lead-brief-view.test.tsx tests/unit/components/lead-contact-block-view.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the detail page**

Create `src/app/(app)/leads/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db/client";
import { getLeadDetail } from "@/lib/leads/data";
import { PageHeader } from "@/app/components/ui/page-header";
import { STAGE_LABELS } from "@/lib/pipeline/schema";
import { formatScore, OUTREACH_LABELS } from "@/lib/leads/schema";
import { StageControls } from "@/app/(app)/pipeline/stage-controls";
import { BriefView } from "./brief-view";
import { ContactBlockView } from "./contact-block-view";

export const metadata = { title: "Lead — Radar" };

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = await getLeadDetail(db, id);
  if (!lead) notFound();

  return (
    <>
      <Link href="/leads" className="back-link">
        ← All leads
      </Link>
      <PageHeader eyebrow="Operate" title={lead.companyName} />
      <div className="lead-detail">
        <section className="lead-summary" aria-label="Lead summary">
          <dl className="lead-facts">
            <div className="fact">
              <dt>Vendor</dt>
              <dd>{lead.vendorName}</dd>
            </div>
            {lead.intent && (
              <div className="fact">
                <dt>Intent</dt>
                <dd>{lead.intent}</dd>
              </div>
            )}
            <div className="fact">
              <dt>Stage</dt>
              <dd>
                <span className={`stage-badge stage-dot-${lead.stage}`}>
                  {STAGE_LABELS[lead.stage]}
                </span>
              </dd>
            </div>
            <div className="fact">
              <dt>Score</dt>
              <dd>{formatScore(lead.score)}</dd>
            </div>
            {lead.outreachMode && (
              <div className="fact">
                <dt>Outreach</dt>
                <dd>{OUTREACH_LABELS[lead.outreachMode]}</dd>
              </div>
            )}
          </dl>
          <StageControls leadId={lead.leadId} stage={lead.stage} />
        </section>
        {lead.brief ? (
          <BriefView brief={lead.brief} />
        ) : (
          <p className="lead-empty-note">No reverse brief generated yet.</p>
        )}
        {lead.contactBlock ? (
          <ContactBlockView block={lead.contactBlock} />
        ) : (
          <p className="lead-empty-note">No contact block resolved yet.</p>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 7: Append the detail CSS**

Append to the very end of `src/app/styles/components.css` (after the last existing rule — the pipeline board block from slice 1; do NOT delete or reorder any existing rule):

```css

/* Lead detail (Phase 5, slice 2) */
.back-link {
  display: inline-block;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
  color: var(--text-muted);
  text-decoration: none;
}
.back-link:hover,
.back-link:focus-visible {
  color: var(--text);
  text-decoration: underline;
}
.lead-detail {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.lead-summary {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.lead-facts {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
  margin: 0;
}
.lead-facts .fact {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.lead-facts dt {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}
.lead-facts dd {
  margin: 0;
  color: var(--text);
}
.lead-empty-note {
  color: var(--text-muted);
  font-style: italic;
}
.brief-view,
.contact-block {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  border: 1px solid var(--border);
  border-radius: var(--radius, 0.5rem);
  background: var(--surface, transparent);
}
.brief-field h3,
.contact-block h2,
.brief-view h2 {
  margin: 0 0 0.35rem;
}
.brief-field h3 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}
.brief-field p {
  margin: 0;
}
.brief-proofs,
.brief-objections,
.decision-makers,
.contact-paths,
.proof-evidence {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.brief-proof,
.objection,
.decision-maker {
  padding: 0.6rem 0.75rem;
  border-left: 2px solid var(--border);
}
.proof-claim,
.objection-q,
.dm-name {
  font-weight: 600;
  margin: 0;
}
.proof-meta,
.dm-why,
.objection-a {
  margin: 0.15rem 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}
.proof-evidence {
  margin-top: 0.35rem;
  gap: 0.2rem;
}
.proof-evidence li {
  font-size: 0.8rem;
  color: var(--text-faint);
  word-break: break-word;
}
.dm-role {
  font-weight: 400;
  color: var(--text-muted);
}
.warm-badge {
  display: inline-block;
  margin: 0.35rem 0;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
}
.warm-warm {
  background: color-mix(in srgb, var(--stage-won) 18%, transparent);
  color: var(--stage-won);
}
.warm-cold {
  background: color-mix(in srgb, var(--text-faint) 15%, transparent);
  color: var(--text-muted);
}
.contact-path {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: baseline;
  padding: 0.25rem 0;
  font-size: 0.85rem;
}
.path-type {
  min-width: 4rem;
  color: var(--text-faint);
  text-transform: uppercase;
  font-size: 0.72rem;
  letter-spacing: 0.03em;
}
.path-conf {
  color: var(--text-faint);
  font-size: 0.72rem;
}
.brief-generated {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-faint);
}
@media (min-width: 768px) {
  .lead-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

- [ ] **Step 8: Verify typecheck and build**

Run: `npm run typecheck`
Expected: exit 0.
Run: `npm run build`
Expected: success; `/leads/[id]` present in the route list as a dynamic (`ƒ`) route; no server/client boundary errors.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/leads/[id]/page.tsx" "src/app/(app)/leads/[id]/brief-view.tsx" "src/app/(app)/leads/[id]/contact-block-view.tsx" src/app/styles/components.css tests/unit/components/lead-brief-view.test.tsx tests/unit/components/lead-contact-block-view.test.tsx
git commit -m "feat(leads): /leads/[id] detail page with brief and contact-block renderers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Real `/leads` list

**Files:**
- Create: `src/app/(app)/leads/leads-list.tsx`
- Modify: `src/app/(app)/leads/page.tsx` (replace the empty-only body)
- Modify: `src/app/styles/components.css` (append)
- Test: `tests/unit/components/leads-list.test.tsx`

**Interfaces:**
- Consumes: `listPipelineLeads` (`@/lib/pipeline/data`); `type LeadCard`, `STAGE_LABELS` (`@/lib/pipeline/schema`); `formatScore` (`@/lib/leads/schema`); `Link` (`next/link`); `db` (`@/db/client`); `PageHeader`, `EmptyState` (`@/app/components/ui/*`).
- Produces: the real `/leads` list route and the `LeadsList` component.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/leads-list.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// next/link needs the app-router context at runtime; stub it to a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { LeadsList } from "@/app/(app)/leads/leads-list";
import type { LeadCard } from "@/lib/pipeline/schema";

const base: Omit<LeadCard, "leadId" | "companyName" | "stage"> = {
  vendorName: "Acme Infra",
  intent: "Warehouse buildout",
  score: 8.5,
  hasBrief: true,
  hasContactBlock: false,
  createdAt: new Date("2026-06-01T00:00:00Z"),
};

const leads: LeadCard[] = [
  { ...base, leadId: "10000000-0000-4000-8000-000000000001", companyName: "Zephyr Retail", stage: "sourced" },
  { ...base, leadId: "10000000-0000-4000-8000-000000000002", companyName: "Meridian Logistics", stage: "won" },
];

describe("LeadsList", () => {
  it("renders a linked row per lead pointing at its detail page", () => {
    render(<LeadsList leads={leads} />);
    const zephyr = screen.getByRole("link", { name: /Zephyr Retail/ });
    expect(zephyr).toHaveAttribute("href", "/leads/10000000-0000-4000-8000-000000000001");
    const meridian = screen.getByRole("link", { name: /Meridian Logistics/ });
    expect(meridian).toHaveAttribute("href", "/leads/10000000-0000-4000-8000-000000000002");
  });

  it("shows the stage label and score for each lead", () => {
    render(<LeadsList leads={leads} />);
    expect(screen.getByText("Sourced")).toBeInTheDocument();
    expect(screen.getByText("Won")).toBeInTheDocument();
    expect(screen.getAllByText("8.5").length).toBe(2);
  });

  it("shows a brief tag only where a brief is present", () => {
    render(<LeadsList leads={leads} />);
    expect(screen.getAllByText("brief").length).toBe(2);
    expect(screen.queryByText("contacts")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/leads-list.test.tsx`
Expected: FAIL — module `leads-list` not found.

- [ ] **Step 3: Write `leads-list.tsx`**

Create `src/app/(app)/leads/leads-list.tsx`:

```tsx
import Link from "next/link";
import { STAGE_LABELS, type LeadCard } from "@/lib/pipeline/schema";
import { formatScore } from "@/lib/leads/schema";

export function LeadsList({ leads }: { leads: LeadCard[] }) {
  return (
    <ul className="leads-list">
      {leads.map((lead) => (
        <li key={lead.leadId} className="leads-list-row">
          <Link href={`/leads/${lead.leadId}`} className="leads-list-link">
            <span className="ll-company">{lead.companyName}</span>
            <span className="ll-vendor">{lead.vendorName}</span>
            <span className={`stage-badge stage-dot-${lead.stage}`}>
              {STAGE_LABELS[lead.stage]}
            </span>
            <span className="ll-score">{formatScore(lead.score)}</span>
            <span className="ll-tags">
              {lead.hasBrief && <span className="lead-tag">brief</span>}
              {lead.hasContactBlock && <span className="lead-tag">contacts</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/leads-list.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Replace the `/leads` page body**

Replace the entire contents of `src/app/(app)/leads/page.tsx` with:

```tsx
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { db } from "@/db/client";
import { listPipelineLeads } from "@/lib/pipeline/data";
import { LeadsList } from "./leads-list";

export const metadata = { title: "Leads — Radar" };

export default async function LeadsPage() {
  const leads = await listPipelineLeads(db);
  return (
    <>
      <PageHeader eyebrow="Operate" title="Leads" />
      {leads.length === 0 ? (
        <EmptyState
          icon="leads"
          title="No leads yet"
          description="Companies matched to a vendor with a reverse brief and contact block will appear here. Run `npm run db:source:leads` to generate leads."
        />
      ) : (
        <LeadsList leads={leads} />
      )}
    </>
  );
}
```

- [ ] **Step 6: Append the list CSS**

Append to the very end of `src/app/styles/components.css` (after the Task 3 detail block; pure append, no existing rule touched):

```css

/* Leads list (Phase 5, slice 2) */
.leads-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.leads-list-link {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.25rem 0.75rem;
  align-items: center;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius, 0.5rem);
  text-decoration: none;
  color: var(--text);
}
.leads-list-link:hover,
.leads-list-link:focus-visible {
  border-color: var(--text-faint);
  background: var(--surface, transparent);
}
.ll-company {
  font-weight: 600;
}
.ll-vendor {
  color: var(--text-muted);
  font-size: 0.85rem;
}
.ll-score {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.ll-tags {
  display: flex;
  gap: 0.35rem;
}
@media (min-width: 768px) {
  .leads-list-link {
    grid-template-columns: 2fr 2fr auto auto auto;
  }
}
```

- [ ] **Step 7: Verify the whole suite is green + typecheck + build**

Run: `npx vitest run tests/unit/components/leads-list.test.tsx tests/unit/leads/schema.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: exit 0.
Run: `npm run build`
Expected: success; `/leads` and `/leads/[id]` both dynamic (`ƒ`); no boundary errors.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/leads/leads-list.tsx" "src/app/(app)/leads/page.tsx" src/app/styles/components.css tests/unit/components/leads-list.test.tsx
git commit -m "feat(leads): real /leads list linking each lead to its detail page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `/leads` list → Task 4. ✓
- `/leads/[id]` detail with brief + contact renderers → Task 3. ✓
- `getLeadDetail` read with validated JSONB → Task 2. ✓
- Pure view module (LeadDetail, leadBriefSchema, helpers) → Task 1. ✓
- Reuse `StageControls` unchanged, `notFound()` on miss → Task 3. ✓
- Outreach mode displayed read-only → Task 3 summary `<dl>`. ✓
- No migration, additive only, no shipped-module edits → all tasks touch only new files + the empty `leads/page.tsx` + appended CSS. ✓

**Placeholder scan:** none — every step carries complete code and exact commands.

**Type consistency:** `LeadDetail` fields match `getLeadDetail`'s returned object one-for-one. `leadBriefSchema`'s inferred type is structurally identical to `LeadBrief` (checked at build via the assignment in Task 2 Step 5). `LeadCard` (list) and `LeadDetail` (detail) are distinct and used in the right places. `formatScore` signature identical across Tasks 1/3/4. `OutreachMode` union matches the `outreach_mode` enum values.

**Notes for the reviewer (log to ledger as Minors if raised):**
- `formatScore` duplicates the pipeline board's private local helper. Intentional: extracting into the shared module and rewiring the board would edit a shipped file — out of this slice's additive scope.
- `getLeadDetail` reuses no code from `listPipelineLeads`; the read shapes differ (single full row incl. JSONB vs. list of reduced cards), so no DRY violation.
- Array-index keys in `BriefView`/`ContactBlockView` lists are acceptable — these are static, non-reordered server-rendered lists.
- The `/leads` list reuses `listPipelineLeads` (returns all leads regardless of stage). Semantically correct for "all leads"; renaming the shipped function is out of scope.
