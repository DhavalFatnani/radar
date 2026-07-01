// src/app/(app)/catalogue/graph-engine.ts
// Framework-agnostic SVG graph engine. Ported from mockups/v2/assets/graph.js.
// Draws a node-link graph with hover-highlight, click/Enter select, pan + zoom.
// Node/edge visuals come from v2.css (.gnode / .gedge). No React, no DB.
import type { RenderModel, RenderNode } from "@/lib/catalogue/schema";

const NS = "http://www.w3.org/2000/svg";

function mk(tag: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
  const el = document.createElementNS(NS, tag) as SVGElement;
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(el);
  return el;
}

export type GraphController = { zoomIn: () => void; zoomOut: () => void; reset: () => void };

export function renderGraph(
  svg: SVGSVGElement,
  model: RenderModel,
  opts: { onSelect?: (n: RenderNode) => void } = {},
): GraphController {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const W = model.w || 1000;
  const H = model.h || 700;
  const gEdges = mk("g", {}, svg);
  const gNodes = mk("g", {}, svg);
  const byId: Record<string, RenderNode> = {};
  model.nodes.forEach((n) => (byId[n.id] = n));

  const edgeEls = model.edges
    .map((ed) => {
      const a = byId[ed.from];
      const b = byId[ed.to];
      if (!a || !b) return null;
      const mx = (a.x + b.x) / 2;
      const d = `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
      const p = mk("path", { class: `gedge ${ed.kind || ""}`, d }, gEdges);
      return { p, a: a.id, b: b.id };
    })
    .filter((x): x is { p: SVGElement; a: string; b: string } => x !== null);

  const nodeEls = model.nodes.map((n) => {
    const g = mk(
      "g",
      { class: `gnode ${n.type}${n.pulse ? " pulse" : ""}`, transform: `translate(${n.x},${n.y})`, tabindex: "0" },
      gNodes,
    );
    const w = n.w || Math.max(72, n.label.length * 6.6 + 26);
    const h = n.sub ? 34 : 28;
    mk("rect", { class: "body", x: -w / 2, y: -h / 2, width: w, height: h, rx: 9 }, g);
    const t = mk("text", { x: 0, y: n.sub ? -2 : 4, "text-anchor": "middle" }, g);
    t.textContent = n.label;
    if (n.sub) {
      const s = mk("text", { class: "sub", x: 0, y: 11, "text-anchor": "middle" }, g);
      s.textContent = n.sub;
    }
    return { n, g };
  });

  const neighbors = (id: string) => {
    const ns = new Set([id]);
    edgeEls.forEach((e) => {
      if (e.a === id) ns.add(e.b);
      if (e.b === id) ns.add(e.a);
    });
    return ns;
  };
  const clear = () => {
    nodeEls.forEach((x) => x.g.classList.remove("dim", "active"));
    edgeEls.forEach((e) => e.p.classList.remove("hot", "dim"));
  };
  nodeEls.forEach((ne) => {
    const enter = () => {
      const ns = neighbors(ne.n.id);
      nodeEls.forEach((x) => {
        x.g.classList.toggle("dim", !ns.has(x.n.id));
        x.g.classList.toggle("active", x.n.id === ne.n.id);
      });
      edgeEls.forEach((e) => {
        const on = e.a === ne.n.id || e.b === ne.n.id;
        e.p.classList.toggle("hot", on);
        e.p.classList.toggle("dim", !on);
      });
    };
    ne.g.addEventListener("mouseenter", enter);
    ne.g.addEventListener("focus", enter);
    ne.g.addEventListener("mouseleave", clear);
    ne.g.addEventListener("blur", clear);
    ne.g.addEventListener("click", () => opts.onSelect?.(ne.n));
    ne.g.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") opts.onSelect?.(ne.n);
    });
  });

  // pan + zoom via viewBox
  let vb = { x: 0, y: 0, w: W, h: H };
  const apply = () => svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  apply();
  let drag: { x: number; y: number; vx: number; vy: number } | null = null;
  svg.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y };
    // setPointerCapture is absent in jsdom and can throw if the pointer is already
    // released; a failure here only means smoother drag capture is unavailable.
    if (typeof svg.setPointerCapture === "function") {
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* non-fatal: pointer capture unsupported/unavailable */
      }
    }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const sc = vb.w / (svg.clientWidth || W);
    vb.x = drag.vx - (e.clientX - drag.x) * sc;
    vb.y = drag.vy - (e.clientY - drag.y) * sc;
    apply();
  });
  const end = () => (drag = null);
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointerleave", end);
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? 1.12 : 0.89);
    },
    { passive: false },
  );
  function zoomBy(f: number) {
    const cx = vb.x + vb.w / 2;
    const cy = vb.y + vb.h / 2;
    vb.w = Math.max(260, Math.min(2400, vb.w * f));
    vb.h = vb.w * (H / W);
    vb.x = cx - vb.w / 2;
    vb.y = cy - vb.h / 2;
    apply();
  }
  return {
    zoomIn: () => zoomBy(0.82),
    zoomOut: () => zoomBy(1.2),
    reset: () => {
      vb = { x: 0, y: 0, w: W, h: H };
      apply();
    },
  };
}
