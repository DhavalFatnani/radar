/* ============================================================================
   Radar v2 — interactive graph engine (SVG).
   Renders a node-link graph with hover-highlight, click-to-select, pan + zoom.
   Two deterministic builders: the catalogue network, and a mapping flow.
   Styles come from v2.css (.gnode/.gedge). Exposes window.radarGraph.
   ========================================================================== */
window.radarGraph = (function () {
  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

  function render(svg, model, opts) {
    opts = opts || {};
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const W = model.w || 1000, H = model.h || 700;
    const gEdges = mk("g", {}, svg), gNodes = mk("g", {}, svg);
    const byId = {}; model.nodes.forEach((n) => (byId[n.id] = n));

    const edgeEls = model.edges.map((ed) => {
      const a = byId[ed.from], b = byId[ed.to]; if (!a || !b) return null;
      const mx = (a.x + b.x) / 2;
      const d = `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
      return { ed, p: mk("path", { class: `gedge ${ed.kind || ""}`, d }, gEdges), a: a.id, b: b.id };
    }).filter(Boolean);

    const nodeEls = model.nodes.map((n) => {
      const g = mk("g", { class: `gnode ${n.type}${n.pulse ? " pulse" : ""}`, transform: `translate(${n.x},${n.y})`, tabindex: "0" }, gNodes);
      const w = n.w || Math.max(72, n.label.length * 6.6 + 26), h = n.sub ? 34 : 28;
      mk("rect", { class: "body", x: -w / 2, y: -h / 2, width: w, height: h, rx: 9 }, g);
      const t = mk("text", { x: 0, y: n.sub ? -2 : 4, "text-anchor": "middle" }, g); t.textContent = n.label;
      if (n.sub) { const s = mk("text", { class: "sub", x: 0, y: 11, "text-anchor": "middle" }, g); s.textContent = n.sub; }
      return { n, g };
    });

    const neighbors = (id) => { const ns = new Set([id]); edgeEls.forEach((e) => { if (e.a === id) ns.add(e.b); if (e.b === id) ns.add(e.a); }); return ns; };
    const reset = () => { nodeEls.forEach((x) => x.g.classList.remove("dim", "active")); edgeEls.forEach((e) => e.p.classList.remove("hot", "dim")); };
    nodeEls.forEach((ne) => {
      const enter = () => {
        const ns = neighbors(ne.n.id);
        nodeEls.forEach((x) => { x.g.classList.toggle("dim", !ns.has(x.n.id)); x.g.classList.toggle("active", x.n.id === ne.n.id); });
        edgeEls.forEach((e) => { const on = e.a === ne.n.id || e.b === ne.n.id; e.p.classList.toggle("hot", on); e.p.classList.toggle("dim", !on); });
      };
      ne.g.addEventListener("mouseenter", enter);
      ne.g.addEventListener("focus", enter);
      ne.g.addEventListener("mouseleave", reset);
      ne.g.addEventListener("blur", reset);
      ne.g.addEventListener("click", () => opts.onSelect && opts.onSelect(ne.n));
      ne.g.addEventListener("keydown", (e) => { if (e.key === "Enter") opts.onSelect && opts.onSelect(ne.n); });
    });

    // pan + zoom via viewBox
    let vb = { x: 0, y: 0, w: W, h: H };
    const apply = () => svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    apply();
    let drag = null;
    svg.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y }; try { svg.setPointerCapture(e.pointerId); } catch (_) {} });
    svg.addEventListener("pointermove", (e) => { if (!drag) return; const sc = vb.w / (svg.clientWidth || W); vb.x = drag.vx - (e.clientX - drag.x) * sc; vb.y = drag.vy - (e.clientY - drag.y) * sc; apply(); });
    const end = () => (drag = null);
    svg.addEventListener("pointerup", end); svg.addEventListener("pointerleave", end);
    svg.addEventListener("wheel", (e) => { e.preventDefault(); const f = e.deltaY > 0 ? 1.12 : 0.89; zoomBy(f); }, { passive: false });
    function zoomBy(f) { const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2; vb.w = Math.max(260, Math.min(2400, vb.w * f)); vb.h = vb.w * (H / W); vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2; apply(); }
    return { zoomIn: () => zoomBy(0.82), zoomOut: () => zoomBy(1.2), reset: () => { vb = { x: 0, y: 0, w: W, h: H }; apply(); } };
  }

  // ---- Builder: catalogue network (vendor <-> capability <-> geography; gaps) -
  function catalogueModel() {
    const R = window.RADAR, nodes = [], edges = [];
    const caps = {
      "VEN-INFRA-01": ["Racking", "CCTV & networking", "Electricals", "Facility fit-out", "Cold-chain"],
      "VEN-MKTG-01": ["Outdoor & signage", "Promoter staffing", "Store activation"],
    };
    const W = 1080, H = 640, xCap = 190, xVen = 540, xGeo = 880;
    const vens = R.vendors;
    vens.forEach((v, i) => nodes.push({ id: v.vendor_id, type: "vendor", label: v.short === "Infra" ? "Meridian · Infra" : "Groundwave · Mktg", sub: v.size, x: xVen, y: H * (i + 1) / (vens.length + 1), w: 156 }));
    let capList = []; vens.forEach((v) => (caps[v.vendor_id] || []).forEach((c) => { if (!capList.includes(c)) capList.push(c); }));
    capList.forEach((c, i) => nodes.push({ id: "cap:" + c, type: "capability", label: c, x: xCap, y: 60 + i * 64 }));
    vens.forEach((v) => (caps[v.vendor_id] || []).forEach((c) => edges.push({ from: v.vendor_id, to: "cap:" + c })));
    let geoList = []; vens.forEach((v) => v.geographies.forEach((g) => { if (!geoList.includes(g)) geoList.push(g); }));
    geoList.forEach((g, i) => { const shared = vens.filter((v) => v.geographies.includes(g)).length > 1; nodes.push({ id: "geo:" + g, type: "geography", label: g, sub: shared ? "shared region" : "", x: xGeo, y: 80 + i * 70, pulse: shared }); });
    vens.forEach((v) => v.geographies.forEach((g) => { const shared = vens.filter((x) => x.geographies.includes(g)).length > 1; edges.push({ from: v.vendor_id, to: "geo:" + g, kind: shared ? "required" : "" }); }));
    // gaps from the holding pool — unmet needs, no vendor
    (R.holding || []).forEach((h, i) => nodes.push({ id: "gap:" + i, type: "signal", label: "GAP · " + h.company, sub: "no vendor fit", x: xVen, y: H - 30 - i * 50, pulse: true }));
    return { nodes, edges, w: W, h: H, meta: { byId: nodes.reduce((m, n) => ((m[n.id] = n), m), {}) } };
  }

  // ---- Builder: mapping flow (signals -> mapping -> vendor; disqualifiers) ----
  function mappingFlowModel(mappingId) {
    const R = window.RADAR, m = R.mappings.find((x) => x.mapping_id === mappingId) || R.mappings[0];
    const nodes = [], edges = [], xSig = 200, xMap = 580, xVen = 900;
    const req = m.required || [], sup = m.supporting || [];
    const reqY0 = 80, gap = 56;
    req.forEach((sid, i) => { nodes.push({ id: sid, type: "signal", label: sid.replace("SIG-", ""), sub: "required", x: xSig, y: reqY0 + i * gap }); edges.push({ from: sid, to: "map", kind: "required" }); });
    const supY0 = reqY0 + req.length * gap + 36;
    sup.forEach((sid, i) => { nodes.push({ id: sid + "_s", type: "signal", label: sid.replace("SIG-", ""), sub: "supporting", x: xSig, y: supY0 + i * gap }); edges.push({ from: sid + "_s", to: "map" }); });
    const H = Math.max(560, supY0 + sup.length * gap + 70);
    nodes.push({ id: "map", type: "mapping", label: m.name, sub: "≥1 required to fire", x: xMap, y: H / 2 - 30, w: 168 });
    const v = R.vendors.find((x) => x.vendor_id === m.serves) || {};
    nodes.push({ id: "ven", type: "vendor", label: (v.name || "Vendor").split(" ")[0] + " lead", sub: "fires a scored lead", x: xVen, y: H / 2 - 30, w: 150 });
    edges.push({ from: "map", to: "ven", kind: "required" });
    nodes.push({ id: "disq", type: "signal", label: "Disqualifiers", sub: "veto the match", x: xMap, y: H - 50 });
    edges.push({ from: "disq", to: "map", kind: "disq" });
    return { nodes, edges, w: 1080, h: H };
  }

  return { render, catalogueModel, mappingFlowModel };
})();
