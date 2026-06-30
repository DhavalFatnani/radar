# SIA Interview Engine (Slice 2.2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, DB-free SIA interview engine in `src/ai/sia/` that generates adaptive precision-probing interview questions and extracts a `vendorProfileSchema`-valid vendor profile from a transcript, over the Slice 2.2a LLM layer.

**Architecture:** Stateless functions take an explicit `InterviewState` (transcript + the vendor's current profile) and return either the next question or an extracted profile. Coverage of the five §7.1 interview areas is tracked deterministically via engine-written `[area:X]` tags appended to assistant turns (never emitted by the model, never shown to the user, stripped before every LLM call). Persistence stays in the caller (Slice 2.3) — the engine never imports a DB module.

**Tech Stack:** TypeScript (strict), Next.js 15, Vitest (`vitest run`), Zod, the `@/ai/llm` layer (`generateText` / `generateObject`). Path alias `@/` → `src/`.

## Global Constraints

- **`src/ai/` has NO direct DB access** (`AGENTS.md`). Nothing under `src/ai/sia/` may import `@/db/*` or `@/lib/vendors/data`. Schema + types come **only** from `@/lib/vendors/schema` (created in Task 1) and `@/ai/llm`.
- The engine is **pure and stateless**; it returns data and never persists. `updateVendorProfile` is the caller's job.
- **No secrets in errors.** Do not add try/catch that logs provider errors; let `AllProvidersFailedError` from `@/ai/llm` propagate unchanged.
- **All tests pass with NO API key** — every test that touches `generateText`/`generateObject` mocks `@/ai/llm` (via `vi.hoisted` + `vi.mock`, the Slice 2.2a pattern). No network in tests.
- `knownGoodSignals` is captured as the profile **text field only**; no signal-library / signal-candidate work (deferred to Slice 2.4+).
- TDD: failing test → minimal code → green → commit. Per-task commits on branch `feature/phase2-slice2b-sia-interview-engine`. Commit-message convention: `feat(ai):` / `refactor(vendors):` etc.; end messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- Tests live under `tests/unit/`. Run with `npx vitest run <file>` for a single file.
- The five interview areas, in fixed order: `capabilities`, `constraints`, `idealCustomer`, `knownGoodSignals`, `differentiators`.
- Minimum substantive-answer length: **15 characters** (trimmed).

---

### Task 1: Extract a DB-free `src/lib/vendors/schema.ts`

`vendorProfileSchema` and the vendor types live in `src/lib/vendors/data.ts`, which imports `@/db/client` at module load — and that opens the Postgres connection. The SIA engine must import the schema while staying DB-free. Move the pure pieces into a new module; `data.ts` re-exports them so **every existing importer is untouched**.

**Files:**
- Create: `src/lib/vendors/schema.ts`
- Modify: `src/lib/vendors/data.ts` (remove the moved definitions; import + re-export from `./schema`; leave all functions unchanged)
- Test: `tests/unit/lib/vendors-schema.test.ts`

**Interfaces:**
- Produces (from `@/lib/vendors/schema`): values `vendorStubSchema`, `vendorProfileSchema`; types `VendorStubInput`, `VendorListItem`, `VendorConstraints`, `InterviewHistoryEntry`, `VendorProfile`, `VendorProfileInput`.
- `VendorProfile = { vendorId: string; name: string; capabilities: string[]; constraints: VendorConstraints | null; idealCustomer: string | null; knownGoodSignals: string | null; differentiators: string | null; credibility: string | null; version: number; interviewHistory: InterviewHistoryEntry[] }`.
- `VendorProfileInput = z.infer<typeof vendorProfileSchema>` — fields: `name: string`, `capabilities: string[]`, `constraints: { minProjectSize?, maxProjectSize?, geographies?: string[], capacity?, currentLoad?, workingCapitalLimit?, leadTimes? }`, and optional `idealCustomer`, `knownGoodSignals`, `differentiators`, `credibility` (each `string | undefined`).
- `data.ts` continues to export `createVendorStub`, `listVendors`, `getVendor`, `updateVendorProfile` (unchanged) plus the re-exported schema/types.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/vendors-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { vendorProfileSchema, vendorStubSchema } from "@/lib/vendors/schema";

describe("vendors/schema (DB-free)", () => {
  it("parses and normalises a profile input", () => {
    const parsed = vendorProfileSchema.parse({
      name: "Acme",
      capabilities: "racking, cctv",
      constraints: { geographies: "Maharashtra\nGujarat", maxProjectSize: "100000 sqft" },
      idealCustomer: "Mid-size 3PLs",
    });
    expect(parsed.capabilities).toEqual(["racking", "cctv"]);
    expect(parsed.constraints.geographies).toEqual(["Maharashtra", "Gujarat"]);
    expect(parsed.constraints.maxProjectSize).toBe("100000 sqft");
    expect(parsed.idealCustomer).toBe("Mid-size 3PLs");
    expect(parsed.knownGoodSignals).toBeUndefined();
  });

  it("rejects an empty name", () => {
    expect(() => vendorStubSchema.parse({ name: "  " })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/vendors-schema.test.ts`
Expected: FAIL — cannot resolve `@/lib/vendors/schema` (module does not exist yet).

- [ ] **Step 3: Create `src/lib/vendors/schema.ts`**

```ts
import { z } from "zod";

export const vendorStubSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required.").max(200, "Vendor name is too long."),
});
export type VendorStubInput = z.infer<typeof vendorStubSchema>;

export type VendorListItem = { vendorId: string; name: string };

export type VendorConstraints = {
  minProjectSize?: string;
  maxProjectSize?: string;
  geographies?: string[];
  capacity?: string;
  currentLoad?: string;
  workingCapitalLimit?: string;
  leadTimes?: string;
};

export type InterviewHistoryEntry = {
  at: string;
  actor: "operator";
  kind: "manual_edit";
  changed: string[];
  version: number;
};

export type VendorProfile = {
  vendorId: string;
  name: string;
  capabilities: string[];
  constraints: VendorConstraints | null;
  idealCustomer: string | null;
  knownGoodSignals: string | null;
  differentiators: string | null;
  credibility: string | null;
  version: number;
  interviewHistory: InterviewHistoryEntry[];
};

// Parse a newline/comma-separated string (or an array) into a clean string list.
const stringList = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(/[\n,]/)))
  .transform((arr) => arr.map((s) => s.trim()).filter(Boolean));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

const constraintsSchema = z.object({
  minProjectSize: optionalText(200),
  maxProjectSize: optionalText(200),
  geographies: stringList.optional(),
  capacity: optionalText(200),
  currentLoad: optionalText(200),
  workingCapitalLimit: optionalText(200),
  leadTimes: optionalText(200),
});

export const vendorProfileSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required.").max(200, "Vendor name is too long."),
  capabilities: stringList,
  constraints: constraintsSchema,
  idealCustomer: optionalText(4000),
  knownGoodSignals: optionalText(4000),
  differentiators: optionalText(4000),
  credibility: optionalText(4000),
});
export type VendorProfileInput = z.infer<typeof vendorProfileSchema>;
```

- [ ] **Step 4: Rewrite the top of `src/lib/vendors/data.ts`**

Replace the **current** top of the file (the `import { ... } from "zod"` line and **all** the schema/type definitions — `vendorStubSchema`, `VendorStubInput`, `VendorListItem`, `VendorConstraints`, `InterviewHistoryEntry`, `VendorProfile`, `stringList`, `optionalText`, `constraintsSchema`, `vendorProfileSchema`, `VendorProfileInput`) with the block below. **Keep everything from `function unwrapText(...)` onward unchanged** (the `unwrapText`, `NormalizedProfile`, `normalizeConstraints`, `normalizeProfile`, `comparable`, `changedFields` helpers and the `createVendorStub`, `listVendors`, `getVendor`, `updateVendorProfile` functions stay exactly as they are).

New top of `data.ts`:

```ts
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { vendorProfiles } from "@/db/schema";
import {
  vendorStubSchema,
  vendorProfileSchema,
  type VendorStubInput,
  type VendorListItem,
  type VendorConstraints,
  type InterviewHistoryEntry,
  type VendorProfile,
  type VendorProfileInput,
} from "./schema";

// Re-export the pure schema + types so existing importers of "@/lib/vendors/data" keep working.
export { vendorStubSchema, vendorProfileSchema };
export type {
  VendorStubInput,
  VendorListItem,
  VendorConstraints,
  InterviewHistoryEntry,
  VendorProfile,
  VendorProfileInput,
};
```

Note: `vendorStubSchema` and `vendorProfileSchema` are imported only to re-export them; `createVendorStub`/`listVendors`/`getVendor`/`updateVendorProfile` already reference the imported **types**. Do not change any function body.

- [ ] **Step 5: Run the new test + the full existing vendor suite**

Run: `npx vitest run tests/unit/lib/vendors-schema.test.ts tests/integration/vendors-data.test.ts tests/integration/vendors-profile-data.test.ts tests/integration/vendors-update-action.test.ts tests/unit/components/edit-profile-form.test.tsx`
Expected: PASS — the new schema test passes and all four existing vendor tests still pass (re-exports preserve the public surface). (Integration tests need the DB env; if `TEST_DATABASE_URL` is unset they are skipped/fail on connection — in that case run at least the two unit tests and `npx tsc --noEmit`.)

- [ ] **Step 6: Verify the new module is DB-free**

Run: `grep -n "db/client\|@/db" src/lib/vendors/schema.ts; echo "exit: $?"`
Expected: no matches (grep exits 1) — `schema.ts` imports nothing from the DB layer.

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

```bash
git add src/lib/vendors/schema.ts src/lib/vendors/data.ts tests/unit/lib/vendors-schema.test.ts
git commit -m "refactor(vendors): extract DB-free schema module

Move vendorProfileSchema + types to src/lib/vendors/schema.ts; data.ts
re-exports them so importers are untouched. Lets the SIA engine import
the schema without booting the Postgres client.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `src/ai/sia/types.ts` + `coverage.ts` (deterministic coverage + tag helpers)

The coverage module owns the `[area:X]` tag wire-format (append/strip/parse) and the deterministic coverage assessment. `types.ts` holds the shared types (scaffolding folded into this task — coverage is the first consumer).

**Files:**
- Create: `src/ai/sia/types.ts`
- Create: `src/ai/sia/coverage.ts`
- Test: `tests/unit/ai/sia-coverage.test.ts`

**Interfaces:**
- Produces (`types.ts`): `InterviewArea` (union of the five area strings); `InterviewState = { messages: LlmMessage[]; existingProfile?: VendorProfile | null }`; `CoverageReport = { covered: InterviewArea[]; remaining: InterviewArea[]; isComplete: boolean }`; `NextQuestion = { question: string; transcriptEntry: LlmMessage; targetArea: InterviewArea; coverage: CoverageReport }`.
- Produces (`coverage.ts`): `AREA_ORDER: InterviewArea[]`; `MIN_ANSWER_LENGTH = 15`; `appendAreaTag(text: string, area: InterviewArea): string`; `stripAreaTag(text: string): string`; `parseAreaTag(text: string): InterviewArea | null`; `assessCoverage(state: InterviewState): CoverageReport`.
- Consumes: `LlmMessage` from `@/ai/llm`; `VendorProfile` from `@/lib/vendors/schema`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai/sia-coverage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { LlmMessage } from "@/ai/llm";
import type { InterviewArea } from "@/ai/sia/types";
import {
  assessCoverage,
  appendAreaTag,
  stripAreaTag,
  parseAreaTag,
  AREA_ORDER,
} from "@/ai/sia/coverage";

function exchange(area: InterviewArea, answer: string): LlmMessage[] {
  return [
    { role: "assistant", content: appendAreaTag("What can you do?", area) },
    { role: "user", content: answer },
  ];
}

describe("tag helpers", () => {
  it("appends and parses an area tag round-trip", () => {
    const tagged = appendAreaTag("Tell me more.", "knownGoodSignals");
    expect(tagged).toContain("[area:knownGoodSignals]");
    expect(parseAreaTag(tagged)).toBe("knownGoodSignals");
    expect(stripAreaTag(tagged)).toBe("Tell me more.");
  });

  it("parseAreaTag returns null when there is no tag", () => {
    expect(parseAreaTag("just a plain question")).toBeNull();
  });
});

describe("assessCoverage", () => {
  it("reports all areas remaining for an empty transcript", () => {
    const report = assessCoverage({ messages: [] });
    expect(report.covered).toEqual([]);
    expect(report.remaining).toEqual(AREA_ORDER);
    expect(report.isComplete).toBe(false);
  });

  it("marks an area covered only with a substantive answer", () => {
    const messages: LlmMessage[] = [
      ...exchange("capabilities", "We do pallet racking up to 5 tonnes and CCTV."),
      ...exchange("constraints", "no"), // too short → not covered
    ];
    const report = assessCoverage({ messages });
    expect(report.covered).toEqual(["capabilities"]);
    expect(report.remaining).toEqual([
      "constraints",
      "idealCustomer",
      "knownGoodSignals",
      "differentiators",
    ]);
    expect(report.isComplete).toBe(false);
  });

  it("is complete when every area has a substantive answer", () => {
    const longAnswer = "This is a detailed and substantive answer about the topic.";
    const messages: LlmMessage[] = AREA_ORDER.flatMap((a) => exchange(a, longAnswer));
    const report = assessCoverage({ messages });
    expect(report.remaining).toEqual([]);
    expect(report.isComplete).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai/sia-coverage.test.ts`
Expected: FAIL — cannot resolve `@/ai/sia/types` / `@/ai/sia/coverage`.

- [ ] **Step 3: Create `src/ai/sia/types.ts`**

```ts
import type { LlmMessage } from "@/ai/llm";
import type { VendorProfile } from "@/lib/vendors/schema";

export type InterviewArea =
  | "capabilities"
  | "constraints"
  | "idealCustomer"
  | "knownGoodSignals"
  | "differentiators";

// The full conversation so far. Assistant turns carry an engine-appended
// [area:X] tag line; user turns are the vendor's raw answers. The system
// message is built per call by the engine and is NOT stored here.
export type InterviewState = {
  messages: LlmMessage[];
  // The vendor's current persisted profile. A vendor always exists before an
  // interview (created via createVendorStub), so the caller passes
  // getVendor(vendorId): the stub (name set, fields empty) on a first
  // interview, a fuller profile on a re-interview.
  existingProfile?: VendorProfile | null;
};

export type CoverageReport = {
  covered: InterviewArea[];
  remaining: InterviewArea[];
  isComplete: boolean;
};

export type NextQuestion = {
  question: string; // clean text to display (no tag)
  transcriptEntry: LlmMessage; // assistant turn to append to state.messages (tag retained)
  targetArea: InterviewArea;
  coverage: CoverageReport;
};
```

- [ ] **Step 4: Create `src/ai/sia/coverage.ts`**

```ts
import type { LlmMessage } from "@/ai/llm";
import type { InterviewArea, InterviewState, CoverageReport } from "./types";

// Fixed questioning order; also the order `remaining` is returned in.
export const AREA_ORDER: InterviewArea[] = [
  "capabilities",
  "constraints",
  "idealCustomer",
  "knownGoodSignals",
  "differentiators",
];

// A user turn must clear this trimmed length to count as a substantive answer.
export const MIN_ANSWER_LENGTH = 15;

const AREA_TAG_RE = /\[area:([A-Za-z]+)\]\s*$/;

// Engine appends this to each assistant turn so coverage is re-derivable from
// the transcript alone. The model never produces it; it is never displayed.
export function appendAreaTag(text: string, area: InterviewArea): string {
  return `${text.trimEnd()}\n[area:${area}]`;
}

export function stripAreaTag(text: string): string {
  return text.replace(/\n?\[area:[A-Za-z]+\]\s*$/, "").trimEnd();
}

export function parseAreaTag(text: string): InterviewArea | null {
  const match = text.match(AREA_TAG_RE);
  if (!match) return null;
  const area = match[1] as InterviewArea;
  return AREA_ORDER.includes(area) ? area : null;
}

function isAreaAddressed(messages: LlmMessage[], area: InterviewArea): boolean {
  for (let i = 0; i < messages.length - 1; i += 1) {
    const turn = messages[i];
    if (turn.role === "assistant" && parseAreaTag(turn.content) === area) {
      const answer = messages[i + 1];
      if (answer.role === "user" && answer.content.trim().length >= MIN_ANSWER_LENGTH) {
        return true;
      }
    }
  }
  return false;
}

export function assessCoverage(state: InterviewState): CoverageReport {
  const covered = AREA_ORDER.filter((area) => isAreaAddressed(state.messages, area));
  const remaining = AREA_ORDER.filter((area) => !covered.includes(area));
  return { covered, remaining, isComplete: remaining.length === 0 };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/ai/sia-coverage.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/ai/sia/types.ts src/ai/sia/coverage.ts tests/unit/ai/sia-coverage.test.ts
git commit -m "feat(ai): SIA engine types + deterministic coverage

Engine-owned [area:X] tag helpers and assessCoverage over the five
interview areas. Pure, no LLM, no DB.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `src/ai/sia/prompts.ts` (SIA system prompts + message builders)

Pure builders that assemble the `LlmMessage[]` for question generation and extraction. They strip the engine's `[area:X]` tags from history (the model never sees them) and inject the existing profile + target-area focus.

**Files:**
- Create: `src/ai/sia/prompts.ts`
- Test: `tests/unit/ai/sia-prompts.test.ts`

**Interfaces:**
- Produces: `buildQuestionMessages(state: InterviewState, targetArea: InterviewArea): LlmMessage[]`; `buildExtractionMessages(state: InterviewState): LlmMessage[]`.
- Consumes: `LlmMessage` from `@/ai/llm`; `InterviewArea`, `InterviewState` from `./types`; `stripAreaTag` from `./coverage`; `VendorProfile` from `@/lib/vendors/schema`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai/sia-prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { LlmMessage } from "@/ai/llm";
import type { VendorProfile } from "@/lib/vendors/schema";
import { appendAreaTag } from "@/ai/sia/coverage";
import { buildQuestionMessages, buildExtractionMessages } from "@/ai/sia/prompts";

const stubProfile: VendorProfile = {
  vendorId: "v1",
  name: "Acme Storage",
  capabilities: [],
  constraints: null,
  idealCustomer: null,
  knownGoodSignals: null,
  differentiators: null,
  credibility: null,
  version: 1,
  interviewHistory: [],
};

function noTags(messages: LlmMessage[]): boolean {
  return messages.every((m) => !m.content.includes("[area:"));
}

describe("buildQuestionMessages", () => {
  it("starts with a system message and opens broadly on an empty transcript", () => {
    const messages = buildQuestionMessages({ messages: [] }, "capabilities");
    expect(messages[0].role).toBe("system");
    expect(messages[0].content.toLowerCase()).toContain("what their company does");
    expect(messages).toHaveLength(1); // system only, no history yet
  });

  it("focuses on the target area mid-interview and strips tags from history", () => {
    const history: LlmMessage[] = [
      { role: "assistant", content: appendAreaTag("What do you do?", "capabilities") },
      { role: "user", content: "We install pallet racking and CCTV across warehouses." },
    ];
    const messages = buildQuestionMessages({ messages: history }, "constraints");
    expect(messages[0].content.toUpperCase()).toContain("CONSTRAINTS");
    expect(noTags(messages)).toBe(true); // the assistant tag was stripped
    expect(messages.at(-1)?.content).toContain("pallet racking");
  });

  it("includes existing profile context when the profile has content", () => {
    const filled: VendorProfile = { ...stubProfile, capabilities: ["racking"], idealCustomer: "3PLs" };
    const messages = buildQuestionMessages({ messages: [], existingProfile: filled }, "constraints");
    expect(messages[0].content).toContain("already on file");
    expect(messages[0].content).toContain("racking");
  });
});

describe("buildExtractionMessages", () => {
  it("pins the name in context, includes the transcript, and ends with an extract instruction", () => {
    const history: LlmMessage[] = [
      { role: "assistant", content: appendAreaTag("What do you do?", "capabilities") },
      { role: "user", content: "Pallet racking up to 5 tonnes in Maharashtra." },
    ];
    const messages = buildExtractionMessages({ messages: history, existingProfile: stubProfile });
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain('"Acme Storage"');
    expect(noTags(messages)).toBe(true);
    expect(messages.at(-1)?.role).toBe("user");
    expect(messages.at(-1)?.content.toLowerCase()).toContain("produce");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai/sia-prompts.test.ts`
Expected: FAIL — cannot resolve `@/ai/sia/prompts`.

- [ ] **Step 3: Create `src/ai/sia/prompts.ts`**

```ts
import type { LlmMessage } from "@/ai/llm";
import type { VendorProfile } from "@/lib/vendors/schema";
import { stripAreaTag } from "./coverage";
import type { InterviewArea, InterviewState } from "./types";

const SYSTEM_BASE = `You are SIA, the Supplier Intelligence Agent for a B2B lead-generation platform. An operator is sitting with a vendor and relays your questions to them. Your job is to build a PRECISE profile of what this vendor does, so the platform can find them high-quality leads.

Vendors describe themselves vaguely by default. Your single most important behaviour is to push vague answers toward precision. If a vendor says "we do warehouse setups", probe for specifics: what exactly, to what scale, in which regions, with what constraints. If they say "we serve all of India", ask whether that is supply everywhere, or installation only in some regions.

Ask ONE focused question at a time. Keep it short and conversational — the operator will read it aloud. Do not summarise, lecture, or ask several things at once.`;

const OPENER = `This is the very start of the interview. Open broadly and warmly: in one sentence, ask the vendor to describe, in their own words, what their company does.`;

const AREA_FOCUS: Record<InterviewArea, string> = {
  capabilities:
    "Focus on CAPABILITIES: the specific services or products they deliver, to what scale, with what equipment, materials, or skills. Push for granularity (e.g. 'racking up to 5 tonnes', not 'storage solutions').",
  constraints:
    "Focus on CONSTRAINTS: what they will NOT do, minimum and maximum project size, the geographies they actually serve (supply vs install), capacity / current load, working-capital limits, and typical lead times.",
  idealCustomer:
    "Focus on their IDEAL CUSTOMER: the kind of company they serve best — industry, size, situation. If they are unsure, help them describe their best past customers.",
  knownGoodSignals:
    "Focus on BUYING SIGNALS: ask what real-world events tell them a company is about to need them ('when a company does X, that's when they need us'). Draw out concrete, observable triggers.",
  differentiators:
    "Focus on DIFFERENTIATORS and PROOF: what sets them apart from competitors, plus case studies, numbers, or named clients that prove it.",
};

const EXTRACTION_SYSTEM = `You are SIA, extracting a structured vendor profile from an interview transcript. Read the whole conversation and fill in the profile fields as precisely as the transcript supports.

Rules:
- Use ONLY information stated in the transcript or already on file. Do not invent capabilities, geographies, or clients.
- capabilities: a granular list of what the vendor can do.
- constraints: only the sub-fields the transcript supports (minProjectSize, maxProjectSize, geographies, capacity, currentLoad, workingCapitalLimit, leadTimes); leave the rest empty.
- idealCustomer, knownGoodSignals, differentiators, credibility: concise prose drawn from the transcript.
- If a field was not discussed but a value is already on file, keep the on-file value. If neither, leave it empty.`;

function hasProfileContent(p: VendorProfile): boolean {
  return (
    p.capabilities.length > 0 ||
    Boolean(p.idealCustomer) ||
    Boolean(p.knownGoodSignals) ||
    Boolean(p.differentiators) ||
    Boolean(p.credibility) ||
    (p.constraints != null && Object.keys(p.constraints).length > 0)
  );
}

function profileContext(p: VendorProfile): string {
  return JSON.stringify(
    {
      capabilities: p.capabilities,
      constraints: p.constraints,
      idealCustomer: p.idealCustomer,
      knownGoodSignals: p.knownGoodSignals,
      differentiators: p.differentiators,
      credibility: p.credibility,
    },
    null,
    2,
  );
}

// Remove engine-written [area:X] tags from assistant turns so the model never
// sees them. User turns pass through unchanged.
function withoutTags(messages: LlmMessage[]): LlmMessage[] {
  return messages.map((m) =>
    m.role === "assistant" ? { ...m, content: stripAreaTag(m.content) } : m,
  );
}

export function buildQuestionMessages(
  state: InterviewState,
  targetArea: InterviewArea,
): LlmMessage[] {
  const parts = [SYSTEM_BASE];
  if (state.existingProfile && hasProfileContent(state.existingProfile)) {
    parts.push(
      `Here is what is already on file for this vendor:\n${profileContext(state.existingProfile)}\nAsk only about what is new, unclear, or has changed.`,
    );
  }
  parts.push(state.messages.length === 0 ? OPENER : AREA_FOCUS[targetArea]);

  const system: LlmMessage = { role: "system", content: parts.join("\n\n") };
  return [system, ...withoutTags(state.messages)];
}

export function buildExtractionMessages(state: InterviewState): LlmMessage[] {
  const parts = [EXTRACTION_SYSTEM];
  if (state.existingProfile) {
    parts.push(`The vendor's name is "${state.existingProfile.name}". Use it exactly as the name field.`);
    if (hasProfileContent(state.existingProfile)) {
      parts.push(
        `Currently on file (preserve any field the transcript does not change):\n${profileContext(state.existingProfile)}`,
      );
    }
  }
  const system: LlmMessage = { role: "system", content: parts.join("\n\n") };
  const instruction: LlmMessage = {
    role: "user",
    content: "Now produce the structured vendor profile from this conversation.",
  };
  return [system, ...withoutTags(state.messages), instruction];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ai/sia-prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/ai/sia/prompts.ts tests/unit/ai/sia-prompts.test.ts
git commit -m "feat(ai): SIA prompt builders for questions and extraction

Pure message builders: inject existing-profile context + target-area
focus, strip engine [area:X] tags from history before the LLM sees it.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `src/ai/sia/interview.ts` (`nextQuestion`)

Picks the target area from coverage, asks the LLM, and appends the engine tag to the stored turn.

**Files:**
- Create: `src/ai/sia/interview.ts`
- Test: `tests/unit/ai/sia-interview.test.ts`

**Interfaces:**
- Produces: `nextQuestion(state: InterviewState): Promise<NextQuestion>`.
- Consumes: `generateText` + `LlmMessage` from `@/ai/llm`; `assessCoverage`, `appendAreaTag`, `AREA_ORDER` from `./coverage`; `buildQuestionMessages` from `./prompts`; `InterviewState`, `NextQuestion` from `./types`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai/sia-interview.test.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { LlmMessage } from "@/ai/llm";
import { appendAreaTag } from "@/ai/sia/coverage";

const { mockGenerateText } = vi.hoisted(() => ({ mockGenerateText: vi.fn() }));
vi.mock("@/ai/llm", () => ({ generateText: mockGenerateText }));

import { nextQuestion } from "@/ai/sia/interview";

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateText.mockResolvedValue({ value: "What exactly do you install?", provider: "anthropic" });
});

describe("nextQuestion", () => {
  it("targets capabilities first and tags the stored turn", async () => {
    const result = await nextQuestion({ messages: [] });
    expect(result.targetArea).toBe("capabilities");
    expect(result.question).toBe("What exactly do you install?");
    expect(result.transcriptEntry.role).toBe("assistant");
    expect(result.transcriptEntry.content).toContain("[area:capabilities]");
    expect(result.coverage.isComplete).toBe(false);
  });

  it("advances to the next uncovered area", async () => {
    const messages: LlmMessage[] = [
      { role: "assistant", content: appendAreaTag("What do you do?", "capabilities") },
      { role: "user", content: "We install pallet racking and CCTV across warehouses." },
    ];
    const result = await nextQuestion({ messages });
    expect(result.targetArea).toBe("constraints");
  });

  it("never sends [area:X] tags to the LLM", async () => {
    const messages: LlmMessage[] = [
      { role: "assistant", content: appendAreaTag("What do you do?", "capabilities") },
      { role: "user", content: "We install pallet racking and CCTV across warehouses." },
    ];
    await nextQuestion({ messages });
    const sent = mockGenerateText.mock.calls[0][0] as LlmMessage[];
    expect(sent.every((m) => !m.content.includes("[area:"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai/sia-interview.test.ts`
Expected: FAIL — cannot resolve `@/ai/sia/interview`.

- [ ] **Step 3: Create `src/ai/sia/interview.ts`**

```ts
import { generateText, type LlmMessage } from "@/ai/llm";
import { assessCoverage, appendAreaTag, AREA_ORDER } from "./coverage";
import { buildQuestionMessages } from "./prompts";
import type { InterviewState, NextQuestion } from "./types";

export async function nextQuestion(state: InterviewState): Promise<NextQuestion> {
  const coverage = assessCoverage(state);
  // Drill the first still-thin area; if all are covered, do a closing probe on
  // the last area.
  const targetArea = coverage.remaining[0] ?? AREA_ORDER[AREA_ORDER.length - 1];

  const messages = buildQuestionMessages(state, targetArea);
  const { value } = await generateText(messages);
  const question = value.trim();

  const transcriptEntry: LlmMessage = {
    role: "assistant",
    content: appendAreaTag(question, targetArea),
  };

  return { question, transcriptEntry, targetArea, coverage };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ai/sia-interview.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/ai/sia/interview.ts tests/unit/ai/sia-interview.test.ts
git commit -m "feat(ai): SIA nextQuestion — adaptive area-targeted probing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `src/ai/sia/extract.ts` (`extractProfile` with name pinning)

Runs structured extraction and pins `name` from the persisted profile so a model hallucination can't rename the vendor.

**Files:**
- Create: `src/ai/sia/extract.ts`
- Test: `tests/unit/ai/sia-extract.test.ts`

**Interfaces:**
- Produces: `extractProfile(state: InterviewState): Promise<LlmResult<VendorProfileInput>>`.
- Consumes: `generateObject` + `LlmResult` from `@/ai/llm`; `vendorProfileSchema` + `VendorProfileInput` from `@/lib/vendors/schema`; `buildExtractionMessages` from `./prompts`; `InterviewState` from `./types`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai/sia-extract.test.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { LlmMessage } from "@/ai/llm";
import type { VendorProfile, VendorProfileInput } from "@/lib/vendors/schema";

const { mockGenerateObject } = vi.hoisted(() => ({ mockGenerateObject: vi.fn() }));
vi.mock("@/ai/llm", () => ({ generateObject: mockGenerateObject }));

import { extractProfile } from "@/ai/sia/extract";

const transcript: LlmMessage[] = [
  { role: "assistant", content: "What do you do?" },
  { role: "user", content: "Pallet racking up to 5 tonnes in Maharashtra." },
];

const extracted: VendorProfileInput = {
  name: "Hallucinated Name",
  capabilities: ["pallet racking"],
  constraints: { geographies: ["Maharashtra"] },
  idealCustomer: undefined,
  knownGoodSignals: undefined,
  differentiators: undefined,
  credibility: undefined,
};

const stub: VendorProfile = {
  vendorId: "v1",
  name: "Acme Storage",
  capabilities: [],
  constraints: null,
  idealCustomer: null,
  knownGoodSignals: null,
  differentiators: null,
  credibility: null,
  version: 1,
  interviewHistory: [],
};

beforeEach(() => vi.clearAllMocks());

describe("extractProfile", () => {
  it("returns the validated value and provider", async () => {
    mockGenerateObject.mockResolvedValueOnce({ value: extracted, provider: "anthropic" });
    const result = await extractProfile({ messages: transcript });
    expect(result.provider).toBe("anthropic");
    expect(result.value.capabilities).toEqual(["pallet racking"]);
  });

  it("pins name from the existing profile over a hallucinated one", async () => {
    mockGenerateObject.mockResolvedValueOnce({ value: extracted, provider: "anthropic" });
    const result = await extractProfile({ messages: transcript, existingProfile: stub });
    expect(result.value.name).toBe("Acme Storage");
  });

  it("keeps the model name when there is no existing profile", async () => {
    mockGenerateObject.mockResolvedValueOnce({ value: extracted, provider: "anthropic" });
    const result = await extractProfile({ messages: transcript });
    expect(result.value.name).toBe("Hallucinated Name");
  });

  it("does not swallow LLM errors", async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error("all providers failed"));
    await expect(extractProfile({ messages: transcript })).rejects.toThrow("all providers failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai/sia-extract.test.ts`
Expected: FAIL — cannot resolve `@/ai/sia/extract`.

- [ ] **Step 3: Create `src/ai/sia/extract.ts`**

```ts
import { generateObject, type LlmResult } from "@/ai/llm";
import { vendorProfileSchema, type VendorProfileInput } from "@/lib/vendors/schema";
import { buildExtractionMessages } from "./prompts";
import type { InterviewState } from "./types";

export async function extractProfile(
  state: InterviewState,
): Promise<LlmResult<VendorProfileInput>> {
  const messages = buildExtractionMessages(state);
  const result = await generateObject(vendorProfileSchema, messages);

  // The vendor name is authoritative from the persisted profile, never from
  // the transcript — pin it so extraction can't rename the vendor.
  const pinnedName = state.existingProfile?.name;
  const value = pinnedName ? { ...result.value, name: pinnedName } : result.value;

  return { value, provider: result.provider };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ai/sia-extract.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/ai/sia/extract.ts tests/unit/ai/sia-extract.test.ts
git commit -m "feat(ai): SIA extractProfile — structured extraction with name pinning

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `src/ai/sia/index.ts` (public API) + README

Thin public surface; documents the engine.

**Files:**
- Create: `src/ai/sia/index.ts`
- Modify: `README.md` (add an SIA engine section after the LLM-providers section)
- Test: `tests/unit/ai/sia-index.test.ts`

**Interfaces:**
- Produces (from `@/ai/sia`): `nextQuestion`, `extractProfile`, `assessCoverage`; types `InterviewArea`, `InterviewState`, `CoverageReport`, `NextQuestion`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai/sia-index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as sia from "@/ai/sia";

describe("@/ai/sia public API", () => {
  it("exposes the three engine functions", () => {
    expect(typeof sia.nextQuestion).toBe("function");
    expect(typeof sia.extractProfile).toBe("function");
    expect(typeof sia.assessCoverage).toBe("function");
  });

  it("assessCoverage is callable without an LLM (pure)", () => {
    const report = sia.assessCoverage({ messages: [] });
    expect(report.isComplete).toBe(false);
    expect(report.remaining).toContain("capabilities");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai/sia-index.test.ts`
Expected: FAIL — cannot resolve `@/ai/sia`.

- [ ] **Step 3: Create `src/ai/sia/index.ts`**

```ts
export { nextQuestion } from "./interview";
export { extractProfile } from "./extract";
export { assessCoverage } from "./coverage";
export type { InterviewArea, InterviewState, CoverageReport, NextQuestion } from "./types";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ai/sia-index.test.ts`
Expected: PASS.

- [ ] **Step 5: Document the engine in `README.md`**

Add this section immediately after the existing "LLM providers (Phase 2 · Slice 2.2a)" section:

```markdown
### SIA interview engine (Phase 2 · Slice 2.2b)

`src/ai/sia/` is a pure, DB-free engine over the LLM layer. The caller (the
interview UI, Slice 2.3) holds the conversation and persistence; the engine
only generates questions and extracts a structured profile.

```ts
import { nextQuestion, extractProfile, assessCoverage } from "@/ai/sia";
import { getVendor, updateVendorProfile } from "@/lib/vendors/data";

const existingProfile = await getVendor(vendorId);
const state = { messages, existingProfile };

// One interview turn:
const { question, transcriptEntry, coverage } = await nextQuestion(state);
// → display `question`; append `transcriptEntry` then the vendor's answer to `messages`.

// When `coverage.isComplete` (or the operator stops):
const { value } = await extractProfile(state);
await updateVendorProfile(vendorId, value); // versioning + history handled here
```

Coverage of the five interview areas (capabilities, constraints, ideal
customer, buying signals, differentiators) is tracked deterministically — the
engine appends a hidden `[area:X]` tag to each assistant turn (never shown to
the vendor, never sent back to the model). Runs free on Ollama; uses any
configured paid provider via the 2.2a fallback chain.
```

- [ ] **Step 6: Run the full unit suite + typecheck + lint + build**

Run: `npx vitest run tests/unit && npx tsc --noEmit && npm run lint`
Expected: PASS — all unit tests green, no type errors, no lint errors.

Run: `npm run build`
Expected: PASS — production build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/ai/sia/index.ts tests/unit/ai/sia-index.test.ts README.md
git commit -m "feat(ai): SIA engine public API + README

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done gate

- All new unit tests green; the four existing vendor tests still green; `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass.
- No file under `src/ai/sia/` imports `@/db/*` or `@/lib/vendors/data` (verify: `grep -rn "@/db\|lib/vendors/data" src/ai/sia; echo exit:$?` → no matches).
- README documents the engine.
- Per-task commits on `feature/phase2-slice2b-sia-interview-engine`. Surface for operator merge (do not merge unprompted). No git tag (mid-Phase-2).
- Recommended human check (Anthropic key provided): a manual smoke — one real `nextQuestion` turn and one `extractProfile` against the live provider. Not required for the gate; the mocked unit tests + build are the automated evidence.
