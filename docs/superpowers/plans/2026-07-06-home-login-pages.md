# Home & Login Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the two unstyled placeholder routes — `/` (home) and `/login` — to match the Radar design system, with a branded landing hero that smart-forwards signed-in operators and a properly styled operator sign-in card.

**Architecture:** Purely presentational components + two thin server-side `auth()`→`redirect` guards. A shared `Wordmark` component and an isolated `auth.css` stylesheet. No auth backend changes; the existing `authenticate`/`signIn`/`verifyOperator` logic is untouched.

**Tech Stack:** Next.js App Router (server + client components), React 19 (`useActionState`), NextAuth (`auth` from `@/lib/auth`), Vitest + Testing Library (jsdom), CSS custom properties (design tokens).

## Global Constraints

- **Visual identity:** default `data-theme="slate" data-mode="light"` (set on `<html>` in `layout.tsx`); use design tokens only — no hard-coded colors, spacing, or type sizes.
- **Auth model:** single-operator; **no sign-up / registration**. Do NOT modify `authenticate`, `signIn`, `verifyOperator`, `authConfig`, `PUBLIC_PATHS`, or middleware.
- **Reuse existing primitives:** button classes `.btn` / `.btn-primary` / `.btn-quiet` (in `components.css`); do not redefine them.
- **Copy (verbatim):** headline `Lead intelligence, from signal to signed.`; subcopy `Source, qualify, and close vendor deals from one workspace.`; capability strip `Source · Qualify · Close`; login title `Operator sign in`; login subcopy `Enter your credentials to continue.`
- **Accessibility:** semantic HTML, every input labeled, visible `--focus-ring` on focus, keyboard-navigable, 375px-first responsive, decorative SVGs `aria-hidden`.
- **Forward target:** signed-in visitors to `/` and `/login` are `redirect("/dashboard")`.
- **Tests:** jsdom component tests live in `tests/unit/components/`; stub `next/link` to a plain anchor (as `tests/unit/components/leads-list.test.tsx` does).

---

### Task 1: Home — Wordmark, LandingHero, guard, landing styles

**Files:**
- Create: `src/app/components/ui/wordmark.tsx`
- Create: `src/app/landing-hero.tsx`
- Create: `src/app/styles/auth.css`
- Modify: `src/app/layout.tsx` (import `auth.css` after `components.css`)
- Modify: `src/app/page.tsx` (async `auth()` guard + render `<LandingHero />`)
- Delete: `tests/unit/home.test.tsx` (asserts the old sync placeholder; invalid once `HomePage` is async)
- Test: `tests/unit/components/landing-hero.test.tsx`

**Interfaces:**
- Consumes: `next/link`, design tokens, `auth` from `@/lib/auth`, `redirect` from `next/navigation`.
- Produces (Task 2 consumes `Wordmark`):
  - `Wordmark({ className?: string }): JSX.Element` — inline-SVG glyph + "RADAR" text.
  - `LandingHero(): JSX.Element` — presentational hero, no auth import.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/landing-hero.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// next/link needs the app-router context at runtime; stub it to a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { LandingHero } from "@/app/landing-hero";

describe("LandingHero", () => {
  it("renders the wordmark and headline", () => {
    render(<LandingHero />);
    expect(screen.getByText("RADAR")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /from signal to signed/i })).toBeInTheDocument();
  });

  it("has a Sign in link pointing to /login", () => {
    render(<LandingHero />);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/landing-hero.test.tsx`
Expected: FAIL — `Cannot find module '@/app/landing-hero'`.

- [ ] **Step 3: Create the Wordmark component**

Create `src/app/components/ui/wordmark.tsx`:

```tsx
// The Radar wordmark: a decorative inline-SVG signal glyph + the "RADAR" text.
// The glyph is aria-hidden; the visible text carries the accessible name.
// Shared by the landing hero and the login shell so both read as one family.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `wordmark ${className}` : "wordmark"}>
      <svg className="wordmark-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="1.5" fill="currentColor" />
        <path d="M8 5.5a2.5 2.5 0 0 1 2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M8 3a5 5 0 0 1 5 5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.55" />
      </svg>
      RADAR
    </span>
  );
}
```

- [ ] **Step 4: Create the LandingHero component**

Create `src/app/landing-hero.tsx`:

```tsx
import Link from "next/link";
import { Wordmark } from "./components/ui/wordmark";

// Public marketing surface for signed-out visitors. Purely presentational —
// no auth import — so it render-tests without the NextAuth runtime.
export function LandingHero() {
  return (
    <main className="landing">
      <section className="landing-inner" aria-labelledby="landing-headline">
        <Wordmark className="landing-wordmark" />
        <h1 id="landing-headline" className="landing-headline">
          Lead intelligence,
          <br />
          from signal to signed.
        </h1>
        <p className="landing-subcopy">Source, qualify, and close vendor deals from one workspace.</p>
        <Link href="/login" className="btn btn-primary landing-cta">
          Sign in
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <ul className="landing-capabilities" aria-label="What Radar does">
          <li>Source</li>
          <li>Qualify</li>
          <li>Close</li>
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/landing-hero.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Create the auth stylesheet (landing rules) and import it**

Create `src/app/styles/auth.css`:

```css
/* ============================================================================
   Radar — Auth & landing surfaces (home + login)
   Public pages, rendered in the default slate/light identity. Tokens only.
   ========================================================================== */

/* ---- Landing (home) ------------------------------------------------------ */
.landing {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: var(--space-6) var(--space-5);
  background: var(--canvas);
}
.landing-inner {
  width: 100%;
  max-width: 40rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-5);
}
.wordmark {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text);
}
.wordmark-glyph {
  width: 16px;
  height: 16px;
  color: var(--accent);
}
.landing-headline {
  margin: 0;
  font-size: var(--text-3xl);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  font-weight: var(--weight-semibold);
  color: var(--text);
}
.landing-subcopy {
  margin: 0;
  font-size: var(--text-lg);
  line-height: var(--leading-normal);
  color: var(--text-muted);
  max-width: 32rem;
}
.landing-cta {
  align-self: flex-start;
  margin-top: var(--space-1);
}
.landing-capabilities {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: var(--space-4) 0 0;
  border-top: var(--border-w) solid var(--border);
  width: 100%;
  display: flex;
  gap: var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-faint);
}
```

Then modify `src/app/layout.tsx` — add the import immediately after the `components.css` import:

```tsx
import "./styles/components.css";
import "./styles/auth.css";
import "./styles/v2.css";
import "./styles/command.css";
```

- [ ] **Step 7: Wire the home page guard and delete the stale home test**

Replace the entire contents of `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LandingHero } from "./landing-hero";

export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  return <LandingHero />;
}
```

Delete the stale test (it calls `HomePage()` synchronously; invalid now that it is async):

```bash
git rm tests/unit/home.test.tsx
```

- [ ] **Step 8: Verify types, tests, and build**

Run: `npx vitest run tests/unit/components/landing-hero.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean (exit 0)
Run: `rm -rf .next && npm run build` → succeeds; `/` still listed (static `○`).

- [ ] **Step 9: Commit**

```bash
git add src/app/components/ui/wordmark.tsx src/app/landing-hero.tsx src/app/styles/auth.css src/app/layout.tsx src/app/page.tsx tests/unit/components/landing-hero.test.tsx tests/unit/home.test.tsx
git commit -m "feat(home): branded landing hero with smart-forward to dashboard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Login — restyled form, guarded page shell, auth-card styles

**Files:**
- Modify: `src/app/login/login-form.tsx` (restructure markup; **preserve all logic**)
- Modify: `src/app/login/page.tsx` (async `auth()` guard + wordmark shell + card)
- Modify: `src/app/styles/auth.css` (append auth-card rules)
- Test: `tests/unit/components/login-form.test.tsx`

**Interfaces:**
- Consumes: `Wordmark` from `@/app/components/ui/wordmark` (Task 1), `authenticate` from `./actions`, `auth` from `@/lib/auth`, `redirect` from `next/navigation`, `Link` from `next/link`.
- Produces: none (leaf pages).

**Note on TDD here:** the form's behavior (labeled fields, error alert) is *preserved* through a markup restyle, so this test characterizes existing behavior and will pass against the current form — it is a regression guard for the restructure, not new behavior. Write it first, confirm it is green on the current form, then restyle keeping it green.

- [ ] **Step 1: Write the characterization test**

Create `tests/unit/components/login-form.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the server action by its resolved path (@ = src/) so login-form's
// relative `./actions` import is intercepted — avoids loading NextAuth/bcrypt.
vi.mock("@/app/login/actions", () => ({
  authenticate: vi.fn(async () => "Invalid email or password."),
}));

import { LoginForm } from "@/app/login/login-form";

describe("LoginForm", () => {
  it("renders labeled email and password fields and a submit button", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("surfaces the action's error message in an alert", async () => {
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "op@test.com");
    await userEvent.type(screen.getByLabelText(/password/i), "secret");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid email or password/i);
  });
});
```

- [ ] **Step 2: Run the test to establish the baseline**

Run: `npx vitest run tests/unit/components/login-form.test.tsx`
Expected: PASS (2 tests) against the current form — this is the a11y/behavior baseline the restyle must preserve. (If the error-alert test fails to trigger the action via click in this environment, replace the click line with `fireEvent.submit(screen.getByRole("button", { name: /sign in/i }).closest("form")!)` and import `fireEvent`.)

- [ ] **Step 3: Restyle the login form (preserve all logic)**

Replace the entire contents of `src/app/login/login-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { authenticate } from "./actions";

export function LoginForm() {
  const [errorMessage, formAction, isPending] = useActionState(authenticate, undefined);

  return (
    <form action={formAction} className="auth-form">
      <label className="auth-field">
        <span className="auth-label">Email</span>
        <input
          className="auth-input"
          type="email"
          name="email"
          required
          autoComplete="username"
          placeholder="operator@radar.app"
        />
      </label>
      <label className="auth-field">
        <span className="auth-label">Password</span>
        <input
          className="auth-input"
          type="password"
          name="password"
          required
          autoComplete="current-password"
          minLength={1}
        />
      </label>
      <button type="submit" className="btn btn-primary auth-submit" disabled={isPending}>
        {isPending ? "Signing in…" : "Sign in"}
      </button>
      {errorMessage && (
        <p role="alert" className="auth-error">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Run the test to verify it stays green**

Run: `npx vitest run tests/unit/components/login-form.test.tsx`
Expected: PASS (2 tests) — behavior preserved through the restyle.

- [ ] **Step 5: Wire the login page guard and branded shell**

Replace the entire contents of `src/app/login/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Wordmark } from "@/app/components/ui/wordmark";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Radar" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="auth">
      <div className="auth-shell">
        <Wordmark className="auth-wordmark" />
        <div className="auth-card">
          <h1 className="auth-title">Operator sign in</h1>
          <p className="auth-subcopy">Enter your credentials to continue.</p>
          <LoginForm />
        </div>
        <Link href="/" className="btn-quiet auth-back">
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Append the auth-card styles**

Append to `src/app/styles/auth.css`:

```css

/* ---- Login (auth card) --------------------------------------------------- */
.auth {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: var(--space-6) var(--space-5);
  background: var(--canvas);
}
.auth-shell {
  width: 100%;
  max-width: 22rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}
.auth-card {
  width: 100%;
  padding: var(--space-6);
  background: var(--surface);
  border: var(--border-w) solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.auth-title {
  margin: 0;
  font-size: var(--text-xl);
  letter-spacing: var(--tracking-tight);
  color: var(--text);
}
.auth-subcopy {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.auth-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.auth-label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text);
}
.auth-input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-md);
  color: var(--text);
  background: var(--surface);
  border: var(--border-w) solid var(--border-strong);
  border-radius: var(--radius-md);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast);
}
.auth-input:focus-visible {
  outline: none;
  border-color: var(--focus-ring);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.auth-submit {
  width: 100%;
  margin-top: var(--space-1);
}
.auth-error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--attention);
}
.auth-back {
  font-size: var(--text-sm);
}
```

- [ ] **Step 7: Verify types, full suite, and build**

Run: `npx vitest run tests/unit/components/login-form.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean (exit 0)
Run: `rm -rf .next && npm run build` → succeeds; `/login` still listed (static `○`).
Run: `npm test` → full suite green, no regressions (confirms the deleted `home.test.tsx` and new tests are consistent).

- [ ] **Step 8: Commit**

```bash
git add src/app/login/login-form.tsx src/app/login/page.tsx src/app/styles/auth.css tests/unit/components/login-form.test.tsx
git commit -m "feat(login): branded operator sign-in card + guard for authed visitors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (against `2026-07-06-home-login-pages-design.md`):
- §4.1 routing/guards → Task 1 Step 7 (home guard), Task 2 Step 5 (login guard). ✅
- §4.2 component boundaries (`Wordmark`, `LandingHero`, `HomePage`, `LoginPage`, `LoginForm`) → Task 1 Steps 3/4/7, Task 2 Steps 3/5. ✅
- §5.1 landing visual/copy → Task 1 Steps 4 & 6 (copy verbatim, tokens). ✅
- §5.2 login card + preserved behavior → Task 2 Steps 3/5/6. ✅
- §5.3 isolated `auth.css` imported after `components.css`, no edits to existing CSS → Task 1 Step 6, Task 2 Step 6. ✅
- §6 a11y/responsive → semantic tags, labeled inputs, `:focus-visible` ring, `100dvh`/`max-width` layouts, `aria-hidden` glyphs across both tasks. ✅
- §7 testing (`landing-hero.test.tsx`, `login-form.test.tsx`) → Task 1 Step 1, Task 2 Step 1. ✅
- §8 verification (vitest, tsc, build, full suite) → Task 1 Step 8, Task 2 Step 7. ✅
- **Extra gap caught:** the stale `tests/unit/home.test.tsx` breaks once `HomePage` is async → handled in Task 1 Step 7 (`git rm`).

**Placeholder scan:** none — every code step is complete; copy is verbatim from Global Constraints.

**Type consistency:** `Wordmark({ className?: string })` defined in Task 1 Step 3 and consumed in Task 2 Step 5 with the `className` prop. `LandingHero()` (Task 1 Step 4) consumed in `page.tsx` (Step 7). `LoginForm()` signature unchanged (Task 2 Step 3) and consumed in `page.tsx` (Step 5). CSS class names (`.landing*`, `.wordmark*`, `.auth*`) defined in `auth.css` match those referenced in the components. `redirect("/dashboard")` target consistent across both guards and the existing `signIn` `redirectTo`.
