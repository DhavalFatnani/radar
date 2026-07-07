# Vendors Redesign — Design

**Date:** 2026-07-07
**Status:** Approved (operator approved the hi-fi mockup — list · exhaustive profile · new-vendor, radar's real slate tokens)
**Mockup (reference):** the approved hi-fi artifact — three interactive views (Vendors list · Vendor profile view/edit · New vendor) with the `vendorType` combobox + live readiness hint, in both light and dark.

---

## 1. Context & goal

Vendors is the section the whole app builds on — every campaign sources *for a vendor*, and sourcing keys entirely off a vendor's **`vendorType`**. Yet today the section is the thinnest surface in radar and has a functional dead end:

- **`vendorType` cannot be set anywhere in the UI.** It's free text on the table, written only by the DB seed; it's absent from the app `VendorProfile` type, `getVendor`, every form, every schema, and every write path. So **any vendor created through the UI has `vendorType = null` and can never become sourcing-runnable** (readiness matches a vendor's type to `mappings.serves_vendor_type`; `null` matches nothing). This is the gap that started the whole overhaul (campaigns redesign spec §8 names it the highest-priority follow-on).
- The **list shows name only** — no type, no readiness, no version.
- The **detail page has no read-only profile view** — every field is a raw always-on edit form; `vendorType` isn't shown at all. Rich data that already exists — the interview transcripts, the per-version changelog (`interviewHistory`), the vendor's campaigns — is invisible.
- The `signalRecipe` jsonb column is defined-but-dead (no reader/writer, no shape).

This redesign is the **full Vendors overhaul** (operator-chosen): make `vendorType` a first-class, editable, readiness-aware field; give the list type + readiness at a glance; and turn the vendor page into an **exhaustive profile dossier** (identity · constraints · sourcing recipe · complete interview log · version history · campaign activity) with a clean view→edit split. It reuses the Plan-A UI kit and the campaigns context-rail language; it does **not** rebuild the SIA interview flow (it surfaces that flow's history read-only).

## 2. The `vendorType` editor (the headline)

`vendorType` becomes a **combobox with a live readiness hint** (operator-chosen), because the type is what gates sourcing:

- The menu lists **types that already have approved mappings**, each with a count (`Infra — 3 mappings`, `Mktg — 2 mappings`), so the guaranteed-runnable choices are obvious; plus types that appear on vendors/mappings but have **no serving mapping** (`Ops — no mapping yet`), and a **"+ Create new type…"** free-entry.
- A **live hint** below the control states the consequence: green *"3 mappings serve Infra — runnable."* vs amber *"No mapping serves 'Ops' yet — add one in Mappings to source."* No silent dead-ends.
- Matching is **case-insensitive** (as `gatherPlanInputs` already compares). The chosen value is stored verbatim on `vendorProfiles.vendorType`.
- `vendorType` is **operator-set only** — it is *not* added to the AI interview's extraction targets. It's a categorical that gates mappings, not prose; the operator owns it. (Its changes *are* recorded in the version changelog once it's writable.)

The same combobox is used at **creation** (New vendor) and in **profile edit**, so a vendor can be runnable from the moment it's created.

## 3. The three views

### 3.1 Vendors — list (`/vendors`)
Page header + a **New vendor** CTA. Then the context-rail layout:
- **Main:** a command bar (search + a readiness **segmented**: All / Runnable / Needs setup) → a **table** of vendors. Columns: **Vendor** (name + capabilities preview), **Type** (badge, or "— no type"), **Readiness** (pill: `runnable` green / `needs mapping` amber / `no type` grey), **Ver**, **Updated** (relative). Whole-row click → profile. Archived vendors hidden by default (a filter reveals them). Truly-empty → `<EmptyState>`.
- **Context rail:** **Readiness** counts (runnable / type-set-but-needs-mapping / no-type) · **Types in use** (chips with per-type vendor counts).

### 3.2 Vendor — profile (`/vendors/[vendorId]`) — the exhaustive dossier
Header: name + **type badge** + **readiness pill** + version, and actions **Edit · Interview · Archive**. Context-rail layout; the main column is a **view-first** stack of cards (an **Edit** toggle flips the profile cards to kit form controls inline):
- **Stat row (4 tiles):** Campaigns run · Leads sourced (all-time) · Avg yield · Profile (v{n} · N interviews · M edits).
- **Identity card:** Type (+ "N mappings serve this"), Capabilities (chips), Ideal customer, Known-good signals, Differentiators, Credibility.
- **Constraints card:** the full structured grid — min/max project size, geographies, capacity, current load, working-capital limit, lead times.
- **Sourcing recipe card:** the signal **families** this vendor hunts (from its mappings; off-families dimmed), the **funded-since window**, and **which mappings contribute which signals** (required vs supporting). This is the computed `signalRecipe`, surfaced.
- **Interview log card:** each interview **session** (date · provider · resulting version · turn count), **expandable** to show the actual SIA transcript (Q/A turns) and exactly which fields were extracted into which version.
- **Version history card:** a changelog **timeline** of every profile change from `interviewHistory` — version, changed fields, `manual_edit` vs `interview`, actor, timestamp (including `vendorType` changes once writable).
- **Campaign activity card:** a table of this vendor's campaigns (label, status pill, leads, yield, run time).
- **Context rail:** **Readiness bridge** (runnable banner + the approved mappings serving this type; if none → "add a mapping for *{type}*" → /mappings) · **Recent runs · this vendor** + a **Find Leads →** entry (to `/campaigns/new`) · **Quick facts** (created, last edit, interview count).

**Edit mode** (the toggle): name, the `vendorType` combobox (§2), capabilities (one-per-line), the constraints fieldset, ideal customer, known-good signals, differentiators, credibility — all kit controls; Save bumps the version (existing `updateVendorProfile` behavior) and appends a changelog entry.

### 3.3 New vendor (`/vendors/new`)
Replaces the name-only inline form. Page header; a compact panel: **Vendor name** + the **`vendorType` combobox** (§2), with a "why type matters" rail explainer (sourcing matches type → mappings → signals). Creating with a runnable type means the vendor can source immediately; the operator then completes the full profile or runs the guided interview. (No type is allowed — the vendor is created but flagged *no type* until set.)

### 3.4 Archive
**Soft, reversible** archive (never hard delete): a nullable `archivedAt` column. Archive from the profile header; archived vendors drop out of the default list and the vendor picker, and can be unarchived. No data is destroyed.

## 4. Data & backend reality (what's new vs already there)

Most of the dossier draws on data that **already exists** and is merely unsurfaced; the type editor and archive are the real new writes.

**Already stored — surface it (read-side additions):**
- **Interview transcripts + sessions** — `vendor_interviews` rows (messages jsonb, provider, `resultingVersion`, status) via `listInterviews` + a transcript read. → Interview-log card.
- **Version changelog** — `vendorProfiles.interviewHistory` (`InterviewHistoryEntry[] = { at, actor, kind: "manual_edit"|"interview", changed[], version, interviewId? }`). → Version-history card. No new data.
- **Sourcing recipe** — computed from `buildSourcingPlan(vendor, approvedMappings, signalDefs)` (families + `fundedSinceDays`) plus the contributing mappings' required/supporting signals (already loaded by `gatherPlanInputs`). → Sourcing-recipe card. **Decision:** compute-and-display at read time; optionally persist into the `signalRecipe` column as a cache (forward-looking — not required this cycle). The dead column becomes meaningful.
- **Campaign activity + stat tiles** — `listCampaigns(db, vendorId)` + the campaigns view-model helpers (`yieldPct`, aggregates). → Stat row + activity card.
- **Readiness bridge** — `getSourcingReadiness(db, vendorId)` already returns `{ runnable, vendorType, signalFamilies }`; expose the **matched approved mappings** (their names) too — `gatherPlanInputs` already filters them internally; add them to a readiness/detail read.

**New writes / schema:**
- **`vendorType` plumbed end-to-end:** add to the app `VendorProfile` type + `getVendor` select; add to `vendorProfileSchema` and `updateVendorProfile.set(...)`; add to `createVendorStub` (+ `vendorStubSchema`) so it's settable at creation; wire the two actions (`createVendor`, `updateVendor`). Free-text storage, combobox-driven input.
- **Combobox options + "types in use":** a helper returning distinct `mappings.serves_vendor_type` values (approved) with mapping counts, and distinct vendor `vendorType` values with vendor counts. Feeds the combobox, the live hint, and the list rail.
- **Enriched `listVendors`:** return `vendorType`, `version`, a capabilities preview, `updatedAt`/last-change, and a **readiness flag** computed in a **single batched** query (vendors LEFT-JOIN approved mappings on `lower(vendorType)=lower(serves_vendor_type)`), plus an `includeArchived`/`archivedAt` filter — instead of N per-vendor readiness calls.
- **`archivedAt`** — a nullable `timestamptz` column on `vendorProfiles` (**one migration**), plus `archiveVendor`/`unarchiveVendor` data fns + actions, and the list/picker filter.

**Untouched:** the SIA interview flow itself (chat/extraction) is not rebuilt — only its outputs are surfaced read-only. `vendorType` is not an interview extraction target.

## 5. Kit reuse & the one new primitive

Reuses: `.data-table` (+ clickable rows), badges/`StatusPill`, `Field`/`.field-*` controls, `ToggleRow`, `Segmented`/`FilterChips`, `KvList`, `ReadinessBanner`, `StatTile`, the context-rail layout, and the `.row-link`/card patterns. **One genuinely new kit primitive: a `Combobox`** (searchable menu of options + free-entry + a slot for the live hint) — the `vendorType` editor, reusable wherever a "pick-or-create with consequences" control is needed.

## 6. Files this touches

- **Kit (new):** `src/app/components/ui/combobox.tsx` (+ CSS in `kit.css`).
- **Vendors views:** `vendors/page.tsx` (list), a new `vendor-table.tsx`, `vendors/[vendorId]/page.tsx` (profile assembly), new profile-view components (identity/constraints/recipe/interview-log/version-history/activity — likely a `vendor-profile-view.tsx` + small pieces), `edit-profile-form.tsx` (add the combobox + kit styling), `add-vendor-form.tsx` → a `/vendors/new` page + form, `vendors/[vendorId]/actions.ts` + `vendors/actions.ts` (vendorType + archive).
- **Data/lib:** `src/lib/vendors/schema.ts` (`VendorProfile` + schemas gain `vendorType`; a `VendorListRow`/snapshot type), `src/lib/vendors/data.ts` (`getVendor` select, enriched `listVendors`, `createVendorStub`, `updateVendorProfile.set`, archive fns, a mapping-types helper, a per-vendor readiness+mappings read, interview-log read), and a small vendors view-model for the recipe/changelog/activity derivations.
- **Schema/migration:** `src/db/schema/vendors.ts` (`archivedAt`) + a Drizzle migration.
- **Tests:** unit (view-model derivations, combobox, profile-view pieces, forms), integration (vendorType create/update, archive, enriched list) extending the existing `vendors-*`/`interview-*` suites.

## 7. Non-goals / follow-on

- Not rebuilding the SIA interview chat/extraction (surfaced read-only only).
- `vendorType` not added to AI extraction (operator-set).
- No hard delete (soft archive only).
- No rich structured editing of `idealCustomer`/`credibility` beyond clean textareas — they're prose fields.
- Persisting the computed recipe into `signalRecipe` is optional/forward-looking (compute-on-read this cycle).

## 8. Responsiveness

Reuses the kit's responsive context-rail: rail reflows below ~1180px; stat grid → 2-up, `.field-pair`/constraint grid → single column on narrow; tables in `overflow-x:auto` wrappers; the profile cards stack naturally. Both light and dark (kit tokens).

## 9. Testing strategy

- **Pure:** vendor view-model derivations (readiness classification from type+mappings, stat aggregates from campaigns, changelog shaping from `interviewHistory`, recipe assembly), and the mapping-types helper — node unit tests.
- **Components:** `Combobox` (open, filter, pick existing, create-new, hint state), the list table (type/readiness columns, filter, row click), the profile-view cards (interview-log expand, version timeline, activity), the edit form + new-vendor form (jsdom).
- **Actions/data:** integration tests for setting `vendorType` at create + update (and readiness flipping to runnable), archive/unarchive + list filtering, and the enriched `listVendors` batched readiness — extending the existing `vendors-*` integration suites (Neon; re-run 2–3× on transient flakiness).
- **Migration:** `archivedAt` added and reversible; verify generate is clean.

## 10. Plan decomposition (for writing-plans)

This is large; it will become **two implementation plans**, each shippable on its own and ordered so the functional gap closes first:
- **Plan 1 — Type editor + list + create/edit (closes the gap):** the `Combobox` primitive, `vendorType` plumbed end-to-end (app type · `getVendor` · schemas · `updateVendorProfile` · `createVendorStub` · both actions), the combobox wired into the **edit form** and a new **`/vendors/new`** page, and the **enriched list** (type badge + readiness pill + filter). After Plan 1 a vendor can be created and set to a runnable type from the UI — the headline gap is closed.
- **Plan 2 — Exhaustive profile dossier + archive:** the view-first profile with all cards (stat row · identity · constraints · **sourcing recipe** · **interview log w/ transcripts** · **version history** · **campaign activity**) and the readiness-bridge rail — surfacing the already-stored data; plus **soft-archive** (the `archivedAt` migration + actions + list/picker filters) and optionally caching the computed `signalRecipe`.
