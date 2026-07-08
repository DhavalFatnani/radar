# Vendors Redesign — Plan 1: Type Editor + List + Create/Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `vendorType` a first-class, editable, readiness-aware field end-to-end — a new `Combobox` primitive, `vendorType` plumbed through the app type / reads / writes / actions, wired into the profile edit form and a new `/vendors/new` page, and an enriched vendors list (type badge + readiness pill + filter) — so a vendor can be created and set to a runnable type entirely from the UI.

**Architecture:** Reuse the existing UI kit and the campaigns "context-rail" language. `vendorType` is stored verbatim on the existing `vendor_profiles.vendor_type` column (already present — **no migration**), matched case-insensitively against `mappings.serves_vendor_type`. It is **operator-set only** and is deliberately kept out of the shared `vendorProfileSchema` (which the AI interview extractor consumes) — it flows through a separate `vendorTypeSchema` + an optional param on `updateVendorProfile`. A new pure `src/lib/vendors/view-model.ts` holds all DB-free derivations (readiness classification, hint text, previews) so both server data code and client components share one tested source of truth.

**Tech Stack:** Next.js App Router (React 19, Server Components + Server Actions), Drizzle ORM (Neon Postgres), Zod, Vitest (+ jsdom + @testing-library/react).

## Global Constraints

- **`vendorType` is NEVER added to `vendorProfileSchema`.** That schema is consumed by `src/ai/sia/extract.ts` (`generateObject(vendorProfileSchema, …)`); adding `vendorType` would make it an AI-extraction target, which spec §2/§7 forbids (operator-set only). Handle `vendorType` via a separate `vendorTypeSchema` + a dedicated param. (This is a deliberate deviation from the literal wording of spec §6, honoring spec §2/§7 intent.)
- **Do NOT change the shape of `listVendors()` or the `/api/v1/vendors` response.** `listVendors()` is consumed by the read API (`src/app/api/v1/vendors/route.ts`) and the campaigns picker (`src/app/(app)/campaigns/new/page.tsx`). Add a new `listVendorRows()` for the redesigned page instead.
- **`vendorType` stored verbatim; matched case-insensitively** (`lower(vendorType) === lower(serves_vendor_type)`), consistent with `gatherPlanInputs` (`src/lib/campaigns/plan-inputs.ts`).
- **No `SELECT *` without a LIMIT.** Use explicit column maps; keep the existing `.limit(100)` / `.limit(500)` ceilings.
- **Tests live under `tests/unit/**` and `tests/integration/**`** (established project convention — this overrides the global "colocate tests" rule). Integration tests use the `migrateTestDb` / `truncateAll` / `closeTestDb` helpers from `tests/integration/helpers/db`; component tests start with `// @vitest-environment jsdom` and mock server actions.
- **Neon test flakiness:** integration suites run serially against one Neon branch; a transient TRUNCATE/latency failure is not a real failure — re-run 2–3× before investigating.
- **Accessibility:** the Combobox must be keyboard-navigable (arrow keys, Enter, Escape) with visible focus; use semantic roles (`combobox`/`listbox`/`option`).
- TDD throughout; commit after each task. DRY, YAGNI.

## Impact / blast radius (run before you start; already surveyed)

Symbols this plan modifies and every current caller (verified via grep):

- **`getVendor`** — additive (`vendorType` field added to the returned object). Callers read fields individually (`v!.name`, `v!.version`), so adding a field is safe: `vendors/[vendorId]/page.tsx`, `vendors/[vendorId]/interview/{page,actions}.ts`, `campaigns/new/page.tsx`, plus 2 integration tests. **Risk: LOW.**
- **`createVendorStub`** — gains an optional `vendorType`; `{ name }`-only callers keep working (many interview/catalogue integration tests). **Risk: LOW.**
- **`updateVendorProfile`** — gains an optional 4th param `vendorType`; 3-arg callers (`vendors/[vendorId]/interview/actions.ts:104`, tests) are unaffected (param `undefined` ⇒ type untouched). **Risk: LOW.**
- **`vendorProfileSchema`** — **NOT modified** (protects `src/ai/sia/extract.ts`). **Risk: NONE.**
- **`createVendor` action + `AddVendorForm`** — replaced by `/vendors/new` (page + form + `createVendorAction`); the old component and its test are deleted. Sole caller was the list page. **Risk: LOW.**
- **`vendors/page.tsx`** — fully rewritten (list redesign). **Risk: LOW** (leaf route).

No HIGH/CRITICAL risk. No migration (the `vendor_type` column already exists — `src/db/schema/vendors.ts:6`).

---

## File Structure

**New files**
- `src/app/components/ui/combobox.tsx` — the `Combobox` primitive (client). Searchable menu + free-entry + a hint slot.
- `src/lib/vendors/view-model.ts` — pure, DB-free derivations: readiness classification, hint text, combobox-option mapping, capabilities preview, relative time.
- `src/app/(app)/vendors/vendor-list-view.tsx` — client list view (cmdbar + readiness segmented + data-table + context rail).
- `src/app/(app)/vendors/new/page.tsx` — the New vendor page (server).
- `src/app/(app)/vendors/new/new-vendor-form.tsx` — New vendor form (client): name + `vendorType` Combobox + redirect-on-success.
- Tests: `tests/unit/lib/vendors-view-model.test.ts`, `tests/unit/components/combobox.test.tsx`, `tests/unit/components/new-vendor-form.test.tsx`, `tests/unit/components/vendor-list-view.test.tsx`, `tests/unit/components/edit-profile-form.test.tsx`.

**Modified files**
- `src/lib/vendors/schema.ts` — `VendorProfile` gains `vendorType`; `vendorStubSchema` gains optional `vendorType`; new `vendorTypeSchema`; new pure types `VendorReadinessClass`, `VendorListRow`, `VendorTypeOption`.
- `src/lib/vendors/data.ts` — `getVendor` selects `vendorType`; `createVendorStub` writes optional `vendorType`; `updateVendorProfile` gains a `vendorType` param + change tracking; new `getVendorTypeOptions()` and `listVendorRows()` (+ a private `approvedMappingTypeCounts()` helper).
- `src/app/(app)/vendors/actions.ts` — replace `createVendor` with `createVendorAction` returning `{ ok, vendorId?, error? }`.
- `src/app/(app)/vendors/[vendorId]/actions.ts` — `updateVendor` parses `vendorType` and passes it to `updateVendorProfile`.
- `src/app/(app)/vendors/[vendorId]/edit-profile-form.tsx` — add the `vendorType` Combobox + live hint; accept `types` prop.
- `src/app/(app)/vendors/[vendorId]/page.tsx` — fetch `getVendorTypeOptions()` and pass to `EditProfileForm`.
- `src/app/(app)/vendors/page.tsx` — redesigned list (CTA + empty-state + `VendorListView`).
- `src/app/styles/kit.css` — Combobox classes + readiness-pill modifier classes.

**Deleted files**
- `src/app/(app)/vendors/add-vendor-form.tsx`
- `tests/unit/components/add-vendor-form.test.tsx`

---

## Task 1: `vendorType` in the pure schema layer

**Files:**
- Modify: `src/lib/vendors/schema.ts`
- Test: `tests/unit/lib/vendors-schema.test.ts` (extend existing)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type VendorProfile` gains `vendorType: string | null`.
  - `vendorStubSchema` gains optional `vendorType` → `VendorStubInput = { name: string; vendorType?: string }`.
  - `export const vendorTypeSchema` — parses one raw form value to `string | null` (empty ⇒ `null`).
  - `export type VendorReadinessClass = "runnable" | "needs_mapping" | "no_type"`.
  - `export type VendorTypeOption = { type: string; mappingCount: number; vendorCount: number }`.
  - `export type VendorListRow = { vendorId: string; name: string; vendorType: string | null; version: number; capabilitiesPreview: string; lastChangeAt: string | null; mappingCount: number; readiness: VendorReadinessClass }`.

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/lib/vendors-schema.test.ts`:

```ts
import { vendorTypeSchema } from "@/lib/vendors/schema";

describe("vendorStubSchema vendorType", () => {
  it("accepts an optional vendorType and trims it", () => {
    const parsed = vendorStubSchema.parse({ name: "Acme", vendorType: "  Infra  " });
    expect(parsed.vendorType).toBe("Infra");
  });

  it("omits vendorType when absent", () => {
    const parsed = vendorStubSchema.parse({ name: "Acme" });
    expect(parsed.vendorType).toBeUndefined();
  });
});

describe("vendorTypeSchema", () => {
  it("trims a value and returns it verbatim", () => {
    expect(vendorTypeSchema.parse("  Infra  ")).toBe("Infra");
  });
  it("maps empty / whitespace to null", () => {
    expect(vendorTypeSchema.parse("")).toBeNull();
    expect(vendorTypeSchema.parse("   ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/vendors-schema.test.ts`
Expected: FAIL — `vendorTypeSchema` is not exported; `vendorType` missing from `VendorStubInput`.

- [ ] **Step 3: Implement the schema changes** in `src/lib/vendors/schema.ts`.

Replace the `vendorStubSchema` block (lines 3–6) with:

```ts
export const vendorStubSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required.").max(200, "Vendor name is too long."),
  vendorType: z
    .string()
    .trim()
    .max(120, "Vendor type is too long.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});
export type VendorStubInput = z.infer<typeof vendorStubSchema>;

// vendorType is operator-set only (NOT an AI-extraction target — kept out of vendorProfileSchema).
// Parses a single raw form value into the stored-verbatim string, or null when cleared.
export const vendorTypeSchema = z
  .string()
  .trim()
  .max(120, "Vendor type is too long.")
  .transform((v) => (v.length > 0 ? v : null));

export type VendorReadinessClass = "runnable" | "needs_mapping" | "no_type";

export type VendorTypeOption = { type: string; mappingCount: number; vendorCount: number };

export type VendorListRow = {
  vendorId: string;
  name: string;
  vendorType: string | null;
  version: number;
  capabilitiesPreview: string;
  lastChangeAt: string | null;
  mappingCount: number;
  readiness: VendorReadinessClass;
};
```

Add `vendorType: string | null;` to the `VendorProfile` type — insert it right after `name: string;` (line 31):

```ts
export type VendorProfile = {
  vendorId: string;
  name: string;
  vendorType: string | null;
  capabilities: string[];
  constraints: VendorConstraints | null;
  idealCustomer: string | null;
  knownGoodSignals: string | null;
  differentiators: string | null;
  credibility: string | null;
  version: number;
  interviewHistory: InterviewHistoryEntry[];
};
```

Leave `vendorProfileSchema` **unchanged**.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/vendors-schema.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Re-export the new symbols from data.ts** so existing `@/lib/vendors/data` importers can reach them.

In `src/lib/vendors/data.ts`, extend the import block (lines 5–14) and the re-export block (lines 16–25) to include `vendorTypeSchema`, `VendorReadinessClass`, `VendorTypeOption`, `VendorListRow`:

```ts
import {
  vendorStubSchema,
  vendorProfileSchema,
  vendorTypeSchema,
  type VendorStubInput,
  type VendorListItem,
  type VendorConstraints,
  type InterviewHistoryEntry,
  type VendorProfile,
  type VendorProfileInput,
  type VendorReadinessClass,
  type VendorTypeOption,
  type VendorListRow,
} from "./schema";

// Re-export the pure schema + types so existing importers of "@/lib/vendors/data" keep working.
export { vendorStubSchema, vendorProfileSchema, vendorTypeSchema };
export type {
  VendorStubInput,
  VendorListItem,
  VendorConstraints,
  InterviewHistoryEntry,
  VendorProfile,
  VendorProfileInput,
  VendorReadinessClass,
  VendorTypeOption,
  VendorListRow,
};
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`getVendor` will still typecheck because we add the field to the return object in Task 3; at this point `getVendor` in data.ts does not yet return `vendorType`, so TypeScript WILL error that the return object is missing `vendorType`. Therefore run Task 3’s Step 3 in the same working session before the final typecheck — OR temporarily allow it. To keep this task self-contained and green, also apply the one-line `getVendor` return fix now:)

In `src/lib/vendors/data.ts`, add `vendorType: vendorProfiles.vendorType,` to the `getVendor` select (after `name:`), and `vendorType: row.vendorType ?? null,` to the returned object (after `name: row.name,`). (Task 3 tests this behavior; this step just keeps the typecheck green.)

Run again: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/vendors/schema.ts src/lib/vendors/data.ts tests/unit/lib/vendors-schema.test.ts
git commit -m "feat(vendors): vendorType in schema layer (stub schema, vendorTypeSchema, list/option types)"
```

---

## Task 2: Vendors view-model (pure, DB-free derivations)

**Files:**
- Create: `src/lib/vendors/view-model.ts`
- Test: `tests/unit/lib/vendors-view-model.test.ts`

**Interfaces:**
- Consumes: `VendorReadinessClass`, `VendorTypeOption`, `InterviewHistoryEntry` from `./schema`; `ComboboxOption` from `@/app/components/ui/combobox` is **not** imported here (avoid a client-import in a pure lib) — instead this module produces plain `{ value, label, meta }` objects that are structurally a `ComboboxOption`.
- Produces:
  - `classifyVendorReadiness(input: { vendorType: string | null; mappingCount: number }): VendorReadinessClass`
  - `readinessLabel(cls: VendorReadinessClass): string`
  - `readinessPillClass(cls: VendorReadinessClass): string`
  - `capabilitiesPreview(caps: string[], max?: number): string`
  - `lastChange(history: InterviewHistoryEntry[]): string | null`
  - `relativeTime(iso: string | null, nowMs: number): string`
  - `typeHint(value: string, options: VendorTypeOption[]): { tone: "ok" | "warn" | "muted"; text: string }`
  - `toComboboxOptions(options: VendorTypeOption[]): { value: string; label: string; meta: string }[]`

- [ ] **Step 1: Write the failing tests** — create `tests/unit/lib/vendors-view-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  classifyVendorReadiness,
  readinessLabel,
  readinessPillClass,
  capabilitiesPreview,
  lastChange,
  relativeTime,
  typeHint,
  toComboboxOptions,
} from "@/lib/vendors/view-model";
import type { VendorTypeOption } from "@/lib/vendors/schema";

describe("classifyVendorReadiness", () => {
  it("no type → no_type", () => {
    expect(classifyVendorReadiness({ vendorType: null, mappingCount: 3 })).toBe("no_type");
    expect(classifyVendorReadiness({ vendorType: "  ", mappingCount: 3 })).toBe("no_type");
  });
  it("type with a serving mapping → runnable", () => {
    expect(classifyVendorReadiness({ vendorType: "Infra", mappingCount: 1 })).toBe("runnable");
  });
  it("type but no serving mapping → needs_mapping", () => {
    expect(classifyVendorReadiness({ vendorType: "Ops", mappingCount: 0 })).toBe("needs_mapping");
  });
});

describe("readiness labels + pill classes", () => {
  it("maps each class to a label", () => {
    expect(readinessLabel("runnable")).toBe("Runnable");
    expect(readinessLabel("needs_mapping")).toBe("Needs mapping");
    expect(readinessLabel("no_type")).toBe("No type");
  });
  it("maps each class to a pill class", () => {
    expect(readinessPillClass("runnable")).toBe("pill-runnable");
    expect(readinessPillClass("needs_mapping")).toBe("pill-needs");
    expect(readinessPillClass("no_type")).toBe("pill-notype");
  });
});

describe("capabilitiesPreview", () => {
  it("joins up to max capabilities and appends a +N overflow", () => {
    expect(capabilitiesPreview(["racking", "cctv", "wms", "mhe"], 2)).toBe("racking, cctv +2");
  });
  it("no overflow when within max", () => {
    expect(capabilitiesPreview(["racking", "cctv"], 3)).toBe("racking, cctv");
  });
  it("empty → em dash", () => {
    expect(capabilitiesPreview([], 3)).toBe("—");
  });
});

describe("lastChange", () => {
  it("returns the newest entry's at", () => {
    expect(
      lastChange([
        { at: "2026-07-01T00:00:00.000Z", actor: "operator", kind: "manual_edit", changed: [], version: 2 },
        { at: "2026-07-05T00:00:00.000Z", actor: "operator", kind: "interview", changed: [], version: 3 },
      ]),
    ).toBe("2026-07-05T00:00:00.000Z");
  });
  it("empty → null", () => {
    expect(lastChange([])).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-07-08T00:00:00.000Z");
  it("null → em dash", () => {
    expect(relativeTime(null, now)).toBe("—");
  });
  it("formats recent deltas", () => {
    expect(relativeTime("2026-07-07T23:59:30.000Z", now)).toBe("just now");
    expect(relativeTime("2026-07-07T23:00:00.000Z", now)).toBe("1h ago");
    expect(relativeTime("2026-07-06T00:00:00.000Z", now)).toBe("2d ago");
  });
});

describe("typeHint", () => {
  const opts: VendorTypeOption[] = [
    { type: "Infra", mappingCount: 3, vendorCount: 2 },
    { type: "Ops", mappingCount: 0, vendorCount: 1 },
  ];
  it("empty → muted guidance", () => {
    expect(typeHint("", opts).tone).toBe("muted");
  });
  it("served type → ok with count (case-insensitive)", () => {
    const h = typeHint("infra", opts);
    expect(h.tone).toBe("ok");
    expect(h.text).toBe("3 mappings serve Infra — runnable.");
  });
  it("unserved type → warn", () => {
    const h = typeHint("Ops", opts);
    expect(h.tone).toBe("warn");
    expect(h.text).toContain("No mapping serves");
  });
  it("brand-new type → warn", () => {
    expect(typeHint("Fintech", opts).tone).toBe("warn");
  });
});

describe("toComboboxOptions", () => {
  it("labels served types with a mapping count and unserved with 'no mapping yet'", () => {
    const co = toComboboxOptions([
      { type: "Infra", mappingCount: 3, vendorCount: 2 },
      { type: "Ops", mappingCount: 0, vendorCount: 1 },
      { type: "Mktg", mappingCount: 1, vendorCount: 0 },
    ]);
    expect(co).toEqual([
      { value: "Infra", label: "Infra", meta: "3 mappings" },
      { value: "Ops", label: "Ops", meta: "no mapping yet" },
      { value: "Mktg", label: "Mktg", meta: "1 mapping" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/lib/vendors-view-model.test.ts`
Expected: FAIL — module `@/lib/vendors/view-model` not found.

- [ ] **Step 3: Implement** — create `src/lib/vendors/view-model.ts`:

```ts
import type {
  VendorReadinessClass,
  VendorTypeOption,
  InterviewHistoryEntry,
} from "./schema";

/** List/profile readiness at a glance. Note: this is the type→serving-mapping heuristic
 * (spec §4). It is intentionally lighter than the full signal-resolving getSourcingReadiness. */
export function classifyVendorReadiness(input: {
  vendorType: string | null;
  mappingCount: number;
}): VendorReadinessClass {
  if (!input.vendorType || input.vendorType.trim().length === 0) return "no_type";
  return input.mappingCount > 0 ? "runnable" : "needs_mapping";
}

export function readinessLabel(cls: VendorReadinessClass): string {
  switch (cls) {
    case "runnable":
      return "Runnable";
    case "needs_mapping":
      return "Needs mapping";
    case "no_type":
      return "No type";
  }
}

export function readinessPillClass(cls: VendorReadinessClass): string {
  switch (cls) {
    case "runnable":
      return "pill-runnable";
    case "needs_mapping":
      return "pill-needs";
    case "no_type":
      return "pill-notype";
  }
}

export function capabilitiesPreview(caps: string[], max = 3): string {
  const clean = caps.map((c) => c.trim()).filter(Boolean);
  if (clean.length === 0) return "—";
  const head = clean.slice(0, max).join(", ");
  const extra = clean.length - max;
  return extra > 0 ? `${head} +${extra}` : head;
}

export function lastChange(history: InterviewHistoryEntry[]): string | null {
  if (!history || history.length === 0) return null;
  return history.reduce((newest, e) => (e.at > newest ? e.at : newest), history[0].at);
}

export function relativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const s = Math.max(0, Math.round((nowMs - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

function findOption(value: string, options: VendorTypeOption[]): VendorTypeOption | undefined {
  const key = value.trim().toLowerCase();
  return options.find((o) => o.type.toLowerCase() === key);
}

export function typeHint(
  value: string,
  options: VendorTypeOption[],
): { tone: "ok" | "warn" | "muted"; text: string } {
  const t = value.trim();
  if (!t) {
    return {
      tone: "muted",
      text: "Pick or create a type — it gates which mappings can source for this vendor.",
    };
  }
  const match = findOption(t, options);
  const count = match?.mappingCount ?? 0;
  if (count > 0) {
    const plural = count === 1 ? "mapping serves" : "mappings serve";
    return { tone: "ok", text: `${count} ${plural} ${match!.type} — runnable.` };
  }
  return { tone: "warn", text: `No mapping serves “${t}” yet — add one in Mappings to source.` };
}

export function toComboboxOptions(
  options: VendorTypeOption[],
): { value: string; label: string; meta: string }[] {
  return options.map((o) => ({
    value: o.type,
    label: o.type,
    meta: o.mappingCount > 0 ? `${o.mappingCount} mapping${o.mappingCount === 1 ? "" : "s"}` : "no mapping yet",
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/lib/vendors-view-model.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/vendors/view-model.ts tests/unit/lib/vendors-view-model.test.ts
git commit -m "feat(vendors): pure view-model — readiness classification, type hint, previews"
```

---

## Task 3: Data layer — `getVendor` + `createVendorStub` + `updateVendorProfile` handle `vendorType`

**Files:**
- Modify: `src/lib/vendors/data.ts`
- Test: `tests/integration/vendors-profile-data.test.ts` (extend), `tests/integration/vendors-data.test.ts` (extend)

**Interfaces:**
- Consumes: `VendorProfile.vendorType` (Task 1), `VendorStubInput.vendorType` (Task 1).
- Produces:
  - `getVendor` returns `vendorType: string | null`.
  - `createVendorStub(input: VendorStubInput)` persists `input.vendorType` when present.
  - `updateVendorProfile(vendorId, input, source?, vendorType?: string | null)` — when `vendorType !== undefined`, sets it and records a `"vendorType"` changelog entry on change; a vendorType-only change still bumps the version.

- [ ] **Step 1: Write the failing tests.**

Append to `tests/integration/vendors-data.test.ts` (inside the existing `describe("vendor data layer", …)`):

```ts
  it("createVendorStub persists vendorType when provided", async () => {
    const { vendorId } = await createVendorStub({ name: "RackPro", vendorType: "Infra" });
    const v = await getVendor(vendorId);
    expect(v!.vendorType).toBe("Infra");
  });

  it("createVendorStub leaves vendorType null when omitted", async () => {
    const { vendorId } = await createVendorStub({ name: "NoType" });
    const v = await getVendor(vendorId);
    expect(v!.vendorType).toBeNull();
  });
```

Also add `getVendor` to that file's import (line 4):

```ts
import { vendorStubSchema, createVendorStub, listVendors, getVendor } from "@/lib/vendors/data";
```

Append to `tests/integration/vendors-profile-data.test.ts` a new `describe`:

```ts
describe("updateVendorProfile vendorType", () => {
  it("sets vendorType, records it in changed[], and bumps the version", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const updated = await updateVendorProfile(vendorId, baseInput("Acme"), { kind: "manual_edit" }, "Infra");
    expect(updated.vendorType).toBe("Infra");
    expect(updated.version).toBe(2);
    expect(updated.interviewHistory.at(-1)!.changed).toContain("vendorType");
  });

  it("bumps the version when ONLY vendorType changes", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    await updateVendorProfile(vendorId, baseInput("Acme")); // v2, no type
    const again = await updateVendorProfile(vendorId, baseInput("Acme"), { kind: "manual_edit" }, "Infra");
    expect(again.version).toBe(3);
    expect(again.interviewHistory.at(-1)!.changed).toEqual(["vendorType"]);
  });

  it("leaves vendorType untouched when the param is undefined", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme", vendorType: "Infra" });
    const updated = await updateVendorProfile(vendorId, { ...baseInput("Acme"), capabilities: ["racking", "cctv"] });
    expect(updated.vendorType).toBe("Infra");
    expect(updated.interviewHistory.at(-1)!.changed).not.toContain("vendorType");
  });

  it("clears vendorType to null when passed null", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme", vendorType: "Infra" });
    const updated = await updateVendorProfile(vendorId, baseInput("Acme"), { kind: "manual_edit" }, null);
    expect(updated.vendorType).toBeNull();
    expect(updated.interviewHistory.at(-1)!.changed).toContain("vendorType");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/integration/vendors-profile-data.test.ts tests/integration/vendors-data.test.ts`
Expected: FAIL — `createVendorStub` ignores `vendorType`; `updateVendorProfile` takes no 4th arg / doesn't track `vendorType`. (If Task 1 Step 6 already added the `getVendor` select, the `createVendorStub` "omitted → null" case may pass; the "provided" and update cases will fail.)

- [ ] **Step 3: Implement.** In `src/lib/vendors/data.ts`:

(a) `getVendor` — ensure the select includes `vendorType` and the return maps it (added in Task 1 Step 6; confirm it reads):

```ts
    .select({
      vendorId: vendorProfiles.vendorId,
      name: vendorProfiles.name,
      vendorType: vendorProfiles.vendorType,
      capabilities: vendorProfiles.capabilities,
      // …unchanged…
    })
```
```ts
  return {
    vendorId: row.vendorId,
    name: row.name,
    vendorType: row.vendorType ?? null,
    capabilities: row.capabilities ?? [],
    // …unchanged…
  };
```

(b) `createVendorStub` — write `vendorType` when present:

```ts
export async function createVendorStub(input: VendorStubInput): Promise<VendorListItem> {
  const [row] = await db
    .insert(vendorProfiles)
    .values({ name: input.name, ...(input.vendorType ? { vendorType: input.vendorType } : {}) })
    .returning({ vendorId: vendorProfiles.vendorId, name: vendorProfiles.name });
  return row;
}
```

(c) `updateVendorProfile` — add the 4th param and vendorType change tracking. Replace the function signature and the change-detection/`set` region:

```ts
export async function updateVendorProfile(
  vendorId: string,
  input: VendorProfileInput,
  source: { kind: "manual_edit" | "interview"; interviewId?: string } = { kind: "manual_edit" },
  vendorType?: string | null,
): Promise<VendorProfile> {
  const current = await getVendor(vendorId);
  if (!current) throw new Error("Vendor not found");

  const next = normalizeProfile(input);
  const changed = changedFields(current, next);

  // vendorType is managed separately (operator-set only, not part of VendorProfileInput).
  const manageType = vendorType !== undefined;
  const nextVendorType = manageType ? vendorType : current.vendorType;
  if (manageType && nextVendorType !== current.vendorType) changed.push("vendorType");

  if (changed.length === 0) return current; // no-op: no version bump, no write

  const newVersion = current.version + 1;
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

  await db
    .update(vendorProfiles)
    .set({
      name: next.name,
      vendorType: nextVendorType,
      capabilities: next.capabilities,
      constraints: next.constraints,
      idealCustomer: next.idealCustomer ? { text: next.idealCustomer } : null,
      knownGoodSignals: next.knownGoodSignals,
      differentiators: next.differentiators,
      credibility: next.credibility ? { text: next.credibility } : null,
      version: newVersion,
      interviewHistory: history,
    })
    .where(eq(vendorProfiles.vendorId, vendorId));

  const updated = await getVendor(vendorId);
  if (!updated) throw new Error("Vendor not found");
  await populateCatalogueFromProfile(vendorId);
  return updated;
}
```

- [ ] **Step 4: Run to verify it passes** (and re-run the pre-existing cases in these files to confirm no regression)

Run: `npx vitest run tests/integration/vendors-profile-data.test.ts tests/integration/vendors-data.test.ts`
Expected: PASS. (Re-run 2–3× on transient Neon flakiness.)

- [ ] **Step 5: Confirm the interview path + other suites still pass** (3-arg `updateVendorProfile`, `{name}`-only `createVendorStub`):

Run: `npx vitest run tests/integration/vendors-interview-history.test.ts tests/integration/interview-actions.test.ts tests/integration/catalogue-sync.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/vendors/data.ts tests/integration/vendors-profile-data.test.ts tests/integration/vendors-data.test.ts
git commit -m "feat(vendors): plumb vendorType through getVendor/createVendorStub/updateVendorProfile"
```

---

## Task 4: Data layer — `getVendorTypeOptions()` + `listVendorRows()`

**Files:**
- Modify: `src/lib/vendors/data.ts`
- Test: `tests/integration/vendors-data.test.ts` (extend)

**Interfaces:**
- Consumes: `classifyVendorReadiness`, `capabilitiesPreview`, `lastChange` from `@/lib/vendors/view-model`; `VendorTypeOption`, `VendorListRow`, `InterviewHistoryEntry` from `./schema`; `mappings` from `@/db/schema`.
- Produces:
  - `getVendorTypeOptions(): Promise<VendorTypeOption[]>` — distinct types across approved mappings (with `mappingCount`) and vendors (with `vendorCount`), keyed case-insensitively, first-seen casing preserved, sorted by `mappingCount` desc then name.
  - `listVendorRows(): Promise<VendorListRow[]>` — enriched rows for the list page, readiness via a single batched approved-mapping-count query (no N per-vendor readiness calls).

- [ ] **Step 1: Write the failing tests.** Add a new `describe` to `tests/integration/vendors-data.test.ts`. First extend the top imports:

```ts
import {
  vendorStubSchema,
  createVendorStub,
  listVendors,
  getVendor,
  listVendorRows,
  getVendorTypeOptions,
} from "@/lib/vendors/data";
import { db } from "@/db/client";
import { mappings } from "@/db/schema";
```

Extend the `afterEach` truncation to also clear `mappings` (this suite now seeds them):

```ts
afterEach(async () => {
  await truncateAll(["mappings", "vendor_profiles"]);
});
```

Add the tests:

```ts
describe("listVendorRows + getVendorTypeOptions", () => {
  async function approvedMapping(name: string, servesVendorType: string) {
    await db.insert(mappings).values({
      name,
      servesVendorType,
      requiredSignals: [],
      supportingSignals: [],
      status: "approved",
      origin: "operator",
    });
  }

  it("classifies readiness from type + serving approved mappings", async () => {
    await approvedMapping("Warehouse expansion", "Infra");
    await approvedMapping("Rack refit", "infra"); // case-insensitive match, 2 total
    await createVendorStub({ name: "RackPro", vendorType: "Infra" }); // runnable (2 mappings)
    await createVendorStub({ name: "OpsCo", vendorType: "Ops" }); // needs_mapping (0)
    await createVendorStub({ name: "Blank" }); // no_type

    const rows = await listVendorRows();
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName["RackPro"].readiness).toBe("runnable");
    expect(byName["RackPro"].mappingCount).toBe(2);
    expect(byName["OpsCo"].readiness).toBe("needs_mapping");
    expect(byName["Blank"].readiness).toBe("no_type");
  });

  it("returns a capabilities preview and null lastChange for a fresh stub", async () => {
    await createVendorStub({ name: "Fresh" });
    const [row] = await listVendorRows();
    expect(row.capabilitiesPreview).toBe("—");
    expect(row.lastChangeAt).toBeNull();
  });

  it("getVendorTypeOptions unions mapping + vendor types with counts", async () => {
    await approvedMapping("Warehouse expansion", "Infra");
    await approvedMapping("Growth play", "Mktg");
    await createVendorStub({ name: "RackPro", vendorType: "Infra" });
    await createVendorStub({ name: "OpsCo", vendorType: "Ops" });

    const opts = await getVendorTypeOptions();
    const byType = Object.fromEntries(opts.map((o) => [o.type, o]));
    expect(byType["Infra"]).toMatchObject({ mappingCount: 1, vendorCount: 1 });
    expect(byType["Mktg"]).toMatchObject({ mappingCount: 1, vendorCount: 0 });
    expect(byType["Ops"]).toMatchObject({ mappingCount: 0, vendorCount: 1 });
    // sorted: served types (by mappingCount desc) before unserved
    expect(opts[opts.length - 1].type).toBe("Ops");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/integration/vendors-data.test.ts`
Expected: FAIL — `listVendorRows` / `getVendorTypeOptions` not exported.

- [ ] **Step 3: Implement.** In `src/lib/vendors/data.ts`:

Extend the drizzle-orm import (line 1) and the schema import (line 3), and import the view-model helpers:

```ts
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { vendorProfiles, mappings } from "@/db/schema";
import {
  classifyVendorReadiness,
  capabilitiesPreview,
  lastChange,
} from "@/lib/vendors/view-model";
```

Add the following functions (place them after `listVendors`):

```ts
// Case-insensitive count of approved mappings per served vendor type. One query, keyed by lower(type).
async function approvedMappingTypeCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({ type: mappings.servesVendorType })
    .from(mappings)
    .where(eq(mappings.status, "approved"))
    .limit(500);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = (r.type ?? "").trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// Distinct types across approved mappings (mappingCount) and vendors (vendorCount), for the
// combobox, the live hint, and the list rail. Keyed case-insensitively; first-seen casing wins.
export async function getVendorTypeOptions(): Promise<VendorTypeOption[]> {
  const [mapRows, venRows] = await Promise.all([
    db
      .select({ type: mappings.servesVendorType })
      .from(mappings)
      .where(eq(mappings.status, "approved"))
      .limit(500),
    db.select({ type: vendorProfiles.vendorType }).from(vendorProfiles).limit(1000),
  ]);

  const byKey = new Map<string, VendorTypeOption>();
  const bump = (raw: string | null, field: "mappingCount" | "vendorCount") => {
    const t = (raw ?? "").trim();
    if (!t) return;
    const key = t.toLowerCase();
    const cur = byKey.get(key) ?? { type: t, mappingCount: 0, vendorCount: 0 };
    cur[field] += 1;
    byKey.set(key, cur);
  };
  for (const r of mapRows) bump(r.type, "mappingCount");
  for (const r of venRows) bump(r.type, "vendorCount");

  return [...byKey.values()].sort(
    (a, b) => b.mappingCount - a.mappingCount || a.type.localeCompare(b.type),
  );
}

// Enriched vendor rows for the redesigned list. Readiness computed from a single batched
// approved-mapping-count query — NOT N per-vendor readiness calls.
export async function listVendorRows(): Promise<VendorListRow[]> {
  const rows = await db
    .select({
      vendorId: vendorProfiles.vendorId,
      name: vendorProfiles.name,
      vendorType: vendorProfiles.vendorType,
      capabilities: vendorProfiles.capabilities,
      version: vendorProfiles.version,
      interviewHistory: vendorProfiles.interviewHistory,
    })
    .from(vendorProfiles)
    .orderBy(asc(vendorProfiles.name))
    .limit(100);

  const counts = await approvedMappingTypeCounts();

  return rows.map((r) => {
    const history = (r.interviewHistory as InterviewHistoryEntry[] | null) ?? [];
    const vendorType = r.vendorType ?? null;
    const mappingCount = vendorType ? (counts.get(vendorType.trim().toLowerCase()) ?? 0) : 0;
    return {
      vendorId: r.vendorId,
      name: r.name,
      vendorType,
      version: r.version,
      capabilitiesPreview: capabilitiesPreview(r.capabilities ?? []),
      lastChangeAt: lastChange(history),
      mappingCount,
      readiness: classifyVendorReadiness({ vendorType, mappingCount }),
    };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/integration/vendors-data.test.ts`
Expected: PASS. (Re-run 2–3× on transient Neon flakiness.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/vendors/data.ts tests/integration/vendors-data.test.ts
git commit -m "feat(vendors): getVendorTypeOptions + batched-readiness listVendorRows"
```

---

## Task 5: The `Combobox` primitive (+ kit CSS)

**Files:**
- Create: `src/app/components/ui/combobox.tsx`
- Modify: `src/app/styles/kit.css`
- Test: `tests/unit/components/combobox.test.tsx`

**Interfaces:**
- Consumes: nothing (leaf kit component).
- Produces:
  - `export type ComboboxOption = { value: string; label: string; meta?: string }`
  - `export function Combobox(props): JSX.Element` where props = `{ name: string; value: string; onChange: (v: string) => void; options: ComboboxOption[]; placeholder?: string; hint?: ReactNode; ariaLabel?: string; id?: string }`. The visible input carries `name` so it submits natively inside a `<form action={…}>`.

- [ ] **Step 1: Write the failing test** — create `tests/unit/components/combobox.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Combobox, type ComboboxOption } from "@/app/components/ui/combobox";

const OPTS: ComboboxOption[] = [
  { value: "Infra", label: "Infra", meta: "3 mappings" },
  { value: "Mktg", label: "Mktg", meta: "2 mappings" },
  { value: "Ops", label: "Ops", meta: "no mapping yet" },
];

function Harness({ initial = "" }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <Combobox name="vendorType" ariaLabel="Vendor type" value={v} onChange={setV} options={OPTS} />
      <output data-testid="val">{v}</output>
    </>
  );
}

describe("Combobox", () => {
  it("opens on focus and lists all options", () => {
    render(<Harness />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByText("3 mappings")).toBeInTheDocument();
  });

  it("filters options by typed text", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "mk" } });
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(1);
    expect(opts[0]).toHaveTextContent("Mktg");
  });

  it("picks an existing option and closes", () => {
    render(<Harness />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("Infra"));
    expect(screen.getByTestId("val")).toHaveTextContent("Infra");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("offers a create affordance for a brand-new value", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Fintech" } });
    const create = screen.getByText(/Create/);
    fireEvent.mouseDown(create);
    expect(screen.getByTestId("val")).toHaveTextContent("Fintech");
  });

  it("renders the hint slot", () => {
    render(
      <Combobox
        name="vendorType"
        ariaLabel="Vendor type"
        value="Infra"
        onChange={() => {}}
        options={OPTS}
        hint={<span className="combobox-hint combobox-hint--ok">3 mappings serve Infra — runnable.</span>}
      />,
    );
    expect(screen.getByText(/runnable/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/combobox.test.tsx`
Expected: FAIL — module `@/app/components/ui/combobox` not found.

- [ ] **Step 3: Implement** — create `src/app/components/ui/combobox.tsx`:

```tsx
"use client";

import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export type ComboboxOption = { value: string; label: string; meta?: string };

export function Combobox({
  name,
  value,
  onChange,
  options,
  placeholder,
  hint,
  ariaLabel,
  id,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  hint?: ReactNode;
  ariaLabel?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const query = value.trim().toLowerCase();
  const filtered = query
    ? options.filter(
        (o) => o.value.toLowerCase().includes(query) || o.label.toLowerCase().includes(query),
      )
    : options;
  const exact = options.some((o) => o.value.toLowerCase() === query);
  const showCreate = query.length > 0 && !exact;
  const rowCount = filtered.length + (showCreate ? 1 : 0);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(0, rowCount - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && active < filtered.length && filtered[active]) {
        e.preventDefault();
        pick(filtered[active].value);
      } else if (open && showCreate && active === filtered.length) {
        e.preventDefault();
        pick(value.trim());
      } else {
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div
      className="combobox"
      ref={rootRef}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        id={id}
        name={name}
        className="field-input combobox-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && rowCount > 0 && (
        <ul className="combobox-menu" id={listId} role="listbox">
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === active}
              className={`combobox-option${i === active ? " combobox-option--active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.value);
              }}
            >
              <span className="combobox-option-label">{o.label}</span>
              {o.meta ? <span className="combobox-option-meta">{o.meta}</span> : null}
            </li>
          ))}
          {showCreate && (
            <li
              role="option"
              aria-selected={active === filtered.length}
              className={`combobox-option combobox-create${
                active === filtered.length ? " combobox-option--active" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(value.trim());
              }}
            >
              + Create “{value.trim()}”
            </li>
          )}
        </ul>
      )}
      {hint ? <div className="combobox-hint-slot">{hint}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/components/combobox.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 5: Add kit CSS.** Append to `src/app/styles/kit.css`:

```css
/* Combobox (vendor type editor) */
.combobox { position: relative; }
.combobox-input { width: 100%; }
.combobox-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 4px;
  list-style: none;
  max-height: 260px;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
}
.combobox-option {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 9px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 0.9rem;
}
.combobox-option--active,
.combobox-option:hover { background: var(--surface-2); }
.combobox-option-meta { font-family: var(--mono); font-size: 0.72rem; color: var(--muted); flex: none; }
.combobox-create { color: var(--accent); font-family: var(--mono); font-size: 0.82rem; }
.combobox-hint-slot { margin-top: 6px; }
.combobox-hint { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; }
.combobox-hint--ok { color: var(--ok, #22c55e); }
.combobox-hint--warn { color: var(--warn, #f59e0b); }
.combobox-hint--muted { color: var(--muted); }

/* Vendor readiness pills (list + edit hint) */
.pill-runnable { background: color-mix(in srgb, var(--ok, #22c55e) 18%, transparent); color: var(--ok, #22c55e); }
.pill-needs { background: color-mix(in srgb, var(--warn, #f59e0b) 18%, transparent); color: var(--warn, #f59e0b); }
.pill-notype { background: var(--surface-2); color: var(--muted); }
```

> **Note for the implementer:** verify the token names against the top of `src/app/styles/tokens.css` — if `--ok`/`--warn`/`--accent`/`--mono`/`--surface`/`--surface-2`/`--border-strong`/`--muted` are named differently, use the actual token names (the `#…` fallbacks keep it correct either way). Do not invent new tokens.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/ui/combobox.tsx src/app/styles/kit.css tests/unit/components/combobox.test.tsx
git commit -m "feat(kit): Combobox primitive (searchable + free-entry + hint slot) and readiness pills"
```

---

## Task 6: `/vendors/new` page + form + `createVendorAction` (replaces the inline add form)

**Files:**
- Create: `src/app/(app)/vendors/new/page.tsx`
- Create: `src/app/(app)/vendors/new/new-vendor-form.tsx`
- Modify: `src/app/(app)/vendors/actions.ts`
- Delete: `src/app/(app)/vendors/add-vendor-form.tsx`
- Delete: `tests/unit/components/add-vendor-form.test.tsx`
- Test: `tests/unit/components/new-vendor-form.test.tsx`, `tests/integration/vendors-action.test.ts` (extend)

**Interfaces:**
- Consumes: `Combobox`/`ComboboxOption` (Task 5); `toComboboxOptions`, `typeHint` (Task 2); `getVendorTypeOptions` (Task 4); `createVendorStub`, `vendorStubSchema`, `VendorTypeOption` (Tasks 1/3/4).
- Produces:
  - `export type CreateVendorState = { ok: boolean; vendorId?: string; error?: string }`
  - `export async function createVendorAction(_prev: CreateVendorState, formData: FormData): Promise<CreateVendorState>`
  - `export function NewVendorForm({ types }: { types: VendorTypeOption[] })`

- [ ] **Step 1: Read `tests/integration/vendors-action.test.ts`** to match its existing mock/harness style (it mocks `@/lib/auth` and `next/cache`, like `vendors-update-action.test.ts`). Then write the failing tests.

Create `tests/unit/components/new-vendor-form.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NewVendorForm } from "@/app/(app)/vendors/new/new-vendor-form";

vi.mock("@/app/(app)/vendors/actions", () => ({ createVendorAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("NewVendorForm", () => {
  it("renders a name input and a vendor-type combobox", () => {
    render(<NewVendorForm types={[{ type: "Infra", mappingCount: 3, vendorCount: 1 }]} />);
    expect(screen.getByLabelText(/vendor name/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /vendor type/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create vendor/i })).toBeInTheDocument();
  });
});
```

Extend `tests/integration/vendors-action.test.ts` — add cases asserting `createVendorAction` returns `{ ok: true, vendorId }` and persists `vendorType`. (Follow the file's existing mock setup; the sketch below assumes the same `auth`/`revalidatePath` mocks that `vendors-update-action.test.ts` uses. If `vendors-action.test.ts` still targets the old `createVendor`, replace those cases.)

```ts
import { createVendorAction } from "@/app/(app)/vendors/actions";

it("createVendorAction creates a vendor with a type and returns its id", async () => {
  const fd = new FormData();
  fd.set("name", "RackPro");
  fd.set("vendorType", "Infra");
  const result = await createVendorAction({ ok: false }, fd);
  expect(result.ok).toBe(true);
  expect(result.vendorId).toBeTruthy();

  const v = await getVendor(result.vendorId!);
  expect(v!.name).toBe("RackPro");
  expect(v!.vendorType).toBe("Infra");
});

it("createVendorAction rejects an empty name", async () => {
  const fd = new FormData();
  fd.set("name", "   ");
  const result = await createVendorAction({ ok: false }, fd);
  expect(result.ok).toBe(false);
  expect(result.error).toBe("Vendor name is required.");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/new-vendor-form.test.tsx tests/integration/vendors-action.test.ts`
Expected: FAIL — `NewVendorForm` and `createVendorAction` don't exist.

- [ ] **Step 3: Implement the action.** Rewrite `src/app/(app)/vendors/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createVendorStub, vendorStubSchema } from "@/lib/vendors/data";

export type CreateVendorState = { ok: boolean; vendorId?: string; error?: string };

// Create a vendor (name + optional type). Returns the new id for a client redirect.
// Never leaks internals.
export async function createVendorAction(
  _prev: CreateVendorState,
  formData: FormData,
): Promise<CreateVendorState> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "You must be signed in." };

  const parsed = vendorStubSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    vendorType: String(formData.get("vendorType") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid vendor." };
  }

  try {
    const { vendorId } = await createVendorStub(parsed.data);
    revalidatePath("/vendors");
    return { ok: true, vendorId };
  } catch {
    return { ok: false, error: "Could not create the vendor." };
  }
}
```

- [ ] **Step 4: Implement the form.** Create `src/app/(app)/vendors/new/new-vendor-form.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/app/components/ui/field";
import { Combobox } from "@/app/components/ui/combobox";
import { toComboboxOptions, typeHint } from "@/lib/vendors/view-model";
import type { VendorTypeOption } from "@/lib/vendors/schema";
import { createVendorAction, type CreateVendorState } from "../actions";

export function NewVendorForm({ types }: { types: VendorTypeOption[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<CreateVendorState, FormData>(
    createVendorAction,
    { ok: false },
  );
  const [type, setType] = useState("");
  const hint = typeHint(type, types);

  useEffect(() => {
    if (state.ok && state.vendorId) router.push(`/vendors/${state.vendorId}`);
  }, [state, router]);

  return (
    <form className="form-panel" action={formAction}>
      <Field label="Vendor name" htmlFor="name">
        <input id="name" name="name" className="field-input" type="text" required maxLength={200} autoComplete="off" />
      </Field>

      <Field label="Vendor type" htmlFor="vendorType">
        <Combobox
          id="vendorType"
          name="vendorType"
          ariaLabel="Vendor type"
          value={type}
          onChange={setType}
          options={toComboboxOptions(types)}
          placeholder="Pick or create a type…"
          hint={<span className={`combobox-hint combobox-hint--${hint.tone}`}>{hint.text}</span>}
        />
      </Field>

      {state.error ? <p role="alert" className="run-error">{state.error}</p> : null}
      <button type="submit" className="btn btn-primary form-submit" disabled={pending}>
        {pending ? "Creating…" : "Create vendor"}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Implement the page.** Create `src/app/(app)/vendors/new/page.tsx`:

```tsx
import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { getVendorTypeOptions } from "@/lib/vendors/data";
import { NewVendorForm } from "./new-vendor-form";

export const metadata = { title: "New vendor — Radar" };

export default async function NewVendorPage() {
  const types = await getVendorTypeOptions();
  return (
    <>
      <Link href="/vendors" className="back-link">← All vendors</Link>
      <PageHeader eyebrow="Build" title="New vendor" sub="Name it and set its type — the type is what lets mappings source for it." />
      <div className="ctx-grid">
        <div className="ctx-main">
          <NewVendorForm types={types} />
        </div>
        <aside className="ctx-rail">
          <div className="ctx-panel">
            <h3>Why type matters</h3>
            <p className="list-note">
              Sourcing matches a vendor’s <b>type</b> → approved <b>mappings</b> → the <b>signals</b> they hunt.
              Pick a type that already has mappings and this vendor can source immediately. No type is fine —
              you can set it later, but the vendor stays “no type” until you do.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
```

- [ ] **Step 6: Delete the old inline add form + its test.**

```bash
git rm src/app/(app)/vendors/add-vendor-form.tsx tests/unit/components/add-vendor-form.test.tsx
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run tests/unit/components/new-vendor-form.test.tsx tests/integration/vendors-action.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: PASS — but note `src/app/(app)/vendors/page.tsx` still imports the now-deleted `AddVendorForm` and the removed `createVendor`. Task 8 rewrites that page. To keep this task’s typecheck green, temporarily remove the `AddVendorForm` import + usage from `page.tsx` now (Task 8 replaces the whole file):

In `src/app/(app)/vendors/page.tsx`, delete line 5 (`import { AddVendorForm } …`) and line 14 (`<AddVendorForm />`). Re-run `npm run typecheck` → PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src/app/(app)/vendors
git commit -m "feat(vendors): /vendors/new page + form (name + type combobox) + createVendorAction"
```

---

## Task 7: Edit form gets the `vendorType` Combobox + `updateVendor` handles it

**Files:**
- Modify: `src/app/(app)/vendors/[vendorId]/edit-profile-form.tsx`
- Modify: `src/app/(app)/vendors/[vendorId]/actions.ts`
- Modify: `src/app/(app)/vendors/[vendorId]/page.tsx`
- Test: `tests/unit/components/edit-profile-form.test.tsx` (new), `tests/integration/vendors-update-action.test.ts` (extend)

**Interfaces:**
- Consumes: `Combobox` (Task 5); `toComboboxOptions`, `typeHint` (Task 2); `vendorTypeSchema` (Task 1); `updateVendorProfile` 4th param (Task 3); `getVendorTypeOptions` (Task 4).
- Produces: `EditProfileForm({ vendor, types })` now renders a `vendorType` combobox; `updateVendor` sets `vendorType`.

- [ ] **Step 1: Write the failing tests.**

Create `tests/unit/components/edit-profile-form.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditProfileForm } from "@/app/(app)/vendors/[vendorId]/edit-profile-form";
import type { VendorProfile } from "@/lib/vendors/data";

vi.mock("@/app/(app)/vendors/[vendorId]/actions", () => ({ updateVendor: vi.fn() }));

const vendor: VendorProfile = {
  vendorId: "v1",
  name: "RackPro",
  vendorType: "Infra",
  capabilities: ["racking"],
  constraints: null,
  idealCustomer: null,
  knownGoodSignals: null,
  differentiators: null,
  credibility: null,
  version: 1,
  interviewHistory: [],
};

describe("EditProfileForm", () => {
  it("renders the vendor-type combobox seeded with the current type", () => {
    render(<EditProfileForm vendor={vendor} types={[{ type: "Infra", mappingCount: 3, vendorCount: 1 }]} />);
    const combo = screen.getByRole("combobox", { name: /vendor type/i });
    expect(combo).toHaveValue("Infra");
  });
});
```

Extend `tests/integration/vendors-update-action.test.ts` — add a `vendorType` field to a new form helper and a case:

```ts
it("persists vendorType from the form and records it in the changelog", async () => {
  const { vendorId } = await createVendorStub({ name: "Acme" });
  const fd = profileForm("Acme");
  fd.set("vendorType", "Infra");
  const result = await updateVendor(vendorId, undefined, fd);
  expect(result).toBeUndefined();

  const [row] = await testDb.select().from(vendorProfiles).where(eq(vendorProfiles.vendorId, vendorId));
  expect(row.vendorType).toBe("Infra");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/edit-profile-form.test.tsx tests/integration/vendors-update-action.test.ts`
Expected: FAIL — `EditProfileForm` has no `types` prop / no combobox; `updateVendor` ignores `vendorType`.

- [ ] **Step 3: Update the action.** In `src/app/(app)/vendors/[vendorId]/actions.ts`, import `vendorTypeSchema` and pass the parsed type as the 4th arg:

```ts
import { updateVendorProfile, vendorProfileSchema, vendorTypeSchema } from "@/lib/vendors/data";
```

Replace the `try { await updateVendorProfile(vendorId, parsed.data); }` block with:

```ts
  const vendorType = vendorTypeSchema.parse(String(formData.get("vendorType") ?? ""));

  try {
    await updateVendorProfile(vendorId, parsed.data, { kind: "manual_edit" }, vendorType);
  } catch {
    return "Could not save the vendor profile.";
  }
```

- [ ] **Step 4: Update the form.** Edit `src/app/(app)/vendors/[vendorId]/edit-profile-form.tsx`. Add imports, the `types` prop, and the combobox (placed right after the Vendor name label). Convert the top of the component:

```tsx
"use client";

import { useActionState, useState } from "react";
import type { VendorProfile } from "@/lib/vendors/data";
import type { VendorTypeOption } from "@/lib/vendors/schema";
import { Combobox } from "@/app/components/ui/combobox";
import { toComboboxOptions, typeHint } from "@/lib/vendors/view-model";
import { updateVendor } from "./actions";

export function EditProfileForm({ vendor, types }: { vendor: VendorProfile; types: VendorTypeOption[] }) {
  const action = updateVendor.bind(null, vendor.vendorId);
  const [error, formAction, isPending] = useActionState(action, undefined);
  const c = vendor.constraints ?? {};
  const [type, setType] = useState(vendor.vendorType ?? "");
  const hint = typeHint(type, types);

  return (
    <form action={formAction} className="profile-form">
      <label>
        Vendor name
        <input type="text" name="name" defaultValue={vendor.name} required maxLength={200} />
      </label>

      <label>
        Vendor type
        <Combobox
          name="vendorType"
          ariaLabel="Vendor type"
          value={type}
          onChange={setType}
          options={toComboboxOptions(types)}
          placeholder="Pick or create a type…"
          hint={<span className={`combobox-hint combobox-hint--${hint.tone}`}>{hint.text}</span>}
        />
      </label>

      <label>
        Capabilities (one per line)
        <textarea name="capabilities" rows={3} defaultValue={vendor.capabilities.join("\n")} />
      </label>
      {/* …rest of the form unchanged (constraints fieldset, idealCustomer, etc.)… */}
```

> **Note:** the `<label>` wrapping the `Combobox` gives it an accessible name via the `ariaLabel` prop, so `getByRole("combobox", { name: /vendor type/i })` resolves. Leave the remainder of the form (constraints fieldset through the submit button + error `<p role="alert">`) exactly as it is today.

- [ ] **Step 5: Update the profile page** to fetch + pass `types`. In `src/app/(app)/vendors/[vendorId]/page.tsx`:

```ts
import { getVendor, getVendorTypeOptions } from "@/lib/vendors/data";
```

In the body, fetch the options alongside the existing reads and pass them:

```tsx
  const active = await getActiveInterview(vendorId);
  const readiness = await getSourcingReadiness(db, vendorId);
  const types = await getVendorTypeOptions();
```
```tsx
      <EditProfileForm vendor={vendor} types={types} />
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/unit/components/edit-profile-form.test.tsx tests/integration/vendors-update-action.test.ts`
Expected: PASS. (Also re-run `tests/integration/vendors-interview-history.test.ts` to confirm the interview path is unaffected → PASS.)
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/(app)/vendors/[vendorId] tests/unit/components/edit-profile-form.test.tsx tests/integration/vendors-update-action.test.ts
git commit -m "feat(vendors): vendorType combobox in the profile edit form + updateVendor wiring"
```

---

## Task 8: Enriched vendors list page (`VendorListView` + rewritten `page.tsx`)

**Files:**
- Create: `src/app/(app)/vendors/vendor-list-view.tsx`
- Modify: `src/app/(app)/vendors/page.tsx`
- Test: `tests/unit/components/vendor-list-view.test.tsx`

**Interfaces:**
- Consumes: `listVendorRows`, `getVendorTypeOptions` (Task 4); `VendorListRow`, `VendorTypeOption` (Task 1); `readinessLabel`, `readinessPillClass`, `relativeTime` (Task 2); `SearchInput`, `Segmented` (kit `controls.tsx`), `PageHeader`, `EmptyState`.
- Produces: `VendorListView({ rows, types, nowMs }: { rows: VendorListRow[]; types: VendorTypeOption[]; nowMs: number })`.

- [ ] **Step 1: Write the failing test** — create `tests/unit/components/vendor-list-view.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { VendorListView } from "@/app/(app)/vendors/vendor-list-view";
import type { VendorListRow } from "@/lib/vendors/schema";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const rows: VendorListRow[] = [
  { vendorId: "v1", name: "RackPro", vendorType: "Infra", version: 3, capabilitiesPreview: "racking, cctv", lastChangeAt: null, mappingCount: 2, readiness: "runnable" },
  { vendorId: "v2", name: "OpsCo", vendorType: "Ops", version: 1, capabilitiesPreview: "—", lastChangeAt: null, mappingCount: 0, readiness: "needs_mapping" },
  { vendorId: "v3", name: "Blank", vendorType: null, version: 1, capabilitiesPreview: "—", lastChangeAt: null, mappingCount: 0, readiness: "no_type" },
];
const types = [
  { type: "Infra", mappingCount: 2, vendorCount: 1 },
  { type: "Ops", mappingCount: 0, vendorCount: 1 },
];

describe("VendorListView", () => {
  it("renders type + readiness for each vendor", () => {
    render(<VendorListView rows={rows} types={types} nowMs={0} />);
    expect(screen.getByText("RackPro")).toBeInTheDocument();
    expect(screen.getByText("Runnable")).toBeInTheDocument();
    expect(screen.getByText("Needs mapping")).toBeInTheDocument();
    expect(screen.getByText("No type")).toBeInTheDocument();
  });

  it("filters to runnable via the segmented control", () => {
    render(<VendorListView rows={rows} types={types} nowMs={0} />);
    fireEvent.click(screen.getByRole("button", { name: /^runnable$/i }));
    expect(screen.getByText("RackPro")).toBeInTheDocument();
    expect(screen.queryByText("OpsCo")).not.toBeInTheDocument();
    expect(screen.queryByText("Blank")).not.toBeInTheDocument();
  });

  it("filters by search text", () => {
    render(<VendorListView rows={rows} types={types} nowMs={0} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ops" } });
    expect(screen.getByText("OpsCo")).toBeInTheDocument();
    expect(screen.queryByText("RackPro")).not.toBeInTheDocument();
  });

  it("navigates on whole-row click", () => {
    render(<VendorListView rows={rows} types={types} nowMs={0} />);
    fireEvent.click(screen.getByText("RackPro").closest("tr")!);
    expect(push).toHaveBeenCalledWith("/vendors/v1");
  });

  it("shows types-in-use chips in the rail", () => {
    render(<VendorListView rows={rows} types={types} nowMs={0} />);
    // Infra (vendorCount 1) and Ops (vendorCount 1) both appear as rail chips
    const rail = screen.getByRole("complementary");
    expect(within(rail).getByText(/Infra/)).toBeInTheDocument();
    expect(within(rail).getByText(/Ops/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/vendor-list-view.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/app/(app)/vendors/vendor-list-view.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SearchInput, Segmented } from "@/app/components/ui/controls";
import { readinessLabel, readinessPillClass, relativeTime } from "@/lib/vendors/view-model";
import type { VendorListRow, VendorTypeOption } from "@/lib/vendors/schema";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "runnable", label: "Runnable" },
  { value: "needs", label: "Needs setup" },
];

export function VendorListView({
  rows,
  types,
  nowMs,
}: {
  rows: VendorListRow[];
  types: VendorTypeOption[];
  nowMs: number;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const counts = useMemo(
    () => ({
      runnable: rows.filter((r) => r.readiness === "runnable").length,
      needs_mapping: rows.filter((r) => r.readiness === "needs_mapping").length,
      no_type: rows.filter((r) => r.readiness === "no_type").length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "runnable" && r.readiness !== "runnable") return false;
      if (filter === "needs" && r.readiness === "runnable") return false;
      if (q && !(r.name.toLowerCase().includes(q) || (r.vendorType ?? "").toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [rows, search, filter]);

  const typesInUse = types.filter((t) => t.vendorCount > 0);

  return (
    <div className="ctx-grid">
      <div className="ctx-main">
        <div className="cmdbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Filter vendors…" />
          <Segmented options={FILTERS} value={filter} onChange={setFilter} />
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Type</th>
                <th>Readiness</th>
                <th className="num">Ver</th>
                <th className="num">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.vendorId}
                  className="clickable"
                  onClick={() => router.push(`/vendors/${r.vendorId}`)}
                >
                  <td className="cell-co">
                    <Link href={`/vendors/${r.vendorId}`} onClick={(e) => e.stopPropagation()}>
                      <b>{r.name}</b>
                    </Link>
                    <span>{r.capabilitiesPreview}</span>
                  </td>
                  <td>{r.vendorType ? <span className="badge">{r.vendorType}</span> : <span className="muted">— no type</span>}</td>
                  <td>
                    <span className={`pill ${readinessPillClass(r.readiness)}`}>
                      {readinessLabel(r.readiness)}
                    </span>
                  </td>
                  <td className="num">v{r.version}</td>
                  <td className="num">{relativeTime(r.lastChangeAt, nowMs)}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="list-note">No vendors match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="ctx-rail">
        <div className="ctx-panel">
          <h3>Readiness</h3>
          <dl className="kv-list">
            <div className="kv"><dt className="kv-k">Runnable</dt><dd className="kv-v">{counts.runnable}</dd></div>
            <div className="kv"><dt className="kv-k">Needs mapping</dt><dd className="kv-v">{counts.needs_mapping}</dd></div>
            <div className="kv"><dt className="kv-k">No type</dt><dd className="kv-v">{counts.no_type}</dd></div>
          </dl>
        </div>
        <div className="ctx-panel">
          <h3>Types in use</h3>
          {typesInUse.length === 0 ? (
            <p className="qv-empty">No types set yet.</p>
          ) : (
            <div className="chips">
              {typesInUse.map((t) => (
                <span key={t.type} className="chip">{t.type} · {t.vendorCount}</span>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
```

> **Note:** `.badge` (the type badge) and `.muted` come from the existing stylesheets (`components.css`/`command.css`). If `.muted` is not a global helper, use `<span className="row-meta">— no type</span>` instead (verify against `kit.css`/`base.css`). The `<aside className="ctx-rail">` maps to `role="complementary"` for the rail test.

- [ ] **Step 4: Rewrite the list page.** Replace `src/app/(app)/vendors/page.tsx` entirely:

```tsx
import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { listVendorRows, getVendorTypeOptions } from "@/lib/vendors/data";
import { VendorListView } from "./vendor-list-view";

export const metadata = { title: "Vendors — Radar" };

export default async function VendorsPage() {
  const [rows, types] = await Promise.all([listVendorRows(), getVendorTypeOptions()]);
  const newCta = (
    <Link href="/vendors/new" className="btn btn-primary">+ New vendor</Link>
  );
  return (
    <>
      <PageHeader
        eyebrow="Build"
        title="Vendors"
        sub="Every vendor, its type, and whether it can source yet."
        actions={newCta}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon="vendors"
          title="No vendors yet"
          description="Create your first vendor and set its type — a runnable type lets mappings source for it right away."
        />
      ) : (
        <VendorListView rows={rows} types={types} nowMs={Date.now()} />
      )}
    </>
  );
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/components/vendor-list-view.test.tsx`
Expected: PASS.
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Full suite + lint + format**

Run: `npm run test`
Expected: PASS (re-run 2–3× on transient Neon flakiness — see Global Constraints).
Run: `npm run lint && npm run format:check`
Expected: PASS. (If `format:check` flags the new files, run `npm run format` and re-stage.)

- [ ] **Step 7: Verify in the running app** (manual smoke, per `verify` skill): `npm run dev`, then:
  1. `/vendors` — list shows Type + Readiness columns; the readiness Segmented filters; the rail shows readiness counts + types-in-use chips; a row click opens the profile.
  2. `/vendors/new` — create a vendor with type `Infra`; the hint reads green “N mappings serve Infra — runnable.”; on submit you land on the new profile.
  3. Open that vendor’s profile → **Edit** form shows the type combobox seeded with `Infra`; change it to a new type `Ops`, save; the list now shows `Ops` / “Needs mapping”.
  (Requires seeded approved mappings — `npm run db:seed:mappings` — to see “runnable”.)

- [ ] **Step 8: Detect changes (project guardrail) + commit**

Run GitNexus `detect_changes({scope: "compare", base_ref: "main"})` and confirm the affected symbols match this plan’s scope (vendors data/schema/view-model, vendor UI, the new combobox — no unexpected reach into campaigns/interview internals).

```bash
git add -A src/app/(app)/vendors tests/unit/components/vendor-list-view.test.tsx
git commit -m "feat(vendors): enriched list — type badge, readiness pill + filter, context rail"
```

---

## Self-Review

**1. Spec coverage (Plan 1 scope = spec §10 “Plan 1”, drawing on §2, §3.1, §3.3, §4, §5, §6):**

| Spec item | Task |
|---|---|
| §2 `vendorType` combobox with live readiness hint, case-insensitive, stored verbatim, operator-set (not AI-extracted) | Tasks 1, 2, 5, 6, 7 (Global Constraint: not in `vendorProfileSchema`) |
| §2 combobox lists served types w/ counts + unserved (“no mapping yet”) + “+ Create new type…” | Tasks 2 (`toComboboxOptions`), 4 (`getVendorTypeOptions`), 5 (create affordance) |
| §3.1 list: New-vendor CTA, command bar (search + readiness segmented), Type/Readiness/Ver/Updated columns, whole-row click, empty state | Task 8 |
| §3.1 rail: readiness counts + types-in-use chips | Task 8 |
| §3.3 `/vendors/new` page (name + type combobox + “why type matters” rail; no-type allowed) | Task 6 |
| §3.2 edit-mode: `vendorType` combobox in the edit form; Save bumps version + appends changelog | Tasks 3, 7 |
| §4 `vendorType` plumbed end-to-end (app type, `getVendor`, stub creation, update, both actions) | Tasks 1, 3, 6, 7 |
| §4 combobox options + “types in use” helper | Task 4 |
| §4 enriched list via a single batched readiness query (no N calls) | Task 4 (`approvedMappingTypeCounts` + `listVendorRows`) |
| §5 one new kit primitive: `Combobox` | Task 5 |
| §6 files touched | matches File Structure |

**Deferred to Plan 2 (out of scope here, per §10):** the exhaustive profile dossier (stat row, identity/constraints/sourcing-recipe/interview-log/version-history/campaign-activity cards, readiness-bridge rail), soft-archive (`archivedAt` migration + `includeArchived` filter), and caching the computed `signalRecipe`. Note: `listVendorRows` has **no** archive filter yet — Plan 2 adds `archivedAt` + the filter.

**2. Placeholder scan:** No `TODO`/`TBD`/“add error handling”. Every code step shows complete code; every test step shows real assertions. The three `> Note:` callouts are token/class-name verification reminders with correct fallbacks, not deferred work.

**3. Type consistency:** `VendorReadinessClass` values (`"runnable"|"needs_mapping"|"no_type"`) are identical across `classifyVendorReadiness`, `readinessLabel`, `readinessPillClass`, `VendorListRow.readiness`, and the list-view. `VendorTypeOption` (`{ type, mappingCount, vendorCount }`) is consistent across `getVendorTypeOptions`, `typeHint`, `toComboboxOptions`, and every component prop. `CreateVendorState` (`{ ok, vendorId?, error? }`) matches between `createVendorAction` and `NewVendorForm`. `updateVendorProfile`’s 4th param `vendorType?: string | null` is the same type produced by `vendorTypeSchema.parse(...)`. The `Combobox` prop shape is identical in `combobox.tsx`, `new-vendor-form.tsx`, and `edit-profile-form.tsx`.

**Ordering guardrail:** Tasks are dependency-ordered (schema → view-model → data reads → data enrich → combobox → new page → edit form → list). Each task ends green (tests + typecheck). Task 6 Step 7 and Task 1 Step 6 include the small forward-fixes needed to keep intermediate typechecks passing.
