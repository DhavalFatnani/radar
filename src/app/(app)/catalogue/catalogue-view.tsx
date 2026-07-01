"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CatalogueGraph, RenderNode, MatchedVendor } from "@/lib/catalogue/schema";
import { catalogueLayout } from "./graph-layout";
import { renderGraph, type GraphController } from "./graph-engine";
import { matchVendorsAction } from "./actions";

const LEGEND: [string, string][] = [
  ["vendor", "var(--accent)"],
  ["capability", "var(--stage-engaged)"],
  ["geography", "var(--fresh-recent)"],
];

export function CatalogueView({ graph }: { graph: CatalogueGraph }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const ctrlRef = useRef<GraphController | null>(null);
  const [selected, setSelected] = useState<RenderNode | null>(null);

  const [capability, setCapability] = useState("");
  const [geography, setGeography] = useState("");
  const [matches, setMatches] = useState<MatchedVendor[] | null>(null);
  const [matching, setMatching] = useState(false);

  const model = useMemo(() => catalogueLayout(graph), [graph]);
  const capLabels = useMemo(
    () => graph.nodes.filter((n) => n.type === "capability").map((n) => n.label).sort(),
    [graph],
  );
  const geoLabels = useMemo(
    () => graph.nodes.filter((n) => n.type === "geography").map((n) => n.label).sort(),
    [graph],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    ctrlRef.current = renderGraph(svg, model, { onSelect: setSelected });
  }, [model]);

  async function onMatch() {
    setMatching(true);
    const q = {
      ...(capability ? { capability } : {}),
      ...(geography ? { geography } : {}),
    };
    setMatches(await matchVendorsAction(q));
    setMatching(false);
  }

  return (
    <>
      <div className="cat-toolbar">
        <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
          drag to pan · scroll to zoom · hover a node to trace its links
        </span>
      </div>
      <div className="cat-layout">
        <div className="graph-wrap" id="gwrap">
          <svg ref={svgRef} id="graph" role="img" aria-label="Catalogue graph" />
          <div className="graph-legend" aria-hidden="true">
            {LEGEND.map(([label, color]) => (
              <span className="k" style={{ ["--c" as string]: color }} key={label}>
                {label}
              </span>
            ))}
          </div>
          <div className="graph-zoom">
            <button type="button" aria-label="Zoom in" onClick={() => ctrlRef.current?.zoomIn()}>
              +
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => ctrlRef.current?.zoomOut()}>
              −
            </button>
            <button type="button" aria-label="Reset" onClick={() => ctrlRef.current?.reset()}>
              ⤢
            </button>
          </div>
        </div>

        <aside className="cat-panel card card-pad">
          {selected ? (
            <div className="node-detail">
              <div className="nd-type">{selected.type}</div>
              <div className="nd-name">{selected.label}</div>
              {selected.sub && <p className="lead-in">{selected.sub}</p>}
            </div>
          ) : (
            <>
              <h3>The vendor network</h3>
              <p className="lead-in">
                Every vendor, capability and geography as one connected surface — click a node to inspect
                it, or match a need below.
              </p>
            </>
          )}

          <form
            className="match-form"
            onSubmit={(e) => {
              e.preventDefault();
              void onMatch();
            }}
          >
            <label htmlFor="mcap">Capability</label>
            <select id="mcap" value={capability} onChange={(e) => setCapability(e.target.value)}>
              <option value="">Any capability</option>
              {capLabels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label htmlFor="mgeo">Geography</label>
            <select id="mgeo" value={geography} onChange={(e) => setGeography(e.target.value)}>
              <option value="">Any geography</option>
              {geoLabels.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary" disabled={matching || (!capability && !geography)}>
              Match
            </button>
          </form>

          {matches !== null && (
            <div className="match-results">
              {matches.length === 0 ? (
                <p className="muted">No vendors match that need yet.</p>
              ) : (
                <ul className="match-list">
                  {matches.map((v) => (
                    <li key={v.vendorId}>
                      <Link href={`/vendors/${v.vendorId}`}>{v.name}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
