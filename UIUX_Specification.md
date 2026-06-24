# UI/UX Specification
## The interface for the Lead Intelligence & Matchmaking Platform

**Companion to:** Phase 0 Platform Specification and the Prompt Playbook.
**Audience:** Dual purpose. Readable for the operator to confirm the look and feel, and precise enough for Claude Code / Cursor to build from.
**What this covers:** the design philosophy, the visual language, the reusable component system, every key screen, and the two screens that matter most, in depth.

---

## How to read this document

If you are the operator, read sections 1, 2, and 4 to understand the feel and the screens. Sections 3, 5, and 6 are the precise build detail.

If you are a build tool, sections 3 (components), 4 and 5 (screens), and 6 (interaction rules) are the core. Section 8 maps it to the build phases. Do not introduce visual patterns that contradict section 2.

---

## 1. Design philosophy

This is not a consumer app and should not look like one. It is an intelligence tool for one expert operator who uses it for hours. Every design decision serves that reality and the platform's three principles.

**The interface must make the three platform principles visible:**

1. **Proof is a first-class visual element.** Because every claim carries dated, sourced evidence, the UI surfaces that proof and its recency inline, at a glance, never buried behind a click for the claims that matter. Seeing a claim and seeing why it is credible happen together.
2. **The approval gate is unmistakable.** Because every signal and mapping is operator-governed, status (proposed, approved, retired) is always visually obvious, and approving is a deliberate, single, satisfying action that can never happen by accident.
3. **Quality over volume shapes the layout.** Because revenue comes from the few leads a vendor can win, the UI is built for triage, not for scrolling endless lists. The best opportunities rise; the operator's attention is directed, not drowned.

**Operator-tool principles, on top of those:**

- **Speed is a feature.** One power user, all day. Fast loads, minimal clicks, keyboard-friendly, optimistic updates. No onboarding fluff, no hand-holding, no marketing chrome.
- **Density with breathing room.** Information-dense where density aids scanning and decisions, but never cramped. Whitespace is used deliberately to separate what matters.
- **Transparency, never a black box.** The system always shows why: why this lead, why this score, where this contact came from, how confident it is. When the system is unsure or data is missing, it says so plainly rather than hiding it.

---

## 2. Visual language

A deliberate direction, chosen for this product, not a templated dashboard.

**The feel:** a calm, confident intelligence workspace. Closer to a precision instrument than a colorful app. Editorial clarity in the typography, restraint in the chrome, and color reserved almost entirely for meaning. The operator should feel they are looking at a sharp, trustworthy tool that respects their attention.

**Color.** A restrained, near-neutral base (the canvas, surfaces, and text) so the workspace is quiet. Color is then spent almost entirely on encoding meaning, and the meanings are consistent everywhere:
- **Status:** proposed, approved, retired each have a fixed, learnable color.
- **Signal strength and lead score:** a single ramp from weak to strong, so strength is readable at a glance without reading numbers.
- **Freshness:** recent vs stale is color-coded, reinforcing the proof principle.
- **Pipeline stage and semantic states** (success, warning, attention): fixed and consistent.
Color is never decorative. If a color appears, it means something. This restraint is what makes the meaningful colors legible.

**Typography.** Type carries the personality and the hierarchy. A clear, characterful but professional type system with deliberate weights and a real scale, set for readability at density. A monospace face for the things that are data: IDs (`SIG-HIRING-OPS-SURGE`), parameters, scores, dates. The monospace is itself a signal to the eye: "this is precise data," which suits an intelligence tool.

**Density and spacing.** A consistent spacing scale. Dense where scanning many items helps (the lead queue, the contact book, the signal library), generous where focus helps (a single lead's brief, the interview). Never cramped; the eye should always find the edges of things.

**Dark mode is required.** The operator stares at this all day; dark mode is a comfort necessity, not a nice-to-have. Every color must work in both modes.

**Iconography.** Consistent, functional, outline-style icons. Icons clarify, never decorate. Every icon-only control has an accessible label.

**Motion.** Minimal and purposeful. State transitions (a signal moving from proposed to approved, a lead advancing a stage) can animate to confirm the change. Beyond that, restraint, excess motion reads as unserious and slows a power user down. Respect reduced-motion preferences.

**The signature element.** The one memorable, identity-defining treatment of this product is the **proof line**: the dated, sourced, plain-language receipt that sits under every claim. It is the visible embodiment of the platform's core promise, and it should be designed with care so that "claim plus its evidence and recency" is the recognizable texture of the entire interface.

---

## 3. The component system

These reusable components appear across screens and must look and behave identically everywhere. Two of them, the signal record and the lead brief, were already designed and approved in conversation; those treatments are canonical and this spec formalizes them.

### Status badge
Shows `proposed`, `approved`, or `retired`. Fixed color per status. `proposed` reads as "needs your attention." Appears on every signal and mapping. This is the approval gate made visible.

### Strength indicator
Shows signal strength or a derived level (low, medium, high, very high) using the strength ramp, so level is readable without reading the word. Used on signals and contributes to the lead score display.

### Freshness chip
Shows `recent` or `stale` plus the relevant date, color-coded. Reinforces the proof principle. Appears wherever a signal observation or dated fact is shown.

### Proof line (the signature element)
The dated, sourced, plain-language receipt under a claim. Format: the claim in plain language, the date and how long ago, and the source. Example texture: a claim, then "2 June 2026, 3 weeks ago. Source: commercial property news." Designed for instant scanning of both substance and recency. Used in the reverse brief, the lead card, and anywhere a signal is quoted.

### Score display
The lead score, shown with a clear hot/warm/cooler read (via the strength ramp), so triage priority is obvious at a glance.

### Signal record card (canonical, already designed)
The full signal in its five groups (identity, detection, weighting, semantics, history), every field carrying a plain-language hint, with the status badge prominent and the approval action available. The detail view of any signal.

### Lead brief layout (canonical, already designed)
The reverse brief: header (company, who it serves, score), then why them, why now (proof lines), what they need, the hook (clearly marked as a suggested draft), why this vendor, and what to watch for (objections and the disqualifier check). The contact block sits alongside as its own section.

### Contact block
Per decision-maker: name, role, why they are the target, and each contact path with its type, value, confidence, and source. Missing data is shown honestly ("email needs enrichment") rather than hidden. Includes the warm-path indicator.

### Pipeline stage indicator
Shows where a lead sits: sourced, contacted, engaged, pitched, won, lost, delivered, paid. Consistent on the lead and on the pipeline board.

### Approval control
The deliberate approve / reject action for a proposed signal or mapping. Single, clear, slightly weighted so it cannot be triggered absent-mindedly. On approval, the status badge transitions with a small confirming motion.

### Toggle control
For the platform's surfaced toggles: bundling mode (suggest is default, automatic the alternative) and per-lead outreach mode (operator handles vs handed to vendor). State is always visible.

### Empty state
Every section, when empty, gives direction, not mood: what this section is and the action to populate it. An empty screen is an invitation to act, written in the interface's plain voice.

---

## 4. The key screens

Each main section, what it must show, its primary actions, and interaction notes.

### Dashboard (the operator's cockpit)
The home screen. The operator's situational awareness in one view:
- **What's hot:** the top-scoring new leads needing attention.
- **What needs approval:** proposed signals and mappings awaiting the gate.
- **What's stalling:** leads sitting too long in a pipeline stage.
- **Money:** commission due, especially recurring cycles coming up or missed (active tracking, surfaced here).
Primary actions: jump to any flagged item. The dashboard directs attention; it does not bury it.

### Vendors
- **List:** all vendors, their core capability summary, geographies, and lead activity.
- **Profile:** the full vendor profile (capabilities, constraints, ideal customer, differentiators, signal recipe), versioned, with interview history.
- **Interview entry:** start a new interview or a re-interview (append and amend). See section 5.2.
Primary actions: start/resume interview, view profile, see this vendor's leads.

### Signals (the library)
- **List:** the signal library, filterable by family and status. The `proposed` ones are visually surfaced for the approval queue.
- **Detail:** the signal record card (canonical).
Primary actions: review and approve/reject proposed signals, edit, retire. This is where the library is governed and grows.

### Mappings
- **List:** all mappings, which vendor type each serves, and status.
- **Editor:** define or adjust a mapping, required vs supporting signals, threshold, timing, disqualifiers, with the approval gate.
Primary actions: review and approve/reject, edit, retire.

### Leads (the most important screen, see 5.1)
- **The queue:** leads sorted by score for triage. Scannable: company, vendor, score, freshness, stage.
- **The lead view:** the full reverse brief plus contact block.
Primary actions: triage, open, set outreach mode, advance stage, act.

### Contacts (the contact book)
- The compounding, categorized store of every contact found. Searchable and filterable by role, industry, company, geography, relevant vendor, and source. Warm-path status visible. Deduplicated.
Primary actions: search, filter, view a contact and where it came from.

### Pipeline
- A board view of leads across stages (sourced to paid), per the pipeline stage indicator. Commission status visible on won/delivered/paid items, with recurring cycles tracked.
Primary actions: advance stages, see commission due, spot stalls.

### Holding pool (present, stubbed)
- Captured leads that no current vendor can fulfill, with the reason. Visible from day one so nothing is lost; the reverse vendor-sourcing actions come later.

---

## 5. The two screens that matter most, in depth

### 5.1 The lead / reverse brief view

This is where money is made, so it must be the most carefully designed screen in the product. It has two zones.

**The triage queue.** Leads sorted by score, highest first. Each row is scannable in under a second: company name and what they do, which vendor it serves, the score (with hot/warm read), a freshness signal, and the pipeline stage. The operator should be able to run their eye down the list and know instantly where to spend attention. No endless scroll mindset; the strongest opportunities are at the top by design. Filters by vendor, stage, and freshness.

**The lead view.** Opening a lead shows the full reverse brief (canonical layout) and the contact block side by side or in a clear reading order:
- The brief leads with why them and why now, and the why-now is a stack of proof lines, each claim with its dated source and recency. This is the operator's evidence to judge the lead themselves.
- What they need, then the hook clearly marked as a suggested draft (never presented as final copy), then why this vendor.
- What to watch for: likely objections with counters, and the disqualifier-check status shown as passed, so the operator knows the quality gate ran.
- The contact block: decision-makers, each with their contact paths, confidence, and source, missing data shown honestly, warm-path flagged.
- Controls: set the outreach mode (operator handles vs handed to vendor), advance the pipeline stage, and act.

The design goal for this screen: an operator can open a lead, in thirty seconds understand why it is worth pursuing and how credible it is, know who to contact and how, and decide their next move, with every assertion backed by visible, dated proof.

### 5.2 The vendor interview (SIA)

The front door, and a fundamentally different interaction from the rest of the product: conversational, guided, and operator-co-piloted.

- **A focused conversational surface.** Calm and uncluttered, so the operator and vendor can concentrate. SIA asks; answers are captured; the conversation drills from broad to precise.
- **Built-in guidance for the operator.** Because the operator co-pilots, the screen can surface where SIA is probing for precision and let the operator nudge deeper. The interface should make it easy for the operator to see "we have not yet pinned this down" and push.
- **Visible structure forming.** As the interview proceeds, the structured profile takes shape (capabilities, constraints, ideal customer), so the operator can see what has been captured and what is still thin.
- **Candidate-signal capture.** When SIA hears a "when a company does X, that is when they need us" moment, the interface surfaces it as a candidate new signal for later approval, making the library's growth a natural by-product of the conversation.
- **Re-interview mode.** Opens already showing the existing profile and focuses only on what is new or changed, append and amend, with versioning visible.

The design goal: the vague-to-precise journey feels guided and productive, the operator always knows where the gaps are, and the rich profile the whole engine depends on is the natural output.

---

## 6. Interaction and behavior rules

- **Triage-first.** Leads default to score-sorted. The operator's attention is directed to the best opportunities, always.
- **Proof inline for key claims.** The why-now evidence on a lead is visible without a click. Deeper evidence (the raw links) can be one click away, but the dated, plain-language receipt is always on the surface.
- **Approval is deliberate.** Approving a signal or mapping is a single, clear, slightly weighted action. It cannot happen by accident, and it confirms with a small motion.
- **Honesty in the UI.** Confidence is shown. Stale is labeled stale. Missing contact data says "needs enrichment." Gaps are surfaced, never hidden. The system never pretends to know more than it does.
- **Speed everywhere.** Optimistic updates, fast loads, keyboard shortcuts for the frequent operator actions (triage, approve, advance stage). The operator should never wait on the tool.
- **Toggles are visible and live.** Bundling mode and per-lead outreach mode show their current state plainly and switch without friction.
- **Plain, consistent language.** Controls say what they do ("Approve signal," "Hand to vendor," "Advance to pitched"). The same action keeps the same name through the whole flow. Empty states and errors give direction in the interface's voice, never vague, never apologetic.

---

## 7. Accessibility and responsiveness

- **Desktop-first**, because it is a power tool used at a desk, but responsive down to smaller screens so the operator can check leads and commission on the move.
- A quality floor, not announced but always met: sufficient contrast in both light and dark modes, visible keyboard focus, full keyboard navigation for frequent actions, reduced motion respected, readable type at the chosen density.

---

## 8. What to build when (mapped to the build phases)

- **Phase 1 (the spine):** establish the visual language foundation, the design tokens (color with its fixed meanings, type scale, spacing, dark mode), the core layout and navigation, and the empty states for every section. The component system is scaffolded here even though it holds no real data yet.
- **Phase 2 (vendor intake + catalogue):** the vendor screens and the interview surface (5.2).
- **Phase 3 (signals + mappings):** the signal record card, the mapping editor, the status badges, and the approval control, the governance UI.
- **Phase 4 (sourcing engine + reverse brief):** the lead screen (5.1) gets the most design care of any screen in the product, including the proof line, the brief layout, the contact block, and the triage queue. This is the screen to polish hardest, ideally in Cursor.
- **Phase 5 (pipeline + commission):** the pipeline board, commission and recurring-cycle surfacing, the outreach-mode toggle.
- **Phase 6 (feedback + hardening):** the dashboard's full situational awareness, contact-book refinement, and the final UI/UX polish pass across everything.

---

## 9. To refine when reached (deliberately deferred)

- The exact hex values for the base palette and each meaning-color, and the precise type and spacing scales (the first real design pass in Phase 1).
- Whether to adopt an existing component library or build bespoke (a Phase 1 decision, balanced against the distinctive-direction goal).
- Detailed keyboard-shortcut map for power actions.
- The dashboard's exact widgets and their priority, once real lead and commission volume exists.

---

*End of UI/UX Specification. Use alongside the Phase 0 spec and the Prompt Playbook. The visual language in section 2 and the component system in section 3 are the guardrails; every screen should be derivable from them.*
