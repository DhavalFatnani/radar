import { generateObject, type LlmResult } from "@/ai/llm";
import { vendorProfileSchema, type VendorProfileInput } from "@/lib/vendors/schema";
import { buildExtractionMessages } from "./prompts";
import type { InterviewState } from "./types";

export async function extractProfile(
  state: InterviewState,
): Promise<LlmResult<VendorProfileInput>> {
  const messages = buildExtractionMessages(state);
  const result = await generateObject(vendorProfileSchema, messages);

  // The vendor name is authoritative from the persisted profile, never from
  // the transcript — pin it so extraction can't rename the vendor.
  const pinnedName = state.existingProfile?.name;
  // result.value is the Zod-transformed output (VendorProfileInput); the schema's
  // input union type causes a TypeScript widening artefact — the cast is safe.
  const value = (pinnedName
    ? { ...(result.value as VendorProfileInput), name: pinnedName }
    : result.value) as VendorProfileInput;

  return { value, provider: result.provider };
}
