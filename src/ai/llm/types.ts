export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmProviderName =
  | "ollama"
  | "deepseek"
  | "grok"
  | "openai"
  | "anthropic"
  | "gateway";

export type LlmResult<T> = {
  value: T;
  provider: LlmProviderName;
};

export type ProviderSpec = {
  name: LlmProviderName;
  model: string;
  isConfigured: boolean;
};

export type ProviderFailure = {
  provider: LlmProviderName;
  errorType: string;
  message: string;
};

export class AllProvidersFailedError extends Error {
  readonly failures: ProviderFailure[];

  constructor(failures: ProviderFailure[]) {
    const msg =
      failures.length === 0
        ? "No LLM provider configured. Set AI_PROVIDER_ORDER and at least one provider key (or OLLAMA_MODEL for local)."
        : `All ${failures.length} LLM provider(s) failed: ${failures
            .map((f) => `${f.provider}(${f.errorType})`)
            .join(", ")}`;
    super(msg);
    this.name = "AllProvidersFailedError";
    this.failures = failures;
  }
}
