# Reverse Brief Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate an operator-facing, dated-and-sourced reverse brief for each scored lead and persist it to `leads.brief`.

**Architecture:** Three layers mirroring the locked project split — a pure DB-free generator `src/ai/brief/` (schema + prompts + generate, reusing `@/ai/llm`), a server data layer `src/lib/sourcing/brief.ts` (injected `db` + injected `generate`, expands the LLM draft into the persisted brief by pinning `why_now` receipts from the DB), and a batch runner `src/db/brief-generate.ts` (`db:brief:generate`) that wires the real generator into the data layer. No schema change — the `brief jsonb` column already exists.

**Tech Stack:** TypeScript (strict), Next.js 15, Drizzle (postgres-js), Zod, Vitest. LLM via the existing `@/ai/llm` provider chain.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the design spec (`docs/superpowers/specs/2026-07-03-phase4-slice3-reverse-brief-design.md`).

- **Dependency boundary — both directions clean:**
  - `src/ai/brief/*` imports NOTHING from `@/db`, `@/lib/*/data`, or `server-only`. It imports only `zod` and `@/ai/llm` (the latter for `generateObject` + the `LlmMessage` type). This is the locked "src/ai/ = no direct DB access" rule.
  - `src/lib/sourcing/brief.ts` imports NOTHING from `@/ai/*` at runtime — only `import type { … } from "@/ai/brief/schema"` (types erase at runtime). It takes the generator as a **required function parameter**. The DB import is `import type { DB } from "@/db/client"` — the `type` keyword is load-bearing (erased at runtime; never loads the env-eager client).
- **Two brief shapes (proof integrity):**
  - `LeadBriefDraft` (LLM output, the `generateObject` schema): `{ why_them: string; why_now: Array<{ signalId: string; claim: string }>; what_they_need: string; hook: string; why_this_vendor: string; objections: Array<{ objection: string; response: string }> }`.
  - `LeadBrief` (persisted jsonb): the draft with each `why_now` entry expanded to `{ signalId, claim, date, source, evidence }` — `date`/`source`/`evidence` **pinned from the authoritative `signal_observations` row**, never from the LLM — plus `disqualifier_check_passed: true` and `generatedAt: string` (ISO, from the injected `now`).
- **Groundedness:** the system prompt forbids inventing capabilities, geographies, clients, dates, or events; `why_now` claims reference only provided `signalId`s and never state dates/sources; `hook` is a suggested draft. (`BRIEF_SYSTEM` mirrors SIA's `EXTRACTION_SYSTEM` discipline.)
- **Receipt pinning + drop rule:** the data layer builds `why_now` receipts from the contributing observations; any draft `why_now` entry whose `signalId` is not among the contributing observations is DROPPED (never persisted with a fabricated receipt).
- **Selection + idempotency:** generate only for leads where `brief IS NULL`; re-runs re-scan and find nothing → 0 generated. Batch cap `BRIEF_LEAD_LIMIT = 200`. Observation scan cap `OBSERVATION_SCAN_LIMIT = 5000`.
- **`disqualifier_check_passed` is the literal `true`** — a persisted lead fired and was not disqualified by Slice 2; do not re-derive scoring.
- **The write touches only `brief`:** `db.update(leads).set({ brief }).where(eq(leads.leadId, …))` — never `pipeline_stage`, `score`, or `intent`.
- **Failure isolation:** if `generate()` throws for a lead, count it in `failures`, leave that lead un-briefed, and continue the batch.
- **No `console.log`/TODO/silent empty catch in `src/ai` or `src/lib`.** The runner (`src/db/brief-generate.ts`) MAY `console.log`/`console.error` its result summary — that is the sanctioned operator interface (matches `source-leads.ts`).
- **Queries are bounded** (every `select` has a `limit` or an `inArray` over a bounded id set). Parameterized Drizzle only — no string-interpolated SQL.
- **Tests:** unit test lives at `tests/unit/ai/brief-generate.test.ts`; integration test at `tests/integration/sourcing-brief.test.ts`. Unit tests mock `@/ai/llm`; integration tests stub the `generate` parameter (no live LLM, no keys). Every test asserts.
- **Commits:** subagents `git add` ONLY the explicit file paths listed in the task — NEVER `git add .`/`-A`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Pure brief generator — `src/ai/brief/`

**Files:**
- Create: `src/ai/brief/schema.ts`
- Create: `src/ai/brief/prompts.ts`
- Create: `src/ai/brief/generate.ts`
- Create: `src/ai/brief/index.ts`
- Test: `tests/unit/ai/brief-generate.test.ts`

**Interfaces:**
- Consumes: `generateObject<T>(schema, messages): Promise<LlmResult<T>>` and the `LlmMessage` type from `@/ai/llm` (already exists).
- Produces (later tasks rely on these EXACT names/types):
  - `type BriefSignal = { signalId: string; signalName: string; strength: string | null; detectedAt: string; source: string; evidence: string[]; freshnessVerdict: string | null }`
  - `type BriefInput = { company: { name: string; description: string | null }; vendor: { name: string; vendorType: string | null; capabilities: string[] | null; idealCustomer: unknown; differentiators: string | null }; intent: string; mappingName: string; score: number | null; signals: BriefSignal[] }`
  - `const leadBriefDraftSchema` (Zod) and `type LeadBriefDraft = z.infer<typeof leadBriefDraftSchema>`
  - `type BriefProof = { signalId: string; claim: string; date: string; source: string; evidence: string[] }`
  - `type LeadBrief = { why_them: string; why_now: BriefProof[]; what_they_need: string; hook: string; why_this_vendor: string; objections: Array<{ objection: string; response: string }>; disqualifier_check_passed: true; generatedAt: string }`
  - `function buildBriefMessages(input: BriefInput): LlmMessage[]`
  - `async function generateBrief(input: BriefInput): Promise<LlmResult<LeadBriefDraft>>`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/ai/brief-generate.test.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { BriefInput } from "@/ai/brief/schema";
import { leadBriefDraftSchema } from "@/ai/brief/schema";
import { buildBriefMessages } from "@/ai/brief/prompts";

const { mockGenerateObject } = vi.hoisted(() => ({ mockGenerateObject: vi.fn() }));
vi.mock("@/ai/llm", () => ({ generateObject: mockGenerateObject }));

import { generateBrief } from "@/ai/brief/generate";

const input: BriefInput = {
  company: { name: "NorthPort Foods", description: "Cold-chain distributor" },
  vendor: {
    name: "RackPro Infra",
    vendorType: "Infra",
    capabilities: ["pallet racking up to 5t", "mezzanine floors"],
    idealCustomer: null,
    differentiators: "48-hour install crews",
  },
  intent: "Warehouse racking fit-out",
  mappingName: "New DC -> racking",
  score: 88,
  signals: [
    {
      signalId: "SIG-EXP-NEW-FACILITY",
      signalName: "New facility announced",
      strength: "very_high",
      detectedAt: "2026-06-01T00:00:00.000Z",
      source: "press-release",
      evidence: ["https://example.com/pr"],
      freshnessVerdict: "recent",
    },
  ],
};

const draft = {
  why_them: "They just announced a new DC and need racking fast.",
  why_now: [{ signalId: "SIG-EXP-NEW-FACILITY", claim: "New DC announced — racking window is open now." }],
  what_they_need: "Pallet racking for a new cold-chain distribution centre.",
  hook: "Saw NorthPort's new DC announcement — we install racking in 48h.",
  why_this_vendor: "RackPro's 48-hour crews match the tight fit-out window.",
  objections: [{ objection: "May already have a supplier", response: "Offer a rapid-install second-source quote." }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateObject.mockResolvedValue({ value: draft, provider: "anthropic" });
});

describe("buildBriefMessages", () => {
  it("emits a grounded system message and a JSON context user message", () => {
    const messages = buildBriefMessages(input);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Do NOT invent");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("SIG-EXP-NEW-FACILITY");
    expect(messages[1].content).toContain("NorthPort Foods");
  });
});

describe("generateBrief", () => {
  it("calls generateObject with the draft schema and returns the result", async () => {
    const result = await generateBrief(input);
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    expect(mockGenerateObject.mock.calls[0][0]).toBe(leadBriefDraftSchema);
    expect(result.value).toEqual(draft);
    expect(result.provider).toBe("anthropic");
  });
});

describe("leadBriefDraftSchema", () => {
  it("accepts a well-formed draft", () => {
    expect(leadBriefDraftSchema.safeParse(draft).success).toBe(true);
  });
  it("rejects a why_now entry missing signalId", () => {
    const bad = { ...draft, why_now: [{ claim: "no id" }] };
    expect(leadBriefDraftSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/ai/brief-generate.test.ts`
Expected: FAIL — `Cannot find package '@/ai/brief/schema'` (modules do not exist yet).

- [ ] **Step 3: Create the schema module**

Create `src/ai/brief/schema.ts`:

```ts
import { z } from "zod";

// ── Input the generator receives (assembled by the data layer; DB-free here) ──

export type BriefSignal = {
  signalId: string;
  signalName: string;
  strength: string | null;
  detectedAt: string; // ISO
  source: string;
  evidence: string[];
  freshnessVerdict: string | null;
};

export type BriefInput = {
  company: { name: string; description: string | null };
  vendor: {
    name: string;
    vendorType: string | null;
    capabilities: string[] | null;
    idealCustomer: unknown;
    differentiators: string | null;
  };
  intent: string;
  mappingName: string;
  score: number | null;
  signals: BriefSignal[];
};

// ── What the LLM produces (validated by generateObject) ──

export const leadBriefDraftSchema = z.object({
  why_them: z.string(),
  why_now: z.array(
    z.object({
      signalId: z.string(),
      claim: z.string(),
    }),
  ),
  what_they_need: z.string(),
  hook: z.string(),
  why_this_vendor: z.string(),
  objections: z.array(
    z.object({
      objection: z.string(),
      response: z.string(),
    }),
  ),
});

export type LeadBriefDraft = z.infer<typeof leadBriefDraftSchema>;

// ── What the data layer persists to leads.brief (receipts pinned from the DB) ──

export type BriefProof = {
  signalId: string;
  claim: string;
  date: string; // ISO — pinned from observation.detectedAt
  source: string; // pinned from observation.source
  evidence: string[]; // pinned from observation.evidence
};

export type LeadBrief = {
  why_them: string;
  why_now: BriefProof[];
  what_they_need: string;
  hook: string;
  why_this_vendor: string;
  objections: Array<{ objection: string; response: string }>;
  disqualifier_check_passed: true;
  generatedAt: string; // ISO
};
```

- [ ] **Step 4: Create the prompts module**

Create `src/ai/brief/prompts.ts`:

```ts
import type { LlmMessage } from "@/ai/llm";
import type { BriefInput } from "./schema";

const BRIEF_SYSTEM = `You are the reverse-brief writer for a B2B lead-generation platform. An operator will hand your brief to a vendor to help them win a specific company as a customer, right now. Your brief must be persuasive AND defensible: every "why now" claim is backed by a dated, sourced signal the platform already captured.

Rules:
- Use ONLY the facts in the provided input (company, vendor, signals). Do NOT invent capabilities, geographies, clients, dates, or events.
- why_them: the concise case for why this company is a fit for this vendor.
- why_now: for each provided signal that matters, write a one-line \`claim\` of what it means for THIS company, and reference it by its exact \`signalId\`. Never reference a signalId that was not provided. Do NOT put dates or sources in the claim — the platform attaches those from the record.
- what_they_need: the specific thing this company needs that the vendor can supply.
- hook: a short, specific, non-cringe outreach opener. It is a SUGGESTED DRAFT the operator will edit — do not fabricate familiarity or prior contact.
- why_this_vendor: why THIS vendor fits, drawn from the vendor's stated capabilities and differentiators — not generic praise.
- objections: realistic concerns specific to this pairing, each with a grounded response.
Keep every field concise and concrete.`;

export function buildBriefMessages(input: BriefInput): LlmMessage[] {
  const system: LlmMessage = { role: "system", content: BRIEF_SYSTEM };
  const context: LlmMessage = {
    role: "user",
    content: `Write the reverse brief from these facts:\n${JSON.stringify(input, null, 2)}`,
  };
  return [system, context];
}
```

- [ ] **Step 5: Create the generate module**

Create `src/ai/brief/generate.ts`:

```ts
import { generateObject, type LlmResult } from "@/ai/llm";
import { leadBriefDraftSchema, type BriefInput, type LeadBriefDraft } from "./schema";
import { buildBriefMessages } from "./prompts";

export async function generateBrief(
  input: BriefInput,
): Promise<LlmResult<LeadBriefDraft>> {
  const messages = buildBriefMessages(input);
  return generateObject(leadBriefDraftSchema, messages);
}
```

- [ ] **Step 6: Create the barrel**

Create `src/ai/brief/index.ts`:

```ts
export { generateBrief } from "./generate";
export { buildBriefMessages } from "./prompts";
export { leadBriefDraftSchema } from "./schema";
export type {
  BriefInput,
  BriefSignal,
  LeadBriefDraft,
  BriefProof,
  LeadBrief,
} from "./schema";
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/unit/ai/brief-generate.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 8: Verify the client-safety boundary**

Run: `grep -REn "@/db|server-only|@/lib/" src/ai/brief/`
Expected: NO matches (the module imports only `zod` and `@/ai/llm`). If anything prints, stop and report.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/ai/brief/schema.ts src/ai/brief/prompts.ts src/ai/brief/generate.ts src/ai/brief/index.ts tests/unit/ai/brief-generate.test.ts
git commit -m "feat(ai): reverse-brief generator (pure, grounded, @/ai/llm-backed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Data layer — `src/lib/sourcing/brief.ts`

**Files:**
- Create: `src/lib/sourcing/brief.ts`
- Test: `tests/integration/sourcing-brief.test.ts`

**Interfaces:**
- Consumes (from Task 1): the types `BriefInput`, `BriefSignal`, `BriefProof`, `LeadBrief`, `LeadBriefDraft` from `@/ai/brief/schema` (import as `type`). The `generate` function is passed IN as a parameter — this module does NOT import `generateBrief`.
- Produces (Task 3 relies on these EXACT names/types):
  - `type GenerateBriefsResult = { leadsScanned: number; briefsGenerated: number; skippedNoSignals: number; failures: number }`
  - `async function generateBriefsForLeads(db: DB, generate: (input: BriefInput) => Promise<{ value: LeadBriefDraft }>, now?: Date): Promise<GenerateBriefsResult>`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/sourcing-brief.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { companies, signalDefinitions, signalObservations, mappings, vendorProfiles, leads } from "@/db/schema";
import { generateBriefsForLeads } from "@/lib/sourcing/brief";
import type { BriefInput, LeadBrief, LeadBriefDraft } from "@/ai/brief/schema";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => {
  await truncateAll(["leads", "signal_observations", "signal_definitions", "mappings", "vendor_profiles", "companies"]);
});
afterAll(async () => { await closeTestDb(); });

const NOW = new Date("2026-06-15T12:00:00.000Z");
const D_JUN1 = new Date("2026-06-01T00:00:00.000Z");

async function approvedSignal(signalId: string) {
  await testDb.insert(signalDefinitions).values({
    signalId, name: `S ${signalId}`, family: "procurement",
    strength: "very_high", polarity: "positive", falsePositiveRisk: "low", status: "approved", origin: "seed",
  }).onConflictDoNothing();
}
async function makeCompany(name: string): Promise<string> {
  const [c] = await testDb.insert(companies).values({ name, normalizedName: name.toLowerCase() }).returning();
  return c.companyId;
}
async function observe(companyId: string, signalId: string, source: string, evidence: string[], detectedAt: Date) {
  await testDb.insert(signalObservations).values({
    signalId, companyId, detectedAt, source, evidence,
    freshnessVerdict: "recent", entityMatchConfidence: 1, sourceRef: `${signalId}-${companyId}`,
  });
}
async function makeVendor(name: string): Promise<string> {
  const [v] = await testDb.insert(vendorProfiles).values({ name, vendorType: "Infra" }).returning();
  return v.vendorId;
}
async function approvedMapping(name: string, required: string[], supporting: string[] = []): Promise<string> {
  const [m] = await testDb.insert(mappings).values({
    name, servesVendorType: "Infra", status: "approved",
    requiredSignals: required, supportingSignals: supporting, timingWindowDays: 180,
  }).returning();
  return m.mappingId;
}
async function makeLead(vendorId: string, companyId: string, mappingId: string, intent: string): Promise<string> {
  const [l] = await testDb.insert(leads).values({
    vendorId, companyId, matchedMappingId: mappingId, intent, score: 88,
  }).returning();
  return l.leadId;
}

const draft: LeadBriefDraft = {
  why_them: "Fits the ideal customer.",
  why_now: [{ signalId: "SIG-REQ", claim: "Signal fired — the window is open." }],
  what_they_need: "Racking.",
  hook: "Saw your announcement.",
  why_this_vendor: "Fast install crews.",
  objections: [{ objection: "Has a supplier", response: "Second-source quote." }],
};
const stubGenerate = async (_input: BriefInput) => ({ value: draft });

describe("generateBriefsForLeads", () => {
  it("writes a brief with why_now receipts pinned from the DB, not the LLM", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("NorthPort");
    await observe(companyId, "SIG-REQ", "press-release", ["https://x/pr"], D_JUN1);
    const vendorId = await makeVendor("RackPro");
    const mappingId = await approvedMapping("New DC", ["SIG-REQ"]);
    await makeLead(vendorId, companyId, mappingId, "Warehouse racking");

    const res = await generateBriefsForLeads(testDb, stubGenerate, NOW);
    expect(res).toEqual({ leadsScanned: 1, briefsGenerated: 1, skippedNoSignals: 0, failures: 0 });

    const [lead] = await testDb.select().from(leads);
    const brief = lead.brief as LeadBrief;
    expect(brief.why_them).toBe("Fits the ideal customer.");
    expect(brief.why_now).toHaveLength(1);
    expect(brief.why_now[0]).toEqual({
      signalId: "SIG-REQ",
      claim: "Signal fired — the window is open.",
      date: "2026-06-01T00:00:00.000Z", // pinned from the observation, not the stub
      source: "press-release",
      evidence: ["https://x/pr"],
    });
    expect(brief.disqualifier_check_passed).toBe(true);
    expect(brief.generatedAt).toBe("2026-06-15T12:00:00.000Z");
  });

  it("is idempotent — a second run finds no null-brief leads", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("NorthPort");
    await observe(companyId, "SIG-REQ", "press", ["e"], D_JUN1);
    const vendorId = await makeVendor("RackPro");
    const mappingId = await approvedMapping("New DC", ["SIG-REQ"]);
    await makeLead(vendorId, companyId, mappingId, "Racking");

    await generateBriefsForLeads(testDb, stubGenerate, NOW);
    const second = await generateBriefsForLeads(testDb, stubGenerate, NOW);
    expect(second.leadsScanned).toBe(0);
    expect(second.briefsGenerated).toBe(0);
  });

  it("skips a lead whose company has no contributing observation", async () => {
    await approvedSignal("SIG-REQ");
    await approvedSignal("SIG-OTHER");
    const companyId = await makeCompany("NorthPort");
    await observe(companyId, "SIG-OTHER", "press", ["e"], D_JUN1); // not in the mapping's sets
    const vendorId = await makeVendor("RackPro");
    const mappingId = await approvedMapping("New DC", ["SIG-REQ"]);
    await makeLead(vendorId, companyId, mappingId, "Racking");

    const res = await generateBriefsForLeads(testDb, stubGenerate, NOW);
    expect(res.skippedNoSignals).toBe(1);
    expect(res.briefsGenerated).toBe(0);
    const [lead] = await testDb.select().from(leads);
    expect(lead.brief).toBeNull();
  });

  it("counts a failure and continues the batch when generate throws for one lead", async () => {
    await approvedSignal("SIG-REQ");
    const cBoom = await makeCompany("Boom");
    const cGood = await makeCompany("Good");
    await observe(cBoom, "SIG-REQ", "press", ["e"], D_JUN1);
    await observe(cGood, "SIG-REQ", "press", ["e"], D_JUN1);
    const vendorId = await makeVendor("RackPro");
    const mappingId = await approvedMapping("New DC", ["SIG-REQ"]);
    await makeLead(vendorId, cBoom, mappingId, "Racking");
    await makeLead(vendorId, cGood, mappingId, "Racking");

    const selective = async (input: BriefInput) => {
      if (input.company.name === "Boom") throw new Error("provider down");
      return { value: draft };
    };
    const res = await generateBriefsForLeads(testDb, selective, NOW);
    expect(res.failures).toBe(1);
    expect(res.briefsGenerated).toBe(1);
  });

  it("drops a why_now entry whose signalId is not among the contributing observations", async () => {
    await approvedSignal("SIG-REQ");
    const companyId = await makeCompany("NorthPort");
    await observe(companyId, "SIG-REQ", "press", ["e"], D_JUN1);
    const vendorId = await makeVendor("RackPro");
    const mappingId = await approvedMapping("New DC", ["SIG-REQ"]);
    await makeLead(vendorId, companyId, mappingId, "Racking");

    const ghost = async (_input: BriefInput) => ({
      value: {
        ...draft,
        why_now: [
          { signalId: "SIG-GHOST", claim: "fabricated" },
          { signalId: "SIG-REQ", claim: "real" },
        ],
      },
    });
    await generateBriefsForLeads(testDb, ghost, NOW);
    const [lead] = await testDb.select().from(leads);
    const brief = lead.brief as LeadBrief;
    expect(brief.why_now).toHaveLength(1);
    expect(brief.why_now[0].signalId).toBe("SIG-REQ");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/sourcing-brief.test.ts`
Expected: FAIL — `Cannot find package '@/lib/sourcing/brief'`.

- [ ] **Step 3: Implement the data layer**

Create `src/lib/sourcing/brief.ts`:

```ts
import { eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db/client"; // type-only — erased at runtime, never loads the env-eager client
import {
  companies,
  leads,
  mappings,
  signalDefinitions,
  signalObservations,
  vendorProfiles,
} from "@/db/schema";
import type {
  BriefInput,
  BriefProof,
  BriefSignal,
  LeadBrief,
  LeadBriefDraft,
} from "@/ai/brief/schema";

const BRIEF_LEAD_LIMIT = 200;
const OBSERVATION_SCAN_LIMIT = 5000;

export type GenerateBriefsResult = {
  leadsScanned: number;
  briefsGenerated: number;
  skippedNoSignals: number;
  failures: number;
};

// The generator is injected so this module never imports @/ai at runtime and the
// LLM call is trivially stubbable in tests. A real LlmResult<LeadBriefDraft> is
// structurally assignable to { value: LeadBriefDraft }.
type GenerateFn = (input: BriefInput) => Promise<{ value: LeadBriefDraft }>;

/**
 * Generate a reverse brief for each scored lead that does not have one yet, and
 * persist it to leads.brief. why_now receipts (date/source/evidence) are pinned
 * from the authoritative signal_observations rows — the LLM supplies only prose.
 * Caller owns the connection.
 */
export async function generateBriefsForLeads(
  db: DB,
  generate: GenerateFn,
  now: Date = new Date(),
): Promise<GenerateBriefsResult> {
  const result: GenerateBriefsResult = {
    leadsScanned: 0,
    briefsGenerated: 0,
    skippedNoSignals: 0,
    failures: 0,
  };

  const pending = await db
    .select({
      leadId: leads.leadId,
      companyId: leads.companyId,
      vendorId: leads.vendorId,
      matchedMappingId: leads.matchedMappingId,
      intent: leads.intent,
      score: leads.score,
    })
    .from(leads)
    .where(isNull(leads.brief))
    .limit(BRIEF_LEAD_LIMIT);

  result.leadsScanned = pending.length;
  if (pending.length === 0) return result;

  const companyIds = [...new Set(pending.map((l) => l.companyId))];
  const vendorIds = [...new Set(pending.map((l) => l.vendorId))];
  const mappingIds = [
    ...new Set(
      pending.map((l) => l.matchedMappingId).filter((id): id is string => id != null),
    ),
  ];

  const companyRows = await db
    .select({ companyId: companies.companyId, name: companies.name, description: companies.description })
    .from(companies)
    .where(inArray(companies.companyId, companyIds));
  const companyById = new Map(companyRows.map((c) => [c.companyId, c]));

  const vendorRows = await db
    .select({
      vendorId: vendorProfiles.vendorId,
      name: vendorProfiles.name,
      vendorType: vendorProfiles.vendorType,
      capabilities: vendorProfiles.capabilities,
      idealCustomer: vendorProfiles.idealCustomer,
      differentiators: vendorProfiles.differentiators,
    })
    .from(vendorProfiles)
    .where(inArray(vendorProfiles.vendorId, vendorIds));
  const vendorById = new Map(vendorRows.map((v) => [v.vendorId, v]));

  const mappingById = new Map<
    string,
    { mappingId: string; name: string; requiredSignals: string[] | null; supportingSignals: string[] | null }
  >();
  if (mappingIds.length > 0) {
    const mappingRows = await db
      .select({
        mappingId: mappings.mappingId,
        name: mappings.name,
        requiredSignals: mappings.requiredSignals,
        supportingSignals: mappings.supportingSignals,
      })
      .from(mappings)
      .where(inArray(mappings.mappingId, mappingIds));
    for (const m of mappingRows) mappingById.set(m.mappingId, m);
  }

  const obsRows = await db
    .select({
      companyId: signalObservations.companyId,
      signalId: signalObservations.signalId,
      signalName: signalDefinitions.name,
      strength: signalDefinitions.strength,
      detectedAt: signalObservations.detectedAt,
      source: signalObservations.source,
      evidence: signalObservations.evidence,
      freshnessVerdict: signalObservations.freshnessVerdict,
    })
    .from(signalObservations)
    .innerJoin(signalDefinitions, eq(signalObservations.signalId, signalDefinitions.signalId))
    .where(inArray(signalObservations.companyId, companyIds))
    .limit(OBSERVATION_SCAN_LIMIT);
  const obsByCompany = new Map<string, typeof obsRows>();
  for (const o of obsRows) {
    const list = obsByCompany.get(o.companyId) ?? [];
    list.push(o);
    obsByCompany.set(o.companyId, list);
  }

  for (const lead of pending) {
    const company = companyById.get(lead.companyId);
    const vendor = vendorById.get(lead.vendorId);
    const mapping = lead.matchedMappingId ? mappingById.get(lead.matchedMappingId) : undefined;
    if (!company || !vendor || !mapping) {
      result.skippedNoSignals++;
      continue;
    }

    const contributingIds = new Set<string>([
      ...(mapping.requiredSignals ?? []),
      ...(mapping.supportingSignals ?? []),
    ]);
    const companyObs = obsByCompany.get(lead.companyId) ?? [];
    const contributing = companyObs.filter((o) => contributingIds.has(o.signalId));
    if (contributing.length === 0) {
      result.skippedNoSignals++;
      continue;
    }

    // Authoritative receipt map: signalId -> the observation record (pinned facts).
    const obsBySignal = new Map(contributing.map((o) => [o.signalId, o]));

    const signals: BriefSignal[] = contributing.map((o) => ({
      signalId: o.signalId,
      signalName: o.signalName,
      strength: o.strength,
      detectedAt: o.detectedAt.toISOString(),
      source: o.source,
      evidence: o.evidence,
      freshnessVerdict: o.freshnessVerdict,
    }));

    const input: BriefInput = {
      company: { name: company.name, description: company.description },
      vendor: {
        name: vendor.name,
        vendorType: vendor.vendorType,
        capabilities: vendor.capabilities,
        idealCustomer: vendor.idealCustomer,
        differentiators: vendor.differentiators,
      },
      intent: lead.intent ?? mapping.name,
      mappingName: mapping.name,
      score: lead.score,
      signals,
    };

    let draft: LeadBriefDraft;
    try {
      const generated = await generate(input);
      draft = generated.value;
    } catch {
      result.failures++;
      continue;
    }

    // Pin why_now receipts from the DB; drop entries the LLM could not ground.
    const why_now: BriefProof[] = [];
    for (const entry of draft.why_now) {
      const obs = obsBySignal.get(entry.signalId);
      if (!obs) continue;
      why_now.push({
        signalId: entry.signalId,
        claim: entry.claim,
        date: obs.detectedAt.toISOString(),
        source: obs.source,
        evidence: obs.evidence,
      });
    }

    const brief: LeadBrief = {
      why_them: draft.why_them,
      why_now,
      what_they_need: draft.what_they_need,
      hook: draft.hook,
      why_this_vendor: draft.why_this_vendor,
      objections: draft.objections,
      disqualifier_check_passed: true,
      generatedAt: now.toISOString(),
    };

    await db.update(leads).set({ brief }).where(eq(leads.leadId, lead.leadId));
    result.briefsGenerated++;
  }

  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/sourcing-brief.test.ts`
Expected: PASS — 5 tests. (On a transient Neon TRUNCATE/latency failure, re-run 2–3× before investigating.)

- [ ] **Step 5: Verify the no-`@/ai`-runtime boundary**

Run: `grep -n "@/ai" src/lib/sourcing/brief.ts`
Expected: exactly ONE match — `import type { … } from "@/ai/brief/schema"` (a `type` import). If any non-`type` import of `@/ai` prints, stop and report.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sourcing/brief.ts tests/integration/sourcing-brief.test.ts
git commit -m "feat(sourcing): brief data layer — load, ground, pin receipts, persist

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Operator runner — `src/db/brief-generate.ts` + npm script

**Files:**
- Create: `src/db/brief-generate.ts`
- Modify: `package.json` (add one script line)

**Interfaces:**
- Consumes: `generateBrief` from `@/ai/brief` (Task 1); `generateBriefsForLeads` + `GenerateBriefsResult` from `../lib/sourcing/brief` (Task 2); `DB` from `./client`.
- Produces: `async function runBriefGeneration(db: DB): Promise<GenerateBriefsResult>`; the `db:brief:generate` npm script.

- [ ] **Step 1: Create the runner**

Create `src/db/brief-generate.ts` (mirrors `src/db/source-leads.ts` exactly):

```ts
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import type { DB } from "./client";
import { generateBrief } from "../ai/brief";
import { generateBriefsForLeads, type GenerateBriefsResult } from "../lib/sourcing/brief";

/**
 * On-demand reverse-brief run: generate a brief for every scored lead that does
 * not have one yet, and persist it to leads.brief. The caller owns the connection
 * lifecycle. This is the only place a live LLM is invoked.
 */
export async function runBriefGeneration(db: DB): Promise<GenerateBriefsResult> {
  return generateBriefsForLeads(db, generateBrief);
}

// Allow `npm run db:brief:generate` to execute directly.
if (process.argv[1] && process.argv[1].endsWith("brief-generate.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:brief:generate");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  runBriefGeneration(db)
    .then((result) => {
      console.log("Brief generation complete:", JSON.stringify(result));
      return client.end();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Brief generation failed:", e);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add this line immediately after the `"db:source:leads": …` line (keep JSON valid — the preceding line needs a trailing comma):

```json
    "db:brief:generate": "tsx src/db/brief-generate.ts",
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: End-to-end — refresh leads, then generate briefs**

The DB already carries seed + Slice 2 lead data from prior runs. Run, in order:

```bash
npm run db:source:leads
npm run db:brief:generate
```

Expected `db:brief:generate` output — ONE of:
- **Provider key configured:** `Brief generation complete: {"leadsScanned":N,"briefsGenerated":M,...}` with `M >= 1`. Then confirm a real brief landed:
  `psql "$DATABASE_URL" -c "select jsonb_pretty(brief) from leads where brief is not null limit 1;"` (or a Drizzle one-off) — verify `why_now[0]` has a real `date`/`source`/`evidence` and `disqualifier_check_passed: true`.
- **No provider key configured:** `Brief generation failed: … No LLM provider configured …` (the sanitized `AllProvidersFailedError`) and a non-zero exit. This still proves the runner wiring end-to-end. Record which outcome occurred in the report; note that brief-assembly correctness is proven by the Task 2 integration test regardless of a live key.

Do NOT force a DB reset if seeding conflicts (the mass-delete classifier will block it); if there are no null-brief leads to brief, note `leadsScanned:0` and that the data was already briefed by a prior run.

- [ ] **Step 5: Commit**

```bash
git add src/db/brief-generate.ts package.json
git commit -m "feat(sourcing): db:brief:generate runner wiring the live generator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** §3 architecture → Tasks 1–3 (one layer each). §4 shapes → Task 1 `schema.ts` (both types) + Task 2 expansion. §5 data flow → Task 2 `generateBriefsForLeads`. §6 groundedness → Task 1 `BRIEF_SYSTEM`. §7 testing → Task 1 unit test (4 cases) + Task 2 integration test (5 cases). §8 runner + e2e → Task 3. §9 decisions → Global Constraints. No spec requirement is unassigned.

**Placeholder scan:** none — every step has complete code or an exact command with expected output.

**Type consistency:** `BriefInput`/`BriefSignal`/`LeadBriefDraft`/`BriefProof`/`LeadBrief` defined in Task 1 `schema.ts`, imported as `type` in Task 2, and matched field-for-field by the Task 2 expansion. `GenerateFn = (input: BriefInput) => Promise<{ value: LeadBriefDraft }>` accepts the real `generateBrief` (returns `Promise<LlmResult<LeadBriefDraft>>`, a structural subtype) — verified assignable, so Task 3's `generateBriefsForLeads(db, generateBrief)` typechecks. `GenerateBriefsResult` produced in Task 2, consumed in Task 3. Drizzle column types (`strength`, `freshnessVerdict`, `capabilities`, `idealCustomer`, `description`, `score`, `intent`) are all assignable to their `BriefSignal`/`BriefInput` targets with no cast.
