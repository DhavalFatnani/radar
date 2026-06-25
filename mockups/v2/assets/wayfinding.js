/* ============================================================================
   Radar v2 — wayfinding ("what to do next")
   Derives the single highest-priority action from live RADAR data, so every
   screen can point the operator forward. Priority reflects the spec's stakes:
   money at risk > the approval gate > a hot lead going cold > stalls.
   Exposes window.radarWayfind() -> { lbl, msg, href, cta } | null
   ========================================================================== */
(function () {
  function nextBestAction() {
    const R = window.RADAR;
    if (!R) return null;

    // 1) Money at risk — a missed commission cycle.
    const missed = (R.commissions || []).find((c) => c.status === "missed");
    if (missed) return { lbl: "money at risk", msg: `${missed.company} commission missed (${missed.amount}) — recover it`, href: "pipeline.html", cta: "Open pipeline" };

    // 2) The approval gate — proposed signals/mappings waiting.
    const proposed = (R.signals || []).filter((s) => s.status === "proposed").length;
    if (proposed) return { lbl: "approval gate", msg: `${proposed} signal${proposed > 1 ? "s" : ""} await your approval`, href: "signals.html", cta: "Review queue" };

    // 3) A hot lead going cold — high score, still un-progressed.
    const hot = (R.leads || []).filter((l) => l.heat === "hot" && (l.stage === "sourced" || l.stage === "contacted")).sort((a, b) => b.score - a.score)[0];
    if (hot) return { lbl: "hot lead", msg: `${hot.company} (${hot.score}) is hot and unactioned — make the move`, href: "leads.html", cta: "Open lead" };

    // 4) A recurring cycle coming due.
    const due = (R.commissions || []).find((c) => c.status === "cycle_due");
    if (due) return { lbl: "cycle due", msg: `${due.company} recurring cycle due ${due.next || "soon"}`, href: "pipeline.html", cta: "Open pipeline" };

    // 5) Quiet — point at the engine's growth surface.
    return { lbl: "all clear", msg: "Queue is clear — interview a vendor to grow the library", href: "interview.html", cta: "Start interview" };
  }

  function arrowSVG() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  }
  function pinSVG() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 7v10l8 5 8-5V7z"/><path d="M12 22V12M4 7l8 5 8-5"/></svg>';
  }

  // Render the standard wayfinding strip into a host element.
  function renderWayfind(host) {
    const a = nextBestAction();
    if (!host || !a) return;
    host.className = "wayfind";
    host.innerHTML =
      `<span class="pin">${pinSVG()}</span>` +
      `<span class="lbl">next ·</span><span class="msg">${a.msg}</span>` +
      `<a class="go" href="${a.href}">${a.cta} ${arrowSVG()}</a>`;
  }

  window.radarWayfind = nextBestAction;
  window.radarRenderWayfind = renderWayfind;
})();
