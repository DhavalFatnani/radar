# Radar Mockups v2 — Futuristic Redesign (3 directions)

**Date:** 2026-06-25
**Status:** Approved scope, building
**Builds on:** v1 prototype (`mockups/`, committed `8e830b6`) and `2026-06-25-platform-mockups-design.md`.
**Sources of truth:** `UIUX_Specification.md`, `Phase0_Platform_Specification.md` (esp. §4.6 catalogue graph, §6 mappings).

## Goal

A state-of-the-art, futuristic redesign of the whole platform with **stronger hierarchy, seamless motion, and explicit wayfinding** ("what to do next" always visible). Build **three** complete design directions so the operator can try all three and pick a winner. Add the **graph views** the spec calls for (catalogue network + mappings flow). Ships **alongside** v1.

## What stays (locked, reused from v1)
- Design tokens: meaning-only color, the strength/freshness/status/stage ramps, type (Inter/JetBrains Mono/Spectral), the **proof line** signature, all 3 themes × light/dark.
- Seed data (`assets/data.js`), the canonical components' *meaning* (badge/strength/fresh/proof/score/contact block/etc.).

## What changes
Layout, information hierarchy, navigation, surface treatment, **motion**, and **wayfinding** — re-expressed three ways.

---

## Architecture

```
mockups/v2/
├── index.html                 # v2 launcher: pick direction × screen, explains the 3
├── assets/
│   ├── v2.css                 # shared v2 layer: motion utils, view-transitions, wayfinding,
│   │                          #   command bar, animated counters, skeletons, graph canvas styles
│   ├── motion.js              # FLIP helper, stagger reveal, count-up, intersection reveals
│   ├── graph.js               # interactive graph engine (SVG): catalogue + mappings
│   ├── wayfinding.js          # "next best action" derivation from RADAR data
│   └── nav.js                 # v2 shell per direction + direction/theme/mode switchers
├── command/<screen>.html      # Direction A — Command Center
├── spatial/<screen>.html      # Direction B — Spatial Intelligence
└── focus/<screen>.html        # Direction C — Guided Focus
```
- Reuses v1 tokens/data: each page links `../../assets/tokens.css` + `v2.css` + `../assets/data.js`.
- **Direction switcher** (command/spatial/focus) + theme/mode switchers, persisted (`localStorage`), deep-linkable (`?theme=&mode=`). Default **observatory-dark**.
- Screens (per direction): `dashboard, leads, pipeline, contacts, vendors, interview, signals, mappings, holding, catalogue` (catalogue = the graph surface). Mappings includes a flow-graph mode.

## Motion system (shared; reduced-motion zeroes all)
- **Cross-document View Transitions** (`@view-transition { navigation: auto }`) for seamless page-to-page nav; named transitions on the shell so rail/title persist.
- **FLIP** for list/board reordering & filtering (queue re-sorts, kanban moves animate).
- **Staggered reveal** of cards/rows on load (IntersectionObserver, 30–60ms stagger).
- **Count-up** animated numerals for scores, commission, counts.
- **Shared-element** transition: a lead row → its brief (morph), a signal row → its record card.
- Easing/duration from tokens (`--ease-out`, `--dur-*`). All gated by `prefers-reduced-motion`.

## Wayfinding ("what to do next", every direction)
A derived **Next Best Action** from real data: highest-priority pending act — e.g. "2 signals await approval", "BrightHaul (92) is hot and unactioned", "Vista Mart commission missed". Rendered as the direction's signature wayfinding element. Plus: clear primary-action emphasis per screen, breadcrumb/title context, and forward affordances ("→ open", "→ approve", "→ advance").

---

## Direction A — Command Center (dense operator cockpit)

- **Shell:** compact icon+label left rail (collapsible), a top **command bar** with ⌘K palette + global search + the Next-Best-Action chip. Three-zone work surfaces: **rail → work list → live inspector** (selecting in the list updates the inspector without navigation).
- **Hierarchy:** information-dense, tabular, scannable. Strong typographic scale; mono data everywhere. Minimal chrome, crisp 1px separators, subtle elevation (no glass).
- **Dashboards:** **bento grid** of widgets (varied sizes), each a live tile; counters count up; the Next-Best-Action spans the top.
- **Motion:** fast FLIP lists, shared-element list→inspector morph, count-ups, view-transitions between sections. Restrained, precise.
- **Graph:** an embedded inspector panel; graph is a structured, orthogonal node-link diagram (clean, Linear-like), pannable.
- **Feel:** Linear × Bloomberg terminal. Best for speed + density.

## Direction B — Spatial Intelligence (depth + canvas)

- **Shell:** minimal floating top bar; navigation as a **radial/command launcher**; surfaces are **layered glass panels** over a deep background with subtle depth/parallax. Context panels float over the work.
- **Hierarchy:** depth encodes hierarchy — primary surface forward/opaque, context behind/translucent. Generous focal emphasis; the active object is spotlit.
- **Catalogue = centerpiece:** a **zoomable node canvas** you pan/zoom through; vendors/capabilities/geographies/sizes as glowing nodes; bundles light up paths; gaps pulse. Other screens borrow the canvas idiom (e.g. pipeline stages as a flowing lane).
- **Motion:** richest — parallax on scroll, panels that scale/blur in, glow on signal strength, magnetic hover, zoom transitions into detail. View-transitions do a depth-zoom.
- **Surfaces:** glassmorphism (backdrop-blur) used deliberately on floating panels; deep observatory background; signal colors glow.
- **Feel:** mission-control / sci-fi intelligence. Boldest. Guard readability on dense lists by giving them solid (non-glass) surfaces.

## Direction C — Guided Focus (one task, led by the hand)

- **Shell:** slim top progress/wayfinding bar that names **where you are and what's next**; one **primary task per view**, centered, generous whitespace, large editorial type (Spectral display where it fits). Secondary info is tucked into reveal-on-demand drawers.
- **Hierarchy:** ruthless focus — a single dominant element per screen; everything else recedes. The operator is *guided* step to step (triage → open → act → next lead) with an always-present "Next ▸".
- **Dashboards:** a prioritized **single-column briefing** ("Here's your morning: 2 approvals, 1 hot lead, 1 missed payment") rather than a grid.
- **Motion:** calm, leading — content slides in along the reading path, the "Next ▸" pulses gently, smooth section view-transitions. Less motion, more intent.
- **Graph:** focused — one relationship in view at a time, step through the network; or a simplified clean diagram.
- **Feel:** Arc / calm-futurism. Wayfinding-first, least dense, most opinionated.

---

## Graph views (both; shared engine `graph.js`)

### Catalogue network (`catalogue.html`) — new surface
Nodes: `vendor`, `capability`, `sub_capability`, `geography`, `project_size_range`. Edges per §4.6. Interactive: hover highlights a node's connections; click focuses a node + shows its detail; filter by geography/size; **bundle detection** (a client need spanning ≥2 vendors lights a multi-node path); **gap detection** (a recurring need no vendor satisfies pulses → links to holding pool). Pan/zoom. Each direction styles it per its idiom (Command: clean orthogonal; Spatial: glowing zoom-canvas; Focus: one-relationship stepper).

### Mappings flow (mode within `mappings.html`)
For a selected mapping: a left-to-right flow — **signals** (required vs supporting, color/strength-coded) → **mapping** (threshold/timing) → **vendor** (the lead it fires); **disqualifiers** shown as veto edges. Hovering a signal traces its contribution. Toggle between the list/editor view and this flow view.

---

## Build sequence
1. **Foundation:** `v2.css`, `motion.js`, `graph.js`, `wayfinding.js`, `nav.js` (3 direction shells + switchers), `v2/index.html` launcher.
2. **Hero references (hand-built):** `leads.html` in all 3 directions → present for a quick "do these three feel right?" before fan-out.
3. **Fan-out:** remaining 8 surfaces + `catalogue.html` × 3 directions, via workflow, each agent reading this spec's direction section + the matching hero reference + the shared foundation. Reuse tokens/components; no invented colors.
4. **Verify + polish:** screenshot each screen × direction × ≥2 theme/modes; confirm transitions, wayfinding, graph interactions, responsive, reduced-motion; commit.

## Acceptance criteria
- v2 launcher lets you pick any direction × screen; direction + theme + mode persist and are deep-linkable.
- All 3 directions render every surface without broken color/contrast in slate/paper/observatory × light/dark.
- Each direction has a *distinct, coherent* layout/hierarchy/motion identity (not a re-skin) — recognizable in one glance.
- Seamless page transitions; every screen shows a clear next-step affordance; the Next-Best-Action is data-derived and correct.
- Catalogue graph + mappings flow are interactive (hover/click/zoom or step) and reflect real seed relationships.
- v1 remains intact and reachable; reduced-motion respected; responsive down to mobile.
