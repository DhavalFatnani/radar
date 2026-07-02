/**
 * Pure, DB-free lead scoring — the formalization of Phase0 §12's deferred formula.
 * See docs/superpowers/specs/2026-07-02-phase4-slice2-matching-scoring-design.md §5.
 * No @/db import: this module is client-safe and unit-tested with hand-built inputs.
 */

export type SignalStrength = "low" | "medium" | "high" | "very_high";
export type SignalPolarity = "positive" | "negative" | "contextual";
export type FreshnessVerdict = "recent" | "stale" | null;

/** One observation as the scorer needs it (DB-agnostic). */
export type ScoredObservation = {
  signalId: string;
  detectedAt: Date;
  freshnessVerdict: FreshnessVerdict;
  strength: SignalStrength | null;
  polarity: SignalPolarity | null;
};

/** The mapping fields the scorer needs. */
export type ScoringMapping = {
  requiredSignals: string[];
  supportingSignals: string[];
  timingWindowDays: number | null;
};

export type ScoreResult = {
  fired: boolean;                 // ≥1 eligible required observation
  disqualified: boolean;          // a negative-polarity observation sits within the window
  score: number;                  // 0..100; 0 when !fired or disqualified
  contributingSignals: string[];  // distinct signalIds that contributed to the score
};

const STRENGTH_WEIGHT: Record<SignalStrength, number> = {
  very_high: 1.0,
  high: 0.7,
  medium: 0.4,
  low: 0.2,
};
const DEFAULT_STRENGTH_WEIGHT = 0.4; // unknown strength → treat as medium

function strengthWeight(s: SignalStrength | null): number {
  return s == null ? DEFAULT_STRENGTH_WEIGHT : STRENGTH_WEIGHT[s];
}

function recencyMultiplier(v: FreshnessVerdict): number {
  if (v === "recent") return 1.0;
  if (v === "stale") return 0.5;
  return 0.75; // null / unknown
}

function contribution(o: ScoredObservation): number {
  return strengthWeight(o.strength) * recencyMultiplier(o.freshnessVerdict);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function withinWindow(o: ScoredObservation, timingWindowDays: number | null, now: Date): boolean {
  if (timingWindowDays == null) return true;
  const ageDays = (now.getTime() - o.detectedAt.getTime()) / MS_PER_DAY;
  return ageDays <= timingWindowDays;
}

/**
 * Score a single mapping against one company's observations. Pure and deterministic.
 * Fire gate: ≥1 eligible required observation. Disqualifier gate: any negative-polarity
 * observation within the window (independent of the contributing-signal sets).
 */
export function scoreMapping(
  mapping: ScoringMapping,
  observations: ScoredObservation[],
  now: Date,
): ScoreResult {
  const required = new Set(mapping.requiredSignals ?? []);
  const supporting = new Set(mapping.supportingSignals ?? []);

  const disqualified = observations.some(
    (o) => o.polarity === "negative" && withinWindow(o, mapping.timingWindowDays, now),
  );

  const eligible = observations.filter(
    (o) =>
      (required.has(o.signalId) || supporting.has(o.signalId)) &&
      withinWindow(o, mapping.timingWindowDays, now),
  );
  const eligibleRequired = eligible.filter((o) => required.has(o.signalId));
  const eligibleSupporting = eligible.filter((o) => supporting.has(o.signalId));
  const fired = eligibleRequired.length > 0;

  if (disqualified || !fired) {
    return { fired, disqualified, score: 0, contributingSignals: [] };
  }

  const req = Math.max(...eligibleRequired.map(contribution));
  const sup = eligibleSupporting.reduce((sum, o) => sum + contribution(o), 0);
  const raw = 0.6 * req + 0.4 * Math.min(1, sup / 2);
  const score = Math.round(100 * Math.min(1, raw));

  const contributingSignals = [
    ...new Set([...eligibleRequired, ...eligibleSupporting].map((o) => o.signalId)),
  ];

  return { fired: true, disqualified: false, score, contributingSignals };
}
