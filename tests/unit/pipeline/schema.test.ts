import { describe, it, expect } from "vitest";
import {
  PIPELINE_STAGES,
  BOARD_ORDER,
  STAGE_LABELS,
  canAdvance,
  nextStages,
  isTerminal,
  type PipelineStage,
} from "@/lib/pipeline/schema";

// Must mirror src/db/schema/enums.ts pipelineStage exactly, same order.
const ENUM_ORDER: PipelineStage[] = [
  "sourced",
  "contacted",
  "engaged",
  "pitched",
  "won",
  "lost",
  "delivered",
  "paid",
];

describe("pipeline stage model", () => {
  it("PIPELINE_STAGES mirrors the DB enum exactly and in order", () => {
    expect([...PIPELINE_STAGES]).toEqual(ENUM_ORDER);
  });

  it("STAGE_LABELS provides a non-empty label for every stage", () => {
    for (const s of PIPELINE_STAGES) {
      expect(STAGE_LABELS[s]).toBeTruthy();
    }
  });

  it("BOARD_ORDER is a permutation of PIPELINE_STAGES with lost placed last", () => {
    expect([...BOARD_ORDER].sort()).toEqual([...PIPELINE_STAGES].sort());
    expect(BOARD_ORDER[BOARD_ORDER.length - 1]).toBe("lost");
  });

  it("canAdvance accepts every legal forward edge", () => {
    expect(canAdvance("sourced", "contacted")).toBe(true);
    expect(canAdvance("contacted", "engaged")).toBe(true);
    expect(canAdvance("engaged", "pitched")).toBe(true);
    expect(canAdvance("pitched", "won")).toBe(true);
    expect(canAdvance("won", "delivered")).toBe(true);
    expect(canAdvance("delivered", "paid")).toBe(true);
  });

  it("canAdvance allows lost only from the active pre-win stages", () => {
    expect(canAdvance("sourced", "lost")).toBe(true);
    expect(canAdvance("contacted", "lost")).toBe(true);
    expect(canAdvance("engaged", "lost")).toBe(true);
    expect(canAdvance("pitched", "lost")).toBe(true);
    expect(canAdvance("won", "lost")).toBe(false);
    expect(canAdvance("delivered", "lost")).toBe(false);
    expect(canAdvance("paid", "lost")).toBe(false);
  });

  it("canAdvance rejects skip-ahead and backward moves", () => {
    expect(canAdvance("sourced", "engaged")).toBe(false);
    expect(canAdvance("sourced", "won")).toBe(false);
    expect(canAdvance("engaged", "contacted")).toBe(false);
    expect(canAdvance("won", "pitched")).toBe(false);
    expect(canAdvance("paid", "delivered")).toBe(false);
    expect(canAdvance("sourced", "sourced")).toBe(false);
  });

  it("nextStages returns the exact legal targets per stage", () => {
    expect(nextStages("sourced")).toEqual(["contacted", "lost"]);
    expect(nextStages("contacted")).toEqual(["engaged", "lost"]);
    expect(nextStages("engaged")).toEqual(["pitched", "lost"]);
    expect(nextStages("pitched")).toEqual(["won", "lost"]);
    expect(nextStages("won")).toEqual(["delivered"]);
    expect(nextStages("delivered")).toEqual(["paid"]);
    expect(nextStages("paid")).toEqual([]);
    expect(nextStages("lost")).toEqual([]);
  });

  it("isTerminal is true only for paid and lost", () => {
    expect(isTerminal("paid")).toBe(true);
    expect(isTerminal("lost")).toBe(true);
    for (const s of [
      "sourced",
      "contacted",
      "engaged",
      "pitched",
      "won",
      "delivered",
    ] as PipelineStage[]) {
      expect(isTerminal(s)).toBe(false);
    }
  });
});
