# Home & Login Pages — Design Spec

**Date:** 2026-07-06
**Status:** Approved (pending spec review)
**Scope:** Redesign the two remaining unstyled placeholder routes — `/` (home) and `/login` — to match the established Radar design system. Presentation + thin routing only; **no auth backend changes**.

---

## 1. Problem

Every real screen in Radar (dashboard, leads, pipeline, vendors, signals, mappings…) is built against the design system in `src/app/styles/` (three themes × light/dark, full token set). The only exceptions are the two public routes, which are bare placeholders:

- `src/app/page.tsx` — `<h1>Radar</h1>` + a one-line tagline. No styling.
- `src/app/login/page.tsx` + `login-form.tsx` — an unstyled email/password form.

They must be brought up to the same visual standard and made to feel like one product family.

## 2. Locked decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Auth model** | **Login only — no sign-up** | App is single-operator: NextAuth Credentials verifying one bcrypt `OPERATOR_PASSWORD_HASH`. No users table, no registration. Building sign-up would contradict the architecture. |
| **Home role** | **Landing + smart forward** | Signed-out visitors see a branded hero with a "Sign in" CTA; signed-in operators are auto-forwarded to `/dashboard` so `/` never wastes their time. |
| **Visual mood** | **Precision instrument — slate / light** | The app's default theme (`data-theme="slate" data-mode="light"`). Keeps the public pages consistent with the app the operator enters — no jarring mode-switch on sign-in. |

## 3. Non-goals (YAGNI)

- No sign-up / registration / password reset / "request access" flow.
- No changes to `authenticate`, `signIn`, `verifyOperator`, `authConfig`, `PUBLIC_PATHS`, or middleware.
- No theme switcher on these pages (they render in the default slate/light).
- No new runtime dependencies.

## 4. Architecture

Purely presentational components + two thin server-side redirect guards. Auth stays exactly as-is.

### 4.1 Routing & guards

- **`/` — `HomePage` (server component)**
  `const session = await auth();` → if `session?.user` then `redirect("/dashboard")`; else render `<LandingHero />`. Remains in `PUBLIC_PATHS`.
- **`/login` — `LoginPage` (server component)**
  Same guard: if `session?.user` then `redirect("/dashboard")` (an authenticated operator never sees the form); else render the branded shell wrapping the existing `<LoginForm />`. Remains in `PUBLIC_PATHS`.
- **Login submit** unchanged — `authenticate` already calls `signIn("credentials", { …, redirectTo: "/dashboard" })`, consistent with both guards.

### 4.2 Component boundaries

| Unit | Type | Responsibility | Depends on |
|------|------|----------------|------------|
| `LandingHero` (`src/app/landing-hero.tsx`) | presentational (server-renderable) | The hero markup: wordmark, headline, subcopy, "Sign in" CTA link, capability strip | tokens/CSS only — **no auth import** (so it render-tests cleanly) |
| `HomePage` (`src/app/page.tsx`) | server component | `auth()` guard + compose `<LandingHero />` | `@/lib/auth`, `next/navigation`, `LandingHero` |
| `LoginPage` (`src/app/login/page.tsx`) | server component | `auth()` guard + branded shell (wordmark) + `<LoginForm />` | `@/lib/auth`, `next/navigation`, `LoginForm` |
| `LoginForm` (`src/app/login/login-form.tsx`) | client component | **Existing logic preserved**; markup/classes restructured for the card | `useActionState`, `./actions` |

Keeping the hero auth-free is the key isolation call: the visual surface is testable without mocking NextAuth, and the server components stay one-liners (guard + compose).

## 5. Visual design (slate / light, tokens-driven)

### 5.1 Home — `LandingHero`

Single centered editorial column on `--canvas`, `max-width ~640px`, generous vertical rhythm (`--space-*`). 375px-first, scaling up.

```
        ◆ RADAR                       wordmark — mono, --tracking-caps, small inline-SVG signal glyph
                                       
   Lead intelligence,                 headline — --text-3xl, --tracking-tight, --weight-semibold
   from signal to signed.
                                       
   Source, qualify, and close         subcopy — --text-lg, --text-muted, --leading-normal
   vendor deals from one workspace.

   [ Sign in → ]                      primary CTA — <Link href="/login"> styled .btn .btn-primary

   ── Source · Qualify · Close ──      capability strip — mono micro-labels (--text-2xs, --tracking-caps, --text-faint)
```

- **Copy (approved):** headline `Lead intelligence, from signal to signed.`; subcopy `Source, qualify, and close vendor deals from one workspace.`; capability strip `Source · Qualify · Close`.
- The wordmark glyph is a small inline SVG (concentric radar arcs / a signal dot) — self-contained, no asset dependency.

### 5.2 Login — branded auth card

Centered card on `--canvas`; the same `◆ RADAR` wordmark sits above the card so home and login read as one family.

```
              ◆ RADAR                       shared wordmark

     ┌─────────────────────────────┐        .auth-card — --surface, --border,
     │  Operator sign in           │        --radius-lg, --shadow-md, padded
     │  Enter your credentials.    │        title --text-xl / subcopy --text-sm --text-muted
     │                             │
     │  Email                      │        label above input
     │  [_______________________]  │        full-width input, visible --focus-ring
     │  Password                   │
     │  [_______________________]  │
     │                             │
     │  [    Sign in →           ] │        .btn .btn-primary, full-width, disabled while pending
     │  ⚠ Invalid email or password│        role="alert", --attention, only on error
     └─────────────────────────────┘
              ← Back to home                 .btn-quiet link to /
```

- **Preserved form behavior:** `useActionState(authenticate, undefined)`; fields keep `type`, `name`, `required`, `autoComplete` (`username` / `current-password`), password `minLength={1}`; submit `disabled={isPending}` with `"Signing in…"` label; error rendered in `role="alert"`.
- Only markup structure and class names change.

### 5.3 Styles

- New isolated stylesheet **`src/app/styles/auth.css`**, imported in `src/app/layout.tsx` immediately after `components.css`.
- Holds `.landing`, `.landing-*`, `.auth-*` classes. All values reference existing tokens; buttons reuse the existing `.btn` family. **No edits to existing CSS files.**
- Inputs get a shared field style (surface bg, `--border`, `--radius-md`, `--focus-ring` on `:focus-visible`), sized for 375px-first.

## 6. Accessibility & responsive

- Semantic structure: `<main>` per page; hero content in a `<section>`; login form fields with real `<label>`s wrapping/associated to inputs.
- Every interactive element keyboard-navigable with a visible focus ring (tokens already define `--focus-ring`); CTA and links are real `<a>`/`<Link>`/`<button>`.
- Mobile-first at 375px, verified to reflow cleanly to 768px and 1280px.
- Honors `prefers-reduced-motion` (tokens already zero motion durations under the media query).
- No images beyond the inline-SVG wordmark glyph, which is decorative (`aria-hidden`) with the visible "RADAR" text as the accessible name.

## 7. Testing

| Test | File | Asserts |
|------|------|---------|
| Landing hero renders | `tests/unit/components/landing-hero.test.tsx` (jsdom) | Wordmark "RADAR" present; headline text present; a "Sign in" link with `href="/login"`. |
| Login form accessibility & error | `tests/unit/components/login-form.test.tsx` (jsdom) | Email + password resolve via `getByLabelText`; submit button present; on a mocked failing action, message appears in `role="alert"`. |

Redirect guards (`auth()` → `redirect("/dashboard")`) are thin framework glue; they are verified via `npm run build` (routes compile, `/` and `/login` still static/public) and by driving the flow with the `verify` skill, not by unit-testing Next's `redirect`.

## 8. Verification checklist

- `npx vitest run` on the two new/updated test files — green.
- `npx tsc --noEmit` — clean.
- `rm -rf .next && npm run build` — succeeds; route count unchanged; `/` and `/login` remain public.
- Manual/`verify`: signed-out `/` shows the hero → "Sign in" → `/login` → valid creds → `/dashboard`; signed-in `/` and `/login` forward to `/dashboard`; invalid creds show the inline alert.
- Full suite `npm test` — no regressions.

## 9. Self-review

- **Placeholders:** none — every section is concrete; copy is finalized in §5.1.
- **Consistency:** auth model (§2) ⇄ non-goals (§3) ⇄ guards (§4.1) agree — login-only, no sign-up, no backend edits. Visual mood (slate/light) consistent across home, login, and the app the operator enters.
- **Scope:** two pages + one stylesheet + two tests + two thin guards — a single, small implementation plan.
- **Ambiguity:** "smart forward" is pinned to `redirect("/dashboard")` on `session?.user`; login retains its own success `redirectTo: "/dashboard"`.
