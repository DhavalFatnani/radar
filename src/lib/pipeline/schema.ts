// Pure pipeline-stage domain model. Mirrors the pipeline_stage enum in
// src/db/schema/enums.ts. No imports from @/db, @/ai, or server-only — safe to
// import from client components and tests. Mirrors the canTransition precedent in
// src/lib/signals/schema.ts.

// Enum union — mirror src/db/schema/enums.ts pipelineStage EXACTLY, same order.
export const PIPELINE_STAGES = [
  "sourced",
  "contacted",
  "engaged",
  "pitched",
  "won",
  "lost",
  "delivered",
  "paid",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Human-readable labels for display.
export const STAGE_LABELS: Record<PipelineStage, string> = {
  sourced: "Sourced",
  contacted: "Contacted",
  engaged: "Engaged",
  pitched: "Pitched",
  won: "Won",
  lost: "Lost",
  delivered: "Delivered",
  paid: "Paid",
};

// Column order for the board — funnel order with the terminal `lost` moved last.
// A permutation of PIPELINE_STAGES (whose order is locked to the DB enum).
export const BOARD_ORDER: PipelineStage[] = [
  "sourced",
  "contacted",
  "engaged",
  "pitched",
  "won",
  "delivered",
  "paid",
  "lost",
];

// The legal forward moves. `lost` is an escape hatch from the active pre-win
// stages only — a won/delivered/paid deal is never "lost". Forward-only: no
// backward edges (backward correction is a later enhancement).
const ALLOWED: Record<PipelineStage, PipelineStage[]> = {
  sourced: ["contacted", "lost"],
  contacted: ["engaged", "lost"],
  engaged: ["pitched", "lost"],
  pitched: ["won", "lost"],
  won: ["delivered"],
  delivered: ["paid"],
  paid: [],
  lost: [],
};

export function canAdvance(from: PipelineStage, to: PipelineStage): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function nextStages(from: PipelineStage): PipelineStage[] {
  return ALLOWED[from] ?? [];
}

export function isTerminal(stage: PipelineStage): boolean {
  return nextStages(stage).length === 0;
}

// Board read shape returned by the data layer.
export type LeadCard = {
  leadId: string;
  companyName: string;
  vendorName: string;
  intent: string | null;
  score: number | null;
  stage: PipelineStage;
  hasBrief: boolean;
  hasContactBlock: boolean;
  createdAt: Date;
};
