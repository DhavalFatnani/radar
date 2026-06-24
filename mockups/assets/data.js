/* ============================================================================
   Radar — Seed data (from Phase 0 spec §5 seed library, §6 seed mappings).
   Real signals, real mappings, realistic India-first sample leads.
   "Today" is pinned so recency reads consistently across the prototype.
   ========================================================================== */
window.RADAR = (function () {
  const TODAY = new Date("2026-06-25T10:00:00+05:30");

  function daysAgo(dateStr) {
    const d = new Date(dateStr);
    return Math.round((TODAY - d) / 86400000);
  }
  function ago(dateStr) {
    const n = daysAgo(dateStr);
    if (n < 1) return "today";
    if (n < 7) return `${n} day${n > 1 ? "s" : ""} ago`;
    if (n < 31) { const w = Math.round(n / 7); return `${w} wk${w > 1 ? "s" : ""} ago`; }
    const m = Math.round(n / 30); return `${m} mo${m > 1 ? "s" : ""} ago`;
  }
  function fmtDate(dateStr) {
    return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  function freshness(dateStr, windowDays) {
    return daysAgo(dateStr) <= windowDays ? "recent" : "stale";
  }

  const vendors = [
    {
      vendor_id: "VEN-INFRA-01", name: "Meridian Warehouse Infrastructure", short: "Infra",
      capability: "Racking up to 12t/bay, CCTV, networking, electricals, facility fit-out",
      geographies: ["Maharashtra", "Gujarat", "MP"], size: "10k–100k sq ft",
      ideal_customer: "3PLs, D2C brands & manufacturers building or expanding DCs",
      differentiators: "Turnkey fit-out in 6–8 weeks; can float materials up to ₹2cr",
      version: 3, leads_active: 7, leads_won: 2, recipe: ["MAP-WAREHOUSE-EXPANSION"],
    },
    {
      vendor_id: "VEN-MKTG-01", name: "Groundwave Field Marketing", short: "Mktg",
      capability: "Outdoor, signage/printing, promoter staffing, store-launch activation",
      geographies: ["Maharashtra", "Karnataka", "Telangana"], size: "City & multi-city",
      ideal_customer: "Retail & D2C brands launching stores or entering new cities",
      differentiators: "48-hr launch activation; pan-metro promoter network",
      version: 2, leads_active: 5, leads_won: 1, recipe: ["MAP-OFFLINE-MARKETING-PUSH"],
    },
  ];

  // status: most seed signals approved; a couple proposed to show the gate.
  const signals = [
    { signal_id: "SIG-HIRING-OPS-SURGE", name: "Operations hiring surge", family: "hiring", strength: "high", noise: "medium", serves: "Infra", status: "approved",
      trigger: "≥ 5 open warehouse/operations/logistics/fulfilment roles at one company, rolling 60 days",
      sources: ["Naukri", "LinkedIn Jobs", "company careers"], method: "structured_query", entity: "business", polarity: "positive",
      freshness_window: 60, fp_risk: "medium", geography: ["india"], pairs: ["SIG-EXP-NEW-FACILITY", "SIG-EXP-LARGE-LEASE"],
      proof_captured: "Job-post URLs, role titles, counts, first-seen dates", confirmation: "≥ 5 distinct live postings", recheck: "weekly",
      origin: "Seed library", added: "2026-03-01", example: "A 3PL posts 8 fulfilment roles across 2 cities in 5 weeks." },
    { signal_id: "SIG-HIRING-NEW-CITY", name: "New-city hiring", family: "hiring", strength: "high", noise: "medium", serves: "Both", status: "approved",
      trigger: "A company posts roles in a city where it has no current presence", freshness_window: 60, fp_risk: "medium", geography: ["india"] },
    { signal_id: "SIG-HIRING-SENIOR-OPS", name: "Senior ops leader sought", family: "hiring", strength: "medium", noise: "low", serves: "Infra", status: "approved",
      trigger: "Posting for Head/VP/Director of Supply Chain, Operations, or Logistics", freshness_window: 90, fp_risk: "low", geography: ["india"] },
    { signal_id: "SIG-HIRING-FIELD-MKTG", name: "Field-marketing hiring surge", family: "hiring", strength: "medium", noise: "medium", serves: "Mktg", status: "approved",
      trigger: "Surge in promoter / field-marketing / store-launch roles across locations", freshness_window: 60, fp_risk: "medium", geography: ["india"] },

    { signal_id: "SIG-TENDER-LIVE", name: "Live relevant tender", family: "procurement", strength: "very_high", noise: "low", serves: "Both", status: "approved",
      trigger: "Open govt/PSU tender matching vendor keywords (racking, CCTV, IT hardware, signage, printing)",
      sources: ["CPPP", "GeM", "state e-tender portals"], method: "structured_query", entity: "business", polarity: "positive",
      freshness_window: 45, fp_risk: "low", geography: ["india"], pairs: ["SIG-TENDER-AMENDED"], recheck: "weekly",
      proof_captured: "Tender ID, issuing body, value, close date, document URL", confirmation: "1 verified live tender" },
    { signal_id: "SIG-TENDER-RECURRING", name: "Recurring tender cycle", family: "procurement", strength: "medium", noise: "low", serves: "Both", status: "approved",
      trigger: "A body that issued a similar tender in a prior year, window approaching", freshness_window: 120, fp_risk: "low", geography: ["india"] },
    { signal_id: "SIG-TENDER-AMENDED", name: "Tender extended or amended", family: "procurement", strength: "high", noise: "low", serves: "Both", status: "approved",
      trigger: "An existing relevant tender gets a corrigendum or deadline extension", freshness_window: 30, fp_risk: "low", geography: ["india"] },

    { signal_id: "SIG-MONEY-FUNDING", name: "Funding round raised", family: "money", strength: "medium", noise: "medium", serves: "Infra", status: "approved",
      trigger: "A company announces a seed, Series A, or later round", note: "Weak alone — a multiplier, not a standalone trigger", freshness_window: 120, fp_risk: "medium", geography: ["india", "global"], source_unconfirmed: true },
    { signal_id: "SIG-MONEY-ALLOCATION", name: "Sector or region allocation", family: "money", strength: "low", noise: "medium", serves: "Infra", status: "approved",
      trigger: "A PLI scheme, state budget, or subsidy directed at a relevant sector", freshness_window: 180, fp_risk: "medium", geography: ["india"] },

    { signal_id: "SIG-EXP-NEW-FACILITY", name: "New facility announced", family: "expansion", strength: "very_high", noise: "low", serves: "Infra", status: "approved",
      trigger: "News of a new warehouse, dark store, distribution centre, or plant",
      sources: ["Commercial property news", "company press", "industrial news"], method: "ai_classification + keyword_match", entity: "business", polarity: "positive",
      freshness_window: 180, fp_risk: "low", geography: ["india"], pairs: ["SIG-HIRING-OPS-SURGE", "SIG-MONEY-FUNDING", "SIG-LEAD-NEW-OPS"], recheck: "weekly",
      proof_captured: "Article URL, headline, publication, date, location, capacity if stated", confirmation: "≥ 1 credible publication, entity-matched",
      origin: "Seed library — strongest defensible signal", added: "2026-03-01", reviewed: "2026-06-10",
      example: "“BrightHaul to open 220,000 sq ft fulfilment centre in Bhiwandi.”" },
    { signal_id: "SIG-EXP-NEW-GST", name: "New place of business registered", family: "expansion", strength: "high", noise: "medium", serves: "Infra", status: "approved",
      trigger: "A new GST registration or address for an existing company", freshness_window: 90, fp_risk: "medium", geography: ["india"], source_unconfirmed: true },
    { signal_id: "SIG-EXP-LARGE-LEASE", name: "Large commercial lease", family: "expansion", strength: "high", noise: "medium", serves: "Infra", status: "approved",
      trigger: "A sizeable warehouse or retail lease reported", freshness_window: 120, fp_risk: "medium", geography: ["india"] },
    { signal_id: "SIG-EXP-NEW-STORE", name: "New store or outlet opening", family: "expansion", strength: "high", noise: "low", serves: "Mktg", status: "approved",
      trigger: "An announcement of a new branch or store opening", freshness_window: 120, fp_risk: "low", geography: ["india"] },

    { signal_id: "SIG-LEAD-NEW-OPS", name: "New ops decision-maker", family: "leadership", strength: "medium", noise: "low", serves: "Infra", status: "approved",
      trigger: "An actual appointment (not a posting) of a CXO/VP in operations or supply chain", freshness_window: 120, fp_risk: "low", geography: ["india"] },
    { signal_id: "SIG-LEAD-NEW-MKTG", name: "New marketing head", family: "leadership", strength: "medium", noise: "medium", serves: "Mktg", status: "approved",
      trigger: "An appointment of a CMO or marketing director", freshness_window: 120, fp_risk: "medium", geography: ["india"] },

    { signal_id: "SIG-DIG-NEW-LAUNCH", name: "New product or market launch", family: "digital", strength: "medium", noise: "medium", serves: "Both", status: "approved",
      trigger: "A company announces a new category, product line, or market", freshness_window: 90, fp_risk: "medium", geography: ["india"] },
    { signal_id: "SIG-DIG-CAMPAIGN-PUSH", name: "New offline campaign push", family: "digital", strength: "medium", noise: "high", serves: "Mktg", status: "approved",
      trigger: "Evidence of a new go-to-market or outdoor push", note: "Weakest seed signal — candidate to retire if noisy", freshness_window: 60, fp_risk: "high", geography: ["india"] },

    /* two PROPOSED candidates surfaced in interviews — show the approval gate */
    { signal_id: "SIG-EXP-COLD-CHAIN", name: "Cold-chain capacity build", family: "expansion", strength: "high", noise: "low", serves: "Infra", status: "proposed",
      trigger: "Announcement of refrigerated/cold-storage capacity or a temp-controlled DC", freshness_window: 180, fp_risk: "low", geography: ["india"],
      origin: "Surfaced in Meridian Warehouse interview (v3)", proposed_by: "SIA", added: "2026-06-22" },
    { signal_id: "SIG-RETAIL-MALL-ANCHOR", name: "New mall anchor signed", family: "expansion", strength: "medium", noise: "medium", serves: "Mktg", status: "proposed",
      trigger: "A brand signs as anchor tenant in an upcoming mall/high-street", freshness_window: 150, fp_risk: "medium", geography: ["india"],
      origin: "Surfaced in Groundwave interview (v2)", proposed_by: "SIA", added: "2026-06-23" },
  ];

  const mappings = [
    {
      mapping_id: "MAP-WAREHOUSE-EXPANSION", name: "Warehouse expansion", serves: "VEN-INFRA-01", status: "approved",
      intent: "Company is expanding physical warehouse or fulfilment capacity",
      required: ["SIG-EXP-NEW-FACILITY", "SIG-EXP-NEW-GST", "SIG-EXP-LARGE-LEASE", "SIG-TENDER-LIVE"],
      supporting: ["SIG-HIRING-OPS-SURGE", "SIG-HIRING-NEW-CITY", "SIG-MONEY-FUNDING", "SIG-LEAD-NEW-OPS"],
      threshold: "At least one required signal", timing: "Signals within ~180 days; bonus weight when required + supporting fall inside the same ~90 days",
      strength_logic: "One required = moderate. Each fresh supporting lifts it. Required + 2 fresh supporting inside 90 days = top-tier.",
      disqualifiers: ["Announced layoffs / facility shutdown", "Existing client", "Recently pitched"],
      origin: "Seed mapping",
    },
    {
      mapping_id: "MAP-OFFLINE-MARKETING-PUSH", name: "Offline marketing push", serves: "VEN-MKTG-01", status: "approved",
      intent: "Company is about to run a physical, on-the-ground marketing push (posters, outdoor, store-launch promotion)",
      required: ["SIG-EXP-NEW-STORE", "SIG-HIRING-NEW-CITY", "SIG-TENDER-LIVE", "SIG-DIG-NEW-LAUNCH"],
      supporting: ["SIG-HIRING-FIELD-MKTG", "SIG-LEAD-NEW-MKTG", "SIG-DIG-CAMPAIGN-PUSH", "SIG-MONEY-FUNDING"],
      threshold: "At least one required signal", timing: "Same as warehouse (~180 days, ~90 day bonus window)",
      strength_logic: "Same shape: one required = moderate; fresh supporting signals lift it.",
      disqualifiers: ["Distress signals", "Existing client", "Recently pitched"],
      origin: "Seed mapping",
    },
  ];

  /* Sample leads — realistic India-first companies. why_now = real proof lines. */
  const leads = [
    {
      lead_id: "LEAD-2041", vendor_id: "VEN-INFRA-01", mapping_id: "MAP-WAREHOUSE-EXPANSION",
      company: "BrightHaul Logistics", does: "D2C fulfilment & last-mile 3PL", geo: "Bhiwandi, MH",
      score: 92, heat: "hot", stage: "sourced", outreach: "operator_handles", created: "2026-06-23",
      intent: "Building 220k sq ft fulfilment capacity — racking, CCTV, networking all in scope.",
      why_them: "A scaling 3PL standing up a large new fulfilment centre — exactly Meridian's turnkey fit-out sweet spot, in-region (Bhiwandi).",
      why_now: [
        { sig: "SIG-EXP-NEW-FACILITY", claim: "Announced a 220,000 sq ft fulfilment centre in Bhiwandi.", date: "2026-06-18", source: "commercial property news", window: 180, evidence: "#" },
        { sig: "SIG-HIRING-OPS-SURGE", claim: "7 warehouse & fulfilment roles opened across Bhiwandi and Pune in 5 weeks.", date: "2026-06-10", source: "Naukri + LinkedIn", window: 60, evidence: "#" },
        { sig: "SIG-MONEY-FUNDING", claim: "Closed a ₹140cr Series B led by a logistics-focused fund.", date: "2026-05-02", source: "funding news", window: 120, evidence: "#" },
      ],
      what_they_need: "Turnkey interior fit-out at scale and on a deadline: heavy-duty racking, CCTV + networking, electricals, and facility readiness before peak season.",
      hook: "Saw BrightHaul's Bhiwandi FC announcement — Meridian fits out DCs this size in 6–8 weeks, racking-to-networking, and can float materials so your capex timing isn't the bottleneck. Worth 20 minutes before you lock contractors?",
      why_this_vendor: "Meridian does exactly this size band (10k–100k+ sq ft) in-region, turnkey, with a 6–8 week track record and material-financing — directly de-risking BrightHaul's deadline.",
      objections: [
        { o: "“We already have a contractor shortlist.”", c: "Meridian's float-materials option and 6–8 wk turnkey can beat a multi-vendor critical path; offer a parallel quote." },
        { o: "“Budget is committed to the building.”", c: "Material financing up to ₹2cr defers fit-out capex — the reason to talk now, not later." },
      ],
      disqualifier_check: "passed",
      contacts: [
        { name: "Rohan Mehta", role: "VP Operations", why: "Owns the fit-out & timeline decision for the new FC", warm: { status: "warm", detail: "2nd-degree via a shared ex-Delhivery contact" },
          paths: [ { type: "linkedin", val: "in/rohanmehta-ops", conf: "high", source: "LinkedIn" }, { type: "email", val: "r.mehta@brighthaul.in", conf: "medium", source: "Apollo" }, { type: "phone", val: null } ] },
        { name: "Priya Nair", role: "Head of Supply Chain", why: "Co-signs infrastructure capex", warm: { status: "cold" },
          paths: [ { type: "linkedin", val: "in/priyanair-sc", conf: "high", source: "LinkedIn" }, { type: "email", val: null } ] },
      ],
    },
    {
      lead_id: "LEAD-2038", vendor_id: "VEN-INFRA-01", mapping_id: "MAP-WAREHOUSE-EXPANSION",
      company: "Saffron Foods Pvt Ltd", does: "Packaged & frozen foods manufacturer", geo: "Pune, MH",
      score: 78, heat: "warm", stage: "contacted", outreach: "operator_handles", created: "2026-06-15",
      intent: "Large warehouse lease + ops leadership hire point to a distribution build-out.",
      why_them: "A frozen-foods maker leasing big and hiring ops leadership — a distribution expansion that needs racking, cold-aware fit-out, and networking.",
      why_now: [
        { sig: "SIG-EXP-LARGE-LEASE", claim: "Leased ~95,000 sq ft of warehousing on the Pune–Solapur corridor.", date: "2026-05-20", source: "commercial real-estate report", window: 120, evidence: "#" },
        { sig: "SIG-LEAD-NEW-OPS", claim: "Appointed a new VP of Supply Chain (ex-cold-chain major).", date: "2026-06-01", source: "company press", window: 120, evidence: "#" },
      ],
      what_they_need: "Racking, electricals and networking for a new distribution warehouse; possible cold-chain-adjacent readiness.",
      hook: "Congrats on the Pune–Solapur warehouse — Meridian fits out distribution space this size turnkey, and with your new SC leader settling in we can move fast on racking + networking. Open to a quick scoping call?",
      why_this_vendor: "In-region, right size band, fast turnkey — and material financing eases the lease-plus-fit-out cash crunch.",
      objections: [
        { o: "“Cold-chain is specialised.”", c: "Position Meridian on the ambient + electricals + networking scope; partner-refer the refrigeration if needed." },
      ],
      disqualifier_check: "passed",
      contacts: [
        { name: "Anjali Deshpande", role: "VP Supply Chain", why: "New decision-maker for the distribution build", warm: { status: "cold" },
          paths: [ { type: "linkedin", val: "in/anjali-deshpande", conf: "high", source: "LinkedIn" }, { type: "email", val: "anjali.d@saffronfoods.in", conf: "medium", source: "Apollo" } ] },
      ],
    },
    {
      lead_id: "LEAD-2044", vendor_id: "VEN-MKTG-01", mapping_id: "MAP-OFFLINE-MARKETING-PUSH",
      company: "Tilt Athleisure", does: "D2C athleisure brand", geo: "Bengaluru, KA",
      score: 88, heat: "hot", stage: "engaged", outreach: "handed_to_vendor", created: "2026-06-20",
      intent: "First offline stores + new-city hiring = a launch that needs ground marketing.",
      why_them: "A digital-first brand going physical in two metros — prime for store-launch activation, signage, and promoter staffing.",
      why_now: [
        { sig: "SIG-EXP-NEW-STORE", claim: "Announced first 3 flagship stores (Bengaluru, Hyderabad).", date: "2026-06-12", source: "retail trade press", window: 120, evidence: "#" },
        { sig: "SIG-HIRING-FIELD-MKTG", claim: "Hiring promoters and store-launch staff across both cities.", date: "2026-06-16", source: "LinkedIn + Apna", window: 60, evidence: "#" },
        { sig: "SIG-DIG-NEW-LAUNCH", claim: "Teasing an offline-exclusive product capsule.", date: "2026-06-09", source: "brand social", window: 90, evidence: "#" },
      ],
      what_they_need: "Store-launch activation, outdoor & signage, and a promoter network across Bengaluru and Hyderabad on a tight launch calendar.",
      hook: "Tilt going offline is a moment — Groundwave runs 48-hr store-launch activations with a pan-metro promoter network, so Bengaluru + Hyderabad can open loud and on schedule. Want the launch playbook?",
      why_this_vendor: "Groundwave's 48-hr activation and multi-city promoter bench fit a simultaneous two-metro launch better than a single-city agency.",
      objections: [
        { o: "“Our brand team handles launch.”", c: "Position Groundwave as the on-ground execution arm, not brand strategy — promoters, signage, logistics." },
      ],
      disqualifier_check: "passed",
      contacts: [
        { name: "Karan Shah", role: "Head of Retail", why: "Owns the store-launch calendar & vendors", warm: { status: "warm", detail: "Operator has a direct intro via a Bengaluru retail group" },
          paths: [ { type: "linkedin", val: "in/karanshah-retail", conf: "high", source: "LinkedIn" }, { type: "email", val: "karan@tilt.club", conf: "high", source: "verified" }, { type: "phone", val: "+91 ••• ••• 4412", conf: "medium", source: "Apollo" } ] },
      ],
    },
    { lead_id: "LEAD-2031", vendor_id: "VEN-INFRA-01", mapping_id: "MAP-WAREHOUSE-EXPANSION",
      company: "NorthDock Supply Co", does: "Industrial supplies distributor", geo: "Nagpur, MH",
      score: 64, heat: "warm", stage: "pitched", outreach: "operator_handles", created: "2026-06-05",
      intent: "Live tender for racking + a GST registration in a new district.", disqualifier_check: "passed",
      why_now: [
        { sig: "SIG-TENDER-LIVE", claim: "Floated a tender for pallet racking & shelving (₹40L est).", date: "2026-06-02", source: "state e-tender portal", window: 45, evidence: "#" },
        { sig: "SIG-EXP-NEW-GST", claim: "Registered a new place of business in Nagpur.", date: "2026-04-28", source: "GST registry", window: 90, evidence: "#" },
      ], contacts: [] },
    { lead_id: "LEAD-2049", vendor_id: "VEN-MKTG-01", mapping_id: "MAP-OFFLINE-MARKETING-PUSH",
      company: "Greenheart Organics", does: "Organic grocery retail chain", geo: "Hyderabad, TS",
      score: 71, heat: "warm", stage: "won", outreach: "handed_to_vendor", created: "2026-05-22",
      intent: "Four new outlets across two cities — launch activation in motion.", disqualifier_check: "passed",
      why_now: [
        { sig: "SIG-EXP-NEW-STORE", claim: "Opening 4 outlets across Hyderabad & Vijayawada this quarter.", date: "2026-05-18", source: "retail press", window: 120, evidence: "#" },
        { sig: "SIG-LEAD-NEW-MKTG", claim: "Hired a new Marketing Director from a QSR chain.", date: "2026-05-10", source: "company press", window: 120, evidence: "#" },
      ], contacts: [] },
  ];

  /* Holding pool — good leads no current vendor fits (stubbed surface) */
  const holding = [
    { company: "Aerolyte Components", does: "EV component manufacturer", reason: "Export logistics need — no vendor with export-grade supply support", signal: "SIG-EXP-NEW-FACILITY", date: "2026-06-14" },
    { company: "Lumen Retail", does: "Electronics retail chain", reason: "Needs visual-merchandising fit-out (outside both vendors' scope)", signal: "SIG-EXP-NEW-STORE", date: "2026-06-08" },
  ];

  /* Pipeline commission samples */
  const commissions = [
    { lead_id: "LEAD-2049", company: "Greenheart Organics", vendor: "Groundwave", type: "one_time", amount: "₹1,80,000", status: "due", stage: "won" },
    { lead_id: "LEAD-2012", company: "Cobalt 3PL", vendor: "Meridian", type: "recurring", amount: "₹45,000 / qtr", status: "cycle_due", next: "2026-07-01", stage: "paid" },
    { lead_id: "LEAD-1998", company: "Vista Mart", vendor: "Groundwave", type: "recurring", amount: "₹30,000 / mo", status: "missed", next: "2026-06-01", stage: "delivered" },
  ];

  const families = ["hiring", "procurement", "money", "expansion", "leadership", "digital"];
  const stages = ["sourced", "contacted", "engaged", "pitched", "won", "lost", "delivered", "paid"];

  return { TODAY, daysAgo, ago, fmtDate, freshness, vendors, signals, mappings, leads, holding, commissions, families, stages,
    signalById: (id) => signals.find((s) => s.signal_id === id),
    leadsForVendor: (vid) => leads.filter((l) => l.vendor_id === vid) };
})();
