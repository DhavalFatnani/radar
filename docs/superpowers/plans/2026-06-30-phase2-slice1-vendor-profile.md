# Phase 2 · Slice 2.1 — Vendor Profile Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the vendor *stub* (`{ name }`) into a full, versioned, operator-editable profile reachable at `/vendors/[vendorId]`, persisting every editable `vendor_profiles` field with version-bump + `interview_history` on change.

**Architecture:** Mirror Slice 5's proven layering — a pure, auth-free data module (`src/lib/vendors/data.ts`) gains `getVendor` / `updateVendorProfile` (and `vendorProfileSchema`); a `"use server"` action wraps the write (auth → validate → update → revalidate); an async server-component detail page reads via the data module and renders a client `useActionState` edit form. No schema migration — all columns already exist from Slice 2.

**Tech Stack:** Next.js 15 App Router (async `params`) · React 19 (`useActionState`) · Drizzle ORM (postgres-js) · zod · NextAuth v5 (`auth()`) · Vitest (node + jsdom) + @testing-library/react.

**Source spec:** `docs/superpowers/specs/2026-06-30-phase2-slice1-vendor-profile-design.md`.

## Global Constraints

Every task's requirements implicitly include these:

- **No schema migration** — reuse existing `vendor_profiles` columns: `vendorId`, `name`, `capabilities` (text[]), `constraints` (jsonb), `ideal_customer` (jsonb), `known_good_signals` (text), `differentiators` (text), `credibility` (jsonb), `signal_recipe` (jsonb, NOT edited here), `version` (int, default 1), `interview_history` (jsonb).
- **jsonb shapes:** `constraints` = `{ minProjectSize?, maxProjectSize?, geographies?: string[], capacity?, currentLoad?, workingCapitalLimit?, leadTimes? }` (free-text strings except `geographies`); `ideal_customer` / `credibility` stored as `{ text: string }` or null; `interview_history` = array of `{ at, actor: "operator", kind: "manual_edit", changed: string[], version }`.
- **Versioning:** a save that changes ≥1 editable field bumps `version` +1 and appends one `manual_edit` history entry; a no-op save writes nothing.
- **Auth:** action guards with `auth()` → `"You must be signed in."`; routes also stay behind Slice 3 middleware (307 → `/login`).
- **DB safety:** Drizzle parameterized queries only. Integration tests hit the **test branch** via `TEST_DATABASE_URL` (wired in `tests/setup/load-env.ts` since Slice 5).
- **Frontend:** mobile-first, semantic HTML, every input labeled, keyboard-navigable; reuse Slice 4 `PageHeader`; reuse confirmed CSS tokens only (`--surface-2`, `--border`, `--border-strong`, `--radius-md`, `--space-1..5`, `--text`, `--text-muted`, `--text-sm`, `--warning`).
- **TS strict.** Component tests under `tests/unit/components/` start with `// @vitest-environment jsdom` (line 1). Integration tests under `tests/integration/`.
- **Staging discipline:** stage only each task's listed files explicitly — never `git add -A` (untracked `.DS_Store` must stay out).
- **Branch:** `feature/phase2-slice1-vendor-profile` (already created from `main`; the design spec is already committed on it).
- **No git tag** — tags are reserved for phase baselines; 2.1 is mid-Phase-2.

---

## File Structure

```
src/
├── lib/vendors/data.ts                              # Task 1: + VendorConstraints, InterviewHistoryEntry, VendorProfile,
│                                                     #         vendorProfileSchema, VendorProfileInput, getVendor, updateVendorProfile
└── app/(app)/vendors/
    ├── page.tsx                                      # Task 4: list <li> → <Link> to /vendors/[vendorId]
    └── [vendorId]/
        ├── page.tsx                                  # Task 4: async server component (getVendor → view + form)
        ├── actions.ts                                # Task 2: "use server" updateVendor (bound vendorId)
        └── edit-profile-form.tsx                     # Task 3: "use client" useActionState edit form
src/app/styles/command.css                            # Task 4: + .profile-form / .profile-meta styles
tests/
├── integration/vendors-profile-data.test.ts         # Task 1
├── integration/vendors-update-action.test.ts        # Task 2
└── unit/components/edit-profile-form.test.tsx        # Task 3
README.md                                             # Task 4
```

Expected final test total: **59** (existing 51 + Task 1's 4 + Task 2's 3 + Task 3's 1).

---

## Task 1: Profile schema + read/write data layer

**Files:**
- Modify: `src/lib/vendors/data.ts` (additive — `createVendorStub`/`listVendors` unchanged)
- Test: `tests/integration/vendors-profile-data.test.ts`

**Interfaces:**
- Consumes: `db` (`@/db/client`), `vendorProfiles` (`@/db/schema`), `createVendorStub` (existing, for tests).
- Produces:
  - `type VendorConstraints = { minProjectSize?: string; maxProjectSize?: string; geographies?: string[]; capacity?: string; currentLoad?: string; workingCapitalLimit?: string; leadTimes?: string }`
  - `type InterviewHistoryEntry = { at: string; actor: "operator"; kind: "manual_edit"; changed: string[]; version: number }`
  - `type VendorProfile = { vendorId: string; name: string; capabilities: string[]; constraints: VendorConstraints | null; idealCustomer: string | null; knownGoodSignals: string | null; differentiators: string | null; credibility: string | null; version: number; interviewHistory: InterviewHistoryEntry[] }`
  - `vendorProfileSchema` (zod) and `type VendorProfileInput = z.infer<typeof vendorProfileSchema>`
  - `getVendor(vendorId: string): Promise<VendorProfile | null>`
  - `updateVendorProfile(vendorId: string, input: VendorProfileInput): Promise<VendorProfile>`

- [ ] **Step 1: Write the failing test `tests/integration/vendors-profile-data.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import {
  createVendorStub,
  getVendor,
  updateVendorProfile,
  type VendorProfileInput,
} from "@/lib/vendors/data";

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

function baseInput(name: string): VendorProfileInput {
  return {
    name,
    capabilities: ["racking"],
    constraints: { geographies: ["Maharashtra"] },
    idealCustomer: "3PLs",
    knownGoodSignals: undefined,
    differentiators: undefined,
    credibility: undefined,
  };
}

describe("getVendor", () => {
  it("returns the full profile for an existing vendor", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const v = await getVendor(vendorId);
    expect(v).not.toBeNull();
    expect(v!.name).toBe("Acme");
    expect(v!.version).toBe(1);
    expect(v!.capabilities).toEqual([]);
    expect(v!.constraints).toBeNull();
    expect(v!.interviewHistory).toEqual([]);
  });

  it("returns null for a missing vendor", async () => {
    expect(await getVendor("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("updateVendorProfile", () => {
  it("updates fields, bumps version, and appends a history entry", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const updated = await updateVendorProfile(vendorId, {
      name: "Acme Logistics",
      capabilities: ["racking", "cctv"],
      constraints: { geographies: ["Maharashtra"], maxProjectSize: "100000 sqft" },
      idealCustomer: "Mid-size 3PLs",
      knownGoodSignals: "New warehouse lease",
      differentiators: "In-house install crew",
      credibility: "30+ installs",
    });
    expect(updated.version).toBe(2);
    expect(updated.name).toBe("Acme Logistics");
    expect(updated.capabilities).toEqual(["racking", "cctv"]);
    expect(updated.constraints).toEqual({ geographies: ["Maharashtra"], maxProjectSize: "100000 sqft" });
    expect(updated.idealCustomer).toBe("Mid-size 3PLs");
    expect(updated.credibility).toBe("30+ installs");
    expect(updated.interviewHistory).toHaveLength(1);
    expect(updated.interviewHistory[0]).toMatchObject({ actor: "operator", kind: "manual_edit", version: 2 });
    expect(updated.interviewHistory[0].changed).toEqual(
      expect.arrayContaining([
        "name", "capabilities", "constraints", "idealCustomer",
        "knownGoodSignals", "differentiators", "credibility",
      ]),
    );
  });

  it("does not bump version on a no-op save", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    await updateVendorProfile(vendorId, baseInput("Acme")); // version → 2
    const again = await updateVendorProfile(vendorId, baseInput("Acme")); // identical
    expect(again.version).toBe(2);
    expect(again.interviewHistory).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/integration/vendors-profile-data.test.ts`
Expected: FAIL — `getVendor`/`updateVendorProfile` not exported from `@/lib/vendors/data`.

- [ ] **Step 3: Add the profile layer to `src/lib/vendors/data.ts`**

Change the imports line at the top from `import { asc } from "drizzle-orm";` to:

```ts
import { asc, eq } from "drizzle-orm";
```

Then append the following to the end of the file (leave `vendorStubSchema`, `createVendorStub`, `listVendors` untouched):

```ts
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

// jsonb { text } <-> plain string helpers.
function unwrapText(value: unknown): string | null {
  if (value && typeof value === "object" && "text" in value) {
    const t = (value as { text?: unknown }).text;
    return typeof t === "string" && t.length > 0 ? t : null;
  }
  return null;
}

type NormalizedProfile = {
  name: string;
  capabilities: string[];
  constraints: VendorConstraints | null;
  idealCustomer: string | null;
  knownGoodSignals: string | null;
  differentiators: string | null;
  credibility: string | null;
};

function normalizeConstraints(c: VendorProfileInput["constraints"]): VendorConstraints | null {
  const out: VendorConstraints = {};
  if (c.minProjectSize) out.minProjectSize = c.minProjectSize;
  if (c.maxProjectSize) out.maxProjectSize = c.maxProjectSize;
  if (c.geographies && c.geographies.length) out.geographies = c.geographies;
  if (c.capacity) out.capacity = c.capacity;
  if (c.currentLoad) out.currentLoad = c.currentLoad;
  if (c.workingCapitalLimit) out.workingCapitalLimit = c.workingCapitalLimit;
  if (c.leadTimes) out.leadTimes = c.leadTimes;
  return Object.keys(out).length ? out : null;
}

function normalizeProfile(input: VendorProfileInput): NormalizedProfile {
  return {
    name: input.name,
    capabilities: input.capabilities,
    constraints: normalizeConstraints(input.constraints),
    idealCustomer: input.idealCustomer ?? null,
    knownGoodSignals: input.knownGoodSignals ?? null,
    differentiators: input.differentiators ?? null,
    credibility: input.credibility ?? null,
  };
}

function comparable(p: NormalizedProfile | VendorProfile) {
  return {
    name: p.name,
    capabilities: p.capabilities,
    constraints: p.constraints,
    idealCustomer: p.idealCustomer,
    knownGoodSignals: p.knownGoodSignals,
    differentiators: p.differentiators,
    credibility: p.credibility,
  };
}

function changedFields(current: VendorProfile, next: NormalizedProfile): string[] {
  const a = comparable(current);
  const b = comparable(next);
  return (Object.keys(a) as (keyof typeof a)[]).filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
}

export async function getVendor(vendorId: string): Promise<VendorProfile | null> {
  const [row] = await db
    .select({
      vendorId: vendorProfiles.vendorId,
      name: vendorProfiles.name,
      capabilities: vendorProfiles.capabilities,
      constraints: vendorProfiles.constraints,
      idealCustomer: vendorProfiles.idealCustomer,
      knownGoodSignals: vendorProfiles.knownGoodSignals,
      differentiators: vendorProfiles.differentiators,
      credibility: vendorProfiles.credibility,
      version: vendorProfiles.version,
      interviewHistory: vendorProfiles.interviewHistory,
    })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.vendorId, vendorId))
    .limit(1);
  if (!row) return null;
  return {
    vendorId: row.vendorId,
    name: row.name,
    capabilities: row.capabilities ?? [],
    constraints: (row.constraints as VendorConstraints | null) ?? null,
    idealCustomer: unwrapText(row.idealCustomer),
    knownGoodSignals: row.knownGoodSignals ?? null,
    differentiators: row.differentiators ?? null,
    credibility: unwrapText(row.credibility),
    version: row.version,
    interviewHistory: (row.interviewHistory as InterviewHistoryEntry[] | null) ?? [],
  };
}

export async function updateVendorProfile(
  vendorId: string,
  input: VendorProfileInput,
): Promise<VendorProfile> {
  const current = await getVendor(vendorId);
  if (!current) throw new Error("Vendor not found");

  const next = normalizeProfile(input);
  const changed = changedFields(current, next);
  if (changed.length === 0) return current; // no-op: no version bump, no write

  const newVersion = current.version + 1;
  const history: InterviewHistoryEntry[] = [
    ...current.interviewHistory,
    { at: new Date().toISOString(), actor: "operator", kind: "manual_edit", changed, version: newVersion },
  ];

  await db
    .update(vendorProfiles)
    .set({
      name: next.name,
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
  return updated;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/integration/vendors-profile-data.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/vendors/data.ts tests/integration/vendors-profile-data.test.ts
git commit -m "feat(vendors): profile read/write data layer (getVendor, updateVendorProfile, versioning)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: updateVendor server action

**Files:**
- Create: `src/app/(app)/vendors/[vendorId]/actions.ts`
- Test: `tests/integration/vendors-update-action.test.ts`

**Interfaces:**
- Consumes: `updateVendorProfile`, `vendorProfileSchema` (Task 1); `auth` (`@/lib/auth`); `revalidatePath` (`next/cache`); `createVendorStub` + helpers (tests).
- Produces: `updateVendor(vendorId: string, prevState: string | undefined, formData: FormData): Promise<string | undefined>` — returns an error message on failure, `undefined` on success. (The page binds `vendorId` via `.bind(null, vendorId)` so the form sees the `useActionState` signature.)

- [ ] **Step 1: Write the failing test `tests/integration/vendors-update-action.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { vendorProfiles } from "@/db/schema";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateVendor } from "@/app/(app)/vendors/[vendorId]/actions";
import { createVendorStub } from "@/lib/vendors/data";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

beforeAll(async () => {
  await migrateTestDb();
});
afterEach(async () => {
  await truncateAll(["vendor_profiles"]);
  vi.clearAllMocks();
});
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

function profileForm(name: string): FormData {
  const fd = new FormData();
  fd.set("name", name);
  fd.set("capabilities", "racking\ncctv");
  fd.set("maxProjectSize", "100000 sqft");
  fd.set("geographies", "Maharashtra");
  fd.set("differentiators", "In-house crew");
  return fd;
}

describe("updateVendor action", () => {
  it("persists profile edits from form data, bumps version, and revalidates", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const result = await updateVendor(vendorId, undefined, profileForm("Acme Logistics"));
    expect(result).toBeUndefined();

    const [row] = await testDb.select().from(vendorProfiles).where(eq(vendorProfiles.vendorId, vendorId));
    expect(row.name).toBe("Acme Logistics");
    expect(row.capabilities).toEqual(["racking", "cctv"]);
    expect(row.version).toBe(2);
    expect(revalidatePath).toHaveBeenCalledWith(`/vendors/${vendorId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/vendors");
  });

  it("returns an error and writes nothing for an empty name", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    const fd = profileForm("   ");
    const result = await updateVendor(vendorId, undefined, fd);
    expect(result).toBe("Vendor name is required.");
    const [row] = await testDb.select().from(vendorProfiles).where(eq(vendorProfiles.vendorId, vendorId));
    expect(row.version).toBe(1);
  });

  it("rejects an unauthenticated caller", async () => {
    const { vendorId } = await createVendorStub({ name: "Acme" });
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const result = await updateVendor(vendorId, undefined, profileForm("Acme Logistics"));
    expect(result).toBe("You must be signed in.");
    const [row] = await testDb.select().from(vendorProfiles).where(eq(vendorProfiles.vendorId, vendorId));
    expect(row.version).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/integration/vendors-update-action.test.ts`
Expected: FAIL — cannot resolve `@/app/(app)/vendors/[vendorId]/actions`.

- [ ] **Step 3: Create `src/app/(app)/vendors/[vendorId]/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateVendorProfile, vendorProfileSchema } from "@/lib/vendors/data";

// Bound with vendorId via .bind(null, vendorId) so the form sees (prevState, formData).
// Returns an error message string on failure, or undefined on success. Never leaks internals.
export async function updateVendor(
  vendorId: string,
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user) return "You must be signed in.";

  const parsed = vendorProfileSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    capabilities: String(formData.get("capabilities") ?? ""),
    constraints: {
      minProjectSize: String(formData.get("minProjectSize") ?? ""),
      maxProjectSize: String(formData.get("maxProjectSize") ?? ""),
      geographies: String(formData.get("geographies") ?? ""),
      capacity: String(formData.get("capacity") ?? ""),
      currentLoad: String(formData.get("currentLoad") ?? ""),
      workingCapitalLimit: String(formData.get("workingCapitalLimit") ?? ""),
      leadTimes: String(formData.get("leadTimes") ?? ""),
    },
    idealCustomer: String(formData.get("idealCustomer") ?? ""),
    knownGoodSignals: String(formData.get("knownGoodSignals") ?? ""),
    differentiators: String(formData.get("differentiators") ?? ""),
    credibility: String(formData.get("credibility") ?? ""),
  });
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Invalid vendor profile.";
  }

  try {
    await updateVendorProfile(vendorId, parsed.data);
  } catch {
    return "Could not save the vendor profile.";
  }
  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath("/vendors");
  return undefined;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/integration/vendors-update-action.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check, then commit**

Run: `npm run typecheck` (clean).

```bash
git add "src/app/(app)/vendors/[vendorId]/actions.ts" tests/integration/vendors-update-action.test.ts
git commit -m "feat(vendors): updateVendor server action (auth + validate + persist profile)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Edit-profile form (client)

**Files:**
- Create: `src/app/(app)/vendors/[vendorId]/edit-profile-form.tsx`
- Test: `tests/unit/components/edit-profile-form.test.tsx`

**Interfaces:**
- Consumes: `updateVendor` (Task 2); `VendorProfile` (Task 1).
- Produces: `<EditProfileForm vendor={VendorProfile} />` — a labeled, pre-filled form wired to `updateVendor` via `useActionState`; shows the returned error in `role="alert"`.

- [ ] **Step 1: Write the failing test `tests/unit/components/edit-profile-form.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditProfileForm } from "@/app/(app)/vendors/[vendorId]/edit-profile-form";
import type { VendorProfile } from "@/lib/vendors/data";

// Mock the server action so the real module (db/auth imports) never loads in jsdom.
vi.mock("@/app/(app)/vendors/[vendorId]/actions", () => ({ updateVendor: vi.fn() }));

const vendor: VendorProfile = {
  vendorId: "v1",
  name: "Acme",
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
  it("renders the name field pre-filled and a save button", () => {
    render(<EditProfileForm vendor={vendor} />);
    expect(screen.getByLabelText(/vendor name/i)).toHaveValue("Acme");
    expect(screen.getByRole("button", { name: /save profile/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/unit/components/edit-profile-form.test.tsx`
Expected: FAIL — cannot resolve `@/app/(app)/vendors/[vendorId]/edit-profile-form`.

- [ ] **Step 3: Create `src/app/(app)/vendors/[vendorId]/edit-profile-form.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import type { VendorProfile } from "@/lib/vendors/data";
import { updateVendor } from "./actions";

export function EditProfileForm({ vendor }: { vendor: VendorProfile }) {
  const action = updateVendor.bind(null, vendor.vendorId);
  const [error, formAction, isPending] = useActionState(action, undefined);
  const c = vendor.constraints ?? {};

  return (
    <form action={formAction} className="profile-form">
      <label>
        Vendor name
        <input type="text" name="name" defaultValue={vendor.name} required maxLength={200} />
      </label>
      <label>
        Capabilities (one per line)
        <textarea name="capabilities" rows={3} defaultValue={vendor.capabilities.join("\n")} />
      </label>

      <fieldset>
        <legend>Constraints</legend>
        <label>
          Min project size
          <input type="text" name="minProjectSize" defaultValue={c.minProjectSize ?? ""} maxLength={200} />
        </label>
        <label>
          Max project size
          <input type="text" name="maxProjectSize" defaultValue={c.maxProjectSize ?? ""} maxLength={200} />
        </label>
        <label>
          Geographies (one per line)
          <textarea name="geographies" rows={2} defaultValue={(c.geographies ?? []).join("\n")} />
        </label>
        <label>
          Capacity
          <input type="text" name="capacity" defaultValue={c.capacity ?? ""} maxLength={200} />
        </label>
        <label>
          Current load
          <input type="text" name="currentLoad" defaultValue={c.currentLoad ?? ""} maxLength={200} />
        </label>
        <label>
          Working capital limit
          <input type="text" name="workingCapitalLimit" defaultValue={c.workingCapitalLimit ?? ""} maxLength={200} />
        </label>
        <label>
          Lead times
          <input type="text" name="leadTimes" defaultValue={c.leadTimes ?? ""} maxLength={200} />
        </label>
      </fieldset>

      <label>
        Ideal customer
        <textarea name="idealCustomer" rows={3} defaultValue={vendor.idealCustomer ?? ""} maxLength={4000} />
      </label>
      <label>
        Known-good signals
        <textarea name="knownGoodSignals" rows={3} defaultValue={vendor.knownGoodSignals ?? ""} maxLength={4000} />
      </label>
      <label>
        Differentiators
        <textarea name="differentiators" rows={3} defaultValue={vendor.differentiators ?? ""} maxLength={4000} />
      </label>
      <label>
        Credibility / proof
        <textarea name="credibility" rows={3} defaultValue={vendor.credibility ?? ""} maxLength={4000} />
      </label>

      <button type="submit" className="btn" disabled={isPending}>
        {isPending ? "Saving…" : "Save profile"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/components/edit-profile-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check, then commit**

Run: `npm run typecheck` (clean).

```bash
git add "src/app/(app)/vendors/[vendorId]/edit-profile-form.tsx" tests/unit/components/edit-profile-form.test.tsx
git commit -m "feat(vendors): edit-profile form (useActionState, pre-filled, accessible)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Vendor detail page + list link + styles + README + done gate

**Files:**
- Create: `src/app/(app)/vendors/[vendorId]/page.tsx`
- Modify: `src/app/(app)/vendors/page.tsx` (link list items to detail)
- Modify: `src/app/styles/command.css` (profile form + meta styles)
- Modify: `README.md`

**Interfaces:**
- Consumes: `getVendor` (Task 1); `EditProfileForm` (Task 3); `PageHeader` (Slice 4); `notFound` (`next/navigation`); `Link` (`next/link`).

(No automated unit test for `page.tsx` — async server component; covered by Task 1/2 tests, the build, and the Step 5 manual walkthrough.)

- [ ] **Step 1: Create `src/app/(app)/vendors/[vendorId]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { PageHeader } from "@/app/components/ui/page-header";
import { getVendor } from "@/lib/vendors/data";
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

  return (
    <>
      <PageHeader eyebrow="Build" title={vendor.name} />
      <p className="profile-meta">Version {vendor.version}</p>
      <EditProfileForm vendor={vendor} />
    </>
  );
}
```

- [ ] **Step 2: Link list items to the detail page — modify `src/app/(app)/vendors/page.tsx`**

Add `import Link from "next/link";` at the top (below the existing imports). Replace the `<ul className="vendor-list">…</ul>` block with:

```tsx
        <ul className="vendor-list">
          {vendors.map((v) => (
            <li key={v.vendorId}>
              <Link href={`/vendors/${v.vendorId}`}>{v.name}</Link>
            </li>
          ))}
        </ul>
```

- [ ] **Step 3: Append profile styles to `src/app/styles/command.css`**

Append at end of file (after the Slice 5 block):

```css
/* --- Phase 2 Slice 2.1: vendor profile detail + edit form --- */
.profile-meta { margin: 0 0 var(--space-4); color: var(--text-muted); font-size: var(--text-sm); }
.profile-form { display: grid; gap: var(--space-4); max-width: 640px; }
.profile-form label { display: grid; gap: var(--space-1); font-size: var(--text-sm); color: var(--text-muted); }
.profile-form input, .profile-form textarea { padding: var(--space-2) var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--surface-2); color: var(--text); font: inherit; }
.profile-form fieldset { display: grid; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-4); }
.profile-form legend { padding: 0 var(--space-2); color: var(--text); font-size: var(--text-sm); }
.profile-form [role="alert"] { margin: 0; color: var(--warning); font-size: var(--text-sm); }
.vendor-list li a { color: var(--text); text-decoration: none; }
.vendor-list li a:hover { text-decoration: underline; }
```

- [ ] **Step 4: Full quality gate**

Run, in order:
```bash
npm run lint
npm run typecheck
npm test
npm run build
```
Expected: lint clean; typecheck clean; all tests pass (**59** = existing 51 + 4 + 3 + 1); build compiles and lists `/vendors/[vendorId]` (ƒ).

- [ ] **Step 5: Manual create→edit→reload walkthrough**

Start the dev server, sign in (operator creds), open `/vendors`, click a vendor → `/vendors/[id]`, edit fields → Save profile → values persist; reload → still there; the "Version N" line incremented. Unauthenticated `/vendors/<id>` → `307 → /login` (middleware). (If the browser cannot be driven, the build + Task 1/2 tests are the automated evidence; verify the auth 307 with curl.)

- [ ] **Step 6: Update `README.md`**

Under the "Vendors create/list (Slice 5)" section, add:

```markdown
### Vendor profiles (Phase 2 · Slice 2.1)

Each vendor has a detail page at `/vendors/[id]` where the operator edits the full profile — capabilities, constraints, ideal customer, known-good signals, differentiators, and credibility. Saves are versioned: every change bumps `version` and appends a dated entry to `interview_history`. The SIA interview (later) writes through this same path.
```

- [ ] **Step 7: Scope review, then commit**

Run `git diff --stat main...HEAD` and confirm only Slice 2.1 files (+ the already-committed spec) changed; no HIGH-risk surprises.

```bash
git add "src/app/(app)/vendors/[vendorId]/page.tsx" "src/app/(app)/vendors/page.tsx" src/app/styles/command.css README.md
git commit -m "feat(vendors): vendor detail page + profile edit wiring; document Slice 2.1

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Acceptance Criteria → Task Map (self-review)

| Spec acceptance criterion | Implemented / verified by |
|---|---|
| Open a vendor detail page at `/vendors/[vendorId]` | Task 4 (page) + Task 4 Step 2 (list link) |
| Detail page shows current profile + edit form for all editable fields | Task 4 (page) + Task 3 (form) |
| Valid edits persist all fields, bump `version`, append `manual_edit` history with changed fields | Task 1 (`updateVendorProfile`) + Task 2 (action); Task 1 & 2 tests |
| No-op save does not bump `version` | Task 1 (`updateVendorProfile` no-op test) |
| Invalid input → message, no write; unauthenticated rejected | Task 2 (action validation + auth tests) + middleware (307) |
| Edits persist after reload | Task 4 (page reads `getVendor`) + Task 2 (`revalidatePath`); Step 5 walkthrough |

## Done gate for the slice

All tests green (59 total), full quality gate green (lint/typecheck/test/build), manual edit→reload walkthrough confirmed, README updated, per-task commits on `feature/phase2-slice1-vendor-profile`. Then surface the branch for operator merge (do not merge unprompted). **No git tag** (mid-Phase-2).
