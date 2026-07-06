# Campaigns UI Redesign + Shared UI Kit — Design

**Date:** 2026-07-07
**Status:** Approved (operator approved the interactive mockup, v6)
**Mockup (reference):** the approved hi-fi artifact — radar's real slate tokens, four interactive views (Campaigns list · Detail · New · Kit). Every decision below is visible there.

---

## 1. Context & goal

radar's sections are functional but thin: little information per component, no score visualization, no filters/search/sort, no account surfaces, and data-entry gaps (a vendor can't even have its `vendorType` set from the UI). This is the first cycle of an **app-wide UI/UX overhaul**, run **section by section, mockup-first**. It does two things at once:

1. Establishes a **shared UI kit** (score-heat meters, filter/search/sort, stat tiles, context rails, modern form controls) — the reusable language every later section inherits.
2. Redesigns the **Campaigns** section as the proving ground, upgrading the thin version shipped in Plan 2 (`docs/superpowers/plans/2026-07-07-campaigns-ui.md`).

**Design ambition (operator-chosen): Hybrid.** Keep radar's existing 3-theme token foundation (`src/app/styles/tokens.css` — slate default), and deliver real visual lift on the data-heavy surfaces (tables, scores, detail pages, forms). Not a from-scratch visual language; an evolution with teeth.

**Scope of THIS spec:** the shared kit + the Campaigns section (list, detail, new) + the shell changes it needs. **Vendors** (the vendor-type editor + full profile management), Leads, Pipeline, Dashboard, Contacts, Signals, Mappings, Catalogue, and the account surfaces (Profile, password — DB-backed credential) are **follow-on specs** that reuse this kit.

## 2. Design language — the shared kit (build once, reuse everywhere)

All components live in radar's existing token system and both light/dark modes. Ground rules verified in the mockup:

**2.1 Score-heat meter (the signature primitive).** Scores stop being bare numbers. A `<ScoreMeter value={0..100} />` renders a number + a filled bar whose **fill color comes from radar's strength ramp** (`--strength-*` / the mockup's `--heat-1..4`), temperature read cool→hot: `<25` → `--heat-1` (grey-blue), `<50` → `--heat-2` (blue), `<75` → `--heat-3` (amber), `≥75` → `--heat-4` (red = strong). Sizes: default, `sm` (table cells). Used for lead scores, campaign yield %, min-score previews.

**2.2 Status pills.** `campaign_status` → pill color: `done` → `--status-approved` (green), `running` → `--status-proposed` (amber) with a **pulsing dot** (respect `prefers-reduced-motion`), `queued` → `--status-retired` (grey), `failed` → `--attention` (red). A leading dot encodes state in form, not just text. Plus source tags: `live` (accent) / `test` (neutral). Extends the existing `.badge-*` rules (Plan 2 added `badge-done/running/queued/failed`).

**2.3 Stat tile.** A KPI card: mono uppercase label, large mono numeral (tabular-nums), a delta (up=success / down=attention), and an **inline sparkline** (a small SVG area+line+endpoint drawn from a data array). Grid of 4, reflow to 2 then 1.

**2.4 Command bar** — search input (magnifier, live filter) + **filter chips** (status: All/Done/Running/Failed) + **segmented control** (source: All/Live/Test). Chips show active state; segmented is a compact exclusive toggle.

**2.5 Data table.** Dense, sortable (click header → asc/desc arrow), tabular-nums numeric columns, hover row, whole-row click → detail, an optional **bulk-select checkbox column** (header select-all → a bulk action bar appears: Re-run / Export / Dismiss). Wrapped in an `overflow-x:auto` container (never scrolls the page body); `min-width` so it scrolls on narrow.

**2.6 Context-rail layout.** The core page shape: `grid: minmax(0,1fr) ~316px` — **main content + a sticky right context rail** of small panels. Fills wide screens with real information (not blank space) and is the consistent structure across all three views. Collapses below ~1180px (rail panels reflow to a row / stack), and the whole thing goes single-column on mobile.

**2.7 Modern form controls (consistency is the point).**
- **Selects:** `appearance:none` + a custom inline-SVG chevron + a fixed height, so they render identically and never show the OS-native focus ring. (This was the "distorted company-size" bug.)
- **Focus:** one clean **soft-halo** on every control — `border-color:accent` + `box-shadow:0 0 0 3px` a translucent accent — no offset double-border. Applied to inputs, selects, search uniformly.
- **Toggle-row:** a bordered card — bold label + a helper line on the left, a switch on the right (not a cramped inline checkbox).
- **Field pairs (`.f2`):** two side-by-side fields must use `align-items:start` so the grid never stretches a borderless cell taller and mis-aligns its input. (This was the label→input spacing bug.)
- Segmented controls, filter chips, sliders (target), range/stepper.

**2.8 Radial gauge.** A small SVG donut for the credit budget (used/total), accent arc on an inset track.

**2.9 Supporting primitives.** Buttons (`.btn`/`.btn-primary`/`.btn-sm`) with **inline-SVG icons** (never unicode glyphs — that was the "junky Actions buttons" fix); key/value list (`.kv`) for detail metadata; readiness banner (ok/warn); empty state; page header (eyebrow + h1 + sub).

## 3. Shell changes

- **Brand: "radar"** only (a small radar-beam mark + wordmark). Drop the "ops radar" subtitle — radar is the general platform; ops-infra is just the first vendor context. Files: `src/app/components/shell/rail.tsx`.
- **Topbar:** a **global search / ⌘K** command entry (search vendors, leads, companies), a notifications icon, and the light/dark toggle. Frees the topbar of the redundant per-page "New Campaign" button (that CTA lives in the page header only).
- **Rail:** Campaigns already added (Plan 2). Icons stay clean line-SVGs.

## 4. The three Campaigns views

### 4.1 Campaigns — list (`/campaigns`)
Page header ("Campaigns" + sub) with the single **New Campaign** CTA. Then the context-rail layout:
- **Main:** a 4-tile **KPI row** (Campaigns 30d, Leads sourced, Companies scanned, Avg yield — each with sparkline + delta) → the **command bar** (search + status chips + source segmented) → the **campaigns table** with bulk-select. Columns: Campaign (label + vendor sub), Source (live/test tag), Status (pill), Companies, Leads, **Yield** (score-heat meter = leads/companies), Credits (money color), Run (relative time). Sortable; row → detail. Truly-empty → `<EmptyState>`.
- **Context rail:** **Credit budget** (radial gauge, used/total) · **Quick views** (Live runs / Failed-retry / High-yield ≥40% / All — each drives the table's filters) · **Needs attention** (running/failed/queued runs with pills).

### 4.2 Campaign — detail (`/campaigns/[id]`)
Header (label + status pill + source tag). Context-rail layout:
- **Main:** 4 **stat tiles** (companies fetched, observations, leads created +Δnew, credits) → "Leads surfaced" header with a By-score / New-only segmented → the **surfaced-leads table** (Company + domain, Signals, Funding, Headcount, **Score** meter, State new/updated tag, Open→). Grounding note.
- **Context rail:** **Actions** (Re-run · Export CSV · Add all to pipeline · Dismiss — SVG-iconed, left-aligned) · **Run details** (the config as a `.kv` list: vendor, geo, target, funded window, mapping, source, duration, when) · **Yield** (best lead + score meter, avg score, new/updated split, pursue-≥60 count).

### 4.3 New campaign (`/campaigns/new` or a route/modal)
Page header. Context-rail layout:
- **Main = a sectioned, compact 2-column form** (`.f2` pairs so it fits ~one screen, no tall scroll):
  - **Target:** Vendor (select) + **readiness gate** (ready / "needs a type + mapping" — disables submit); paired Geography · Company size.
  - **Scope:** Target (slider + value) · **Funded within** granular chips (1 / 2 / 3 / 6 / 12 / 24 mo).
  - **Filters:** Funding round type (chips: Any/Seed/A/B/C+) · Industries (chips, optional) · paired Min lead score · Sort results by · a **toggle-row** "Exclude leads I've already seen".
  - **Source:** Live (Crustdata) / Test segmented + an Advanced disclosure (enrich top-N · mappings).
  - Full-width **Find Leads** submit.
- **Context rail:** **Vendor snapshot** (avatar, name, type · profile version, capabilities, readiness, approved mappings — reacts live to the vendor picker; a no-type vendor shows "No approved mappings yet") · **Recent runs · this vendor** (last campaigns + yield) · **Estimate** (a live "what this will do" — companies/window/vendor, the signal families it will hunt, est. cost / runtime / expected leads / lands-in).

## 5. Responsiveness (top priority — verified in the mockup)

- **>1180px:** rail (232px) + main + context rail (3 regions).
- **≤1180px:** context rail reflows to a wrapping row / stacks under main.
- **≤1080px:** stat grid → 2 columns; new-campaign form → single column; sticky panels un-stick.
- **≤820px:** left rail collapses to a slim top strip (brand + horizontally-scrollable nav; foot/groups hidden); global search hidden.
- **≤560px:** stats → 2-up; `.f2` pairs → single column; tighter headers.
- Tables always live in an `overflow-x:auto` wrapper; the page body never scrolls sideways.

## 6. Backend reality (what the redesigned form outruns)

The new-campaign form exposes more parameters than the current backend consumes. Today: `CompanyQuery = { geography, target, fundedSinceDays, signalFamilies }` and `runCampaignForVendor(db, { vendorId, source, geography, target })`.
- **Wired now (backend already supports):** vendor, geography, target, source, and **Funded within** → `fundedSinceDays` (the sourcing plan already computes a funded-since window; the form's chip should override/feed it).
- **New parameters to persist + phase in:** funding round type, company size, industries, min lead score, sort, exclude-already-seen, enrich-top-N, explicit mapping selection. **Decision for the plan:** persist the full form into `campaigns.config` now (so nothing is lost and the UI is complete), wire the supported ones into the run, and treat the rest as **forward-looking** — either applied by small backend extensions in the same plan (round-type/size/exclude-seen are cheap Crustdata-filter / post-filter additions) or clearly marked and deferred. The implementation plan will decide per-parameter which land in this cycle vs. a fast-follow, and must not ship a control that silently does nothing without a "soon" affordance.

## 7. Files this touches (upgrade, not greenfield)

Plan 2 shipped thin versions; this redesign upgrades them and adds the kit:
- **Kit (new):** small components under `src/app/components/ui/` — `ScoreMeter`, `StatTile` (+ sparkline), `DataTable` (sortable/bulk), `FilterChips`, `CommandBar`, `ContextRail`, `Gauge`, `ToggleRow`, `KvList`, and shared CSS (score-heat, form-control normalization, context-rail layout, toggle-row) in `src/app/styles/`.
- **Shell:** `rail.tsx` (brand), `topbar.tsx` (global search/notifications), `nav-icon.tsx`.
- **Campaigns:** `campaigns/page.tsx`, `campaign-list.tsx`, `campaigns/[campaignId]/page.tsx`, `campaigns/new/*`, `find-leads-panel.tsx`, `actions.ts` (extend `findLeadsAction` for the new config), and `src/lib/campaigns/*` for any backend parameter support chosen in §6.
- **Tests:** component tests (`tests/unit/components/`) for the new primitives + the views; extend the Plan-2 campaign action/data tests.

## 8. Non-goals / follow-on

- Vendors redesign (with the real **vendorType editor** + full profile management) — next spec, reusing this kit. It's the highest-priority follow-on (the gap that started this).
- Account surfaces (Profile, preferences, DB-backed credential + password reset) — a later spec; requires a small auth/credential migration.
- Global-search (⌘K) backend, saved views, bulk-action backends — designed here, wired incrementally.

## 9. Testing strategy

- **Primitives:** jsdom component tests — `ScoreMeter` (fill %/heat color per value bucket, incl. boundary 25/50/75), status pills, sortable table (sort toggles, bulk-select bar), toggle-row, gauge, form-control focus consistency.
- **Views:** the list/detail/new render tests (filters/search/sort behavior, readiness gate reacting to vendor, empty states).
- **Actions/data:** extend the existing `campaigns-action`/`campaigns-data` integration tests for the enriched `config` and any wired parameters.
- Responsiveness is validated visually against the approved mockup; a couple of layout assertions where cheap.
