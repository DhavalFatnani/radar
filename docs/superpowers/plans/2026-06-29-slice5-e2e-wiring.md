# Slice 5 — End-to-End Wiring Proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove one record flows UI → backend → database → back by creating a minimal vendor stub (`{ name }`) from the Vendors screen, persisting it, and listing it back — via a server-action write and a `GET /api/v1/vendors` read, both sharing one pure data module.

**Architecture:** A pure, auth-free data module (`src/lib/vendors/data.ts`) is the single source of truth (`createVendorStub`, `listVendors`, `vendorStubSchema`). A `"use server"` action wraps `createVendorStub` (auth guard → zod validate → insert → `revalidatePath`). The Vendors page (server component) and `GET /api/v1/vendors` both read via `listVendors`. Tests run at integration level against the real Neon **test branch** — no browser harness.

**Tech Stack:** Next.js 15 App Router · React 19 · Drizzle ORM (postgres-js) · zod · NextAuth v5 (`auth()`) · Vitest (node + jsdom) + @testing-library/react.

**Source spec:** `docs/superpowers/specs/2026-06-29-slice5-e2e-wiring-design.md`; `Prompt_Playbook.md` Part 3 → Slice 5.

## Global Constraints

Every task's requirements implicitly include these:

- **Auth:** every `(app)` route and `/api/v1/vendors` stays behind the Slice 3 middleware (already protects them — proven 307 → `/login`). The GET route also self-guards with `auth()` → `401 { error, code }` (defense-in-depth).
- **Reuse, don't re-derive:** Slice 4 primitives (`PageHeader`, `EmptyState`) and Slice 2 schema (`vendorProfiles`). Reuse mockup CSS tokens; confirmed tokens only: `--surface-2`, `--border`, `--border-strong`, `--radius-md`, `--space-1..5`, `--text`, `--text-muted`, `--text-sm`, `--warning` (NOT `--surface-1` / `--danger` — they don't exist).
- **DB safety:** Drizzle parameterized queries only (no string-interpolated SQL). Integration tests hit the **test branch** via `TEST_DATABASE_URL`, never the dev DB (Task 1 wires this).
- **API rules (`~/.claude/CLAUDE.md`):** versioned path (`/api/v1/...`), consistent error shape `{ error: string, code: string }`, correct HTTP status codes, never leak stack traces/internals. `listVendors` keeps a safety `LIMIT 100` + explicit column select (honors "never SELECT \* without LIMIT" / max-100).
- **Frontend rules:** mobile-first, semantic HTML (`form`/`label`/`button`/`ul`), every input labeled, keyboard-navigable, visible focus (tokens already provide it).
- **TS strict.** Test files under `tests/` (integration in `tests/integration/`, component in `tests/unit/components/` with `// @vitest-environment jsdom` as line 1 — the config has no `environmentMatchGlobs`).
- **Staging discipline:** stage only each task's listed files explicitly — never `git add -A` (untracked `.DS_Store` files + `Access_Control_Console.html` must stay out).
- **Branch:** `feature/slice-5-e2e-wiring` (already created from `main`).
- **GitNexus:** per project CLAUDE.md, run `impact` before editing an existing symbol and `detect_changes({scope:"compare", base_ref:"main"})` before each commit; warn on HIGH/CRITICAL.

---

## File Structure

```
src/
├── db/client.ts                              # Task 1: + export queryClient (teardown)
├── lib/vendors/data.ts                       # Task 1: vendorStubSchema, createVendorStub, listVendors
└── app/
    ├── (app)/vendors/
    │   ├── page.tsx                          # Task 5: server component — form + list / empty state
    │   ├── actions.ts                        # Task 2: "use server" createVendor
    │   └── add-vendor-form.tsx               # Task 4: client form (useActionState)
    ├── api/v1/vendors/route.ts               # Task 3: GET → { data }
    └── styles/command.css                    # Task 5: + .add-vendor-form / .vendor-list
tests/
├── setup/load-env.ts                         # Task 1: override DATABASE_URL → TEST_DATABASE_URL
├── integration/
│   ├── vendors-data.test.ts                  # Task 1
│   ├── vendors-action.test.ts                # Task 2
│   └── vendors-route.test.ts                 # Task 3 (route + e2e proof)
└── unit/components/add-vendor-form.test.tsx  # Task 4
README.md                                     # Task 5
```

---

## Why the test-harness DB wiring (Task 1) is needed

The app `db` client reads `DATABASE_URL` (dev branch: `ep-calm-feather…`), but the `testDb` helper prefers `TEST_DATABASE_URL` (test branch: `ep-fancy-bar…`) — **different databases**. Server actions and route handlers write through the app `db` (module-level, can't be injected into a server-action signature). So tests must (a) point the app `db` at the test branch for the test process, and (b) be able to close the app db connection. Task 1 does both, once, for the whole suite.

---

## Task 1: Vendor data layer + test-harness DB wiring

**Files:**
- Modify: `tests/setup/load-env.ts` (point app `db` at the test branch during tests)
- Modify: `src/db/client.ts` (export `queryClient` for test teardown — additive)
- Create: `src/lib/vendors/data.ts`
- Test: `tests/integration/vendors-data.test.ts`

**Interfaces:**
- Produces:
  - `vendorStubSchema` — zod object `{ name: string }` (trimmed, 1–200 chars).
  - `type VendorStubInput = z.infer<typeof vendorStubSchema>` → `{ name: string }`.
  - `type VendorListItem = { vendorId: string; name: string }`.
  - `createVendorStub(input: VendorStubInput): Promise<VendorListItem>`.
  - `listVendors(): Promise<VendorListItem[]>` (ordered by name asc, `LIMIT 100`).
  - `queryClient` (the postgres-js `Sql` instance from `@/db/client`).

- [ ] **Step 1: Write the failing test `tests/integration/vendors-data.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { vendorStubSchema, createVendorStub, listVendors } from "@/lib/vendors/data";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["vendor_profiles"]); });
afterAll(async () => { await closeTestDb(); await queryClient.end(); });

describe("vendor data layer", () => {
  it("createVendorStub persists and listVendors reads it back", async () => {
    const created = await createVendorStub({ name: "Acme Logistics" });
    expect(created.vendorId).toBeTruthy();
    expect(created.name).toBe("Acme Logistics");
    const all = await listVendors();
    expect(all.map((v) => v.name)).toEqual(["Acme Logistics"]);
  });

  it("listVendors returns vendors ordered by name", async () => {
    await createVendorStub({ name: "Zeta" });
    await createVendorStub({ name: "Alpha" });
    const all = await listVendors();
    expect(all.map((v) => v.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("vendorStubSchema trims valid names and rejects empty / over-long ones", () => {
    expect(vendorStubSchema.parse({ name: "  Acme  " }).name).toBe("Acme");
    expect(vendorStubSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(vendorStubSchema.safeParse({ name: "" }).success).toBe(false);
    expect(vendorStubSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/integration/vendors-data.test.ts`
Expected: FAIL — cannot resolve `@/lib/vendors/data` (and `queryClient` not exported).

- [ ] **Step 3: Point the app `db` at the test branch — modify `tests/setup/load-env.ts`**

Append after the two `config(...)` lines:

```ts
// Integration tests must never touch the dev/app database. When a dedicated
// test branch is configured, point the app's db client (which reads
// DATABASE_URL) at it too, so server actions / route handlers and the testDb
// helper share ONE database.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
```

- [ ] **Step 4: Export the connection for teardown — modify `src/db/client.ts`**

(GitNexus: `impact({target:"db", direction:"upstream"})` first — expected LOW; this is an additive export, no existing symbol changes.) Change the `queryClient` line to export it:

```ts
// Single shared connection for app/runtime use. Exported so tests can close it.
// `prepare: false` is REQUIRED over Neon's pooled (PgBouncer) endpoint.
export const queryClient = postgres(env.DATABASE_URL, { prepare: false });
export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
```

- [ ] **Step 5: Create `src/lib/vendors/data.ts`**

```ts
import { asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { vendorProfiles } from "@/db/schema";

export const vendorStubSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required.").max(200, "Vendor name is too long."),
});
export type VendorStubInput = z.infer<typeof vendorStubSchema>;

export type VendorListItem = { vendorId: string; name: string };

// Insert a minimal vendor stub. Input is already validated by the caller.
export async function createVendorStub(input: VendorStubInput): Promise<VendorListItem> {
  const [row] = await db
    .insert(vendorProfiles)
    .values({ name: input.name })
    .returning({ vendorId: vendorProfiles.vendorId, name: vendorProfiles.name });
  return row;
}

// List vendors for display / the read API. Explicit columns + LIMIT (no SELECT *).
export async function listVendors(): Promise<VendorListItem[]> {
  return db
    .select({ vendorId: vendorProfiles.vendorId, name: vendorProfiles.name })
    .from(vendorProfiles)
    .orderBy(asc(vendorProfiles.name))
    .limit(100);
}
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npx vitest run tests/integration/vendors-data.test.ts`
Expected: PASS (3 tests). If it instead errors on connecting, confirm `.env.local` has `TEST_DATABASE_URL` set.

- [ ] **Step 7: Type-check**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add tests/setup/load-env.ts src/db/client.ts src/lib/vendors/data.ts tests/integration/vendors-data.test.ts
git commit -m "feat(vendors): pure data layer (create/list stub) + test-branch db wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: createVendor server action

**Files:**
- Create: `src/app/(app)/vendors/actions.ts`
- Test: `tests/integration/vendors-action.test.ts`

**Interfaces:**
- Consumes: `createVendorStub`, `vendorStubSchema` (Task 1); `auth` (`@/lib/auth`); `revalidatePath` (`next/cache`); `queryClient`, `testDb`, helpers (tests).
- Produces: `createVendor(prevState: string | undefined, formData: FormData): Promise<string | undefined>` — returns an error message on invalid input/unauthenticated, `undefined` on success (mirrors `login/actions.ts`).

- [ ] **Step 1: Write the failing test `tests/integration/vendors-action.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { vendorProfiles } from "@/db/schema";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createVendor } from "@/app/(app)/vendors/actions";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["vendor_profiles"]); vi.clearAllMocks(); });
afterAll(async () => { await closeTestDb(); await queryClient.end(); });

function form(name: string): FormData {
  const fd = new FormData();
  fd.set("name", name);
  return fd;
}

describe("createVendor action", () => {
  it("persists a vendor from form data and revalidates", async () => {
    const result = await createVendor(undefined, form("RackPro Infra"));
    expect(result).toBeUndefined();
    const rows = await testDb.select().from(vendorProfiles);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("RackPro Infra");
    expect(revalidatePath).toHaveBeenCalledWith("/vendors");
  });

  it("returns an error and inserts nothing for an empty name", async () => {
    const result = await createVendor(undefined, form("   "));
    expect(result).toBe("Vendor name is required.");
    const rows = await testDb.select().from(vendorProfiles);
    expect(rows).toHaveLength(0);
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const result = await createVendor(undefined, form("Acme"));
    expect(result).toBe("You must be signed in.");
    const rows = await testDb.select().from(vendorProfiles);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/integration/vendors-action.test.ts`
Expected: FAIL — cannot resolve `@/app/(app)/vendors/actions`.

- [ ] **Step 3: Create `src/app/(app)/vendors/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createVendorStub, vendorStubSchema } from "@/lib/vendors/data";

// Returns an error message string on failure, or undefined on success.
// Never leaks internals.
export async function createVendor(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user) return "You must be signed in.";

  const parsed = vendorStubSchema.safeParse({ name: String(formData.get("name") ?? "") });
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Invalid vendor.";
  }

  await createVendorStub(parsed.data);
  revalidatePath("/vendors");
  return undefined;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/integration/vendors-action.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check, then commit**

Run: `npm run typecheck` (clean).

```bash
git add "src/app/(app)/vendors/actions.ts" tests/integration/vendors-action.test.ts
git commit -m "feat(vendors): createVendor server action (auth + validate + persist)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: GET /api/v1/vendors route + end-to-end proof

**Files:**
- Create: `src/app/api/v1/vendors/route.ts`
- Test: `tests/integration/vendors-route.test.ts` (route auth/serialization **and** the create-then-read E2E)

**Interfaces:**
- Consumes: `listVendors` (Task 1); `createVendor` (Task 2); `auth` (`@/lib/auth`).
- Produces: `GET(): Promise<Response>` — `200 { data: VendorListItem[] }`; `401 { error, code }`; `500 { error, code }`.

- [ ] **Step 1: Write the failing test `tests/integration/vendors-route.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { migrateTestDb, truncateAll, closeTestDb, testDb } from "./helpers/db";
import { queryClient } from "@/db/client";
import { vendorProfiles } from "@/db/schema";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { GET } from "@/app/api/v1/vendors/route";
import { createVendor } from "@/app/(app)/vendors/actions";
import { auth } from "@/lib/auth";

beforeAll(async () => { await migrateTestDb(); });
afterEach(async () => { await truncateAll(["vendor_profiles"]); vi.clearAllMocks(); });
afterAll(async () => { await closeTestDb(); await queryClient.end(); });

describe("GET /api/v1/vendors", () => {
  it("returns persisted vendors as { data }", async () => {
    await testDb.insert(vendorProfiles).values({ name: "Acme" });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((v: { name: string }) => v.name)).toContain("Acme");
  });

  it("returns 401 { error, code } when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
  });
});

describe("end-to-end: create-then-read through the stack", () => {
  it("a vendor created via the action is returned by the route", async () => {
    const fd = new FormData();
    fd.set("name", "Northwind Traders");
    const err = await createVendor(undefined, fd);
    expect(err).toBeUndefined();

    // DB-level read-back
    const rows = await testDb.select().from(vendorProfiles);
    expect(rows.map((v) => v.name)).toContain("Northwind Traders");

    // API-level read-back
    const res = await GET();
    const body = await res.json();
    expect(body.data.map((v: { name: string }) => v.name)).toContain("Northwind Traders");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/integration/vendors-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/v1/vendors/route`.

- [ ] **Step 3: Create `src/app/api/v1/vendors/route.ts`**

```ts
import { auth } from "@/lib/auth";
import { listVendors } from "@/lib/vendors/data";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const data = await listVendors();
    return Response.json({ data });
  } catch {
    return Response.json({ error: "Internal error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/integration/vendors-route.test.ts`
Expected: PASS (3 tests — route 200, route 401, e2e create-then-read).

- [ ] **Step 5: Type-check, then commit**

Run: `npm run typecheck` (clean).

```bash
git add "src/app/api/v1/vendors/route.ts" tests/integration/vendors-route.test.ts
git commit -m "feat(vendors): GET /api/v1/vendors read route + create-then-read e2e test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Add-vendor form (client)

**Files:**
- Create: `src/app/(app)/vendors/add-vendor-form.tsx`
- Test: `tests/unit/components/add-vendor-form.test.tsx`

**Interfaces:**
- Consumes: `createVendor` (Task 2).
- Produces: `<AddVendorForm />` — labeled name input + submit, wired to the action via `useActionState`; shows the returned error in `role="alert"`; clears the field after a successful submit.

- [ ] **Step 1: Write the failing test `tests/unit/components/add-vendor-form.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AddVendorForm } from "@/app/(app)/vendors/add-vendor-form";

// Mock the server action so the real module (db/auth imports) never loads in jsdom.
vi.mock("@/app/(app)/vendors/actions", () => ({ createVendor: vi.fn() }));

describe("AddVendorForm", () => {
  it("renders a labeled name input and a submit button", () => {
    render(<AddVendorForm />);
    expect(screen.getByLabelText(/vendor name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add vendor/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/unit/components/add-vendor-form.test.tsx`
Expected: FAIL — cannot resolve `@/app/(app)/vendors/add-vendor-form`.

- [ ] **Step 3: Create `src/app/(app)/vendors/add-vendor-form.tsx`**

```tsx
"use client";

import { useActionState, useEffect, useRef } from "react";
import { createVendor } from "./actions";

export function AddVendorForm() {
  const [error, formAction, isPending] = useActionState(createVendor, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the field after a settled submit that produced no error.
  useEffect(() => {
    if (!isPending && error === undefined) formRef.current?.reset();
  }, [isPending, error]);

  return (
    <form ref={formRef} action={formAction} className="add-vendor-form">
      <label>
        Vendor name
        <input type="text" name="name" required maxLength={200} autoComplete="off" />
      </label>
      <button type="submit" className="btn" disabled={isPending}>
        {isPending ? "Adding…" : "Add vendor"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

(The mount-time `reset()` is a harmless no-op on an already-empty form; it fires again only after a successful submit. On error, `error` is a string so the field is preserved for correction.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/components/add-vendor-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check, then commit**

Run: `npm run typecheck` (clean).

```bash
git add "src/app/(app)/vendors/add-vendor-form.tsx" tests/unit/components/add-vendor-form.test.tsx
git commit -m "feat(vendors): add-vendor form (useActionState, accessible, clears on success)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire the Vendors page + styles + README + done gate

**Files:**
- Modify: `src/app/(app)/vendors/page.tsx` (replace the empty-only page)
- Modify: `src/app/styles/command.css` (form + list styles)
- Modify: `README.md`

**Interfaces:**
- Consumes: `listVendors` (Task 1); `AddVendorForm` (Task 4); `PageHeader`, `EmptyState` (Slice 4).

(No automated unit test for `page.tsx`: it is an async server component — RTL cannot render it directly. It is covered by the Task 3 E2E, the production build, and the Step 4 manual walkthrough. GitNexus: `impact({target:"VendorsPage", direction:"upstream"})` before editing — expected LOW.)

- [ ] **Step 1: Rewrite `src/app/(app)/vendors/page.tsx`**

```tsx
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { listVendors } from "@/lib/vendors/data";
import { AddVendorForm } from "./add-vendor-form";

export const metadata = { title: "Vendors — Radar" };

export default async function VendorsPage() {
  const vendors = await listVendors();
  return (
    <>
      <PageHeader eyebrow="Build" title="Vendors" />
      <AddVendorForm />
      {vendors.length === 0 ? (
        <EmptyState
          icon="vendors"
          title="No vendors yet"
          description="Add a vendor above to prove the pipe — full profiles from the SIA intake interview will appear here."
        />
      ) : (
        <ul className="vendor-list">
          {vendors.map((v) => (
            <li key={v.vendorId}>{v.name}</li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 2: Append form + list styles to `src/app/styles/command.css`**

```css
/* --- Slice 5: add-vendor form + vendor list --- */
.add-vendor-form { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: end; margin-bottom: var(--space-5); }
.add-vendor-form label { display: grid; gap: var(--space-1); font-size: var(--text-sm); color: var(--text-muted); }
.add-vendor-form input { min-width: 240px; padding: var(--space-2) var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--surface-2); color: var(--text); }
.add-vendor-form [role="alert"] { flex-basis: 100%; margin: 0; color: var(--warning); font-size: var(--text-sm); }
.vendor-list { display: grid; gap: var(--space-2); list-style: none; padding: 0; margin: 0; }
.vendor-list li { padding: var(--space-3) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-2); color: var(--text); }
```

- [ ] **Step 3: Full quality gate**

Run, in order:
```bash
npm run lint
npm run typecheck
npm test
npm run build
```
Expected: lint clean; typecheck clean; all tests pass (existing 37 + Task 1's 3 + Task 2's 3 + Task 3's 3 + Task 4's 1 = 47); build compiles and lists `/vendors` (ƒ) and `/api/v1/vendors` (ƒ).

- [ ] **Step 4: Manual create→read→reload walkthrough**

```bash
npm run dev &
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3000/login && break; sleep 1; done
echo "unauth API: $(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' http://localhost:3000/api/v1/vendors)"
kill %1
```
Expected: unauthenticated `/api/v1/vendors` → `307 -> .../login` (middleware protection). Then, logged in, in a browser: type a name on `/vendors` → Add vendor → it appears in the list → reload → still there. (If `next dev` can't run in the sandbox, the controller verifies the browser path; the build + the Task 3 E2E are the automated evidence.)

- [ ] **Step 5: Update `README.md`**

Under the "App shell (Slice 4)" section, add:

```markdown
### Vendors create/list (Slice 5)

The Vendors screen proves the end-to-end path: add a vendor by name (a server action validates and persists it), and the list — read by the page and by `GET /api/v1/vendors` — shows it back after submit and reload. This completes Phase 1 (architecture proven end to end).
```

- [ ] **Step 6: `detect_changes` regression review, then commit**

Run: `detect_changes({scope: "compare", base_ref: "main", repo: "radar"})` — confirm only the Slice 5 files/symbols changed and risk is not HIGH/CRITICAL.

```bash
git add "src/app/(app)/vendors/page.tsx" src/app/styles/command.css README.md
git commit -m "feat(vendors): wire Vendors page (form + list) + styles; document Slice 5

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Acceptance Criteria → Task Map (self-review)

| Slice 5 acceptance criterion (playbook) | Implemented / verified by |
|---|---|
| Creating the stub from the UI persists it to the database | Task 2 (action) + Task 4 (form) + Task 5 (page wiring); Task 2 & 3 tests |
| The persisted record appears back in the UI after reload | Task 5 (page reads `listVendors`) + Task 2 (`revalidatePath`); Task 5 Step 4 walkthrough |
| An end-to-end test covers create-then-read through the stack | Task 3 `vendors-route.test.ts` "end-to-end" block (action → DB → GET route) |
| (Implicit) routes stay auth-protected | Middleware (proven 307) + Task 3 route `401` test |

## Done gate for the slice

All tests green (47 total), full quality gate green, the manual create→read→reload walkthrough confirmed, README updated, all committed on `feature/slice-5-e2e-wiring`. Then surface the branch for operator merge (do not merge unprompted). **On merge, tag the Phase 1 baseline** as an annotated tag:

```bash
git tag -a phase-1-baseline -m "Phase 1 baseline: architecture proven end to end (Slices 1–5)"
git push origin phase-1-baseline
```
Phase 1 is then complete.
```
