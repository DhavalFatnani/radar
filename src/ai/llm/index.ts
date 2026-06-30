import { z } from "zod";
import { getProviderChain } from "./config";
import { getModel } from "./providers";
import { generateTextWithFallback, generateObjectWithFallback } from "./fallback";
import type { LlmMessage, LlmProviderName, LlmResult } from "./types";

export { AllProvidersFailedError } from "./types";
export type { LlmMessage, LlmResult, LlmProviderName };

function activeProviders() {
  return getProviderChain()
    .filter((s) => s.isConfigured)
    .map((s) => ({ name: s.name, model: s.model, llm: getModel(s) }));
}

export async function generateText(
  messages: LlmMessage[],
): Promise<LlmResult<string>> {
  return generateTextWithFallback(activeProviders(), messages);
}

export async function generateObject<T>(
  schema: z.ZodType<T>,
  messages: LlmMessage[],
): Promise<LlmResult<T>> {
  return generateObjectWithFallback(activeProviders(), schema, messages);
}

export function listActiveProviders(): LlmProviderName[] {
  return getProviderChain()
    .filter((s) => s.isConfigured)
    .map((s) => s.name);
}
