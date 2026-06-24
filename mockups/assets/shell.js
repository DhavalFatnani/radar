/* ============================================================================
   Radar — Shared app shell (rail + topbar). One source of truth for nav.
   A page authors content only:
     <body data-screen="leads" data-title="Leads">
       <div class="app" data-rail="closed">
         <div class="main"><div class="content">…</div></div>
       </div>
   shell.js injects .rail before .main, and .topbar at the top of .main.
   ========================================================================== */
(function () {
  const I = {
    dashboard: '<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z"/>',
    vendors:   '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/>',
    signals:   '<path d="M4 12a8 8 0 0 1 8-8M4 12a8 8 0 0 0 8 8M12 12h.01"/><circle cx="12" cy="12" r="1"/><path d="M7.5 12a4.5 4.5 0 0 1 4.5-4.5"/>',
    mappings:  '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M8.5 6.8 15.5 11M8.5 17.2 15.5 13"/>',
    leads:     '<path d="M3 7l9 6 9-6"/><rect x="3" y="5" width="18" height="14" rx="2"/>',
    contacts:  '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
    pipeline:  '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="8" rx="1"/>',
    holding:   '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M9 13h6"/>',
    interview: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  };
  const ic = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[k] || ""}</svg>`;

  const NAV = [
    { group: "Operate", items: [
      { id: "dashboard", label: "Dashboard", href: "dashboard.html" },
      { id: "leads",     label: "Leads",     href: "leads.html" },
      { id: "pipeline",  label: "Pipeline",  href: "pipeline.html" },
      { id: "contacts",  label: "Contacts",  href: "contacts.html" },
    ]},
    { group: "Build", items: [
      { id: "vendors",   label: "Vendors",   href: "vendors.html" },
      { id: "interview", label: "SIA Interview", href: "interview.html" },
      { id: "signals",   label: "Signals",   href: "signals.html" },
      { id: "mappings",  label: "Mappings",  href: "mappings.html" },
      { id: "holding",   label: "Holding pool", href: "holding.html" },
    ]},
  ];

  function counts() {
    const R = window.RADAR;
    if (!R) return {};
    return {
      signals: R.signals.filter((s) => s.status === "proposed").length,
      leads: R.leads.filter((l) => l.heat === "hot").length,
      holding: R.holding.length,
      vendors: R.vendors.length,
    };
  }

  function railHTML(active) {
    const c = counts();
    const alertIds = { signals: true }; // proposed signals = needs attention
    const navHTML = NAV.map((sec) => `
      <div class="nav-section">
        <div class="eyebrow">${sec.group}</div>
        ${sec.items.map((it) => {
          const n = c[it.id];
          const badge = n ? `<span class="count ${alertIds[it.id] ? "alert" : ""}">${n}</span>` : "";
          return `<a class="nav-item" href="${it.href}" ${it.id === active ? 'aria-current="page"' : ""}>${ic(it.id)}<span>${it.label}</span>${badge}</a>`;
        }).join("")}
      </div>`).join("");
    return `
      <a class="brand" href="index.html" aria-label="Radar home">
        <span class="brand-mark">R</span>
        <span class="brand-name">Radar<small>lead intelligence</small></span>
      </a>
      <nav class="nav">${navHTML}</nav>
      <div class="rail-foot">
        <a class="nav-item" href="styleguide.html">${ic("signals")}<span>Design system</span></a>
        <div class="nav-item" style="cursor:default">
          <span class="brand-mark" style="width:24px;height:24px;font-size:11px;background:var(--surface-inset);color:var(--text-muted)">OP</span>
          <span style="font-size:var(--text-sm)">Operator</span>
        </div>
      </div>`;
  }

  function topbarHTML(title) {
    return `
      <button class="icon-btn rail-toggle" data-rail-toggle aria-label="Toggle navigation">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
      </button>
      <h1>${title}</h1>
      <div class="spacer"></div>
      <div class="switcher">
        <div class="seg" role="group" aria-label="Direction">
          <button data-set-theme="slate">Slate</button>
          <button data-set-theme="paper">Paper</button>
          <button data-set-theme="observatory">Obs</button>
        </div>
        <button class="icon-btn" data-toggle-mode aria-label="Toggle light/dark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        </button>
      </div>`;
  }

  function mount() {
    const app = document.querySelector(".app");
    if (!app) return;
    const active = document.body.dataset.screen || "";
    const title = document.body.dataset.title || "Radar";

    const rail = document.createElement("aside");
    rail.className = "rail";
    rail.innerHTML = railHTML(active);
    app.insertBefore(rail, app.firstChild);

    const main = app.querySelector(".main");
    if (main) {
      const top = document.createElement("header");
      top.className = "topbar";
      top.innerHTML = topbarHTML(title);
      main.insertBefore(top, main.firstChild);
    }
    // close mobile rail when a nav link is tapped
    rail.querySelectorAll(".nav-item[href]").forEach((a) =>
      a.addEventListener("click", () => (app.dataset.rail = "closed")));
  }

  mount();
})();
