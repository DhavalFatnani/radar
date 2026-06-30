import type { LlmMessage } from "@/ai/llm";
import type { VendorProfile } from "@/lib/vendors/schema";

export type InterviewArea =
  | "capabilities"
  | "constraints"
  | "idealCustomer"
  | "knownGoodSignals"
  | "differentiators";

// The full conversation so far. Assistant turns carry an engine-appended
// [area:X] tag line; user turns are the vendor's raw answers. The system
// message is built per call by the engine and is NOT stored here.
export type InterviewState = {
  messages: LlmMessage[];
  // The vendor's current persisted profile. A vendor always exists before an
  // interview (created via createVendorStub), so the caller passes
  // getVendor(vendorId): the stub (name set, fields empty) on a first
  // interview, a fuller profile on a re-interview.
  existingProfile?: VendorProfile | null;
};

export type CoverageReport = {
  covered: InterviewArea[];
  remaining: InterviewArea[];
  isComplete: boolean;
};

export type NextQuestion = {
  question: string; // clean text to display (no tag)
  transcriptEntry: LlmMessage; // assistant turn to append to state.messages (tag retained)
  targetArea: InterviewArea;
  coverage: CoverageReport;
};
