import type { LlmProviderName, ProviderSpec } from "./types";

const VALID_NAMES = new Set<LlmProviderName>([
  "ollama",
  "deepseek",
  "grok",
  "openai",
  "anthropic",
  "gateway",
]);

const DEFAULT_ORDER: LlmProviderName[] = [
  "ollama",
  "deepseek",
  "grok",
  "openai",
  "anthropic",
];

function isConfigured(name: LlmProviderName): boolean {
  switch (name) {
    case "ollama":
      return Boolean(process.env.OLLAMA_MODEL);
    case "deepseek":
      return Boolean(process.env.DEEPSEEK_API_KEY);
    case "grok":
      return Boolean(process.env.XAI_API_KEY);
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY);
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY);
    case "gateway":
      return Boolean(process.env.AI_GATEWAY_API_KEY);
  }
}

function resolveModel(name: LlmProviderName): string {
  switch (name) {
    case "ollama":
      return process.env.OLLAMA_MODEL ?? "";
    case "deepseek":
      return process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    case "grok":
      return process.env.XAI_MODEL ?? "grok-3-mini";
    case "openai":
      return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    case "anthropic":
      return process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
    case "gateway":
      return process.env.AI_GATEWAY_MODEL ?? "";
  }
}

function parseOrder(): LlmProviderName[] {
  const raw = process.env.AI_PROVIDER_ORDER;
  if (!raw) return DEFAULT_ORDER;
  return raw
    .split(",")
    .map((s) => s.trim() as LlmProviderName)
    .filter((name) => VALID_NAMES.has(name));
}

/**
 * Returns the full ordered provider chain — every provider in the configured
 * order, each with isConfigured=true/false. Callers filter to isConfigured
 * before building model instances.
 */
export function getProviderChain(): ProviderSpec[] {
  return parseOrder().map((name) => ({
    name,
    model: resolveModel(name),
    isConfigured: isConfigured(name),
  }));
}
