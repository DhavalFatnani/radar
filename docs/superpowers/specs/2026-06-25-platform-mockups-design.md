# Radar Platform Mockups — Design & Build Spec

**Date:** 2026-06-25
**Status:** Approved (foundation + direction) — building
**Sources of truth:** `UIUX_Specification.md` (§2 visual language, §3 components, §4 screens, §5 hero screens, §6 interaction rules), `Phase0_Platform_Specification.md` (§4 data models, §5 seed signals, §6 seed mappings).
**Companion to:** the live foundation at `mockups/styleguide.html`.

---

## Purpose & constraints

An **exhaustive, interactive, standalone** mockup of the entire Radar platform — the visual + interaction reference the production shadcn build follows later.

- **Isolation:** lives entirely in `/mockups`. Zero dependency on, and zero collision with, the real Next.js app being scaffolded in `src/`.
- **No build step:** plain HTML + bespoke CSS (design tokens) + vanilla JS. Opens in any browser; also serves over `python3 -m http.server`.
- **Interactive & stateful:** selections drive the UI (filters, open a lead, approve a signal, flip toggles, advance a stage, switch theme/mode). Optimistic, keyboard-friendly.
- **Bespoke, not templated** (UIUX §9): hand-crafted design tokens, not a utility framework — to hit the distinctive "precision instrument" direction.

## Locked decisions

| Decision | Choice |
|----------|--------|
| Format | Standalone HTML/CSS/JS prototype in `/mockups` |
| Aesthetic | **All three** directions shipped behind a live switcher (Slate default) |
| Themes | `slate` · `paper` · `observatory`, each × `light` / `dark` (dark required, §2) |
| Coverage | All 9 surfaces + states; **Leads/reverse-brief** and **SIA** built deepest (§5) |
| Build | Full fan-out: heroes hand-built, standard surfaces parallelized |
| Data | Real seed: 17 signals, 2 mappings, 2 vendors, realistic India-first leads (`assets/data.js`) |

---

## Architecture

```
mockups/
├── index.html              # entry: overview + nav to every screen + styleguide
├── styleguide.html         # the design system (built)
├── assets/
│   ├── tokens.css          # structural scale + 3 themes × 2 modes (built)
│   ├── base.css            # reset, typography, app shell, switcher (built)
│   ├── components.css      # the 12 canonical components (built)
│   ├── data.js             # seed data + helpers (timeAgo, freshness) (built)
│   ├── ui.js               # theme/mode persistence, approval motion, toggles, toasts (built)
│   └── shell.js            # shared rail + topbar; renders nav, marks active screen
└── <screen>.html           # one file per surface
```

### Shell contract (`shell.js`)
Each screen page is authored as **content only**; the shell injects chrome:

```html
<body data-screen="leads" data-title="Leads">
  <div class="app" data-rail="closed">
    <!-- shell.js injects .rail (nav) here, and .topbar inside .main -->
    <div class="main"><div class="content"><!-- SCREEN CONTENT --></div></div>
  </div>
</body>
```

`shell.js` builds: the left **rail** (brand + nav items with live counts from `RADAR` data; `aria-current` on the active screen), and the **topbar** (mobile rail toggle, screen title, theme+mode switcher, operator chip). Nav order: Dashboard · Vendors · Signals · Mappings · Leads · Contacts · Pipeline · Holding pool · — · SIA Interview.

### Component reuse rule (for all screens / all agents)
Use ONLY the classes in `components.css` / `base.css` and the tokens in `tokens.css`. **Do not invent new colors or one-off CSS.** If a genuinely new pattern is needed, add it to `components.css` as a reusable class (rare). Every color must come from a `--token` so all 3 themes × 2 modes keep working.

---

## Design tokens (summary; full set in `tokens.css`)

- **Color = meaning only.** status (`proposed`/`approved`/`retired`), strength/score ramp (temperature: cool→hot), freshness (recent/stale), pipeline stage (8), semantic (success/warning/attention), `--money`, one `--accent` for action.
- **Type:** Inter (sans) · JetBrains Mono (data: IDs, scores, dates, params) · Spectral (serif, Paper headings only). Scale `--text-2xs`…`--text-3xl`.
- **Spacing:** 4px base, `--space-1`…`--space-12`. **Radii:** xs→lg. **Motion:** `--dur-fast/base/slow`, reduced-motion zeroes them.

## Component system (built; UIUX §3)
status badge · strength indicator · freshness chip · **proof line** (signature) · score display (hot/warm/cool ring) · signal record card (5 groups) · lead brief layout · contact block · pipeline stage indicator · approval control (deliberate, animated) · toggle control · empty state. Plus: card, buttons, table (`.tbl`), toast.

---

## Screen inventory (derived from UIUX §4–§5)

For each: **must show** · **primary actions** · **states** · **key components**.

### 1. Dashboard — the cockpit (`dashboard.html`)
- **Must show:** What's hot (top new leads), What needs approval (proposed signals/mappings), What's stalling (leads aging in a stage), Money (commission due / recurring cycles due / missed).
- **Actions:** jump to any flagged item. **States:** populated; empty per widget.
- **Components:** score display, proof-line snippets, status badge, stage indicator, `--money`.

### 2. Vendors (`vendors.html`)
- **List:** vendors with capability summary, geographies, lead activity. **Profile:** capabilities, constraints, ideal customer, differentiators, signal recipe, version + interview history. **Interview entry:** start / re-interview.
- **Actions:** start/resume interview, view profile, see this vendor's leads. **States:** list, profile, empty.
- **Components:** card, tags, version chip, links to SIA + Leads.

### 3. Signals — the library (`signals.html`)
- **List:** filterable by family + status; `proposed` surfaced for the approval queue. **Detail:** the signal record card (canonical).
- **Actions:** approve/reject proposed, edit, retire, filter. **States:** list, filtered, detail, empty.
- **Components:** signal record card, status badge, strength, approval control, `.tbl`, family filter.

### 4. Mappings (`mappings.html`)
- **List:** mappings, vendor type served, status. **Editor:** required vs supporting signals, threshold, timing, disqualifiers, with the approval gate.
- **Actions:** approve/reject, edit, retire. **States:** list, editor, empty.
- **Components:** signal chips (required/supporting), approval control, status badge, threshold/timing fields.

### 5. Leads — HERO (`leads.html`, UIUX §5.1)
- **Triage queue:** score-sorted; each row scannable < 1s (company + what they do, vendor, score w/ hot-read, freshness, stage). Filters by vendor, stage, freshness.
- **Lead view:** full reverse brief — why them, **why now** (stack of proof lines, inline), what they need, hook (marked draft), why this vendor, what to watch for (objections + disqualifier-check passed) — with the contact block alongside. Controls: outreach mode toggle, advance stage, act.
- **Goal:** in 30s, understand why it's worth pursuing, how credible, who to contact, next move — every claim backed by visible dated proof.

### 6. Contacts — the contact book (`contacts.html`)
- **Must show:** categorized store of every contact; searchable/filterable by role, industry, company, geography, vendor, source; warm-path visible; deduplicated.
- **Actions:** search, filter, view a contact + provenance. **States:** populated, filtered, empty.
- **Components:** `.tbl` or cards, contact paths, warm-path indicator, source tag.

### 7. Pipeline (`pipeline.html`)
- **Board:** leads across the 8 stages (sourced→paid); commission status on won/delivered/paid; recurring cycles tracked.
- **Actions:** advance stages, see commission due, spot stalls, outreach-mode toggle. **States:** board, empty column.
- **Components:** stage columns, lead cards, stage indicator, `--money`, commission chips.

### 8. Holding pool — stubbed (`holding.html`)
- **Must show:** captured leads no current vendor fits, with the reason; visible from day one. Reverse vendor-sourcing actions are future (show as disabled/“coming”).
- **States:** populated, empty. **Components:** card, reason tag, source signal.

### 9. SIA Interview — HERO (`interview.html`, UIUX §5.2)
- **Conversational surface:** calm, focused; SIA asks, answers captured, broad→precise. **Operator guidance:** show where SIA is probing; "not yet pinned down" affordance to push deeper. **Visible structure forming:** the profile (capabilities/constraints/ideal customer) fills in live, thin areas flagged. **Candidate-signal capture:** "when a company does X…" moments surface as proposed signals. **Re-interview mode:** opens with existing profile, focuses on what's new; versioning visible.

---

## Interaction model (UIUX §6)
- Triage-first (leads default score-sorted). Proof inline for key claims; raw evidence one click away.
- Approval is deliberate + weighted + confirms with motion (built: `data-approve`).
- Honesty: confidence shown, stale labeled, missing contact data says "needs enrichment."
- Speed: optimistic updates, toasts, keyboard (Shift+D dark; later: triage/approve/advance shortcuts).
- Toggles visible + live (bundling, per-lead outreach). Theme/mode switch persists (localStorage) and is deep-linkable (`?theme=&mode=`).

## Build approach
1. Shell + index (connective tissue) — hand-built.
2. **Hero screens** (Leads, SIA) — hand-built to highest fidelity.
3. **Standard surfaces** (Dashboard, Vendors, Signals, Mappings, Contacts, Pipeline, Holding) — fanned out in parallel against this spec + the Leads reference + the shared foundation; each agent reuses existing components only.
4. **Verification:** headless screenshot of every screen in ≥2 theme/mode combos; fix breakage; check responsive + keyboard + reduced-motion.

## Acceptance criteria
- Every surface reachable from the rail; active state correct; counts live from seed data.
- All 3 themes × 2 modes render every screen without broken color/contrast.
- Hero screens meet their §5 goals (Leads 30s-comprehension; SIA visible vague→precise).
- Approve animates the badge; toggles flip with visible state; filters change the visible set; opening a lead shows its full brief.
- No invented colors — every surface theme-switches cleanly. Responsive down to mobile; visible focus; reduced-motion respected.
