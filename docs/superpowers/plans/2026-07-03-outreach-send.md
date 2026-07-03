# Outreach Slice B — Real Email Send (Resend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator send a drafted outreach email for real via a Resend adapter — gated on a configured key, operator-initiated with an inline confirm, marking the lead `sent` on success. Tests mock the sender; no real email is sent during the build.

**Architecture:** Mirrors Outreach Slice A layering. A pure recipient helper in `src/lib/outreach/schema.ts`; a server-only sender adapter `src/lib/outreach/sender.ts` wrapping the `resend` SDK; a new `sendOutreachAction` orchestration in `src/app/(app)/leads/actions.ts` (the only place importing both the sender and the data layer); an `OutreachPanel` "Send now" control with inline confirm, wired from the RSC page.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle + Neon Postgres, NextAuth v5 (`auth()`), Vitest (unit jsdom/node + integration real-Neon), `resend` SDK.

## Global Constraints

- Secrets via env only — `RESEND_API_KEY` / `OUTREACH_FROM_EMAIL` never appear in code. Operator sets them in `.env.local` (never read or modified by the build).
- Data-module split preserved: pure `src/lib/outreach/schema.ts` stays client-safe (no `@/db`, no `server-only`, no `@/ai`/sender **value** imports; type-only imports OK). The sender is server-only by import graph (only the action, the RSC page, and tests import it).
- `src/ai/` untouched — no DB, no email access there.
- HTTPS-only external calls (Resend SDK is HTTPS). Parameterized Drizzle (`eq()`) only. Validate inputs. No stack traces / internal errors to the client.
- Sanitized errors — one constant string per failure class; never surface a raw provider message, key, or stack.
- Action return convention: `Promise<{ ok: boolean; error?: string }>`.
- Mobile-first (375 → 768 → 1280), semantic HTML, real `<button type="button">`s, keyboard-navigable, focus states, `role="alert"` for errors.
- Tests live in the mirroring test dir; every new pure function is unit-tested; ≥80% coverage on new code. No `console.log`, no TODOs, no silent empty catches.
- Additive only — no edits to shipped pipeline / AI / Slice-A data modules beyond the additive action + panel extension.
- Real send is operator-initiated; the build never fires a message at a real recipient — every test mocks the sender, and `sendEmail` only issues a request when a real key is configured at runtime.
- **Subagents commit ONLY explicit file paths (never `git add .`/`-A`).** Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Foundation — `resend` dep, env vars, recipient helper

**Files:**
- Modify: `package.json` (+ `resend` dependency, via `npm install`)
- Modify: `src/lib/env.ts` (two optional vars)
- Modify: `.env.example` (commented entries)
- Modify: `src/lib/outreach/schema.ts` (add `primaryRecipientEmail`)
- Test: `tests/unit/outreach/schema.test.ts` (extend)

**Interfaces:**
- Consumes: `ContactBlock` type from `@/lib/sourcing/contacts-schema` — shape:
  `{ decision_makers: { name; role; why; paths: { type: string; val: string | null; conf; source }[]; warm }[]; status; resolvedBy; resolvedAt }`.
- Produces:
  - `primaryRecipientEmail(block: ContactBlock | null): string | null`
  - `env.RESEND_API_KEY: string | undefined`, `env.OUTREACH_FROM_EMAIL: string | undefined`

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/outreach/schema.test.ts`.

Add `primaryRecipientEmail` to the import from `@/lib/outreach/schema`, add the `ContactBlock` type import, and append this block:

```ts
import type { ContactBlock } from "@/lib/sourcing/contacts-schema";

function block(
  paths: { type: string; val: string | null }[],
): ContactBlock {
  return {
    decision_makers: [
      {
        name: "Dana Ops",
        role: "COO",
        why: "runs ops",
        paths: paths.map((p) => ({ type: p.type, val: p.val, conf: null, source: null })),
        warm: { status: "cold", detail: null },
      },
    ],
    status: "resolved",
    resolvedBy: "test",
    resolvedAt: "2026-07-03T00:00:00.000Z",
  };
}

describe("primaryRecipientEmail", () => {
  it("returns the first email path with a value", () => {
    expect(
      primaryRecipientEmail(block([{ type: "email", val: "dana@acme.test" }])),
    ).toBe("dana@acme.test");
  });

  it("skips an email path whose val is null and takes the next usable email", () => {
    expect(
      primaryRecipientEmail(
        block([
          { type: "email", val: null },
          { type: "email", val: "dana@acme.test" },
        ]),
      ),
    ).toBe("dana@acme.test");
  });

  it("ignores non-email path types", () => {
    expect(
      primaryRecipientEmail(
        block([
          { type: "phone", val: "+1-555" },
          { type: "linkedin", val: "in/dana" },
        ]),
      ),
    ).toBeNull();
  });

  it("returns null when no email path exists", () => {
    expect(primaryRecipientEmail(block([]))).toBeNull();
  });

  it("returns null when decision_makers is empty", () => {
    const b = block([{ type: "email", val: "x@y.test" }]);
    b.decision_makers = [];
    expect(primaryRecipientEmail(b)).toBeNull();
  });

  it("returns null for a null block", () => {
    expect(primaryRecipientEmail(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/outreach/schema.test.ts`
Expected: FAIL — `primaryRecipientEmail is not a function` (not yet exported).

- [ ] **Step 3: Install the `resend` dependency**

Run: `npm install resend`
Expected: `resend` added to `package.json` `dependencies`; lockfile updated. (No code uses it yet — this is the foundation for Task 2.)

- [ ] **Step 4: Add the optional env vars** — in `src/lib/env.ts`, inside the `envSchema` `z.object({ ... })`, after the existing `TEST_DATABASE_URL` line, add:

```ts
  RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OUTREACH_FROM_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
```

(Use the file's existing `emptyToUndefined` preprocessor and `z` import — mirror the `DIRECT_URL` line exactly.)

- [ ] **Step 5: Document them in `.env.example`** — append, mirroring the existing commented LLM-provider block:

```
# Resend email sending (Outreach Slice B) — https://resend.com/api-keys
# Both must be set to enable in-app sending. OUTREACH_FROM_EMAIL must be a bare
# address on a Resend-verified domain.
# RESEND_API_KEY=replace-with-resend-key
# OUTREACH_FROM_EMAIL=outreach@yourdomain.com
```

- [ ] **Step 6: Add the recipient helper** — in `src/lib/outreach/schema.ts`, add the type-only import at the top (after the `zod` import):

```ts
import type { ContactBlock } from "@/lib/sourcing/contacts-schema";
```

and append at the end of the file:

```ts
/**
 * The email address outreach should be sent to: the first decision-maker
 * contact path of type "email" that has a non-empty value. Returns null when
 * the block is missing or no usable email exists. Pure — client-safe.
 */
export function primaryRecipientEmail(block: ContactBlock | null): string | null {
  if (!block) return null;
  for (const dm of block.decision_makers) {
    for (const path of dm.paths) {
      if (path.type === "email" && path.val !== null && path.val.length > 0) {
        return path.val;
      }
    }
  }
  return null;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/outreach/schema.test.ts`
Expected: PASS — all prior status/draft tests plus the 6 new `primaryRecipientEmail` tests.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors. (Confirms the type-only `ContactBlock` import keeps `schema.ts` client-safe and the env additions compile.)

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/lib/env.ts .env.example src/lib/outreach/schema.ts tests/unit/outreach/schema.test.ts
git commit -m "feat(outreach): recipient helper + Resend env vars + dependency"
```

---

### Task 2: Sender adapter (`src/lib/outreach/sender.ts`)

**Files:**
- Create: `src/lib/outreach/sender.ts`
- Test: `tests/unit/outreach/sender.test.ts`

**Interfaces:**
- Consumes: `env` from `@/lib/env` (Task 1 vars); `Resend` from `resend`.
- Produces:
  - `type SendResult = { ok: true; id: string } | { ok: false; error: string }`
  - `isSendConfigured(): boolean`
  - `sendEmail(input: { to: string; subject: string; body: string }): Promise<SendResult>` — never throws.

- [ ] **Step 1: Write the failing test** — `tests/unit/outreach/sender.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable so tests can toggle configuration. sendEmail/isSendConfigured read live.
const mockEnv: { RESEND_API_KEY?: string; OUTREACH_FROM_EMAIL?: string } = {
  RESEND_API_KEY: "re_test",
  OUTREACH_FROM_EMAIL: "from@radar.test",
};
vi.mock("@/lib/env", () => ({ env: mockEnv }));

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn(() => ({ emails: { send: mockSend } })),
}));

import { sendEmail, isSendConfigured } from "@/lib/outreach/sender";

beforeEach(() => {
  mockEnv.RESEND_API_KEY = "re_test";
  mockEnv.OUTREACH_FROM_EMAIL = "from@radar.test";
  mockSend.mockReset();
});

describe("isSendConfigured", () => {
  it("is true only when both env vars are present", () => {
    expect(isSendConfigured()).toBe(true);
    mockEnv.RESEND_API_KEY = undefined;
    expect(isSendConfigured()).toBe(false);
    mockEnv.RESEND_API_KEY = "re_test";
    mockEnv.OUTREACH_FROM_EMAIL = undefined;
    expect(isSendConfigured()).toBe(false);
  });
});

describe("sendEmail", () => {
  it("returns not-configured and never calls the provider when unconfigured", async () => {
    mockEnv.RESEND_API_KEY = undefined;
    const r = await sendEmail({ to: "a@b.test", subject: "Hi", body: "Yo" });
    expect(r).toEqual({ ok: false, error: "Email sending is not configured." });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends via Resend and returns the message id on success", async () => {
    mockSend.mockResolvedValue({ data: { id: "msg_1" }, error: null });
    const r = await sendEmail({ to: "a@b.test", subject: "Hi", body: "Yo" });
    expect(r).toEqual({ ok: true, id: "msg_1" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      from: "from@radar.test",
      to: "a@b.test",
      subject: "Hi",
      text: "Yo",
    });
  });

  it("sanitizes a provider-reported error (no raw message leaks)", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "boom-secret", name: "x" } });
    const r = await sendEmail({ to: "a@b.test", subject: "Hi", body: "Yo" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("Sending failed. Check the email provider configuration.");
      expect(r.error).not.toContain("boom-secret");
    }
  });

  it("sanitizes a thrown provider error (no raw message leaks)", async () => {
    mockSend.mockRejectedValue(new Error("network re_secret_key"));
    const r = await sendEmail({ to: "a@b.test", subject: "Hi", body: "Yo" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("Sending failed. Check the email provider configuration.");
      expect(r.error).not.toContain("re_secret_key");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/outreach/sender.test.ts`
Expected: FAIL — cannot resolve `@/lib/outreach/sender`.

- [ ] **Step 3: Implement the adapter** — `src/lib/outreach/sender.ts`:

```ts
// Server-only outreach email sender. External HTTPS I/O + reads a secret key,
// so it is imported ONLY by the send server action, the lead-detail RSC page,
// and tests — never by a client component. Thin transport: all guards (auth,
// draft present, mode, recipient) live in the server action, not here.
import { Resend } from "resend";
import { env } from "@/lib/env";

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/** True only when both Resend env vars are set. */
export function isSendConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.OUTREACH_FROM_EMAIL);
}

/**
 * Send a plain-text email via Resend. Never throws: every failure — unconfigured,
 * a provider-reported error, or a thrown SDK/network error — returns a sanitized
 * SendResult. No raw provider message, key, or stack ever reaches the caller.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<SendResult> {
  if (!env.RESEND_API_KEY || !env.OUTREACH_FROM_EMAIL) {
    return { ok: false, error: "Email sending is not configured." };
  }
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: env.OUTREACH_FROM_EMAIL,
      to: input.to,
      subject: input.subject,
      text: input.body,
    });
    if (error || !data) {
      return { ok: false, error: "Sending failed. Check the email provider configuration." };
    }
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, error: "Sending failed. Check the email provider configuration." };
  }
}
```

If the installed `resend` types require a different `emails.send` argument or response shape, adapt to the SDK's actual types (keep `from`/`to`/`subject`/`text`, the `{ data, error }` result, and `data.id`), but do not change the four public error strings or the `SendResult` shape.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/outreach/sender.test.ts`
Expected: PASS — 5 assertions across `isSendConfigured` + `sendEmail`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/outreach/sender.ts tests/unit/outreach/sender.test.ts
git commit -m "feat(outreach): Resend sender adapter (configured-gate + sanitized errors)"
```

---

### Task 3: `sendOutreachAction` server action

**Files:**
- Modify: `src/app/(app)/leads/actions.ts` (add one action + imports)
- Test: `tests/integration/outreach-send-action.test.ts` (new, real Neon)

**Interfaces:**
- Consumes: `signedIn()`, `getLeadDetail`, `db`, `setOutreachStatus`, `revalidatePath` (all already imported in `actions.ts`); `sendEmail`, `isSendConfigured` from `@/lib/outreach/sender`; `primaryRecipientEmail` from `@/lib/outreach/schema`.
- Produces: `sendOutreachAction(leadId: string): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Write the failing integration test** — `tests/integration/outreach-send-action.test.ts`.

Mock scaffolding at the top (mirror `tests/integration/outreach-actions.test.ts` for auth/cache and DB seeding; **read that file first** and reuse its seed helper — insert company + vendor_profile + lead — extending the lead insert to set `outreach_draft`, `outreach_status`, `outreach_mode`, and `contact_block`). Add the sender mock:

```ts
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "op@test" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/outreach/sender", () => ({
  sendEmail: vi.fn(async () => ({ ok: true, id: "msg_1" })),
  isSendConfigured: vi.fn(() => true),
}));
```

Then import the mocked refs (`auth`, `revalidatePath`, `sendEmail`, `isSendConfigured`) plus `sendOutreachAction`, the real `db` singleton, and the DB helpers (`migrateTestDb`, `truncateAll`, `closeTestDb`, `queryClient`). Use `beforeAll(migrateTestDb)`, `afterEach(truncateAll(...))`, and:

```ts
afterAll(async () => {
  await closeTestDb();
  await queryClient.end();
});

beforeEach(() => {
  (sendEmail as Mock).mockResolvedValue({ ok: true, id: "msg_1" });
  (isSendConfigured as Mock).mockReturnValue(true);
  (auth as Mock).mockResolvedValue({ user: { email: "op@test" } });
});
```

Seed default: a lead with `outreach_status: "drafted"`, `outreach_mode: "operator_handles"`, `outreach_draft: { subject: "Hi", body: "Let's talk." }`, and a `contact_block` whose first decision-maker has an `{ type: "email", val: "dana@acme.test" }` path. Write these cases (each seeds via the helper with overrides as noted):

1. **unauthenticated** — `(auth as Mock).mockResolvedValueOnce(null)`; `sendOutreachAction(id)` → `{ ok: false, error: "Not signed in." }`; assert `sendEmail` NOT called, `revalidatePath` NOT called, and the row's `outreach_status` is still `"drafted"`.
2. **unknown valid UUID** — call with `"00000000-0000-4000-8000-000000000000"` → `{ ok: false, error: "Lead not found." }`; `sendEmail` not called.
3. **no draft** — seed `outreach_status: "pending"`, `outreach_draft: null` → `{ ok: false, error: "Generate the draft first." }`; not sent.
4. **already sent** — seed `outreach_status: "sent"` → `{ ok: false, error: "Already sent." }`; `sendEmail` not called.
5. **handed to vendor** — seed `outreach_mode: "handed_to_vendor"` → `{ ok: false, error: "This lead is handed to the vendor; sending is disabled." }`; not sent.
6. **no email on file** — seed a `contact_block` with only a `{ type: "phone", val: "+1" }` path → `{ ok: false, error: "No email address on file for this lead." }`; `sendEmail` not called.
7. **not configured** — `(isSendConfigured as Mock).mockReturnValueOnce(false)` → `{ ok: false, error: "Email sending is not configured." }`; `sendEmail` NOT called.
8. **provider failure** — `(sendEmail as Mock).mockResolvedValueOnce({ ok: false, error: "Sending failed. Check the email provider configuration." })` → action returns that same error; assert the row's `outreach_status` is still `"drafted"` (NOT advanced) and `revalidatePath` NOT called.
9. **success** — default seed → `{ ok: true }`; assert `sendEmail` called once with `{ to: "dana@acme.test", subject: "Hi", body: "Let's talk." }`; the row's `outreach_status` is now `"sent"` and `outreach_sent_at` is non-null; `revalidatePath` called with `` `/leads/${id}` ``.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/outreach-send-action.test.ts`
Expected: FAIL — `sendOutreachAction` is not exported.

- [ ] **Step 3: Implement the action** — in `src/app/(app)/leads/actions.ts`, add the imports:

```ts
import { sendEmail, isSendConfigured } from "@/lib/outreach/sender";
import { primaryRecipientEmail } from "@/lib/outreach/schema";
```

and append the action:

```ts
export async function sendOutreachAction(
  leadId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in." };

  const lead = await getLeadDetail(db, leadId);
  if (!lead) return { ok: false, error: "Lead not found." };
  if (!lead.outreachDraft) return { ok: false, error: "Generate the draft first." };
  if (lead.outreachStatus === "sent") return { ok: false, error: "Already sent." };

  const mode = lead.outreachMode ?? "operator_handles";
  if (mode !== "operator_handles") {
    return { ok: false, error: "This lead is handed to the vendor; sending is disabled." };
  }

  if (!isSendConfigured()) {
    return { ok: false, error: "Email sending is not configured." };
  }

  const to = primaryRecipientEmail(lead.contactBlock);
  if (!to) return { ok: false, error: "No email address on file for this lead." };

  const sent = await sendEmail({
    to,
    subject: lead.outreachDraft.subject,
    body: lead.outreachDraft.body,
  });
  if (!sent.ok) return { ok: false, error: sent.error };

  const r = await setOutreachStatus(db, leadId, "sent");
  if (r.ok) {
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  }
  return { ok: false, error: r.error };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/outreach-send-action.test.ts`
Expected: PASS — all 9 cases. (Real-Neon TRUNCATE/latency flakes are transient — re-run 2-3× before treating a deadlock/timeout as real; a genuine assertion failure is real.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/leads/actions.ts tests/integration/outreach-send-action.test.ts
git commit -m "feat(outreach): sendOutreachAction (auth/guards -> send -> mark sent)"
```

---

### Task 4: `OutreachPanel` "Send now" UI + page wiring + CSS

**Files:**
- Modify: `src/app/(app)/leads/[id]/outreach-panel.tsx` (two props + Send control)
- Modify: `src/app/(app)/leads/[id]/page.tsx` (compute + pass props)
- Modify: `src/app/styles/components.css` (append `.outreach-send*` rules)
- Test: `tests/unit/components/outreach-panel.test.tsx` (extend)

**Interfaces:**
- Consumes: `sendOutreachAction` from `../actions` (Task 3); `isSendConfigured` from `@/lib/outreach/sender` + `primaryRecipientEmail` from `@/lib/outreach/schema` (in `page.tsx` only).
- Produces: `OutreachPanel` accepting `sendConfigured: boolean` and `recipientEmail: string | null` in addition to its existing props.

- [ ] **Step 1: Write the failing component tests** — extend `tests/unit/components/outreach-panel.test.tsx`. Add `sendOutreachAction: vi.fn()` to the existing `../actions` mock. Render helper must pass the two new props (default `sendConfigured: true`, `recipientEmail: "dana@acme.test"`). Add:

```ts
it("hides Send now unless status is drafted and mode is operator-handles", () => {
  render(<OutreachPanel {...base({ status: "pending" })} />);
  expect(screen.queryByRole("button", { name: /send now/i })).toBeNull();
  cleanup();
  render(<OutreachPanel {...base({ status: "drafted", mode: "handed_to_vendor" })} />);
  expect(screen.queryByRole("button", { name: /send now/i })).toBeNull();
});

it("shows Send now enabled when drafted + operator_handles + configured + recipient", () => {
  render(<OutreachPanel {...base({ status: "drafted", mode: "operator_handles" })} />);
  const btn = screen.getByRole("button", { name: /send now/i });
  expect(btn).toBeEnabled();
  expect(screen.getByText(/dana@acme\.test/)).toBeInTheDocument();
});

it("disables Send now with a hint when sending is not configured", () => {
  render(<OutreachPanel {...base({ status: "drafted", mode: "operator_handles", sendConfigured: false })} />);
  expect(screen.getByRole("button", { name: /send now/i })).toBeDisabled();
  expect(screen.getByText(/isn.t configured/i)).toBeInTheDocument();
});

it("disables Send now with a hint when there is no recipient email", () => {
  render(<OutreachPanel {...base({ status: "drafted", mode: "operator_handles", recipientEmail: null })} />);
  expect(screen.getByRole("button", { name: /send now/i })).toBeDisabled();
  expect(screen.getByText(/no email address on file/i)).toBeInTheDocument();
});

it("confirms before sending and refreshes on success", async () => {
  (sendOutreachAction as Mock).mockResolvedValue({ ok: true });
  render(<OutreachPanel {...base({ status: "drafted", mode: "operator_handles" })} />);
  fireEvent.click(screen.getByRole("button", { name: /send now/i }));
  expect(screen.getByText(/send to dana@acme\.test\?/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /confirm send/i }));
  await waitFor(() => expect(sendOutreachAction).toHaveBeenCalledWith("lead-1"));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});

it("cancel returns to idle without sending", () => {
  render(<OutreachPanel {...base({ status: "drafted", mode: "operator_handles" })} />);
  fireEvent.click(screen.getByRole("button", { name: /send now/i }));
  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(screen.queryByText(/send to dana@acme\.test\?/i)).toBeNull();
  expect(sendOutreachAction).not.toHaveBeenCalled();
});

it("shows an alert and does not refresh when send fails", async () => {
  (sendOutreachAction as Mock).mockResolvedValue({ ok: false, error: "Sending failed. Check the email provider configuration." });
  render(<OutreachPanel {...base({ status: "drafted", mode: "operator_handles" })} />);
  fireEvent.click(screen.getByRole("button", { name: /send now/i }));
  fireEvent.click(screen.getByRole("button", { name: /confirm send/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/sending failed/i);
  expect(refresh).not.toHaveBeenCalled();
});
```

Match the existing file's helpers (`base(overrides)` render-props factory, `refresh` navigation mock, imports of `render/screen/fireEvent/waitFor/cleanup`, `Mock`). If the existing file lacks a `base()` factory, add one that returns the full prop set with the two new props defaulted, and reuse it in the new tests. Use `leadId: "lead-1"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/outreach-panel.test.tsx`
Expected: FAIL — no Send-now button / props not accepted.

- [ ] **Step 3: Extend `OutreachPanel`** — add `sendOutreachAction` to the `../actions` import, add `useState` to the React import, add the two props, and render the Send control. Add the two props to the destructure and the type:

```ts
  sendConfigured,
  recipientEmail,
}: {
  leadId: string;
  mode: OutreachMode | null;
  status: OutreachStatus;
  draft: OutreachDraft | null;
  hasBrief: boolean;
  sendConfigured: boolean;
  recipientEmail: string | null;
})
```

Add local confirm state near the other hooks:

```ts
  const [confirming, setConfirming] = useState(false);
```

Render the Send control (place it just before the existing `canMarkSent`/"Mark as sent" block, so both live in the same status-controls area):

```tsx
{status === "drafted" && (mode === "operator_handles" || mode === null) && (
  <div className="outreach-send" role="group" aria-label="Send outreach email">
    {!confirming ? (
      <>
        <button
          type="button"
          className="btn btn-sm"
          disabled={pending || !sendConfigured || !recipientEmail}
          onClick={() => setConfirming(true)}
        >
          Send now
        </button>
        {sendConfigured && recipientEmail && (
          <p className="outreach-hint">To: {recipientEmail}</p>
        )}
        {!sendConfigured && (
          <p className="outreach-hint">Email sending isn’t configured.</p>
        )}
        {sendConfigured && !recipientEmail && (
          <p className="outreach-hint">No email address on file for this lead.</p>
        )}
      </>
    ) : (
      <>
        <p className="outreach-confirm">Send to {recipientEmail}?</p>
        <button
          type="button"
          className="btn btn-sm"
          disabled={pending}
          onClick={() => run(() => sendOutreachAction(leadId))}
        >
          Confirm send
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </>
    )}
  </div>
)}
```

(`run(fn)` is the existing helper — it clears the error, wraps in `startTransition`, and calls `router.refresh()` only when the action returns `{ ok: true }`, else sets the `role="alert"` error. On success the status becomes `sent`, the outer guard turns false, and the control unmounts — so `confirming` needs no manual reset on success.)

- [ ] **Step 4: Wire the page** — in `src/app/(app)/leads/[id]/page.tsx` add the imports:

```ts
import { isSendConfigured } from "@/lib/outreach/sender";
import { primaryRecipientEmail } from "@/lib/outreach/schema";
```

compute above the render (after `lead` is loaded and non-null):

```ts
  const sendConfigured = isSendConfigured();
  const recipientEmail = primaryRecipientEmail(lead.contactBlock);
```

and add the two props to the existing `<OutreachPanel .../>`:

```tsx
          sendConfigured={sendConfigured}
          recipientEmail={recipientEmail}
```

- [ ] **Step 5: Append CSS** — add to the end of `src/app/styles/components.css`:

```css
.outreach-send {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.outreach-hint,
.outreach-confirm {
  margin: 0;
  font-size: 0.875rem;
  color: var(--muted, #64748b);
}
.outreach-confirm {
  font-weight: 600;
  color: inherit;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/outreach-panel.test.tsx`
Expected: PASS — existing tests plus the 7 new Send-now tests.

- [ ] **Step 7: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 0 type errors; `next build` compiles all routes (if a stale `.next` causes a `PageNotFoundError` during page-data collection, `rm -rf .next` and rebuild — that error is a cache artifact, not a code fault).

- [ ] **Step 8: Commit**

```bash
git add src/app/(app)/leads/[id]/outreach-panel.tsx src/app/(app)/leads/[id]/page.tsx src/app/styles/components.css tests/unit/components/outreach-panel.test.tsx
git commit -m "feat(outreach): Send now control with inline confirm + page wiring"
```

---

## Self-Review

**Spec coverage:** sender adapter (T2) ✓; recipient helper (T1) ✓; `sendOutreachAction` with all 8 guard/success branches (T3) ✓; Send-now UI + confirm + page wiring (T4) ✓; env vars + dep + `.env.example` (T1) ✓; all-mocked tests, no real send ✓.

**Placeholder scan:** every code step contains complete code. The only "follow the established pattern" instruction is the Task 3 integration seed helper — deliberate, because the seed boilerplate already exists verbatim in `tests/integration/outreach-actions.test.ts` and must match it.

**Type consistency:** `SendResult`/`sendEmail`/`isSendConfigured` (T2) match their uses in the action (T3); `primaryRecipientEmail(ContactBlock | null)` (T1) matches its uses in the action (T3) and page (T4); the two new `OutreachPanel` props (T4) match the page's passed props; the action return shape `{ ok, error? }` matches the component's `run()` contract. `env.RESEND_API_KEY`/`OUTREACH_FROM_EMAIL` (T1) match the sender's reads (T2).
