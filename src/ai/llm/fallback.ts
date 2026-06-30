import { generateText as aiGenerateText, generateObject as aiGenerateObject } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import type { z } from "zod";
import type {
  LlmMessage,
  LlmProviderName,
  LlmResult,
  ProviderFailure,
} from "./types";
import { AllProvidersFailedError } from "./types";

/**
 * A ProviderSpec paired with its resolved AI SDK model instance.
 * Built by index.ts; injected directly so tests can pass a mock
 * or (when the ai module is vi.mocked) a null placeholder.
 */
export type ResolvedProvider = {
  name: LlmProviderName;
  model: string;
  llm: LanguageModel;
};

/** Strip long alphanumeric tokens (potential secrets) from error messages. */
function sanitize(msg: string): string {
  return msg.replace(/[a-zA-Z0-9_-]{20,}/g, "[REDACTED]");
}

export async function generateTextWithFallback(
  providers: ResolvedProvider[],
  messages: LlmMessage[],
): Promise<LlmResult<string>> {
  const failures: ProviderFailure[] = [];

  for (const p of providers) {
    try {
      const result = await aiGenerateText({
        model: p.llm,
        messages: messages as ModelMessage[],
      });
      return { value: result.text, provider: p.name };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      failures.push({
        provider: p.name,
        errorType: error.name,
        message: sanitize(error.message),
      });
    }
  }

  throw new AllProvidersFailedError(failures);
}

export async function generateObjectWithFallback<T>(
  providers: ResolvedProvider[],
  schema: z.ZodType<T>,
  messages: LlmMessage[],
): Promise<LlmResult<T>> {
  const failures: ProviderFailure[] = [];

  for (const p of providers) {
    try {
      const result = await aiGenerateObject({
        model: p.llm,
        schema,
        messages: messages as ModelMessage[],
      });
      return { value: result.object, provider: p.name };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      failures.push({
        provider: p.name,
        errorType: error.name,
        message: sanitize(error.message),
      });
    }
  }

  throw new AllProvidersFailedError(failures);
}
